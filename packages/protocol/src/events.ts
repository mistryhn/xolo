export type ServerToClientEvents = {
  'call:incoming': (data: {
    callId: string
    chatId: string
    fromUserId: string
    fromName: string
  }) => void
  'call:accepted': (data: { callId: string; chatId: string }) => void
  'call:declined': (data: { callId: string; chatId: string }) => void
  'call:ended': (data: {
    callId: string
    chatId: string
    reason: 'ended' | 'timeout' | 'disconnected'
  }) => void
  'call:signal': (data: {
    callId: string
    chatId: string
    fromUserId: string
    description?: { type: 'offer' | 'answer'; sdp: string }
    candidate?: {
      candidate: string
      sdpMid: string | null
      sdpMLineIndex: number | null
      usernameFragment?: string | null
    }
  }) => void
  'chat:message': (data: {
    id: string
    chatId: string
    body: string
    alias: string
    senderId: string
    createdAt: string
    clientId: string
  }) => void
  'chat:reaction': (data: {
    messageId: string
    emoji: string
    userId: string
    active: boolean
    count: number
  }) => void
  'chat:participant': (data: { chatId: string; alias: string; action: 'joined' | 'left' }) => void
  'chat:available': () => void
  'error:message': (data: { code: string; message: string }) => void
}
export type ClientToServerEvents = {
  'call:ice-config': (
    ack: (result: { iceServers: IceServer[]; hasTurnServer: boolean }) => void,
  ) => void
  'call:invite': (
    data: { chatId: string },
    ack: (result: { callId: string } | { error: string }) => void,
  ) => void
  'call:accept': (
    data: { callId: string },
    ack: (result: { ok: true } | { error: string }) => void,
  ) => void
  'call:decline': (data: { callId: string }) => void
  'call:cancel': (data: { callId: string }) => void
  'call:end': (data: { callId: string }) => void
  'call:signal': (data: {
    callId: string
    description?: { type: 'offer' | 'answer'; sdp: string }
    candidate?: {
      candidate: string
      sdpMid: string | null
      sdpMLineIndex: number | null
      usernameFragment?: string | null
    }
  }) => void
  'chat:join': (
    data: { chatId: string },
    ack: (result: { alias: string } | { error: string }) => void,
  ) => void
  'chat:leave': (data: { chatId: string }) => void
  'chat:created': (
    data: { chatId: string },
    ack: (result: { ok: true } | { error: string }) => void,
  ) => void
  'chat:message': (
    data: { chatId: string; body: string; clientId: string },
    ack: (result: { ok: true } | { error: string }) => void,
  ) => void
  'chat:reaction': (
    data: { messageId: string; emoji: string },
    ack: (result: { ok: true } | { error: string }) => void,
  ) => void
}

export type IceServer = { urls: string | string[]; username?: string; credential?: string }
