import type { FastifyInstance } from 'fastify'
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((raw, _request, reply) => {
    const error = raw as Error & { statusCode?: number }
    app.log.error(error)
    const status = error.statusCode ?? 500
    reply.status(status).send({
      error: {
        code: error.name || 'INTERNAL_ERROR',
        message: status < 500 ? error.message : 'Something went wrong',
      },
    })
  })
}
