/**
 * Structured error for MCP tool handlers.
 *
 * Throw this from a tool handler instead of returning `{ error: '...' }` so
 * the MCP transport layer can map it to the protocol's `isError: true`
 * response shape with a consistent message.
 */

/**
 * Tool error status code. Modeled on HTTP semantics:
 *   - 400 input validation (bad params from the caller)
 *   - 404 resource not found (file, tool, index)
 *   - 503 dependency unavailable (LSP not ready)
 */
export type ToolErrorStatus = 400 | 404 | 503;

export interface ToolErrorOptions {
  status?: ToolErrorStatus;
}

export class ToolError extends Error {
  readonly status: ToolErrorStatus;

  constructor(message: string, { status = 400 }: ToolErrorOptions = {}) {
    super(message);
    this.name = 'ToolError';
    this.status = status;
  }
}
