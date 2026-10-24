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
    void (async () => {
      const { redis } = await import('../redis/client.js')
      const key = `presence:sockets:${userId}`
      const members = await redis.sMembers(key)
      if (members.length) {
        const live = await io.in(`user:${userId}`).fetchSockets()
        const liveIds = new Set(live.map((s) => s.id))
        const stale = members.filter((id) => !liveIds.has(id))
        if (stale.length) await redis.sRem(key, stale)
      }
    })()
    void markOnline(userId, socket.id)
      .then(async (firstConnection) => {
        const { redis } = await import('../redis/client.js')
        const key = `presence:sockets:${userId}`
        const count = await redis.sCard(key)
        if (firstConnection || count >= 1) {
          const recipients = await presenceRecipients(userId)
          if (recipients.length)
            io.to(recipients.map((id) => `user:${id}`)).emit('presence:update', {
              userId,
              online: true,
              lastSeenAt: null,
            })
        }
      })
      .catch((error) => console.error('[presence] online failed', error))
    let disconnected = false
    const offlineTimers = new Map<string, NodeJS.Timeout>()
    const refreshTimer = setInterval(async () => {
      try {
        const sockets = await io.in(`user:${userId}`).fetchSockets()
        const live = sockets.some((s) => s.id === socket.id)
        if (!live || disconnected) {
          clearInterval(refreshTimer)
          if (!disconnected) {
            disconnected = true
            const { redis } = await import('../redis/client.js')
            const key = `presence:sockets:${userId}`
            const members = await redis.sMembers(key)
            const liveIds = new Set(sockets.map((s) => s.id))
            const stale = members.filter((id) => !liveIds.has(id))
            if (stale.length) await redis.sRem(key, stale)
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
        const { redis } = await import('../redis/client.js')
        const key = `presence:sockets:${userId}`
        const members = await redis.sMembers(key)
        const liveIds = new Set(sockets.map((s) => s.id))
        const stale = members.filter((id) => !liveIds.has(id))
        if (stale.length) await redis.sRem(key, stale)
      } catch (error) {
        console.error('[presence] refresh failed', error)
      }
    }, 10000)
    const scheduleOffline = (delay: number) => {
      if (disconnected) return
      clearInterval(refreshTimer)
      const existing = offlineTimers.get(socket.id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        void io
          .in(`user:${userId}`)
          .fetchSockets()
          .then(async (sockets) => {
            if (sockets.length > 0 || disconnected) return
            disconnected = true
            const { redis } = await import('../redis/client.js')
            const key = `presence:sockets:${userId}`
            const members = await redis.sMembers(key)
            const liveIds = new Set(sockets.map((s) => s.id))
            const stale = members.filter((id) => !liveIds.has(id))
            if (stale.length) await redis.sRem(key, stale)
            const { offline, lastSeenAt } = await markOffline(userId, socket.id)
            if (offline) {
              const recipients = await presenceRecipients(userId)
              if (recipients.length)
                io.to(recipients.map((id) => `user:${id}`)).emit('presence:update', {
                  userId,
                  online: false,
                  lastSeenAt,
                })
            }
          })
          .catch((error) => console.error('[presence] offline failed', error))
      }, delay)
      offlineTimers.set(socket.id, timer)
    }
    socket.on('disconnect', (reason) => {
      scheduleOffline(reason === 'client namespace disconnect' ? 0 : 5000)
    })
    socket.on('error', () => {
      const timer = offlineTimers.get(socket.id)
      if (timer) {
        clearTimeout(timer)
        offlineTimers.delete(socket.id)
      }
    })
    registerChatSocket(io, socket as never)
  })
  return io
}
