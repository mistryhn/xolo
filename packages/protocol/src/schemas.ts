import { z } from 'zod';

export const emailSchema = z.string().email().max(254);
export const passwordSchema = z.string().min(8).max(128);
export const registerSchema = z.object({ name: z.string().trim().min(2).max(60), email: emailSchema, password: passwordSchema });
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const coordinatesSchema = z.object({ latitude: z.number().gte(-90).lte(90), longitude: z.number().gte(-180).lte(180) });
export const chatTypeSchema = z.enum(['private', 'group']);
export const createChatSchema = z.object({ type: chatTypeSchema, title: z.string().trim().min(2).max(80).optional(), memberCap: z.number().int().min(2).max(50).optional() }).superRefine((value, ctx) => { if (value.type === 'group' && !value.title) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Group chats need a title', path: ['title'] }); });
export const messageSchema = z.object({ chatId: z.string().uuid(), body: z.string().trim().min(1).max(1000), clientId: z.string().uuid() });
export const reactionSchema = z.object({ messageId: z.string().uuid(), emoji: z.string().trim().min(1).max(16) });
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type Coordinates = z.infer<typeof coordinatesSchema>;
export type CreateChatInput = z.infer<typeof createChatSchema>;
export type ChatType = z.infer<typeof chatTypeSchema>;
