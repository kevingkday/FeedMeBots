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

// 2. REST Live Table State
app.get('/api/table/live', (c) => {
  const stub = getTableStub(c.env);
  const url = new URL(c.req.url);
  url.pathname = '/state';
  return stub.fetch(new Request(url.toString()));
});

// 3. Table Runner Controls
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

// 4. Test Connection
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

// 5. Bot Registration (D1)
app.post('/api/bots/register', async (c) => {
  const { name, webhookUrl } = await c.req.json<{ name: string; webhookUrl: string }>();

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'Field "name" is required and must be non-empty.' }, 400);
  }
  if (!webhookUrl || (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://'))) {
    return c.json({ error: 'Field "webhookUrl" must be a valid HTTP or HTTPS URL.' }, 400);
  }

  const botId = `bot_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const apiKey = `fmb_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = Date.now();

  await c.env.DB.prepare(`
    INSERT INTO bots (id, name, api_key, webhook_url, is_active, is_house, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 0, ?, ?)
  `).bind(botId, name.trim(), apiKey, webhookUrl.trim(), now, now).run();

  return c.json({
    botId,
    name: name.trim(),
    webhookUrl: webhookUrl.trim(),
    apiKey,
    message: 'Bot registered successfully on Cloudflare D1.'
  }, 201);
});

// 6. Update Bot (D1)
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

// 7. Leaderboard (D1)
app.get('/api/leaderboard', async (c) => {
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
});

// 8. Bot Errors (D1)
app.get('/api/errors', async (c) => {
  const errors = await c.env.DB.prepare(`
    SELECT be.*, b.name AS bot_name
    FROM bot_errors be
    LEFT JOIN bots b ON b.id = be.bot_id
    ORDER BY be.created_at DESC
    LIMIT 50
  `).all();

  return c.json({ errors: errors.results || [] });
});

export default app;
