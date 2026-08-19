import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './msw/server.js';

// MSW intercepts every request the API client makes, so no test ever reaches a real API.
// `onUnhandledRequest: 'error'` is deliberate: a request a test did not declare is a request
// the test does not actually control, and silently letting it through is how an assertion ends
// up passing for the wrong reason.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  // Every test asserts against storage that starts empty (see the credential-persistence
  // tests); clearing here keeps that guarantee independent of execution order.
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterAll(() => {
  server.close();
});
