import { test } from 'vitest';

import { assertFormattedEqualsFixed } from '../test-helpers';

/**
 * `try_rc` is a name the platform registers against the same handler as `try`, and it was
 * absent from our vocabulary — so `{% try_rc %}` and `{% endtry_rc %}` were both reported as
 * unknown tags by a BLOCKING check.
 */
test('Unit: liquid-tag-try-rc', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
