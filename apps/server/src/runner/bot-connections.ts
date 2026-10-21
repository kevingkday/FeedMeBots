import { Action, PlayerGameStateV1 } from '@feedmebots/engine';
import { db } from '../db/db.js';
import { DispatchResult, logBotError } from './dispatcher.js';

interface PendingTurn {
  resolve: (result: DispatchResult) => void;
  timer: NodeJS.Timeout;
  start: number;
  state: PlayerGameStateV1;
}

interface ConnectedBot {
  botId: string;
  botName: string;
  socket: any; // WebSocket
  pending: Map<string, PendingTurn>;
}

export class BotConnectionManager {
  private connections = new Map<string, ConnectedBot>();

  /**
   * Authenticate and register a new WebSocket bot connection.
   */
  public async handleConnection(socket: any, apiKey: string): Promise<{ success: boolean; botId?: string; botName?: string; error?: string }> {
    if (!apiKey) {
      socket.send(JSON.stringify({ type: 'error', message: 'Missing apiKey query parameter' }));
      socket.close(4001, 'Missing apiKey');
      return { success: false, error: 'Missing apiKey' };
    }

    // Lookup bot by API key in SQLite
    const bot = db.prepare('SELECT id, name FROM bots WHERE api_key = ?').get(apiKey) as { id: string; name: string } | undefined;

    if (!bot) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid API key' }));
      socket.close(4002, 'Invalid API key');
      return { success: false, error: 'Invalid API key' };
    }

    // If there is an existing socket for this bot, gracefully close it
    if (this.connections.has(bot.id)) {
      const existing = this.connections.get(bot.id)!;
      try {
        existing.socket.send(JSON.stringify({ type: 'replaced', message: 'New bridge connection established for this bot' }));
        existing.socket.close(4003, 'Replaced by new connection');
      } catch {
        // ignore
      }
    }

    const connectedBot: ConnectedBot = {
      botId: bot.id,
      botName: bot.name,
      socket,
      pending: new Map()
    };

    this.connections.set(bot.id, connectedBot);
    console.log(`🔌 [CLI Bridge] Bot "${bot.name}" (${bot.id}) connected via WebSocket.`);

    // Send welcome payload
    socket.send(JSON.stringify({
      type: 'welcome',
      botId: bot.id,
      botName: bot.name,
      message: `Successfully connected to FeedMeBots as "${bot.name}"! Waiting for game turns.`
    }));

    // Setup message handler
    socket.on('message', (raw: any) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        const data = JSON.parse(text);

        if (data.type === 'turn_response' && data.requestId) {
          const pending = connectedBot.pending.get(data.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            connectedBot.pending.delete(data.requestId);
            const latencyMs = Date.now() - pending.start;

            const actionData = data.action;
            if (!actionData || typeof actionData.action !== 'string') {
              logBotError(bot.id, pending.state.handId, pending.state.stage, 'malformed_json', JSON.stringify(pending.state), text, 'Invalid action payload from CLI bridge');
              pending.resolve({
                success: false,
                errorType: 'malformed_json',
                rawResponse: text,
                errorMessage: 'Invalid action payload from CLI bridge',
                latencyMs
              });
              return;
            }

            const action: Action = {
              action: actionData.action as any,
              amount: typeof actionData.amount === 'number' ? actionData.amount : undefined
            };

            pending.resolve({
              success: true,
              action,
              rawResponse: text,
              latencyMs
            });
          }
        } else if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (err: any) {
        console.error(`[CLI Bridge] Error parsing message from bot ${bot.name}:`, err);
      }
    });

    // Cleanup on disconnect
    socket.on('close', () => {
      console.log(`🔌 [CLI Bridge] Bot "${bot.name}" disconnected.`);
      // Reject any pending turns
      for (const [reqId, pending] of connectedBot.pending.entries()) {
        clearTimeout(pending.timer);
        pending.resolve({
          success: false,
          errorType: 'network_error',
          errorMessage: 'Bot disconnected while awaiting turn',
          latencyMs: Date.now() - pending.start
        });
      }
      connectedBot.pending.clear();
      this.connections.delete(bot.id);
    });

    socket.on('error', (err: any) => {
      console.error(`[CLI Bridge] Socket error for bot "${bot.name}":`, err.message || err);
    });

    return { success: true, botId: bot.id, botName: bot.name };
  }

  /**
   * Check if a bot has an active WebSocket bridge connected.
   */
  public has(botId: string): boolean {
    return this.connections.has(botId);
  }

  /**
   * Dispatch a turn state to a connected WebSocket bot and wait for the response.
   */
  public async dispatchAction(
    botId: string,
    state: PlayerGameStateV1,
    timeoutMs = 2000
  ): Promise<DispatchResult> {
    const conn = this.connections.get(botId);
    if (!conn) {
      return {
        success: false,
        errorType: 'network_error',
        errorMessage: 'Bot is not connected via WebSocket bridge',
        latencyMs: 0
      };
    }

    const requestId = `req_${state.handId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const start = Date.now();

    return new Promise<DispatchResult>((resolve) => {
      const timer = setTimeout(() => {
        conn.pending.delete(requestId);
        logBotError(botId, state.handId, state.stage, 'timeout', JSON.stringify(state), '', `WebSocket bridge timed out after ${timeoutMs}ms`);
        resolve({
          success: false,
          errorType: 'timeout',
          errorMessage: `WebSocket bridge timed out after ${timeoutMs}ms`,
          latencyMs: Date.now() - start
        });
      }, timeoutMs);

      conn.pending.set(requestId, {
        resolve,
        timer,
        start,
        state
      });

      try {
        conn.socket.send(JSON.stringify({
          type: 'turn_request',
          requestId,
          state,
          timeoutMs
        }));
      } catch (err: any) {
        clearTimeout(timer);
        conn.pending.delete(requestId);
        resolve({
          success: false,
          errorType: 'network_error',
          errorMessage: err.message || 'Failed to send turn_request to WebSocket',
          latencyMs: Date.now() - start
        });
      }
    });
  }

  public getConnectedBotIds(): string[] {
    return Array.from(this.connections.keys());
  }
}

export const botConnectionManager = new BotConnectionManager();
