import { test } from 'vitest';

import { assertFormattedEqualsFixed } from '../test-helpers';

/**
 * `{% layout %}` is NOT a platformOS tag — confirmed three ways: `pos-cli deploy --dry-run`,
 * `liquid_exec`, and its absence from the platform's own `register_tag` registry.
 *
 * The grammar therefore has no rule for it, and the formatter must not corrupt what it cannot
 * understand: authors write the tag by mistake — that is the whole reason `UnknownTag` reports
 * it — so files containing it DO reach the printer. Its markup is an unparsed string and is
 * emitted verbatim, so the author's quotes survive; the printer never reformats the INTERIOR of
 * a tag the platform rejects.
 *
 * Whitespace normalisation still applies — `{%layout "x"%}` becomes `{% layout "x" %}` and the
 * multi-line form collapses — because the tag ENVELOPE is handled by the base case. The fixture
 * proves both halves at once.
 */
test('Unit: liquid-tag-layout', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
