import { describe, expect, it } from 'vitest';

import { CHECK_ERROR_CODE, check as coreCheck } from './index';
import * as path from './path';
import { getApp, MockFileSystem } from './test';
import { LiquidCheckDefinition, Offense, Severity, SourceCodeType } from './types';

const rootUri = path.normalize('file:/');
const PAGE = 'app/views/pages/index.liquid';
const APP = { [PAGE]: `{% assign a = 1 %}{% assign b = 2 %}` };

/**
 * A check that reports one offense and then dies, which is what a real one does when
 * it reads a field off markup the parser could not structure. Before the failure was
 * surfaced, the run kept the first offense, lost the second, and said nothing — a
 * shrunken offense set that reads exactly like a clean file.
 */
const Exploding: LiquidCheckDefinition = {
  meta: {
    code: 'Exploding',
    name: 'Throws part-way through a file',
    docs: { description: 'Test double.', recommended: false },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.WARNING,
    schema: {},
    targets: [],
  },

  create(context) {
    let seen = 0;
    return {
      async LiquidTag(node) {
        seen += 1;
        if (seen > 1) throw new Error('the analyzer died');
        context.report({
          message: 'found before the throw',
          startIndex: node.position.start,
          endIndex: node.position.end,
        });
      },
    };
  },
};

const runWithoutErrorHandler = (onError?: (error: Error) => void): Promise<Offense[]> => {
  const fs = new MockFileSystem({ '.platformos-check.yml': '', ...APP });
  return coreCheck(
    getApp(APP, fs),
    { settings: {}, checks: [Exploding], rootUri, onError },
    { fs },
  );
};

describe('Unit: a check that throws part-way through a file', () => {
  it('surfaces the failure as an offense, keeping what the check reported before it', async () => {
    expect(await runWithoutErrorHandler()).toEqual([
      {
        type: SourceCodeType.LiquidHtml,
        check: 'Exploding',
        message: 'found before the throw',
        uri: path.join(rootUri, PAGE),
        severity: Severity.WARNING,
        start: { index: 0, line: 0, character: 0 },
        end: { index: 18, line: 0, character: 18 },
        fix: undefined,
        suggest: undefined,
      },
      {
        type: SourceCodeType.LiquidHtml,
        check: CHECK_ERROR_CODE,
        message: 'Exploding failed on this file and did not finish checking it: the analyzer died',
        uri: path.join(rootUri, PAGE),
        severity: Severity.ERROR,
        start: { index: 0, line: 0, character: 0 },
        end: { index: 0, line: 0, character: 0 },
      },
    ]);
  });

  it('still hands the error to a host that installed onError', async () => {
    const seen: string[] = [];
    const offenses = await runWithoutErrorHandler((error) => seen.push(error.message));

    expect(seen).toEqual(['the analyzer died']);
    expect(offenses.map((offense) => offense.check)).toEqual(['Exploding', CHECK_ERROR_CODE]);
  });
});
