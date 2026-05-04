// Smoke test em Node 24: garante que `re2` foi buildado com binário nativo
// e não cai em ReDoS no padrão (a+)+$.
import RE2 from 're2';

const r = new RE2('(a+)+$');
const start = Date.now();
r.test('a'.repeat(30) + 'b');
const elapsed = Date.now() - start;
if (elapsed > 100) {
  console.error(`RE2 unexpectedly slow: ${elapsed}ms`);
  process.exit(1);
}

const r2 = new RE2('hello');
if (!r2.test('hello world')) {
  console.error('RE2 basic test failed');
  process.exit(1);
}

console.warn(`re2 smoke ok (${elapsed}ms)`);
