import type { Coordinates } from './schemas.js'
export type ServerToClientEvents = {
  'presence:update': (data: { zoneKey: string; count: number }) => void
  'chat:message': (data: {
    id: string
    chatId: string
    body: string
    alias: string
    senderId: string
    createdAt: string
    clientId: string
  }) => void
  'chat:reaction': (data: { messageId: string; emoji: string; userId: string }) => void
  'chat:state': (data: { chatId: string; status: 'open' | 'matched' | 'closed' }) => void
  'chat:participant': (data: { chatId: string; alias: string; action: 'joined' | 'left' }) => void
  'error:message': (data: { code: string; message: string }) => void
}
export type ClientToServerEvents = {
  'zone:join': (
    data: Coordinates,
    ack: (result: { zoneKey: string } | { error: string }) => void,
  ) => void
  'chat:join': (
    data: { chatId: string },
    ack: (result: { alias: string } | { error: string }) => void,
  ) => void
  'chat:leave': (data: { chatId: string }) => void
  'chat:message': (
    data: { chatId: string; body: string; clientId: string },
    ack: (result: { ok: true } | { error: string }) => void,
  ) => void
  'chat:reaction': (
    data: { messageId: string; emoji: string },
    ack: (result: { ok: true } | { error: string }) => void,
  ) => void
}
