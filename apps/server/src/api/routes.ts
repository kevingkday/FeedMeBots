import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db/db.js';
import { TableRunner } from '../runner/table-runner.js';
import { botConnectionManager } from '../runner/bot-connections.js';

export function registerRoutes(app: FastifyInstance, tableRunner: TableRunner) {
  // 1. Register a new bot
  app.post<{
    Body: { name: string; webhookUrl?: string };
  }>('/api/bots/register', async (req, reply) => {
    const { name, webhookUrl } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({ error: 'Field "name" is required and must be non-empty.' });
    }

    let effectiveWebhook = 'cli://bridge';
    if (webhookUrl && typeof webhookUrl === 'string' && webhookUrl.trim().length > 0) {
      const trimmed = webhookUrl.trim();
      if (trimmed !== 'cli://bridge') {
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return reply.code(400).send({ error: 'Webhook URL must be a valid HTTP or HTTPS URL.' });
          }
        } catch {
          return reply.code(400).send({ error: 'Webhook URL must be a valid HTTP or HTTPS URL.' });
        }
      }
      effectiveWebhook = trimmed;
    }

    const botId = `bot_${crypto.randomBytes(6).toString('hex')}`;
    const apiKey = `fmb_${crypto.randomBytes(16).toString('hex')}`;
    const now = Date.now();

    const insert = db.prepare(`
      INSERT INTO bots (id, name, api_key, webhook_url, is_active, is_house, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 0, ?, ?)
    `);

    insert.run(botId, name.trim(), apiKey, effectiveWebhook, now, now);

    return reply.code(201).send({
      botId,
      name: name.trim(),
      webhookUrl: effectiveWebhook,
      apiKey,
      cliBridgeCommand: `npx @feedmebots/cli connect --bot http://localhost:8080/action --key ${apiKey}`,
      message: 'Bot registered successfully. Save your API key for future updates.'
    });
  });

  // 2. Update bot configuration
  app.put<{
    Params: { id: string };
    Body: { name?: string; webhookUrl?: string; isActive?: boolean };
  }>('/api/bots/:id', async (req, reply) => {
    const { id } = req.params;
    const apiKey = req.headers['x-api-key'] as string;

    const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(id) as any;
    if (!bot) {
      return reply.code(404).send({ error: `Bot with id "${id}" not found.` });
    }

    if (bot.api_key !== apiKey) {
      return reply.code(401).send({ error: 'Invalid API key.' });
    }

    const { name, webhookUrl, isActive } = req.body || {};
    const newName = name ?? bot.name;
    const newUrl = webhookUrl ?? bot.webhook_url;
    const newActive = isActive !== undefined ? (isActive ? 1 : 0) : bot.is_active;

    db.prepare(`
      UPDATE bots 
      SET name = ?, webhook_url = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(newName, newUrl, newActive, Date.now(), id);

    return {
      botId: id,
      name: newName,
      webhookUrl: newUrl,
      isActive: Boolean(newActive)
    };
  });

  // 3. List bots
  app.get('/api/bots', async () => {
    const bots = db.prepare(`
      SELECT id, name, webhook_url, is_active, is_house, created_at 
      FROM bots 
      ORDER BY is_house ASC, created_at DESC
    `).all();
    return { bots };
  });

  // 4. Test connection
  app.post<{
    Body: { webhookUrl?: string; botId?: string };
  }>('/api/test-connection', async (req, reply) => {
    let targetUrl = req.body?.webhookUrl;
    let botName = 'TesterBot';

    if (req.body?.botId) {
      const bot = db.prepare('SELECT name, webhook_url FROM bots WHERE id = ?').get(req.body.botId) as any;
      if (!bot) {
        return reply.code(404).send({ error: `Bot ${req.body.botId} not found` });
      }
      targetUrl = bot.webhook_url;
      botName = bot.name;
    }

    if (!targetUrl) {
      return reply.code(400).send({ error: 'Either "webhookUrl" or "botId" must be provided.' });
    }

    const result = await tableRunner.testConnection(targetUrl, botName);
    return result;
  });

  // 5. Leaderboard
  app.get('/api/leaderboard', async () => {
    const query = db.prepare(`
      SELECT 
        b.id AS bot_id,
        b.name,
        b.is_house,
        COUNT(hp.hand_id) AS hands_played,
        COALESCE(SUM(hp.net_chips), 0) AS total_chips,
        (SELECT COUNT(*) FROM matches WHERE winner_bot_id = b.id) AS tournaments_won,
        (SELECT COUNT(*) FROM bot_errors WHERE bot_id = b.id AND error_type = 'timeout') AS timeouts,
        (SELECT COUNT(*) FROM bot_errors WHERE bot_id = b.id) AS total_errors
      FROM bots b
      LEFT JOIN hand_players hp ON hp.bot_id = b.id
      GROUP BY b.id
      HAVING hands_played > 0 OR b.is_house = 0
      ORDER BY tournaments_won DESC, total_chips DESC
    `).all() as any[];

    const leaderboard = query.map(row => {
      const bb = 100;
      const bb100 = row.hands_played > 0 
        ? ((row.total_chips / bb / row.hands_played) * 100).toFixed(2)
        : '0.00';

      return {
        botId: row.bot_id,
        name: row.name,
        isHouse: Boolean(row.is_house),
        tournamentsWon: row.tournaments_won || 0,
        handsPlayed: row.hands_played,
        chipsWon: row.total_chips,
        bb100: parseFloat(bb100),
        timeouts: row.timeouts,
        errors: row.total_errors
      };
    });

    return { leaderboard };
  });

  // 6. Bot error logs
  app.get<{
    Params: { id: string };
  }>('/api/bots/:id/errors', async (req) => {
    const { id } = req.params;
    const errors = db.prepare(`
      SELECT id, hand_id, stage, error_type, payload_sent, raw_response, error_message, created_at
      FROM bot_errors
      WHERE bot_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(id);

    return { botId: id, errors };
  });

  // 7. Recent error logs overall
  app.get('/api/errors', async () => {
    const errors = db.prepare(`
      SELECT be.*, b.name AS bot_name
      FROM bot_errors be
      LEFT JOIN bots b ON b.id = be.bot_id
      ORDER BY be.created_at DESC
      LIMIT 50
    `).all();
    return { errors };
  });

  // 8. Live table state
  app.get('/api/table/live', async () => {
    const { state, match } = tableRunner.getCurrentState();
    return {
      isRunning: tableRunner.isTableRunning(),
      state,
      match
    };
  });

  // 9. Table control
  app.post('/api/table/start', async () => {
    tableRunner.start();
    return { isRunning: true };
  });

  app.post('/api/table/stop', async () => {
    tableRunner.stop();
    return { isRunning: false };
  });

  // User convenience web redirects
  app.get('/hands', async (req, reply) => {
    return reply.redirect('/#hands');
  });

  app.get('/how-it-works', async (req, reply) => {
    return reply.redirect('/#howitworks');
  });

  app.get('/docs', async (req, reply) => {
    return reply.redirect('/#howitworks');
  });

  app.get('/contract', async (req, reply) => {
    return reply.redirect('/#contract');
  });

  app.get('/api-contract', async (req, reply) => {
    return reply.redirect('/#contract');
  });

  app.get('/spec', async (req, reply) => {
    return reply.redirect('/#contract');
  });

  // WSDL/Schema specification metadata endpoint
  app.get('/api/spec', async () => {
    return {
      name: 'FeedMeBots API Specification (WSDL Equivalent)',
      version: 'v1',
      domain: 'https://feedmework.com',
      protocol: 'HTTP/1.1 JSON Webhooks',
      slaTimeoutMs: 2000,
      schemas: {
        gameState: 'https://feedmework.com/schemas/v1/game-state.schema.json',
        botAction: 'https://feedmework.com/schemas/v1/bot-action.schema.json'
      },
      endpoints: {
        registerBot: 'POST /api/bots/register',
        updateBot: 'PUT /api/bots/:id',
        testConnection: 'POST /api/test-connection',
        liveTable: 'GET /api/table/live',
        hands: 'GET /api/hands',
        botHands: 'GET /api/bots/:id/hands',
        cliBridgeWs: 'WSS /api/bots/ws?apiKey=YOUR_API_KEY'
      },
      cliBridge: {
        command: 'npx @feedmebots/cli connect --bot http://localhost:8080/action --key YOUR_API_KEY',
        description: 'Connect local models (Ollama, PyTorch, FastAPI) to FeedMeBots without exposing public ports or hosting on the web.'
      },
      actions: ['fold', 'check', 'call', 'raise'],
      cardNotation: {
        ranks: ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'],
        suits: { s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' },
        examples: ['As', 'Kh', '7d', '2c']
      }
    };
  });

  // WebSocket CLI Bridge Endpoint for local bots
  (app as any).get('/api/bots/ws', { websocket: true }, (connection: any, req: any) => {
    const query = (req.query || {}) as { apiKey?: string };
    const apiKey = query.apiKey || '';
    botConnectionManager.handleConnection(connection.socket, apiKey);
  });

  // 10. Hand history list
  app.get<{
    Querystring: { limit?: string; botId?: string };
  }>('/api/hands', async (req) => {
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 100);
    const botId = req.query.botId;

    let hands: any[];
    if (botId) {
      hands = db.prepare(`
        SELECT h.id, h.game_id, h.small_blind, h.big_blind, h.community_cards, h.winners, h.total_pot, h.created_at
        FROM hands h
        JOIN hand_players hp ON hp.hand_id = h.id
        WHERE hp.bot_id = ?
        ORDER BY h.created_at DESC
        LIMIT ?
      `).all(botId, limit) as any[];
    } else {
      hands = db.prepare(`
        SELECT id, game_id, small_blind, big_blind, community_cards, winners, total_pot, created_at
        FROM hands
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit) as any[];
    }

    return {
      hands: hands.map(h => ({
        ...h,
        communityCards: JSON.parse(h.community_cards),
        winners: JSON.parse(h.winners)
      }))
    };
  });

  // 10b. Per-bot hand history telemetry (for analysis and fine-tuning review)
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>('/api/bots/:id/hands', async (req) => {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);

    const hands = db.prepare(`
      SELECT 
        h.id, h.game_id, h.small_blind, h.big_blind, h.community_cards, h.winners, h.total_pot, h.action_history, h.created_at,
        hp.seat_index, hp.starting_stack, hp.final_stack, hp.net_chips, hp.hole_cards, hp.rank_description
      FROM hand_players hp
      JOIN hands h ON h.id = hp.hand_id
      WHERE hp.bot_id = ?
      ORDER BY h.created_at DESC
      LIMIT ?
    `).all(id, limit) as any[];

    return {
      botId: id,
      totalHands: hands.length,
      hands: hands.map(h => ({
        handId: h.id,
        gameId: h.game_id,
        netChips: h.net_chips,
        startingStack: h.starting_stack,
        finalStack: h.final_stack,
        holeCards: h.hole_cards ? JSON.parse(h.hole_cards) : null,
        rankDescription: h.rank_description,
        communityCards: JSON.parse(h.community_cards),
        totalPot: h.total_pot,
        actionHistory: JSON.parse(h.action_history),
        winners: JSON.parse(h.winners),
        timestamp: h.created_at
      }))
    };
  });

  // 11. Single hand detail
  app.get<{
    Params: { id: string };
  }>('/api/hands/:id', async (req, reply) => {
    const hand = db.prepare('SELECT * FROM hands WHERE id = ?').get(req.params.id) as any;
    if (!hand) {
      return reply.code(404).send({ error: 'Hand not found' });
    }

    const players = db.prepare(`
      SELECT hp.*, b.name AS bot_name
      FROM hand_players hp
      LEFT JOIN bots b ON b.id = hp.bot_id
      WHERE hp.hand_id = ?
      ORDER BY hp.seat_index ASC
    `).all(req.params.id) as any[];

    return {
      hand: {
        ...hand,
        communityCards: JSON.parse(hand.community_cards),
        actionHistory: JSON.parse(hand.action_history),
        winners: JSON.parse(hand.winners)
      },
      players: players.map(p => ({
        ...p,
        holeCards: p.hole_cards ? JSON.parse(p.hole_cards) : null
      }))
    };
  });
}
