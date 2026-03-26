import type { FastifyReply, FastifyRequest } from 'fastify';

export type JwtUser = {
  userId: string;
  email: string;
};

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify<JwtUser>();
  } catch {
    reply.code(401).send({ message: '未授权' });
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}
