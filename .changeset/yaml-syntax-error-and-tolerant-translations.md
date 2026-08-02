---
'@platformos/platformos-common': patch
'@platformos/platformos-check-common': patch
---

Read a translation file the way the platform does, and report the YAML problems nothing
reported before.

A duplicated mapping key is what a real project produces when two translators add the same
key. Strict js-yaml rejects the whole document for it, and every reader in the toolchain
turned that rejection into "this file has no translations" — silently. On one real project
five of the 39 `app/translations/en/*.yml` files have a duplicate, and the two checks that read
the resulting key set paid for it: **561 of `MatchingTranslations`' 621 offenses and 676 of
`TranslationKeyExists`' 907 were false**, audited key by key against a tolerant load of
every en file. `app.activities.tables.item` is in `en/activities.yml`; it was reported as
undefined because its file had been discarded.

`TranslationProvider.loadYaml` and `getDefaultTranslations` now read with js-yaml's
`json: true` — last value wins, which is what Ruby/Psych does at render time, so the linter
agrees with what the instance serves. A file YAML cannot read AT ALL is still a value
rather than an exception, which is what keeps one bad file from costing the editor every
document link in a page.

**`YAMLSyntaxError` (error, recommended)** is the counterpart to `LiquidHTMLSyntaxError`
and, until now, the missing one: a YAML source drew no diagnostic however broken it was,
while every reader quietly declined to use it. It reports each complaint the parser makes,
positioned — a duplicated key is named and highlighted on the duplicate itself:
`Duplicate key 'banner_mobile' — the last value wins, so the earlier one is dead.` It is
deliberately type-agnostic, because a duplicate in `app/config.yml` is the same bug as one
in a translation file; `fixed-path-files.spec.ts` records it as the one YAML check that
needs no file-type guard, and pins that a config file YAML reads cleanly still draws
nothing.

Two things it does not report, both decided by measuring rather than by taste: a trailing
`---` terminator, since Ruby reads such a file as one document plus an empty one and
flagging it produced 88 offenses on one project for nothing; and an empty second document.
A second document WITH content is reported — only the first is ever read, so the rest of
the file is dead.

A list value is now ONE key in both key-set walkers rather than one key per element. `t`
returns the whole list and `{{ 'app.relationships.type' | t | parse_json }}` is how a
project reads one, so `…type.0` is not a key anyone can add — and the two walkers no longer
disagree about what a key is.

Measured across four real projects: the largest went 9460 → 8830 offenses (−676 false
`TranslationKeyExists`, −26 internal-error reports, +61 `MatchingTranslations` that were
verified genuine, +11 duplicate keys), two were unchanged, and `pos-module-community` +1 — a
real duplicate in its own module translations. The most valuable single find is not a
translation: one project's `app/config.yml` sets
`graphql_argument_type_mismatch_mode: ignore` on line 10 and `: error` on line 123, so that
instance has been running with `error` and the earlier setting was dead.
