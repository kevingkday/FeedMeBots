import http from 'node:http';
import { Action, PlayerGameStateV1 } from '@feedmebots/engine';

/**
 * Your bot's only job:
 * "Here is the game state, what is your move?"
 */
export function decide(state: PlayerGameStateV1): Action {
  const { legalActions, toCall, holeCards } = state;

  console.log(`[Bot Decision] Stage: ${state.stage}, Hole Cards: ${holeCards.join(' ')}, To Call: ${toCall}`);

  const canCheck = legalActions.some(a => a.action === 'check');
  const canCall = legalActions.some(a => a.action === 'call');
  const canRaise = legalActions.some(a => a.action === 'raise');

  // If we can check for free, check
  if (canCheck) {
    return { action: 'check' };
  }

  // If cheap to call (less than or equal to 1 big blind), call
  if (canCall && toCall <= state.bigBlind) {
    return { action: 'call' };
  }

  // If we have an Ace or King, call moderate bets or make a standard raise
  const hasHighCard = holeCards.some(c => c.startsWith('A') || c.startsWith('K'));
  if (hasHighCard) {
    if (canRaise && state.minRaiseTo !== null) {
      return { action: 'raise', amount: state.minRaiseTo };
    }
    if (canCall) {
      return { action: 'call' };
    }
  }

  // Default to fold if facing aggression without strong cards
  return { action: 'fold' };
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4001;

export function createBotServer(port = PORT) {
  const srv = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const state: PlayerGameStateV1 = JSON.parse(body);
          const action = decide(state);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(action));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('FeedMeBots TypeScript Starter Bot is running!');
    }
  });

  return srv;
}

export const server = createBotServer(PORT);

if (process.argv[1] && (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'))) {
  server.listen(PORT, () => {
    console.log(`🤖 FeedMeBots TS Bot listening on http://localhost:${PORT}`);
  });
}
