import {
  IsValidSchema,
  JsonValidationSet,
  SchemaDefinition,
  SourceCodeType,
} from '@platformos/platformos-check-common';
import { JSONDocument, LanguageService, getLanguageService } from 'vscode-json-languageservice';
import {
  CompletionItem,
  CompletionList,
  CompletionParams,
  DocumentLink,
  DocumentLinkParams,
  Hover,
  HoverParams,
  ClientCapabilities as LSPClientCapabilities,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentManager } from '../documents';
import { JSONContributions } from './JSONContributions';

export class JSONLanguageService {
  private service: LanguageService | null = null;

  // One record for all schemas since collisions on URIs should point to the same schema
  private schemas: Record<string, SchemaDefinition>;

  // Setup state
  public initialized: Promise<void>;
  private initialize: () => void = () => {};

  constructor(
    private documentManager: DocumentManager,
    private jsonValidationSet: JsonValidationSet,
  ) {
    this.schemas = {};
    this.initialized = new Promise((resolve) => {
      this.initialize = resolve;
    });
  }

  async setup(clientCapabilities: LSPClientCapabilities) {
    const schemas = await this.jsonValidationSet.schemas();
    for (const schema of schemas) {
      this.schemas[schema.uri] = schema;
    }

    if (schemas.length) {
      const service = getLanguageService({
        clientCapabilities,

        // Map URIs to schemas without making network requests. Removes the
        // network dependency.
        schemaRequestService: this.getSchemaForURI.bind(this),

        // This is how we make sure that our "$ref": "./inputSettings.json" in
        // our JSON schemas resolve correctly.
        workspaceContext: {
          resolveRelativePath: (relativePath, resource) => {
            const url = new URL(relativePath, resource);
            return url.toString();
          },
        },

        contributions: [new JSONContributions(this.documentManager)],
      });

      service.configure({
        // This is what we use to map file names to JSON schemas. Without
        // this, we'd need folks to use the `$schema` field in their JSON
        // blobs. That ain't fun nor is going to happen.
        schemas: schemas.map((schemaDefinition) => ({
          uri: schemaDefinition.uri,
          fileMatch: schemaDefinition.fileMatch,
        })),
      });

      this.service = service;
    }

    this.initialize();
  }

  async completions(params: CompletionParams): Promise<null | CompletionList | CompletionItem[]> {
    await this.initialized;
    const service = this.service;
    if (!service) return null;
    const documents = this.getDocuments(params, service);
    if (!documents) return null;
    const [jsonTextDocument, jsonDocument] = documents;
    return service.doComplete(jsonTextDocument, params.position, jsonDocument);
  }

  async hover(params: HoverParams): Promise<Hover | null> {
    await this.initialized;
    const service = this.service;
    if (!service) return null;
    const documents = this.getDocuments(params, service);
    if (!documents) return null;
    const [jsonTextDocument, jsonDocument] = documents;
    return service.doHover(jsonTextDocument, params.position, jsonDocument);
  }

  async documentLinks(_params: DocumentLinkParams): Promise<DocumentLink[]> {
    return [];
  }

  public isValidSchema: IsValidSchema = async (uri: string, jsonString: string) => {
    await this.initialized;
    const service = this.service;
    if (!service) return false;
    return isValid(service, uri, jsonString);
  };

  private getDocuments(
    params: HoverParams | CompletionParams,
    service: LanguageService,
  ): [TextDocument, JSONDocument] | null {
    const document = this.documentManager.get(params.textDocument.uri);
    if (!document) return null;

    switch (document.type) {
      case SourceCodeType.GraphQL:
      case SourceCodeType.LiquidHtml:
      case SourceCodeType.YAML:
        return null;
      case SourceCodeType.JSON: {
        const jsonTextDocument = document.textDocument;
        const jsonDocument = service.parseJSONDocument(jsonTextDocument);
        return [jsonTextDocument, jsonDocument];
      }
    }
  }

  private async getSchemaForURI(uri: string): Promise<string> {
    const schema = this.schemas[uri]?.schema;
    if (!schema) return `Could not get schema for '${uri}'`;
    return schema;
  }
}

/**
 * Whether `jsonString` validates against the schemas `service` was configured with.
 *
 * Lived in check-common beside a `JSONValidator` class that the check engine used to
 * build per run. Nothing checks a JSON file any more — `sourceCodeTypeOf` has no
 * `.json` row, so no `AppFile` is ever JSON — and this function never needed the class
 * regardless: it takes the `LanguageService` its caller already owns. It is here
 * because the language server is the only thing that asks the question.
 */
async function isValid(
  service: LanguageService,
  uri: string,
  jsonString: string,
): Promise<boolean> {
  const jsonTextDocument = TextDocument.create(uri, 'json', 0, jsonString);
  const jsonDocument = service.parseJSONDocument(jsonTextDocument);
  const diagnostics = await service.doValidation(jsonTextDocument, jsonDocument, {
    schemaValidation: 'error',
    trailingCommas: 'ignore',
    comments: 'ignore',
  });
  return diagnostics.every((diagnostic) => diagnostic.severity !== 1);
}
