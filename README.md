# Xolo

Simple one-to-one, real-time chat built as a pnpm monorepo. Users create an account, search for another user, and message them directly. Conversations and messages are saved so people can return to them later.

## Local setup

1. Copy `.env.example` to `.env` and set a secure `JWT_SECRET`. Keep `DATABASE_URL` aligned with the PostgreSQL credentials in `docker-compose.yml`.
2. Run `docker compose up -d` to start PostgreSQL.
3. Run `pnpm install` and `pnpm db:migrate`.
4. Run `pnpm dev` and open `http://localhost:5173`.

The server runs on port 3000 and the web client on port 5173.

## Video call networking

Video calls use WebRTC. The example `ICE_SERVERS` setting contains public STUN only and is suitable for local development, but it cannot relay media when direct peer connections are blocked. For deployed use, configure your managed TURN provider's ICE server URLs, username, and credential in the server's `ICE_SERVERS` environment variable as JSON. Keep TURN credentials in the server environment; the authenticated server returns them only to call participants. The web client logs call and ICE state changes, plus the selected candidate types, without logging addresses, SDP, or candidate strings.

For example, set the server environment variable to the provider's values (replace the example host and credentials):

```dotenv
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:turn.provider.example:3478?transport=udp","turns:turn.provider.example:5349?transport=tcp"],"username":"<provider-username>","credential":"<provider-credential>"}]
```
