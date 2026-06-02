/**
 * Regression pins for the asset-index the diagnostic pipeline uses to
 * cross-check `MissingAsset` against the real filesystem.
 *
 * Prior bug: agents saw `MissingAsset` for paths that existed on disk (LSP's
 * asset cache lagging) AND for paths where the basename existed but the
 * directory prefix was wrong (`{{ 'logo.png' | asset_url }}` when the file
 * lives at `images/logo.png`). The index + resolver together:
 *   - confirm existence at the exact nested path (suppresses stale diagnostics)
 *   - detect a same-basename file under a different nested path (enables a
 *     concrete "use this path instead" hint)
 *   - stay silent when nothing matches so real missing assets still surface
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAssetIndex,
  normalizeAssetPath,
  resolveAssetPath,
  type AssetIndex,
} from './asset-index';

describe('asset-index', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'asset-index-'));
    const assetsRoot = join(tmpDir, 'app/assets');
    mkdirSync(join(assetsRoot, 'styles'), { recursive: true });
    mkdirSync(join(assetsRoot, 'scripts'), { recursive: true });
    mkdirSync(join(assetsRoot, 'images/icons'), { recursive: true });
    mkdirSync(join(assetsRoot, 'vendor'), { recursive: true });

    writeFileSync(join(assetsRoot, 'styles/app.css'), '/* app */', 'utf8');
    writeFileSync(join(assetsRoot, 'styles/design-tokens.css'), ':root {}', 'utf8');
    writeFileSync(join(assetsRoot, 'scripts/app.js'), '// app', 'utf8');
    writeFileSync(join(assetsRoot, 'images/logo.png'), 'PNG', 'utf8');
    writeFileSync(join(assetsRoot, 'images/icons/check.svg'), '<svg/>', 'utf8');
    // Same basename as images/logo.png — deliberate to exercise ambiguity.
    writeFileSync(join(assetsRoot, 'vendor/logo.png'), 'PNG', 'utf8');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('buildAssetIndex', () => {
    it('indexes every file recursively under app/assets/ with forward-slash paths', () => {
      const idx = buildAssetIndex(tmpDir);
      expect(idx.paths.has('styles/app.css')).toBe(true);
      expect(idx.paths.has('styles/design-tokens.css')).toBe(true);
      expect(idx.paths.has('scripts/app.js')).toBe(true);
      expect(idx.paths.has('images/logo.png')).toBe(true);
      expect(idx.paths.has('images/icons/check.svg')).toBe(true);
      expect(idx.paths.has('vendor/logo.png')).toBe(true);
    });

    it('groups files by basename so same-name files at different paths can be disambiguated', () => {
      const idx = buildAssetIndex(tmpDir);
      expect(idx.basenames.get('logo.png')).toEqual(
        expect.arrayContaining(['images/logo.png', 'vendor/logo.png']),
      );
      expect(idx.basenames.get('app.css')).toEqual(['styles/app.css']);
    });

    it('returns an empty index when projectDir is missing or has no app/assets/', () => {
      // Exercise the documented null-handling branch via a cast; the public
      // signature is `string`, the implementation defensively short-circuits.
      const empty = buildAssetIndex(null as unknown as string);
      expect(empty.paths.size).toBe(0);
      const empty2 = buildAssetIndex('/nonexistent/path-that-really-does-not-exist');
      expect(empty2.paths.size).toBe(0);
    });
  });

  describe('normalizeAssetPath', () => {
    it('strips leading slashes and the assets/ or app/assets/ prefix', () => {
      expect(normalizeAssetPath('/styles/app.css')).toBe('styles/app.css');
      expect(normalizeAssetPath('assets/styles/app.css')).toBe('styles/app.css');
      expect(normalizeAssetPath('/assets/styles/app.css')).toBe('styles/app.css');
      expect(normalizeAssetPath('app/assets/styles/app.css')).toBe('styles/app.css');
    });

    it('leaves already-normalised paths untouched', () => {
      expect(normalizeAssetPath('styles/app.css')).toBe('styles/app.css');
    });

    it('returns null for empty / non-string input', () => {
      expect(normalizeAssetPath('')).toBe(null);
      expect(normalizeAssetPath(null)).toBe(null);
      expect(normalizeAssetPath(undefined)).toBe(null);
    });
  });

  describe('resolveAssetPath', () => {
    let index: AssetIndex;
    beforeAll(() => {
      index = buildAssetIndex(tmpDir);
    });

    it('returns exists when the exact nested path is on disk', () => {
      expect(resolveAssetPath('styles/app.css', index)).toEqual({ status: 'exists' });
      expect(resolveAssetPath('images/icons/check.svg', index)).toEqual({ status: 'exists' });
    });

    it('normalises agent-submitted forms before looking up', () => {
      expect(resolveAssetPath('/styles/app.css', index)).toEqual({ status: 'exists' });
      expect(resolveAssetPath('assets/styles/app.css', index)).toEqual({ status: 'exists' });
      expect(resolveAssetPath('app/assets/styles/app.css', index)).toEqual({ status: 'exists' });
    });

    it('reports renamed when basename is unique and path prefix is wrong', () => {
      // "design-tokens.css" exists only at styles/ — the agent forgot the subdir
      expect(resolveAssetPath('design-tokens.css', index)).toEqual({
        status: 'renamed',
        suggestion: 'styles/design-tokens.css',
      });
    });

    it('reports ambiguous when basename matches multiple nested paths', () => {
      // "logo.png" exists at both images/ and vendor/
      const r = resolveAssetPath('logo.png', index);
      expect(r.status).toBe('ambiguous');
      if (r.status === 'ambiguous') {
        expect(r.suggestions).toEqual(expect.arrayContaining(['images/logo.png', 'vendor/logo.png']));
      }
    });

    it('reports missing when nothing matches — real MissingAsset', () => {
      expect(resolveAssetPath('styles/does-not-exist.css', index)).toEqual({ status: 'missing' });
      expect(resolveAssetPath('nonexistent.js', index)).toEqual({ status: 'missing' });
    });
  });
});
