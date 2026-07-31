/**
 * Registration of the `validate_code` MCP tool — the supervisor's entire surface.
 *
 * ONE TOOL, TWO INPUT SHAPES. Validating one file and validating a coordinated
 * multi-file change are the same operation on a different number of buffers, so
 * they are one tool. A second tool would force the agent to choose, and there is no
 * name for the pair that makes the choice obvious — `validate_code` vs
 * `validate_files` certainly did not.
 *
 *   validate_code({ file_path, content })   -> a single result
 *   validate_code({ files: [...] })         -> one result per file + a batch gate
 *
 * The single form is unchanged from the original contract, so nothing that already
 * calls it needs to know any of this. There is no `many` flag: which form was sent
 * is evident from the arguments, and a parameter whose value the tool can already
 * infer is the same empty promise `mode: full|quick` was.
 *
 * PASSING SEVERAL FILES IS MORE ACCURATE, not just faster. With every buffer
 * overlaid at once a partial created alongside its caller resolves; checked one file
 * at a time it is reported missing. The description says so, because that is the
 * reason an agent should reach for the batch form.
 *
 * This module owns only the MCP surface: schema, description, registration, and
 * mapping input shape to output shape. All logic lives in `validate/`.
 */
import { z, type ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
import { assembleNotApplicableResult } from '../result/assemble.js';

/** A non-blank path. Blank is malformed input, refused at the protocol boundary. */
const filePath = z
  .string()
  .refine((value) => value.trim().length > 0, { message: 'file_path must not be empty' });

const content = z.string();

/**
 * zod raw shape for the tool input (validated by the MCP SDK before dispatch).
 *
 * Both forms are optional at the schema level and the handler requires exactly one,
 * because a zod union of two object shapes defeats the SDK's JSON-Schema conversion
 * — it emits `anyOf`, which several MCP clients do not surface to the model at all.
 * Two optional fields with a documented rule converts cleanly and reads clearly.
 *
 * Typed as `ZodRawShape` (not the inferred literal shape) so `registerTool` does not
 * instantiate excessively deeply over the schema (TS2589 under zod 3.25).
 */
export const VALIDATE_CODE_INPUT: ZodRawShape = {
  file_path: filePath
    .optional()
    .describe(
      'Path of the file to validate, absolute or relative to the project root ' +
        '(e.g. "app/views/partials/card.liquid"). Pair with `content`.',
    ),
  content: content
    .optional()
    .describe('The exact file contents you are about to write. Pair with `file_path`.'),
  files: z
    .array(z.object({ file_path: filePath, content }))
    .min(1)
    .max(MAX_BATCH_FILES)
    .optional()
    .describe(
      'Two or more files to validate together, each with its own `file_path` and ' +
        '`content`. Files in one call can reference each other.',
    ),
};

const DESCRIPTION = `Validate platformOS Liquid and GraphQL code BEFORE writing it to disk.

Pass EITHER one file OR several — never both.

  One file:
    { "file_path": "app/views/partials/card.liquid",
      "content": "<div>{{ title }}</div>" }

  Several files (use this whenever one change touches more than one file):
    { "files": [
        { "file_path": "app/views/pages/home.liquid",
          "content": "{% render 'promo' %}" },
        { "file_path": "app/views/partials/promo.liquid",
          "content": "<div>Promo</div>" }
      ] }

Sending several together is faster AND more accurate: they can reference each
other, so the new partial above resolves. Validated one at a time, the page would
be reported as rendering a missing partial.

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
that is neither approval nor refusal.`;

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

  // A batch is a new way to hand the server unbounded work, so it carries its own
  // caps on top of the per-buffer size bound.
  const overBounds = isBatch ? batchTooLarge(buffers) : undefined;
  if (overBounds) {
    ctx.log(`validate_code: refused (${overBounds.code}) — ${overBounds.reason}`);
    return {
      must_fix_before_write: false,
      files: buffers.map((buffer) => ({
        file_path: buffer.filePath,
        result: assembleNotApplicableResult(overBounds),
      })),
      next_step: overBounds.reason,
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
 * The SDK validates types; what it cannot express here is "exactly one form". Both
 * failures are the caller's malformed request rather than a property of any file, so
 * they are reported as such instead of being guessed at — silently preferring one
 * form would validate something the caller did not ask about.
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
