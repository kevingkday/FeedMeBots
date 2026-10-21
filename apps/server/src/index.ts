import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from './db/db.js';
import { TableRunner } from './runner/table-runner.js';
import { registerRoutes } from './api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  const isDev = process.env.NODE_ENV !== 'production';
  const app = Fastify({
    logger: isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname'
            }
          }
        }
      : true
  });

  // Enable CORS
  await app.register(fastifyCors, {
    origin: true
  });

  // Serve static UI assets from public/
  const publicDir = path.resolve(__dirname, '..', 'public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/'
  });

  // Serve static JSON Schemas from docs/schemas/ (WSDL equivalent)
  const schemasDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'schemas');
  await app.register(fastifyStatic, {
    root: schemasDir,
    prefix: '/schemas/',
    decorateReply: false
  });

  // Initialize SQLite database schema
  initDatabase();
  console.log('📦 Database initialized.');

  // Initialize and start Table Runner
  const tableRunner = new TableRunner();
  tableRunner.start();

  // Register REST API routes
  registerRoutes(app, tableRunner);

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  const HOST = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n🎉 FeedMeBots Server & Web UI live at: http://localhost:${PORT}`);
    console.log(`📡 REST API & Webhooks ready.`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
