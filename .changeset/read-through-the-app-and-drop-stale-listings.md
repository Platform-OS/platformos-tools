---
'@platformos/platformos-language-server-common': patch
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': patch
---

A theme directory created while the editor is open now resolves, and the two remaining
consumers that read a project file behind the `App`'s back read through it.

**The language server served a stale directory listing until it was restarted.** A dynamic
theme search path (`theme/{{ context.constants.THEME }}`) expands by LISTING the directory
above it, and both that listing and the expansion computed from it were cached with
`app/config.yml` as their only invalidation point — while adding a theme does not touch
`app/config.yml`. Two caches had to be corrected, and fixing either alone changes nothing:

- the created/deleted file's whole ANCESTOR chain is now dropped from the `readDirectory`
  cache, not just its immediate parent. The client reports the FILE, so writing
  `theme/v2/card.liquid` invalidated `theme/v2` and left the listing of `theme/` — the one
  the expansion reads — cached. Walking to the scheme root needs no project root to stop at
  and costs nothing: dropping a listing nothing cached is a `Map.delete` miss.
- the expanded search paths are dropped on a created or deleted file, for the same reason.

Reproduced end to end in `server/startServer.spec.ts`: go-to-definition on
`{% theme_render_rc 'card' %}` answered `null` after the theme was replaced, and now finds
the new one. `DocumentsLocator.spec.ts` keeps the other half honest — its clear-the-cache
test asserted only that clearing left the answer unchanged on an UNCHANGED tree, which
passes with `clearExpandedPathsCache` reduced to an empty body; it now records all three
answers (fresh, stale, recovered), and its mock filesystem derives the tree per call so a
test can add or remove a file mid-run at all.

**`NestedGraphQLQuery` was the one check that never consulted the `App`** — it located a
partial, then read it with `fs.readFile` and parsed it itself, so a partial named from ten
call sites was read and parsed ten times, and an unsaved buffer was invisible to it. It now
takes the `AppFile`'s parse when the app has one, keeping the `fs` fallback for a URI
outside the walked subtrees. `index.spec.ts` proves WHICH parse it uses rather than just
counting: the app's parser rewrites a marker, so the offense can only appear if the check
read the app's AST — bypassing it yields no offenses at all.

**`backfill-docs` held an `app` and still read and parsed the partials itself.** It now
reads through it, and the command finally has a spec of its own: what it writes, and that
an unsaved buffer in the app is what gets documented.
