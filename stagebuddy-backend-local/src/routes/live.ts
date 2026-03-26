import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { ensureCurrentLive } from '../utils/stagebuddy.js';

export const liveRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/live/current', { preHandler: requireAuth }, async (request) => {
    return ensureCurrentLive(request.user.userId);
  });

  app.put('/api/live/current', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ name: z.string(), date: z.string(), venue: z.string() }).parse(request.body);
    const live = await ensureCurrentLive(request.user.userId);
    return prisma.liveShow.update({ where: { id: live.id }, data: body, include: { setlist: { orderBy: { order: 'asc' } }, reviews: true, fanNotes: true } });
  });

  app.put('/api/live/current/setlist', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ setlist: z.array(z.object({ role: z.string().optional().default(''), songTitle: z.string().min(1) })) }).parse(request.body);
    const live = await ensureCurrentLive(request.user.userId);
    await prisma.$transaction(async (tx) => {
      await tx.setlistItem.deleteMany({ where: { liveShowId: live.id } });
      if (body.setlist.length > 0) {
        await tx.setlistItem.createMany({
          data: body.setlist.map((item, index) => ({ liveShowId: live.id, role: item.role, song: item.songTitle, order: index }))
        });
      }
    });
    return ensureCurrentLive(request.user.userId);
  });

  app.post('/api/live/current/review', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      feeling: z.string().nullable().optional(),
      buppan: z.object({ cheki: z.number().int().nonnegative().default(0), sign: z.number().int().nonnegative().default(0) }).optional().default({ cheki: 0, sign: 0 }),
      note: z.string().optional().default('')
    }).parse(request.body);
    const live = await ensureCurrentLive(request.user.userId);
    const review = await prisma.liveReview.create({ data: { liveShowId: live.id, feeling: body.feeling ?? null, buppan: body.buppan, note: body.note } });
    reply.code(201);
    return review;
  });

  app.get('/api/live/history', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    return prisma.liveShow.findMany({
      where: { userId: request.user.userId },
      include: { setlist: { orderBy: { order: 'asc' } }, reviews: true, fanNotes: true },
      orderBy: [{ updatedAt: 'desc' }],
      skip: query.offset,
      take: query.limit
    });
  });
};
