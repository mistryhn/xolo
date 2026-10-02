import type { Server, Socket } from 'socket.io'
import { and, eq } from 'drizzle-orm'
import {
  messageSchema,
  reactionSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@xolo/protocol'
import { addMessage, chatRecipients, joinChat, participant, toggleReaction } from './service.js'
import { db } from '../../db/drizzle.js'
import { messages, reactions } from '../../db/schema/chats.js'
type XoloSocket = Socket<ClientToServerEvents, ServerToClientEvents> & { data: { userId: string } }
export function registerChatSocket(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: XoloSocket,
) {
  socket.on('chat:join', async ({ chatId }, ack) => {
    try {
      const result = await joinChat(chatId, socket.data.userId)
      await socket.join(`chat:${chatId}`)
      socket
        .to(`chat:${chatId}`)
        .emit('chat:participant', { chatId, alias: result.participant.alias, action: 'joined' })
      ack({ alias: result.participant.alias })
    } catch (e) {
      ack({ error: e instanceof Error ? e.message : 'Unable to join' })
    }
  })
  socket.on('chat:leave', ({ chatId }) => {
    socket.leave(`chat:${chatId}`)
  })
  socket.on('chat:created', async ({ chatId }, ack) => {
    try {
      if (!(await participant(chatId, socket.data.userId)))
        throw new Error('You cannot share this chat')
      const recipients = await chatRecipients(chatId, socket.data.userId)
      recipients.forEach((userId) => io.to(`user:${userId}`).emit('chat:available'))
      ack({ ok: true })
    } catch (e) {
      ack({ error: e instanceof Error ? e.message : 'Unable to notify chat participants' })
    }
  })
  socket.on('chat:message', async (data, ack) => {
    try {
      const input = messageSchema.parse(data)
      const message = await addMessage(input.chatId, socket.data.userId, input.body, input.clientId)
      console.log('message', message)
      if (!message) return ack({ ok: true })
      const { participant } = await joinChat(input.chatId, socket.data.userId)
      io.to(`chat:${input.chatId}`).to(`user:${socket.data.userId}`).emit('chat:message', {
        id: message.id,
        chatId: message.chatId,
        body: message.body,
        alias: participant.alias,
        senderId: message.senderId,
        createdAt: message.createdAt.toISOString(),
        clientId: message.clientId,
      })
      ack({ ok: true })
    } catch (e) {
      ack({ error: e instanceof Error ? e.message : 'Unable to send' })
    }
  })
  socket.on('chat:reaction', async (data, ack) => {
    try {
      const input = reactionSchema.parse(data)
      const [message] = await db
        .select({ chatId: messages.chatId })
        .from(messages)
        .where(eq(messages.id, input.messageId))
        .limit(1)
      if (!message) throw new Error('Message not found')
      const added = await toggleReaction(input.messageId, socket.data.userId, input.emoji)
      const reactionRows = await db
        .select({ id: reactions.id })
        .from(reactions)
        .where(and(eq(reactions.messageId, input.messageId), eq(reactions.emoji, input.emoji)))
      io.to(`chat:${message.chatId}`).to(`user:${socket.data.userId}`).emit('chat:reaction', {
        messageId: input.messageId,
        emoji: input.emoji,
        userId: socket.data.userId,
        active: added,
        count: reactionRows.length,
      })
      ack({ ok: true })
      void added
    } catch (e) {
      ack({ error: e instanceof Error ? e.message : 'Unable to react' })
    }
  })
}
