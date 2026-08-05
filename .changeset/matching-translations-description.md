---
'@platformos/platformos-check-common': patch
---

`MatchingTranslations` describes itself. Its `meta.docs.description` was the literal
string `TODO`, which is not internal — check metadata is what the generated factory
configs, the documentation site's check tables and any editor UI display, so users read
"TODO" where every other check explains itself. It now says what the check looks for and
why it matters: a key a locale is missing falls back to the `en` text, so the page
renders English at the visitor instead of failing visibly, and a key only one locale
defines is dead weight nothing will ever look up. No other check ships a placeholder
description — the whole `allChecks` list was scanned.
