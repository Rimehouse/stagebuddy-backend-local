import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { songsRoutes } from './routes/songs.js';
import { liveRoutes } from './routes/live.js';
import { sessionsRoutes } from './routes/sessions.js';
import { scoresRoutes } from './routes/scores.js';
import { settingsRoutes } from './routes/settings.js';
import { fansRoutes } from './routes/fans.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'), false);
  },
  credentials: true
});

await app.register(jwt, {
  secret: env.JWT_SECRET,
  sign: { expiresIn: '7d' }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof ZodError) {
    return reply.code(400).send({ message: '请求参数不合法', issues: error.flatten() });
  }
  if ((error as { code?: string }).code === 'P2002') {
    return reply.code(409).send({ message: '数据已存在' });
  }
  return reply.code(500).send({ message: '服务器内部错误' });
});

app.get('/api/health', async () => ({ ok: true, name: 'stagebuddy-backend-local' }));

await app.register(authRoutes);
await app.register(syncRoutes);
await app.register(songsRoutes);
await app.register(liveRoutes);
await app.register(sessionsRoutes);
await app.register(scoresRoutes);
await app.register(settingsRoutes);
await app.register(fansRoutes);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
