import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';

export const scoresRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/performance', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ songId: z.string().optional() }).parse(request.query);
    return prisma.performanceLog.findMany({
      where: { userId: request.user.userId, ...(query.songId ? { songId: query.songId } : {}) },
      orderBy: [{ createdAt: 'desc' }]
    });
  });

  app.post('/api/performance', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ songId: z.string().optional(), liveShowId: z.string().optional(), reactionScore: z.number().int().min(1).max(5), callScore: z.number().int().min(1).max(5), selfScore: z.number().int().min(1).max(5) }).parse(request.body);
    const item = await prisma.performanceLog.create({ data: { userId: request.user.userId, ...body } });
    reply.code(201);
    return item;
  });

  app.get('/api/reflection', { preHandler: requireAuth }, async (request) => {
    return prisma.reflectionScore.findMany({ where: { userId: request.user.userId }, orderBy: [{ key: 'asc' }] });
  });

  app.put('/api/reflection/:key', { preHandler: requireAuth }, async (request) => {
    const params = z.object({ key: z.string().min(1) }).parse(request.params);
    const body = z.object({ score: z.number().int().min(1).max(5), note: z.string().optional().default('') }).parse(request.body);
    return prisma.reflectionScore.upsert({
      where: { userId_key: { userId: request.user.userId, key: params.key } },
      create: { userId: request.user.userId, key: params.key, score: body.score, note: body.note },
      update: { score: body.score, note: body.note }
    });
  });

  app.delete('/api/reflection/:key', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ key: z.string().min(1) }).parse(request.params);
    await prisma.reflectionScore.deleteMany({ where: { userId: request.user.userId, key: params.key } });
    reply.code(204).send();
  });
};
