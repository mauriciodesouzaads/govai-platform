// Policy decision: deterministic mapping from DLP scan + capability to decision.

import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { policyVersionId, type PolicyDecision } from '@govai/core-governance';
import { BASELINE_REGISTRY } from '@govai/core-governance';
import type { DlpScanResult } from './dlp.js';

export type PipelinePolicyContext = {
  capabilityId: string;
  effectiveLevel: 0 | 1 | 2 | 3;
  policyCommitSha: string;
};

export type PipelinePolicyDecision = PolicyDecision & {
  id: string;
};

export function decidePolicy(
  ctx: PipelinePolicyContext,
  dlp: DlpScanResult,
): { decision: PipelinePolicyDecision; redactedText?: string; needsRedaction: boolean } {
  const reasons: string[] = [];
  let kind: 'allow' | 'deny' | 'mutate' | 'ask' = 'allow';
  let needsRedaction = false;

  if (dlp.highestAction === 'deny' && dlp.findings.length > 0) {
    kind = 'deny';
    for (const f of dlp.findings) {
      reasons.push(`dlp.${f.detector}: action=deny match at index ${f.index}`);
    }
  } else if (dlp.highestAction === 'redact' && dlp.findings.length > 0) {
    kind = 'mutate';
    needsRedaction = true;
    for (const f of dlp.findings) {
      const action = dlp.configByDetector.get(f.detector) ?? 'detect';
      reasons.push(`dlp.${f.detector}: action=${action} match at index ${f.index}`);
    }
  } else if (dlp.findings.length > 0) {
    reasons.push(`dlp: ${dlp.findings.length} detection(s), no enforcement action`);
  } else {
    reasons.push('no findings');
  }

  const versionId = policyVersionId({
    policy_code_commit_sha: ctx.policyCommitSha,
    policy_manifest: { kind: 'baseline_dlp_v1', deny_when: 'highest_action=deny' },
    org_policy_overrides: { config_by_detector: Object.fromEntries(dlp.configByDetector) },
    capability_registry_snapshot: BASELINE_REGISTRY.map((c) => ({ id: c.id, status: c.status })),
  });

  const decision: PipelinePolicyDecision = {
    id: randomUUID(),
    kind,
    reasons,
    policy_version_id: versionId,
  };

  return { decision, needsRedaction };
}

export async function persistPolicyDecision(
  client: PoolClient,
  orgId: string,
  runId: string,
  decision: PipelinePolicyDecision,
): Promise<void> {
  await client.query(
    `INSERT INTO govai.policy_decisions (id, run_id, org_id, decision, policy_version_id, reasons, mutations, framework_refs)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::bytea, $6::jsonb, NULL, NULL)`,
    [
      decision.id,
      runId,
      orgId,
      decision.kind,
      Buffer.from(decision.policy_version_id),
      JSON.stringify(decision.reasons),
    ],
  );
}
