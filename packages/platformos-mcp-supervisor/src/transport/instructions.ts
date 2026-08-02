/**
 * Server-level instructions, returned to the client in the `initialize` response
 * and surfaced to the model alongside the tool list.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE TOOL DESCRIPTION. The tool description answers
 * "what does this tool do and how do I call it". These answer "how do I USE this
 * server correctly" — when to reach for it, and how to read an answer once you have
 * one. Those rules do not belong in a parameter description, and without them an
 * agent invents its own reading of the result. The most costly mistakes an agent can
 * make with this server are all interpretation mistakes, not calling mistakes:
 * treating a clean result as proof of correctness, or treating a `not_applicable` as
 * either approval or refusal.
 *
 * WRITING RULES FOR THIS TEXT.
 *   - State what to DO, not how the server is built.
 *   - Every claim must be true of the current build. An instruction that overstates
 *     coverage is worse than no instruction: it converts "I do not know" into
 *     false confidence, which is the failure mode this whole server exists to
 *     prevent.
 *   - Keep it short enough to be read in full. This is spent context on every
 *     session, competing with the user's actual task.
 */
export const SERVER_INSTRUCTIONS = `platformOS code validator.

WHEN TO USE
Call validate_code BEFORE writing or editing any platformOS Liquid, GraphQL or
YAML file — it validates an in-memory buffer, so call it with the content you are
about to write, not after writing. This is the primary quality gate. If you are changing several files as one coherent change,
send them together in a single call (see the tool's \`files\` parameter): files in
one call can reference each other, so a partial you are creating alongside its
caller resolves correctly. Sent one at a time, that same edit is reported broken.
List each file at most once — a changeset cannot hold two versions of one file, so a
request that names the same file twice is refused rather than guessed at.
Skipping this tool is the #1 cause of broken platformOS code.

HOW TO READ THE RESULT

must_fix_before_write
  true  -> Do NOT write the file. It will not parse, it will raise at runtime, or
           the deploy converter will reject it — and a converter rejection fails the
           WHOLE changeset, not just this file.
  false -> Nothing BLOCKING was found. This is not a statement that the code is
           correct, only that no known-fatal problem was detected. Keep your own
           judgement.

status
  ok | warning | error  -> the file WAS checked; these describe what was found.
  not_applicable        -> the file was NOT checked at all. This is neither
                           approval nor refusal — it carries no opinion about the
                           file. Read not_applicable_reason before deciding:
    outside_project  - not inside the project this server serves
    unsupported_type - not a file type platformOS lints
    ignored          - excluded by the project's .platformos-check.yml
    too_large        - one buffer, or the request as a whole, is above its size
                       limit. Split the file, or send fewer files per call — the
                       reason text says which bound was hit
    timed_out        - validation was abandoned; retrying may work
    internal_error   - your REQUEST was malformed, or the validator hit a bug; the
                       reason text says which. A malformed request — both input
                       forms at once, neither, or one file listed twice — is yours
                       to fix and worth retrying once fixed.

errors / warnings / infos
  Each list is ordered by line then column WITHIN ITSELF; the three are not one
  ordered sequence, so concatenating them does not walk the file in order. Columns
  count UTF-16 code units, so an emoji advances the column by 2.
  Note that errors[] can be non-empty while must_fix_before_write is false: some
  errors are real problems that do not stop the file working (an argument a partial
  ignores, a missing asset, a missing image dimension). Fix them when you can; they
  do not block the write.

truncated
  Present ONLY when a file had so many findings that the lists were shortened to
  keep the answer a reasonable size; absent means the lists are complete. It gives
  the true total per affected list, so "returned: 40, total: 900" means 860 more
  exist. The lists keep the TOP of the file, where a cascade's root cause usually
  is. status and must_fix_before_write are always computed from ALL findings, never
  from the shortened list, so a truncated answer is never a softer verdict — fix
  what is listed and validate again to see the rest.

impact
  Which other files depend on this one. \`status: computing\` means the project graph
  is still being built — early in a session on a large project — and its zeroed
  counts are NOT a claim that nothing depends on the file.

WHAT IS ACTUALLY CHECKED
  Liquid  - syntax, unknown filters and tags, filters called with the wrong number
            of arguments, missing partials/assets, render arguments against
            {% doc %}, layout correctness, and more. Two that block and are easy to
            trip over: a JSON literal in {% assign %} must use DOUBLE quotes
            ({'k': 1} is rejected by the deploy converter, failing the whole
            changeset), and {% hash_assign %} needs a Hash with a key or an Array
            with a numeric index — nothing else.
  GraphQL - operations validated against the project schema.
  YAML    - syntax, for model/schema, transactable-type, profile-type and
            translation files: one that does not parse is reported and blocks,
            because the deploy converter rejects it and takes the whole changeset
            with it. Translation CONTENT is checked as well. A key defined TWICE in
            the same mapping is reported as a warning and does NOT block: the file
            deploys, the last value wins, and the earlier one is silently discarded.
            The SHAPE of a model schema is not checked — an unknown property is not
            reported, because the platform accepts it.

Coverage is per project: checks can be enabled, disabled or ignored in the
project's .platformos-check.yml, so a clean result reflects that project's
configuration, not a fixed universal standard.`;
