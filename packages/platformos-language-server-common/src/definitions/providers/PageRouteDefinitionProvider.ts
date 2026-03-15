import { LiquidHtmlNode, HtmlElement, NodeTypes, TextNode } from '@platformos/liquid-html-parser';
import { RouteTable, AbstractFileSystem } from '@platformos/platformos-common';
import {
  SourceCodeType,
  shouldSkipUrl,
  isValuedAttrNode,
  getAttrName,
  extractUrlPattern,
  getEffectiveMethod,
  buildVariableMap,
  ValuedAttrNode,
} from '@platformos/platformos-check-common';
import { URI } from 'vscode-uri';
import {
  DefinitionParams,
  DefinitionLink,
  Range,
  LocationLink,
} from 'vscode-languageserver-protocol';
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
function findUrlAttr(el: HtmlElement, tagName: string): ValuedAttrNode | null {
  const urlAttrName = TAG_URL_ATTR[tagName];
  if (!urlAttrName) return null;
  const attr = (el.attributes as LiquidHtmlNode[]).find(
    (a) => isValuedAttrNode(a) && getAttrName(a) === urlAttrName,
  );
  if (!attr || !isValuedAttrNode(attr)) return null;
  return attr;
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

  /** Returns the shared route table (may trigger a build if not yet built). */
  getRouteTable(): RouteTable {
    return this.routeTable;
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

  /**
   * Invalidate the cached build state so the next definition request triggers
   * a full route-table rebuild. Call this after bulk file changes that bypass
   * incremental updates (e.g., git checkout, branch switch, stash pop).
   */
  invalidate(): void {
    this.builtRoots.clear();
    this.routeTable = new RouteTable(this.fs);
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

    // Build a variable map from {% assign %} tags that precede the current element.
    // This ensures that when a variable is reassigned, each usage sees only the
    // assigns that come before it in document order.
    let variableMap: Map<string, string> | undefined;
    if (
      sourceCode.type === SourceCodeType.LiquidHtml &&
      !(sourceCode.ast instanceof Error) &&
      'children' in sourceCode.ast &&
      Array.isArray(sourceCode.ast.children)
    ) {
      variableMap = buildVariableMap(sourceCode.ast.children, element.position.start);
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
   * Activates when cursor is on:
   * - The tag name (e.g. `a` in `<a href="...">`)
   * - The URL-bearing attribute name or value (e.g. `href` or `/about` for <a>, `action` for <form>)
   * - Inside a Liquid expression within the URL attribute (e.g. `{{ url }}` inside href)
   * Does NOT activate on unrelated attributes (e.g. `class` in `<a class="x" href="/about">`).
   */
  private resolveUrlContext(
    node: LiquidHtmlNode,
    ancestors: LiquidHtmlNode[],
  ): { urlAttr: ValuedAttrNode; method: string; element: HtmlElement } | null {
    // Case 1: node is the HtmlElement itself (cursor on tag name)
    if (node.type === NodeTypes.HtmlElement) {
      return this.resolveFromElement(node as HtmlElement);
    }

    // Case 2: node is a valued attribute — only activate if it's the URL attribute
    if (isValuedAttrNode(node)) {
      const element = this.findElementAncestor(ancestors);
      if (!element) return null;
      return this.resolveFromUrlAttr(node, element as HtmlElement);
    }

    // Case 3: node is inside a valued attribute (TextNode, LiquidVariableOutput, VariableLookup, etc.)
    const attrAncestor = ancestors.find(isValuedAttrNode);
    if (attrAncestor) {
      const element = this.findElementAncestor(ancestors);
      if (!element) return null;
      return this.resolveFromUrlAttr(attrAncestor, element as HtmlElement);
    }

    // Case 4: TextNode directly under HtmlElement (e.g., tag name text)
    if (node.type === NodeTypes.TextNode) {
      const parentElement = ancestors[ancestors.length - 1];
      if (parentElement && parentElement.type === NodeTypes.HtmlElement) {
        return this.resolveFromElement(parentElement as HtmlElement);
      }
    }

    return null;
  }

  /**
   * Only resolve if the given attribute is the URL-bearing attribute (href/action)
   * for the parent element.
   */
  private resolveFromUrlAttr(
    attr: ValuedAttrNode,
    element: HtmlElement,
  ): { urlAttr: ValuedAttrNode; method: string; element: HtmlElement } | null {
    const tagName = getTagName(element);
    if (!tagName) return null;

    const urlAttrName = TAG_URL_ATTR[tagName];
    if (!urlAttrName) return null;

    // Check that the cursor's attribute IS the URL attribute
    const attrName = getAttrName(attr);
    if (attrName !== urlAttrName) return null;

    const method = this.getMethodForElement(tagName, element);
    if (!method) return null;

    return { urlAttr: attr, method, element };
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
