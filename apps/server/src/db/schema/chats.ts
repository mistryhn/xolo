import { pgTable, timestamp, uuid, varchar, integer, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { users } from './users.js'
export const chats = pgTable('chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: varchar('type', { length: 10 }).notNull(),
  status: varchar('status', { length: 10 }).notNull().default('open'),
  title: varchar('title', { length: 80 }),
  zoneKey: varchar('zone_key', { length: 12 }).notNull(),
  memberCap: integer('member_cap').notNull().default(2),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})
export const chatParticipants = pgTable(
  'chat_participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    alias: varchar('alias', { length: 32 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('participant_once').on(t.chatId, t.userId)],
)
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    clientId: uuid('client_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('message_client_id').on(t.senderId, t.clientId)],
)
export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('reaction_once').on(t.messageId, t.userId, t.emoji)],
)
