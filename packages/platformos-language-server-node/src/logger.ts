import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const LOG_DIR = process.env.LSP_LOG_DIR || path.join(os.homedir(), '.pos-cli', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'language-server.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024;
const MAX_BACKUPS = 3;
const MAX_PARAM_LENGTH = 500;

let logReady = false;

function ensureLogDir(): void {
  if (logReady) return;
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    logReady = true;
  } catch {
    // Logging is best-effort — never interfere with LSP stdio
  }
}

function rotateLogIfNeeded(): void {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = `${LOG_FILE}.${timestamp}.bak`;
      fs.renameSync(LOG_FILE, backupFile);
      cleanOldBackups();
    }
  } catch {
    // File doesn't exist, no rotation needed
  }
}

function cleanOldBackups(): void {
  try {
    const backups = fs.readdirSync(path.dirname(LOG_FILE))
      .filter(f => f.startsWith(path.basename(LOG_FILE)) && f.endsWith('.bak'))
      .sort()
      .reverse();

    for (const old of backups.slice(MAX_BACKUPS)) {
      fs.unlinkSync(path.join(path.dirname(LOG_FILE), old));
    }
  } catch {
    // best-effort
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) + '...' : str;
}

export function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  ensureLogDir();
  if (logReady) {
    try {
      rotateLogIfNeeded();
      fs.appendFileSync(LOG_FILE, logLine);
    } catch {
      // best-effort
    }
  }

  if (process.env.LSP_DEBUG === 'true') {
    try { process.stderr.write(logLine); } catch {
      // best-effort
    }
  }
}

export function logRequest(method: string, params?: unknown): void {
  const paramStr = params ? ` ${truncate(JSON.stringify(params), MAX_PARAM_LENGTH)}` : '';
  log(`REQUEST: ${method}${paramStr}`);
}

export function logResponse(method: string, result?: unknown): void {
  const resultStr = result ? JSON.stringify(result) : 'undefined';
  log(`RESPONSE: ${method} ${truncate(resultStr, MAX_PARAM_LENGTH)}`);
}

export function logError(message: string, error?: unknown): void {
  const errorStr = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  log(`ERROR: ${message} ${errorStr}`);
}

export function logInfo(message: string): void {
  log(`INFO: ${message}`);
}

export function logDebug(message: string): void {
  if (process.env.LSP_DEBUG === 'true') {
    log(`DEBUG: ${message}`);
  }
}

export function resetLog(): void {
  logReady = false;
}

export function getLogFilePath(): string {
  return LOG_FILE;
}
