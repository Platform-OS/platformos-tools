/**
 * Shared input for the request-path I/O adapters (`lint/`, `impact/`).
 *
 * Both adapters receive the identical `{ projectDir, filePath, content }` and
 * must agree on the buffer's absolute path, so the shape, the absolute-path
 * resolution, and the "is this file ours to judge?" decision all live here
 * rather than being duplicated per adapter.
 */
import { isAbsolute, join, relative, sep } from 'node:path';

import { isSupportedSourceFile, path as pathUtils } from '@platformos/platformos-check-common';

import { LINT_MS_PER_KIB } from './cost-model.js';
import type { Declined } from './result/types.js';

export interface AdapterInput {
  /** Absolute project root the buffer is validated against. */
  projectDir: string;
  /** File under edit — absolute, or relative to `projectDir`. */
  filePath: string;
  /** In-memory buffer contents. */
  content: string;
}

/**
 * Resolve the file under edit to an absolute path: returned as-is when already
 * absolute, else joined onto the project root.
 *
 * Both branches normalize `.`/`..` segments — `join` does so directly, and
 * {@link fileApplicability}'s `relative` call resolves its arguments — so a
 * traversal like `../../../etc/passwd` cannot survive the containment check
 * below by hiding inside an unnormalized string.
 */
export function toAbsoluteFilePath(projectDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(projectDir, filePath);
}

/** Whether `validate_code` has anything to say about a file — and if not, why. */
export type FileApplicability = { applicable: true } | ({ applicable: false } & Declined);

/**
 * Decide whether the buffer is a file this server can validate.
 *
 * WHY THIS GATE EXISTS. Without it every path is linted, and because
 * check-common's `toSourceCode` types any unrecognized extension as
 * `SourceCodeType.JSON`, the file is JSON-linted — so `/etc/passwd` came back
 * as `ValidJSON: Expected a JSON object, array or literal.` with
 * `must_fix_before_write: true`. That is wrong in BOTH directions, and the
 * second is the dangerous one:
 *
 *   - FALSE BLOCK: a legitimate in-project `README.md` edit is reported as an
 *     error the agent must fix before writing.
 *   - FALSE APPROVAL: `/etc/shadow` containing `{}` is valid JSON, so the call
 *     returned `status: 'ok'` — an agent that trusts the write gate reads that
 *     as "validated, safe to write" for a path outside the project entirely.
 *
 * A declined file therefore gets its own terminal status (`not_applicable`)
 * rather than an `ok` or an `error`: the only honest answer is "not mine to
 * judge", which neither blocks nor approves the write.
 *
 * TWO INDEPENDENT RULES, in order:
 *
 * 1. CONTAINMENT. The resolved path must lie strictly inside `projectDir`.
 *    Checked on the `relative()` result rather than by string prefix, because a
 *    prefix test accepts a sibling root whose name merely extends the project's
 *    (`/srv/app-backup` vs `/srv/app`). The first segment being `..` means the
 *    path climbed out; an empty result means the path IS the root (a directory —
 *    what an empty `file_path` used to resolve to); an absolute result means a
 *    different Windows drive. This is a correctness gate, not a security
 *    boundary — the server only ever READS, and the caller supplies the buffer
 *    contents anyway — so no symlink resolution is attempted (that would be I/O
 *    on the request path for no gain).
 *
 * 2. SUPPORTED TYPE. Reuses check-common's `isSupportedSourceFile`, which was
 *    verified to agree with check-node's App-membership filter
 *    (`getAppFilePaths`) on every case: `.liquid` in a recognized directory,
 *    `.graphql`, and translation/model `.yml`, with asset partials
 *    (`.css/.js/.scss.liquid`) and standalone `.json` excluded. Sharing the
 *    predicate is what keeps the gate from drifting away from what the linter
 *    would actually have looked at — if lint would not have visited the file,
 *    saying so beats inventing a diagnostic about it.
 */
export function fileApplicability(projectDir: string, filePath: string): FileApplicability {
  const absolute = toAbsoluteFilePath(projectDir, filePath);
  const relativeToRoot = relative(projectDir, absolute);

  if (
    relativeToRoot === '' ||
    isAbsolute(relativeToRoot) ||
    relativeToRoot.split(sep)[0] === '..'
  ) {
    return {
      applicable: false,
      code: 'outside_project',
      reason:
        `\`${filePath}\` resolves outside the project root (${projectDir}), so there is no ` +
        `project context to validate it against. This server validates only files inside the ` +
        `project it was started for. Nothing was checked — treat this as "unknown", not as approval.`,
    };
  }

  const uri = pathUtils.toUri(absolute);

  if (!isSupportedSourceFile(uri)) {
    // Shown with forward slashes on EVERY platform. `relativeToRoot` above comes from
    // `node:path.relative`, which is right for the containment decision but yields
    // `app\notes.txt` on Windows — echoing a separator back to the agent that it did
    // not send, for a path it has to recognize as its own. check-common's `relative`
    // is URI-based and forward-slash by construction.
    const displayPath = pathUtils.relative(uri, pathUtils.toUri(projectDir));
    return {
      applicable: false,
      code: 'unsupported_type',
      reason:
        `\`${displayPath}\` is not a platformOS source file, so there are no checks that ` +
        `apply to it. Validation covers Liquid in a recognized platformOS directory, ` +
        `\`.graphql\` operations, and translation / model \`.yml\`. Nothing was checked — ` +
        `writing this file is your call, not a validated pass.`,
    };
  }

  return { applicable: true };
}

/**
 * Largest buffer this server will validate, in bytes.
 *
 * CHOSEN FROM MEASUREMENT of the FULL LINT, not the parse alone — an earlier
 * version of this constant was sized against `toLiquidHtmlAST` in isolation and
 * was 4x too generous, which let a *legal* 400 KiB buffer blow the 30 s deadline
 * in an end-to-end run. Parsing is only part of the cost; every enabled check then
 * walks the AST.
 *
 * `lintBuffer` against a real 162-file project, warm cache:
 *
 *   ```
 *      16 KiB ->   1.2 s
 *      32 KiB ->   2.7 s
 *      64 KiB ->   3.7 s
 *     128 KiB ->   7.1 s     <- the bound
 *     192 KiB ->  11.7 s
 *     256 KiB ->  15.6 s
 *   ```
 *
 * ~61 ms/KiB. And the parser alone falls off a cliff further out: 1 MiB takes
 * ~30 s, 2 MiB throws `RangeError: Maximum call stack size exceeded` inside ohm's
 * CST->AST recursion, and 4 MiB produced a native V8 abort.
 *
 * 128 KiB keeps the worst LEGAL buffer at ~7 s isolated (roughly 15 s under
 * contention with a graph build), comfortably inside the deadline it is granted,
 * while still admitting 1.7x the largest real source file found across local
 * projects (a 76 KiB icon-sprite partial). A Liquid template past this size is
 * pathological on its own terms, and the refusal says so.
 *
 * This bound is NOT derived from `cost-model.ts` — it is the older, independent
 * measurement, and it answers a different question: how large a SINGLE file may be
 * before the parser itself becomes the problem, which is a property of the parser
 * rather than of any deadline. It is nonetheless checked against the model, and the
 * two agree: `lintDeadlineMs(MAX_BUFFER_BYTES)` is exactly `MIN_LINT_DEADLINE_MS`,
 * so a maximal single buffer sits precisely at the floor the model would have
 * granted it anyway. `cost-model.spec.ts` pins that agreement, so the two stop
 * being independent numbers that happen to be compatible today.
 *
 * WHY THE BOUND IS THE REAL GUARD, NOT THE DEADLINE. Verified end to end: a
 * deadline cannot interrupt a synchronous parse, and the timer cannot even FIRE
 * during one — a 400 KiB buffer returned after 45 s against a 30 s deadline,
 * because the event loop was blocked until the parse finished. The deadline is a
 * backstop for ASYNC stalls (a wedged fs call, a hung graph lookup); only this
 * bound protects against CPU-bound input. And a native V8 abort is not catchable
 * from JS at all, so nothing downstream could help there.
 */
export const MAX_BUFFER_BYTES = 128 * 1024;

/**
 * A refusal when the buffer is too large to validate, else `undefined`.
 *
 * Measured in BYTES, not string length: parse cost tracks byte size, and
 * `content.length` would under-count multi-byte content by up to 3x — admitting a
 * buffer three times the intended cost.
 */
export function bufferTooLarge(content: string): Declined | undefined {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= MAX_BUFFER_BYTES) return undefined;

  return {
    code: 'too_large',
    reason:
      `The buffer is ${Math.round(bytes / 1024)} KiB, above the ${Math.round(
        MAX_BUFFER_BYTES / 1024,
      )} KiB limit this server will validate, so it was refused before parsing. ` +
      `Liquid validation costs about ${LINT_MS_PER_KIB} ms per KiB and the parser stops ` +
      `completing at all a few ` +
      `MiB out, so checking this would risk hanging the server rather than answering. Nothing ` +
      `was checked — consider splitting the file, which is almost certainly worth doing at this ` +
      `size regardless.`,
  };
}

/**
 * The refusal for a file the project's config excludes from linting.
 *
 * Not an error and not an `ok`: `check()` skips ignored files silently, so "no
 * offenses" for one means "never looked at". Reporting that as `ok` made the write
 * gate approve, for example, an ignored page containing unparseable Liquid — the
 * same false approval an off-project path used to produce.
 */
export function ignoredByProjectConfig(relativePath: string): Declined {
  return {
    code: 'ignored',
    reason:
      `\`${relativePath}\` is excluded by the \`ignore\` list in this project's ` +
      `\`.platformos-check.yml\`, so no check ran against it. Nothing was checked — this is not ` +
      `a pass. Remove it from \`ignore\` if you want this file validated.`,
  };
}
