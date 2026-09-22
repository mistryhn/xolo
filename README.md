# Xolo

Location-zone, real-time chat built as a pnpm monorepo.

## Local setup

1. Copy `.env.example` to `.env` and set a secure `JWT_SECRET`.
2. Run `docker compose up -d`.
3. Run `pnpm install`, `pnpm db:generate`, and `pnpm db:migrate`.
4. Run `pnpm dev` and open `http://localhost:5173`.

The server runs on port 3000 and the web client on port 5173.
