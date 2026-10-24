# Xolo

Xolo is a full-stack realtime chat application with video calls, presence, typing indicators, and resilient networking for slow/unstable connections.

## Features

- **Realtime Messaging** - Instant messaging between users via Socket.IO with message deduplication
- **Online/Offline Status** - See when users are online (green dot) or when they were last seen
- **Typing Indicators** - Know when the other person is typing with real-time updates
- **Message Date Separators** - Messages grouped by Today/Yesterday/specific dates
- **Video Calls** - WebRTC-powered peer-to-peer video calls with ICE/STUN/TURN support
- **Reactions** - React to messages with emojis
- **Dark/Light Theme** - Toggle between themes
- **Secure Auth** - JWT-based authentication with Argon2 password hashing

## Slow Network Resilience

- **Socket Reconnection** - Auto-reconnect with exponential backoff (infinite attempts)
- **Connection Awareness** - UI banner shows offline/reconnecting status
- **Message Queuing** - Messages sent while offline are queued and auto-sent on reconnect
- **Request Timeouts & Retries** - HTTP requests have timeouts with retry logic for 5xx errors
- **Room Resync** - On reconnect, automatically rejoin rooms and refresh data
- **Presence Grace Period** - Delayed offline marking prevents false offline status on transient drops
- **Typing Resilience** - Client-side timeouts clear stale typing indicators

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Zustand, Socket.IO Client
- **Backend**: Fastify, TypeScript, Socket.IO, Drizzle ORM
- **Database**: PostgreSQL
- **Cache/Realtime**: Redis (for presence, typing, Socket.IO adapter)
- **Protocol**: Shared types/schemas in `@xolo/protocol`

## Prerequisites

- Node.js 18+
- pnpm 9+
- PostgreSQL
- Redis

## Getting Started

1. **Clone and install dependencies**
```bash
git clone <repo-url>
cd xolo
pnpm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your database/redis/JWT settings
```

3. **Start databases**
```bash
docker compose up -d
```

4. **Run migrations**
```bash
pnpm db:migrate
```

5. **Start development servers**
```bash
pnpm dev
```

The web app runs on `http://localhost:5173` and the API on `http://localhost:3000`.

## Environment Variables

See `.env.example` for all configuration options including:
- Database connection
- Redis URL
- JWT secret
- Web origin
- ICE servers for WebRTC (STUN/TURN)

## Testing on Slow Networks

Chrome DevTools → Network → Throttling to test:
- Slow 3G / Fast 3G
- Offline mode (messages queue and send on reconnect)
- Connection drops mid-call

## Scripts

- `pnpm dev` - Start both web and server in dev mode
- `pnpm build` - Build all packages
- `pnpm typecheck` - Type check all packages
- `pnpm lint` - Lint with ESLint
- `pnpm db:generate` - Generate migrations
- `pnpm db:migrate` - Run migrations

## License

MIT
