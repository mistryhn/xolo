import { create } from 'zustand'
import type { PresenceState } from '@xolo/protocol'

type TypingState = { typing: boolean; updatedAt: number }

export const usePresenceStore = create<{
  presenceByUser: Record<string, PresenceState>
  typingByChat: Record<string, TypingState>
  setPresence: (userId: string, presence: PresenceState) => void
  setTyping: (chatId: string, userId: string, typing: boolean) => void
}>((set) => ({
  presenceByUser: {},
  typingByChat: {},
  setPresence: (userId, presence) =>
    set((state) => ({
      presenceByUser: { ...state.presenceByUser, [userId]: presence },
    })),
  setTyping: (chatId, userId, typing) =>
    set((state) => ({
      typingByChat: {
        ...state.typingByChat,
        [`${chatId}:${userId}`]: { typing, updatedAt: Date.now() },
      },
    })),
}))
