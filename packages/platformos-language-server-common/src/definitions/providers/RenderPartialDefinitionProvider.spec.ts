import { describe, it, expect } from 'vitest';
import { toLiquidHtmlAST } from '@platformos/liquid-html-parser';
import { findCurrentNode } from '@platformos/platformos-check-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { DocumentsLocator } from '@platformos/platformos-common';
import { DefinitionParams, Position } from 'vscode-languageserver-protocol';
import { DocumentManager } from '../../documents';
import { SearchPathsLoader } from '../../utils/searchPaths';
import { RenderPartialDefinitionProvider } from './RenderPartialDefinitionProvider';

const rootUri = 'file:///project';
const uriString = 'file:///project/app/views/pages/index.liquid';

function setup(files: Record<string, string>) {
  const documentManager = new DocumentManager();
  const mockFs = new MockFileSystem(files);
  const provider = new RenderPartialDefinitionProvider(
    documentManager,
    new DocumentsLocator(mockFs),
    new SearchPathsLoader(mockFs),
    async () => rootUri,
  );
  return { documentManager, provider };
}

async function getDefinitions(source: string, cursorOffset: number, files: Record<string, string>) {
  const { documentManager, provider } = setup(files);
  documentManager.open(uriString, source, 1);

  const ast = toLiquidHtmlAST(source);
  const [node, ancestors] = findCurrentNode(ast, cursorOffset);
  const params: DefinitionParams = {
    textDocument: { uri: uriString },
    position: Position.create(0, cursorOffset),
  };

  return provider.definitions(params, node, ancestors);
}

describe('RenderPartialDefinitionProvider', () => {
  describe('render tag', () => {
    it('should resolve render partials', async () => {
      const result = await getDefinitions("{% render 'card' %}", 12, {
        'project/app/views/partials/card.liquid': 'card content',
      });

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/partials/card.liquid');
    });

    it('should NOT use search paths for regular render tags', async () => {
      const result = await getDefinitions("{% render 'card' %}", 12, {
        'project/app/config.yml': 'theme_search_paths:\n  - theme/dress',
        'project/app/views/partials/theme/dress/card.liquid': 'dress card',
      });

      expect(result).toHaveLength(0);
    });
  });

  describe('theme_render_rc tag', () => {
    it('should resolve via theme_search_paths', async () => {
      const result = await getDefinitions("{% theme_render_rc 'card' %}", 20, {
        'project/app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
        'project/app/views/partials/theme/dress/card.liquid': 'dress card',
      });

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/app/views/partials/theme/dress/card.liquid',
      );
    });

    it('should fallback to standard resolution when no config exists', async () => {
      const result = await getDefinitions("{% theme_render_rc 'card' %}", 20, {
        'project/app/views/partials/card.liquid': 'default card',
      });

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/views/partials/card.liquid');
    });

    it('should resolve inside {% liquid %} blocks', async () => {
      const source = `{% liquid
  theme_render_rc 'components/atoms/heading', content: 'text'
%}`;
      const offset = source.indexOf('components/atoms/heading');
      const { documentManager, provider } = setup({
        'project/app/config.yml': "theme_search_paths:\n  - ''\n  - modules/components",
        'project/modules/components/public/views/partials/components/atoms/heading.liquid':
          'heading',
      });
      documentManager.open(uriString, source, 1);

      const ast = toLiquidHtmlAST(source);
      const [node, ancestors] = findCurrentNode(ast, offset);
      const params: DefinitionParams = {
        textDocument: { uri: uriString },
        position: Position.create(1, 20),
      };

      const result = await provider.definitions(params, node, ancestors);

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe(
        'file:///project/modules/components/public/views/partials/components/atoms/heading.liquid',
      );
    });
  });

  describe('function tag', () => {
    it('should resolve function partials', async () => {
      const result = await getDefinitions("{% function result = 'commands/apply' %}", 24, {
        'project/app/lib/commands/apply.liquid': 'apply content',
      });

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/lib/commands/apply.liquid');
    });
  });

  describe('graphql tag', () => {
    it('should resolve graphql references', async () => {
      const result = await getDefinitions("{% graphql g = 'users/search' %}", 18, {
        'project/app/graphql/users/search.graphql': 'query { }',
      });

      expect(result).toHaveLength(1);
      expect(result[0].targetUri).toBe('file:///project/app/graphql/users/search.graphql');
    });
  });

  describe('non-matching nodes', () => {
    it('should return empty for non-string nodes', async () => {
      const result = await getDefinitions("{% assign x = 'hello' %}", 3, {});

      expect(result).toHaveLength(0);
    });
  });
});
