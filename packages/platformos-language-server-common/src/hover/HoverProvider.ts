import {
  GetDocDefinitionForURI,
  SourceCodeType,
  PlatformOSDocset,
} from '@platformos/platformos-check-common';
import { Hover, HoverParams } from 'vscode-languageserver';
import { TypeSystem } from '../TypeSystem';
import { DocumentManager } from '../documents';
import { GetTranslationsForURI } from '../translations';
import { BaseHoverProvider } from './BaseHoverProvider';
import {
  HtmlAttributeHoverProvider,
  HtmlTagHoverProvider,
  LiquidFilterArgumentHoverProvider,
  LiquidFilterHoverProvider,
  LiquidObjectAttributeHoverProvider,
  LiquidObjectHoverProvider,
  LiquidTagHoverProvider,
  TranslationHoverProvider,
  RenderPartialHoverProvider,
  RenderPartialParameterHoverProvider,
} from './providers';
import { HtmlAttributeValueHoverProvider } from './providers/HtmlAttributeValueHoverProvider';
import { findCurrentNode } from '@platformos/platformos-check-common';
import { LiquidDocTagHoverProvider } from './providers/LiquidDocTagHoverProvider';
import { GraphQLFieldHoverProvider } from './providers/GraphQLFieldHoverProvider';
import { TranslationProvider } from '@platformos/platformos-common';
import { FindAppRootURI } from '../../src/internal-types';
export class HoverProvider {
  private providers: BaseHoverProvider[] = [];
  private graphqlFieldHoverProvider: GraphQLFieldHoverProvider;

  constructor(
    readonly documentManager: DocumentManager,
    readonly platformosDocset: PlatformOSDocset,
    readonly translationProvider: TranslationProvider,
    readonly getTranslationsForURI: GetTranslationsForURI = async () => ({}),
    readonly getDocDefinitionForURI: GetDocDefinitionForURI = async () => undefined,
    readonly findAppRootURI: FindAppRootURI = async () => null,
  ) {
    const typeSystem = new TypeSystem(platformosDocset);
    this.graphqlFieldHoverProvider = new GraphQLFieldHoverProvider(
      platformosDocset,
      documentManager,
    );
    this.providers = [
      new LiquidTagHoverProvider(platformosDocset),
      new LiquidFilterArgumentHoverProvider(platformosDocset),
      new LiquidFilterHoverProvider(platformosDocset),
      new LiquidObjectHoverProvider(typeSystem),
      new LiquidObjectAttributeHoverProvider(typeSystem),
      new HtmlTagHoverProvider(),
      new HtmlAttributeHoverProvider(),
      new HtmlAttributeValueHoverProvider(),
      new TranslationHoverProvider(documentManager, translationProvider, findAppRootURI),
      new RenderPartialHoverProvider(getDocDefinitionForURI),
      new RenderPartialParameterHoverProvider(getDocDefinitionForURI),
      new LiquidDocTagHoverProvider(documentManager),
    ];
  }

  async hover(params: HoverParams): Promise<Hover | null> {
    const uri = params.textDocument.uri;
    const document = this.documentManager.get(uri);

    // GraphQL files get dedicated hover support
    if (document?.type === SourceCodeType.GraphQL) {
      return this.graphqlFieldHoverProvider.hover(params);
    }

    // Supports only Liquid resources
    if (document?.type !== SourceCodeType.LiquidHtml || document.ast instanceof Error) {
      return null;
    }

    const [currentNode, ancestors] = findCurrentNode(
      document.ast,
      document.textDocument.offsetAt(params.position),
    );

    const promises = this.providers.map((p) => p.hover(currentNode, ancestors, params));
    const results = await Promise.all(promises);
    return results.find(Boolean) ?? null;
  }
}
