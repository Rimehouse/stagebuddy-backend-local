import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { cycleSongStatus, fromJson, normalizeSongStatus, relativePracticeText, toJson } from '../utils/stagebuddy.js';

const songBodySchema = z.object({
  title: z.string().min(1),
  note: z.string().optional(),
  callGuide: z.string().optional(),
  callHints: z.array(z.object({ time: z.number(), text: z.string() })).optional(),
  mcKeywords: z.array(z.string()).optional(),
  status: z.string().optional(),
  nextSongId: z.string().nullable().optional()
});

function parseSong(item: Record<string, unknown>) {
  return { ...item, callHints: fromJson(item.callHints as string, []), mcKeywords: fromJson(item.mcKeywords as string, []) };
}

export const songsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/songs', { preHandler: requireAuth }, async (request) => {
    const songs = await prisma.song.findMany({ where: { userId: request.user.userId }, orderBy: [{ createdAt: 'asc' }] });
    return songs.map(parseSong);
  });

  app.post('/api/songs', { preHandler: requireAuth }, async (request, reply) => {
    const body = songBodySchema.parse(request.body);
    const item = await prisma.song.create({
      data: {
        userId: request.user.userId,
        title: body.title,
        note: body.note ?? '',
        callGuide: body.callGuide ?? '',
        callHints: toJson(body.callHints ?? []),
        mcKeywords: toJson(body.mcKeywords ?? []),
        nextSongId: body.nextSongId ?? null,
        status: normalizeSongStatus(body.status)
      }
    });
    reply.code(201);
    return parseSong(item as unknown as Record<string, unknown>);
  });

  app.patch('/api/songs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = songBodySchema.partial().parse(request.body);
    const song = await prisma.song.findFirst({ where: { id: params.id, userId: request.user.userId } });
    if (!song) return reply.code(404).send({ message: '曲目不存在' });

    const updated = await prisma.song.update({
      where: { id: song.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.callGuide !== undefined ? { callGuide: body.callGuide } : {}),
        ...(body.callHints !== undefined ? { callHints: toJson(body.callHints) } : {}),
        ...(body.mcKeywords !== undefined ? { mcKeywords: toJson(body.mcKeywords) } : {}),
        ...(body.nextSongId !== undefined ? { nextSongId: body.nextSongId } : {}),
        ...(body.status !== undefined ? { status: normalizeSongStatus(body.status) } : {})
      }
    });
    return parseSong(updated as unknown as Record<string, unknown>);
  });

  app.delete('/api/songs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const song = await prisma.song.findFirst({ where: { id: params.id, userId: request.user.userId } });
    if (!song) return reply.code(404).send({ message: '曲目不存在' });
    await prisma.song.delete({ where: { id: song.id } });
    reply.code(204).send();
  });

  app.post('/api/songs/:id/cycle-status', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const song = await prisma.song.findFirst({ where: { id: params.id, userId: request.user.userId } });
    if (!song) return reply.code(404).send({ message: '曲目不存在' });
    const updated = await prisma.song.update({ where: { id: song.id }, data: { status: cycleSongStatus(song.status) } });
    return parseSong(updated as unknown as Record<string, unknown>);
  });

  app.post('/api/songs/:id/practice', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const song = await prisma.song.findFirst({ where: { id: params.id, userId: request.user.userId } });
    if (!song) return reply.code(404).send({ message: '曲目不存在' });
    const now = Date.now();
    const updated = await prisma.song.update({
      where: { id: song.id },
      data: {
        practiceCount: { increment: 1 },
        lastPracticeAt: BigInt(now),
        lastPractice: relativePracticeText(now)
      }
    });
    return parseSong(updated as unknown as Record<string, unknown>);
  });
};
