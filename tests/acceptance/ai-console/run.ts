// Entry point for the AI Console acceptance stack.
//
//   pnpm acceptance:ai-console          hermetic — a local loopback upstream, no cost
//   pnpm acceptance:ai-console live     LIVE — the REAL providers, real money
//
// Brings the stack up, prints the operator key to paste into /enter, and stays alive until
// Ctrl-C. Run the UI beside it with:
//
//   pnpm --filter @govai/ui dev
//
// and open http://localhost:5173/app/enter — the dev server proxies /v1, /governed,
// /passthrough and /health to this API, which is the same same-origin topology production uses.
//
// Prompt markers the HERMETIC loopback upstream understands (type them in a message):
//   #slow     a long, slowly-emitted stream — use it to exercise Stop
//   #cut      text, then a killed socket with no terminal event (unconfirmed outcome)
//   #429      a rate-limited provider response, with Retry-After
//   #400      a provider invalid_request_error
//   #500      a provider server error
//   #unicode  multi-byte text split across chunk boundaries
//
// ★ LIVE MODE SPENDS MONEY AND IS BOUNDED BY THE OPERATOR, NOT BY THIS SCRIPT. It reads
// OPENAI_API_KEY and ANTHROPIC_API_KEY from the environment, provisions them through the
// canonical admin route, and never prints, stores or logs them. Keep prompts short, keep
// max_tokens small, and count the calls.

import { startAcceptanceStack, type AcceptanceMode } from './stack.js';
import { LOOPBACK_MARKERS } from './loopback-provider.js';

function parseMode(argv: readonly string[]): AcceptanceMode {
  const raw = argv.find((a) => a === 'live' || a === 'hermetic');
  return raw === 'live' ? 'live' : 'hermetic';
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const stack = await startAcceptanceStack(mode);

  const line = '─'.repeat(78);
  console.warn(`\n${line}`);
  console.warn(`GovAI AI Console — acceptance stack [${mode.toUpperCase()}]`);
  console.warn(line);
  if (mode === 'live') {
    console.warn('★ LIVE: the REAL OpenAI and Anthropic APIs. Every send costs money.');
    console.warn('  Provider credentials were provisioned through POST /v1/admin/provider-credentials');
    console.warn('  and are NOT printed anywhere.');
  }
  console.warn(`API                 http://127.0.0.1:8080`);
  console.warn(
    `Upstream            ${stack.provider ? stack.provider.baseUrl : 'THE REAL PROVIDERS (api.openai.com / api.anthropic.com)'}`,
  );
  console.warn(`Organization        ${stack.org.org_id}`);
  console.warn(`Tier / mode         business / production`);
  console.warn('');
  console.warn('OPERATOR KEY (paste this into /enter — roles: auditor, developer):');
  console.warn(`  ${stack.org.operator_api_key}`);
  console.warn('');
  // ★ The admin key is NOT printed. Provisioning already used it, in-process, and the browser
  // must never receive it — so writing a privileged credential into terminal output, shell
  // history and any captured acceptance log buys nothing and exposes something. It stays on the
  // returned stack object for a programmatic caller that genuinely needs it.
  console.warn('An admin key was created for provisioning and is deliberately not printed.');
  console.warn('');
  if (stack.provider) {
    console.warn('Prompt markers understood by the loopback upstream:');
    for (const [name, marker] of Object.entries(LOOPBACK_MARKERS)) {
      console.warn(`  ${marker.padEnd(10)} ${name}`);
    }
    console.warn('');
  }
  console.warn('Now run, in another shell:  pnpm --filter @govai/ui dev');
  console.warn('Then open:                  http://localhost:5173/app/enter');
  console.warn('');
  // The console's own receipt deliberately refuses to correlate a turn to one audit event, so
  // the evidence loop has to be closed OUTSIDE the browser: drive some conversation, then seal
  // the captures it produced and read the chain. `EVIDENCE_T_SEAL_SECONDS` is 0 in this stack,
  // so every capture is immediately past its seal SLO and the sealer has work the moment it
  // starts. Printed rather than launched: sealing is an operator act, not a side effect of
  // opening a browser tab.
  console.warn('To close the evidence loop (seal what the conversations captured), run:');
  console.warn(
    `  AUDIT_SEALER_DATABASE_URL='${stack.db.adminUrl}' \\\n` +
      `  AUDIT_SEALER_ORG_IDS='${stack.org.org_id}' \\\n` +
      `  AUDIT_SEALER_IDLE_SLEEP_MS=500 \\\n` +
      `  DATABASE_URL='${stack.db.appUrl}' \\\n` +
      `  KMS_DEV_SEED='${stack.env.KMS_DEV_SEED ?? ''}' GOVAI_KMS_PROVIDER=dev NODE_ENV=test \\\n` +
      `  pnpm --filter @govai/audit-sealer dev`,
  );
  console.warn(`${line}\n`);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    console.warn('\nshutting the acceptance stack down…');
    void stack
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
