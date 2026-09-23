import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { env } from './config/env.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { authRoutes } from './modules/auth/routes.js'
import { geoRoutes } from './modules/geo/routes.js'
import { chatRoutes } from './modules/chat/routes.js'
import { attachSockets } from './sockets/index.js'
import { pool } from './db/drizzle.js'
import { redis } from './redis/client.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (
      request: import('fastify').FastifyRequest,
      reply: import('fastify').FastifyReply,
    ) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: { sub: string }
  }
}

const app = Fastify({ logger: true })
await app.register(cors, { origin: env.WEB_ORIGIN })
await app.register(jwt, { secret: env.JWT_SECRET })

app.decorate('authenticate', async (request) => {
  await request.jwtVerify()
})

registerErrorHandler(app)
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(geoRoutes, { prefix: '/api/zones' })
await app.register(chatRoutes, { prefix: '/api/chats' })
attachSockets(app)
app.addHook('onClose', async () => {
  await redis.quit()
  await pool.end()
})
await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
