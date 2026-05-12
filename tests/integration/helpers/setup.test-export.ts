// Re-export of pure functions from tests/integration/setup.ts that are safe
// to import without triggering testcontainers startup. The setup module is
// import-side-effect free for these symbols, but routing the import through
// this narrow surface keeps it obvious in test files that no real Postgres
// container is being started.

export { isExpectedPostgresTeardownError } from '../setup.js';
