import type { Server, Socket } from 'socket.io'
import {
  messageSchema,
  reactionSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@xolo/protocol'
import { addMessage, joinChat, toggleReaction } from './service.js'
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
      if (result.chat.type === 'private')
        io.to(`chat:${chatId}`).emit('chat:state', { chatId, status: 'matched' })
      ack({ alias: result.participant.alias })
    } catch (e) {
      ack({ error: e instanceof Error ? e.message : 'Unable to join' })
    }
  })
  socket.on('chat:leave', ({ chatId }) => {
    socket.leave(`chat:${chatId}`)
  })
  socket.on('chat:message', async (data, ack) => {
    try {
      const input = messageSchema.parse(data)
      const message = await addMessage(input.chatId, socket.data.userId, input.body, input.clientId)
      if (!message) return ack({ ok: true })
      const { participant } = await joinChat(input.chatId, socket.data.userId)
      io.to(`chat:${input.chatId}`).emit('chat:message', {
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
      const added = await toggleReaction(input.messageId, socket.data.userId, input.emoji)
      io.emit('chat:reaction', {
        messageId: input.messageId,
        emoji: input.emoji,
        userId: socket.data.userId,
      })
      ack({ ok: true })
      void added
    } catch (e) {
      ack({ error: e instanceof Error ? e.message : 'Unable to react' })
    }
  })
}
