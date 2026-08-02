---
'@platformos/platformos-check-common': patch
---

`MatchingTranslations` no longer throws on a translation key written with no value.

`moto:` on a line of its own holds nil, and `typeof null === 'object'`, so the walk over a
locale's keys recursed into it and called `Object.keys(null)`. The walk runs over the SHARED
reference set in `onCodePathStart`, so the throw was not confined to the file that had the
nil key: it cost every file in that locale scope its offenses. On one real project a single
such key in `app/translations/en/emails.yml` meant all 26 of that project's Arabic
translation files went unchecked, and — before `CheckError` — silently.

A key with no text is still a key, so it is a leaf on both sides of the comparison: the
other locales must have it, and it satisfies the `en` key it stands for. A key the `en`
locale genuinely lacks is still reported.
