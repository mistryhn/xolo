import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatWindow } from './features/chat/ChatWindow'
import { socket, connectSocket } from './lib/socket'
import { useChatStore, type Message } from './store/chatStore'
import './styles.css'

const api = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

type Session = { token: string; user: { id: string; name: string; email: string } }
type Person = { id: string; name: string }
type Conversation = {
  id: string
  createdAt: string
  otherUser: Person
  lastMessage: { body: string; createdAt: string } | null
}

function App() {
  const [session, setSession] = useState<Session | null>(() =>
    JSON.parse(localStorage.getItem('xolo-session') ?? 'null'),
  )
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [chats, setChats] = useState<Conversation[]>([])
  const [contacts, setContacts] = useState<Person[]>([])
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<Conversation | null>(null)
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null)
  const { activeChatId, setActive: setActiveChat, add, applyReaction } = useChatStore()

  const refreshChats = useCallback(async (token: string) => {
    setLoadingChats(true)
    try {
      const response = await fetch(`${api}/api/chats`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const json = await response.json()
      if (response.ok) {
        const conversations: Conversation[] = json.data ?? []
        setChats(conversations)
        conversations.forEach((chat) => socket.emit('chat:join', { chatId: chat.id }, () => {}))
      }
    } finally {
      setLoadingChats(false)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    connectSocket(session.token)
    const receiveMessage = (message: Message) => {
      add(message)
      setChats((items) =>
        items
          .map((chat) =>
            chat.id === message.chatId
              ? { ...chat, lastMessage: { body: message.body, createdAt: message.createdAt } }
              : chat,
          )
          .sort((a, b) => {
            const aTime = a.lastMessage?.createdAt ?? a.createdAt
            const bTime = b.lastMessage?.createdAt ?? b.createdAt
            return new Date(bTime).getTime() - new Date(aTime).getTime()
          }),
      )
    }
    const onChatAvailable = () => void refreshChats(session.token)
    const receiveReaction = (reaction: Parameters<typeof applyReaction>[0]) =>
      applyReaction(reaction, session.user.id)
    socket.on('chat:message', receiveMessage)
    socket.on('chat:reaction', receiveReaction)
    socket.on('chat:available', onChatAvailable)
    const initialRefresh = window.setTimeout(() => void refreshChats(session.token), 0)
    return () => {
      window.clearTimeout(initialRefresh)
      socket.off('chat:message', receiveMessage)
      socket.off('chat:reaction', receiveReaction)
      socket.off('chat:available', onChatAvailable)
      socket.disconnect()
    }
  }, [session, add, applyReaction, refreshChats])

  useEffect(() => {
    const query = search.trim()
    if (!session || query.length < 2) return
    const timer = window.setTimeout(async () => {
      const response = await fetch(
        `${api}/api/chats/contacts?search=${encodeURIComponent(query)}`,
        { headers: { authorization: `Bearer ${session.token}` } },
      )
      const json = await response.json()
      if (response.ok) setContacts(json.data ?? [])
    }, 200)
    return () => window.clearTimeout(timer)
  }, [search, session])

  async function auth(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const response = await fetch(`${api}/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          mode === 'login' ? { email: form.email, password: form.password } : form,
        ),
      })
      const json = await response.json()
      if (!response.ok) return setError(json.error?.message ?? 'Unable to continue')
      localStorage.setItem('xolo-session', JSON.stringify(json.data))
      setSession(json.data)
    } catch {
      setError('Could not connect to Xolo. Check that the server is running.')
    }
  }

  async function openChat(conversation: Conversation) {
    setError('')
    setActive(conversation)
    setActiveChat(conversation.id)
    setLoadingChatId(conversation.id)
    void (async () => {
      try {
        const response = await fetch(`${api}/api/chats/${conversation.id}/messages`, {
          headers: { authorization: `Bearer ${session!.token}` },
        })
        const json = await response.json()
        if (!response.ok || json.error)
          throw new Error(json.error?.message ?? 'Could not load conversation')
        ;((json.data ?? []) as Message[]).forEach((message) =>
          add({ ...message, createdAt: new Date(message.createdAt).toISOString() }),
        )
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load conversation')
      } finally {
        setLoadingChatId((current) => (current === conversation.id ? null : current))
      }
    })()
    socket.emit('chat:join', { chatId: conversation.id }, (result) => {
      if ('error' in result) setError(`Live updates unavailable: ${result.error}`)
    })
  }

  async function startChat(person: Person) {
    setError('')
    try {
      const response = await fetch(`${api}/api/chats`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session!.token}`,
        },
        body: JSON.stringify({ recipientId: person.id }),
      })
      const json = await response.json()
      if (!response.ok) return setError(json.error?.message ?? 'Could not start chat')
      socket.emit('chat:created', { chatId: json.data.id }, () => {})
      const conversation: Conversation = {
        id: json.data.id,
        createdAt: json.data.createdAt,
        otherUser: json.data.otherUser ?? person,
        lastMessage: null,
      }
      setSearch('')
      setContacts([])
      const refreshed = await fetch(`${api}/api/chats`, {
        headers: { authorization: `Bearer ${session!.token}` },
      })
      const chatData = await refreshed.json()
      if (refreshed.ok) setChats(chatData.data ?? [])
      await openChat(conversation)
    } catch {
      setError('Could not connect to Xolo. Check that the server is running.')
    }
  }

  if (!session)
    return (
      <main className="auth-page">
        <form className="auth-panel" onSubmit={auth}>
          <div className="brand-mark">X</div>
          <h1>Xolo</h1>
          <p>Messages that bring people closer.</p>
          {mode === 'register' && (
            <input
              placeholder="Your name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
          <input
            placeholder="Email address"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            placeholder="Password"
            type="password"
            minLength={8}
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button className="primary-button">
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
          <button
            className="link"
            type="button"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login'
              ? 'New to Xolo? Create an account'
              : 'Already have an account? Log in'}
          </button>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      </main>
    )

  return (
    <main className="app-shell">
      <section className="chat-layout">
        <aside className={`sidebar ${active ? 'sidebar-hidden-mobile' : ''}`}>
          <header className="sidebar-header">
            <div className="brand-lockup">
              <span className="brand-mark small">X</span>
              <strong>Xolo</strong>
            </div>
            <div className="account-tools">
              <span>{session.user.name}</span>
              <button
                className="text-button"
                onClick={() => {
                  localStorage.removeItem('xolo-session')
                  socket.disconnect()
                  setSession(null)
                }}
              >
                Log out
              </button>
            </div>
          </header>
          <div className="search-wrap">
            <input
              aria-label="Search people"
              placeholder="Search people by name or email"
              value={search}
              onChange={(e) => {
                const value = e.target.value
                setSearch(value)
                if (value.trim().length < 2) setContacts([])
              }}
            />
          </div>
          {search.trim().length >= 2 ? (
            <div className="list-content">
              <h2>People</h2>
              {!contacts.length && <p className="empty-note">No people found.</p>}
              {contacts.map((person) => (
                <button className="list-row" key={person.id} onClick={() => void startChat(person)}>
                  <span className="avatar">{person.name.slice(0, 1).toUpperCase()}</span>
                  <span className="row-copy">
                    <strong>{person.name}</strong>
                    <small>Start a conversation</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="list-content">
              <h2>Chats</h2>
              {loadingChats && <p className="empty-note">Loading chats...</p>}
              {!loadingChats && chats.length === 0 && (
                <p className="empty-note">No conversations yet. Search for someone to message.</p>
              )}
              {chats.map((chat) => (
                <button
                  className={`list-row ${activeChatId === chat.id ? 'selected' : ''}`}
                  key={chat.id}
                  onClick={() => void openChat(chat)}
                >
                  <span className="avatar">{chat.otherUser.name.slice(0, 1).toUpperCase()}</span>
                  <span className="row-copy">
                    <strong>{chat.otherUser.name}</strong>
                    <small>{chat.lastMessage?.body ?? 'Start a conversation'}</small>
                  </span>
                  {chat.lastMessage && (
                    <time>
                      {new Date(chat.lastMessage.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  )}
                </button>
              ))}
            </div>
          )}
        </aside>
        <ChatWindow
          title={active?.otherUser.name ?? ''}
          currentUserId={session.user.id}
          token={session.token}
          loading={loadingChatId === activeChatId}
          onBack={() => {
            setActive(null)
            setActiveChat(null)
          }}
          onError={setError}
          error={error}
        />
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
