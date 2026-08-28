---
'@platformos/platformos-common': patch
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': patch
'@platformos/liquid-html-parser': patch
---

Close the CodeQL code-scanning alerts: three quadratic regexes, an unbounded prototype
merge, and two patterns built from unescaped input.

Three of the flagged regexes are genuinely quadratic, measured on a 120k-character
adversarial subject:

| subject | before | after |
|---|---|---|
| `getConditionalComment` on `<!--[if` repeated | 634 ms | 0.1 ms |
| a `theme_render_rc` search path of `{{{{` repeated | 3,373 ms | 0.1 ms |
| `parseSlug` on `((` repeated | 4,250 ms | 0.1 ms |

The conditional-comment fix is also a data-loss fix. The pattern was unanchored at the
start, so `<!-- a note <!--[if IE]>x<![endif]-->` matched with `a note` outside every
capture group — and the printer regenerates the comment from those groups, so the next
format deleted it. Such a comment is no longer treated as conditional.

`TranslationProvider`'s merge read `__proto__` out of a translation file as a mergeable
object, because `typeof target[key]` consults the prototype chain — so a `.yml` file in a
linted project wrote its keys onto `Object.prototype` in the language server's own process.
`__proto__`, `constructor` and `prototype` are now skipped, own-property lookup decides the
recursion, and a `null` value no longer crashes the merge.

`basename(uri, ext)` compiled `ext` into a `RegExp` with only `.` escaped, so
`basename(uri, '(x).liquid')` stripped a bare `x` from names that never carried the
extension asked about. It compares text now. The TextMate grammar's `escapeRegex` escapes
the full metacharacter set; the generated grammars are byte-identical.

Also: `contents: read` on the CI and VS Code release workflows.
