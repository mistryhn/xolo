import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import {
  coordinatesSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@xolo/protocol'
import { zoneFor } from '../modules/geo/service.js'
import { touchPresence } from '../redis/client.js'
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
    socket.on('zone:join', async (coords, ack) => {
      try {
        const zoneKey = zoneFor(coordinatesSchema.parse(coords))
        await touchPresence(socket.data.userId, zoneKey)
        socket.join(`zone:${zoneKey}`)
        const count = io.sockets.adapter.rooms.get(`zone:${zoneKey}`)?.size ?? 0
        io.to(`zone:${zoneKey}`).emit('presence:update', { zoneKey, count })
        ack({ zoneKey })
      } catch {
        ack({ error: 'Invalid location' })
      }
    })
    registerChatSocket(io, socket as never)
  })
  return io
}
