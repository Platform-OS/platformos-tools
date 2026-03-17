import { describe, beforeEach, it, expect } from 'vitest';
import { DocumentManager } from '../../documents';
import { HoverProvider } from '../HoverProvider';
import { TranslationProvider } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { HoverParams } from 'vscode-languageserver';

const SCHEMA = `
type Query {
  records: RecordList
  user(id: ID!): User
}

type RecordList {
  results: [Record]
  total_entries: Int
}

type Record {
  id: ID
  name: String
  email: String
}

type User {
  id: ID
  name: String
}
`;

describe('Module: GraphQLFieldHoverProvider', () => {
  let provider: HoverProvider;
  let documentManager: DocumentManager;

  beforeEach(() => {
    documentManager = new DocumentManager();
    provider = new HoverProvider(
      documentManager,
      {
        graphQL: async () => SCHEMA,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      new TranslationProvider(new MockFileSystem({})),
    );
  });

  it('should return hover info for a top-level field in a .graphql file', async () => {
    const source = '{\n  records {\n    total_entries\n  }\n}';
    const uri = 'file:///app/graphql/test.graphql';
    documentManager.open(uri, source, 0);

    const params: HoverParams = {
      position: { line: 1, character: 5 },
      textDocument: { uri },
    };

    const result = await provider.hover(params);
    expect(result).not.toBeNull();
    expect((result!.contents as any).value).toContain('records');
    expect((result!.contents as any).value).toContain('RecordList');
  });

  it('should return hover info for a nested field', async () => {
    const source = 'query {\n  records {\n    results {\n      name\n    }\n  }\n}';
    const uri = 'file:///app/graphql/nested.graphql';
    documentManager.open(uri, source, 0);

    const params: HoverParams = {
      position: { line: 3, character: 8 },
      textDocument: { uri },
    };

    const result = await provider.hover(params);
    expect(result).not.toBeNull();
    expect((result!.contents as any).value).toContain('Record.name');
    expect((result!.contents as any).value).toContain('String');
  });

  it('should return null when no schema is available', async () => {
    const noSchemaProvider = new HoverProvider(
      documentManager,
      {
        graphQL: async () => null,
        filters: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        tags: async () => [],
      },
      new TranslationProvider(new MockFileSystem({})),
    );

    const source = 'query {\n  records {\n    results {\n      name\n    }\n  }\n}';
    const uri = 'file:///app/graphql/test.graphql';
    documentManager.open(uri, source, 0);

    const params: HoverParams = {
      position: { line: 1, character: 5 },
      textDocument: { uri },
    };

    const result = await noSchemaProvider.hover(params);
    expect(result).toBeNull();
  });

  it('should not interfere with .liquid file hover', async () => {
    const source = '{{ product }}';
    const uri = 'file:///app/views/partials/test.liquid';
    documentManager.open(uri, source, 0);

    const textDocument = documentManager.get(uri)!.textDocument;
    const params: HoverParams = {
      position: textDocument.positionAt(source.indexOf('product')),
      textDocument: { uri },
    };

    // Should not crash — goes through normal Liquid pipeline
    const result = await provider.hover(params);
    // product is not in the docset, so hover returns null
    expect(result).toBeNull();
  });
});
