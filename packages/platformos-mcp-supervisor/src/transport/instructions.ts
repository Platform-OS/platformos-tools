/**
 * Server-level instructions, returned to the client in the `initialize` response
 * and surfaced to the model alongside the tool list.
 *
 * SEPARATE FROM THE TOOL DESCRIPTION, which answers "what does this tool do and how do I
 * call it". These answer "how do I USE this server correctly" — when to reach for it, and
 * how to read an answer. The costly mistakes an agent makes here are interpretation
 * mistakes, not calling mistakes.
 *
 * WHAT MAY BE WRITTEN HERE is a narrow rule (ARCHITECTURE.md §Invariants #6): this server
 * describes ITSELF and never the platform, so a claim belongs here only if NO DIAGNOSTIC
 * COULD CARRY IT —
 *
 *   - how to read the answer, since no finding explains the envelope;
 *   - a SILENCE, which by definition no diagnostic can convey, and mistaking silence for
 *     approval is the failure this server exists to prevent.
 *
 * Platform semantics do not belong here: each is measured to fire a real diagnostic
 * (`transport/instructions-coverage.spec.ts` holds the fixtures) and each diagnostic
 * carries its check's documentation URL, so prose here would be a staler second copy.
 *
 * WRITING RULES: state what to DO, not how the server is built; every claim must be true
 * of the current build, since overstating coverage converts "I do not know" into false
 * confidence; keep it short enough to be read in full, because this is spent context on
 * every session.
 */
import { allChecks } from '@platformos/platformos-check-common';

/**
 * The coverage line, DERIVED so it cannot describe a build that no longer exists.
 *
 * A COUNT, not a roll of check names: an agent does not choose checks, and each finding
 * already names its own. What the count conveys is scale, which is a decision input before
 * the first call.
 */
function coverage(): string {
  return `${allChecks.length} checks`;
}

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
    misplaced_source - a platformOS source outside every deployed subtree; nothing
                       checked it and nothing will load it either
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
  Each finding names the check that produced it, and where see_also is present it links
  that check's documentation — read it there rather than guessing at the rule.
  A finding may carry fix (edits that are safe to apply as given) or suggestions
  (alternatives to choose between). Their start_index / end_index are 0-based offsets
  into the buffer you sent — NOT the 1-based line/column on the same finding. Apply
  several edits from the end backwards, or account for the drift.

truncated
  Present ONLY when a file had so many findings that the lists were shortened to
  keep the answer a reasonable size; absent means the lists are complete. It gives
  the true total per affected list, so "returned: 40, total: 900" means 860 more
  exist. The lists keep the TOP of the file, where a cascade's root cause usually
  is. status and must_fix_before_write are always computed from ALL findings, never
  from the shortened list, so a truncated answer is never a softer verdict — fix
  what is listed and validate again to see the rest.

impact
  Reports ONE thing: existing callers whose arguments no longer match the {% doc %}
  contract your buffer declares — each named, with what is missing or undeclared. Worked
  out from the project as it stands at the moment of the call, your other buffers included.
  The \`signature_risk\` list is there only when there is something to report, and is computed
  only when your buffer declares a {% doc %} block; otherwise \`status: not_applicable\` — no
  contract, nothing to compare callers against. At most 10 callers are listed.
  NOTHING HERE IS A CLEARANCE. An empty impact means no mismatch was found among the callers
  that are VISIBLE, and a caller can be invisible: {% render partial_name %} picks its target
  at runtime, so no analysis can resolve it. This server never tells you nothing depends on a
  file — if you are about to delete or rename one, search the project yourself.

WHAT IS NOT CHECKED
${coverage()} run against your buffer. Where a finding exists it explains itself and links
its documentation, so what follows is only the SILENCES — the places where finding nothing is not the same
as finding it correct, and where no diagnostic can tell you so.

  Argument types are checked only where the platformOS documentation publishes a type.
  An argument the documentation leaves untyped accepts more than one type and is never
  reported — which is every argument of every core Liquid filter, because those coerce
  rather than refuse. {{ 5 | upcase }} renders and is not reported. That silence is the
  documentation's answer, not a guarantee the value is right.

  A model schema's property TYPE is checked and an unknown one is reported. The rest of a
  schema's shape is not: an unrecognised top-level key is rejected on deploy and nothing
  reports it, so silence there is not a claim the key is valid. A duplicated property name
  IS accepted by the platform.

  Duplicate YAML keys are compared the way the platform's own parser resolves them, so
  yes: and true: in one mapping are reported as the one key they become. That comparison
  is NOT exhaustive — a few spellings collide on the platform and are not reported — so
  silence there does not prove two keys are distinct.

  Coverage is per project: checks can be enabled, disabled or ignored in the project's
  .platformos-check.yml, so a clean result reflects that project's configuration rather
  than a fixed universal standard.`;
