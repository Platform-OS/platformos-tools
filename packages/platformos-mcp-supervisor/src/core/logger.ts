/**
 * Minimal stderr logger for the MCP supervisor.
 *
 * stdout is reserved exclusively for the MCP JSON-RPC stream — anything
 * written there bricks the transport. Every operational log line MUST go
 * to stderr.
 *
 * v1 trim: no file logging, no log levels beyond a single `info` tag, no
 * structured JSON output. Source ran a JSONL writer alongside stderr —
 * dropped per the migration scope (we keep stderr only).
 *
 * Format: `<ISO-timestamp> [info]<prefix>: <message>\n`. Prefix is
 * surfaced inside the bracketed tag rather than as a free-form column so
 * `grep '\[info\] supervisor:'` works.
 */

export type Logger = (msg: string) => void;

/**
 * Build a logger function. Bind a stable `prefix` to tag every line
 * emitted through the returned function (helpful when one process owns
 * multiple subsystems, e.g. `supervisor` vs `lsp`).
 */
export function createLogger(prefix?: string): Logger {
  const tag = prefix && prefix.length > 0 ? ` ${prefix}:` : '';
  return (msg: string) => {
    process.stderr.write(`${new Date().toISOString()} [info]${tag} ${msg}\n`);
  };
}
