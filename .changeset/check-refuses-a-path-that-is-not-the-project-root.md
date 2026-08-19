---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': minor
'@platformos/platformos-graph': patch
---

`check` refuses a path that is not a project root, instead of reporting it clean.

`appCheckRun` handed its argument to `getAppAndConfig` as the project root without checking that
it was one. A directory carrying no marker — true of `app/`, and of any single module directory —
loaded zero files, so the run returned zero offenses and every caller printed "No offenses found".
That is indistinguishable from a clean project, and it is the dangerous direction: a developer, a
CI job or an agent gating on that message concludes the code is clean when nothing was inspected.

Measured on a real app: `pos-cli check run` reported 1036 offenses across 191 files, while
`pos-cli check run app` on the same project reported none — with a partial containing an unclosed
`{% if %}`, an unclosed `<div>` and an undefined filter sitting inside `app/`.

It now names what happened and where the root is — and says only as much as the evidence supports.

A root DECLARED by a `.pos` or `.platformos-check.yml` file is asserted:

```
Nothing was checked: /project/app is not the root of a platformOS project.
Re-run the check against the project root: /project
```

A root INFERRED from a directory NAME is not. `app`, `modules` and `marketplace_builder` are
ordinary names — a checkout of module repositories under `~/Work/modules` makes `~/Work` resolve as
a project root, and a Windows machine shipping `C:\Modules` makes the drive root resolve as one —
so stating it as fact sends people to re-run against a tree that is not their project:

```
Nothing was checked: /home/me/Work/multiproj is not a platformOS project root.
A project root contains one of: app/, marketplace_builder/, modules/, .pos, .platformos-check.yml.
The nearest above it is /home/me/Work, matched on modules/ alone — that may not be your project.
Re-run the check against your project root.
```

`resolveProjectRoot` reports which marker matched, and `isDeclaredRoot` distinguishes the two.
The message names no tool: the same text reaches pos-cli, the editor through the VS Code extension,
and any embedder, so naming one of them would be wrong for the other two.

The refusal is a typed `ProjectRootError` carrying a stable `PROJECT_ROOT_ERROR_CODE`, so a consumer
can present it as a message rather than a crash without matching on prose or on `instanceof` — the
latter throws outright when the loaded copy of this package predates the class.

**It reports rather than resolving.** Widening the run to the enclosing root would check MORE than
was asked — `check run app` would pull in `modules/`, so a run meant for one app reports offenses
from vendored code its caller does not own, and a CI job scoped to `app/` starts failing on its
dependencies. `platformos-graph` can resolve-and-proceed because the graph of a project is the same
answer wherever you point at it inside the project; "check this directory" is not. Linting an
arbitrary subtree remains unsupported and is a separate feature: it would have to load the whole
project anyway, since partials, pages and config all resolve project-wide, and then filter what it
reports.

`findRoot`, `makeFileExists` and the new `resolveProjectRoot` / `PROJECT_ROOT_MARKERS` moved from
`platformos-check-common` to `platformos-common`. They are project-LAYOUT knowledge with nothing
linter-specific in them, and every constant they run on — `APP_ROOTS`, `STANDALONE_MODULE_ROOTS`,
`APP_SOURCE_SUBTREES` — already lived in `platformos-common`, alongside `AbstractFileSystem` and
the URI helpers. They are re-exported from `platformos-check-common`, so existing imports keep
working. `platformos-graph` drops its own copy of the resolution and calls the shared one; its
error message is unchanged, which its existing assertion on that exact string proves.
