import { Capability, CapabilityRegistry } from './capability.js';

export const BASELINE_REGISTRY: ReadonlyArray<Capability> = Object.freeze([
  Capability.parse({
    id: 'anthropic.messages.create',
    provider: 'anthropic',
    status: 'planned',
    facets: [
      { id: 'pre_dlp', level: 2, status: 'planned' },
      { id: 'final_hash', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
    ],
  }),
  Capability.parse({
    id: 'anthropic.messages.stream',
    provider: 'anthropic',
    status: 'planned',
    facets: [
      { id: 'pre_dlp', level: 2, status: 'planned' },
      { id: 'final_hash', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
      { id: 'realtime_audit', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
    ],
  }),
  Capability.parse({
    id: 'anthropic.messages.tools',
    provider: 'anthropic',
    status: 'planned',
    facets: [{ id: 'tool_call_audit', level: 2, status: 'planned' }],
  }),
  Capability.parse({
    id: 'openai.responses.create',
    provider: 'openai',
    status: 'planned',
    facets: [
      { id: 'pre_dlp', level: 2, status: 'planned' },
      { id: 'final_hash', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
    ],
  }),
  Capability.parse({
    id: 'openai.responses.stream',
    provider: 'openai',
    status: 'planned',
    facets: [
      { id: 'pre_dlp', level: 2, status: 'planned' },
      { id: 'final_hash', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
      { id: 'realtime_audit', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
    ],
  }),
  Capability.parse({
    id: 'openai.chat.completions.create',
    provider: 'openai',
    status: 'planned',
    facets: [
      { id: 'pre_dlp', level: 2, status: 'planned' },
      { id: 'final_hash', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
    ],
  }),
  Capability.parse({
    id: 'openai.chat.completions.stream',
    provider: 'openai',
    status: 'planned',
    facets: [
      { id: 'pre_dlp', level: 2, status: 'planned' },
      { id: 'final_hash', level: 3, status: 'planned', evidence_strength: 'hmac_internal' },
    ],
  }),
  Capability.parse({
    id: 'openai.responses.tools',
    provider: 'openai',
    status: 'planned',
    facets: [{ id: 'tool_call_audit', level: 2, status: 'planned' }],
  }),
]);

export function validateRegistry(reg: ReadonlyArray<Capability> = BASELINE_REGISTRY): void {
  CapabilityRegistry.parse(reg);
}

export function findCapability(id: string): Capability | undefined {
  return BASELINE_REGISTRY.find((c) => c.id === id);
}
