// Path/URL-safe "am I the program entrypoint?" check for ESM executables (M2A F2).
//
// The naive guard `import.meta.url === \`file://${process.argv[1]}\`` compares two
// DIFFERENT representations of a filesystem location and silently no-ops whenever
// they diverge: `import.meta.url` percent-encodes reserved characters (a checkout
// under ".../GovAI GRC Platform/..." yields `GovAI%20GRC%20Platform`) while argv[1]
// is the raw path; symlinked directories (macOS `/tmp` → `/private/tmp`) differ
// too. M2 real-provider acceptance reproduced `pnpm --filter @govai/api run
// migrate|dev` exiting 0 with NO output and NO effect for exactly that reason.
//
// This helper compares canonical filesystem paths instead:
//   fileURLToPath(import.meta.url) → realpath   vs   resolve(argv1) → realpath
// It is pure (no process.exit, no I/O side effects beyond realpath lookups) and
// fails CLOSED (returns false) when argv1 is absent or identity cannot be
// established safely (non-file URL, unreadable path).

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True iff the module identified by `importMetaUrl` is the process entrypoint
 * (`argv1`, default `process.argv[1]`), compared as canonical real filesystem
 * paths. Handles spaces, percent-encoded file URLs, relative argv paths and
 * symlink aliases. Returns false when argv1 is missing or canonicalization
 * fails (never throws).
 */
export function isMainModule(importMetaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (typeof argv1 !== 'string' || argv1.length === 0) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(importMetaUrl));
    const entryPath = realpathSync(resolve(argv1));
    return modulePath === entryPath;
  } catch {
    return false;
  }
}
