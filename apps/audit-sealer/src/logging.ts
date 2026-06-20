// Structured logging for the runner (SPEC-B3 §5). pino, no raw payloads/secrets;
// errors are sanitized via the library's `sanitizeSealerError` before logging.

import pino, { type Logger } from 'pino';
import { sanitizeSealerError } from '@govai/core-audit';

export type SealerLogger = Logger;

export function createLogger(opts: { level?: string } = {}): SealerLogger {
  return pino({
    level: opts.level ?? process.env['AUDIT_SEALER_LOG_LEVEL'] ?? 'info',
    base: { service: 'audit-sealer' },
  });
}

export { sanitizeSealerError };
