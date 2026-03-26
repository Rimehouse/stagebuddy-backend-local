import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ensureUserDefaults } from '../utils/stagebuddy.js';
import { requireAuth } from '../lib/auth.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(72)
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (exists) return reply.code(409).send({ message: '邮箱已存在' });

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: { email: body.email.toLowerCase(), passwordHash },
      select: { id: true, email: true }
    });
    await ensureUserDefaults(user.id);

    const accessToken = await reply.jwtSign({ userId: user.id, email: user.email });
    return { accessToken, user };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) return reply.code(401).send({ message: '邮箱或密码错误' });

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) return reply.code(401).send({ message: '邮箱或密码错误' });

    await ensureUserDefaults(user.id);
    const accessToken = await reply.jwtSign({ userId: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email } };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: { id: request.user.userId, email: request.user.email } };
  });
};
