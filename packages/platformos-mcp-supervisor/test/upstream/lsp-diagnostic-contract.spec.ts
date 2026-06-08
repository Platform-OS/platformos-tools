/**
 * LSP diagnostic contract tests — pin the behavior of platformos-check-common
 * (`@platformos/platformos-language-server-node`) for the diagnostic shapes
 * our enricher's regexes depend on.
 *
 * These tests verify that the LSP reports specific diagnostics for known
 * broken inputs. When the in-monorepo language-server-common changes a
 * check message template, this spec catches the drift before it silently
 * breaks `extractParams` (`src/core/diagnostic-record.ts`) and downstream
 * enrichment / fix generation.
 *
 * Each test documents the dependency on the assertion — the enricher,
 * suppression, or pipeline branch that relies on the pinned shape.
 *
 * v1 conversion:
 *   - source `describePosCli(...)` guard is dropped (LSP is in-process via
 *     `@platformos/platformos-language-server-node`; no PATH dependency).
 *   - `setDefaultTimeout(30_000)` → per-test `CALL_TIMEOUT_MS = 15_000`,
 *     per-`beforeAll` `BOOT_TIMEOUT_MS = 30_000`.
 *   - HTTP `server.callTool` → stdio `supervisor.callTool` via
 *     `test/helpers/server.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  startSupervisor,
  FIXTURE_PROJECT_DIR,
  type SupervisorHandle,
} from '../helpers/server';
import type {
  ValidateCodeResult,
  ValidateCodeDiagnostic,
} from '../../src/tools/validate-code';

const BOOT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 15_000;

let supervisor: SupervisorHandle;

beforeAll(async () => {
  supervisor = await startSupervisor(FIXTURE_PROJECT_DIR, { timeoutMs: BOOT_TIMEOUT_MS });

  // First-request warm-up. The in-process LSP completes its `initialize`
  // handshake before `startSupervisor` resolves, but the FIRST per-document
  // request races the server's filter / object / tag check initialisation
  // on slow runners (observed on Windows-CI as a 361 ms early return from
  // `awaitDiagnostics` before any `UnknownFilter` notification arrived —
  // the second call onwards consistently reports the same diagnostic in
  // ~1.1 s). One throwaway `validate_code` call exercises the per-document
  // path and lets subsequent assertions see a stabilised LSP. Source's
  // pos-supervisor had explicit `runLspWarmup` in server.js for the same
  // reason; v1 dropped warm-up for boot speed but needs it on the
  // assertion-heavy contract suite.
  await supervisor.callTool('validate_code', {
    file_path: 'app/views/partials/_lsp_warmup.liquid',
    content: '{{ "hello" | totally_nonexistent_filter }}',
    mode: 'quick',
  });
}, BOOT_TIMEOUT_MS + 5_000);

afterAll(async () => {
  await supervisor?.stop();
});

interface LspDiagSlice {
  errors: ValidateCodeDiagnostic[];
  warnings: ValidateCodeDiagnostic[];
  infos: ValidateCodeDiagnostic[];
  all: ValidateCodeDiagnostic[];
  raw: ValidateCodeResult;
}

/**
 * Run `validate_code` and return only LSP-originated diagnostics. Filters
 * out `pos-supervisor:*` structural warnings so contract assertions about
 * upstream LSP behaviour aren't polluted by our own checks.
 */
async function getLspDiags(
  filePath: string,
  content: string,
  mode: 'full' | 'quick' = 'full',
): Promise<LspDiagSlice> {
  const raw = await supervisor.callTool<ValidateCodeResult>('validate_code', {
    file_path: filePath,
    content,
    mode,
  });
  const isLsp = (d: ValidateCodeDiagnostic): boolean => !d.check.startsWith('pos-supervisor:');
  const errors = raw.errors.filter(isLsp);
  const warnings = raw.warnings.filter(isLsp);
  const infos = (raw.infos ?? []).filter(isLsp);
  return { errors, warnings, infos, all: [...errors, ...warnings, ...infos], raw };
}

// ── UnknownFilter ──────────────────────────────────────────────────────────

describe('LSP contract: UnknownFilter', () => {
  it(
    'fires for nonexistent filters',
    async () => {
      // Dependency: error-enricher.ts `UnknownFilter` extractor (extractParams)
      // parses the filter name from this diagnostic.
      const { all } = await getLspDiags(
        'app/views/partials/contract_filter.liquid',
        '{{ "hello" | totally_nonexistent_filter }}',
      );
      expect(all.find((d) => d.check === 'UnknownFilter')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'message contains filter name in quotes',
    async () => {
      // Dependency: extractor regex /[`'"]([^`'"]+)[`'"]/ over the message.
      const { all } = await getLspDiags(
        'app/views/partials/contract_filter_msg.liquid',
        '{{ "x" | bogus_filter_name }}',
      );
      const check = all.find((d) => d.check === 'UnknownFilter');
      expect(check).toBeDefined();
      expect(check!.message).toMatch(/['"`]bogus_filter_name['"`]/);
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'does NOT fire for valid platformOS filters',
    async () => {
      const { all } = await getLspDiags(
        'app/views/partials/contract_filter_valid.liquid',
        '{{ "x" | json }}\n{{ arr | map: "name" }}',
      );
      expect(all.filter((d) => d.check === 'UnknownFilter')).toHaveLength(0);
    },
    CALL_TIMEOUT_MS,
  );
});

// ── UndefinedObject ────────────────────────────────────────────────────────

describe('LSP contract: UndefinedObject', () => {
  it(
    'fires for undeclared variables in partials WITH {% doc %}',
    async () => {
      // Dependency: enricher adds hints, Shopify detection, "did you mean?"
      // suggestions for UndefinedObject diagnostics.
      const content = `{% doc %}\n  @param title {string} - title\n{% enddoc %}\n{{ unknown_variable_xyz }}`;
      const { all } = await getLspDiags(
        'app/views/partials/contract_undef_doc.liquid',
        content,
      );
      expect(all.find((d) => d.check === 'UndefinedObject')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'does NOT fire for declared @param variables',
    async () => {
      const content = `{% doc %}\n  @param title {string} - title\n{% enddoc %}\n{{ title }}`;
      const { all } = await getLspDiags(
        'app/views/partials/contract_undef_param.liquid',
        content,
      );
      const undefs = all.filter(
        (d) => d.check === 'UndefinedObject' && d.message?.includes('title'),
      );
      expect(undefs).toHaveLength(0);
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'tracks behaviour WITHOUT {% doc %} in partials (upstream behavioural pin)',
    async () => {
      // platformos-check-common@0.0.17 made UndefinedObject require {% doc %}
      // in partials. If upstream reverts that, this spec surfaces the
      // opportunity (the enricher's partial-only gating can relax).
      const { all } = await getLspDiags(
        'app/views/partials/contract_undef_nodoc.liquid',
        '{{ some_mystery_variable }}',
      );
      const check = all.find((d) => d.check === 'UndefinedObject');
      // Current contract: UndefinedObject does NOT fire without {% doc %}.
      expect(check).toBeUndefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'fires for unknown variables in pages',
    async () => {
      // Pages always get UndefinedObject checks (no {% doc %} needed).
      const content = `---\nslug: contract-test\n---\n{{ totally_unknown_page_var }}`;
      const { all } = await getLspDiags('app/views/pages/contract_undef.html.liquid', content);
      expect(all.find((d) => d.check === 'UndefinedObject')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'message contains variable name in quotes',
    async () => {
      // Dependency: extractParams UndefinedObject regex /[`'"]([^`'"]+)[`'"]/.
      const content = `{% doc %}\n  @param t {string}\n{% enddoc %}\n{{ mystery_var_name }}`;
      const { all } = await getLspDiags(
        'app/views/partials/contract_undef_msg.liquid',
        content,
      );
      const check = all.find((d) => d.check === 'UndefinedObject');
      expect(check).toBeDefined();
      expect(check!.message).toMatch(/['"`]mystery_var_name['"`]/);
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'severity is warning',
    async () => {
      // Dependency: pipeline `elevateShopify` and the UndefinedObject
      // suppression branch expect warning, then conditionally elevate.
      const content = `{% doc %}\n  @param t {string}\n{% enddoc %}\n{{ undef_sev_test }}`;
      const { warnings } = await getLspDiags(
        'app/views/partials/contract_undef_sev.liquid',
        content,
      );
      expect(warnings.find((d) => d.check === 'UndefinedObject')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );
});

// ── MissingPartial ─────────────────────────────────────────────────────────

describe('LSP contract: MissingPartial', () => {
  it(
    'fires for nonexistent partials',
    async () => {
      // Dependency: enricher builds create path, detects object type
      // (partial/command/query/module).
      const { all } = await getLspDiags(
        'app/views/partials/contract_missing.liquid',
        "{% render 'completely/nonexistent/partial' %}",
      );
      expect(all.find((d) => d.check === 'MissingPartial')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'message contains partial name in quotes',
    async () => {
      // Dependency: extractParams MissingPartial regex /['"]([^'"]+)['"]/.
      const { all } = await getLspDiags(
        'app/views/partials/contract_missing_msg.liquid',
        "{% render 'contract_test/nonexistent_xyz' %}",
      );
      const check = all.find((d) => d.check === 'MissingPartial');
      expect(check).toBeDefined();
      expect(check!.message).toMatch(/['"`]contract_test\/nonexistent_xyz['"`]/);
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'does NOT fire for existing partials',
    async () => {
      // blog_posts/card exists in the fixture project.
      const { all } = await getLspDiags(
        'app/views/partials/contract_existing.liquid',
        "{% render 'blog_posts/card', blog_post: null %}",
      );
      expect(all.filter((d) => d.check === 'MissingPartial')).toHaveLength(0);
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'severity is error from the LSP',
    async () => {
      // MissingPartial is an ERROR from the LSP (DiagnosticSeverity.Error).
      // The historical `downgradePreWrite` pipeline step that hid this for
      // pre-write files was removed in v1; MissingPartial is now always
      // an error.
      const { errors } = await getLspDiags(
        'app/views/partials/contract_missing_sev.liquid',
        "{% render 'does/not/exist/anywhere' %}",
      );
      expect(errors.find((d) => d.check === 'MissingPartial')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );
});

// ── DeprecatedTag ──────────────────────────────────────────────────────────

describe('LSP contract: DeprecatedTag', () => {
  it(
    'fires for {% include %}',
    async () => {
      // Dependency: enricher overrides message, extracts tag name + replacement.
      const { all } = await getLspDiags(
        'app/views/partials/contract_deprecated.liquid',
        "{% include 'shared/test' %}",
      );
      expect(all.find((d) => d.check === 'DeprecatedTag')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'message contains tag name in quotes',
    async () => {
      // Dependency: extractParams DeprecatedTag regex /[`'"](\w+)[`'"]/.
      const { all } = await getLspDiags(
        'app/views/partials/contract_deprecated_msg.liquid',
        "{% include 'test_partial' %}",
      );
      const check = all.find((d) => d.check === 'DeprecatedTag');
      expect(check).toBeDefined();
      expect(check!.message).toMatch(/['"`]include['"`]/);
    },
    CALL_TIMEOUT_MS,
  );
});

// ── TranslationKeyExists ───────────────────────────────────────────────────

describe('LSP contract: TranslationKeyExists', () => {
  it(
    'fires for missing translation keys',
    async () => {
      // Dependency: enricher builds YAML snippet, extracts key.
      const { all } = await getLspDiags(
        'app/views/partials/contract_trans.liquid',
        "{{ 'nonexistent.translation.key.xyz123' | t }}",
      );
      expect(all.find((d) => d.check === 'TranslationKeyExists')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'message contains translation key in quotes',
    async () => {
      // Dependency: extractParams TranslationKeyExists regex.
      const { all } = await getLspDiags(
        'app/views/partials/contract_trans_msg.liquid',
        "{{ 'my.test.key.nonexistent' | t }}",
      );
      const check = all.find((d) => d.check === 'TranslationKeyExists');
      expect(check).toBeDefined();
      expect(check!.message).toMatch(/['"`]my\.test\.key\.nonexistent['"`]/);
    },
    CALL_TIMEOUT_MS,
  );
});

// ── UnusedAssign ───────────────────────────────────────────────────────────

describe('LSP contract: UnusedAssign', () => {
  it(
    'fires for unused variables',
    async () => {
      // Dependency: enricher extracts var name.
      const { all } = await getLspDiags(
        'app/views/partials/contract_unused.liquid',
        '{% assign never_used_variable = "hello" %}',
      );
      expect(all.find((d) => d.check === 'UnusedAssign')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'severity is warning',
    async () => {
      const { warnings } = await getLspDiags(
        'app/views/partials/contract_unused_sev.liquid',
        '{% assign unused_sev_test = 1 %}',
      );
      expect(warnings.find((d) => d.check === 'UnusedAssign')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );
});

// ── OrphanedPartial ────────────────────────────────────────────────────────

describe('LSP contract: OrphanedPartial', () => {
  it(
    'fires for unreferenced partials',
    async () => {
      // Dependency: pipeline suppresses OrphanedPartial for commands/queries.
      const { all } = await getLspDiags(
        'app/views/partials/contract_orphaned.liquid',
        '{{ "just some content" }}',
      );
      expect(all.find((d) => d.check === 'OrphanedPartial')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'severity is warning',
    async () => {
      const { warnings } = await getLspDiags(
        'app/views/partials/contract_orphaned_sev.liquid',
        'hello',
      );
      expect(warnings.find((d) => d.check === 'OrphanedPartial')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );
});

// ── MissingRenderPartialArguments ──────────────────────────────────────────

describe('LSP contract: MissingRenderPartialArguments', () => {
  it(
    'fires when required params are omitted',
    async () => {
      // blog_posts/card has {% doc %} @param blog_post — rendering without it triggers this.
      // Dependency: enricher extracts partial name and missing param.
      const { all } = await getLspDiags(
        'app/views/partials/contract_missing_args.liquid',
        "{% render 'blog_posts/card' %}",
      );
      expect(all.find((d) => d.check === 'MissingRenderPartialArguments')).toBeDefined();
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'message contains "argument" and param name',
    async () => {
      // Dependency: extractParams MissingRenderPartialArguments regex.
      const { all } = await getLspDiags(
        'app/views/partials/contract_missing_args_msg.liquid',
        "{% render 'blog_posts/card' %}",
      );
      const check = all.find((d) => d.check === 'MissingRenderPartialArguments');
      if (check) {
        expect(check.message).toMatch(/argument/i);
        expect(check.message).toMatch(/blog_post/);
      }
    },
    CALL_TIMEOUT_MS,
  );
});
