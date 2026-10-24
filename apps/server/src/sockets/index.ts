import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import type { ClientToServerEvents, ServerToClientEvents } from '@xolo/protocol'
import { registerChatSocket } from '../modules/chat/socket.js'
import {
  markOffline,
  markOnline,
  presenceRecipients,
  refreshPresence,
} from '../modules/presence/service.js'
import { env } from '../config/env.js'
import { createRedisClient } from '../redis/client.js'

export async function attachSockets(app: FastifyInstance) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: { origin: env.WEB_ORIGIN },
  })
  const pubClient = createRedisClient()
  const subClient = createRedisClient()
  await Promise.all([pubClient.connect(), subClient.connect()])
  io.adapter(createAdapter(pubClient, subClient))
  app.addHook('onClose', async () => {
    await Promise.all([pubClient.quit(), subClient.quit()])
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
    const userId = socket.data.userId
    socket.join(`user:${userId}`)
    void markOnline(userId, socket.id)
      .then(async (firstConnection) => {
        if (!firstConnection) return
        const recipients = await presenceRecipients(userId)
        if (recipients.length)
          io.to(recipients.map((id) => `user:${id}`)).emit('presence:update', {
            userId,
            online: true,
            lastSeenAt: null,
          })
      })
      .catch((error) => console.error('[presence] online failed', error))
    let disconnected = false
    const refreshTimer = setInterval(async () => {
      try {
        const sockets = await io.in(`user:${userId}`).fetchSockets()
        if (!sockets.some((s) => s.id === socket.id) || disconnected) {
          clearInterval(refreshTimer)
          if (!disconnected) {
            disconnected = true
            const result = await markOffline(userId, socket.id)
            if (result.offline) {
              const recipients = await presenceRecipients(userId)
              if (recipients.length)
                io.to(recipients.map((id) => `user:${id}`)).emit('presence:update', {
                  userId,
                  online: false,
                  lastSeenAt: result.lastSeenAt,
                })
            }
          }
          return
        }
        await refreshPresence(userId, socket.id)
      } catch (error) {
        console.error('[presence] refresh failed', error)
      }
    }, 10_000)
    socket.on('disconnect', () => {
      if (disconnected) return
      disconnected = true
      clearInterval(refreshTimer)
      void markOffline(userId, socket.id)
        .then(async ({ offline, lastSeenAt }) => {
          if (!offline) return
          const recipients = await presenceRecipients(userId)
          if (recipients.length)
            io.to(recipients.map((id) => `user:${id}`)).emit('presence:update', {
              userId,
              online: false,
              lastSeenAt,
            })
        })
        .catch((error) => console.error('[presence] offline failed', error))
    })
    registerChatSocket(io, socket as never)
  })
  return io
}
