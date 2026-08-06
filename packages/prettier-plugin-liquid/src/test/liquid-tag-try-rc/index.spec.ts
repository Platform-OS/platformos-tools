import { test } from 'vitest';

import { assertFormattedEqualsFixed } from '../test-helpers';

/**
 * TASK-56. `try_rc` is a name the platform registers against the same handler as `try`, and
 * it was absent from our vocabulary — so `{% try_rc %}` and `{% endtry_rc %}` were both
 * reported as unknown tags by a BLOCKING check, refusing code the platform runs.
 *
 * WHY THE FIX HAD TO REACH THE GRAMMAR rather than just the docset. `try` is a BLOCK, so its
 * alias is too, and a close tag cannot be taught to `UnknownTag` through the tag docset — a
 * stray `{% endtry_rc %}` must stay an error. `try_rc` was therefore added to the grammar's
 * `blockName`, which is a grammar change, which makes this fixture mandatory: the printer
 * REGENERATES source from the AST, so a construct the grammar newly parses is a construct
 * the printer can newly destroy.
 *
 * The close-tag spelling is measured, not inferred from the canonical name. The runtime
 * rejects `{% try_rc %}…{% endtry %}` with "'endtry' is not a valid delimiter for try_rc
 * tags. use endtry_rc", so the pair really is `try_rc`/`endtry_rc`.
 *
 * WHAT THIS PINS. The body survives, the `{% catch %}` branch survives, and the tag envelope
 * is normalised exactly as the canonical `try` is — `{%try_rc%}` becomes `{% try_rc %}`. The
 * canonical form is in the fixture alongside the alias on purpose: it is the control. Any
 * change that reformatted the alias differently from the tag it aliases would show up here as
 * a divergence between two blocks of the same file.
 */
test('Unit: liquid-tag-try-rc', async () => {
  await assertFormattedEqualsFixed(__dirname);
});
