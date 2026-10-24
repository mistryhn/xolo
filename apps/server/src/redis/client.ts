import { createClient } from 'redis'
import { env } from '../config/env.js'

export type RedisClient = ReturnType<typeof createClient>

export function createRedisClient() {
  const client = createClient({ url: env.REDIS_URL })
  client.on('error', (error) => console.error('[redis] error', error))
  return client
}

export const redis = createRedisClient()

export async function connectRedis() {
  if (!redis.isOpen) await redis.connect()
}

export async function disconnectRedis() {
  if (redis.isOpen) await redis.quit()
}
