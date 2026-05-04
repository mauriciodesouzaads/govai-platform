import { z } from 'zod';
import { canonicalize, sha256 } from '@govai/core-audit';

export const PolicyDecisionKind = z.enum(['allow', 'deny', 'mutate', 'ask']);
export type PolicyDecisionKind = z.infer<typeof PolicyDecisionKind>;

export type PolicyDecision = {
  kind: PolicyDecisionKind;
  reasons: ReadonlyArray<string>;
  mutations?: ReadonlyArray<unknown>;
  framework_refs?: ReadonlyArray<string>;
  policy_version_id: Uint8Array;
};

export function policyVersionId(input: {
  policy_code_commit_sha: string;
  policy_manifest: unknown;
  org_policy_overrides: unknown;
  capability_registry_snapshot: unknown;
}): Uint8Array {
  const canonical = canonicalize({
    policy_code_commit_sha: input.policy_code_commit_sha,
    policy_manifest: input.policy_manifest,
    org_policy_overrides: input.org_policy_overrides,
    capability_registry_snapshot: input.capability_registry_snapshot,
  });
  return sha256(Buffer.from(canonical, 'utf8'));
}
