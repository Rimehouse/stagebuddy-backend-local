import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../lib/auth.js';
import { ensureCurrentLive, ensureUserDefaults } from '../utils/stagebuddy.js';

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings', { preHandler: requireAuth }, async (request) => {
    await ensureUserDefaults(request.user.userId);
    const [settings, condition, checks, live] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId: request.user.userId } }),
      prisma.userCondition.findUnique({ where: { userId: request.user.userId } }),
      prisma.idolCheck.findMany({ where: { userId: request.user.userId } }),
      ensureCurrentLive(request.user.userId)
    ]);

    return {
      settings,
      condition: condition?.value ?? null,
      idolChecks: Object.fromEntries(checks.map((item) => [item.key, item.checked])),
      liveReviews: live.reviews
    };
  });

  app.put('/api/settings', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ gentleRemind: z.boolean().optional(), recoveryEntry: z.boolean().optional(), themeIdx: z.number().int().nonnegative().optional() }).parse(request.body);
    return prisma.userSettings.upsert({
      where: { userId: request.user.userId },
      create: { userId: request.user.userId, gentleRemind: body.gentleRemind ?? true, recoveryEntry: body.recoveryEntry ?? true, themeIdx: body.themeIdx ?? 0 },
      update: body
    });
  });

  app.put('/api/condition', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ condition: z.string().nullable() }).parse(request.body);
    return prisma.userCondition.upsert({
      where: { userId: request.user.userId },
      create: { userId: request.user.userId, value: body.condition },
      update: { value: body.condition }
    });
  });

  app.put('/api/idol-checks', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ checks: z.record(z.boolean()) }).parse(request.body);
    const entries = Object.entries(body.checks);
    await prisma.$transaction(async (tx) => {
      for (const [key, checked] of entries) {
        await tx.idolCheck.upsert({
          where: { userId_key: { userId: request.user.userId, key } },
          create: { userId: request.user.userId, key, checked },
          update: { checked }
        });
      }
    });
    return { checks: body.checks };
  });
};
