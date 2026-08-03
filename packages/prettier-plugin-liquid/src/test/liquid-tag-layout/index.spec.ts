import { test } from 'vitest';

import { assertFormattedEqualsFixed } from '../test-helpers';

/**
 * TASK-44. `{% layout %}` is NOT a platformOS tag — it is Shopify inheritance that came along
 * with the fork. Confirmed three ways: `pos-cli deploy --dry-run`, `liquid_exec`, and its
 * absence from the platform's own `register_tag` registry. A real 113-file marketplace uses the
 * frontmatter form 11 times and the tag zero times.
 *
 * WHY THIS FIXTURE STILL EXISTS after the grammar rule was removed. Authors write the tag by
 * mistake — that is the whole reason `UnknownTag` now reports it — so files containing it DO
 * reach the formatter, and the formatter must not corrupt what it cannot understand. This pins
 * that guarantee, the same way `liquid-tag-hash-assign` pins the bracket target.
 *
 * WHAT CHANGED, and it is an improvement. `fixed.liquid` used to expect `"layoutName"` rewritten
 * to `'layoutName'`: the dedicated grammar rule parsed the markup into a `LiquidString`, so the
 * printer applied `liquidSingleQuote` to it. With no rule, the markup is an unparsed string and
 * the printer emits it verbatim, so the author's quotes survive. The printer no longer reformats
 * the INTERIOR of a tag the platform rejects, which is exactly what it should not be doing.
 *
 * Whitespace normalisation is unaffected — `{%layout "x"%}` still becomes `{% layout "x" %}` and
 * the multi-line form still collapses — because the tag ENVELOPE is handled by the base case.
 * That is the half worth keeping, and the fixture proves both halves at once.
 */
test('Unit: liquid-tag-layout', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
