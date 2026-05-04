// Shared 501 Not Implemented helper. Every route that defers to PR2/PR3
// returns this exact shape so clients have a single contract to parse.

import type { FastifyReply } from 'fastify';

export type PlannedPhase = 'PR2' | 'PR3';

export type NotImplementedBody = {
  error: 'capability_not_implemented_in_runtime_patch_1';
  capability: string;
  status: 'planned';
  planned_phase: PlannedPhase;
  tracker: string;
};

export function sendNotImplemented(
  reply: FastifyReply,
  capability: string,
  plannedPhase: PlannedPhase,
): NotImplementedBody {
  reply.code(501);
  return {
    error: 'capability_not_implemented_in_runtime_patch_1',
    capability,
    status: 'planned',
    planned_phase: plannedPhase,
    tracker: 'docs/architecture/baseline-decisions.md#runtime-roadmap',
  };
}
