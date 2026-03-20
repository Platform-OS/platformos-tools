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
  const documentManager = new DocumentManager();
  const mockFs = new MockFileSystem(files);
  const provider = new FrontmatterDefinitionProvider(
    documentManager,
    mockFs,
    async () => rootUri,
  );
  return { documentManager, provider };
}

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

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/layouts/application.liquid');
    });

    it('resolves a module layout (public visibility)', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/views/layouts/base.liquid',
      );
    });

    it('resolves a module layout (private visibility)', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/private/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/private/views/layouts/base.liquid',
      );
    });

    it('prefers public over private when both module visibilities exist', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/base.liquid': '{{ content }}',
        'project/modules/community/private/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/views/layouts/base.liquid',
      );
    });

    it('resolves app/modules overwrite over the original module layout', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/views/layouts/base.liquid': '{{ content }}',
        'project/modules/community/public/views/layouts/base.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/modules/community/public/views/layouts/base.liquid',
      );
    });

    it('resolves a nested module layout path', async () => {
      const source = `---\nlayout: modules/community/themes/dark\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/themes/dark.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/views/layouts/themes/dark.liquid',
      );
    });

    it('returns empty when layout file does not exist', async () => {
      const source = `---\nlayout: nonexistent\n---\n{{ content }}`;
      const { documentManager, provider } = setup({});
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toHaveLength(0);
    });

    it('returns empty when layout value is a Liquid expression', async () => {
      const source = `---\nlayout: {{ current_layout }}\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 1, 10), null as any, []);

      expect(result).toHaveLength(0);
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

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/layouts/email_base.liquid');
    });

    it('resolves a module layout from an email notification', async () => {
      const source = `---\nlayout: modules/community/email_base\n---\nHi`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/views/layouts/email_base.liquid': '{{ content }}',
      });
      documentManager.open(emailUri, source, 1);

      const result = await provider.definitions(makeParams(emailUri, 1, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/views/layouts/email_base.liquid',
      );
    });

    it('returns empty when email layout file does not exist', async () => {
      const source = `---\nlayout: nonexistent\n---\nHi`;
      const { documentManager, provider } = setup({});
      documentManager.open(emailUri, source, 1);

      const result = await provider.definitions(makeParams(emailUri, 1, 10), null as any, []);

      expect(result).toHaveLength(0);
    });

    it('does not resolve layout for Layout file types', async () => {
      const layoutUri = 'file:///project/app/views/layouts/app.liquid';
      const source = `---\nconverter: markdown\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(layoutUri, source, 1);

      const result = await provider.definitions(makeParams(layoutUri, 1, 4), null as any, []);

      expect(result).toHaveLength(0);
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

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/authorization_policies/is_authenticated.liquid',
      );
    });

    it('resolves a module authorization policy (public visibility)', async () => {
      const source = `---\nauthorization_policies:\n  - modules/community/is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/authorization_policies/is_authenticated.liquid': '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/authorization_policies/is_authenticated.liquid',
      );
    });

    it('resolves a module authorization policy (private visibility)', async () => {
      const source = `---\nauthorization_policies:\n  - modules/community/is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/modules/community/private/authorization_policies/is_authenticated.liquid': '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/private/authorization_policies/is_authenticated.liquid',
      );
    });

    it('resolves app/modules overwrite over original module policy', async () => {
      const source = `---\nauthorization_policies:\n  - modules/community/is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/authorization_policies/is_authenticated.liquid': '{% return true %}',
        'project/modules/community/public/authorization_policies/is_authenticated.liquid': '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/modules/community/public/authorization_policies/is_authenticated.liquid',
      );
    });

    it('returns empty when authorization policy file does not exist', async () => {
      const source = `---\nauthorization_policies:\n  - nonexistent_policy\n---\n{{ content }}`;
      const { documentManager, provider } = setup({});
      documentManager.open(pageUri, source, 1);

      const result = await provider.definitions(makeParams(pageUri, 2, 5), null as any, []);

      expect(result).toHaveLength(0);
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

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/emails/welcome.liquid',
      );
    });

    it('resolves a module email notification (public visibility)', async () => {
      const source = `---\nemail_notifications:\n  - modules/community/welcome\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/emails/welcome.liquid': '---\nto: user@example.com\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/emails/welcome.liquid',
      );
    });

    it('resolves app/modules overwrite over original module email notification', async () => {
      const source = `---\nemail_notifications:\n  - modules/community/welcome\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/emails/welcome.liquid': '---\nto: user@example.com\n---\n',
        'project/modules/community/public/emails/welcome.liquid': '---\nto: user@example.com\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/modules/community/public/emails/welcome.liquid',
      );
    });

    it('returns empty when email notification file does not exist', async () => {
      const source = `---\nemail_notifications:\n  - nonexistent\n---\n`;
      const { documentManager, provider } = setup({});
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toHaveLength(0);
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

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/smses/sms_alert.liquid',
      );
    });

    it('resolves a module SMS notification (public visibility)', async () => {
      const source = `---\nsms_notifications:\n  - modules/community/sms_alert\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/smses/sms_alert.liquid': '---\nto: "+15550001234"\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/smses/sms_alert.liquid',
      );
    });

    it('returns empty when SMS notification file does not exist', async () => {
      const source = `---\nsms_notifications:\n  - nonexistent\n---\n`;
      const { documentManager, provider } = setup({});
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toHaveLength(0);
    });
  });

  // ── api_call_notifications (FormConfiguration) ────────────────────────────

  describe('api_call_notifications on FormConfiguration', () => {
    it('resolves an app-level API call notification', async () => {
      const source = `---\napi_call_notifications:\n  - webhook\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/api_calls/webhook.liquid': '---\nto: https://example.com\nrequest_type: POST\n---\n',
      });
      documentManager.open(formUri, source, 1);

      // line 2: "  - webhook"
      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/api_calls/webhook.liquid',
      );
    });

    it('resolves a module API call notification (public visibility)', async () => {
      const source = `---\napi_call_notifications:\n  - modules/community/webhook\n---\n`;
      const { documentManager, provider } = setup({
        'project/modules/community/public/api_calls/webhook.liquid': '---\nto: https://example.com\nrequest_type: POST\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/community/public/api_calls/webhook.liquid',
      );
    });

    it('resolves app/modules overwrite over original module API call notification', async () => {
      const source = `---\napi_call_notifications:\n  - modules/community/webhook\n---\n`;
      const { documentManager, provider } = setup({
        'project/app/modules/community/public/api_calls/webhook.liquid': '---\nto: https://example.com\nrequest_type: POST\n---\n',
        'project/modules/community/public/api_calls/webhook.liquid': '---\nto: https://example.com\nrequest_type: POST\n---\n',
      });
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 10), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/modules/community/public/api_calls/webhook.liquid',
      );
    });

    it('returns empty when API call notification file does not exist', async () => {
      const source = `---\napi_call_notifications:\n  - nonexistent\n---\n`;
      const { documentManager, provider } = setup({});
      documentManager.open(formUri, source, 1);

      const result = await provider.definitions(makeParams(formUri, 2, 5), null as any, []);

      expect(result).toHaveLength(0);
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

      expect(result).toHaveLength(0);
    });
  });
});
