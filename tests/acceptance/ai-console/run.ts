// Entry point for the hermetic AI Console acceptance stack.
//
//   pnpm acceptance:ai-console
//
// Brings the stack up, prints the operator key to paste into /enter, and stays alive until
// Ctrl-C. Run the UI beside it with:
//
//   pnpm --filter @govai/ui dev
//
// and open http://localhost:5173/app/enter — the dev server proxies /v1, /governed,
// /passthrough and /health to this API, which is the same same-origin topology production uses.
//
// Prompt markers the loopback upstream understands (type them in a message):
//   #slow     a long, slowly-emitted stream — use it to exercise Stop
//   #cut      text, then a killed socket with no terminal event (unconfirmed outcome)
//   #429      a rate-limited provider response, with Retry-After
//   #400      a provider invalid_request_error
//   #500      a provider server error
//   #unicode  multi-byte text split across chunk boundaries

import { startAcceptanceStack } from './stack.js';
import { LOOPBACK_MARKERS } from './loopback-provider.js';

async function main(): Promise<void> {
  const stack = await startAcceptanceStack();

  const line = '─'.repeat(78);
  console.warn(`\n${line}`);
  console.warn('GovAI AI Console — hermetic acceptance stack');
  console.warn(line);
  console.warn(`API                 http://127.0.0.1:8080`);
  console.warn(`Loopback provider   ${stack.provider.baseUrl}`);
  console.warn(`Organization        ${stack.org.org_id}`);
  console.warn(`Tier / mode         business / production`);
  console.warn('');
  console.warn('OPERATOR KEY (paste this into /enter — roles: auditor, developer):');
  console.warn(`  ${stack.org.operator_api_key}`);
  console.warn('');
  console.warn('ADMIN KEY (provisioning only — never paste into the browser):');
  console.warn(`  ${stack.org.admin_api_key}`);
  console.warn('');
  console.warn('Prompt markers understood by the loopback upstream:');
  for (const [name, marker] of Object.entries(LOOPBACK_MARKERS)) {
    console.warn(`  ${marker.padEnd(10)} ${name}`);
  }
  console.warn('');
  console.warn('Now run, in another shell:  pnpm --filter @govai/ui dev');
  console.warn('Then open:                  http://localhost:5173/app/enter');
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
