import type { FastifyInstance } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { createChatSchema } from '@xolo/protocol'
import { chats, chatParticipants, messages } from '../../db/schema/chats.js'
import { db } from '../../db/drizzle.js'
import { createChat, joinChat } from './service.js'

export async function chatRoutes(app: FastifyInstance) {
  app.get('/', { onRequest: [app.authenticate] }, async () => ({
    data: await db
      .select()
      .from(chats)
      .where(eq(chats.status, 'open'))
      .orderBy(desc(chats.createdAt)),
  }))
  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { zoneKey } = request.body as { zoneKey: string }
    const chat = await createChat(request.user.sub, zoneKey, createChatSchema.parse(request.body))
    return reply.status(201).send({ data: chat })
  })
  app.post('/:chatId/join', { onRequest: [app.authenticate] }, async (request) => ({
    data: await joinChat((request.params as { chatId: string }).chatId, request.user.sub),
  }))
  app.get('/:chatId/messages', { onRequest: [app.authenticate] }, async (request) => {
    const chatId = (request.params as { chatId: string }).chatId
    const member = await db
      .select()
      .from(chatParticipants)
      .where(
        and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.userId, request.user.sub)),
      )
      .limit(1)
    if (!member[0]) return { error: { code: 'FORBIDDEN', message: 'Not a participant' } }
    return {
      data: await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(messages.createdAt),
    }
  })
}
