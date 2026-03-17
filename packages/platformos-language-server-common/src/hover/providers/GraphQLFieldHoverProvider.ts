import { Hover, HoverParams } from 'vscode-languageserver';
import { DocumentManager } from '../../documents';
import { PlatformOSDocset } from '@platformos/platformos-check-common';

/**
 * graphql-language-service and graphql must be loaded dynamically to avoid
 * the "Cannot use GraphQLList from another module or realm" error that occurs
 * when vitest transforms the graphql ESM module into separate instances.
 * By requiring at runtime, we ensure a single shared module instance.
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

export class GraphQLFieldHoverProvider {
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

  async hover(params: HoverParams): Promise<Hover | null> {
    const uri = params.textDocument.uri;
    const document = this.documentManager.get(uri);
    if (!document) return null;

    const schema = await this.getSchema();
    if (!schema) return null;

    const content = document.textDocument.getText();
    const gls = getGLS();

    // graphql-language-service's getHoverInformation uses the character *before* the cursor
    // position to identify the token. We try offset +1 first, then the original position,
    // to handle the case where the cursor is at the start of a token.
    const positions = [
      new gls.Position(params.position.line, params.position.character + 1),
      new gls.Position(params.position.line, params.position.character),
    ];

    try {
      let hoverInfo: string | undefined;
      for (const position of positions) {
        const info = gls.getHoverInformation(schema, content, position);
        if (info && info !== '' && info !== 'null') {
          hoverInfo = typeof info === 'string' ? info : String(info);
          break;
        }
      }

      if (!hoverInfo) {
        return null;
      }

      return {
        contents: {
          kind: 'markdown',
          value: hoverInfo,
        },
      };
    } catch {
      return null;
    }
  }
}
