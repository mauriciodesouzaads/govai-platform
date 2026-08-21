// UI-PERF-01 introduced route splitting, and route splitting introduced a way for the whole
// authenticated application to disappear: `Suspense` owns a PENDING dynamic import and does
// nothing for a REJECTED one. Codex found it on the final head; these tests pin the behaviour.
//
// ★ The boundary must be narrow. A boundary that catches everything would replace real bugs
// with "something went wrong", which is the same dishonesty this UI refuses everywhere else —
// so the "does NOT swallow" case matters at least as much as the "does catch" case.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { RouteErrorBoundary, isChunkLoadError } from '../src/app/RouteErrorBoundary.js';
import { renderApp } from './render.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';

const T = CATALOGS['pt-BR'];

/** React logs a caught error; silence it so a passing test does not print a fake failure. */
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

function Boom({ error }: { error: unknown }): never {
  throw error;
}

describe('isChunkLoadError — the messages browsers actually produce', () => {
  it('recognises every engine phrasing and the Vite preload wrapper', () => {
    const cases = [
      new TypeError('Failed to fetch dynamically imported module: /assets/CockpitPage-abc.js'),
      new TypeError('error loading dynamically imported module: /assets/GapsPage-abc.js'),
      new TypeError('Importing a module script failed.'),
      new Error('Unable to preload CSS for /assets/index-abc.css'),
      new Error('Failed to load module script: expected a JavaScript module'),
      Object.assign(new Error('boom'), { name: 'ChunkLoadError' }),
    ];
    for (const error of cases) {
      expect(isChunkLoadError(error), String((error as Error).message)).toBe(true);
    }
  });

  it('does NOT claim an ordinary application error', () => {
    for (const error of [
      new TypeError("Cannot read properties of undefined (reading 'map')"),
      new Error('assertion failed'),
      new Error(''),
      null,
      undefined,
      'a string',
      42,
    ]) {
      expect(isChunkLoadError(error), String(error)).toBe(false);
    }
  });
});

describe('RouteErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    renderApp(
      <RouteErrorBoundary>
        <p data-testid="screen">the screen</p>
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('screen')).toBeInTheDocument();
    expect(screen.queryByTestId('chunk-load-error')).toBeNull();
  });

  it('catches a rejected chunk import and offers a reload instead of unmounting the app', () => {
    renderApp(
      <RouteErrorBoundary>
        <Boom error={new TypeError('Failed to fetch dynamically imported module: /assets/x.js')} />
      </RouteErrorBoundary>,
    );
    const panel = screen.getByTestId('chunk-load-error');
    expect(panel).toHaveTextContent(T['app.chunkError.title']);
    expect(panel).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('chunk-load-reload')).toHaveTextContent(T['app.chunkError.reload']);
  });

  it('★ does NOT swallow an ordinary error — a real bug must stay visible', () => {
    expect(() =>
      renderApp(
        <RouteErrorBoundary>
          <Boom error={new TypeError("Cannot read properties of undefined (reading 'map')")} />
        </RouteErrorBoundary>,
      ),
    ).toThrow(/Cannot read properties of undefined/);
    expect(screen.queryByTestId('chunk-load-error')).toBeNull();
  });

  it('the failure copy tells the reader what a reload costs them', () => {
    renderApp(
      <RouteErrorBoundary>
        <Boom error={new TypeError('Failed to fetch dynamically imported module: /assets/x.js')} />
      </RouteErrorBoundary>,
    );
    // It must not imply the conversation survives: the transcript is memory-only.
    expect(screen.getByTestId('chunk-load-error')).toHaveTextContent(
      T['app.chunkError.description'],
    );
  });
});
