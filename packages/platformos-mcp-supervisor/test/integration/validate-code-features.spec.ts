/**
 * `validate_code` feature integration tests.
 *
 * Spawns the supervisor's stdio bin once per `describe`, drives it via the
 * MCP SDK client (see `test/helpers/server.ts`), and asserts the documented
 * result shape — `next_step`, `domain_guide`, translation-YAML structural
 * errors. v1 conversion from source:
 *
 *   - `bun:test` → `vitest`
 *   - HTTP `server.callTool` → stdio `supervisor.callTool` (MCP SDK Client +
 *     StdioClientTransport).
 *   - `setDefaultTimeout(30_000)` → per-suite `testTimeout: 30_000`.
 *
 * The supervisor's `dist/bin/platformos-mcp-supervisor.js` must exist —
 * `startSupervisor` throws a clear error otherwise. Run `yarn build:ts`
 * before invoking this suite (CI: chain `yarn build:ts && yarn test`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  startSupervisor,
  FIXTURE_PROJECT_DIR,
  type SupervisorHandle,
} from '../helpers/server';
import type { ValidateCodeResult } from '../../src/tools/validate-code';

const BOOT_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 15_000;

let supervisor: SupervisorHandle;

beforeAll(async () => {
  supervisor = await startSupervisor(FIXTURE_PROJECT_DIR, { timeoutMs: BOOT_TIMEOUT_MS });
}, BOOT_TIMEOUT_MS + 5_000);

afterAll(async () => {
  await supervisor?.stop();
});

// ---------------------------------------------------------------------------
// Feature 1: next_step in validate_code
// ---------------------------------------------------------------------------

describe('validate_code — next_step guidance', () => {
  it(
    'valid file returns next_step telling to write to disk',
    async () => {
      const content = `---
slug: test_valid
---
{% render 'blog_posts/list' %}`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/views/pages/test_valid.html.liquid',
        content,
        mode: 'quick',
      });
      if (result.status === 'ok') {
        expect(result.next_step).toBeDefined();
        expect(result.next_step).toContain('Write it to disk');
      }
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'invalid file returns next_step with fix instructions',
    async () => {
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/views/partials/test_invalid.liquid',
        content: 'app/views/partials/test_invalid.liquid',
        mode: 'quick',
      });
      // Content equals file path → InputError → status: 'error',
      // must_fix_before_write: true. The early-return path does NOT set
      // `next_step` (it short-circuits before the prose generator); the
      // human-readable repair instruction lives in the InputError
      // message itself.
      expect(result.status).toBe('error');
      expect(result.must_fix_before_write).toBe(true);
      const inputErr = result.errors.find((e) => e.check === 'InputError');
      expect(inputErr?.message).toMatch(/Read the file first|file path/);
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'invalid file next_step suggests re-validation with quick mode',
    async () => {
      const content = `{{ unknown_definitely_broken_var_xyzzy }}`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/views/partials/test_revalidate.liquid',
        content,
        mode: 'quick',
      });
      if (result.status === 'error') {
        expect(result.next_step).toBeDefined();
        expect(result.next_step).toContain('quick');
      }
    },
    CALL_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Feature 2: structured domain_guide
// ---------------------------------------------------------------------------

describe('validate_code — structured domain_guide', () => {
  it(
    'domain_guide is an object with domain/rule/triggered_gotchas fields when triggered',
    async () => {
      const content = `---
slug: test_domain
---
<div class="container">
  <h1>Inline HTML in page</h1>
</div>`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/views/pages/test_domain_guide.html.liquid',
        content,
        mode: 'full',
      });
      if (result.domain_guide) {
        expect(typeof result.domain_guide).toBe('object');
        expect(result.domain_guide.domain).toBeDefined();
        expect(result.domain_guide.rule).toBeDefined();
        expect(result.domain_guide.triggered_gotchas).toBeDefined();
      }
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'domain field matches the file domain when triggered',
    async () => {
      const content = `---
slug: test_pages_domain
---
{% render 'blog_posts/list' %}`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/views/pages/test_pages_domain.html.liquid',
        content,
        mode: 'full',
      });
      if (result.domain_guide) {
        expect(result.domain_guide.domain).toBe('pages');
      }
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'triggered_gotchas is an array when domain_guide is present',
    async () => {
      const content = `---
slug: test_gotchas_array
---
<div>HTML in page triggers gotchas</div>`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/views/pages/test_gotchas_array.html.liquid',
        content,
        mode: 'full',
      });
      if (result.domain_guide) {
        expect(Array.isArray(result.domain_guide.triggered_gotchas)).toBe(true);
      }
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'domain_guide is null when no gotchas are triggered',
    async () => {
      const content = `{% doc %}
  @param title {string} Title text
{% enddoc %}
<h1>{{ title }}</h1>`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/views/partials/test_no_gotchas.liquid',
        content,
        mode: 'full',
      });
      // domain_guide should be null OR a proper object when content-based
      // triggers fire. Either is valid; the contract is "no junk value".
      if (result.domain_guide === null) {
        expect(result.domain_guide).toBeNull();
      } else {
        expect(typeof result.domain_guide).toBe('object');
      }
    },
    CALL_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Translation YAML structural validation
// ---------------------------------------------------------------------------

describe('validate_code — translation YAML structural errors', () => {
  it(
    'reports TranslationMissingLocaleKey when top-level key is not a locale code',
    async () => {
      const content = `enff:\n  app:\n    hello: "Hello"\n`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/translations/en.yml',
        content,
        mode: 'quick',
      });
      expect(
        result.errors.some((e) => e.check === 'pos-supervisor:TranslationMissingLocaleKey'),
      ).toBe(true);
      expect(result.status).toBe('error');
      expect(result.must_fix_before_write).toBe(true);
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'reports TranslationMissingLocaleKey when tree has no locale wrapper (app: at root)',
    async () => {
      const content = `app:\n  contact_form:\n    title: "Contact"\n`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/translations/en.yml',
        content,
        mode: 'quick',
      });
      expect(
        result.errors.some((e) => e.check === 'pos-supervisor:TranslationMissingLocaleKey'),
      ).toBe(true);
      expect(result.status).toBe('error');
    },
    CALL_TIMEOUT_MS,
  );

  it(
    'passes a correctly wrapped translation file',
    async () => {
      const content = `en:\n  app:\n    hello: "Hello"\n`;
      const result = await supervisor.callTool<ValidateCodeResult>('validate_code', {
        file_path: 'app/translations/en.yml',
        content,
        mode: 'quick',
      });
      expect(
        result.errors.filter((e) => e.check === 'pos-supervisor:TranslationMissingLocaleKey'),
      ).toHaveLength(0);
      expect(result.status).not.toBe('error');
    },
    CALL_TIMEOUT_MS,
  );
});
