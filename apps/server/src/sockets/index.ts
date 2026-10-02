import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '@xolo/protocol'
import { registerChatSocket } from '../modules/chat/socket.js'
import { env } from '../config/env.js'

export function attachSockets(app: FastifyInstance) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: { origin: env.WEB_ORIGIN },
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token
      const payload = await app.jwt.verify<{ sub: string }>(token)
      socket.data.userId = payload.sub
      next()
    } catch {
      next(new Error('Unauthorized'))
    }
  })
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`)
    registerChatSocket(io, socket as never)
  })
  return io
}
