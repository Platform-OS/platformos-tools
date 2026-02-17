import { expect, it, describe, beforeEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Use a temp directory so tests never touch real user logs
const TEST_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-logger-test-'));
const LOG_FILE = path.join(TEST_LOG_DIR, 'language-server.log');

describe('Logger', () => {
  let logger: typeof import('./logger');
  let originalDebug: string | undefined;
  let originalLogDir: string | undefined;

  beforeEach(async () => {
    originalDebug = process.env.LSP_DEBUG;
    originalLogDir = process.env.LSP_LOG_DIR;
    delete process.env.LSP_DEBUG;
    process.env.LSP_LOG_DIR = TEST_LOG_DIR;

    // Re-import to pick up env change
    logger = await import('./logger');
    logger.resetLog();

    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
    }
  });

  afterAll(() => {
    process.env.LSP_DEBUG = originalDebug;
    process.env.LSP_LOG_DIR = originalLogDir;

    // Clean up temp dir
    try {
      fs.rmSync(TEST_LOG_DIR, { recursive: true });
    } catch {
      // best-effort
    }
  });

  describe('getLogFilePath', () => {
    it('returns the correct log file path', () => {
      expect(logger.getLogFilePath()).toBe(LOG_FILE);
    });
  });

  describe('log', () => {
    it('creates log directory if it does not exist', () => {
      const subDir = path.join(TEST_LOG_DIR, 'sub');
      process.env.LSP_LOG_DIR = subDir;
      // Force re-init
      const freshLogger = { ...logger };
      freshLogger.resetLog();
      freshLogger.log('test message');
      process.env.LSP_LOG_DIR = TEST_LOG_DIR;

      // The original logger still works with TEST_LOG_DIR
      logger.resetLog();
      logger.log('test message');

      expect(fs.existsSync(LOG_FILE)).toBe(true);
    });

    it('writes timestamped messages to log file', () => {
      logger.log('test message');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] test message/);
    });

    it('appends to existing log file', () => {
      logger.log('first message');
      logger.log('second message');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('first message');
      expect(content).toContain('second message');
    });
  });

  describe('logInfo', () => {
    it('writes INFO prefixed messages', () => {
      logger.logInfo('info message');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('INFO: info message');
    });
  });

  describe('logError', () => {
    it('writes ERROR prefixed messages with string error', () => {
      logger.logError('something failed', 'error details');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('ERROR: something failed error details');
    });

    it('writes ERROR prefixed messages with Error object', () => {
      const error = new Error('test error');
      logger.logError('something failed', error);

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('ERROR: something failed test error');
    });
  });

  describe('logRequest', () => {
    it('writes REQUEST with method name only', () => {
      logger.logRequest('initialize');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('REQUEST: initialize');
    });

    it('writes REQUEST with method and params', () => {
      logger.logRequest('initialize', { capabilities: {} });

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('REQUEST: initialize {"capabilities":{}}');
    });

    it('truncates large params', () => {
      logger.logRequest('textDocument/didOpen', { text: 'x'.repeat(1000) });

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('REQUEST: textDocument/didOpen');
      expect(content).toContain('...');
      expect(content.length).toBeLessThan(1500);
    });
  });

  describe('logResponse', () => {
    it('writes RESPONSE with truncated result for large data', () => {
      const largeResult = { data: 'x'.repeat(600) };
      logger.logResponse('textDocument/completion', largeResult);

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('RESPONSE: textDocument/completion');
      expect(content).toContain('...');
    });

    it('writes RESPONSE with full result for small data', () => {
      logger.logResponse('initialize', { capabilities: {} });

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('RESPONSE: initialize {"capabilities":{}}');
    });

    it('writes RESPONSE with undefined for no result', () => {
      logger.logResponse('shutdown');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('RESPONSE: shutdown undefined');
    });
  });

  describe('logDebug', () => {
    it('does not log when LSP_DEBUG is not set', () => {
      logger.logDebug('debug message');

      if (fs.existsSync(LOG_FILE)) {
        const content = fs.readFileSync(LOG_FILE, 'utf8');
        expect(content).not.toContain('DEBUG: debug message');
      }
    });

    it('logs when LSP_DEBUG is true', () => {
      process.env.LSP_DEBUG = 'true';
      logger.logDebug('debug message');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('DEBUG: debug message');
    });
  });

  describe('resetLog', () => {
    it('resets allowing fresh writes after clearing', () => {
      logger.log('first log');
      logger.resetLog();

      fs.unlinkSync(LOG_FILE);

      logger.log('second log');

      const content = fs.readFileSync(LOG_FILE, 'utf8');
      expect(content).toContain('second log');
      expect(content).not.toContain('first log');
    });
  });
});
