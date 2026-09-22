import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ZonePermissionGate } from './features/zone/ZonePermissionGate';
import { ChatWindow } from './features/chat/ChatWindow';
import { socket, connectSocket } from './lib/socket';
import { useZoneStore } from './store/zoneStore';
import { useChatStore } from './store/chatStore';
import './styles.css';
const api = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type Session = { token: string; user: { id: string; name: string; email: string } };
function App() {
  const [session, setSession] = useState<Session | null>(() => JSON.parse(localStorage.getItem('xolo-session') ?? 'null'));
  const [mode, setMode] = useState<'login' | 'register'>('login'); const [form, setForm] = useState({ name: '', email: '', password: '' }); const [error, setError] = useState(''); const [chats, setChats] = useState<any[]>([]);
  const { zoneKey, setZone } = useZoneStore(); const { setActive, add } = useChatStore();
  useEffect(() => { if (!session) return; connectSocket(session.token); socket.on('chat:message', add); return () => { socket.off('chat:message', add); socket.disconnect(); }; }, [session, add]);
  async function auth(e: React.FormEvent) { e.preventDefault(); setError(''); const response = await fetch(`${api}/api/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mode === 'login' ? { email: form.email, password: form.password } : form) }); const json = await response.json(); if (!response.ok) return setError(json.error?.message ?? 'Unable to continue'); localStorage.setItem('xolo-session', JSON.stringify(json.data)); setSession(json.data); }
  async function enterZone(coords: { latitude: number; longitude: number }) { const r = await fetch(`${api}/api/zones/resolve`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session!.token}` }, body: JSON.stringify(coords) }); const json = await r.json(); setZone(json.data.zoneKey); socket.emit('zone:join', coords, () => {}); const rooms = await fetch(`${api}/api/chats`, { headers: { authorization: `Bearer ${session!.token}` } }); setChats((await rooms.json()).data ?? []); }
  async function create(type: 'private' | 'group') { const title = type === 'group' ? window.prompt('Room name') : undefined; if (type === 'group' && !title) return; const r = await fetch(`${api}/api/chats`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session!.token}` }, body: JSON.stringify({ type, title, zoneKey }) }); const json = await r.json(); if (r.ok) { setChats((items) => [json.data, ...items]); join(json.data.id); } }
  function join(chatId: string) { socket.emit('chat:join', { chatId }, async (result) => { if ('error' in result) return setError(result.error); setActive(chatId); const r = await fetch(`${api}/api/chats/${chatId}/messages`, { headers: { authorization: `Bearer ${session!.token}` } }); const json = await r.json(); (json.data ?? []).forEach((m: any) => add({ ...m, alias: 'Earlier message' })); }); }
  if (!session) return <main><h1>Xolo</h1><p>Real-time conversations in your local zone.</p><form onSubmit={auth}>{mode === 'register' && <input placeholder="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/>}<input placeholder="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/><input placeholder="Password" type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}/><button>{mode === 'login' ? 'Log in' : 'Create account'}</button></form><button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Need an account?' : 'Already have an account?'}</button>{error && <p role="alert">{error}</p>}</main>;
  if (!zoneKey) return <main><ZonePermissionGate onZone={enterZone}/></main>;
  return <main><header><h1>Xolo</h1><button onClick={() => { localStorage.removeItem('xolo-session'); setSession(null); }}>Log out</button></header><p>Local zone: {zoneKey}</p><div className="actions"><button onClick={() => create('private')}>Start private match</button><button onClick={() => create('group')}>Create group room</button></div><aside><h2>Open chats</h2>{chats.map((chat) => <button className="room" key={chat.id} onClick={() => join(chat.id)}>{chat.title ?? 'Private match'} · {chat.type}</button>)}</aside><ChatWindow/>{error && <p role="alert">{error}</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<App />);
