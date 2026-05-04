import type { FastifyInstance } from 'fastify';

// Skeleton route — pipeline real em apps/api/src/pipeline/. Implementação parcial no baseline:
// retorna 503 com referência ao runbook até pipeline estar completo.
export async function runsRoute(app: FastifyInstance): Promise<void> {
  app.post('/v1/runs', async (_req, reply) => {
    reply.code(503);
    return {
      error: 'pipeline_incomplete_in_baseline',
      message: 'Pipeline /v1/runs disponível após implementação completa de provider-invoke + dlp + policy + audit-append. Ver docs/runbooks/pipeline.md.',
    };
  });
}
