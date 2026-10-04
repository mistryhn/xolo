import type { Server, Socket } from 'socket.io'
import { randomUUID } from 'node:crypto'
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
import { chats } from '../../db/schema/chats.js'
import { hasTurnServer, iceServers } from '../../config/env.js'
import { users } from '../../db/schema/users.js'
type XoloSocket = Socket<ClientToServerEvents, ServerToClientEvents> & { data: { userId: string } }

type ActiveCall = { callId: string; chatId: string; callerId: string; calleeId: string; accepted: boolean; timer: ReturnType<typeof setTimeout> }
const activeCalls = new Map<string, ActiveCall>()
const callByUser = new Map<string, string>()

function clearCall(io: Server<ClientToServerEvents, ServerToClientEvents>, call: ActiveCall, reason: 'ended' | 'timeout' | 'disconnected') {
  clearTimeout(call.timer)
  activeCalls.delete(call.callId)
  callByUser.delete(call.callerId)
  callByUser.delete(call.calleeId)
  console.info('[call] ended', {
    callId: call.callId,
    reason,
    accepted: call.accepted,
    callerId: call.callerId,
    calleeId: call.calleeId,
  })
  io.to(`user:${call.callerId}`).to(`user:${call.calleeId}`).emit('call:ended', { callId: call.callId, chatId: call.chatId, reason })
}

export function registerChatSocket(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: XoloSocket,
) {
  socket.on('call:ice-config', (ack) => {
    ack({ iceServers, hasTurnServer })
  })
  socket.on('call:invite', async ({ chatId }, ack) => {
    try {
      const [chat] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1)
      const caller = await participant(chatId, socket.data.userId)
      const recipients = await chatRecipients(chatId, socket.data.userId)
      const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, socket.data.userId)).limit(1)
      if (!chat || chat.type !== 'private' || !caller || recipients.length !== 1) throw new Error('Video calls are available in private chats only')
      const calleeId = recipients[0]
      if (callByUser.has(socket.data.userId) || callByUser.has(calleeId)) throw new Error('You or this person is already in a call')
      if (!(await io.in(`user:${calleeId}`).fetchSockets()).length) throw new Error('This person is offline')
      const callId = randomUUID()
      const call = { callId, chatId, callerId: socket.data.userId, calleeId, accepted: false, timer: setTimeout(() => clearCall(io, call, 'timeout'), 30_000) }
      activeCalls.set(callId, call)
      callByUser.set(call.callerId, callId)
      callByUser.set(call.calleeId, callId)
      io.to(`user:${calleeId}`).emit('call:incoming', { callId, chatId, fromUserId: caller.userId, fromName: user?.name ?? caller.alias })
      console.info('[call] invited', { callId, chatId, callerId: call.callerId, calleeId })
      ack({ callId })
    } catch (e) {
      ack({ error: e instanceof Error ? e.message : 'Could not start call' })
    }
  })
  socket.on('call:accept', async ({ callId }, ack) => {
    const call = activeCalls.get(callId)
    if (!call || call.calleeId !== socket.data.userId) return ack({ error: 'This call is no longer available' })
    if (call.accepted) return ack({ error: 'This call was already answered on another device' })
    call.accepted = true
    clearTimeout(call.timer)
    call.timer = setTimeout(() => clearCall(io, call, 'timeout'), 60 * 60 * 1000)
    io.to(`user:${call.callerId}`).emit('call:accepted', { callId, chatId: call.chatId })
    console.info('[call] accepted', { callId, chatId: call.chatId })
    ack({ ok: true })
  })
  socket.on('call:decline', ({ callId }) => {
    const call = activeCalls.get(callId)
    if (!call || call.calleeId !== socket.data.userId) return
    clearTimeout(call.timer)
    activeCalls.delete(callId); callByUser.delete(call.callerId); callByUser.delete(call.calleeId)
    io.to(`user:${call.callerId}`).to(`user:${call.calleeId}`).emit('call:declined', { callId, chatId: call.chatId })
  })
  const finishCall = (callId: string, userId: string, reason: 'ended' | 'disconnected') => {
    const call = activeCalls.get(callId)
    if (call && (call.callerId === userId || call.calleeId === userId)) {
      console.info('[call] termination requested', { callId, userId, reason, accepted: call.accepted })
      clearCall(io, call, reason)
    }
  }
  socket.on('call:cancel', ({ callId }) => finishCall(callId, socket.data.userId, 'ended'))
  socket.on('call:end', ({ callId }) => finishCall(callId, socket.data.userId, 'ended'))
  socket.on('call:signal', ({ callId, description, candidate }) => {
    const call = activeCalls.get(callId)
    if (!call || (call.callerId !== socket.data.userId && call.calleeId !== socket.data.userId)) return
    if (!description && !candidate) return
    const to = call.callerId === socket.data.userId ? call.calleeId : call.callerId
    if (description) console.info('[call] description relayed', { callId, type: description.type })
    io.to(`user:${to}`).emit('call:signal', { callId, chatId: call.chatId, fromUserId: socket.data.userId, ...(description ? { description } : {}), ...(candidate ? { candidate } : {}) })
  })
  socket.on('disconnect', () => {
    const callId = callByUser.get(socket.data.userId)
    if (!callId) return
    console.warn('[call] participant socket disconnected', {
      callId,
      userId: socket.data.userId,
      accepted: activeCalls.get(callId)?.accepted ?? false,
    })
    // Keep the call alive while another authenticated tab for this user remains connected.
    void io.in(`user:${socket.data.userId}`).fetchSockets().then((sockets) => {
      if (!sockets.length) finishCall(callId, socket.data.userId, 'disconnected')
    })
  })
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
