import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { fromJson, toJson } from '../utils/stagebuddy.js';

function parseSession(item: Record<string, unknown>) {
  return { ...item, events: fromJson(item.events as string, []) };
}

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/sessions', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const sessions = await prisma.trainingSession.findMany({
      where: { userId: request.user.userId },
      orderBy: [{ startedAt: 'desc' }],
      skip: query.offset,
      take: query.limit
    });
    return sessions.map(parseSession);
  });

  app.post('/api/sessions/start', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ songId: z.string().optional(), songTitle: z.string().min(1) }).parse(request.body);
    const startedAt = Date.now();
    const session = await prisma.trainingSession.create({
      data: {
        userId: request.user.userId,
        songId: body.songId,
        songTitle: body.songTitle,
        startedAt: BigInt(startedAt),
        events: toJson([{ type: 'start', ts: startedAt }])
      }
    });
    if (body.songId) {
      await prisma.song.updateMany({
        where: { id: body.songId, userId: request.user.userId },
        data: { practiceCount: { increment: 1 }, lastPracticeAt: BigInt(startedAt), lastPractice: '刚刚' }
      });
    }
    reply.code(201);
    return parseSession(session as unknown as Record<string, unknown>);
  });

  app.patch('/api/sessions/:id/end', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ duration: z.number().int().nonnegative(), passes: z.number().int().nonnegative(), retries: z.number().int().nonnegative(), events: z.array(z.any()).default([]) }).parse(request.body);
    const session = await prisma.trainingSession.findFirst({ where: { id: params.id, userId: request.user.userId } });
    if (!session) return reply.code(404).send({ message: '练习会话不存在' });
    const endedAt = Date.now();
    const updated = await prisma.trainingSession.update({
      where: { id: session.id },
      data: { duration: body.duration, passes: body.passes, retries: body.retries, events: toJson(body.events), endedAt: BigInt(endedAt) }
    });
    if (session.songId) {
      await prisma.song.updateMany({
        where: { id: session.songId, userId: request.user.userId },
        data: { passCount: { increment: body.passes }, retryCount: { increment: body.retries } }
      });
    }
    return parseSession(updated as unknown as Record<string, unknown>);
  });

  app.post('/api/sessions/:id/event', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ type: z.string().min(1), ts: z.number().optional(), payload: z.record(z.any()).optional() }).parse(request.body);
    const session = await prisma.trainingSession.findFirst({ where: { id: params.id, userId: request.user.userId } });
    if (!session) return reply.code(404).send({ message: '练习会话不存在' });
    const currentEvents = fromJson(session.events, []) as unknown[];
    const nextEvents = [...currentEvents, { type: body.type, ts: body.ts ?? Date.now(), payload: body.payload ?? {} }];
    const updated = await prisma.trainingSession.update({ where: { id: session.id }, data: { events: toJson(nextEvents) } });
    return parseSession(updated as unknown as Record<string, unknown>);
  });

  app.get('/api/sessions/stats/week', { preHandler: requireAuth }, async (request) => {
    const now = new Date();
    const monday = new Date(now);
    const dow = (now.getDay() + 6) % 7;
    monday.setDate(now.getDate() - dow);
    monday.setHours(0, 0, 0, 0);

    const sessions = await prisma.trainingSession.findMany({ where: { userId: request.user.userId, startedAt: { gte: BigInt(monday.getTime()) } }, orderBy: [{ startedAt: 'asc' }] });
    const totalSeconds = sessions.reduce((sum, item) => sum + item.duration, 0);
    const totalPasses = sessions.reduce((sum, item) => sum + item.passes, 0);
    const totalRetries = sessions.reduce((sum, item) => sum + item.retries, 0);

    const byDayMap = new Map<string, { minutes: number; passes: number }>();
    const bySongMap = new Map<string, { title: string; minutes: number }>();
    for (const item of sessions) {
      const day = new Date(Number(item.startedAt)).toISOString().slice(0, 10);
      const minutes = Math.round(item.duration / 60);
      const dayRow = byDayMap.get(day) ?? { minutes: 0, passes: 0 };
      dayRow.minutes += minutes;
      dayRow.passes += item.passes;
      byDayMap.set(day, dayRow);

      const songKey = item.songId ?? item.songTitle;
      const songRow = bySongMap.get(songKey) ?? { title: item.songTitle, minutes: 0 };
      songRow.minutes += minutes;
      bySongMap.set(songKey, songRow);
    }

    return {
      totalMinutes: Math.round(totalSeconds / 60),
      totalSessions: sessions.length,
      totalPasses,
      totalRetries,
      byDay: [...byDayMap.entries()].map(([date, value]) => ({ date, ...value })),
      topSongs: [...bySongMap.entries()].map(([songId, value]) => ({ songId, ...value })).sort((a, b) => b.minutes - a.minutes).slice(0, 5)
    };
  });
};
