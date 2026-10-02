# Xolo

Simple one-to-one, real-time chat built as a pnpm monorepo. Users create an account, search for another user, and message them directly. Conversations and messages are saved so people can return to them later.

## Local setup

1. Copy `.env.example` to `.env` and set a secure `JWT_SECRET`. Keep `DATABASE_URL` aligned with the PostgreSQL credentials in `docker-compose.yml`.
2. Run `docker compose up -d` to start PostgreSQL.
3. Run `pnpm install` and `pnpm db:migrate`.
4. Run `pnpm dev` and open `http://localhost:5173`.

The server runs on port 3000 and the web client on port 5173.
