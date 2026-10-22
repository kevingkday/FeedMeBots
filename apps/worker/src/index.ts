import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, TableDurableObject } from './durable-objects/table-runner.js';

export { TableDurableObject };

const app = new Hono<{ Bindings: Env }>();

// Enable CORS
app.use('/*', cors());

// Helper to get the singleton table Durable Object instance
function getTableStub(env: Env) {
  const id = env.TABLE_RUNNER.idFromName('main_table_1');
  return env.TABLE_RUNNER.get(id);
}

// 1. WebSocket Live Stream Endpoint
app.get('/api/table/ws', (c) => {
  const stub = getTableStub(c.env);
  return stub.fetch(c.req.raw);
});

// 2. WebSocket CLI Bridge Endpoint for local bots
app.get('/api/bots/ws', (c) => {
  const stub = getTableStub(c.env);
  return stub.fetch(c.req.raw);
});

// 3. REST Live Table State
app.get('/api/table/live', (c) => {
  const stub = getTableStub(c.env);
  const url = new URL(c.req.url);
  url.pathname = '/state';
  return stub.fetch(new Request(url.toString()));
});

// 4. Table Runner Controls
app.post('/api/table/start', (c) => {
  const stub = getTableStub(c.env);
  const url = new URL(c.req.url);
  url.pathname = '/start';
  return stub.fetch(new Request(url.toString(), { method: 'POST' }));
});

app.post('/api/table/stop', (c) => {
  const stub = getTableStub(c.env);
  const url = new URL(c.req.url);
  url.pathname = '/stop';
  return stub.fetch(new Request(url.toString(), { method: 'POST' }));
});

// 5. Test Connection
app.post('/api/test-connection', async (c) => {
  const stub = getTableStub(c.env);
  const body = await c.req.json();
  const url = new URL(c.req.url);
  url.pathname = '/test-connection';
  return stub.fetch(new Request(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }));
});

// 6. Bot Registration (D1)
app.post('/api/bots/register', async (c) => {
  const { name, webhookUrl } = await c.req.json<{ name: string; webhookUrl?: string }>();

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'Field "name" is required and must be non-empty.' }, 400);
  }

  const effectiveWebhook = (webhookUrl && typeof webhookUrl === 'string' && webhookUrl.trim().length > 0)
    ? webhookUrl.trim()
    : 'cli://bridge';

  const botId = `bot_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const apiKey = `fmb_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = Date.now();

  await c.env.DB.prepare(`
    INSERT INTO bots (id, name, api_key, webhook_url, is_active, is_house, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 0, ?, ?)
  `).bind(botId, name.trim(), apiKey, effectiveWebhook, now, now).run();

  return c.json({
    botId,
    name: name.trim(),
    webhookUrl: effectiveWebhook,
    apiKey,
    cliBridgeCommand: `npx @feedmebots/cli connect --bot http://localhost:8080/action --key ${apiKey}`,
    message: 'Bot registered successfully on Cloudflare D1.'
  }, 201);
});

// 7. Update Bot (D1)
app.put('/api/bots/:id', async (c) => {
  const id = c.req.param('id');
  const apiKey = c.req.header('x-api-key');

  const bot = await c.env.DB.prepare('SELECT * FROM bots WHERE id = ?').bind(id).first() as any;
  if (!bot) {
    return c.json({ error: 'Bot not found.' }, 404);
  }
  if (bot.api_key !== apiKey) {
    return c.json({ error: 'Invalid API key.' }, 401);
  }

  const { name, webhookUrl, isActive } = await c.req.json();
  const newName = name ?? bot.name;
  const newUrl = webhookUrl ?? bot.webhook_url;
  const newActive = isActive !== undefined ? (isActive ? 1 : 0) : bot.is_active;

  await c.env.DB.prepare(`
    UPDATE bots 
    SET name = ?, webhook_url = ?, is_active = ?, updated_at = ?
    WHERE id = ?
  `).bind(newName, newUrl, newActive, Date.now(), id).run();

  return c.json({
    botId: id,
    name: newName,
    webhookUrl: newUrl,
    isActive: Boolean(newActive)
  });
});

// 8. Bot List (D1)
app.get('/api/bots', async (c) => {
  try {
    const bots = await c.env.DB.prepare(`
      SELECT id, name, is_house FROM bots
      WHERE is_active = 1
      ORDER BY is_house ASC, name ASC
    `).all();
    return c.json({ bots: bots.results || [] });
  } catch (err: any) {
    console.error('Error fetching bots from D1:', err);
    return c.json({ bots: [] });
  }
});

// 9. Hand History List (D1)
app.get('/api/hands', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '25', 10), 100);
  const botId = c.req.query('botId');

  try {
    let query: any;
    if (botId) {
      query = await c.env.DB.prepare(`
        SELECT h.id, h.game_id, h.small_blind, h.big_blind, h.community_cards, h.winners, h.total_pot, h.created_at
        FROM hands h
        JOIN hand_players hp ON hp.hand_id = h.id
        WHERE hp.bot_id = ?
        ORDER BY h.created_at DESC
        LIMIT ?
      `).bind(botId, limit).all();
    } else {
      query = await c.env.DB.prepare(`
        SELECT id, game_id, small_blind, big_blind, community_cards, winners, total_pot, created_at
        FROM hands
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(limit).all();
    }

    const hands = (query.results || []).map((h: any) => ({
      ...h,
      communityCards: h.community_cards ? JSON.parse(h.community_cards) : [],
      winners: h.winners ? JSON.parse(h.winners) : []
    }));

    return c.json({ hands });
  } catch (err: any) {
    console.error('Error fetching hands from D1:', err);
    return c.json({ hands: [] });
  }
});

// 10. Single Hand Detail (D1)
app.get('/api/hands/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const hand = await c.env.DB.prepare('SELECT * FROM hands WHERE id = ?').bind(id).first() as any;
    if (!hand) {
      return c.json({ error: 'Hand not found' }, 404);
    }

    const players = await c.env.DB.prepare(`
      SELECT hp.*, b.name AS bot_name
      FROM hand_players hp
      LEFT JOIN bots b ON b.id = hp.bot_id
      WHERE hp.hand_id = ?
      ORDER BY hp.seat_index ASC
    `).bind(id).all();

    return c.json({
      hand: {
        ...hand,
        communityCards: hand.community_cards ? JSON.parse(hand.community_cards) : [],
        actionHistory: hand.action_history ? JSON.parse(hand.action_history) : [],
        winners: hand.winners ? JSON.parse(hand.winners) : []
      },
      players: (players.results || []).map((p: any) => ({
        ...p,
        holeCards: p.hole_cards ? JSON.parse(p.hole_cards) : null
      }))
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// 11. Bot Hands Telemetry (D1)
app.get('/api/bots/:id/hands', async (c) => {
  const botId = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);

  try {
    const query = await c.env.DB.prepare(`
      SELECT 
        hp.hand_id,
        hp.starting_stack,
        hp.final_stack,
        hp.net_chips,
        hp.hole_cards,
        hp.rank_description,
        h.community_cards,
        h.action_history,
        h.winners,
        h.total_pot,
        h.created_at
      FROM hand_players hp
      JOIN hands h ON h.id = hp.hand_id
      WHERE hp.bot_id = ?
      ORDER BY h.created_at DESC
      LIMIT ?
    `).bind(botId, limit).all();

    const hands = (query.results || []).map((row: any) => ({
      handId: row.hand_id,
      startingStack: row.starting_stack,
      finalStack: row.final_stack,
      netChips: row.net_chips,
      holeCards: row.hole_cards ? JSON.parse(row.hole_cards) : null,
      rankDescription: row.rank_description,
      communityCards: row.community_cards ? JSON.parse(row.community_cards) : [],
      actionHistory: row.action_history ? JSON.parse(row.action_history) : [],
      winners: row.winners ? JSON.parse(row.winners) : [],
      totalPot: row.total_pot,
      timestamp: row.created_at
    }));

    return c.json({ botId, count: hands.length, hands });
  } catch (err: any) {
    return c.json({ botId, count: 0, hands: [] });
  }
});

// 12. Leaderboard (D1)
app.get('/api/leaderboard', async (c) => {
  try {
    const query = await c.env.DB.prepare(`
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
    `).all();

    const leaderboard = (query.results || []).map((row: any) => {
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

    return c.json({ leaderboard });
  } catch (err: any) {
    console.error('Error fetching leaderboard from D1:', err);
    return c.json({ leaderboard: [] });
  }
});

// 13. Bot Errors (D1)
app.get('/api/errors', async (c) => {
  try {
    const errors = await c.env.DB.prepare(`
      SELECT be.*, b.name AS bot_name
      FROM bot_errors be
      LEFT JOIN bots b ON b.id = be.bot_id
      ORDER BY be.created_at DESC
      LIMIT 50
    `).all();

    return c.json({ errors: errors.results || [] });
  } catch (err: any) {
    return c.json({ errors: [] });
  }
});

// 14. Contract & Schema Specification Endpoints
app.get('/contract', (c) => c.redirect('/#contract'));
app.get('/api-contract', (c) => c.redirect('/#contract'));
app.get('/spec', (c) => c.redirect('/#contract'));

app.get('/api/spec', (c) => {
  return c.json({
    name: 'FeedMeBots API Specification (WSDL Equivalent)',
    version: 'v1',
    domain: 'https://feedmework.com',
    protocol: 'HTTP/1.1 JSON Webhooks & WebSockets',
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
  });
});

export default app;
