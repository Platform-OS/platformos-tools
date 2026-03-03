import { test } from 'vitest';
import { assertFormattedEqualsFixed } from '../test-helpers';

test('Unit: html-processing-instruction', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
