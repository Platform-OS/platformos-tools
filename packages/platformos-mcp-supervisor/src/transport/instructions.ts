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

import { MAX_BATCH_BYTES, MAX_BATCH_FILES } from '../validate/batch-bounds.js';

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

/**
 * The request caps, DERIVED for the same reason as the count above.
 *
 * `MAX_BATCH_FILES` already reaches the model as `maxItems` on the tool's schema, but
 * `MAX_BATCH_BYTES` is computed from the cost model and appears in no schema and no prose —
 * so a caller could only learn it by being refused. Stated together because a batch is
 * planned against both at once, and derived so that moving the cost model moves this too.
 */
function bounds(): string {
  return `${MAX_BATCH_FILES} files and ${Math.floor(MAX_BATCH_BYTES / 1024)} KiB`;
}

export const SERVER_INSTRUCTIONS = `Tool Purpose: Validates platformOS Liquid, GraphQL and YAML files in-memory to prevent broken deployments.

CRITICAL USAGE RULES
- Validate BEFORE writing: always pass the proposed in-memory buffer. NEVER write to disk first. This is the primary quality gate. Skipping this tool is the #1 cause of broken platformOS code.
- Audit existing code with the same call: pass a file's current contents to learn whether what is on disk is already broken. Its own findings are real, but impact is not — impact lints the dependants with your buffer and again without it and reports the difference, so an unchanged buffer yields an empty impact by construction, not by safety.
- Batch interdependent files: if one change touches several referencing files, send them together in the files array so cross-references resolve. Sent one at a time, a partial you are creating alongside its caller is reported missing. Up to ${bounds()} per request.
- No duplicates: List each file at most once per request. A changeset cannot hold two versions of one file, so a request naming one twice is refused.

RESPONSE SCHEMA & ACTION DIRECTIVES

must_fix_before_write (Boolean)
- true: FATAL. Do NOT write the file. The deploy converter refuses the WHOLE changeset, not just this file.
- false: nothing blocking was found. This is NOT a statement that the code is correct, only that no known-fatal problem was detected. Keep your own judgement.

status (String)
- ok | warning | error: the file WAS checked; these describe what was found.
- not_applicable: the file was NOT checked. Neither approval nor refusal — it carries no opinion about the file.
  - not_applicable_reason: outside_project, unsupported_type, misplaced_source, ignored, too_large, timed_out, internal_error.
  - next_step: the one to act on. It names the path, limit or deadline actually hit, and what to do about it.
  - too_large: one buffer, or the request as a whole, is above its size limit. next_step says which, so shrink a file or send fewer per call accordingly.
  - Retry: timed_out is worth another call. internal_error is two cases — a malformed request (both input forms at once, neither, or one file listed twice) is yours to fix and worth retrying once fixed; a validator bug is not, and no retry will change it.

errors, warnings, infos (Arrays)
- Each array is ordered by line then column WITHIN ITSELF. The three are not one sequence, so concatenating them does not walk the file in order. Columns count UTF-16 code units, so an emoji advances the column by 2.
- errors[] can be non-empty while must_fix_before_write is false: an argument a partial ignores, a missing asset, a missing image dimension are real but do not stop the file working.
- Fixes and suggestions carry start_index / end_index: 0-based offsets into the buffer you sent, NOT the 1-based line/column on the same finding.
- Action: to avoid offset drift, apply multiple edits from the bottom of the file upwards.
- Action: where see_also is present, read that check's documentation rather than guessing at the rule.

truncated (Object)
- Present only when a file produced too many findings to return in full. The lists keep the TOP of the file, where a cascade's root cause usually is.
- Constraint: status and must_fix_before_write are ALWAYS computed from the true total of findings, never from the shortened list. Fix what is listed and re-validate to see the rest.

impact (Object)
- What this change BREAKS in files you are NOT editing — the one thing a per-file lint cannot see, since it only looks at the buffers you sent.
- It reports only what your change INTRODUCED. A problem the file already had is never listed, however severe.
- Constraint: a dependant break does NOT set must_fix_before_write. Your buffer may be perfectly correct; fix the callers or decide not to.
- impact.status:
  - computed: the dependants were linted with your change and without it.
  - not_applicable: no dependant the graph can find names this file. That is not a clearance.
  - unavailable | disabled: the comparison never ran. An empty impact under either is NOT a finding of safety.
- unchecked_dependants: present when a file has more dependants than one request will lint, so an otherwise-clean answer carrying it is a PARTIAL one.
- NOTHING HERE IS A CLEARANCE. A dependant can be invisible: {% render partial_name %} picks its target at runtime, so no analysis can resolve it. This server never tells you nothing depends on a file — before renaming or deleting one, search the project yourself.

LIMITATIONS (what a clean result does NOT prove)
${coverage()} run against your buffer. Coverage is per project: checks can be enabled, disabled or ignored in .platformos-check.yml, so a clean result reflects that configuration rather than a fixed universal standard. Where a finding exists it explains itself and links its documentation, so what follows is only the SILENCES.
- An argument the documentation leaves untyped accepts more than one type and is never reported — which is every argument of every core Liquid filter, because those coerce rather than refuse. {{ 5 | upcase }} renders and is not reported.
- A model schema's property TYPE is checked and an unknown one is reported. The rest of the shape is not: an unrecognised top-level key is rejected on deploy and nothing reports it.
- Duplicate YAML keys are compared the way the platform's own parser resolves them, but NOT exhaustively — a few spellings collide on the platform and are not reported, so silence there does not prove two keys are distinct.`;
