import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { buildPullPayload, ensureCurrentLive, ensureUserDefaults, normalizeSongStatus, relativePracticeText, toJson } from '../utils/stagebuddy.js';

const syncSongSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().min(1),
  status: z.string().optional(),
  note: z.string().optional().default(''),
  practiceCount: z.number().int().nonnegative().optional().default(0),
  retryCount: z.number().int().nonnegative().optional().default(0),
  passCount: z.number().int().nonnegative().optional().default(0),
  callGuide: z.string().optional().default(''),
  callHints: z.array(z.object({ time: z.number(), text: z.string() })).optional().default([]),
  mcKeywords: z.array(z.string()).optional().default([]),
  nextSongId: z.union([z.string(), z.number(), z.null()]).optional().default(null),
  lastPractice: z.string().optional().default('刚刚'),
  lastPracticeAt: z.number().nullable().optional().default(null)
});

const syncSchema = z.object({
  songs: z.array(syncSongSchema).default([]),
  nextLive: z.object({
    name: z.string().default('未命名 Live'),
    date: z.string().default(''),
    venue: z.string().default(''),
    setlist: z.array(z.object({ role: z.string().optional().default(''), song: z.string().min(1) })).default([]),
    fanNotes: z.array(z.object({
      name: z.string().min(1),
      tag: z.string().optional().default(''),
      note: z.string().optional().default(''),
      lastSeen: z.string().optional().default('')
    })).default([]),
    reviews: z.array(z.object({
      feeling: z.string().nullable().optional(),
      buppan: z.object({ cheki: z.number().int().nonnegative().default(0), sign: z.number().int().nonnegative().default(0) }).optional().default({ cheki: 0, sign: 0 }),
      note: z.string().optional().default('')
    })).default([])
  }),
  trainingSessions: z.array(z.object({
    id: z.union([z.string(), z.number()]).optional(),
    songId: z.string().nullable().optional(),
    songTitle: z.string().min(1),
    startedAt: z.number(),
    endedAt: z.number().nullable().optional(),
    duration: z.number().int().nonnegative().default(0),
    passes: z.number().int().nonnegative().default(0),
    retries: z.number().int().nonnegative().default(0),
    events: z.array(z.any()).default([])
  })).default([]),
  settings: z.object({
    gentleRemind: z.boolean().default(true),
    recoveryEntry: z.boolean().default(true)
  }).default({ gentleRemind: true, recoveryEntry: true }),
  idolChecks: z.record(z.boolean()).default({}),
  condition: z.string().nullable().default(null),
  performanceLogs: z.array(z.object({
    songId: z.string().nullable().optional(),
    liveShowId: z.string().nullable().optional(),
    reactionScore: z.number().int().min(1).max(5),
    callScore: z.number().int().min(1).max(5),
    selfScore: z.number().int().min(1).max(5)
  })).default([]),
  reflectionScores: z.record(z.object({ score: z.number().int().min(0).max(5), note: z.string().optional().default('') })).default({}),
  themeIdx: z.number().int().nonnegative().default(0)
});

export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/sync/pull', { preHandler: requireAuth }, async (request) => {
    return buildPullPayload(request.user.userId);
  });

  app.post('/api/sync/push', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.userId;
    const payload = syncSchema.parse(request.body);
    await ensureUserDefaults(userId);
    const currentLive = await ensureCurrentLive(userId);

    await prisma.$transaction(async (tx) => {
      await tx.userSettings.upsert({
        where: { userId },
        create: { userId, ...payload.settings, themeIdx: payload.themeIdx },
        update: { ...payload.settings, themeIdx: payload.themeIdx }
      });

      await tx.userCondition.upsert({
        where: { userId },
        create: { userId, value: payload.condition },
        update: { value: payload.condition }
      });

      const existingSongs = await tx.song.findMany({ where: { userId } });
      const existingByLegacy = new Map(existingSongs.map((s) => [s.legacyId ?? '', s]));
      const existingByTitle = new Map(existingSongs.map((s) => [s.title, s]));

      for (const song of payload.songs) {
        const legacyId = song.id !== undefined ? String(song.id) : null;
        const target = (legacyId ? existingByLegacy.get(legacyId) : undefined) ?? existingByTitle.get(song.title);
        const data = {
          title: song.title,
          status: normalizeSongStatus(song.status),
          note: song.note,
          callGuide: song.callGuide,
          callHints: toJson(song.callHints),
          mcKeywords: toJson(song.mcKeywords),
          practiceCount: song.practiceCount,
          retryCount: song.retryCount,
          passCount: song.passCount,
          nextSongId: song.nextSongId == null ? null : String(song.nextSongId),
          lastPracticeAt: song.lastPracticeAt == null ? null : BigInt(song.lastPracticeAt),
          lastPractice: song.lastPracticeAt ? relativePracticeText(song.lastPracticeAt) : song.lastPractice,
          legacyId
        };
        if (target) {
          await tx.song.update({ where: { id: target.id }, data });
        } else {
          await tx.song.create({ data: { userId, ...data } });
        }
      }

      await tx.liveShow.update({
        where: { id: currentLive.id },
        data: {
          name: payload.nextLive.name,
          date: payload.nextLive.date,
          venue: payload.nextLive.venue
        }
      });
      await tx.setlistItem.deleteMany({ where: { liveShowId: currentLive.id } });
      await tx.liveReview.deleteMany({ where: { liveShowId: currentLive.id } });
      await tx.fanNote.deleteMany({ where: { liveShowId: currentLive.id } });

      if (payload.nextLive.setlist.length > 0) {
        await tx.setlistItem.createMany({
          data: payload.nextLive.setlist.map((item, index) => ({ liveShowId: currentLive.id, role: item.role, song: item.song, order: index }))
        });
      }
      if (payload.nextLive.reviews.length > 0) {
        await tx.liveReview.createMany({
          data: payload.nextLive.reviews.map((item) => ({ liveShowId: currentLive.id, feeling: item.feeling ?? null, buppan: toJson(item.buppan), note: item.note }))
        });
      }
      if (payload.nextLive.fanNotes.length > 0) {
        await tx.fanNote.createMany({
          data: payload.nextLive.fanNotes.map((item) => ({ liveShowId: currentLive.id, name: item.name, tag: item.tag, note: item.note, lastSeen: item.lastSeen }))
        });
      }

      await tx.trainingSession.deleteMany({ where: { userId } });
      if (payload.trainingSessions.length > 0) {
        await tx.trainingSession.createMany({
          data: payload.trainingSessions.map((item) => ({
            userId,
            legacyId: item.id != null ? String(item.id) : null,
            songId: item.songId ?? null,
            songTitle: item.songTitle,
            startedAt: BigInt(item.startedAt),
            endedAt: item.endedAt == null ? null : BigInt(item.endedAt),
            duration: item.duration,
            passes: item.passes,
            retries: item.retries,
            events: toJson(item.events)
          }))
        });
      }

      await tx.performanceLog.deleteMany({ where: { userId } });
      if (payload.performanceLogs.length > 0) {
        await tx.performanceLog.createMany({
          data: payload.performanceLogs.map((item) => ({ userId, ...item }))
        });
      }

      await tx.reflectionScore.deleteMany({ where: { userId } });
      const reflectionEntries = Object.entries(payload.reflectionScores).filter(([, value]) => value.score > 0);
      if (reflectionEntries.length > 0) {
        await tx.reflectionScore.createMany({
          data: reflectionEntries.map(([key, value]) => ({ userId, key, score: value.score, note: value.note }))
        });
      }

      await tx.idolCheck.deleteMany({ where: { userId } });
      const idolEntries = Object.entries(payload.idolChecks);
      if (idolEntries.length > 0) {
        await tx.idolCheck.createMany({
          data: idolEntries.map(([key, checked]) => ({ userId, key, checked }))
        });
      }
    });

    return buildPullPayload(userId);
  });
};
