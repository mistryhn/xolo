import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({
  path: '../../.env',
})

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(5),
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  ICE_SERVERS: z.string().default('[{"urls":"stun:stun.l.google.com:19302"}]'),
})

export const env = envSchema.parse(process.env)
export const iceServers = z
  .array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  )
  .parse(JSON.parse(env.ICE_SERVERS))
export const hasTurnServer = iceServers.some((server) =>
  (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) =>
    /^(turn|turns):/i.test(url),
  ),
)
