import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3300),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET 至少 32 个字符'),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('环境变量校验失败');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((v) => v.trim()).filter(Boolean)
};
