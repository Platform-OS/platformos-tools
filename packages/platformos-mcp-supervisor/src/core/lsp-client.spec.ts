/**
 * Unit pins for the URI canonicaliser used at every LSP boundary
 * (`awaitDiagnostics`, `syncDoc`, `completions`, `hover`,
 * `handlePublishDiagnostics`, `initialize`).
 *
 * The full bridge (PassThrough + protocol connection + a live language
 * server) is exercised end-to-end by `test/upstream/lsp-diagnostic-contract.spec.ts`
 * (P23) and `test/parity/validate-code-parity.spec.ts` (P24). This spec
 * pins the cheap-but-load-bearing properties of `canonicalUri` itself —
 * idempotency, mixed-case-drive-letter handling, and unparseable-input
 * tolerance — so a regression on the helper surfaces here instead of
 * hiding behind a 5 s LSP timeout.
 */

import { describe, it, expect } from 'vitest';
import { _canonicalUri } from './lsp-client';

describe('canonicalUri', () => {
  it('is idempotent on already-canonical URIs', () => {
    const u = 'file:///home/user/project/app/views/pages/index.html.liquid';
    expect(_canonicalUri(u)).toBe(u);
    expect(_canonicalUri(_canonicalUri(u))).toBe(u);
  });

  it('lowercases the Windows drive letter (the Windows-CI regression)', () => {
    // The whole reason this helper exists: pathToFileURL produces an
    // upper-case drive letter; the in-process LSP canonicalises to
    // lower-case. Without round-tripping, client + server Map keys
    // disagree on Windows and diagnostics never arrive.
    expect(_canonicalUri('file:///D:/a/project/app/views/pages/x.liquid')).toBe(
      'file:///d:/a/project/app/views/pages/x.liquid',
    );
    expect(_canonicalUri('file:///C:/Users/dev/project/app/x.liquid')).toBe(
      'file:///c:/Users/dev/project/app/x.liquid',
    );
  });

  it('replaces backslashes with forward slashes', () => {
    // `URI.toString(true)` already produces `/`, but the helper guards
    // against any post-parse byte that slipped through.
    expect(_canonicalUri('file:///d:/a\\project\\x.liquid')).toMatch(/^file:\/\/\/d:\/a/);
    expect(_canonicalUri('file:///d:/a\\project\\x.liquid')).not.toContain('\\');
  });

  it('preserves percent-decoded path segments where safe', () => {
    // `toString(true)` (the "skipEncoding" flag) leaves printable chars alone.
    // A path containing a space round-trips without %20 noise.
    const u = 'file:///home/user/project/a b/c.liquid';
    expect(_canonicalUri(u)).toBe(u);
  });

  it('short-circuits on empty input without calling URI.parse', () => {
    // `URI.parse('')` would coerce to `file:///` — the early-exit guard
    // preserves the empty input so callers can detect the bad-input case
    // unambiguously.
    expect(_canonicalUri('')).toBe('');
  });

  it('tolerates non-URI strings by passing them through `URI.parse` (best-effort)', () => {
    // `vscode-uri`'s `URI.parse` is forgiving — it accepts schemeless
    // strings and coerces to `file:///...`. The canonicaliser does NOT
    // throw on such input; downstream code uses the result as a Map key
    // and a missing match just times out cleanly.
    expect(_canonicalUri('not-a-uri')).toBe('file:///not-a-uri');
  });

  it('is a no-op on POSIX-style file URIs (Linux parity)', () => {
    // Pins that the Linux parity baselines stay byte-identical — the
    // P24 captured snapshots were recorded against pre-canonicaliser
    // output, so this is the contract that keeps them valid.
    const u = 'file:///tmp/mcp-supervisor-test/project/app/views/partials/x.liquid';
    expect(_canonicalUri(u)).toBe(u);
  });
});
