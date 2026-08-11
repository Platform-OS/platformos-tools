import { describe, it, expect } from 'vitest';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { DefinitionParams, Position } from 'vscode-languageserver-protocol';
import { DocumentManager } from '../../documents';
import { FrontmatterDefinitionProvider } from './FrontmatterDefinitionProvider';

const rootUri = 'file:///project';
const pageUri = 'file:///project/app/views/pages/index.liquid';
const emailUri = 'file:///project/app/emails/welcome.liquid';
const formUri = 'file:///project/app/forms/signup.liquid';

function setup(files: Record<string, string>) {
  const mockFs = new MockFileSystem(files);
  // The DocumentManager gets the filesystem, as it does in startServer: layout
  // resolution goes through the root's `App`, whose miss path reads directories
  // through the manager's fs.
  const documentManager = new DocumentManager(
    mockFs,
    undefined,
    undefined,
    undefined,
    async () => rootUri,
  );
  const provider = new FrontmatterDefinitionProvider(documentManager, mockFs, async () => rootUri);
  return { documentManager, provider };
}

/** Every target range is zero: this provider points at the FILE, not a position inside it. */
const WHOLE_FILE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/**
 * A whole `LocationLink`, spelled by the two things that vary: where it points, and the
 * frontmatter value the editor highlights at the cursor. `originSelectionRange` had no
 * assertion at all while these tests read `result[0].targetUri` and stopped — so a provider
 * that highlighted the wrong span, or the whole line, passed.
 */
const link = (targetUri: string, [line, start, end]: [number, number, number]) => ({
  targetUri,
  targetRange: WHOLE_FILE,
  targetSelectionRange: WHOLE_FILE,
  originSelectionRange: {
    start: { line, character: start },
    end: { line, character: end },
  },
});

function makeParams(uri: string, line: number, character: number): DefinitionParams {
  return {
    textDocument: { uri },
    position: Position.create(line, character),
  };
}

// ── Layout field (Page) ──────────────────────────────────────────────────────

describe('FrontmatterDefinitionProvider', () => {
  describe('layout field on Page', () => {
    it('resolves an app layout', async () => {
      const source = `---\nlayout: application\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/app/views/layouts/application.liquid', [1, 8, 19]),
      ]);
    });

    it('resolves a module layout (public visibility)', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/modules/community/public/views/layouts/base.liquid', [1, 8, 30]),
      ]);
    });

    it('resolves a module layout (private visibility)', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/private/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/modules/community/private/views/layouts/base.liquid', [1, 8, 30]),
      ]);
    });

    it('prefers public over private when both module visibilities exist', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/base.liquid': '{{ content }}',
        'project/modules/community/private/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/modules/community/public/views/layouts/base.liquid', [1, 8, 30]),
      ]);
    });

    it('resolves app/modules overwrite over the original module layout', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/views/layouts/base.liquid': '{{ content }}',
        'project/modules/community/public/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/app/modules/community/public/views/layouts/base.liquid', [1, 8, 30]),
      ]);
    });

    it('resolves a nested module layout path', async () => {
      const source = `---\nlayout: modules/community/themes/dark\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/themes/dark.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link(
          'file:///project/modules/community/public/views/layouts/themes/dark.liquid',
          [1, 8, 37],
        ),
      ]);
    });

    it('returns empty when layout file does not exist', async () => {
      const source = `---\nlayout: nonexistent\n---\n{{ content }}`;
      const { documentManager, provider } = setup({});
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([]);
    });

    it('returns empty when layout value is a Liquid expression', async () => {
      const source = `---\nlayout: {{ current_layout }}\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toEqual([]);
    });
  });

  // ── Layout field (Email) ───────────────────────────────────────────────────

  describe('layout field on Email', () => {
    it('resolves an app layout from an email notification', async () => {
      const source = `---\nlayout: email_base\n---\nHi`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/email_base.liquid': '{{ content }}',
      });
      documentManager.open(emailUri, source, 1);

      // line 1: layout: email_base
      const result = await provider.definitions(makeParams(emailUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/app/views/layouts/email_base.liquid', [1, 8, 18]),
      ]);
    });

    it('resolves a module layout from an email notification', async () => {
      const source = `---\nlayout: modules/community/email_base\n---\nHi`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/email_base.liquid': '{{ content }}',
      });
      documentManager.open(emailUri, source, 1);

      const result = await provider.definitions(makeParams(emailUri, 1, 10), null as any, []);

      expect(result).toEqual([
        link(
          'file:///project/modules/community/public/views/layouts/email_base.liquid',
          [1, 8, 36],
        ),
      ]);
    });

    it('returns empty when email layout file does not exist', async () => {
      const source = `---\nlayout: nonexistent\n---\nHi`;
      const { documentManager, provider } = setup({});
      documentManager.open(emailUri, source, 1);

      const result = await provider.definitions(makeParams(emailUri, 1, 10), null as any, []);

      expect(result).toEqual([]);
    });

    it('does not resolve layout for Layout file types', async () => {
      const layoutUri = 'file:///project/app/views/layouts/app.liquid';
      const source = `---\nconverter: markdown\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(layoutUri, source, 1);

      const result = await provider.definitions(makeParams(layoutUri, 1, 4), null as any, []);

      expect(result).toEqual([]);
    });
  });

  // ── authorization_policies (Page) ─────────────────────────────────────────

  describe('authorization_policies on Page', () => {
    it('resolves an app-level authorization policy', async () => {
      const source = `---\nauthorization_policies:\n  - is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/authorization_policies/is_authenticated.liquid': '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      // line 2 (0-indexed): "  - is_authenticated"
      const result = await provider.definitions(makeParams(pageUri, 2, 5), null as any, []);

      expect(result).toEqual([
        link('file:///project/app/authorization_policies/is_authenticated.liquid', [2, 4, 20]),
      ]);
    });

    it('resolves a module authorization policy (public visibility)', async () => {
      const source = `---\nauthorization_policies:\n  - modules/community/is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/authorization_policies/is_authenticated.liquid':
          '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link(
          'file:///project/modules/community/public/authorization_policies/is_authenticated.liquid',
          [2, 4, 38],
        ),
      ]);
    });

    it('resolves a module authorization policy (private visibility)', async () => {
      const source = `---\nauthorization_policies:\n  - modules/community/is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/modules/community/private/authorization_policies/is_authenticated.liquid':
          '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link(
          'file:///project/modules/community/private/authorization_policies/is_authenticated.liquid',
          [2, 4, 38],
        ),
      ]);
    });

    it('resolves app/modules overwrite over original module policy', async () => {
      const source = `---\nauthorization_policies:\n  - modules/community/is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/authorization_policies/is_authenticated.liquid':
          '{% return true %}',
        'project/modules/community/public/authorization_policies/is_authenticated.liquid':
          '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link(
          'file:///project/app/modules/community/public/authorization_policies/is_authenticated.liquid',
          [2, 4, 38],
        ),
      ]);
    });

    it('returns empty when authorization policy file does not exist', async () => {
      const source = `---\nauthorization_policies:\n  - nonexistent_policy\n---\n{{ content }}`;
      const { documentManager, provider } = setup({});
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 5), null as any, []);

      expect(result).toEqual([]);
    });
  });

  // ── email_notifications (FormConfiguration) ───────────────────────────────

  describe('email_notifications on FormConfiguration', () => {
    it('resolves an app-level email notification', async () => {
      const source = `---\nemail_notifications:\n  - welcome\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/emails/welcome.liquid': '---\nto: user@example.com\n---\n',
      });
      documentManager.open(formUri, source, 1);

      // line 2: "  - welcome"
      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toEqual([link('file:///project/app/emails/welcome.liquid', [2, 4, 11])]);
    });

    it('resolves a module email notification (public visibility)', async () => {
      const source = `---\nemail_notifications:\n  - modules/community/welcome\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/emails/welcome.liquid':
          '---\nto: user@example.com\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/modules/community/public/emails/welcome.liquid', [2, 4, 29]),
      ]);
    });

    it('resolves app/modules overwrite over original module email notification', async () => {
      const source = `---\nemail_notifications:\n  - modules/community/welcome\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/emails/welcome.liquid':
          '---\nto: user@example.com\n---\n',
        'project/modules/community/public/emails/welcome.liquid':
          '---\nto: user@example.com\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/app/modules/community/public/emails/welcome.liquid', [2, 4, 29]),
      ]);
    });

    it('returns empty when email notification file does not exist', async () => {
      const source = `---\nemail_notifications:\n  - nonexistent\n---\n`;
      const { documentManager, provider } = setup({});
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toEqual([]);
    });
  });

  // ── sms_notifications (FormConfiguration) ─────────────────────────────────

  describe('sms_notifications on FormConfiguration', () => {
    it('resolves an app-level SMS notification', async () => {
      const source = `---\nsms_notifications:\n  - sms_alert\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/smses/sms_alert.liquid': '---\nto: "+15550001234"\n---\n',
      });
      documentManager.open(formUri, source, 1);

      // line 2: "  - sms_alert"
      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toEqual([link('file:///project/app/smses/sms_alert.liquid', [2, 4, 13])]);
    });

    it('resolves a module SMS notification (public visibility)', async () => {
      const source = `---\nsms_notifications:\n  - modules/community/sms_alert\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/smses/sms_alert.liquid': '---\nto: "+15550001234"\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/modules/community/public/smses/sms_alert.liquid', [2, 4, 31]),
      ]);
    });

    it('returns empty when SMS notification file does not exist', async () => {
      const source = `---\nsms_notifications:\n  - nonexistent\n---\n`;
      const { documentManager, provider } = setup({});
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toEqual([]);
    });
  });

  // ── api_call_notifications (FormConfiguration) ────────────────────────────

  describe('api_call_notifications on FormConfiguration', () => {
    it('resolves an app-level API call notification', async () => {
      const source = `---\napi_call_notifications:\n  - webhook\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/api_calls/webhook.liquid':
          '---\nto: https://example.com\nrequest_type: POST\n---\n',
      });
      documentManager.open(formUri, source, 1);

      // line 2: "  - webhook"
      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toEqual([link('file:///project/app/api_calls/webhook.liquid', [2, 4, 11])]);
    });

    it('resolves a module API call notification (public visibility)', async () => {
      const source = `---\napi_call_notifications:\n  - modules/community/webhook\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/api_calls/webhook.liquid':
          '---\nto: https://example.com\nrequest_type: POST\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/modules/community/public/api_calls/webhook.liquid', [2, 4, 29]),
      ]);
    });

    it('resolves app/modules overwrite over original module API call notification', async () => {
      const source = `---\napi_call_notifications:\n  - modules/community/webhook\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/api_calls/webhook.liquid':
          '---\nto: https://example.com\nrequest_type: POST\n---\n',
        'project/modules/community/public/api_calls/webhook.liquid':
          '---\nto: https://example.com\nrequest_type: POST\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toEqual([
        link('file:///project/app/modules/community/public/api_calls/webhook.liquid', [2, 4, 29]),
      ]);
    });

    it('returns empty when API call notification file does not exist', async () => {
      const source = `---\napi_call_notifications:\n  - nonexistent\n---\n`;
      const { documentManager, provider } = setup({});
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toEqual([]);
    });
  });

  // ── Outside frontmatter ───────────────────────────────────────────────────

  describe('outside frontmatter', () => {
    it('returns empty when cursor is in the Liquid body', async () => {
      const source = `---\nlayout: application\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      // cursor on line 3 (the {{ content }} line)
      const result = await provider.definitions(makeParams(pageUri, 3, 5), null as any, []);

      expect(result).toEqual([]);
    });
  });
});
