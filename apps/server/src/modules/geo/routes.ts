import type { FastifyInstance } from 'fastify'
import { coordinatesSchema } from '@xolo/protocol'
import { zoneFor } from './service.js'
export async function geoRoutes(app: FastifyInstance) {
  app.post('/resolve', { onRequest: [app.authenticate] }, async (request) => ({
    data: { zoneKey: zoneFor(coordinatesSchema.parse(request.body)) },
  }))
}
