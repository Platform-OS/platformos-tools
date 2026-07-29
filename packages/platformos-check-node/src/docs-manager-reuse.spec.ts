import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { URI } from 'vscode-uri';

import { appCheckRun, lintBuffer } from './index';
import { Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * Records the log sink of every docs manager constructed in this process.
 * Deliberately NOT reset between tests: the point under test is that the manager
 * is built once for the whole process, so the count must stay at 1 as further
 * lint runs happen.
 */
const constructions: Array<(message: string) => void> = [];

vi.mock('@platformos/platformos-check-docs-updater', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platformos/platformos-check-docs-updater')>();

  class CountingDocsManager extends actual.PlatformOSLiquidDocsManager {
    constructor(log: (message: string) => void = () => {}) {
      super(log);
      constructions.push(log);
    }
  }

  return { ...actual, PlatformOSLiquidDocsManager: CountingDocsManager };
});

/**
 * The docset is a process-level constant, and every loader on the manager —
 * including the `setup()` network revision check — is a per-instance memo. One
 * instance per process is therefore both correct and the difference between paying
 * that network round trip once and paying it on every lint run.
 */
describe('Integration: docs manager reuse across lint runs', () => {
  let workspace: Workspace;
  let root: string;
  let configPath: string;
  let filePath: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace({
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'JsonLiteralQuoteStyle:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: {
        views: {
          partials: {
            'card.liquid': '{% assign a = {"a": 5} %}',
          },
        },
      },
    });
    root = URI.parse(workspace.rootUri).fsPath;
    configPath = path.join(root, '.platformos-check.yml');
    filePath = path.join(root, 'app/views/partials/card.liquid');
  });

  afterEach(async () => {
    await workspace?.clean();
  });

  it('constructs the docs manager once, however many lint runs happen', async () => {
    await lintBuffer({ root, filePath, content: "{% assign a = {'a': 5} %}", configPath });
    await lintBuffer({ root, filePath, content: "{% assign b = {'b': 5} %}", configPath });
    await appCheckRun(root, configPath);

    expect(constructions).toHaveLength(1);
  });

  it('routes docset diagnostics to the current run’s log sink, not the first run’s', async () => {
    const earlierRunLog: string[] = [];
    const laterRunLog: string[] = [];

    await lintBuffer({
      root,
      filePath,
      content: "{% assign a = {'a': 5} %}",
      configPath,
      log: (message) => earlierRunLog.push(message),
    });
    await lintBuffer({
      root,
      filePath,
      content: "{% assign b = {'b': 5} %}",
      configPath,
      log: (message) => laterRunLog.push(message),
    });

    // Still one manager, and it was built with a FORWARDING sink rather than run
    // one's logger captured forever...
    expect(constructions).toHaveLength(1);

    // ...so what it logs now lands in the latest run's sink, and the earlier run's
    // sink is not written to behind its back.
    const earlierBefore = earlierRunLog.length;
    const laterBefore = laterRunLog.length;
    constructions[0]('probe');

    expect(earlierRunLog).toHaveLength(earlierBefore);
    expect(laterRunLog.slice(laterBefore)).toEqual(['probe']);
  });

  it('still lints correctly through the shared manager', async () => {
    const offenses = await lintBuffer({
      root,
      filePath,
      content: "{% assign a = {'a': 5} %}",
      configPath,
    });

    expect(offenses.map((offense) => offense.check)).toEqual(['JsonLiteralQuoteStyle']);
  });
});
