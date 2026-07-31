import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

import { appCheckRun, lintBuffer, resetPlatformOSLiquidDocsManager, updateDocs } from './index';
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

  return {
    ...actual,
    PlatformOSLiquidDocsManager: CountingDocsManager,
    // Stubbed so `updateDocs` performs no network I/O in tests.
    downloadPlatformOSLiquidDocs: vi.fn(async () => {}),
  };
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
    root = workspace.root;
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

  it('replays the docset’s diagnostics to each run, and never writes to a finished run’s sink', async () => {
    const earlierRunLog: string[] = [];
    const laterRunLog: string[] = [];

    await lintBuffer({
      root,
      filePath,
      content: "{% assign a = {'a': 5} %}",
      configPath,
      log: (message) => earlierRunLog.push(message),
    });

    // One manager, built with a FORWARDING sink rather than the first run's logger
    // captured forever. Whatever it had already reported by then (a degraded docset
    // explains itself exactly once, since every loader is memoized) was replayed to
    // that run — possibly nothing, when the docset loaded cleanly.
    expect(constructions).toHaveLength(1);
    const alreadyReported = [...earlierRunLog];

    // A diagnostic emitted between runs is not delivered to the finished run's sink
    // behind its back...
    constructions[0]('probe');

    expect(earlierRunLog).toEqual(alreadyReported);

    // ...it is replayed to the next run instead. Without the replay, only the
    // process's FIRST run — for the MCP supervisor a `lintBuffer` call with no `log`
    // at all — ever learns why the docset is reporting valid code as unknown.
    await lintBuffer({
      root,
      filePath,
      content: "{% assign b = {'b': 5} %}",
      configPath,
      log: (message) => laterRunLog.push(message),
    });

    expect(laterRunLog).toEqual([...alreadyReported, 'probe']);
  });

  it('builds a fresh manager after an explicit reset, so a changed docset is re-read', async () => {
    await lintBuffer({ root, filePath, content: "{% assign a = {'a': 5} %}", configPath });
    const before = constructions.length;

    resetPlatformOSLiquidDocsManager();
    await lintBuffer({ root, filePath, content: "{% assign b = {'b': 5} %}", configPath });

    expect(constructions.length).toEqual(before + 1);
  });

  it('drops the shared manager when updateDocs refreshes the docset', async () => {
    await lintBuffer({ root, filePath, content: "{% assign a = {'a': 5} %}", configPath });
    const before = constructions.length;

    // Without this reset the process would keep validating against the docset it
    // read BEFORE the download — e.g. reporting a brand-new filter as unknown.
    await updateDocs();
    await lintBuffer({ root, filePath, content: "{% assign b = {'b': 5} %}", configPath });

    expect(constructions.length).toEqual(before + 1);
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
