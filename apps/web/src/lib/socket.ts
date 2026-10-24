import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@xolo/protocol'

export const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  transports: ['websocket', 'polling'],
}) as Socket<ServerToClientEvents, ClientToServerEvents>

export function connectSocket(token: string) {
  socket.auth = { token }
  if (!socket.connected) {
    socket.connect()
  }
}
