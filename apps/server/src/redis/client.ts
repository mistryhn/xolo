import { Redis } from 'ioredis';
import { env } from '../config/env.js';
export const redis = new Redis(env.REDIS_URL);
export async function touchPresence(userId: string, zoneKey: string) { await redis.set(`presence:${userId}`, zoneKey, 'EX', 90); await redis.sadd(`zone:${zoneKey}:users`, userId); await redis.expire(`zone:${zoneKey}:users`, 120); }
