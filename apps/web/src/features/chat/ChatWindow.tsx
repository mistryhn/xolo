import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'
const api = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export function ChatWindow({
  title,
  currentUserId,
  token,
  loading,
  onBack,
  onError,
  error,
}: {
  title: string
  currentUserId: string
  token: string
  loading: boolean
  onBack: () => void
  onError: (message: string) => void
  error: string
}) {
  const { activeChatId, messages, add, applyReaction } = useChatStore()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
        <strong>{title}</strong>
      </header>
      <div className="message-list">
        {loading && messages.length === 0 && <p className="thread-note">Loading messages...</p>}
        {!loading && messages.length === 0 && (
          <p className="thread-note">No messages yet. Say hello.</p>
        )}
        {messages.map((m) => {
          const own = String(m.senderId).toLowerCase() === String(currentUserId).toLowerCase()
          const heart = m.reactions?.find((reaction) => reaction.emoji === '❤️')
          return (
            <article
              className={`message ${own ? 'sent' : 'received'}`}
              key={m.id}
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
                        if (!response.ok) throw new Error(json.error?.message ?? 'Could not react')
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
          setSending(true)
          try {
            const response = await fetch(`${api}/api/chats/${activeChatId}/messages`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ body: text, clientId }),
            })
            const json = await response.json()
            if (!response.ok) throw new Error(json.error?.message ?? 'Could not send message')
            if (json.data)
              add({ ...json.data, createdAt: new Date(json.data.createdAt).toISOString() })
            setBody('')
            onError('')
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : 'Could not send message')
          } finally {
            setSending(false)
          }
        }}
      >
        <input
          value={body}
          maxLength={1000}
          onChange={(e) => setBody(e.target.value)}
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
