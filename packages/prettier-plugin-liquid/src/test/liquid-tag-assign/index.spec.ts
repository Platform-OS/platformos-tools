import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from 'vitest';

import { assertFormattedEqualsFixed, format } from '../test-helpers';

test('Unit: liquid-tag-assign', async () => {
  await assertFormattedEqualsFixed(__dirname);
});

/** The assignment TARGETS in a formatted document, in order — the text before ` = ` / ` << `. */
function targetsIn(formatted: string): string[] {
  return formatted
    .split('\n')
    .filter((line) => line.trimStart().startsWith('{% assign '))
    .map((line) => {
      const start = line.indexOf('{% assign ') + '{% assign '.length;
      const operator = Math.min(
        ...[' = ', ' << '].map((op) => {
          const at = line.indexOf(op, start);
          return at === -1 ? Number.POSITIVE_INFINITY : at;
        }),
      );
      return line.slice(start, operator).trim();
    })
    .filter((target) => target.includes('[') || target.includes('.'));
}

/**
 * The invariant, asserted against LIVE output rather than against `fixed.liquid`.
 */
test('Unit: liquid-tag-assign — every formatted target is bracketed throughout', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.liquid'), 'utf8');
  const targets = targetsIn(await format(source, {}));

  // Guards the guard: were the fixture to lose its subscript targets, the assertion below
  // would pass vacuously over an empty list.
  expect(targets.length).toEqual(11);
  expect(targets.filter((target) => target.includes('.'))).toEqual([]);
  expect(targets.map((target) => target.endsWith(']'))).toEqual(targets.map(() => true));
});

/**
 * The other half of the control. The fix is scoped to the TARGET position, not a blanket
 * disabling of dot access — prettier prefers `h.k` over `h['k']` everywhere else, and those two
 * ARE equivalent outside a write target. Without this, "keep the brackets" applied globally
 * would satisfy the invariant above.
 */
test('Unit: liquid-tag-assign — dot access is still preferred outside a target', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.liquid'), 'utf8');
  const formatted = await format(source, {});

  expect(formatted).toContain('{{ h.k }}');
  expect(formatted).toContain('{% assign z = h.k %}');
  expect(formatted).toContain('{% if h.k == 1 %}{{ h.k }}{% endif %}');
  expect(formatted).not.toContain(`h['k'] }}`);
});
