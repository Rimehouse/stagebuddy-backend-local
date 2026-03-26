import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { ensureCurrentLive } from '../utils/stagebuddy.js';

export const fansRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/fans', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ liveShowId: z.string().optional() }).parse(request.query);
    const currentLive = query.liveShowId ? null : await ensureCurrentLive(request.user.userId);
    const liveShowId = query.liveShowId ?? currentLive?.id;
    return prisma.fanNote.findMany({
      where: {
        liveShow: { userId: request.user.userId },
        ...(liveShowId ? { liveShowId } : {})
      },
      orderBy: [{ createdAt: 'desc' }]
    });
  });

  app.post('/api/fans', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ liveShowId: z.string().optional(), name: z.string().min(1), tag: z.string().optional().default(''), note: z.string().optional().default(''), lastSeen: z.string().optional().default('') }).parse(request.body);
    const currentLive = body.liveShowId ? null : await ensureCurrentLive(request.user.userId);
    if (body.liveShowId) {
      const live = await prisma.liveShow.findFirst({ where: { id: body.liveShowId, userId: request.user.userId } });
      if (!live) return reply.code(404).send({ message: 'Live 不存在' });
    }
    const item = await prisma.fanNote.create({ data: { liveShowId: body.liveShowId ?? currentLive!.id, name: body.name, tag: body.tag, note: body.note, lastSeen: body.lastSeen } });
    reply.code(201);
    return item;
  });

  app.patch('/api/fans/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(1).optional(), tag: z.string().optional(), note: z.string().optional(), lastSeen: z.string().optional() }).parse(request.body);
    const fan = await prisma.fanNote.findUnique({ where: { id: params.id }, include: { liveShow: true } });
    if (!fan || fan.liveShow.userId !== request.user.userId) return reply.code(404).send({ message: '粉丝记录不存在' });
    return prisma.fanNote.update({ where: { id: fan.id }, data: body });
  });

  app.delete('/api/fans/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const fan = await prisma.fanNote.findUnique({ where: { id: params.id }, include: { liveShow: true } });
    if (!fan || fan.liveShow.userId !== request.user.userId) return reply.code(404).send({ message: '粉丝记录不存在' });
    await prisma.fanNote.delete({ where: { id: fan.id } });
    reply.code(204).send();
  });
};
