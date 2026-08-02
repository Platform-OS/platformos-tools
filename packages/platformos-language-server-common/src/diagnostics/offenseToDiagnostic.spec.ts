import {
  LiquidCheckDefinition,
  Severity,
  SourceCodeType,
} from '@platformos/platformos-check-common';
import { check } from '@platformos/platformos-check-common/src/test';
import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { offenseToDiagnostic } from './offenseToDiagnostic';

/**
 * `offenseToDiagnostic` copies an `Offense`'s line and character straight into an LSP
 * `Range` — no conversion, no clamping. So check-common's offset-to-position mapping
 * IS the range VS Code renders, and this file is the language server's stake in it.
 *
 * It exists because the mapping is shared with the MCP supervisor, which converts to
 * 1-based line/column instead. A fix made for one consumer moves the other silently,
 * and until now only the supervisor side was pinned.
 */

/** Reports one offense over the exact offsets it is given, whatever is there. */
const ReportsRange = (startIndex: number, endIndex: number): LiquidCheckDefinition => ({
  meta: {
    code: 'ReportsRange',
    name: 'Reports the range it was constructed with',
    docs: { description: 'Test double', recommended: true },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },
  create(context) {
    return {
      async onCodePathStart() {
        context.report({ message: 'here', startIndex, endIndex });
      },
    };
  },
});

const rangeFor = async (source: string, startIndex: number, endIndex: number) => {
  const offenses = await check({ 'app/views/pages/index.liquid': source }, [
    ReportsRange(startIndex, endIndex),
  ]);
  return offenseToDiagnostic(offenses[0]).range;
};

/** What the LSP's own document model says those offsets mean. */
const lspRangeFor = (source: string, startIndex: number, endIndex: number) => {
  const document = TextDocument.create('file:///index.liquid', 'liquid', 0, source);
  return { start: document.positionAt(startIndex), end: document.positionAt(endIndex) };
};

describe('Module: offenseToDiagnostic', () => {
  it('gives a CRLF terminator a range inside the line, matching LF', async () => {
    // `{{ x ` is five characters. Under LF the terminator is character 5, the
    // end-of-line insertion point. Under CRLF it used to be 6 — one past a line that
    // has no sixth character. VS Code hid it by clamping on render; the supervisor,
    // which has no clamp, published the impossible column.
    const crlf = '{{ x \r\n{{ y';
    const lf = '{{ x \n{{ y';

    expect({
      crlf: await rangeFor(crlf, 6, 6),
      lf: await rangeFor(lf, 5, 5),
    }).toEqual({
      crlf: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
      lf: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
    });
  });

  it('places an end-of-input range on the empty last line', async () => {
    // The position every unterminated YAML construct reports at.
    const source = 'name: "oops\n';

    expect(await rangeFor(source, source.length, source.length)).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
  });

  it('agrees with the LSP document model across line endings and end of input', async () => {
    // The general statement the two cases above are instances of. Asserted against
    // the implementation the language server itself uses, so this cannot drift into
    // pinning a restatement of the specification instead of the specification.
    const cases: [string, number, number][] = [
      ['{{ x \r\n{{ y', 5, 6],
      ['{{ x \r\n{{ y', 6, 7],
      ['{{ x \n{{ y', 5, 6],
      ['a\r\n\r\nb', 3, 4],
      ['name: "oops\n', 12, 12],
      ['name: "oops', 11, 11],
      ['a: 1\rb: 2\r', 4, 5],
    ];

    const ours = [];
    for (const [source, startIndex, endIndex] of cases) {
      ours.push(await rangeFor(source, startIndex, endIndex));
    }

    expect(ours).toEqual(
      cases.map(([source, startIndex, endIndex]) => lspRangeFor(source, startIndex, endIndex)),
    );
  });
});
