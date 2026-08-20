---
'@platformos/lang-jsonc': minor
---

No functional change — this is a version realignment.

The 2026-07-21 npm release published 0.0.18 from source identical to this package's current
state, but its version commit never reached `master`, so the repository still declared 0.0.17.
Left alone, the offset is harmless right up until the next real change to this package, at
which point a patch bump resolves to the already-published 0.0.18 and `changeset publish`
skips it with a warning instead of failing — publishing nothing while the repo claims
otherwise. Moving to 0.1.0 clears the offset and aligns with the rest of the monorepo.
