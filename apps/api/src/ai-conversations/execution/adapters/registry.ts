// Adapter selection for a resolved dispatch plan (EP-AI-CONVERSATION-CONTINUITY-V1 P0-D1).
//
// ★ KEYED ON THE PLAN, NEVER ON A MODEL. `resolveDispatchPlan` already adjudicated the durable
// (provider, surface, mode) triple fail-closed; this function attaches the continuation
// strategy to the SAME resolution. It takes no model input and holds no model vocabulary
// (LAW NX-2): a new provider model on an already-supported surface flows through with no GovAI
// release, exactly as in P0-C.
//
// ★ EXHAUSTIVE OVER THE PLAN TYPE, fail-closed by construction: `DispatchPlan.provider` is the
// closed two-member union the dispatch registry emits, so a future provider (codex,
// claude_code — P0-D2) cannot reach this switch without FIRST widening the dispatch registry,
// where the P0-D2 wall is enforced. There is no default arm to silently absorb one.

import type { DispatchPlan } from '../../dispatch-registry.js';
import type { ProviderConversationAdapter } from './conversation-adapter.js';
import { anthropicMessagesAdapter } from './anthropic-messages.js';
import { openaiResponsesAdapter } from './openai-responses.js';

export function resolveConversationAdapter(plan: DispatchPlan): ProviderConversationAdapter {
  switch (plan.provider) {
    case 'anthropic':
      return anthropicMessagesAdapter;
    case 'openai':
      return openaiResponsesAdapter;
  }
}
