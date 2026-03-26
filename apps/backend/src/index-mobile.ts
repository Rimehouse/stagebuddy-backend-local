/**
 * Mobile entry point for @capacitor-community/capacitor-nodejs.
 * Replaces the standard index.ts (which requires .env + Prisma).
 *
 * Startup flow:
 *   1. Capacitor frontend sends { dataDir } via bridge channel "init"
 *   2. This script initialises the sql.js database at dataDir/stagebuddy.db
 *   3. Starts Fastify on 127.0.0.1:3300
 *   4. Sends "ready" event back to the frontend
 */

// @ts-ignore – nodejs-mobile bridge (injected at runtime)
const { channel } = require('bridge');

import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import path from 'node:path';

import { initDatabase, prisma as sqlPrisma } from './lib/sqljs-db.js';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { songsRoutes } from './routes/songs.js';
import { liveRoutes } from './routes/live.js';
import { sessionsRoutes } from './routes/sessions.js';
import { scoresRoutes } from './routes/scores.js';
import { settingsRoutes } from './routes/settings.js';
import { fansRoutes } from './routes/fans.js';

// Replace the Prisma singleton so all routes use sql.js
import * as prismaModule from './lib/prisma.js';
(prismaModule as any).prisma = sqlPrisma;

const PORT = 3300;
const HOST = '127.0.0.1';
const JWT_SECRET = 'stagebuddy-mobile-secret-key-do-not-share-32ch';

async function startServer(dataDir: string): Promise<void> {
  const dbPath = path.join(dataDir, 'stagebuddy.db');
  await initDatabase(dbPath);

  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: JWT_SECRET, sign: { expiresIn: '30d' } });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ message: '请求参数不合法', issues: error.flatten() });
    if ((error as any).code === 'P2002')
      return reply.code(409).send({ message: '数据已存在' });
    return reply.code(500).send({ message: '服务器内部错误' });
  });

  app.get('/api/health', async () => ({ ok: true, name: 'stagebuddy-mobile' }));

  await app.register(authRoutes);
  await app.register(syncRoutes);
  await app.register(songsRoutes);
  await app.register(liveRoutes);
  await app.register(sessionsRoutes);
  await app.register(scoresRoutes);
  await app.register(settingsRoutes);
  await app.register(fansRoutes);

  await app.listen({ port: PORT, host: HOST });
  channel.send('ready', PORT);
}

// Wait for Capacitor to send the data directory
// capacitor-nodejs bridge: listener receives variadic args (not wrapped in object)
channel.addListener('init', (dataDir: any) => {
  startServer(String(dataDir ?? '.')).catch((err: unknown) => {
    channel.send('error', String(err));
  });
});

// Signal that the script is loaded and waiting
channel.send('loaded');
