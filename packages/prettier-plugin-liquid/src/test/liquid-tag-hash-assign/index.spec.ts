import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from 'vitest';

import { assertFormattedEqualsFixed, format } from '../test-helpers';

/**
 * Bracket notation is LOAD-BEARING in a `hash_assign` target, and the printer used
 * to normalise it away.
 */
test('Unit: liquid-tag-hash-assign', async () => {
  await assertFormattedEqualsFixed(__dirname);
});

/**
 * `h [ 'spaced' ]` is a parse error on the platform, so the grammar refuses it and its markup
 * reaches the printer as a raw string. Emitting it verbatim is the required behaviour: the printer
 * used to repair the spacing by accident, which hid the error from anyone who formatted and left it
 * in place for everyone who did not. Reporting it is a check's job.
 */
test('Unit: liquid-tag-hash-assign — a target the grammar refuses is emitted verbatim', async () => {
  for (const source of [
    `{% hash_assign h [ 'spaced' ] = 1 %}`,
    `{% hash_assign h ['k'] = 1 %}`,
    `{% assign h .k = 1 %}`,
    `{% function r ['k'] = 'lib/x' %}`,
  ]) {
    expect((await format(source, {})).trim()).toEqual(source);
  }
});

/** The `hash_assign` targets in a formatted document, in order. */
function targetsIn(formatted: string): string[] {
  return formatted
    .split('\n')
    .filter((line) => line.includes('hash_assign'))
    .map((line) => {
      const start = line.indexOf('hash_assign') + 'hash_assign'.length;
      return line.slice(start, line.indexOf(' = ', start)).trim();
    });
}

/**
 * The invariant, asserted against LIVE output rather than against `fixed.liquid`.
 */
test('Unit: liquid-tag-hash-assign — every formatted target ends in a bracket', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.liquid'), 'utf8');
  const targets = targetsIn(await format(source, {}));

  // Guards the guard: were the fixture ever to lose its hash_assign tags, the assertion below
  // would pass vacuously over an empty list.
  expect(targets.length).toEqual(9);
  expect(targets.map((target) => target.endsWith(']'))).toEqual(targets.map(() => true));
});

/**
 * The other half of the control. The fix must be scoped to the `hash_assign` target position,
 * not a blanket disabling of dot access — prettier prefers `h.k` over `h['k']` everywhere
 * else, and those two ARE equivalent outside this one position. Without this, "keep the
 * brackets" applied globally would satisfy the invariant above.
 */
test('Unit: liquid-tag-hash-assign — dot access is still preferred everywhere else', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.liquid'), 'utf8');
  const elsewhere = (await format(source, {}))
    .split('\n')
    .filter((line) => !line.includes('hash_assign'));

  expect(elsewhere.filter((line) => line.includes('h.k')).length).toEqual(4);
  expect(elsewhere.filter((line) => line.includes(`h['k']`))).toEqual([]);
});
