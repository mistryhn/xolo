import { create } from 'zustand'
export type Message = {
  id: string
  chatId: string
  body: string
  alias: string
  senderId: string
  createdAt: string
  clientId: string
  reactions?: { emoji: string; count: number; reactedByMe: boolean }[]
}
export type ReactionUpdate = {
  messageId: string
  emoji: string
  userId: string
  active: boolean
  count: number
}
export const useChatStore = create<{
  activeChatId: string | null
  messages: Message[]
  setActive: (id: string | null) => void
  add: (m: Message) => void
  applyReaction: (reaction: ReactionUpdate, currentUserId: string) => void
}>((set) => ({
  activeChatId: null,
  messages: [],
  setActive: (activeChatId) => set({ activeChatId, messages: [] }),
  add: (m) =>
    set((s) => {
      if (m.chatId !== s.activeChatId) return s
      return s.messages.some((x) => x.id === m.id || x.clientId === m.clientId)
        ? s
        : { messages: [...s.messages, m] }
    }),
  applyReaction: (reaction, currentUserId) =>
    set((s) => ({
      messages: s.messages.map((message) => {
        if (message.id !== reaction.messageId) return message
        const current = message.reactions ?? []
        const found = current.find((item) => item.emoji === reaction.emoji)
        const next = current.filter((item) => item.emoji !== reaction.emoji)
        if (reaction.count > 0)
          next.push({
            emoji: reaction.emoji,
            count: reaction.count,
            reactedByMe:
              reaction.userId === currentUserId ? reaction.active : (found?.reactedByMe ?? false),
          })
        return { ...message, reactions: next }
      }),
    })),
}))
