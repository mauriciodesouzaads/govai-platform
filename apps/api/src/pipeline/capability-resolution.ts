// Capability resolution + hermetic-only guard for `planned` capabilities.

import type { PoolClient } from 'pg';
import {
  BASELINE_REGISTRY,
  findCapability,
  resolveEffectiveLevel,
  type Capability,
  type CapabilityFacet,
} from '@govai/core-governance';
import type { GovAIEnv } from '@govai/config';

export class CapabilityNotSupportedError extends Error {
  constructor(
    public readonly capabilityId: string,
    public readonly status: 'planned' | 'blocked' | 'experimental',
  ) {
    super(`capability ${capabilityId} status=${status} cannot be executed in current environment`);
    this.name = 'CapabilityNotSupportedError';
  }
}

export class CapabilityNotRegisteredError extends Error {
  constructor(public readonly capabilityId: string) {
    super(`capability ${capabilityId} not registered`);
    this.name = 'CapabilityNotRegisteredError';
  }
}

export type EffectiveFacet = {
  facet: CapabilityFacet;
  effectiveLevel: 0 | 1 | 2 | 3;
  effectiveStatus: 'supported' | 'planned' | 'blocked' | 'experimental';
  appliedOverride: boolean;
};

export type ResolvedCapability = {
  capability: Capability;
  effectiveFacets: ReadonlyArray<EffectiveFacet>;
  /**
   * Worst effective status across all facets — drives top-level execution gating.
   * If any facet is `blocked`, the capability is blocked. Otherwise the most
   * restrictive of `planned`/`experimental`/`supported`.
   */
  effectiveStatus: 'supported' | 'planned' | 'blocked' | 'experimental';
};

const STATUS_RANK: Record<'supported' | 'planned' | 'blocked' | 'experimental', number> = {
  supported: 0,
  planned: 2,
  experimental: 3,
  blocked: 4,
};

/**
 * Strict loopback check using URL parser. Rejects userinfo, non-loopback hostnames,
 * DNS-rebind tricks like `http://localhost.attacker.com`, and userinfo smuggling
 * like `http://127.0.0.1:80@evil.com` (where the actual host is evil.com).
 */
export function isLoopbackUrl(raw: string): boolean {
  if (raw.length === 0) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

/**
 * Enforce that `planned` capabilities can only be exercised against a hermetic
 * provider (loopback URL) AND under a hermetic process flag. Any other case
 * yields CapabilityNotSupportedError, which the route maps to 403.
 *
 * Production hardening: env loader rejects GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION
 * during boot when NODE_ENV=production, so this guard cannot be turned off in prod.
 *
 * Accepts either a raw Capability (legacy callers) or a ResolvedCapability so the
 * org-level `status_override` (downgrade-only) is honored at execution time.
 */
export function assertCapabilityExecutable(
  arg: Capability | ResolvedCapability,
  env: GovAIEnv,
): void {
  const status = 'effectiveStatus' in arg ? arg.effectiveStatus : arg.status;
  const id = 'effectiveStatus' in arg ? arg.capability.id : arg.id;

  if (status === 'supported') return;
  if (status === 'planned') {
    const isHermeticEnv = env.NODE_ENV === 'test' || env.GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION;
    const baseUrl = env.GOVAI_PROVIDER_BASE_URL ?? '';
    if (!isHermeticEnv || !isLoopbackUrl(baseUrl)) {
      throw new CapabilityNotSupportedError(id, 'planned');
    }
    return;
  }
  // blocked / experimental → forbidden in this patch.
  throw new CapabilityNotSupportedError(id, status);
}

export type CapabilityOverrideRow = {
  capability_id: string;
  facet_id: string;
  level_override: number | null;
  status_override: 'blocked' | 'experimental' | null;
};

export async function loadOrgOverrides(
  client: PoolClient,
  capabilityId: string,
): Promise<CapabilityOverrideRow[]> {
  const r = await client.query<CapabilityOverrideRow>(
    `SELECT capability_id, facet_id, level_override, status_override
       FROM govai.capability_overrides
      WHERE capability_id = $1`,
    [capabilityId],
  );
  return r.rows;
}

export function resolveCapability(
  capabilityId: string,
  overrides: ReadonlyArray<CapabilityOverrideRow>,
): ResolvedCapability {
  const cap = findCapability(capabilityId);
  if (!cap) throw new CapabilityNotRegisteredError(capabilityId);

  const effectiveFacets: EffectiveFacet[] = cap.facets.map((facet) => {
    const o = overrides.find((x) => x.facet_id === facet.id);
    if (!o) {
      return {
        facet,
        effectiveLevel: facet.level,
        effectiveStatus: facet.status,
        appliedOverride: false,
      };
    }
    const eff = resolveEffectiveLevel(facet.level, {
      level_override: o.level_override,
      status_override: o.status_override,
    });
    return {
      facet,
      effectiveLevel: eff.level,
      effectiveStatus: eff.status ?? facet.status,
      appliedOverride: true,
    };
  });

  // Worst-effective rollup at the capability level.
  let effectiveStatus: 'supported' | 'planned' | 'blocked' | 'experimental' = cap.status;
  for (const ef of effectiveFacets) {
    if (STATUS_RANK[ef.effectiveStatus] > STATUS_RANK[effectiveStatus]) {
      effectiveStatus = ef.effectiveStatus;
    }
  }

  return { capability: cap, effectiveFacets, effectiveStatus };
}

export function listAllCapabilitiesWithOverrides(
  overridesByCapability: Map<string, CapabilityOverrideRow[]>,
): ReadonlyArray<ResolvedCapability> {
  return BASELINE_REGISTRY.map((cap) => {
    const ovs = overridesByCapability.get(cap.id) ?? [];
    return resolveCapability(cap.id, ovs);
  });
}
