import { test } from 'vitest';
import { assertFormattedEqualsFixed } from '../test-helpers';

/**
 * `@prompt` is Shopify Magic's AI-provenance annotation and platformOS publishes no such thing, so
 * the grammar stopped modelling it. THE PRINTER REGENERATES SOURCE FROM THE AST, which makes this
 * the failure mode that costs a user their content: anything the AST stops carrying is deleted from
 * the author's file on the next format, silently.
 */
test('Unit: liquid-doc-prompt', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
