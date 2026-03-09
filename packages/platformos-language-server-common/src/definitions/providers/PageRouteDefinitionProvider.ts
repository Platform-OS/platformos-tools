import {
  LiquidHtmlNode,
  HtmlElement,
  NodeTypes,
  TextNode,
  LiquidTag,
  LiquidTagAssign,
  AssignMarkup,
  NamedTags,
} from '@platformos/liquid-html-parser';
import {
  RouteTable,
  AbstractFileSystem,
  shouldSkipUrl,
  isValuedAttrNode,
  getAttrName,
  extractUrlPattern,
  getEffectiveMethod,
  resolveAssignToUrlPattern,
  ValuedAttrNode,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import {
  DefinitionParams,
  DefinitionLink,
  Range,
  LocationLink,
} from 'vscode-languageserver-protocol';
import { SourceCodeType } from '@platformos/platformos-check-common';
import { DocumentManager } from '../../documents';
import { BaseDefinitionProvider } from '../BaseDefinitionProvider';

function getTagName(node: LiquidHtmlNode): string | null {
  if (node.type !== NodeTypes.HtmlElement) return null;
  const el = node as HtmlElement;
  if (el.name.length !== 1) return null;
  if ((el.name[0] as LiquidHtmlNode).type !== NodeTypes.TextNode) return null;
  return (el.name[0] as TextNode).value;
}

/** Tag name → attribute that holds the URL */
const TAG_URL_ATTR: Record<string, string> = {
  a: 'href',
  form: 'action',
};

/**
 * Find the URL-bearing attribute on an element.
 * For <a> looks for href, for <form> looks for action.
 */
function findUrlAttr(
  el: HtmlElement,
  tagName: string,
): ValuedAttrNode | null {
  const urlAttrName = TAG_URL_ATTR[tagName];
  if (!urlAttrName) return null;
  const attr = (el.attributes as LiquidHtmlNode[]).find(
    (a) => isValuedAttrNode(a) && getAttrName(a) === urlAttrName,
  );
  if (!attr || !isValuedAttrNode(attr)) return null;
  return attr;
}

/**
 * Walk an AST and collect {% assign %} variable mappings that resolve to URL patterns.
 * Same logic as the MissingPage lint check, but applied to the current document's AST
 * so that `<a href="{{ url }}">` can be resolved when `url` was assigned earlier.
 */
function buildVariableMap(children: LiquidHtmlNode[]): Map<string, string> {
  const variableMap = new Map<string, string>();
  const stack: LiquidHtmlNode[] = [...children];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (
      node.type === NodeTypes.LiquidTag &&
      (node as LiquidTag).name === NamedTags.assign
    ) {
      const markup = (node as LiquidTagAssign).markup as AssignMarkup;
      if (markup.lookups.length > 0) continue;

      const urlPattern = resolveAssignToUrlPattern(markup);
      if (urlPattern !== null) {
        variableMap.set(markup.name, urlPattern);
      }
    }

    // Recurse into children
    if ('children' in node && Array.isArray((node as any).children)) {
      for (const child of (node as any).children) {
        stack.push(child);
      }
    }
  }

  return variableMap;
}

export class PageRouteDefinitionProvider implements BaseDefinitionProvider {
  private routeTable: RouteTable;
  private builtRoots = new Set<string>();

  constructor(
    private documentManager: DocumentManager,
    private fs: AbstractFileSystem,
    private findAppRootURI: (uri: string) => Promise<string | null>,
  ) {
    this.routeTable = new RouteTable(fs);
  }

  private async ensureBuilt(uri: string): Promise<boolean> {
    const rootUri = await this.findAppRootURI(uri);
    if (!rootUri) return false;

    if (!this.builtRoots.has(rootUri)) {
      await this.routeTable.build(URI.parse(rootUri));
      this.builtRoots.add(rootUri);
    }
    return true;
  }

  /**
   * Called by the LSP when a page file changes on disk or in the editor.
   * Keeps the route table in sync without a full rebuild.
   * Callers are responsible for filtering to page URIs via isPage().
   */
  onPageFileChanged(uri: string, content: string): void {
    this.routeTable.updateFile(uri, content);
  }

  /**
   * Called by the LSP when a page file is deleted.
   * Callers are responsible for filtering to page URIs via isPage().
   */
  onPageFileDeleted(uri: string): void {
    this.routeTable.removeFile(uri);
  }

  async definitions(
    params: DefinitionParams,
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
  ): Promise<DefinitionLink[]> {
    const sourceCode = this.documentManager.get(params.textDocument.uri);
    if (!sourceCode) return [];
    const doc = sourceCode.textDocument;

    const resolved = this.resolveUrlContext(node, ancestors);
    if (!resolved) return [];

    const { urlAttr, method, element } = resolved;

    // Build a variable map from {% assign %} tags in the document
    let variableMap: Map<string, string> | undefined;
    if (
      sourceCode.type === SourceCodeType.LiquidHtml &&
      !(sourceCode.ast instanceof Error) &&
      'children' in sourceCode.ast &&
      Array.isArray(sourceCode.ast.children)
    ) {
      variableMap = buildVariableMap(sourceCode.ast.children);
    }

    const urlPattern = extractUrlPattern(urlAttr, variableMap);
    if (urlPattern === null || shouldSkipUrl(urlPattern)) return [];

    const ready = await this.ensureBuilt(params.textDocument.uri);
    if (!ready) return [];

    const matches = this.routeTable.match(urlPattern, method);
    if (matches.length === 0) return [];

    const originRange = Range.create(
      doc.positionAt(element.position.start),
      doc.positionAt(urlAttr.value[urlAttr.value.length - 1].position.end),
    );

    const results: DefinitionLink[] = [];
    for (const entry of matches) {
      const targetRange = Range.create(0, 0, 0, 0);
      results.push(LocationLink.create(entry.uri, targetRange, targetRange, originRange));
    }

    return results;
  }

  /**
   * Resolve the URL context from the cursor position.
   * Works when cursor is on:
   * - The tag name (e.g. `a` in `<a href="...">`)
   * - The attribute name or value (e.g. `href` or `/about`)
   * - Any other attribute on the element (e.g. `class` in `<a class="x" href="/about">`)
   * - The attribute quote boundary or element boundary
   */
  private resolveUrlContext(
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
  ): { urlAttr: ValuedAttrNode; method: string; element: HtmlElement } | null {
    // Case 1: node is the HtmlElement itself (cursor on tag name or attr boundary)
    if (node.type === NodeTypes.HtmlElement) {
      return this.resolveFromElement(node as HtmlElement);
    }

    // Case 2: node is a valued attribute (cursor on quote char or attr boundary)
    if (isValuedAttrNode(node)) {
      const element = this.findElementAncestor(ancestors);
      if (!element) return null;
      return this.resolveFromElement(element as HtmlElement);
    }

    // Case 3: node is a LiquidVariableOutput (cursor on {{ var }} inside an attribute)
    if (node.type === NodeTypes.LiquidVariableOutput) {
      const attrAncestor = ancestors.find(isValuedAttrNode);
      if (attrAncestor) {
        const element = this.findElementAncestor(ancestors);
        if (!element) return null;
        return this.resolveFromElement(element as HtmlElement);
      }
    }

    // Case 4: node is a TextNode
    if (node.type === NodeTypes.TextNode) {
      // Check if we're inside an attribute (name or value TextNode)
      const attrAncestor = ancestors.find(isValuedAttrNode);
      if (attrAncestor) {
        const element = this.findElementAncestor(ancestors);
        if (!element) return null;
        return this.resolveFromElement(element as HtmlElement);
      }

      // TextNode directly under HtmlElement (e.g., tag name text or space after tag name)
      const parentElement = ancestors[ancestors.length - 1];
      if (parentElement && parentElement.type === NodeTypes.HtmlElement) {
        return this.resolveFromElement(parentElement as HtmlElement);
      }
    }

    // Case 5: node is inside a Liquid expression (e.g. VariableLookup inside {{ url }})
    // Walk ancestors to find if we're inside an attribute of an <a> or <form>
    const attrAncestor = ancestors.find(isValuedAttrNode);
    if (attrAncestor) {
      const element = this.findElementAncestor(ancestors);
      if (element) {
        return this.resolveFromElement(element as HtmlElement);
      }
    }

    return null;
  }

  private resolveFromElement(
    element: HtmlElement,
  ): { urlAttr: ValuedAttrNode; method: string; element: HtmlElement } | null {
    const tagName = getTagName(element);
    if (!tagName) return null;

    const urlAttr = findUrlAttr(element, tagName);
    if (!urlAttr) return null;

    const method = this.getMethodForElement(tagName, element);
    if (!method) return null;

    return { urlAttr, method, element };
  }

  private findElementAncestor(ancestors: LiquidHtmlNode[]): LiquidHtmlNode | null {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      if (ancestors[i].type === NodeTypes.HtmlElement) return ancestors[i];
    }
    return null;
  }

  private getMethodForElement(tagName: string, element: HtmlElement): string | null {
    if (tagName === 'a') return 'get';
    if (tagName === 'form') return getEffectiveMethod(element);
    return null;
  }
}
