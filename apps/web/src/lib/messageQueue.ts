export type QueuedMessage = {
  id: string
  chatId: string
  body: string
  clientId: string
  token: string
  createdAt: number
}

const STORAGE_KEY = 'xolo-message-queue'

function readQueue(): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedMessage[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // ignore
  }
}

export function enqueueMessage(message: Omit<QueuedMessage, 'id' | 'createdAt'>) {
  const queue = readQueue()
  const entry: QueuedMessage = {
    ...message,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  queue.push(entry)
  writeQueue(queue)
  return entry
}

export function getQueue() {
  return readQueue()
}

export function removeFromQueue(id: string) {
  const queue = readQueue().filter((item) => item.id !== id)
  writeQueue(queue)
}

export function clearQueueForChat(chatId: string) {
  const queue = readQueue().filter((item) => item.chatId !== chatId)
  writeQueue(queue)
}
