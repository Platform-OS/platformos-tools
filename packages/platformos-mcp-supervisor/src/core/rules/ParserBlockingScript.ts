/**
 * ParserBlockingScript rule — `<script src="…">` tags without `defer` or
 * `async` block HTML parsing while the JS downloads.
 *
 * Pre-rule the check landed as `.unmatched` (no fix-generator heuristic, no
 * rule). We can't safely emit a `text_edit` from this layer — the rule
 * engine runs without file content, so building a valid `range` (which
 * needs to find the closing `>` of the opening `<script>` tag, possibly on
 * a wrapping line) isn't feasible without false positives.
 *
 * The rule attaches a stable `rule_id` and a structured guidance fix so
 * analytics get attribution and the agent gets a concrete decision tree
 * (`defer` vs `async` vs end-of-body). When fix-generator gains a
 * `fixParserBlockingScript` heuristic, the rule's `guidance` will be
 * dropped per the dedup precedence in validate-code.js.
 */
import type { Rule } from './engine';

export const rules: Rule[] = [
  {
    id: 'ParserBlockingScript.default',
    check: 'ParserBlockingScript',
    priority: 100,
    when: () => true,
    apply: () => ({
      rule_id: 'ParserBlockingScript.default',
      hint_md:
        '`<script src="...">` tags without `defer` or `async` block HTML parsing while the JS downloads, ' +
        'delaying first paint. Apply one of:\n' +
        '  • `<script defer src="...">` — recommended default. Preserves order, runs after parsing.\n' +
        '  • `<script async src="...">` — runs as soon as it loads, in unspecified order. ' +
        'Use only for scripts independent of others (analytics beacons, etc.).\n' +
        '  • `<script src="..."></script>` placed at the very end of `<body>` — the legacy workaround. ' +
        'Prefer `defer` for new code.\n\n' +
        'Inline scripts (`<script>...</script>` with no `src`) are unaffected by this check.',
      fixes: [{
        type: 'guidance',
        description:
          'Add `defer` to the opening `<script>` tag (`<script defer src="...">`). ' +
          '`defer` waits until HTML parsing finishes AND preserves script order — ' +
          'the safe default for src-loaded scripts. Use `async` only when the script ' +
          'is independent of others and order does not matter.',
      }],
      confidence: 0.85,
    }),
  },
];
