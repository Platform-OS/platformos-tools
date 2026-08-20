# @platformos/platformos-mcp-supervisor

## 0.1.0

### Minor Changes

- a8f4da9: `validate_code` becomes a write gate an agent can act on, rather than a lint that returns a
  list.

  The tool's whole surface is one call, and its answer is consumed by a machine that will
  either write the file or not. That reframes what the result has to say, and three things
  follow from it.

  **"Not checked" is a status, not an empty list.** An empty `errors[]` for a file nothing
  looked at is indistinguishable on the wire from a clean file, and an agent reads it as
  approval. `not_applicable` is now a terminal status distinct from `ok`, carrying a
  machine-readable `not_applicable_reason` — `outside_project`, `unsupported_type`,
  `misplaced_source`, `too_large`, `timed_out`, `ignored`, `internal_error` — so the caller
  branches on the cause without parsing prose. `must_fix_before_write` is always `false` for
  it: declining to judge must not block a legitimate write either. Before this, `/etc/passwd`
  came back as `ValidJSON: Expected a JSON object, array or literal` with
  `must_fix_before_write: true`, and `/etc/shadow` containing `{}` came back `status: 'ok'` —
  wrong in both directions, and the second is the dangerous one.

  **Blocking is not severity.** `must_fix_before_write` requires severity `error` AND
  membership of an explicit `BLOCKING_CHECKS` set, so a new check is non-blocking by default.
  The set is four: `LiquidHTMLSyntaxError`, `YAMLSyntaxError`, `MissingPartial`,
  `UnknownFilter` — each entry carrying, in the source, the measurement that put it there.
  Several checks were REMOVED from the set after `pos-cli deploy --dry-run` showed the platform
  accepts what they report; a false block on a file that deploys is the most expensive thing
  this server can do, because a gate that refuses legitimate work gets switched off.

  **A request is a LIST of buffers, and one file is a list of length one.** That is what lets a
  coordinated change across several files be validated as the changeset it actually is, which
  removes a whole class of false positive rather than tuning it — see the separate multi-file
  changeset for the contract and why it is a correctness fix. It also means there is one
  orchestrator rather than one per tool surface: there were briefly two, and they immediately
  drifted into two `UNAVAILABLE_IMPACT` constants, two differently-worded timeout messages, and
  lint/impact running concurrently in one and sequentially in the other.

  Also in this release:

  - **Cross-file blast radius** (`impact`), graph-derived: who depends on the file being
    edited, which a per-file lint cannot see. Never stale — a changed project reports
    `computing` rather than an out-of-date answer — and `not_applicable` for file types with
    no resolvable incoming edge, so a zeroed `dependents` can never be misread as "safe to
    change".
  - **A never-stale project graph cache**, persisted across restarts and reconciled
    incrementally per file, built in a worker so it never blocks the request path.
  - **Bounded work and bounded responses**: a byte-derived lint deadline, a per-buffer and
    per-batch size cap, and a response budget applied LAST to finished results — after
    `status` and `must_fix_before_write` are computed from the complete finding set, so the cap
    can only shorten lists and never soften a verdict.
  - **Deterministic `next_step` prose** on every declined call, so a refusal explains itself
    instead of looking like a silent pass.

- a8f4da9: `validate_code` validates a whole changeset in one call — and that is a correctness fix, not
  a batching convenience.

  ```jsonc
  // One file — the original contract, unchanged.
  { "file_path": "app/views/partials/card.liquid",
    "content":   "<div>{{ title }}</div>" }

  // Several files, validated TOGETHER.
  { "files": [
      { "file_path": "app/views/pages/home.liquid",
        "content":   "{% render 'promo' %}" },
      { "file_path": "app/views/partials/promo.liquid",
        "content":   "<div>Promo</div>" }
    ] }
  ```

  **Why this is about correctness.** Real changes span files: you add a partial and the page
  that renders it, rename a snippet and update its callers, add a query and the page that runs
  it. Validated one file at a time, the page above is reported as rendering a partial that does
  not exist — because at the moment it is checked, it doesn't. The partial is in the agent's
  other buffer, unwritten. `MissingPartial` is one of only four checks that BLOCK a write, so
  that false positive doesn't just mislead: it stops the agent making a change that is
  correct. The only escapes were to write the files unvalidated, or to write them in an order
  that happens to keep every intermediate state valid — which for a mutual reference does not
  exist.

  With every buffer overlaid at once, in the `App` and in the filesystem view reference checks
  resolve through, the partial resolves. The false positive is gone by construction rather than
  by tuning.

  **The batch is not atomic.** Every requested file gets its own entry in `files[]`, in the
  order requested and keyed by the caller's own `file_path` string — so a caller mixing
  relative and absolute spellings finds its own results without reproducing our normalization.
  One declined or failing file never sinks the others.

  **One gate to read.** The response carries a request-level `must_fix_before_write`: an agent
  about to write a multi-file change needs a single answer to "may I write this changeset?",
  and a coordinated edit is only as safe as its worst file. It is deliberately an OR over the
  files' own gates, so a file that was merely not checked (`not_applicable`) never blocks the
  set.

  **Bounded, and self-contradiction refused.** Up to 50 files per call, with a byte cap derived
  from the same cost model as the lint deadline, so a batch cannot be admitted that could not
  finish inside it. Two entries resolving to the SAME file are refused rather than merged:
  buffers are overlaid by normalized URI with the last winning, but results are keyed by the
  caller's string, so `card.liquid` and `./card.liquid` would return two entries where only one
  buffer was ever checked — one of them a verdict on content that was never looked at.

  It is also faster, which is the least interesting part: everything expensive in a lint is
  per-project rather than per-buffer — resolving config, walking and reconciling the app,
  reconciling the route table — so N files in one call pay for the project once instead of N
  times.

### Patch Changes

- a8f4da9: An asset is served, never rendered — so nothing reads one, anywhere in the toolchain.

  `app/assets/x.liquid` was linted like a page. A bare `.liquid` has no response format, so
  `sourceCodeTypeOf` falls back to the `html.liquid` key — which HAS a parser row — and the
  file went into the app with the Liquid+HTML parser. Measured: a broken one drew
  `LiquidHTMLSyntaxError` from `check()`, and through the MCP supervisor a
  `must_fix_before_write: true` — a **false block** on a file the platform hands back
  byte-for-byte, for the syntax of a language nothing at that path evaluates. Backwards
  besides: `theme.css.liquid`, the asset form the platform genuinely does process, was exempt
  all along, because `css` IS a format and has no row.

  **The rule is a TYPE question, which is why an extension table could never answer it.**
  `isParsedFileType` (new, exported from `platformos-common`) is false for
  `PlatformOSFileType.Asset` and true for everything else. `App.findOrLocate` had already
  written the principle down — _"Nothing reads an asset, so the only question about one is
  whether it exists"_ — this makes it enforceable.

  Applied in exactly two places, and that is the whole design: `AppFile`'s constructor (so a
  file's `type` is `undefined`, which is already the toolchain's canonical "do not parse
  this") and `isSupportedSourceFile`. Every consumer follows from one of those two without
  knowing the rule exists — the linter, because `check()` iterates source types; the language
  server, because `App.sourceCodes()` filters on `type !== undefined`; the MCP supervisor,
  whose pre-lint gate now asks the shared predicate instead of comparing to `Asset` itself.

  An asset is still HELD by the app, and the distinction matters: not linted is not absent.
  Dropping assets from the model would produce the same zero offenses while silently breaking
  every `asset_url` resolution and the graph's asset nodes.

  **Why an explicit exclusion of one type rather than a whitelist of the other eighteen.**
  A whitelist gives a NEW `PlatformOSFileType` the default "not read", which is silent and
  wrong in the expensive direction — a newly added YAML type would simply stop being linted,
  the exact regression `file-type-coverage.spec.ts` exists to catch. Defaulting a new type to
  "read" fails loudly instead.

  This is also not the ignore-list that `isSupportedSourceFile` is documented to refuse. That
  one was a regex inside a single predicate, so the language server honoured it while the lint
  did not; this is a shared exported rule consulted by both deciders, so they cannot hold
  different opinions.

  Closes the write-gate half shipped earlier as a supervisor-only fix, which corrected
  `must_fix_before_write` while the CLI and editor still reported on assets.

- a8f4da9: `hash_assign` is not the only tag that writes into a Hash, and it is the deprecated one.

  `{% assign h['k'] = v %}` and `{% assign h.k = v %}` reach the same runtime setter as
  `{% hash_assign %}`. `InvalidWriteTarget` knew only the old spelling, which cost two
  defects in opposite directions — and both are settled by measurement against
  `/api/app_builder/liquid_exec`, every row reading the container back so "accepted" means the
  write happened rather than that the tag merely parsed.

  **A FALSE BLOCK, in a check that gates the write.** A subscript write was treated as a plain
  assignment, so `h` took the VALUE's type: after `{% assign h['k'] = 'V' %}`, the next write to
  the same hash was refused as a write onto a _string_. Both spellings, one file apart:

  ```liquid
  {% assign h = '{}' | parse_json %}
  {% assign h['k'] = 'V' %}
  {% hash_assign h['j'] = 'W' %}   <- "h ... is a string" — and the platform renders it
  ```

  A write INTO a container does not replace it. The container's type is now preserved, and
  NARROWED where the write itself proves it: reaching the runtime at all means the container was
  of the right kind.

  **A MISSED DETECTION.** `{% assign x['k'] = v %}` onto a String, Number, Boolean, nil or an
  unset variable raises `"x is …, expected Hash or Array"`, and an Array subscripted with a
  string key raises `"expected index"` — identical to `hash_assign` in all fourteen container ×
  subscript combinations. None of it was reported. It is now, under the tag the author actually
  wrote.

  **`{% assign x << v %}` is a separate rule and was wrong in both directions too.** It requires
  an Array — a **Hash raises**, which is the falsifier proving it is not the subscript-write rule
  wearing a different operator — and it does not replace the target either, so appending a number
  to an array no longer makes every later write to it look like a write onto a number.

  **The dot rule does NOT generalise, and that is the measured half people get wrong.**
  `{% hash_assign h.k = v %}` raises a PARSE-time `Syntax Error in 'hash_assign'`;
  `{% assign h.k = v %}` writes the key `k`. So `InvalidHashAssignTargetSyntax` stays
  `hash_assign`-only — extending it would refuse working code on a blocking check — and a dot
  lookup counts as a plain KEY accessor everywhere else, exactly as the runtime treats it.

  The MCP server's instructions now describe the rules under `assign` rather than only under
  `hash_assign`, since telling an agent about a deprecated tag's constraints teaches it a rule
  that does not apply to the tag it should be writing.

  **And the formatter was destroying these targets, which is worse than any of the above.**
  `prettier-plugin-liquid` normalised a subscript away on every format:

  ```liquid
  {% assign h['k'] = 'V' %}        ->   {% assign h.'k' = 'V' %}      ✗ no parser accepts this
  {% function h['k'] = 'p' %}      ->   {% function h.k = 'p' %}      ✗ target silently rewritten
  ```

  The `assign` output is not even the dot form — the printer emitted the string NODE after the
  dot, quotes included. Measured: `Liquid syntax error: Syntax Error in 'assign' - Valid syntax:
assign [var] = [value]`, at PARSE time. So format-on-save turned a working file into one that
  can neither be deployed nor rendered, with no error at any layer, and a converter rejection
  takes the whole changeset. This is the same defect that was fixed for `hash_assign` earlier,
  in the two tags it was not fixed for.

  Both targets are now bracketed throughout — `h.a['b']` becomes `h['a']['b']`, and an author's
  `h.k` becomes `h['k']`, which is behaviour-preserving and was measured pair by pair against the
  runtime rather than reasoned about. Dot access is still preferred everywhere that is not a
  write target. The invariant is asserted against LIVE printer output, not against the committed
  `fixed.liquid`, because a fixture regenerated from a broken printer records the breakage as the
  expectation — which is exactly what `liquid-tag-function/fixed.liquid` had done.

- e3a7fb0: A stalled documentation host could hang a lint indefinitely.

  `PlatformOSLiquidDocsManager.setup()` compares the local docs revision against the published one, and
  it runs on the first lint of every process. That request had no timeout:

  ```
  lintBuffers -> setup() -> remoteRevision() -> download() -> await fetch(path)
  ```

  A host that accepts the connection and never answers holds the caller for as long as it holds the
  socket — so `pos-cli check`, the language server and the MCP supervisor could all hang on a network
  condition, with no diagnostic and nothing to retry.

  It surfaced as a CI failure: `Integration: lintBuffers > materialises fixes while the app is still
live` timing out at 5000 ms. Reproduced exactly by stalling that one URL and nothing else, and cured
  by bounding it — the same test then passes while the host is still stalled, because `setup()` already
  treats a failed refresh as staleness rather than breakage and keeps the docset on disk.

  **One bound for every request, chosen from measurement rather than from the shape of the data.** The
  first version of this change had two — a tight bound for the revision check and a generous one for
  bulk downloads, on the assumption that a large file needs longer. Measured against the live host, the
  largest resource (the 363 KB GraphQL schema) fetches in ~230 ms and the tiny revision check in
  ~450 ms: latency dominates, size does not, and the second constant was justifying itself with a
  guess. So there is one `DOWNLOAD_TIMEOUT_MS`, generous against ~450 ms and under the budget a caller
  gives a single lint.

  Not a per-platform workaround: the request is bounded everywhere, for every consumer. The CI job that
  failed was ubuntu/node24, but the tests matrix has no `fail-fast: false`, so the other three jobs were
  cancelled rather than passing — the failure depends on whether a runner's request stalls, which any of
  them can hit.

  What this does NOT fix is that a lint reaches the network at all. The docset ships with the package and
  is refreshed at build time by `postbuild`, so for a one-shot lint the revision check is redundant; the
  refresh exists for a long-running language server, which is what `DOCS_MANAGER_MAX_AGE_MS` is for. With
  `fileParallelism: false` and `isolate: true` every spec file forks fresh and pays its own request, so
  the suite depends on a third-party host being reachable. Deciding who should refresh needs a seam the
  manager does not have today — it takes only a `Logger` — and is filed rather than patched around here.

- 4567a07: `FilterWithoutEffect` now matches what the runtime actually does with a filter — in both
  directions. Found by running the check over a real project (130 warnings in
  `pos-module-community` alone) and settled by probing a live instance, reading the affected value
  back rather than checking that the page rendered.

  **The discriminator is which Ruby parser receives the value**, not which tag it belongs to:

  | parser                                     | filters | positions                                                              |
  | ------------------------------------------ | ------- | ---------------------------------------------------------------------- |
  | `Liquid::Variable`                         | APPLY   | `{{ }}`, `assign`, `hash_assign`, `session`, `echo`, `print`, `return` |
  | `Liquid::JsonLiteralVariable`              | APPLY   | an argument value that IS a JSON literal                               |
  | `TAG_ATTRIBUTES` scan                      | DISCARD | every other operand and argument value                                 |
  | `Expression.parse` over a `QuotedFragment` | DISCARD | tag operands                                                           |

  Four fixes fall out of that table.

  **`hash_assign` applies its filters** and was missing from the applying allowlist, so every
  `{% hash_assign post['edited_at'] = 'now' | to_time | json %}` was reported as dead code. It is
  `assign`'s deprecated twin and shares its RHS handling, so only the mechanism predicts it — no
  per-tag probe would have.

  ```
  {% assign h = {} %}{% hash_assign h['k'] = 'a' | upcase %}{{ h['k'] }}   -> A
  ```

  **A JSON-literal argument value applies its filters**, so `{% log 'm', data: {"a": 1} | json %}`
  was a false positive — and an increasingly common one now that `parse_json` is deprecated in
  favour of hash literals. Measured with a partial that reads the argument back: it was handed the
  JSON _string_, and `| json | upcase` arrived as `{"A":1}`, both filters in order. The value
  shape decides this, not the tag, which is why it cannot be another allowlist row. A filter
  NESTED inside the literal (`data: {"a": 'z' | upcase}`) is a converter syntax error, so nothing
  there is exempt.

  **A trailing filter is a result filter on `{% graphql res = 'file' %}` and on nothing else.**
  This was a false NEGATIVE — the check was silent on genuinely dead code, which is the direction
  that ships a file doing something other than what its author wrote:

  ```
  {% function r = 'p', a: 1 | dig: 'x' %}      dig is scanned as one more ARGUMENT; r unfiltered
  {% background j = 'p' | dig: 'x' %}          job id comes back unfiltered
  {% graphql g, a: 1 | dig: 'x' %}…            INLINE form drops it
  {% graphql g = 'q', a: 1 | dig: 'x' %}       the ONE that filters the result
  ```

  All four share one grammar rule and one plausible Ruby story, and every "renders clean" probe
  says the same thing about all four — only reading the assigned value back separates them. The
  trailing filter binds to the LAST argument, so it survives exactly when that argument is a JSON
  literal (`{% function r = 'p', items: [1, 2] | reverse %}` really does reverse `items`).

  **`background`'s trailing filter was also a grammar gap**, independent of the above:
  `{% background j = 'p' | upcase %}` did not parse at all — a `LiquidHTMLSyntaxError`, which is
  `error` severity and in `BLOCKING_CHECKS`, so it blocked writes on markup the platform accepts
  and runs. `BackgroundMarkup` now carries `filters` and the printer emits them; without that last
  part the next format would have silently deleted the filter.

  The AST parks a trailing filter on the markup node (`FunctionMarkup.filters` and friends) even
  where the runtime binds it to the last argument. That is a parsing choice that keeps the
  author's text round-trippable, and it must not be read as "this is a result filter" — the check,
  not the AST shape, carries the runtime meaning. The MCP server's instructions previously told
  agents that `function`/`graphql` trailing filters filter the result; that claim is corrected and
  now pinned.

- f15573d: **BREAKING**: `InvalidHashAssignTarget` is renamed to `InvalidWriteTarget`. A
  `.platformos-check.yml` that configures it by the old name must be updated; the CLI reports
  an unknown check otherwise.

  The old name described one of the five constructs the check judges. Its subject is a write
  that goes INTO a container — a subscript write or an append — and three tags spell one:

  ```liquid
  {% assign      x['k'] = v   %}   {% assign   x << v   %}
  {% hash_assign x['k'] = v   %}   {% function x << 'p' %}
  {% function    x['k'] = 'p' %}
  ```

  `{% function x['k'] = 'p' %}` is newly judged. Its silence was documented as "the write
  semantics are unmeasured — it needs a partial that exists, and the oracle instance has
  none", which was wrong: measured against `/api/app_builder/liquid_exec` with the container
  read back, it obeys the rule identically to the other two spellings, error text included.

  | container                                               | `x['k'] = …`                                             | `x[0] = …`         |
  | ------------------------------------------------------- | -------------------------------------------------------- | ------------------ |
  | Hash                                                    | writes                                                   | writes (key `"0"`) |
  | Array                                                   | raises _"x is an Array, expected index, k was provided"_ | writes             |
  | String / Number / Boolean / Range / Date / Time / unset | raises _"x is …, expected Hash or Array"_                | same               |

  Also measured and now covered: `date`, `time` and `range` targets for `<<`, and
  `{% function x.k = 'p' %}`, which writes the key `k` exactly as `{% assign %}` does.

  The messages no longer name the tag, because the rule is the write's and not the tag's —
  `assign expects a Hash or an Array` was a false statement about `assign`:

  - `Cannot write into 'x', which is a number. A subscript write needs a Hash or an Array.`
  - `Cannot write into 'x' with a string key, because it is an Array. Use a numeric index instead.`
  - `Cannot use '<<' on 'x', which is a Hash. '<<' appends to an Array.`

  An append offense no longer highlights the whitespace before the closing `%}`.

  Separately, `LiquidHTMLSyntaxError` now reports a `hash_assign` with no subscript at all.
  `{% hash_assign h = 'v' %}` parses in this repository — the markup rule is a
  `liquidVariableLookup`, which matches a plain name — and raises `Liquid::SyntaxError` on the
  platform whatever the target holds, so a Hash target was a silent false approval on a
  blocking check. It shares the dot form's message, since both have the same repair: rename
  the tag to `{% assign %}`, which accepts every target `hash_assign` refuses.

- cf80cfa: Lazy `App` object model, one anchored project walk, and a `lintBuffer` that says
  whether it checked the file.

  `@platformos/platformos-common` now owns an `App` / `AppFile` model: it classifies a
  project's paths and reads or parses nothing until a consumer asks for a specific
  file. Parsers are injected, so the package stays below the parser stack and every
  consumer can share one set of file objects. Names (`{% render 'ui/card' %}`) resolve
  through an O(1) per-type index whose precedence is `getAppPaths`/`getModulePaths`
  order, i.e. the same rule the candidate-path walk uses.

  `check-node`'s `getApp` builds that model instead of reading and eagerly parsing
  every file on every call, so a `validate_code`-style single-file lint parses the file
  it visits plus the handful of render targets that file resolves — not the project.
  `check-node` also now holds one `RouteTable` per process, reconciled per run against
  each page's `mtime`/`size`, so an unchanged project costs zero page reads while an
  added, changed or deleted page is still reflected.

  That table is now also resolved LAZILY. `Dependencies.routeTable` accepts a provider as
  well as a table, `MissingPage` asks for it at the first URL it actually has to resolve
  rather than in `onCodePathStart`, and check-node passes its reconciler as the provider.
  Knowing a route means reading every page in the project, while 87-97% of the Liquid in a
  real project contains no `<a href>`/`<form action>` pointing at an internal route — so a
  lint of one of those files now touches no page at all, where before it fingerprinted
  every one of them. Warm `lintBuffer` on such a file, on a 3.1k-file project: 405 → 8
  `stat`s and 71-79 → 54-77 ms; a file that does resolve a route pays exactly what it did.
  Whole-project offenses are identical, field for field, on three real projects (9623,
  256 and 43 offenses).

  `getApp` also stops classifying. It walks the subtrees an app file can live in —
  `APP_SOURCE_SUBTREES` (`app/`, `marketplace_builder/`, `modules/*/public`,
  `modules/*/private`) with the `SOURCE_FILE_EXTENSIONS` extensions, both derived in
  `platformos-common` from the file-type model — and lets `App.fromPaths` decide what
  the app contains. One answer to "is this a platformOS file", in the package that owns
  the question: whether a file belongs to the app is its position relative to the
  project ROOT, so `tmp/app/views/partials/x.liquid` is not a partial and
  `app/views/pages/vendor/x.liquid` is a page.

  The walk therefore never enters `node_modules` and the rest of the repository at all.
  Walk time on two real projects: 903 → 33 ms and 177 → 30 ms; whole `getApp` on the same
  two, 1289 → 152 ms and 381 → 154 ms, with a file-by-file identical app on four real
  projects. `getAppFilesPathPattern` is REMOVED: it had no consumer left once the lint
  stopped globbing, and a watcher that wants patterns can build them from
  `APP_SOURCE_SUBTREES` and `SOURCE_FILE_GLOB`, which is all it did.

  `check-node` also holds one `App` per project per process, reconciled per call rather
  than rebuilt. The project walk is NOT cached — a process that gets no filesystem
  events has no honest way to invalidate one, and an agent editing files out of band is
  exactly the case this has to be right for — so the candidate paths are walked on
  every call and the app is brought in line with them: files the walk no longer sees are
  dropped, files it did not know are added, and files whose source is in memory are
  `stat`ed and dropped if they changed. Everything else — classification, both name
  indexes, and the handful of sources and ASTs the previous calls loaded — is reused.
  Warm `lintBuffer`, shared vs rebuilt per call, on two real projects: 104-116 ms vs
  177-195 ms and 77-107 ms vs 123-160 ms, with diagnostics identical file by file over 40
  files per project. At most 200 files keep their source between calls, so a long-lived
  process stops accumulating the project (300 calls on the larger: 574 MB and climbing →
  497 MB, flat). `resetSharedApp()` discards it. `lintBuffer` now reverts its buffer
  overlay when the call ends, since the app outlives it.

  `isIgnored` compiles each `ignore` pattern once per config instead of rewriting and
  recompiling a `Minimatch` on every path it is asked about — it is asked once per
  candidate path in `getApp` and again per file per check in `check()`. Same patterns,
  same answers, file-by-file identical on three real projects; the filter itself is
  5-6× faster (on one of them, 1511 candidates against 13 patterns: 76-98 → 14-16
  ms), and `getApp` there is 207-267 → 45-69 ms.

  **The dependency graph and the language server see the whole app now.** Both walked
  the project by starting at the root and skipping any directory whose name ended in
  `.git`, `node_modules`, `dist`, `build`, `tmp` or `vendor`. The last four match at any
  depth, so `app/views/pages/vendor/**` — an entire section of a live site — was invisible
  to both: every reference to those pages looked orphaned in the graph, and the language
  server managed none of them (no diagnostics, completions or rename), with nothing to
  indicate why. Measured over the projects on hand, one loses 137 app files that way and
  another 3 (`app/lib/commands/v2/projects/update/build/*`).

  They now share `walkAppSourceFiles` in `platformos-common`, which walks
  `APP_SOURCE_SUBTREES` — the same anchoring `getApp` adopted, and the same rule
  `parseAppPath` has always enforced. `recursiveReadDirectory` and its directory-name
  blacklist are gone. `getApp` walks with it too, instead of globbing the equivalent
  patterns: same paths file for file on four real projects, and 9-15% faster (median
  39 → 33 ms on the largest, 33 → 28 on another), because
  a walk filters by extension as it enumerates instead of matching a pattern per path.
  Two edge cases the glob decided and the walk now decides
  deliberately: hidden entries (`.#card.liquid`, `._card.liquid`, `.old/`) are still
  skipped, and an unreadable directory now FAILS the run rather than being skipped in
  silence.

  That failure is an `UnreadableDirectoryError`, which names the directory relative to
  the project root and says what to do about it, rather than a bare `EACCES … scandir`.
  `pos-cli check` prints it as a message and exits 1; an unexpected error still gets its
  stack. In the language server it also fixed two things that were never specific to
  permissions, and broke a session for any cause — a dropped network mount, `EMFILE` on
  a large project, a directory another process has locked. `preload` is `memoize`d, and
  `memoize` caches the REJECTED promise, so one failure replayed for every later preload
  of that root, including after the cause was gone; and `progress.end()` was on the
  success path only, so "Initializing Liquid LSP" stayed on screen for the rest of the
  session. `preload` now ends its progress, drops the memo so a retry can succeed, shows
  the user the reason (once per distinct failure per root — the graph rebuild preloads on
  every file event) and logs the error with its stack. `AppGraphManager` likewise stops
  caching a rejected graph build.

  `NodeFileSystem.readDirectory` builds each entry's URI by appending to the directory's
  (`path.childUri`) instead of parsing and re-serializing it (`path.join`). It runs once
  per entry of every directory any walk opens — tens of thousands of times per project,
  mostly for entries the caller discards — and the round trip was about a third of the
  walk. `childUri` is pinned against `join` itself for every name shape a listing can
  produce, including `#`, `?` and Windows separators.

  Anchoring is also faster than either alternative, because the walk
  never opens the directories in question: on a project with 20 000 files under
  root-level `dist`/`build`/`vendor`/`coverage`, the walk is 6 ms, against 19-23 ms for
  the blacklist as it was (which loses the vendor page) and 63-69 ms for a blacklist
  shortened to the safe names (which keeps it). On four real projects: 71-78 → 31-34 ms,
  35-38 → 30-34 ms, 20-21 → 18-19 ms, and one unchanged at 23-28 ms.

  One consequence: files outside the app subtrees — `seed/post_import/**`,
  `tests/post_import/**` — are no longer preloaded by the language server, matching what
  the linter's app has contained since `getApp` was anchored. Opening one still manages
  it, as opening any supported file always has.

  **`lintBuffer` now says whether it checked the file at all.** It returns
  `{ status, offenses }` instead of `Offense[]`. Three kinds of path are never linted —
  one the config's `ignore` list covers, one outside `app/`/`marketplace_builder/`/
  `modules/<name>/(public|private)/`, and an asset with no parser or checks — and each
  used to come back as an empty `Offense[]`, which is exactly what a clean file returns.
  For `pos-cli check` that is harmless; for an agent asking "is this file OK before I
  write it?" it is the wrong answer given confidently. `status` is `checked`,
  `excluded-by-config`, `not-an-app-file` or `not-a-source-file`, and `offenses` is empty
  for all but the first. `pos-cli check`'s own behaviour is unchanged — it goes through
  `appCheckRun`, not this seam. The MCP supervisor carries the reason into
  `next_step` until its result contract grows a status of its own.

  **VS Code now sends YAML buffers to the language server.** `documentSelectors` had no
  `yaml` entry, so translations, tables, user profile types and transactable types got no
  diagnostics, completions or go-to-definition — the server has handled them all along.
  The selectors are now derived from `SOURCE_FILE_EXTENSIONS`, with the `.yml` pattern
  anchored to `app/`, `marketplace_builder/` and `modules/` so that a
  `.github/workflows/ci.yml` is not handed to the language server. The dead `json`/`jsonc`
  selectors are gone: they matched Shopify's `{config,locales,sections,templates}` layout,
  and `JSONLanguageService` has nothing to serve, since platformOS publishes no JSON
  schemas.

  **Classification is anchored at the project root, and the extension is part of it.**
  Three changes that together make `platformos-common` the single answer to "is this a
  platformOS file, and if so what kind".

  `getFileType(uri, rootUri)` now REQUIRES a root, as does every `isPage` / `isPartial` /
  `isLayout` / `isAsset` / `isKnown*File` / `isSupportedSourceFile` predicate. A platformOS
  file is one whose position RELATIVE TO THE PROJECT ROOT matches the directory structure,
  so a classifier without a root cannot answer the question — it can only test whether a
  known directory name appears somewhere in the string. That is how
  `seed/post_import/app/migrations/20220517145452_index_rebuild.liquid` came to be a
  Migration to the language server, the graph and the VS Code extension while being
  correctly absent from the lint's app: it contains `app/migrations/` and is not deployed,
  so nothing it renders or queries exists to resolve, and every diagnostic on it was noise
  about a file the platform will never run. Callers get their root from what they already
  hold — checks from a new `context.fileType(uri?)` (which reads `AppFile.fileType` off the
  run's App, so the common path re-derives nothing), the graph from `AppGraph.rootUri`, the
  language server from `findAppRootURI`. **This is a breaking API change** for anything
  calling those exports directly.

  Classification also consults the EXTENSION now, mirroring each backend model's
  `PHYSICAL_PATH`: `app/graphql/x.yml` and `app/translations/en.json` are no longer a
  GraphQL file and a Translation. Page, Layout, Partial and Asset stay permissive, because
  `page.rb` and `instance_view.rb` are `(.+)` with no extension anchor — `app/views/pages/home.html`
  is a Page the platform deploys and the linter cannot read. **`.yaml` is no longer a
  platformOS extension**: every YAML model anchors `\.yml\z`, so `SOURCE_FILE_EXTENSIONS`
  is now `.liquid`, `.yml`, `.graphql`, and a project with `app/translations/en.yaml` stops
  getting diagnostics for it — that file was never deployed. `ActivityStreamsHandler` and
  `ActivityStreamsGroupingHandler` are new file types.

  **There is no ignore list left.** `isSupportedSourceFile` is the intersection of two
  whitelists — the platform deploys it, and we have a parser for it — and nothing else. It
  used to open with a `/\.(s?css|js)\.liquid$/` test, and an ignore list is only consulted
  by the callers of whoever holds it: the language server refused `theme.css.liquid` while
  the lint put it in the app with the Liquid+HTML parser and reported
  `LiquidHTMLSyntaxError` on it. A file we cannot parse is now one with no row in the
  parser table, which is keyed on the RESPONSE FORMAT for `.liquid` files, because the
  format is the body language. `users.json.liquid` is parsed; `theme.css.liquid` and
  `run.js.liquid` are not, by either tool. `.scss.liquid` changes the other way: `scss` is
  not in the platform's FORMAT_ENUM, so that file is a partial named `x.scss` and is now
  linted.

  App file sets and per-check offense totals are identical before and after on four real
  projects (946 files / 43 offenses, 3139 / 9623, 2789 and 2895).

  Behaviour changes worth knowing about:

  - **`OrphanedPartial` is REMOVED**, and with it the `singleFileOnly` check partition
    it was the only member of. It asks "is any file rendering this partial?", which no
    index answers without every Liquid file parsed — and, once wired up and measured, it
    answered wrongly too often to ship: 231 hits on a module project, every one of
    them a module's `public/` API whose callers live in other repositories; and on a
    large site a large share of the 465 hits were partials invoked BY NAME, either through
    a dispatcher (`mutation_name: 'authentications/delete'`) or as a callback
    (`access_callback: 'lib/can/theme_manage'`), which static analysis cannot see. A
    warning that is wrong that often is one nobody reads.

    Removing it removes the reason for the partition: every remaining check answers for
    one file, resolving against the project through indexes that are already cached
    (`MissingPage` through the route table, `MissingPartial` through the name index).
    So `CheckOptions.singleFileOnly`, `meta.singleFile` and `Dependencies.getReferences`
    are gone, and the editor, `pos-cli check` and `validate_code` now run exactly the
    same set of checks. `validate_code`'s `mode: full | quick` input is REMOVED with it:
    the partition was the only thing it could have selected. Unknown arguments are
    dropped by the MCP SDK, so a caller that still sends `mode` gets the same result it
    always did.

  - Translation lookups now treat "an open editor buffer" as a file with a defined
    `version`, rather than any file present in the app object. Contents are otherwise
    read from the filesystem.
  - Six packages that imported `@platformos/*` siblings without declaring them now do
    (they had resolved only through workspace hoisting).

  **The language server holds the same `App`, so opening a workspace no longer parses
  it.** `DocumentManager` was a second, LSP-shaped store of source codes beside the
  model — its own `Map<uri, AugmentedSourceCode>`, and a `preload` that read AND eagerly
  parsed every file in the project. It now holds one `App` per project root and delegates:
  `open`/`change` are `setSource`, `delete`/`rename` go through the App's own index (so
  deleting an `app/modules/X` overwrite promotes the `modules/X` original back), and
  `app(root, includeFilesFromDisk)` is `App.sourceCodes()` — the same intersection
  `isSupportedSourceFile` names, asked of a file that classified its own path once
  instead of re-derived per call per predicate. `preload` classifies the walk's paths
  (no I/O), reads the ones with a parser, and parses nothing; an `AppFile` parses on the
  first `ast`.

  Measured through the real language server on a 2735-liquid-file project —
  `initialize` → `didOpen` → the first `publishDiagnostics` — median of five runs: first
  diagnostic 17,742 → **771 ms**, first completion 191 → 187 ms, RSS 705-720 → **333-347
  MB**, with byte-identical diagnostics. One cost MOVES rather than disappearing: a
  whole-project graph build now pays for the parses `preload` used to
  (`appGraph/dependencies` 198 ms → 11.5 s there, one-time — the ASTs stay on the
  files, so the next request is 1 ms). Total time to a graph still falls, 18.0 → 12.4 s,
  and it is off the startup path.

  `set()` also classifies WITH a root now, like every other consumer: the app a URI falls
  under supplies one, so "is this part of an app" is asked the way `getFileType`, the
  checks and the graph ask it. A readable file the platform does not deploy
  (`scripts/build.liquid`) is still an editor document — formatting, hover, completions —
  and is in no `App`, so it gets no diagnostics and no graph node.

  **The graph and the checks now parse each file once, not once each.** `AppGraphManager`
  builds its `getSourceCode` with `appBackedGetSourceCode(app, fallback)`, and the app is
  built with check-common's `sourceParsers` merged with the graph's `.js`/image entries,
  so both halves of the process hold the SAME `AppFile` instances. `sourceParsers` is new
  and is the single definition of how a file becomes an AST; check-node's `nodeParsers` is
  now an alias for it. The graph's `toSourceCode` remains as the path for a caller holding
  a buffer and no app — an in-flight `validate_code` buffer, a URI outside the project —
  which by definition has no `AppFile`.

  Two bugs fixed on the way, both of which cost cross-file diagnostics silently:

  - `runChecks` never waited for `preload`, so the first check of a session could run
    against a project that had not been read and quietly miss every diagnostic that
    depends on another file's `{% doc %}`. It got away with it only because `preload` was
    slow enough to monopolise the event loop.
  - A file the workspace could not READ stayed in the app with no contents, and
    `AppFile.source` throws rather than returning `''`. One unreadable file therefore cost
    the whole run. A file is a document here exactly when its contents are in memory,
    which is the set the old `Map` held.

  **A malformed translation file no longer costs a project its document links.**
  `TranslationProvider` let `yaml.load` throw, and a duplicated mapping key — two people
  adding the same key, which real projects have — made `textDocument/documentLink` reject
  for the whole file: the `render` links disappeared along with the translation ones, while
  hover and go-to-definition kept working because they are separate requests. Parse
  failures are values here now, the same contract `AppFile.ast` and `toYAMLAST` keep; an
  unparseable translation file contributes no translations, exactly as a missing one does,
  and the linter still reports the syntax error against the file that has it.

- a8f4da9: `lintBuffers` says whether it checked the file, and the supervisor turns that into advice an
  author can act on.

  An empty `Offense[]` means "no problems found" only when something looked. For a path the
  config excludes, an asset, or a file outside every deployed subtree it means "never
  examined", and the two are indistinguishable at the call site. `lintBuffer`/`lintBuffers` now
  return `{ status, offenses }` with a five-value `LintBufferStatus`: `checked`,
  `excluded-by-config`, `misplaced-source`, `not-a-platformos-file`, `not-a-source-file`.

  The two out-of-app cases are split HERE, where classification happens, so an embedder never
  re-derives the distinction from a raw path — and it matters because the remedies are
  opposite. A `.liquid` outside every deployed subtree is a platformOS source the platform will
  never load: dead code, and the author needs to hear that. A `.jsx` component in `src/` is a
  file that was never meant to be platformOS code, and telling its author to "move it under
  `app/`" is wrong advice. The supervisor maps these to `misplaced_source` and
  `unsupported_type` through one total table, so a status added upstream fails the BUILD at the
  point where someone has to decide what the agent should hear, rather than falling into a
  catch-all and reporting a plausible wrong reason.

  Neither blocks a write. A misplaced source is very likely a mistake, but "likely" is a guess
  about intent — a fixture or a generator template lives there legitimately — and a gate that
  vetoes legitimate work on a guess gets switched off.

  **An asset is never judged, decided by TYPE rather than by whether a parser accepts the
  extension.** The gate asks `platformos-common`'s `isParsedFileType`, so it and the lint
  cannot disagree about a path — see the separate changeset for the rule and the false block
  it closes.

  Also: `fingerprintOf` and `isKnownFingerprint` are exported for an embedder running its own
  never-stale cache over the same project. The sentinel itself stays private — it equals
  itself, so a cache that STORES it for an unreadable file would compare equal on the next scan
  and call the file unchanged forever.

- e3a7fb0: A space between a variable and its key path is a PARSE error on the platform, in a write target only.

  `{% assign h ['k'] = 9 %}` parsed here and is refused by platformOS. Measured against
  `/api/app_builder/liquid_exec` and, because a syntax claim is only settled by the converter,
  against `pos-cli deploy --dry-run` — which REJECTS it 2/2 with its space-free control accepted.
  A converter rejection fails the WHOLE changeset, so this was a false approval with the same
  blast radius as `{% layout %}`: the gate said `must_fix_before_write: false` and the deploy took
  every other file down with it.

  The platform's own rule is one regex — `LHS_PATTERN` in `app/lib/liquify/tags/hash_assignable.rb`:

  ```ruby
  MIXED_KEYS_PATTERN = '(?:\.[\w\-]+|\[.+?\])+'
  LHS_PATTERN        = "(#{VARIABLE_NAME})(#{MIXED_KEYS_PATTERN})?"
  ```

  There is no `\s*` between the name and the key path, and the alternation covers `.foo` as well as
  `[…]`. So the constraint is **no whitespace between a variable and the start of its key path**, both
  accessors — not "no space before a subscript", which is how it was filed. Three tags share that
  pattern, and all three were affected, each with its own error text:

  ```liquid
  {% assign h ['k'] = 9 %}        Syntax Error in 'assign'
  {% assign h .k = 9 %}           Syntax Error in 'assign'
  {% hash_assign h ['k'] = 9 %}   Syntax Error in 'hash_assign'
  {% function r ['k'] = 'p' %}    Invalid syntax for function tag
  {% assign a ['z'] << 'x' %}     Syntax Error in 'assign'      <- the append operator too
  ```

  **Scoped to write targets, and that is the whole design.** The identical spelling in a READ resolves
  correctly on the platform, so narrowing the shared `lookup` rule would have traded one false approval
  for six false blocks — strictly the worse bug, since a false block cannot be overridden:

  ```liquid
  {{ h ['k'] }}   {{ h.a [0] }}   {{ h[ 'k' ] }}
  {% assign v = h ['k'] %}   {% if h ['k'] %}   {% echo h ['k'] %}
  ```

  `lookup` and `liquidVariableLookup` are therefore untouched; `assignTarget` and the `hash_assign` /
  `function` markups take a new target-only rule. `{% liquid %}` bodies inherit it, because that
  grammar only redefines `space`. The AST shape is unchanged, so stage 2, the printer and the language
  server needed no change — the two stage-1 additions are passthrough mappings.

  **A space INSIDE the brackets stays legal**, because `\[.+?\]` matches it, and so does a spaced
  bracket that follows another bracket — `h['a'] ['b']` assigns. Both were measured rather than
  assumed, and the first version of this change refused the second one: a false block, caught only by
  re-checking every spelling against the instance instead of trusting the unit tests.

  The printer now emits a refused target VERBATIM. It used to repair the spacing by accident, which hid
  the error from anyone who formatted and left it in place for everyone who did not.

  Known gap, pinned rather than left implicit: `{% assign h.a ['b'] = 9 %}` — a spaced bracket after a
  DOT — is still accepted and the platform refuses it. Expressing "spaced bracket only after a bracket"
  needs a recursive chain that would replace the flat `lookups` iteration the stage-1 mapping indexes,
  so it stays as it was, with a test asserting today's behaviour so it cannot be mistaken for covered.

  Verified on a real 2 768-file application: `pos-cli check` reports 13 225 offenses over 2 002 files,
  byte-identical to before, and `LiquidHTMLSyntaxError` still exactly 122 — no new offense on code that
  ships.

- Updated dependencies [a8f4da9]
- Updated dependencies [a8f4da9]
- Updated dependencies [cf80cfa]
- Updated dependencies [8f1beea]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [e3a7fb0]
- Updated dependencies [7e7f1cd]
- Updated dependencies [a8f4da9]
- Updated dependencies [4567a07]
- Updated dependencies [a8f4da9]
- Updated dependencies [f644a30]
- Updated dependencies [a8f4da9]
- Updated dependencies [cf80cfa]
- Updated dependencies [f15573d]
- Updated dependencies [cf80cfa]
- Updated dependencies [a8f4da9]
- Updated dependencies [d7374a8]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [280a66f]
- Updated dependencies [e3a7fb0]
- Updated dependencies [cf80cfa]
- Updated dependencies [a8f4da9]
- Updated dependencies [280a66f]
- Updated dependencies [4b6e0aa]
- Updated dependencies [c0907ab]
- Updated dependencies [f15573d]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
- Updated dependencies [cf80cfa]
  - @platformos/platformos-common@0.1.0
  - @platformos/platformos-check-common@1.0.0
  - @platformos/platformos-check-node@1.0.0
  - @platformos/platformos-language-server-common@0.1.0
  - @platformos/platformos-graph@0.1.0
  - @platformos/liquid-html-parser@0.1.0
