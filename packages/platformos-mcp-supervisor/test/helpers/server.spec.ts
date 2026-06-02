/**
 * Static helper-shape tests. The stdio integration tests in P22 cover the
 * full boot path; this spec exists so the helper module is reachable by
 * `yarn test` and so accidental regressions in `createTempProject` /
 * `FIXTURE_*_DIR` surface immediately.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';

import {
  startSupervisor,
  createTempProject,
  FIXTURE_PROJECT_DIR,
  FIXTURE_BROKEN_PROJECT_DIR,
  DEFAULT_BIN_PATH,
} from './server';

describe('test/helpers/server', () => {
  it('resolves the fixture directories under the package root', () => {
    expect(FIXTURE_PROJECT_DIR.endsWith('test/fixtures/project')).toBe(true);
    expect(FIXTURE_BROKEN_PROJECT_DIR.endsWith('test/fixtures/broken-project')).toBe(true);
    expect(existsSync(FIXTURE_PROJECT_DIR)).toBe(true);
    expect(existsSync(FIXTURE_BROKEN_PROJECT_DIR)).toBe(true);
  });

  it('resolves the default bin path to dist/bin/platformos-mcp-supervisor.js', () => {
    expect(DEFAULT_BIN_PATH.endsWith('dist/bin/platformos-mcp-supervisor.js')).toBe(true);
  });

  it('startSupervisor rejects when bin is missing', async () => {
    await expect(
      startSupervisor(FIXTURE_PROJECT_DIR, { binPath: '/nonexistent/no-such-bin.js' }),
    ).rejects.toThrow(/bin not found/);
  });

  it('startSupervisor rejects when projectDir is missing', async () => {
    // Use DEFAULT_BIN_PATH even if not built; the projectDir check fires
    // before the bin-existence check is reached when both fail. Force the
    // bin-existence check to pass by pointing at a real file.
    await expect(
      startSupervisor('/nonexistent/no-such-project', { binPath: __filename }),
    ).rejects.toThrow(/projectDir does not exist/);
  });

  describe('createTempProject', () => {
    it('mirrors the source directory into a tmp copy', () => {
      const { dir, cleanup } = createTempProject(FIXTURE_PROJECT_DIR);
      try {
        expect(statSync(dir).isDirectory()).toBe(true);
        // app/ is the canonical platformOS root the fixtures carry; the
        // copy must contain it.
        const entries = readdirSync(dir);
        expect(entries).toContain('app');
      } finally {
        cleanup();
      }
    });

    it('rejects when the source directory is missing', () => {
      expect(() => createTempProject('/nonexistent/missing')).toThrow(/sourceDir does not exist/);
    });
  });
});
