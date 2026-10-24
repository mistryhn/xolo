import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import { usePresenceStore } from '../../store/presenceStore'
import { formatLastSeen, formatMessageDay, isSameDay } from '../../lib/dates'
import { socket } from '../../lib/socket'
import { fetchWithRetry } from '../../lib/fetchWithRetry'
import { enqueueMessage } from '../../lib/messageQueue'
import { useVideoCall } from './useVideoCall'
const api = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export function ChatWindow({
  title,
  otherUserId,
  currentUserId,
  token,
  loading,
  onBack,
  onError,
  error,
}: {
  title: string
  otherUserId: string
  currentUserId: string
  token: string
  loading: boolean
  onBack: () => void
  onError: (message: string) => void
  error: string
}) {
  const { activeChatId, messages, add, applyReaction } = useChatStore()
  const { startCall, call, busyMessage } = useVideoCall()
  const online = usePresenceStore((state) => state.presenceByUser[otherUserId]?.online ?? false)
  const lastSeenAt = usePresenceStore(
    (state) => state.presenceByUser[otherUserId]?.lastSeenAt ?? null,
  )
  const typingKey = activeChatId && otherUserId ? `${activeChatId}:${otherUserId}` : ''
  const typingState = usePresenceStore((state) =>
    typingKey ? state.typingByChat[typingKey] : undefined,
  )
  const setTyping = usePresenceStore((state) => state.setTyping)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const typingActive = useRef(false)
  const lastTypingSent = useRef(0)
  const partnerTyping = typingState?.typing ?? false
  const typingUpdatedAt = typingState?.updatedAt ?? 0

  const stopTyping = useCallback(() => {
    if (!activeChatId || !typingActive.current) return
    socket.emit('typing:stop', { chatId: activeChatId })
    typingActive.current = false
    lastTypingSent.current = 0
  }, [activeChatId])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!partnerTyping || !activeChatId || !otherUserId) return
    const timer = window.setTimeout(() => setTyping(activeChatId, otherUserId, false), 5_500)
    return () => window.clearTimeout(timer)
  }, [partnerTyping, typingUpdatedAt, activeChatId, otherUserId, setTyping])

  useEffect(
    () => () => {
      if (activeChatId && typingActive.current) socket.emit('typing:stop', { chatId: activeChatId })
      typingActive.current = false
      lastTypingSent.current = 0
    },
    [activeChatId],
  )

  if (!activeChatId)
    return (
      <section className="conversation-pane empty-conversation">
        <div className="empty-brand">X</div>
        <h2>Your conversations, all in one place</h2>
        <p>Select a chat or search for someone to start messaging.</p>
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
      </section>
    )

  return (
    <section className="conversation-pane">
      <header className="conversation-header">
        <button className="back-button" onClick={onBack} aria-label="Back to chats">
          ‹
        </button>
        <span className="avatar">{title.slice(0, 1).toUpperCase()}</span>
        <div className="conversation-identity">
          <strong>{title}</strong>
          <span
            className={`conversation-status ${
              partnerTyping ? 'typing' : online ? 'online' : 'offline'
            }`}
            aria-live="polite"
          >
            <span className="presence-dot" aria-hidden="true" />
            {partnerTyping ? 'typing…' : online ? 'Online' : formatLastSeen(lastSeenAt)}
          </span>
        </div>
        <button
          className="video-call-button"
          disabled={!activeChatId || !!call}
          onClick={() => activeChatId && startCall(activeChatId, title)}
          aria-label="Start video call"
          title="Start video call"
        >
          ◉ <span>Video call</span>
        </button>
      </header>
      {busyMessage && (
        <p className="chat-error" role="alert">
          {busyMessage}
        </p>
      )}
      <div className="message-list">
        {loading && messages.length === 0 && <p className="thread-note">Loading messages...</p>}
        {!loading && messages.length === 0 && (
          <p className="thread-note">No messages yet. Say hello.</p>
        )}
        {messages.map((m, index) => {
          const own = String(m.senderId).toLowerCase() === String(currentUserId).toLowerCase()
          const heart = m.reactions?.find((reaction) => reaction.emoji === '❤️')
          const previous = messages[index - 1]
          const showDay =
            !previous || !isSameDay(new Date(previous.createdAt), new Date(m.createdAt))
          return (
            <Fragment key={m.id}>
              {showDay && (
                <div className="message-day">
                  <span>{formatMessageDay(m.createdAt)}</span>
                </div>
              )}
              <article
                className={`message ${own ? 'sent' : 'received'}`}
                style={{ justifyContent: own ? 'flex-end' : 'flex-start' }}
              >
                <div
                  className="message-stack"
                  style={{
                    alignItems: own ? 'flex-end' : 'flex-start',
                    marginLeft: own ? 'auto' : 0,
                    marginRight: own ? 0 : 'auto',
                  }}
                >
                  <div className="message-bubble">
                    <span>{m.body}</span>
                    <time>
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  <div className="message-reactions">
                    {heart && <span className="reaction-count">❤️ {heart.count}</span>}
                    <button
                      className={`reaction-button ${heart?.reactedByMe ? 'reacted' : ''}`}
                      aria-label={heart?.reactedByMe ? 'Remove heart reaction' : 'React with heart'}
                      title={heart?.reactedByMe ? 'Remove heart reaction' : 'React with heart'}
                      onClick={async () => {
                        try {
                          const response = await fetch(
                            `${api}/api/chats/${activeChatId}/messages/${m.id}/reactions`,
                            {
                              method: 'POST',
                              headers: {
                                'content-type': 'application/json',
                                authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({ emoji: '❤️' }),
                            },
                          )
                          const json = await response.json()
                          if (!response.ok)
                            throw new Error(json.error?.message ?? 'Could not react')
                          applyReaction(
                            {
                              ...json.data,
                              userId: currentUserId,
                            },
                            currentUserId,
                          )
                          onError('')
                        } catch (cause) {
                          onError(cause instanceof Error ? cause.message : 'Could not react')
                        }
                      }}
                    >
                      {heart?.reactedByMe ? '♥' : '♡'}
                    </button>
                  </div>
                </div>
              </article>
            </Fragment>
          )
        })}
        <div ref={bottom} />
      </div>
      <form
        className="message-composer"
        onSubmit={async (e) => {
          e.preventDefault()
          const clientId = crypto.randomUUID()
          const text = body.trim()
          if (!text || sending) return
          stopTyping()
          setSending(true)
          try {
            const response = await fetchWithRetry(`${api}/api/chats/${activeChatId}/messages`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ body: text, clientId }),
              timeout: 15000,
              retries: 1,
            })
            const json = await response.json()
            if (!response.ok) throw new Error(json.error?.message ?? 'Could not send message')
            if (json.data)
              add({ ...json.data, createdAt: new Date(json.data.createdAt).toISOString() })
            setBody('')
            onError('')
          } catch (cause) {
            if (!navigator.onLine || !socket.connected) {
              enqueueMessage({ chatId: activeChatId, body: text, clientId, token })
              onError('Message queued. It will send when connection is restored.')
              setBody('')
            } else {
              onError(cause instanceof Error ? cause.message : 'Could not send message')
            }
          } finally {
            setSending(false)
          }
        }}
      >
        <input
          value={body}
          maxLength={1000}
          onChange={(e) => {
            const value = e.target.value
            setBody(value)
            if (!activeChatId) return
            if (!value.trim()) {
              stopTyping()
              return
            }
            const now = Date.now()
            if (!typingActive.current || now - lastTypingSent.current > 2_000) {
              socket.emit('typing:start', { chatId: activeChatId })
              typingActive.current = true
              lastTypingSent.current = now
            }
          }}
          onBlur={stopTyping}
          aria-label="Message"
          placeholder="Type a message"
        />
        <button
          className="send-button"
          disabled={!body.trim() || sending}
          aria-label="Send message"
        >
          {sending ? 'Sending' : 'Send'}
        </button>
      </form>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
