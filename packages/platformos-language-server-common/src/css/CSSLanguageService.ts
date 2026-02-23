import { getCSSLanguageService, LanguageService } from 'vscode-css-languageservice';
import {
  HtmlRawNode,
  LiquidHtmlNode,
  NodeTypes,
  RawMarkupKinds,
  walk,
} from '@platformos/liquid-html-parser';
import { isError, SourceCodeType } from '@platformos/platformos-check-common';
import {
  CompletionItem,
  CompletionList,
  CompletionParams,
  Hover,
  HoverParams,
  ClientCapabilities as LSPClientCapabilities,
  Position,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentManager } from '../documents';

export class CSSLanguageService {
  private service: LanguageService | null = null;
  // Standalone .css files — managed independently of DocumentManager
  private cssDocuments: Map<string, TextDocument> = new Map();

  constructor(private documentManager: DocumentManager) {}

  setup(clientCapabilities: LSPClientCapabilities) {
    this.service = getCSSLanguageService({ clientCapabilities });
  }

  open(uri: string, source: string, version: number) {
    this.cssDocuments.set(uri, TextDocument.create(uri, 'css', version, source));
  }

  change(uri: string, source: string, version: number) {
    const existing = this.cssDocuments.get(uri);
    if (existing) {
      this.cssDocuments.set(uri, TextDocument.update(existing, [{ text: source }], version));
    } else {
      this.open(uri, source, version);
    }
  }

  close(uri: string) {
    this.cssDocuments.delete(uri);
  }

  async completions(params: CompletionParams): Promise<CompletionList | CompletionItem[] | null> {
    const service = this.service;
    if (!service) return null;

    const uri = params.textDocument.uri;

    if (uri.endsWith('.css')) {
      const textDoc = this.cssDocuments.get(uri);
      if (!textDoc) return null;
      const stylesheet = service.parseStylesheet(textDoc);
      return service.doComplete(textDoc, params.position, stylesheet);
    }

    const embedded = this.findEmbeddedCSS(uri, params.position);
    if (!embedded) return null;
    const stylesheet = service.parseStylesheet(embedded.virtualDoc);
    return service.doComplete(embedded.virtualDoc, params.position, stylesheet);
  }

  async hover(params: HoverParams): Promise<Hover | null> {
    const service = this.service;
    if (!service) return null;

    const uri = params.textDocument.uri;

    if (uri.endsWith('.css')) {
      const textDoc = this.cssDocuments.get(uri);
      if (!textDoc) return null;
      const stylesheet = service.parseStylesheet(textDoc);
      return service.doHover(textDoc, params.position, stylesheet);
    }

    const embedded = this.findEmbeddedCSS(uri, params.position);
    if (!embedded) return null;
    const stylesheet = service.parseStylesheet(embedded.virtualDoc);
    return service.doHover(embedded.virtualDoc, params.position, stylesheet);
  }

  /**
   * Finds the <style> block under the cursor in a .liquid file and builds a
   * virtual CSS TextDocument whose line numbers align with the parent document.
   *
   * Strategy: prefix body.value with N newlines where N equals the line number
   * of blockStartPosition.end. This keeps line numbers in sync so the same LSP
   * Position can be passed directly to the CSS service.
   *
   * Note: character offsets are only accurate when <style> is on its own line
   * (the typical case). Inline `<style>css</style>` is not handled perfectly.
   */
  private findEmbeddedCSS(uri: string, position: Position): { virtualDoc: TextDocument } | null {
    const document = this.documentManager.get(uri);
    if (!document || document.type !== SourceCodeType.LiquidHtml) return null;
    if (isError(document.ast)) return null;

    const offset = document.textDocument.offsetAt(position);

    let foundNode: HtmlRawNode | null = null;
    walk(document.ast as LiquidHtmlNode, (node) => {
      if (node.type === NodeTypes.HtmlRawNode) {
        const rawNode = node as HtmlRawNode;
        if (
          rawNode.body.kind === RawMarkupKinds.css &&
          rawNode.blockStartPosition.end <= offset &&
          offset <= rawNode.blockEndPosition.start
        ) {
          foundNode = rawNode;
        }
      }
    });

    if (!foundNode) return null;

    const node = foundNode as HtmlRawNode;
    const bodyStartPos = document.textDocument.positionAt(node.blockStartPosition.end);
    const prefix = '\n'.repeat(bodyStartPos.line);
    const virtualDoc = TextDocument.create(uri + '#style', 'css', 0, prefix + node.body.value);

    return { virtualDoc };
  }
}
