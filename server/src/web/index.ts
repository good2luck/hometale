import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import memoryRoutes from './routes/memory.js';
import weixinRoutes from './routes/weixin.js';
import { ensureHometaleStructure } from '../lib/hometale-path.js';
import { loadConfig } from '../lib/config.js';
import { HomeTaleWebSocketServer } from '../websocket/server.js';
import {
  startMemorySummarizerCron,
  stopMemorySummarizerCron
} from '../cron/scheduler.js';
import {
  initGateway,
  startAllEnabledAccounts,
  stopAllAccounts,
} from '../weixin/gateway.js';
import { loadRegisteredAccounts } from '../weixin/accounts.js';

// Patch console to prepend timestamp (YYYY-MM-DD HH:mm:ss) to every log line
{
  const ts = () => new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origDebug = console.debug;
  console.log = (...args: any[]) => origLog(ts(), ...args);
  console.error = (...args: any[]) => origError(ts(), ...args);
  console.warn = (...args: any[]) => origWarn(ts(), ...args);
  console.debug = (...args: any[]) => origDebug(ts(), ...args);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/weixin', weixinRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from the React app build
const staticPath = path.join(__dirname, '../../static');
app.use(express.static(staticPath));

// Catch-all handler: send back React's index.html for any non-API routes
app.get('*', (_req, res) => {
  const indexPath = path.join(staticPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      // If index.html doesn't exist yet (dev mode), just send a message
      res.status(404).json({
        error: 'Static files not found. Build the web app first.',
        message: 'Run: cd web && npm run build'
      });
    }
  });
});

async function bootstrap() {
  await ensureHometaleStructure();

  // Load config
  const config = await loadConfig();
  console.log(`Config loaded, token: ${config.token ? '***' : 'not set'}`);

  // Setup WebSocket server
  const wsServer = new HomeTaleWebSocketServer(config);
  wsServer.attachToServer(server);

  // Initialize Weixin Gateway
  await initGateway();
  loadRegisteredAccounts();
  await startAllEnabledAccounts(config);
  console.log('[Weixin] Gateway initialized');

  // Start memory summarizer cron jobs
  startMemorySummarizerCron();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Server] SIGTERM received, shutting down gracefully...');
    stopMemorySummarizerCron();
    await stopAllAccounts();
    server.close(() => {
      console.log('[Server] HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', async () => {
    console.log('[Server] SIGINT received, shutting down gracefully...');
    stopMemorySummarizerCron();
    await stopAllAccounts();
    server.close(() => {
      console.log('[Server] HTTP server closed');
      process.exit(0);
    });
  });

  server.listen(PORT, () => {
    console.log(`HomeTale server running on http://localhost:${PORT}`);
    console.log(`Data directory: ~/.hometale/`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Is another HomeTale instance running?`);
      console.error(`Run "hometale stop" or kill the process manually.`);
      process.exit(1);
    }
    throw err;
  });
}

bootstrap();
