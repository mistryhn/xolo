import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '../../db/drizzle.js'
import { chatParticipants } from '../../db/schema/chats.js'
import { users } from '../../db/schema/users.js'
import { redis } from '../../redis/client.js'

const PRESENCE_TTL_SECONDS = 90
const TYPING_TTL_SECONDS = 5

const socketsKey = (userId: string) => `presence:sockets:${userId}`
const typingKey = (chatId: string, userId: string) => `typing:${chatId}:${userId}`

export async function markOnline(userId: string, socketId: string) {
  const key = socketsKey(userId)
  await redis.sAdd(key, socketId)
  const sockets = await redis.sCard(key)
  await redis.expire(key, PRESENCE_TTL_SECONDS)
  return sockets === 1
}

export async function refreshPresence(userId: string, socketId: string) {
  const key = socketsKey(userId)
  await redis.sAdd(key, socketId)
  await redis.expire(key, PRESENCE_TTL_SECONDS)
}

export async function markOffline(userId: string, socketId: string) {
  const key = socketsKey(userId)
  await redis.sRem(key, socketId)
  const sockets = await redis.sCard(key)
  if (sockets > 0) {
    await redis.expire(key, PRESENCE_TTL_SECONDS)
    return { offline: false, lastSeenAt: null }
  }
  await redis.del(key)
  const lastSeenAt = new Date()
  await db.update(users).set({ lastSeenAt }).where(eq(users.id, userId))
  return { offline: true, lastSeenAt: lastSeenAt.toISOString() }
}

export async function getOnlineStates(userIds: string[]) {
  if (!userIds.length) return new Map<string, boolean>()
  const results = await Promise.all(userIds.map((userId) => redis.exists(socketsKey(userId))))
  return new Map(userIds.map((userId, index) => [userId, results[index] === 1]))
}

export async function presenceRecipients(userId: string) {
  const memberships = await db
    .select({ chatId: chatParticipants.chatId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.userId, userId), isNull(chatParticipants.leftAt)))
  if (!memberships.length) return []
  const rows = await db
    .selectDistinct({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(
      and(
        inArray(
          chatParticipants.chatId,
          memberships.map(({ chatId }) => chatId),
        ),
        ne(chatParticipants.userId, userId),
        isNull(chatParticipants.leftAt),
      ),
    )
  return rows.map((row) => row.userId)
}

export async function startTyping(chatId: string, userId: string) {
  await redis.set(typingKey(chatId, userId), '1', { EX: TYPING_TTL_SECONDS })
}

export async function stopTyping(chatId: string, userId: string) {
  await redis.del(typingKey(chatId, userId))
}
