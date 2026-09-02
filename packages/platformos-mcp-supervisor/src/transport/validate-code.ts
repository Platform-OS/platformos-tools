/**
 * Registration of the `validate_code` MCP tool — the supervisor's entire surface.
 *
 * ONE TOOL, TWO INPUT SHAPES. Validating one file and validating a coordinated multi-file
 * change are the same operation on a different number of buffers, so they are one tool:
 *
 *   validate_code({ file_path, content })   -> a single result
 *   validate_code({ files: [...] })         -> one result per file + a batch gate
 *
 * There is no `many` flag — which form was sent is evident from the arguments.
 *
 * PASSING SEVERAL FILES IS MORE ACCURATE, not just faster: with every buffer overlaid at
 * once a partial created alongside its caller resolves, where one at a time it is reported
 * missing. The description says so, because that is why an agent should reach for it.
 *
 * This module owns only the MCP surface: schema, description, registration, and mapping
 * input shape to output shape. All logic lives in `validate/`.
 */
import { z, type ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAppPaths, PlatformOSFileType } from '@platformos/platformos-common';

import type { SupervisorContext } from '../context.js';
import type {
  ValidateCodeParams,
  ValidateCodeResult,
  ValidateFilesEntry,
  ValidateFilesResult,
} from '../result/types.js';
import {
  validateBuffers,
  type BufferToValidate,
  type ValidateAdapters,
} from '../validate/validate-buffers.js';
import { MAX_BATCH_BYTES, MAX_BATCH_FILES, batchTooLarge } from '../validate/batch-bounds.js';
import { collidingBufferPaths } from '../validate/batch-coherence.js';
import { assembleNotApplicableResult } from '../result/assemble.js';

/**
 * A non-blank path. Blank is malformed input, refused at the protocol boundary.
 *
 * BOTH halves are load-bearing and neither is redundant. The refinement is what
 * refuses a whitespace-only path; `.min(1)` is the half that SURVIVES conversion to
 * JSON Schema, as `minLength`. A refinement converts to nothing at all, so with the
 * refinement alone the rule exists only on this side of the wire — the model is
 * never told, sends `""`, and learns the rule from a rejection. Drop either half and
 * a test fails: the emitted schema loses `minLength`, or `'   '` starts being accepted.
 *
 * A FUNCTION, not a shared constant, for the same wire-level reason: the SDK's
 * converter dedupes by schema IDENTITY, so one instance reused across both input
 * forms emits `{ $ref: '#/properties/file_path' }` for the second use. That drags the
 * single-file description into the batch entries, where "Pair with `content`" is
 * wrong, and puts a `$ref` in a tool inputSchema — which not every MCP client
 * resolves. A fresh instance per use costs nothing and emits in full.
 */
const filePath = () =>
  z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, { message: 'file_path must not be empty' });

/** File contents. Empty is legal — an empty file is a file. Fresh per use, as above. */
const content = () => z.string();

/**
 * An example path of each kind, for the agent-facing prose below.
 *
 * DERIVED from `platformos-common`'s tables, not spelled out: an agent imitates these
 * strings when it invents a path, so an example naming a directory the platform stopped
 * accepting teaches the mistake to every caller.
 *
 * The first entry of `getAppPaths` is the canonical directory for the type; the rest are
 * legacy aliases, which are exactly what an example should not suggest.
 */
const exampleOf = (type: PlatformOSFileType, name: string) =>
  `${getAppPaths(type)[0]}/${name}.liquid`;

const EXAMPLE_PARTIAL = exampleOf(PlatformOSFileType.Partial, 'card');
const EXAMPLE_PAGE = exampleOf(PlatformOSFileType.Page, 'home');
const EXAMPLE_PROMO = exampleOf(PlatformOSFileType.Partial, 'promo');

/**
 * zod raw shape for the tool input (validated by the MCP SDK before dispatch).
 *
 * Both forms are optional at the schema level and the handler requires exactly one,
 * because a zod union of two object shapes defeats the SDK's JSON-Schema conversion
 * — it emits `anyOf`, which several MCP clients do not surface to the model at all.
 * Two optional fields with a documented rule converts cleanly and reads clearly.
 *
 * WHAT THE MODEL SEES IS THE CONVERSION, NOT THIS. Everything an agent knows about
 * the arguments arrives as the JSON Schema this shape converts to, so a constraint
 * that does not convert may as well not be advertised at all. Prefer a zod builtin
 * over a `.refine` wherever one expresses the rule; `transport/validate-code.spec.ts`
 * pins the emitted document end to end.
 *
 * Typed as `ZodRawShape` (not the inferred literal shape) so `registerTool` does not
 * instantiate excessively deeply over the schema (TS2589 under zod 3.25).
 */
export const VALIDATE_CODE_INPUT: ZodRawShape = {
  file_path: filePath()
    .optional()
    .describe(
      'Path of the file to validate, absolute or relative to the project root ' +
        `(e.g. "${EXAMPLE_PARTIAL}"). Pair with \`content\`.`,
    ),
  content: content()
    .optional()
    .describe('The exact file contents you are about to write. Pair with `file_path`.'),
  files: z
    .array(
      z.object({
        file_path: filePath().describe(
          'Path of THIS file, absolute or relative to the project root.',
        ),
        content: content().describe('The exact contents you are about to write to THIS file.'),
      }),
    )
    .min(1)
    .max(MAX_BATCH_FILES)
    .optional()
    .describe(
      'Two or more files to validate together, each with its own `file_path` and ' +
        '`content`. Files in one call can reference each other.',
    ),
};

const DESCRIPTION = `Validate platformOS Liquid, GraphQL and YAML code BEFORE writing it to disk.

Pass EITHER one file OR several — never both.

  One file:
    { "file_path": "${EXAMPLE_PARTIAL}",
      "content": "<div>{{ title }}</div>" }

  Several files (use this whenever one change touches more than one file):
    { "files": [
        { "file_path": "${EXAMPLE_PAGE}",
          "content": "{% render 'promo' %}" },
        { "file_path": "${EXAMPLE_PROMO}",
          "content": "<div>Promo</div>" }
      ] }

Sending several together is faster AND more accurate: they can reference each
other, so the new partial above resolves. Validated one at a time, the page would
be reported as rendering a missing partial. List each file at most once — the same
file twice is refused, because only one of the two could be checked.

Returns, for one file:
  { "status": "ok" | "warning" | "error" | "not_applicable",
    "must_fix_before_write": boolean,
    "errors": [...], "warnings": [...], "infos": [...],
    "impact": { ... } }

For several files:
  { "must_fix_before_write": boolean,
    "files": [ { "file_path": "...", "result": { ...as above... } } ] }

must_fix_before_write true means the file will not work — do not write it. false
means nothing fatal was found, which is not a guarantee of correctness.
status "not_applicable" means the file was NOT checked (see not_applicable_reason);
that is neither approval nor refusal.
A "truncated" field appears only when a file produced too many findings to return
in full; it carries the true total per list. The lists keep the top of the file,
and the verdict above is always computed from ALL findings, not the shortened list.`;

/**
 * The agent-facing prose, exported so tests can pin claims that must not rot. The
 * description is the agent's whole understanding of this tool; a stale sentence
 * here misleads silently.
 */
export const TOOL_TEXT = { VALIDATE_CODE_DESCRIPTION: DESCRIPTION } as const;

/** The MCP text-content envelope every tool result is serialized into. */
interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Minimal local signature for `server.registerTool`. The SDK's real generic computes
 * the handler's args type from the zod shape, which instantiates excessively deeply
 * under zod 3.25 (TS2589). Args are validated at runtime by the shape above.
 */
type RegisterTool = (
  name: string,
  config: { description: string; inputSchema: ZodRawShape },
  cb: (args: Record<string, unknown>) => Promise<ToolTextResult>,
) => unknown;

export function registerValidateCode(server: McpServer, ctx: SupervisorContext): void {
  (server.registerTool as unknown as RegisterTool)(
    'validate_code',
    { description: DESCRIPTION, inputSchema: VALIDATE_CODE_INPUT },
    async (args) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(await runValidateCode(ctx, args as unknown as ValidateCodeParams)),
        },
      ],
    }),
  );
}

/**
 * The tool handler: normalize the input shape, validate, and shape the response to
 * match what was asked.
 *
 * Returns the flat single-file result for the single form and the per-file envelope
 * for the batch form — the response mirrors the request, so a caller never parses a
 * shape it did not ask for.
 */
export async function runValidateCode(
  ctx: SupervisorContext,
  params: ValidateCodeParams,
  overrides: Partial<ValidateAdapters> = {},
): Promise<ValidateCodeResult | ValidateFilesResult> {
  const requested = requestedBuffers(params);
  if ('error' in requested) {
    ctx.log(`validate_code: rejected — ${requested.error.reason}`);
    return assembleNotApplicableResult(requested.error);
  }

  const { buffers, isBatch } = requested;
  ctx.log(
    isBatch ? `validate_code: ${buffers.length} file(s)` : `validate_code: ${buffers[0].filePath}`,
  );

  // Request-level refusals, decided before any work starts. First refusal wins; the cheaper
  // check runs first.
  //
  // GATED ON MORE THAN ONE BUFFER, not on which form carried it. One file is one file, and
  // the two forms must answer identically — the shape an agent happened to reach for cannot
  // change a verdict. Both refusals ask a question a lone buffer cannot answer YES to:
  // collision needs two entries naming one file, and the caps exist because a batch can hand
  // the server work no single buffer could. Collision was already a no-op at one buffer; the
  // total-byte cap was NOT, and it fired FIRST — so a 300 KiB file sent as a one-file batch
  // was refused with "split it into smaller batches", advice its caller cannot follow, and
  // was never told MAX_BUFFER_BYTES, the bound it actually had to get under. Whether ONE
  // buffer is admissible is `bufferTooLarge`'s question, asked per buffer inside
  // `validateBuffers` for both forms alike.
  const refusal =
    buffers.length > 1
      ? (batchTooLarge(buffers) ?? collidingBufferPaths(ctx.projectDir, buffers))
      : undefined;
  if (refusal) {
    ctx.log(`validate_code: refused (${refusal.code}) — ${refusal.reason}`);
    return {
      must_fix_before_write: false,
      files: buffers.map((buffer) => ({
        file_path: buffer.filePath,
        result: assembleNotApplicableResult(refusal),
      })),
      next_step: refusal.reason,
    };
  }

  const byFile = await validateBuffers(ctx, buffers, overrides);

  if (!isBatch) {
    // `validateBuffers` seeds an entry per requested buffer, so this always hits.
    return byFile.get(buffers[0].filePath)!;
  }

  const files: ValidateFilesEntry[] = buffers.map((buffer) => ({
    file_path: buffer.filePath,
    result: byFile.get(buffer.filePath)!,
  }));

  return {
    // A file that was merely NOT CHECKED must never block the changeset: this is the
    // OR of the files' own gates, and a `not_applicable` file's gate is false.
    must_fix_before_write: files.some((entry) => entry.result.must_fix_before_write),
    files,
  };
}

type RequestedBuffers =
  | { buffers: BufferToValidate[]; isBatch: boolean }
  | { error: { code: 'internal_error'; reason: string } };

/**
 * Read the two accepted input forms into the one internal shape.
 *
 * The SDK validates types; what it cannot express is "exactly one form". Both failures are
 * the caller's malformed request rather than a property of any file, and are reported as
 * such — silently preferring one form would validate something the caller did not ask about.
 */
function requestedBuffers(params: ValidateCodeParams): RequestedBuffers {
  const hasSingle = params.file_path !== undefined || params.content !== undefined;
  const hasBatch = params.files !== undefined && params.files.length > 0;

  if (hasSingle && hasBatch) {
    return {
      error: {
        code: 'internal_error',
        reason:
          'Both `files` and `file_path`/`content` were provided. Send ONE file as ' +
          '`file_path` + `content`, or several as `files` — not both. Nothing was checked.',
      },
    };
  }

  if (hasBatch) {
    return {
      buffers: params.files!.map((file) => ({
        filePath: file.file_path,
        content: file.content,
      })),
      isBatch: true,
    };
  }

  if (params.file_path === undefined || params.content === undefined) {
    return {
      error: {
        code: 'internal_error',
        reason:
          'No file to validate. Send one file as `file_path` + `content`, or several as ' +
          '`files`. Nothing was checked.',
      },
    };
  }

  return {
    buffers: [{ filePath: params.file_path, content: params.content }],
    isBatch: false,
  };
}

export { MAX_BATCH_BYTES, MAX_BATCH_FILES };
