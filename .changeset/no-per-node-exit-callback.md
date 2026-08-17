---
'@platformos/platformos-check-common': minor
---

`Check<T>` no longer offers a per-node `` `${NodeType}:exit` `` method, and the walker no
longer dispatches one.

It never meant what its name said. The walk dispatches entry, pushes the node's children,
then dispatches exit — all in one loop iteration, with the children popped in later ones —
so `X:exit` ran while the whole subtree under `X` was still unvisited. It was a second
entry callback, and the type's own comment claimed the opposite ("in reverse order") until
the behaviour was recorded from the running code.

Nothing consumed it. All 41 shipped checks use entry methods plus the
`onCodePathStart`/`onCodePathEnd` lifecycle hooks, and `onCodePathEnd` is unaffected — the
engine calls it after the whole walk resolves, so "after the file" there does mean after
the file. A check that needs to act after a subtree accumulates during the walk and acts
in `onCodePathEnd`, which is what every one of them already does.

Three options were on the table: make it post-subtree (the semantics the name implies),
rename it, or remove it. Removal wins on measurement rather than taste — the dispatch is
not free, because the lookup key has to be built per node:

| walker, over 80 060 real node visits | ns/node |
|---|---|
| today, with the exit lookup | 278 |
| **with the exit dispatch removed** | **210** |
| sentinel-based post-subtree, no exits declared | 307 |
| sentinel-based post-subtree, one exit declared | 305 |

So the honest exit hook costs ~10% MORE walk time than the broken one, and deleting the
broken one gives back **33% of the walker's own time** — a template-string allocation plus
a property lookup that every check paid on every node for a feature with no consumers.
Alternating paired passes, medians of nine rounds, 8-15% spread.

End to end that is 1-4% of whole-project CPU, the same direction in seven of eight paired
runs across `project-a`, `project-b`, `project-c` and `pos-module-community`. Offenses are
**identical** on all four — same sorted `check/uri/start/end/message` fingerprint and the
same file manifest, in both rounds — which is the only claim that matters for a change to
the traversal every check runs through.

`visitors/index.spec.ts` records the sequences for both ASTs, and its recorder offers a
method for every property asked of it, `:exit` included — so those two tests are also the
proof that nothing but the entry method is dispatched, and they fail first if the hook
comes back. Re-adding it is then a deliberate change with a failing test to flip, and it
needs the second stack frame the table above prices.
