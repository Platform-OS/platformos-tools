---
'@platformos/platformos-check-common': minor
'@platformos/platformos-check-node': minor
---

New check `RollbackOutsideTransaction` (error, recommended): report a `{% rollback %}` that is
reached outside a `{% transaction %}` block.

`Liquify::Tags::RollbackTag` raises `rollback performed outside of transaction` unless
`AfterCommitEverywhere.in_transaction?`, so this is a guaranteed runtime error rather than a
smell. The parser, the printer and the syntax highlighting already carried the tag; what was
missing was anyone judging where it may appear.

**It cannot be judged one file at a time.** A partial does not know its own transaction state —
the identical `app/lib/order/place.liquid` is correct under `{% transaction %}{% function _ =
'order/place' %}{% endtransaction %}` and broken under a bare call. So a partial's own rollback
is never reported where it is written; the check descends `render` / `include` /
`theme_render_rc` / `function` / `background` call trees from the files whose entry state IS
known, and reports at the CALL SITE, naming the chain: `Rendering 'wrapper' reaches a
{% rollback %} that is not inside a {% transaction %} block (wrapper → inner).`

Which files have a known entry state is a `Record<PlatformOSFileType, …>`, so a new file type
cannot be added without an answer, and three Liquid types are deliberate silences rather than
oversights:

| type | entry state | why |
| --- | --- | --- |
| Page, Layout, Email, ApiCall, Sms | no transaction | `PagesController#show` opens none; notifications render in `NotificationWorker`, never inline |
| Migration | IN a transaction | `DataMigration#execute_queries` wraps the whole render in `AfterCommitEverywhere.in_transaction`, so a bare rollback there is CORRECT |
| Partial | unknown | its caller decides — the reason the check descends at all |
| FormConfiguration, Authorization | unknown | `Commands::FormSubmitViaMutation` submits a form programmatically, so `{% transaction %}{% graphql _ = 'submit' %}{% endtransaction %}` runs a form's callbacks, and its policies, INSIDE the caller's transaction |

Two tags are barriers rather than wrappers. `{% background %}` takes its body back OUT of a
transaction — the `{% transaction %}` documentation says a job scheduled inside one "will only
be added to the queue after successfully committing the transaction", and
`BackgroundTagWorker#perform` renders it with no transaction of its own — so a rollback under
one is reported from ANY file, including a partial, and a `{% background x = 'p' %}` call never
inherits its scheduler's transaction. `{% content_for %}` is a barrier to unknown: its body runs
where the matching `{% yield %}` is, which may be another file, so its lexical position proves
nothing and nothing inside it is reported.

Not in `BLOCKING_CHECKS`. Deploy accepts the file, and unlike `MissingPartial` the finding rests
on an inference across files with real gaps — a partial named by a variable, a `{% yield %}`, a
form callback's entry state — so gating writes on it would promise more than the analysis
supports.

Measured on real projects. Twelve Liquid files across `~/projects/pos` contain a rollback and
none is misplaced, so the whole-project runs report nothing — which on its own proves nothing,
so the silence was controlled: `Accala-MP`'s `app/views/pages/api/v2/companies/update.json.liquid`
calls `commands/v2/companies/update_disciplines`, whose two rollbacks sit inside its own
`{% transaction %}`, and the descent reaches them and stays quiet; commenting that one
`transaction` out in memory produces exactly one offense, on the page, naming the command. Cost
is below run-to-run noise at both seams — whole project on `clearchoice` (4,000 Liquid files),
3 runs each: 39.9s with, 39.8s without; single buffer through `lintBuffer`, warm median: 178ms
vs 179ms. The per-file walk is memoized against the parse via `AppFile.derived`, so a partial on
ten call sites is analysed once per run and the descent adds no parses a whole-project run was
not already doing.
