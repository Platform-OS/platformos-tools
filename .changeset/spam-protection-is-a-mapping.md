---
'@platformos/platformos-common': patch
'@platformos/platformos-check-common': patch
---

Model `spam_protection` as the mapping the platform actually takes.

It was declared as a string enum, which had the field backwards in both directions: the
check fired on the shape the platform recommends and stayed silent on three that are deploy
rejections. Every mapping form also produced `Invalid value 'undefined' for
'spam_protection'`, because a non-scalar has no value to interpolate.

Measured against the converter:

| frontmatter | platform | reported before |
|---|---|---|
| `spam_protection: recaptcha` | accepted | nothing |
| `spam_protection: recaptcha_v3` | **rejected** — `undefined method 'keys' for an instance of String` | nothing |
| `spam_protection: hcaptcha` | **rejected** | nothing |
| `spam_protection: RECAPTCHA_V3` | **rejected** | nothing |
| `recaptcha: {}` | accepted | a warning |
| `hcaptcha: {}` | accepted | a warning |
| `recaptcha_v3: {action, minimum_score}` | accepted | a warning |
| `bogus_strategy: {}` | **rejected** — `Invalid strategy bogus_strategy` | a warning, wrong reason |
| `recaptcha_v3:` with no `action` | **rejected** — `action is required` | a warning, wrong reason |
| `recaptcha_v3:` with `minimum_score: 2` | **rejected** — `must be between 0 and 1` | a warning, wrong reason |

`SpamProtectionConfiguration#strategy` reads `@config.keys.first`, and `old_config?`
compares `@config == 'recaptcha'` — so the strategy is the mapping's first key, and
`recaptcha` is the single legacy plain string. Anything else given as a plain string reaches
`.keys` and raises.

Each row above is now a test, the accepted rows sharing a group with the rejected ones so
neither half can go vacuous, and one asserting no frontmatter message can contain the
literal `undefined`.
