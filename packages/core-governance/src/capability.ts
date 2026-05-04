import { z } from 'zod';

export const CapabilityStatus = z.enum(['supported', 'planned', 'blocked', 'experimental']);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

export const EvidenceStrengthSchema = z.enum([
  'hmac_internal',
  'dev_signed',
  'external_anchor',
  'customer_signed',
  'icp_brasil_tsa',
]);
export type EvidenceStrengthEnum = z.infer<typeof EvidenceStrengthSchema>;

export const CapabilityFacet = z
  .object({
    id: z.string().min(1),
    level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    status: CapabilityStatus,
    evidence_strength: EvidenceStrengthSchema.optional(),
    reason: z.string().optional(),
    last_live_test_at: z.string().datetime().optional(),
    docs_url: z.string().url().optional(),
  })
  .refine((f) => (f.level === 3 ? f.evidence_strength !== undefined : true), {
    message: 'level=3 requires evidence_strength',
  });
export type CapabilityFacet = z.infer<typeof CapabilityFacet>;

export const Capability = z.object({
  id: z.string().min(1),
  provider: z.enum(['anthropic', 'openai']),
  status: CapabilityStatus,
  facets: z.array(CapabilityFacet).min(1),
});
export type Capability = z.infer<typeof Capability>;

export const CapabilityRegistry = z.array(Capability);
export type CapabilityRegistry = z.infer<typeof CapabilityRegistry>;

/** Resolve override (downgrade-only). */
export function resolveEffectiveLevel(
  baselineLevel: 0 | 1 | 2 | 3,
  override?: { level_override?: number | null; status_override?: 'blocked' | 'experimental' | null },
): { level: 0 | 1 | 2 | 3; status: CapabilityStatus | null; reason: string | null } {
  if (!override) return { level: baselineLevel, status: null, reason: null };

  let level: 0 | 1 | 2 | 3 = baselineLevel;
  let status: CapabilityStatus | null = null;

  if (override.level_override !== undefined && override.level_override !== null) {
    const lvl = override.level_override;
    if (!Number.isInteger(lvl) || lvl < 0 || lvl > 3) {
      throw new Error(`capability override: level_override out of range (got ${lvl})`);
    }
    if (lvl > baselineLevel) {
      throw new Error(
        `capability override: upgrade not allowed (baseline=${baselineLevel} override=${lvl})`,
      );
    }
    level = lvl as 0 | 1 | 2 | 3;
  }
  if (override.status_override) {
    status = override.status_override;
    if (override.status_override === 'blocked') level = 0;
  }
  return { level, status, reason: null };
}
