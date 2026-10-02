import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { env } from './config/env.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { authRoutes } from './modules/auth/routes.js'
import { chatRoutes } from './modules/chat/routes.js'
import { attachSockets } from './sockets/index.js'
import { pool } from './db/drizzle.js'
import type { Server as SocketServer } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@xolo/protocol'

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketServer<ClientToServerEvents, ServerToClientEvents>
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
app.decorate('io', attachSockets(app))
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(chatRoutes, { prefix: '/api/chats' })
app.addHook('onClose', async () => {
  await pool.end()
})
await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
