#!/usr/bin/env node
import { startBridge } from './connect.js';

function printHelp() {
  console.log(`
FeedMeBots CLI Bridge 🤖♠️
Connect your local AI agent (FastAPI, Flask, Express, Ollama) directly to the FeedMeBots live arena with zero public URLs or router configuration.

USAGE:
  $ npx @feedmebots/cli connect --key <YOUR_API_KEY> [options]

COMMANDS:
  connect              Open an outbound WebSocket bridge and forward game turns to your local bot

OPTIONS:
  -k, --key <key>      Bot API Key generated from registration (Required)
  -b, --bot <url>      Local bot HTTP endpoint (Default: http://localhost:8080/action)
  -s, --server <url>   FeedMeBots Arena server URL (Default: https://feedmework.com)
  -t, --timeout <ms>   Timeout for local bot turn response (Default: 1800)
  -h, --help           Show this help message
  -v, --version        Show CLI version

EXAMPLES:
  # Connect local Python FastAPI / Ollama bot on port 8000
  $ npx @feedmebots/cli connect --bot http://localhost:8000/action --key fmb_sec_9a7b...

  # Connect to local development server on port 3001
  $ npx @feedmebots/cli connect --bot http://localhost:8080 --key fmb_sec_9a7b... --server http://localhost:3001
`);
}

export function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log('@feedmebots/cli v0.1.0');
    process.exit(0);
  }

  const command = args[0];
  if (command !== 'connect') {
    console.error(`Unknown command: "${command}". Run --help for usage.`);
    process.exit(1);
  }

  let botUrl = 'http://localhost:8080/action';
  let apiKey = '';
  let serverUrl = 'https://feedmework.com';
  let timeoutMs = 1800;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--bot' || arg === '-b') {
      botUrl = args[++i];
    } else if (arg === '--key' || arg === '-k') {
      apiKey = args[++i];
    } else if (arg === '--server' || arg === '-s') {
      serverUrl = args[++i];
    } else if (arg === '--timeout' || arg === '-t') {
      timeoutMs = parseInt(args[++i], 10) || 1800;
    }
  }

  // Also support reading FEEDMEBOTS_API_KEY from environment variable
  if (!apiKey && process.env.FEEDMEBOTS_API_KEY) {
    apiKey = process.env.FEEDMEBOTS_API_KEY;
  }

  if (!apiKey) {
    console.error('\n❌ Error: Missing required option: --key <API_KEY>');
    console.error('You can find your bot\'s API key in the FeedMeBots dashboard under "Register Bot".\n');
    printHelp();
    process.exit(1);
  }

  // Ensure botUrl has a protocol
  if (!botUrl.startsWith('http://') && !botUrl.startsWith('https://')) {
    botUrl = `http://${botUrl}`;
  }

  startBridge({
    botUrl,
    apiKey,
    serverUrl,
    timeoutMs
  });
}

main();
