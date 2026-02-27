import { test } from 'vitest';
import { assertFormattedEqualsFixed } from '../test-helpers';

test('Unit: liquid-tag-include', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
