import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db } from '../../db/drizzle.js'
import { chats, chatParticipants, messages, reactions } from '../../db/schema/chats.js'
import { users } from '../../db/schema/users.js'

export async function createChat(userId: string, recipientId: string) {
  if (userId === recipientId) throw new Error('You cannot start a chat with yourself')

  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [userId, recipientId]))
  const recipient = people.find((person) => person.id === recipientId)
  const creator = people.find((person) => person.id === userId)
  if (!creator || !recipient) throw new Error('User not found')

  const memberships = await db
    .select({ chatId: chatParticipants.chatId, userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(
      and(inArray(chatParticipants.userId, [userId, recipientId]), isNull(chatParticipants.leftAt)),
    )
  const memberIds = new Map<string, Set<string>>()
  for (const membership of memberships) {
    const ids = memberIds.get(membership.chatId) ?? new Set<string>()
    ids.add(membership.userId)
    memberIds.set(membership.chatId, ids)
  }
  const existingIds = [...memberIds]
    .filter(([, ids]) => ids.has(userId) && ids.has(recipientId))
    .map(([chatId]) => chatId)

  if (existingIds.length) {
    const existing = await db
      .select()
      .from(chats)
      .where(and(inArray(chats.id, existingIds), eq(chats.type, 'private')))
      .limit(1)
    if (existing[0]) return { chat: existing[0], recipient }
  }

  const chat = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(chats)
      .values({
        creatorId: userId,
        zoneKey: 'global',
        type: 'private',
        status: 'matched',
        memberCap: 2,
      })
      .returning()
    await tx.insert(chatParticipants).values([
      { chatId: created.id, userId, alias: creator.name.slice(0, 32) },
      { chatId: created.id, userId: recipientId, alias: recipient.name.slice(0, 32) },
    ])
    return created
  })
  return { chat, recipient }
}

export async function participant(chatId: string, userId: string) {
  const [row] = await db
    .select()
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.chatId, chatId),
        eq(chatParticipants.userId, userId),
        isNull(chatParticipants.leftAt),
      ),
    )
    .limit(1)
  return row
}

export async function chatRecipients(chatId: string, userId: string) {
  const members = await db
    .select({ userId: chatParticipants.userId })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.chatId, chatId),
        ne(chatParticipants.userId, userId),
        isNull(chatParticipants.leftAt),
      ),
    )
  return members.map((member) => member.userId)
}

export async function joinChat(chatId: string, userId: string) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1)
  if (!chat || chat.status === 'closed') throw new Error('Chat is unavailable')

  const current = await participant(chatId, userId)
  if (current) return { chat, participant: current }

  const members = await db
    .select()
    .from(chatParticipants)
    .where(and(eq(chatParticipants.chatId, chatId), isNull(chatParticipants.leftAt)))
  if (members.length >= chat.memberCap || (chat.type === 'private' && chat.status !== 'open'))
    throw new Error('Chat is full')

  const [member] = await db
    .insert(chatParticipants)
    .values({ chatId, userId, alias: 'User' })
    .returning()

  if (chat.type === 'private')
    await db.update(chats).set({ status: 'matched' }).where(eq(chats.id, chatId))

  return {
    chat: { ...chat, status: chat.type === 'private' ? 'matched' : chat.status },
    participant: member,
  }
}

export async function addMessage(chatId: string, userId: string, body: string, clientId: string) {
  const [chat] = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1)
  if (!chat || chat.status === 'closed' || !(await participant(chatId, userId)))
    throw new Error('You cannot message this chat')
  const [message] = await db
    .insert(messages)
    .values({ chatId, senderId: userId, body, clientId })
    .onConflictDoNothing()
    .returning()
  return message
}

export async function toggleReaction(messageId: string, userId: string, emoji: string) {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1)
  if (!message || !(await participant(message.chatId, userId)))
    throw new Error('You cannot react to this message')
  const [found] = await db
    .select()
    .from(reactions)
    .where(
      and(
        eq(reactions.messageId, messageId),
        eq(reactions.userId, userId),
        eq(reactions.emoji, emoji),
      ),
    )
    .limit(1)
  if (found) {
    await db.delete(reactions).where(eq(reactions.id, found.id))
    return false
  }
  await db.insert(reactions).values({ messageId, userId, emoji })
  return true
}
