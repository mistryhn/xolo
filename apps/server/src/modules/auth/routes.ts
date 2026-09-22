import type { FastifyInstance } from 'fastify';
import { loginSchema, registerSchema } from '@xolo/protocol';
import { authenticate, register } from './service.js';
export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => { const input = registerSchema.parse(request.body); const user = await register(input); const token = await reply.jwtSign({ sub: user.id }); return reply.status(201).send({ data: { user, token } }); });
  app.post('/login', async (request, reply) => { const user = await authenticate(loginSchema.parse(request.body)); if (!user) return reply.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }); return { data: { user, token: await reply.jwtSign({ sub: user.id }) } }; });
  app.get('/me', { onRequest: [app.authenticate] }, async (request) => ({ data: { id: request.user.sub } }));
}
