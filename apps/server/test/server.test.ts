import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import http from 'node:http';
import { initDatabase, db } from '../src/db/db.js';
import { TableRunner } from '../src/runner/table-runner.js';
import { registerRoutes } from '../src/api/routes.js';
import { Action, PlayerGameStateV1 } from '@feedmebots/engine';

describe('Server REST API and Runner', () => {
  let app: FastifyInstance;
  let tableRunner: TableRunner;
  let mockBotServer: http.Server;
  let mockBotPort: number;

  beforeAll(async () => {
    // Spin up a mock webhook bot for test connection
    await new Promise<void>((resolve) => {
      mockBotServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const state: PlayerGameStateV1 = JSON.parse(body);
          // Always pick check if legal, else call
          const canCheck = state.legalActions.some(a => a.action === 'check');
          const action: Action = canCheck ? { action: 'check' } : { action: 'call' };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(action));
        });
      });
      mockBotServer.listen(0, () => {
        const addr = mockBotServer.address() as any;
        mockBotPort = addr.port;
        resolve();
      });
    });

    initDatabase();
    tableRunner = new TableRunner(); // runner created but loop not started

    app = Fastify();
    registerRoutes(app, tableRunner);
    await app.ready();
  });

  afterAll(async () => {
    db.prepare("DELETE FROM bots WHERE is_house = 0").run();
    db.prepare("DELETE FROM hand_players").run();
    db.prepare("DELETE FROM hands").run();
    db.prepare("DELETE FROM bot_errors").run();
    await app.close();
    await new Promise<void>(resolve => mockBotServer.close(() => resolve()));
  });

  it('registers a new bot and returns an API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/register',
      payload: {
        name: 'AlphaPoker',
        webhookUrl: `http://localhost:${mockBotPort}`
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.botId).toBeDefined();
    expect(body.apiKey).toMatch(/^fmb_/);
    expect(body.name).toBe('AlphaPoker');
    expect(body.webhookUrl).toBe(`http://localhost:${mockBotPort}`);
  });

  it('rejects bot registration with invalid webhook URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bots/register',
      payload: {
        name: 'BadBot',
        webhookUrl: 'not-a-valid-url'
      }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('valid HTTP or HTTPS URL');
  });

  it('updates bot configuration with valid API key', async () => {
    // 1. Register
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/bots/register',
      payload: {
        name: 'BetaBot',
        webhookUrl: `http://localhost:${mockBotPort}`
      }
    });
    const { botId, apiKey } = regRes.json();

    // 2. Update without API key -> 401
    const failRes = await app.inject({
      method: 'PUT',
      url: `/api/bots/${botId}`,
      payload: { name: 'BetaBotV2' }
    });
    expect(failRes.statusCode).toBe(401);

    // 3. Update with valid API key -> 200
    const okRes = await app.inject({
      method: 'PUT',
      url: `/api/bots/${botId}`,
      headers: { 'x-api-key': apiKey },
      payload: { name: 'BetaBotV2' }
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().name).toBe('BetaBotV2');
  });

  it('runs test-connection playing 1 hand vs house bot and returning exchanges', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-connection',
      payload: {
        webhookUrl: `http://localhost:${mockBotPort}`,
        botName: 'TestBotRunner'
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.handId).toBeDefined();
    expect(Array.isArray(body.exchanges)).toBe(true);
    expect(body.exchanges.length).toBeGreaterThan(0);

    const firstExchange = body.exchanges[0];
    expect(firstExchange.requestSent).toBeDefined();
    expect(firstExchange.responseReceived).toBeDefined();
    expect(firstExchange.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.handSummary).toBeDefined();
  });

  it('returns platform leaderboard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/leaderboard'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.leaderboard)).toBe(true);
  });

  it('returns error logs list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/errors'
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.errors)).toBe(true);
  });
});
