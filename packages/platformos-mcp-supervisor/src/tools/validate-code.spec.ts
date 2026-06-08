/**
 * Static surface + early-return smoke tests for `validate_code`.
 *
 * Full integration (real LSP, real project fixture) is covered by P22.
 * This file pins the input-validation early-return paths and the public
 * shape of the exported tool object, since those land before any pipeline
 * stage and are reachable with a no-op LSP stub.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateCodeTool, type ValidateCodeContext } from './validate-code';
import { FiltersIndex } from '../core/filters-index';
import { ObjectsIndex } from '../core/objects-index';
import { TagsIndex } from '../core/tags-index';
import type { PlatformOSLSPClient } from '../core/lsp-client';

function stubCtx(directory: string): ValidateCodeContext {
  const lsp = {
    initialized: false,
    awaitDiagnostics: async () => [],
    completions: async () => null,
    hover: async () => null,
  } as unknown as PlatformOSLSPClient;

  return {
    directory,
    lsp,
    awaitLsp: async () => {},
    filtersIndex: new FiltersIndex(),
    objectsIndex: new ObjectsIndex(),
    tagsIndex: new TagsIndex(),
  };
}

describe('validateCodeTool', () => {
  describe('static surface', () => {
    it('exports a name and a non-empty description', () => {
      expect(validateCodeTool.name).toBe('validate_code');
      expect(typeof validateCodeTool.description).toBe('string');
      expect(validateCodeTool.description.length).toBeGreaterThan(50);
    });

    it('description never mentions validate_intent or pending state (AC #6)', () => {
      const d = validateCodeTool.description;
      expect(d).not.toMatch(/validate_intent/);
      expect(d).not.toMatch(/pending_files|pending_pages|pending_translations/);
      expect(d).not.toMatch(/session\.pending|sessionPending/);
    });

    it('input schema exposes exactly file_path, content, and mode (AC #1)', () => {
      const keys = Object.keys(validateCodeTool.inputSchema).sort();
      expect(keys).toEqual(['content', 'file_path', 'mode']);
    });
  });

  describe('input validation (early returns)', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-vc-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('rejects empty content with InputError', async () => {
      const handler = validateCodeTool.createHandler(stubCtx(dir));
      const r = await handler({ file_path: 'app/views/pages/index.html.liquid', content: '' });
      expect(r.status).toBe('error');
      expect(r.must_fix_before_write).toBe(true);
      expect(r.errors[0]!.check).toBe('InputError');
      expect(r.errors[0]!.message).toMatch(/empty string/);
    });

    it('rejects content that looks like a file path', async () => {
      const handler = validateCodeTool.createHandler(stubCtx(dir));
      const r = await handler({
        file_path: 'app/views/pages/index.html.liquid',
        content: 'app/views/pages/index.html.liquid',
      });
      expect(r.status).toBe('error');
      expect(r.errors[0]!.message).toMatch(/looks like a file path/);
    });

    it('rejects content too short to be valid Liquid', async () => {
      const handler = validateCodeTool.createHandler(stubCtx(dir));
      const r = await handler({
        file_path: 'app/views/pages/index.html.liquid',
        content: 'hi',
      });
      expect(r.status).toBe('error');
      expect(r.errors[0]!.message).toMatch(/too short to be valid content/);
    });

    it('rejects a file path that escapes the project directory', async () => {
      const handler = validateCodeTool.createHandler(stubCtx(dir));
      const r = await handler({
        file_path: '../../etc/passwd',
        content: '<p>some content here</p>',
      });
      expect(r.status).toBe('error');
      expect(r.errors[0]!.check).toBe('InputError');
    });
  });

  describe('no-LSP path (mode: quick)', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'mcp-supervisor-vc-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('returns status: ok for a benign partial when LSP is offline', async () => {
      const handler = validateCodeTool.createHandler(stubCtx(dir));
      // Use a partial path — pages emit structural warnings for HTML / missing
      // slug, which is correct behavior but distracts from the LSP-offline
      // smoke check. A partial with a doc block is the cleanest happy path.
      const r = await handler({
        file_path: 'app/views/partials/example.liquid',
        content: '{% doc %}\n  Renders a static greeting.\n{% enddoc %}\nhello, world\n',
        mode: 'quick',
      });
      expect(r.must_fix_before_write).toBe(false);
      expect(r.infos.some((i) => i.check === 'lsp')).toBe(true);
      // status is `ok` when no errors AND no warnings, or `warning` when only
      // advisory warnings fire — we accept either as long as the write isn't
      // gated.
      expect(['ok', 'warning']).toContain(r.status);
    });

    it('skips fix generation, clustering, scorecard, domain guide in quick mode (AC #5)', async () => {
      const handler = validateCodeTool.createHandler(stubCtx(dir));
      const r = await handler({
        file_path: 'app/views/partials/example.liquid',
        content: '{% doc %}\n  Renders a static greeting.\n{% enddoc %}\nhello, world\n',
        mode: 'quick',
      });
      expect(r.proposed_fixes).toEqual([]);
      expect(r.clusters).toEqual([]);
      expect(r.scorecard).toEqual([]);
      expect(r.domain_guide).toBeNull();
      expect(r.tips).toEqual([]);
    });
  });
});
