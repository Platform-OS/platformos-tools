---
'@platformos/platformos-check-common': minor
---

Make `ignore: [modules/vendor]` actually ignore that directory

An anchored pattern ending in a plain directory name matched nothing at all. The subject handed
to a matcher is always a file, so `modules/vendor` compiled to a matcher for a *file* of that
exact name and never fired. `vendor`, `modules/vendor/`, `modules/vendor/*` and
`modules/vendor/**` all worked, so only the most obvious spelling silently did nothing, and the
workaround — add a slash — was undiscoverable.

The bare-name branch already covered a directory's contents with `{,/**}`, and the reasoning for
it is written down in `anchor-ignore-patterns-on-the-project-root`. The anchored branch never got
the same treatment; it does now, sharing one helper.

`{,/**}` rather than `/**` deliberately: it covers the entry and anything beneath it without
sweeping in a sibling that merely shares the prefix, so `modules/vendor` leaves
`modules/vendor-extras` linted. Anchoring is unchanged — `modules/vendor` still does not touch
the first-party `app/modules/vendor`.

BEHAVIOUR CHANGE. A config that already writes a bare anchored directory will start ignoring it,
and will therefore report fewer offenses than before. That is what the pattern always meant;
until now it did nothing. Measured on a project with three broken pages: `ignore:
[modules/vendor]` reported 6 offenses before and 4 after, the same 4 that
`ignore: [modules/vendor/**]` reports.
