/**
 * ImgLazyLoading rule — performance hint. The LSP flags an `<img>` without
 * `loading="lazy"`; this rule attaches the recommendation text and stable
 * attribution. The `text_edit` insert itself is produced by the heuristic
 * fix-generator in full mode — rules this trivial don't need to reimplement
 * position calculation.
 *
 * Plan reference: Tier 1 trivial wins.
 */

import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'ImgLazyLoading.recommended',
    check: 'ImgLazyLoading',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'ImgLazyLoading.recommended',
      hint_md: 'Add `loading="lazy"` to this `<img>` tag so the browser defers off-screen image loads. Improves Core Web Vitals (LCP) and reduces initial bytes transferred on long pages.',
      fixes: [],
      confidence: 0.9,
    }),
  },
];
