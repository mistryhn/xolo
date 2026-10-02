import { z } from 'zod'

export const emailSchema = z.string().email().max(254)
export const passwordSchema = z.string().min(8).max(128)
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: emailSchema,
  password: passwordSchema,
})
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema })
export const createChatSchema = z.object({ recipientId: z.string().uuid() })
export const messageSchema = z.object({
  chatId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
  clientId: z.string().uuid(),
})
export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  clientId: z.string().uuid(),
})
export const reactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().trim().min(1).max(16),
})
export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type CreateChatInput = z.infer<typeof createChatSchema>
