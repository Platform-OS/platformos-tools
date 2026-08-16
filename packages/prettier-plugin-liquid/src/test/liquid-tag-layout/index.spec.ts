import { test } from 'vitest';

import { assertFormattedEqualsFixed } from '../test-helpers';

/**
 * `{% layout %}` is NOT a platformOS tag — confirmed three ways: `pos-cli deploy --dry-run`,
 * `liquid_exec`, and its absence from the platform's own `register_tag` registry.
 */
test('Unit: liquid-tag-layout', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
