import type { FastifyInstance } from 'fastify'
import { and, desc, eq, ilike, inArray, isNull, or, ne } from 'drizzle-orm'
import { createChatSchema, reactionSchema, sendMessageSchema } from '@xolo/protocol'
import {
  chats,
  chatParticipants,
  messages,
  reactions as chatReactions,
} from '../../db/schema/chats.js'
import { users } from '../../db/schema/users.js'
import { db } from '../../db/drizzle.js'
import { addMessage, createChat, joinChat, participant, toggleReaction } from './service.js'

export async function chatRoutes(app: FastifyInstance) {
  app.get('/contacts', { onRequest: [app.authenticate] }, async (request) => {
    const { search = '' } = request.query as { search?: string }
    const query = search.trim()
    if (!query) return { data: [] }
    const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    return {
      data: await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            ne(users.id, request.user.sub),
            or(ilike(users.name, pattern), ilike(users.email, pattern)),
          ),
        )
        .orderBy(users.name)
        .limit(30),
    }
  })

  app.get('/', { onRequest: [app.authenticate] }, async (request) => {
    const memberships = await db
      .select({ chatId: chatParticipants.chatId })
      .from(chatParticipants)
      .where(and(eq(chatParticipants.userId, request.user.sub), isNull(chatParticipants.leftAt)))
    const joinedIds = memberships.map(({ chatId }) => chatId)
    if (!joinedIds.length) return { data: [] }
    const chatRows = await db
      .select()
      .from(chats)
      .where(and(eq(chats.type, 'private'), inArray(chats.id, joinedIds)))
      .orderBy(desc(chats.createdAt))
    if (!chatRows.length) return { data: [] }
    const chatIds = chatRows.map((chat) => chat.id)
    const members = await db
      .select({ chatId: chatParticipants.chatId, userId: users.id, name: users.name })
      .from(chatParticipants)
      .innerJoin(users, eq(users.id, chatParticipants.userId))
      .where(and(inArray(chatParticipants.chatId, chatIds), isNull(chatParticipants.leftAt)))
    const latestMessages = await db
      .select()
      .from(messages)
      .where(inArray(messages.chatId, chatIds))
      .orderBy(desc(messages.createdAt))
    const lastByChat = new Map<string, (typeof latestMessages)[number]>()
    for (const message of latestMessages) {
      if (!lastByChat.has(message.chatId)) lastByChat.set(message.chatId, message)
    }
    return {
      data: chatRows.flatMap((chat) => {
        const other = members.find(
          (member) => member.chatId === chat.id && member.userId !== request.user.sub,
        )
        if (!other) return []
        const lastMessage = lastByChat.get(chat.id)
        return [
          {
            ...chat,
            otherUser: { id: other.userId, name: other.name },
            lastMessage: lastMessage
              ? { body: lastMessage.body, createdAt: lastMessage.createdAt }
              : null,
          },
        ]
      }),
    }
  })

  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { recipientId } = createChatSchema.parse(request.body)
    const result = await createChat(request.user.sub, recipientId)
    return reply.status(201).send({
      data: {
        ...result.chat,
        otherUser: { id: result.recipient.id, name: result.recipient.name },
      },
    })
  })

  app.post('/:chatId/join', { onRequest: [app.authenticate] }, async (request) => ({
    data: await joinChat((request.params as { chatId: string }).chatId, request.user.sub),
  }))

  app.post('/:chatId/messages', { onRequest: [app.authenticate] }, async (request, reply) => {
    const chatId = (request.params as { chatId: string }).chatId
    const { body, clientId } = sendMessageSchema.parse(request.body)
    const message = await addMessage(chatId, request.user.sub, body, clientId)
    if (!message) return { data: null }
    const sender = await participant(chatId, request.user.sub)
    const data = {
      id: message.id,
      chatId: message.chatId,
      body: message.body,
      alias: sender?.alias ?? 'User',
      senderId: message.senderId,
      createdAt: message.createdAt.toISOString(),
      clientId: message.clientId,
    }
    app.io.to(`chat:${chatId}`).to(`user:${request.user.sub}`).emit('chat:message', data)
    return reply.status(201).send({ data })
  })

  app.post(
    '/:chatId/messages/:messageId/reactions',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { chatId, messageId } = request.params as { chatId: string; messageId: string }
      const input = reactionSchema.parse({ ...(request.body as object), messageId })
      const [message] = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.chatId, chatId)))
        .limit(1)
      if (!message)
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Message not found' } })
      const active = await toggleReaction(messageId, request.user.sub, input.emoji)
      const reactionRows = await db
        .select({ id: chatReactions.id })
        .from(chatReactions)
        .where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.emoji, input.emoji)))
      const count = reactionRows.length
      app.io.to(`chat:${chatId}`).to(`user:${request.user.sub}`).emit('chat:reaction', {
        messageId,
        emoji: input.emoji,
        userId: request.user.sub,
        active,
        count,
      })
      return { data: { messageId, emoji: input.emoji, active, count } }
    },
  )

  app.get('/:chatId/messages', { onRequest: [app.authenticate] }, async (request, reply) => {
    const chatId = (request.params as { chatId: string }).chatId
    const members = await db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.chatId, chatId), isNull(chatParticipants.leftAt)))
    if (!members.some((member) => member.userId === request.user.sub))
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Not a participant' } })
    const aliases = new Map(members.map((member) => [member.userId, member.alias]))
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(messages.createdAt)
    if (!history.length) return { data: [] }
    const reactionRows = await db
      .select()
      .from(chatReactions)
      .where(
        inArray(
          chatReactions.messageId,
          history.map((message) => message.id),
        ),
      )
    const reactionsByMessage = new Map<string, typeof reactionRows>()
    for (const reaction of reactionRows) {
      const rows = reactionsByMessage.get(reaction.messageId) ?? []
      rows.push(reaction)
      reactionsByMessage.set(reaction.messageId, rows)
    }
    return {
      data: history.map((message) => ({
        ...message,
        alias: aliases.get(message.senderId) ?? 'User',
        reactions: [
          ...(reactionsByMessage.get(message.id) ?? [])
            .reduce((groups, row) => {
              const group = groups.get(row.emoji) ?? {
                emoji: row.emoji,
                count: 0,
                reactedByMe: false,
              }
              group.count += 1
              group.reactedByMe ||= row.userId === request.user.sub
              groups.set(row.emoji, group)
              return groups
            }, new Map<string, { emoji: string; count: number; reactedByMe: boolean }>())
            .values(),
        ],
      })),
    }
  })
}
