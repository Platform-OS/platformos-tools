---
'@platformos/platformos-mcp-supervisor': minor
---

`validate_code` becomes a write gate an agent can act on, rather than a lint that returns a
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
