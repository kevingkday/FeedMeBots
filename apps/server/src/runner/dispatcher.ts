import { Action, PlayerGameStateV1 } from '@feedmebots/engine';
import { db } from '../db/db.js';

export interface DispatchResult {
  success: boolean;
  action?: Action;
  errorType?: 'timeout' | 'bad_status' | 'malformed_json' | 'network_error';
  rawResponse?: string;
  errorMessage?: string;
  latencyMs: number;
}

export async function dispatchWebhookAction(
  botId: string,
  webhookUrl: string,
  state: PlayerGameStateV1,
  timeoutMs = 2000
): Promise<DispatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  const payloadSent = JSON.stringify(state);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FeedMeBots-Server/1.0',
        'X-FeedMeBots-Version': 'v1'
      },
      body: payloadSent,
      signal: controller.signal
    });

    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const rawText = await res.text().catch(() => '');
      logBotError(botId, state.handId, state.stage, 'bad_status', payloadSent, rawText, `HTTP ${res.status}: ${res.statusText}`);
      return {
        success: false,
        errorType: 'bad_status',
        rawResponse: rawText,
        errorMessage: `HTTP ${res.status}: ${res.statusText}`,
        latencyMs
      };
    }

    const rawText = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (e: any) {
      logBotError(botId, state.handId, state.stage, 'malformed_json', payloadSent, rawText, 'Response was not valid JSON');
      return {
        success: false,
        errorType: 'malformed_json',
        rawResponse: rawText,
        errorMessage: 'Response was not valid JSON',
        latencyMs
      };
    }

    if (!parsed || typeof parsed.action !== 'string') {
      logBotError(botId, state.handId, state.stage, 'malformed_json', payloadSent, rawText, 'Missing action property in response');
      return {
        success: false,
        errorType: 'malformed_json',
        rawResponse: rawText,
        errorMessage: 'Missing action property in response',
        latencyMs
      };
    }

    const action: Action = {
      action: parsed.action as any,
      amount: typeof parsed.amount === 'number' ? parsed.amount : undefined
    };

    return {
      success: true,
      action,
      rawResponse: rawText,
      latencyMs
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err.name === 'AbortError') {
      logBotError(botId, state.handId, state.stage, 'timeout', payloadSent, '', `Request timed out after ${timeoutMs}ms`);
      return {
        success: false,
        errorType: 'timeout',
        errorMessage: `Request timed out after ${timeoutMs}ms`,
        latencyMs
      };
    }

    logBotError(botId, state.handId, state.stage, 'network_error', payloadSent, '', err.message || 'Network error');
    return {
      success: false,
      errorType: 'network_error',
      errorMessage: err.message || 'Network error',
      latencyMs
    };
  } finally {
    clearTimeout(timer);
  }
}

export function logBotError(
  botId: string,
  handId: string,
  stage: string,
  errorType: string,
  payloadSent: string,
  rawResponse: string,
  errorMessage: string
) {
  try {
    const stmt = db.prepare(`
      INSERT INTO bot_errors (bot_id, hand_id, stage, error_type, payload_sent, raw_response, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(botId, handId, stage, errorType, payloadSent, rawResponse, errorMessage, Date.now());
  } catch (e) {
    console.error('Failed to log bot error into database:', e);
  }
}
