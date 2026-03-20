import { describe, it, expect } from 'vitest';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { DefinitionParams, Position } from 'vscode-languageserver-protocol';
import { DocumentManager } from '../../documents';
import { FrontmatterDefinitionProvider } from './FrontmatterDefinitionProvider';

const rootUri = 'file:///project';
const pageUri = 'file:///project/app/views/pages/index.liquid';

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

describe('FrontmatterDefinitionProvider', () => {
  describe('layout field', () => {
    it('resolves an app layout to its file URI', async () => {
      const source = `---\nlayout: application\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(pageUri, source, 1);

      // cursor on "application" in line 1 (0-indexed): char 8
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

    it('resolves the app/modules overwrite over the module layout', async () => {
      const source = `---\nlayout: modules/community/base\n---\n`;
      const { documentManager, provider } = setup({
        // App overwrite at app/modules/{mod}/{visibility}/... takes priority
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

    it('falls back to module layout when no app/modules overwrite exists', async () => {
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

    it('does not resolve layout for non-page file types', async () => {
      const layoutUri = 'file:///project/app/views/layouts/app.liquid';
      const source = `---\nname: app\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/views/layouts/application.liquid': '{{ content }}',
      });
      documentManager.open(layoutUri, source, 1);

      const result = await provider.definitions(makeParams(layoutUri, 1, 4), null as any, []);

      expect(result).toHaveLength(0);
    });
  });

  describe('authorization_policies field', () => {
    it('resolves an authorization policy to its file URI', async () => {
      const source = `---\nauthorization_policies:\n  - is_authenticated\n---\n{{ content }}`;
      const { documentManager, provider } = setup({
        'project/app/authorization_policies/is_authenticated.liquid': '{% return true %}',
      });
      documentManager.open(pageUri, source, 1);

      // cursor on "is_authenticated" in line 2 (0-indexed): char 5
      const result = await provider.definitions(makeParams(pageUri, 2, 5), null as any, []);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/authorization_policies/is_authenticated.liquid',
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
