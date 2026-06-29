/**
 * stderr-only logger.
 *
 * stdout is reserved for the MCP JSON-RPC stream — anything written there
 * corrupts the transport. Every operational log line therefore goes to stderr.
 */
export type Logger = (message: string) => void;

export function createLogger(prefix?: string): Logger {
  const tag = prefix ? ` ${prefix}` : '';
  return (message: string) => {
    process.stderr.write(`${new Date().toISOString()} [info]${tag}: ${message}\n`);
  };
}
