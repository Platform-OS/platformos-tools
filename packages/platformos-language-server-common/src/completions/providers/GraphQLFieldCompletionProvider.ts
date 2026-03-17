import { CompletionItem, CompletionItemKind, CompletionParams } from 'vscode-languageserver';
import { DocumentManager } from '../../documents';
import { PlatformOSDocset } from '@platformos/platformos-check-common';

/**
 * graphql-language-service and graphql must be loaded dynamically to avoid
 * the "Cannot use GraphQLList from another module or realm" error that occurs
 * when vitest transforms the graphql ESM module into separate instances.
 */
let _glsMod: typeof import('graphql-language-service') | undefined;
function getGLS(): typeof import('graphql-language-service') {
  if (!_glsMod) _glsMod = require('graphql-language-service');
  return _glsMod!;
}

let _graphqlMod: typeof import('graphql') | undefined;
function getGraphQL(): typeof import('graphql') {
  if (!_graphqlMod) _graphqlMod = require('graphql');
  return _graphqlMod!;
}

export class GraphQLFieldCompletionProvider {
  private schemaCache: any;
  private schemaLoaded = false;

  constructor(
    private platformosDocset: PlatformOSDocset,
    private documentManager: DocumentManager,
  ) {}

  private async getSchema(): Promise<any> {
    if (!this.schemaLoaded) {
      const sdl = await this.platformosDocset.graphQL();
      if (sdl) {
        try {
          this.schemaCache = getGraphQL().buildSchema(sdl);
        } catch {
          // Invalid schema SDL
        }
      }
      this.schemaLoaded = true;
    }
    return this.schemaCache;
  }

  async completions(params: CompletionParams): Promise<CompletionItem[]> {
    const uri = params.textDocument.uri;
    const document = this.documentManager.get(uri);
    if (!document) return [];

    const schema = await this.getSchema();
    if (!schema) return [];

    const content = document.textDocument.getText();
    const gls = getGLS();
    const position = new gls.Position(params.position.line, params.position.character);

    try {
      const suggestions = gls.getAutocompleteSuggestions(schema, content, position);

      return suggestions.map((suggestion) => ({
        label: suggestion.label,
        kind: toCompletionItemKind(suggestion.kind),
        detail: suggestion.detail ?? undefined,
        documentation: suggestion.documentation ?? undefined,
      }));
    } catch {
      return [];
    }
  }
}

function toCompletionItemKind(kind: number | undefined): CompletionItemKind {
  if (kind !== undefined && kind >= 1 && kind <= 25) {
    return kind as CompletionItemKind;
  }
  return CompletionItemKind.Field;
}
