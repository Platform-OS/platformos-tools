/**
 * End to end: a real buffer through the real engine, then through the real write gate.
 *
 * `blocking.spec.ts` asserts the gate's membership logic over synthetic diagnostics. This
 * asserts the thing an agent actually experiences — that these buffers produce diagnostics
 * whose codes and severities let the write through, and that the dangerous spellings still
 * do not. Both halves are here so demoting one can never silently demote the other.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runBatchLint } from '../lint/lint-batch.js';
import { blocksWrite } from './blocking.js';

let projectDir: string;

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-tolerated-'));
  mkdirSync(join(projectDir, '.git'));
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const FILE = 'app/views/partials/probe.liquid';

async function gate(source: string) {
  const { diagnostics } = await runBatchLint({
    projectDir,
    buffers: [{ filePath: FILE, content: source }],
  });
  const found = diagnostics.get(FILE) ?? [];
  return {
    codes: [...new Set(found.map((d) => d.check))].sort(),
    severities: Object.fromEntries(found.map((d) => [d.check, d.severity])),
    blocks: blocksWrite(found.filter((d) => d.severity === 'error')),
  };
}

/** Measured on a live instance to produce the author's intended result. */
const TOLERATED = [
  { what: 'capture with a quoted target', source: `{% capture 'cs' %}HI{% endcapture %}` },
  { what: 'case with a trailing colon', source: `{% case g: %}{% when 1 %}ONE{% endcase %}` },
  {
    what: 'parse_json with a stray percent',
    source: `{% parse_json d %%}{"k":2}{% endparse_json %}`,
  },
  {
    // The construct from a real application layout. Measured: the platform sets
    // `Content-Security-Policy: frame-ancestors 'none'` correctly.
    what: 'response_headers with nested quotes that leave valid JSON',
    source: `{% response_headers '{ "Content-Security-Policy" : "frame-ancestors 'none'" }' %}`,
  },
];

/** Measured to raise, or to run while doing something other than what was written. */
const BLOCKED = [
  { what: 'cache with a leading colon', source: `{% cache: k, expire: 30 %}B{% endcache %}` },
  { what: 'cache with the key omitted', source: `{% cache expire: 30 %}B{% endcache %}` },
  { what: 'log with a leading colon', source: `{% log: o, type: 'E' %}` },
  { what: 'capture with empty markup', source: `{% capture %}x{% endcapture %}` },
  {
    // Measured HTTP 501: the run stops at the unescaped quote, so the tag gets truncated JSON.
    what: 'response_headers whose argument truncates to invalid JSON',
    source: `{% response_headers '{"X-Ae": "va'lue"}' %}`,
  },
];

describe('The write gate lets tolerated tag syntax through', () => {
  it.each(TOLERATED)('$what', async ({ source }) => {
    const { codes, severities, blocks } = await gate(source);
    expect(codes).toContain('UnconventionalTagSyntax');
    expect(severities.UnconventionalTagSyntax).toBe('warning');
    expect(codes).not.toContain('LiquidHTMLSyntaxError');
    expect(blocks).toBe(false);
  });
});

describe('and still refuses the spellings that misbehave', () => {
  it.each(BLOCKED)('$what', async ({ source }) => {
    const { codes, severities, blocks } = await gate(source);
    expect(codes).toContain('LiquidHTMLSyntaxError');
    expect(severities.LiquidHTMLSyntaxError).toBe('error');
    expect(codes).not.toContain('UnconventionalTagSyntax');
    expect(blocks).toBe(true);
  });
});

describe('and says nothing about the well-formed spellings', () => {
  it.each([
    { what: 'capture', source: `{% capture cs %}HI{% endcapture %}` },
    { what: 'case', source: `{% case g %}{% when 1 %}ONE{% endcase %}` },
    { what: 'parse_json', source: `{% parse_json d %}{"k":2}{% endparse_json %}` },
    { what: 'cache', source: `{% cache 'k', expire: 30 %}B{% endcache %}` },
  ])('$what', async ({ source }) => {
    const { codes, blocks } = await gate(source);
    expect(codes).not.toContain('UnconventionalTagSyntax');
    expect(codes).not.toContain('LiquidHTMLSyntaxError');
    expect(blocks).toBe(false);
  });
});
