import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import WebSocket from 'ws';

export interface ConnectOptions {
  botUrl: string;
  apiKey: string;
  serverUrl: string;
  timeoutMs: number;
}

export function startBridge(options: ConnectOptions) {
  const { botUrl, apiKey, serverUrl, timeoutMs } = options;

  // Derive WebSocket URL from server URL
  const parsedServer = new URL(serverUrl);
  const isSsl = parsedServer.protocol === 'https:';
  const wsProtocol = isSsl ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${parsedServer.host}/api/bots/ws?apiKey=${encodeURIComponent(apiKey)}`;

  // Masked API key for display
  const maskedKey = apiKey.length > 8 
    ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
    : apiKey;

  console.log('\n============================================================');
  console.log('🤖 FeedMeBots CLI Bridge');
  console.log('============================================================');
  console.log(`📡 Remote Arena : ${serverUrl}`);
  console.log(`🔗 Local Bot    : ${botUrl}`);
  console.log(`🔑 Bot API Key  : ${maskedKey}`);
  console.log(`⏱️ Local Timeout: ${timeoutMs}ms`);
  console.log('============================================================\n');

  let ws: WebSocket | null = null;
  let isReconnecting = false;
  let shouldExit = false;

  function connect() {
    console.log(`⏳ Connecting to ${wsProtocol}//${parsedServer.host}...`);

    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      isReconnecting = false;
      console.log('🟢 WebSocket connection established!');
    });

    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        const msg = JSON.parse(text);

        if (msg.type === 'welcome') {
          console.log(`\n🎉 Verified with arena as: "${msg.botName}" (ID: ${msg.botId})`);
          console.log(`🟢 Bridge is LIVE! Waiting for table runner to deal hands...\n`);
        } else if (msg.type === 'turn_request') {
          handleTurnRequest(msg);
        } else if (msg.type === 'error') {
          console.error(`❌ Server error: ${msg.message}`);
        } else if (msg.type === 'replaced') {
          console.warn(`⚠️ ${msg.message}`);
        }
      } catch (err: any) {
        console.error('Failed to parse server message:', err.message);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString('utf-8');
      console.log(`🔌 Disconnected from server (code: ${code}, reason: ${reasonStr || 'No reason provided'})`);

      if (code === 4001 || code === 4002) {
        console.error(`❌ Authentication failed: ${reasonStr || 'Invalid API Key'}. Exiting.`);
        shouldExit = true;
        process.exit(1);
      }

      if (!shouldExit && !isReconnecting) {
        isReconnecting = true;
        console.log('🔄 Reconnecting in 3 seconds...');
        setTimeout(() => {
          if (!shouldExit) connect();
        }, 3000);
      }
    });

    ws.on('error', (err: any) => {
      console.error(`⚠️ WebSocket error: ${err.message || err}`);
    });
  }

  async function handleTurnRequest(msg: any) {
    const { requestId, state } = msg;
    const stage = (state?.stage || 'unknown').toUpperCase();
    const cards = (state?.holeCards || []).join(' ');
    const board = (state?.communityCards || []).length > 0 ? (state?.communityCards || []).join(' ') : 'None';
    const toCall = state?.toCall ?? 0;

    const timeStr = new Date().toLocaleTimeString();
    console.log(`[${timeStr}] 🎴 Turn Request #${state?.handId} | Stage: ${stage} | Hole: [${cards}] | Board: [${board}] | To Call: ${toCall}`);

    const start = Date.now();
    try {
      const action = await forwardToLocalBot(botUrl, state, timeoutMs);
      const latencyMs = Date.now() - start;

      const actStr = action?.action?.toUpperCase() || 'UNKNOWN';
      const amtStr = action?.amount !== undefined ? ` ${action.amount} chips` : '';
      console.log(`[${timeStr}] ⚡ Decided in ${latencyMs}ms -> ${actStr}${amtStr}`);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'turn_response',
          requestId,
          action
        }));
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      console.error(`[${timeStr}] ❌ Local bot error after ${latencyMs}ms: ${err.message}`);
      
      // Send fallback check or fold so hand does not stall
      if (ws && ws.readyState === WebSocket.OPEN) {
        const canCheck = (state?.legalActions || []).some((a: any) => a.action === 'check');
        const fallback = canCheck ? { action: 'check' } : { action: 'fold' };
        ws.send(JSON.stringify({
          type: 'turn_response',
          requestId,
          action: fallback
        }));
      }
    }
  }

  // Graceful shutdown
  const cleanup = () => {
    shouldExit = true;
    console.log('\n👋 Closing FeedMeBots CLI Bridge...');
    if (ws) {
      try { ws.close(); } catch {}
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  connect();
}

/**
 * Forwards the Game State payload to the user's local HTTP bot endpoint.
 */
function forwardToLocalBot(targetUrl: string, state: any, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const payload = JSON.stringify(state);

    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'FeedMeBots-CLI-Bridge/1.0',
        'X-FeedMeBots-Bridge': 'true'
      },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(body);
            resolve(data);
          } catch (e: any) {
            reject(new Error(`Local bot response was not valid JSON: ${body.slice(0, 100)}`));
          }
        } else {
          reject(new Error(`Local bot returned HTTP ${res.statusCode}: ${body.slice(0, 100)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Local bot timed out after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(new Error(`Connection to local bot failed (${targetUrl}): ${err.message}`));
    });

    req.write(payload);
    req.end();
  });
}
