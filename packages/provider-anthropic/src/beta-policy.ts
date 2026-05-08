// ANTHROPIC_BETA_POLICY — literal of Matrix v2 §13. 9 entries, frozen at module load.
// Token literals are exact (with full date suffixes); modifying this list requires PR + ADR.

import type { BetaTokenPolicyEntry } from '@govai/core-types';

export const ANTHROPIC_BETA_POLICY: ReadonlyArray<BetaTokenPolicyEntry> = Object.freeze([
  {
    beta_token: 'files-api-2025-04-14',
    policy: 'global_allowlist',
    adr: 'ADR-014',
    reason:
      'Files capability obrigatória em Macro Native Substrate Contract (Addendum §6.2)',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/files',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'prompt-caching-2024-07-31',
    policy: 'verification_required',
    reason:
      'Prompt caching pode ter migrado para parametrização nativa via cache_control no body. Resolução posterior à execução do Batch A.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/prompt-caching',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'message-batches-2024-09-24',
    policy: 'verification_required',
    reason:
      'Batches API pode ter migrado para GA. Se Batch D for promovido em PR2, vira global_allowlist por ADR-016; senão removed_as_no_longer_needed/denied_until_decision.',
    source_doc: 'https://docs.anthropic.com/en/api/creating-message-batches',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'output-300k-2026-03-24',
    policy: 'denied_until_decision',
    reason:
      'Beta de Batches para output longo. Decisão depende de promoção do Batch D.',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'computer-use-2025-11-24',
    policy: 'hard_denied',
    reason:
      'Risk Class D. Computer Use exige primitive de governança dedicada (PR8+). NÃO habilitável via org_beta_overrides; mudança requer PR + ADR + governance primitive real.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/computer-use',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'computer-use-2025-01-24',
    policy: 'hard_denied',
    reason: 'Risk Class D. Mesmas restrições. Aplica a modelos Claude pré-4.5.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/computer-use',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'computer-use-2024-10-22',
    policy: 'hard_denied',
    reason: 'Risk Class D — legacy beta token. Mantido por compatibilidade histórica.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/computer-use',
    pinned_at: '2026-05-06T00:00:00Z',
    legacy: true,
  },
  {
    beta_token: 'managed-agents-2026-04-01',
    policy: 'denied_until_decision',
    reason:
      'Anthropic-hosted managed agents (descoberto em validação). Decisão de produto pendente; ESCALATION-A3 → planned PR4-or-later.',
    source_doc: 'https://docs.claude.com/en/release-notes/api',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'skills-2025-10-02',
    policy: 'denied_until_decision',
    reason: 'Skills carregamento. Fora de escopo PR2-PR4. Decisão pós-PR4.',
    pinned_at: '2026-05-06T00:00:00Z',
  },
]);

/** Versioned identifier of the policy snapshot — used in audit `allowlist_version`. */
export const ANTHROPIC_BETA_POLICY_VERSION = 'anthropic-beta-policy@2026-05-06';

// Production readiness gate (deferred to Batch M, NOT enforced in Batch A):
// ANTHROPIC_BETA_POLICY não pode conter `verification_required` antes de release production.
// Batch M deve resolver `prompt-caching-2024-07-31` e `message-batches-2024-09-24`
// para `global_allowlist`, `denied_until_decision` ou `removed_as_no_longer_needed`,
// conforme verificação técnica e decisão arquitetural.
