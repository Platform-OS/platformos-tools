/**
 * Diagnostic pipeline behaviour pins.
 *
 * Source carried suppress-by-pending / buildPendingPartialNames /
 * buildPendingPageKeys describe blocks. v1 drops all pending-state
 * suppression (P18 strip), so those sections are gone. What survives
 * here is the disk-verification + late-stamp + LSP-known-FP coverage
 * the pipeline still owns in v1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runDiagnosticPipeline,
  stampDefaultsOn,
  type PipelineDiagnostic,
  type PipelineResult,
} from './diagnostic-pipeline';

function makeResult(
  errors: PipelineDiagnostic[] = [],
  warnings: PipelineDiagnostic[] = [],
  infos: PipelineDiagnostic[] = [],
): PipelineResult {
  return { errors: [...errors], warnings: [...warnings], infos: [...infos] };
}

function metadataError(line: number, message = 'Required parameter autohide must be passed'): PipelineDiagnostic {
  return { check: 'MetadataParamsCheck', severity: 'error', line, message };
}

function metadataWarn(line: number, message = 'Required parameter delay must be passed'): PipelineDiagnostic {
  return { check: 'MetadataParamsCheck', severity: 'warning', line, message };
}

// ── suppressUndocumentedTargetParams (was suppressModuleTargetParams in source) ──

describe('diagnostic-pipeline: suppressUndocumentedTargetParams', () => {
  it('suppresses MetadataParamsCheck errors on lines calling modules/ partials', () => {
    const content = [
      '{% doc %}{% enddoc %}',
      '',
      "{% theme_render_rc 'modules/common-styling/toasts' %}",
    ].join('\n');

    const result = makeResult([metadataError(3)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content,
    });

    expect(result.errors).toHaveLength(0);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:ModuleParamsSuppressed')).toBe(true);
  });

  it('suppresses MetadataParamsCheck warnings on module/ lines', () => {
    const content = [
      '{% liquid %}',
      "  function _ = 'modules/user/helpers/can_do_or_unauthorized', requester: context.current_user",
      '{% endliquid %}',
    ].join('\n');

    const result = makeResult([], [metadataWarn(2)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/items/new.html.liquid',
      content,
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:ModuleParamsSuppressed')).toBe(true);
  });

  it('does NOT suppress MetadataParamsCheck errors on non-module lines', () => {
    const content = [
      '{% liquid %}',
      "  function items = 'queries/items/search', page: context.params.page",
      '{% endliquid %}',
    ].join('\n');

    const result = makeResult([
      metadataError(2, 'Required parameter limit must be passed to function call'),
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/items/index.html.liquid',
      content,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.check).toBe('MetadataParamsCheck');
  });

  it('does NOT suppress non-MetadataParamsCheck errors on module lines', () => {
    const content = "{% render 'modules/common-styling/init', reset: true %}";

    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', line: 1, message: 'partial does not exist' },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.check).toBe('MissingPartial');
  });

  it('reports suppression count in info message', () => {
    const content = [
      "{% theme_render_rc 'modules/common-styling/toasts' %}",
      "{% render 'modules/common-styling/init' %}",
    ].join('\n');

    const result = makeResult([metadataError(1), metadataError(2)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content,
    });

    expect(result.errors).toHaveLength(0);
    const info = result.infos.find((i) => i.check === 'pos-supervisor:ModuleParamsSuppressed');
    expect(info?.message).toContain('2');
  });
});

// ── verifyMissingPartialsOnDisk: `lib/` prefix handling ──

describe('diagnostic-pipeline: verifyMissingPartialsOnDisk does not strip `lib/` prefix', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-libpref-'));
    mkdirSync(join(tmpDir, 'app/lib/commands/contacts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/lib/commands/contacts/create.liquid'),
      '{% doc %}{% enddoc %}',
      'utf8',
    );
    mkdirSync(join(tmpDir, 'app/views/partials/cards'), { recursive: true });
    writeFileSync(join(tmpDir, 'app/views/partials/cards/product.liquid'), '<div></div>', 'utf8');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('suppresses MissingPartial for the bare `commands/X` form when X.liquid is on disk (LSP cache lag)', () => {
    const result = makeResult([
      {
        check: 'MissingPartial',
        severity: 'error',
        message: "'commands/contacts/create' does not exist",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/contacts/new.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(true);
  });

  it('does NOT suppress MissingPartial for the `lib/commands/X` form — the `lib/` prefix expands to `app/lib/lib/...`', () => {
    const result = makeResult([
      {
        check: 'MissingPartial',
        severity: 'error',
        message: "'lib/commands/contacts/create' does not exist",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/contacts/new.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('lib/commands/contacts/create');
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(false);
  });

  it('does NOT suppress MissingPartial for the `lib/queries/X` form even when the bare-form file exists on disk', () => {
    mkdirSync(join(tmpDir, 'app/lib/queries/products'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/lib/queries/products/find.liquid'),
      '{% doc %}{% enddoc %}',
      'utf8',
    );
    const result = makeResult([
      {
        check: 'MissingPartial',
        severity: 'error',
        message: "'lib/queries/products/find' does not exist",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/products/show.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(false);
  });

  it('still suppresses real partial cache-lag misses (non-`lib/` paths)', () => {
    const result = makeResult([
      { check: 'MissingPartial', severity: 'error', message: "'cards/product' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/index.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPartialSuppressed')).toBe(true);
  });
});

// ── verifyMissingAssets ──

describe('diagnostic-pipeline: verifyMissingAssets via runDiagnosticPipeline', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-assets-'));
    const assets = join(tmpDir, 'app/assets');
    mkdirSync(join(assets, 'styles'), { recursive: true });
    mkdirSync(join(assets, 'images'), { recursive: true });
    mkdirSync(join(assets, 'vendor'), { recursive: true });
    writeFileSync(join(assets, 'styles/app.css'), '/**/', 'utf8');
    writeFileSync(join(assets, 'styles/design-tokens.css'), ':root{}', 'utf8');
    writeFileSync(join(assets, 'images/logo.png'), 'PNG', 'utf8');
    writeFileSync(join(assets, 'vendor/logo.png'), 'PNG', 'utf8');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('suppresses MissingAsset for a path that exists on disk (LSP cache lag)', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'styles/app.css' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingAssetSuppressed')).toBe(true);
  });

  it('normalises agent-submitted leading-slash and assets/ prefix variants before checking', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'/styles/app.css' does not exist" },
      {
        check: 'MissingAsset',
        severity: 'error',
        message: "'assets/styles/app.css' does not exist",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
  });

  it('emits MissingAssetPathHint when the file exists at a different nested path (basename unique)', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'design-tokens.css' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
    const hint = result.infos.find((i) => i.check === 'pos-supervisor:MissingAssetPathHint');
    expect(hint).toBeDefined();
    expect(hint?.suggestion).toBe('styles/design-tokens.css');
    expect(hint?.message).toContain("'styles/design-tokens.css'");
  });

  it('does NOT suppress when the basename is ambiguous (multiple matches) — agent picks', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'logo.png' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/header.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.hint).toContain('Basename matches multiple assets');
    expect(result.errors[0]!.hint).toContain('images/logo.png');
    expect(result.errors[0]!.hint).toContain('vendor/logo.png');
  });

  it('leaves MissingAsset unchanged when the file truly does not exist anywhere under app/assets/', () => {
    const result = makeResult([
      {
        check: 'MissingAsset',
        severity: 'error',
        message: "'styles/does-not-exist.css' does not exist",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingAssetSuppressed')).toBe(false);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingAssetPathHint')).toBe(false);
  });

  it('skips filesystem checks entirely when projectDir is not provided', () => {
    const result = makeResult([
      { check: 'MissingAsset', severity: 'error', message: "'styles/app.css' does not exist" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/layouts/application.liquid',
      content: '',
    });
    expect(result.errors).toHaveLength(1);
  });
});

// ── verifyTranslationKeysOnDisk ──

describe('diagnostic-pipeline: verifyTranslationKeysOnDisk via runDiagnosticPipeline', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-translations-'));
    mkdirSync(join(tmpDir, 'app/translations'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/translations/en.yml'),
      'en:\n  app:\n    dashboard:\n      recent_notes: Recent Notes\n      title: Dashboard\n',
      'utf8',
    );
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('suppresses TranslationKeyExists for a key already on disk', () => {
    const result = makeResult([
      {
        check: 'TranslationKeyExists',
        severity: 'error',
        message: "Translation key 'app.dashboard.recent_notes' not found.",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/dashboard.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
    expect(
      result.infos.some((i) => i.check === 'pos-supervisor:TranslationKeyExistsSuppressed'),
    ).toBe(true);
  });

  it('leaves TranslationKeyExists in place when the key is genuinely missing from every locale file', () => {
    const result = makeResult([
      {
        check: 'TranslationKeyExists',
        severity: 'error',
        message: "Translation key 'app.unknown.key' not found.",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/dashboard.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(1);
    expect(
      result.infos.some((i) => i.check === 'pos-supervisor:TranslationKeyExistsSuppressed'),
    ).toBe(false);
  });

  it('skips the disk check when projectDir is not provided', () => {
    const result = makeResult([
      {
        check: 'TranslationKeyExists',
        severity: 'error',
        message: "Translation key 'app.dashboard.recent_notes' not found.",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/dashboard.html.liquid',
      content: '',
    });
    expect(result.errors).toHaveLength(1);
  });
});

// ── verifyPageRoutesOnDisk ──

describe('diagnostic-pipeline: verifyPageRoutesOnDisk via runDiagnosticPipeline', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-pages-'));
    const pages = join(tmpDir, 'app/views/pages');
    mkdirSync(join(pages, 'notes'), { recursive: true });
    mkdirSync(join(pages, 'blog_posts'), { recursive: true });
    writeFileSync(join(pages, 'index.liquid'), '<p>Home</p>\n', 'utf8');
    writeFileSync(join(pages, 'dashboard.liquid'), '<p>Dash</p>\n', 'utf8');
    writeFileSync(join(pages, 'notes/index.html.liquid'), '<p>Notes</p>\n', 'utf8');
    writeFileSync(
      join(pages, 'blog_posts/create.liquid'),
      '---\nslug: blog_posts/create\nmethod: post\n---\n<p>Create</p>\n',
      'utf8',
    );
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suppresses MissingPage for the agent's reported case (links to /, /notes, /dashboard)", () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/' (GET)" },
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/notes' (GET)" },
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/dashboard' (GET)" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/header.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
    const info = result.infos.find((i) => i.check === 'pos-supervisor:MissingPageSuppressed');
    expect(info).toBeDefined();
    expect(info?.message).toContain('/ (GET)');
    expect(info?.message).toContain('notes (GET)');
    expect(info?.message).toContain('dashboard (GET)');
  });

  it('handles the bare "Page \'X\' not found" message shape (defaults to GET)', () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "Page 'notes' not found" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/sidebar.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(true);
  });

  it('keeps the diagnostic but enriches .hint with served methods on a wrong-method hit', () => {
    const diag: PipelineDiagnostic = {
      check: 'MissingPage',
      severity: 'error',
      message: "No page found for route '/blog_posts/create' (GET)",
    };
    const result = makeResult([diag]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/links.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(1);
    expect(diag.hint).toBeDefined();
    expect(diag.hint).toContain('POST');
    expect(diag.hint).toContain('GET');
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(false);
  });

  it('leaves MissingPage in place when the route is genuinely not served by any page file', () => {
    const result = makeResult([
      {
        check: 'MissingPage',
        severity: 'error',
        message: "No page found for route '/never-served' (GET)",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/header.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(1);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(false);
  });

  it('skips the disk check when projectDir is not provided', () => {
    const result = makeResult([
      { check: 'MissingPage', severity: 'error', message: "No page found for route '/notes' (GET)" },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/header.liquid',
      content: '',
    });
    expect(result.errors).toHaveLength(1);
  });
});

// ── verifyOrphanedPartialOnDisk ──

describe('verifyOrphanedPartialOnDisk via runDiagnosticPipeline', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orphan-verify-'));
    const pages = join(tmpDir, 'app/views/pages/notes');
    const partials = join(tmpDir, 'app/views/partials/notes');
    mkdirSync(pages, { recursive: true });
    mkdirSync(partials, { recursive: true });

    writeFileSync(
      join(pages, 'show.html.liquid'),
      "---\nslug: notes/show\n---\n{% render 'notes/show', object: note %}\n",
      'utf8',
    );

    writeFileSync(
      join(partials, 'show.liquid'),
      '{% doc %}\n  @param object {object}\n{% enddoc %}\n<p>{{ object.title }}</p>\n',
      'utf8',
    );

    writeFileSync(join(partials, 'orphan.liquid'), '<p>truly orphaned</p>\n', 'utf8');
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('suppresses OrphanedPartial when a page on disk renders the partial', () => {
    const result = makeResult(
      [],
      [
        {
          check: 'OrphanedPartial',
          severity: 'warning',
          message: "Partial 'notes/show' is never rendered",
        },
      ],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/notes/show.liquid',
      content: '<p>{{ object.title }}</p>',
      projectDir: tmpDir,
    });
    expect(result.warnings).toHaveLength(0);
    const info = result.infos.find((i) => i.check === 'pos-supervisor:OrphanedPartialVerified');
    expect(info).toBeDefined();
    expect(info?.message).toContain('notes/show');
  });

  it('does NOT suppress OrphanedPartial when no file references the partial', () => {
    const result = makeResult(
      [],
      [
        {
          check: 'OrphanedPartial',
          severity: 'warning',
          message: "Partial 'notes/orphan' is never rendered",
        },
      ],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/notes/orphan.liquid',
      content: '<p>truly orphaned</p>',
      projectDir: tmpDir,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.check).toBe('OrphanedPartial');
  });

  it('works for OrphanedPartial reported as an error (not just warning)', () => {
    const result = makeResult([
      {
        check: 'OrphanedPartial',
        severity: 'error',
        message: "Partial 'notes/show' is never rendered",
      },
    ]);
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/notes/show.liquid',
      content: '<p>{{ object.title }}</p>',
      projectDir: tmpDir,
    });
    expect(result.errors).toHaveLength(0);
  });

  it('does not suppress for non-partial files', () => {
    const result = makeResult(
      [],
      [{ check: 'OrphanedPartial', severity: 'warning', message: 'orphan' }],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/notes/show.html.liquid',
      content: '',
      projectDir: tmpDir,
    });
    expect(result.warnings).toHaveLength(1);
  });
});

// ── populateDefaultConfidence (stamps confidence + rule_id defaults) ──

describe('diagnostic-pipeline: populateDefaultConfidence (in-pipeline stamping)', () => {
  it('stamps severity-based defaults when the rule engine left confidence unset', () => {
    const result = makeResult(
      [{ check: 'UndefinedObject', severity: 'error', message: 'foo' }],
      [{ check: 'UnusedAssign', severity: 'warning', message: 'bar' }],
      [{ check: 'InfoOnly', severity: 'info', message: 'baz' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0]!.confidence).toBe(0.9);
    expect(result.warnings[0]!.confidence).toBe(0.7);
    expect(result.infos[0]!.confidence).toBe(0.5);
  });

  it('does not overwrite a confidence value that the rule engine already set', () => {
    const result = makeResult([
      { check: 'UndefinedObject', severity: 'error', message: 'foo', confidence: 0.42 },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0]!.confidence).toBe(0.42);
  });

  it('stamps structural default for pos-supervisor: prefixed checks', () => {
    const result = makeResult(
      [],
      [{ check: 'pos-supervisor:RemovedRender', severity: 'warning', message: 'removed' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.warnings[0]!.confidence).toBe(0.75);
  });

  it('falls back to warning-level confidence when severity is unset or unknown', () => {
    const result = makeResult([], [{ check: 'Weirdo', message: 'no severity' }]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.warnings[0]!.confidence).toBe(0.7);
  });

  it('stamps rule_id as `${check}.unmatched` when no rule fired', () => {
    const result = makeResult(
      [{ check: 'UndefinedObject', severity: 'error', message: 'foo' }],
      [{ check: 'UnusedAssign', severity: 'warning', message: 'bar' }],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0]!.rule_id).toBe('UndefinedObject.unmatched');
    expect(result.warnings[0]!.rule_id).toBe('UnusedAssign.unmatched');
  });

  it('preserves rule_id set by the rule engine', () => {
    const result = makeResult([
      {
        check: 'UndefinedObject',
        severity: 'error',
        message: 'foo',
        rule_id: 'UndefinedObject.context_user',
      },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0]!.rule_id).toBe('UndefinedObject.context_user');
  });

  it('falls back to `unknown.unmatched` when the diagnostic has no check name', () => {
    const result = makeResult([], [{ severity: 'warning', message: 'orphan' } as PipelineDiagnostic]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.warnings[0]!.rule_id).toBe('unknown.unmatched');
  });
});

// ── stampDefaultsOn: late-push diagnostics ──

describe('stampDefaultsOn: late-push diagnostics get default confidence', () => {
  it('stamps diagnostics added AFTER runDiagnosticPipeline has already run', () => {
    const result = makeResult([
      { check: 'UnknownFilter', severity: 'error', message: 'x' },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/pages/x.liquid', content: '' });
    expect(result.errors[0]!.confidence).toBe(0.9);

    // Simulate a late push — e.g. structural-warnings / schema validator.
    result.warnings.push({
      check: 'pos-supervisor:HtmlInPage',
      severity: 'warning',
      message: 'HTML in page',
    });
    stampDefaultsOn(result);
    expect(result.warnings[0]!.confidence).toBe(0.75); // structural default
    expect(result.warnings[0]!.rule_id).toBe('pos-supervisor:HtmlInPage.unmatched');
  });

  it('is idempotent — re-stamping does not overwrite existing values', () => {
    const result = makeResult([
      {
        check: 'UnknownFilter',
        severity: 'error',
        message: 'x',
        confidence: 0.42,
        rule_id: 'UnknownFilter.typo',
      },
    ]);
    stampDefaultsOn(result);
    expect(result.errors[0]!.confidence).toBe(0.42);
    expect(result.errors[0]!.rule_id).toBe('UnknownFilter.typo');
  });
});

// ── suppressLspKnownFalsePositives ──

describe('diagnostic-pipeline: suppressLspKnownFalsePositives', () => {
  function syntaxErr(line: number, message = 'Syntax is not supported'): PipelineDiagnostic {
    return { check: 'LiquidHTMLSyntaxError', severity: 'error', line, message };
  }

  it('suppresses the LSP false positive on `assign x = a == b` when the file parses cleanly', () => {
    const content = [
      '{% doc %}',
      '  @param {object} object',
      '{% enddoc %}',
      '{% liquid',
      '  assign c = object.errors | default: empty',
      '  assign object.valid = c == empty',
      '  return object',
      '%}',
    ].join('\n');

    const result = makeResult([syntaxErr(6)]);
    runDiagnosticPipeline(result, {
      filePath: 'app/lib/commands/contacts/create/check.liquid',
      content,
    });

    expect(result.errors).toHaveLength(0);
    const info = result.infos.find(
      (i) => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed',
    );
    expect(info).toBeDefined();
    expect(info?.message).toContain('line(s) 6');
    expect(info?.message).toContain('@platformos/liquid-html-parser');
  });

  it('suppresses every "Syntax is not supported" diagnostic in the same file at once', () => {
    const content = [
      '{% liquid',
      '  assign a = 1 == 1',
      '  assign b = 2 != 3',
      '%}',
    ].join('\n');

    const result = makeResult([syntaxErr(2), syntaxErr(3)]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/check.liquid', content });

    expect(result.errors).toHaveLength(0);
    const info = result.infos.find(
      (i) => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed',
    );
    expect(info?.message).toContain('line(s) 2, 3');
  });

  it('does NOT suppress when the file has a real syntax error elsewhere (parser fails)', () => {
    const content = [
      '{% liquid',
      '  assign x = 1 == 1',
      '%}',
      '{% if foo %}',
      '  hello',
      '{# missing endif — strict parse fails here #}',
    ].join('\n');

    const result = makeResult([syntaxErr(2)]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/broken.liquid', content });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.check).toBe('LiquidHTMLSyntaxError');
    expect(
      result.infos.some((i) => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed'),
    ).toBe(false);
  });

  it('does NOT suppress LiquidHTMLSyntaxError diagnostics with a different upstream message', () => {
    const content = '{% liquid\n  assign x = 1\n%}\n';

    const result = makeResult([
      {
        check: 'LiquidHTMLSyntaxError',
        severity: 'error',
        line: 1,
        message: "Invalid syntax for tag 'render'",
      },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/x.liquid', content });

    expect(result.errors).toHaveLength(1);
    expect(
      result.infos.some((i) => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed'),
    ).toBe(false);
  });

  it('does NOT suppress non-LiquidHTMLSyntaxError checks even when the message text matches', () => {
    const content = '{% liquid\n  assign x = 1\n%}\n';

    const result = makeResult([
      { check: 'UnknownFilter', severity: 'error', line: 1, message: 'Syntax is not supported' },
    ]);
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/x.liquid', content });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.check).toBe('UnknownFilter');
  });

  it('also handles diagnostics surfaced as warnings, not just errors', () => {
    const content = '{% liquid\n  assign x = 1 == 1\n%}\n';

    const result = makeResult(
      [],
      [
        {
          check: 'LiquidHTMLSyntaxError',
          severity: 'warning',
          line: 2,
          message: 'Syntax is not supported',
        },
      ],
    );
    runDiagnosticPipeline(result, { filePath: 'app/views/partials/x.liquid', content });

    expect(result.warnings).toHaveLength(0);
    expect(
      result.infos.some((i) => i.check === 'pos-supervisor:LspSyntaxFalsePositiveSuppressed'),
    ).toBe(true);
  });
});

// ── verifyPageRoutesOnDisk: in-memory overlay ──

describe('diagnostic-pipeline: verifyPageRoutesOnDisk respects in-memory overlay', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pipeline-route-overlay-'));
    mkdirSync(join(tmpDir, 'app/views/pages'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'app/views/pages/index.liquid'),
      '<p>old version (no frontmatter)</p>\n',
      'utf8',
    );
  });

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("suppresses MissingPage for route '/' (POST) when the file under validation declares method: post in-memory", () => {
    const inMemory = [
      '---',
      'method: post',
      'metadata:',
      '  title: "Home"',
      '---',
      '<p>POST handler in-memory</p>',
    ].join('\n');

    const result = makeResult(
      [],
      [
        {
          check: 'MissingPage',
          severity: 'warning',
          line: 6,
          column: 0,
          message: "No page found for route '/' (POST)",
        },
      ],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/index.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.infos.some((i) => i.check === 'pos-supervisor:MissingPageSuppressed')).toBe(true);
  });

  it('still flags MissingPage when the in-memory frontmatter does not cover the reported method', () => {
    const inMemory = ['---', 'method: get', '---', '<p>GET only</p>'].join('\n');

    const result = makeResult(
      [],
      [
        {
          check: 'MissingPage',
          severity: 'warning',
          line: 4,
          column: 0,
          message: "No page found for route '/' (POST)",
        },
      ],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/index.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.hint).toContain('GET');
  });

  it('treats a brand-new page (not yet on disk) as serving its declared route', () => {
    const inMemory = ['---', 'slug: contact', 'method: post', '---', '<p>new page</p>'].join('\n');

    const result = makeResult(
      [],
      [
        {
          check: 'MissingPage',
          severity: 'warning',
          line: 5,
          column: 0,
          message: "No page found for route '/contact' (POST)",
        },
      ],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/pages/contact.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(0);
  });

  it('ignores the overlay when the file under validation is not under app/views/pages/ (partial / layout)', () => {
    const inMemory = [
      '---',
      'slug: pretend',
      'method: post',
      '---',
      '<p>partial pretending to be a page</p>',
    ].join('\n');

    const result = makeResult(
      [],
      [
        {
          check: 'MissingPage',
          severity: 'warning',
          line: 5,
          column: 0,
          message: "No page found for route '/pretend' (POST)",
        },
      ],
    );
    runDiagnosticPipeline(result, {
      filePath: 'app/views/partials/pretend.liquid',
      content: inMemory,
      projectDir: tmpDir,
    });

    expect(result.warnings).toHaveLength(1);
  });
});
