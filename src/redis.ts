import { Redis } from 'ioredis';
import { config } from './config.js';

export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });

// Idempotência por chave: SET NX com TTL. Retorna true se for a PRIMEIRA vez.
// Padrão: "claim" antes de processar; se falhar, libera (release) para a retentativa passar.
export async function claim(key: string, ttlSeconds = 24 * 3600): Promise<boolean> {
  const ok = await redis.set(`idem:${key}`, '1', 'EX', ttlSeconds, 'NX');
  return ok === 'OK';
}

export async function release(key: string): Promise<void> {
  await redis.del(`idem:${key}`);
}
