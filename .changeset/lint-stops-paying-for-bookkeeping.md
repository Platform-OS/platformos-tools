---
'@platformos/platformos-common': minor
'@platformos/platformos-check-common': patch
'@platformos/platformos-check-node': patch
---

Three per-run overheads removed from the lint, and a retention cap sized for a workload nobody runs.

Profiling a whole-project lint of a real 1509-file project (454 offenses, ~11 s) found that ~1.2 s of
it was bookkeeping rather than analysis, and that the first call's reads and parses were thrown away.
None of this is the parser — parsing is 56% of the run and is a separate problem.

**`isIgnored`: 849 ms → 55 ms, over the same 51,201 calls.** `check()` asks it once per (file, check),
and a project's global `ignore` is the same list for all 39 liquid checks, so those 12 patterns were
re-matched 39 times per file — each time preceded by a `uriFromPathOrUri` conversion, which made
`vscode-uri` 225 ms of self time on its own. The compiled matchers were already cached per
(config, check); the matching was not. The global verdict is now memoized per file, keyed on the
subject as the caller spelled it so a hit skips the conversion too, and a check's own patterns are
compiled alone and consulted only when it declares any — which also stops the global list being
compiled once per check on top of everything else.

Verified rather than argued: the previous implementation, inlined as an oracle, agrees on **all 67,770
(file, check) pairs** of that project — 25,290 ignored under both — and on a second project that
configures no `ignore` at all, which exercises the zero-pattern early return.

**`findNearestKeys`: 374 ms → 23 ms, for SEVEN suggestions.** Each call ran `levenshtein` against all
~977 translation keys, and `levenshtein` allocated a fresh `(a+1)×(b+1)` matrix per candidate — ~50 µs
to compare two short strings, and a visible share of the run's 706 ms of GC. It now uses two reused
rows, and `findNearestKeys` rejects a candidate on its length difference before the O(n·m) comparison,
since a length gap is a lower bound on the distance. Same results: a differential against the matrix
implementation agrees on every pair of a spanning set, and the boundary — a key whose length differs by
exactly `maxDistance`, which must still be offered — is its own test, because a pre-filter written with
`>=` passes every "nothing was suggested" assertion otherwise.

**Warming up took two whole passes, not one.** The freshness baseline was established by the first
revalidation AFTER a read, which therefore could not vouch for what it found and dropped it — so the
second call re-read and re-parsed everything the first had read. `AppFile.load()` now stats immediately
before it reads and keeps that as `loadedStat`, so a file read on call N is already vouched for on call
N+1 and is kept.

The order within the read is a correctness property, not a preference. Taken before, the worst case is
a baseline describing an OLDER state than the content, which fails the next comparison and re-reads.
Taken after, it could describe a write that landed during the read, and pairing that with the older
content in hand is exactly how a cache comes to serve stale source — so `App.spec` asserts the call
order directly, since no unit test can schedule that race.

Four lints in one process went from 13558 / 11513 / 8666 / 9869 ms to 13359 / **3449** / 3271 / 3245 —
warm on the second call, and 3.9× faster once warm. A single-buffer `lintBuffer` on the same file three
times went from 863 / 652 / 112 ms to 843 / **110** / 113. `pos-cli check run -a` runs `appCheckRun`
twice in one process, so the CLI pays this too.

**The measurement that justified the old order was right about its number and wrong about its
denominator.** It read "+25% on whole-project commands", and +25-31% is what an extra stat costs the
READ PHASE — which is 122 ms of a ~10 s lint. Best of six interleaved rounds over 1509 files: 122 ms
without, 160 ms with. 37 ms of stat against ~7 s of discarded parses.

**`MAX_RETAINED_FILES`: 200 → 10 000.** At 200 it was sized for the single-buffer lint that dominates a
long-lived process — 37 files for a real layout — and it priced whole-project work out of any reuse:
a repeated project-wide lint ran 8.4 s instead of the 4.1 s it costs with its parses still in hand.
A retained file holds its source and its AST at ~33 KB, so the whole 1509-file project costs +21 MB of
heap and a 6027-file project +200 MB; a cap still has to exist, but 200 was two orders below what it can
afford. The per-call price of a higher ceiling is revalidation's stat sweep at ~21 µs/file, so a fully
retained 10 000-file project would add ~200 ms per call — the number to weigh before raising it again.

Offense output is byte-identical on two real projects (454 and 149 offenses; uri, check, severity,
start, end and message compared), against a baseline rebuilt on the same commit — which matters,
because the session's first baseline was taken against a stale `dist` predating a 39th liquid check, and
that showed up as the `isIgnored` call count moving rather than as any offense difference.

One consequence worth knowing: `shared-app.spec` derives its over-cap project from
`MAX_RETAINED_FILES`, so it now materializes 10 020 temp files and takes ~6.7 s. That keeps it faithful
to the real cap, but it scales with any further raise; making the cap injectable is the alternative if
that becomes annoying.
