import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@xolo/protocol'
export const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', {
  autoConnect: false,
}) as Socket<ServerToClientEvents, ClientToServerEvents>
export function connectSocket(token: string) {
  socket.auth = { token }
  socket.connect()
}
