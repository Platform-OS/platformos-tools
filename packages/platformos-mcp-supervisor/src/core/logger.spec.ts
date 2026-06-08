import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes a single line to stderr with timestamp + [info] tag', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const log = createLogger();
    log('hello');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(writes[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[info\] hello\n$/);
  });

  it('includes the prefix inside the bracketed tag when provided', () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const log = createLogger('supervisor');
    log('boot');

    expect(writes[0]).toMatch(/ \[info\] supervisor: boot\n$/);
  });

  it('emits exactly one line per call', () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const log = createLogger('s');
    log('one');
    log('two');

    expect(writes).toHaveLength(2);
    expect(writes.every((w) => w.endsWith('\n'))).toBe(true);
    expect(writes.every((w) => w.split('\n').filter(Boolean).length === 1)).toBe(true);
  });
});
