import {
  NodeTypes,
  LiquidHtmlNode,
  HtmlElement,
  HtmlVoidElement,
  LiquidVariableOutput,
  LiquidVariable,
  LiquidVariableLookup,
  LiquidString,
  LiquidFilter,
  AssignMarkup,
  AttrDoubleQuoted,
  AttrSingleQuoted,
  AttrUnquoted,
  TextNode,
} from '@platformos/liquid-html-parser';

/**
 * Shared URL extraction and HTTP method detection helpers
 * for route-aware checks and LSP features.
 *
 * NOTE: These helpers depend on liquid-html-parser AST types, which makes
 * platformos-common depend on the parser. If this dependency becomes
 * problematic, consider moving the AST-aware functions (extractUrlPattern,
 * resolveAssignToUrlPattern, getEffectiveMethod, etc.) to
 * platformos-check-common, keeping only RouteTable/slug logic here.
 */

const SKIP_PREFIXES = ['http://', 'https://', '//', 'mailto:', 'tel:', 'javascript:', 'data:', '#'];

export function shouldSkipUrl(url: string): boolean {
  if (url === '' || url === '#') return true;
  const lower = url.toLowerCase();
  return SKIP_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export type ValuedAttrNode = AttrDoubleQuoted | AttrSingleQuoted | AttrUnquoted;

export function isValuedAttrNode(node: LiquidHtmlNode): node is ValuedAttrNode {
  return (
    node.type === NodeTypes.AttrDoubleQuoted ||
    node.type === NodeTypes.AttrSingleQuoted ||
    node.type === NodeTypes.AttrUnquoted
  );
}

export function getAttrName(attr: ValuedAttrNode): string | null {
  if (attr.name.length !== 1) return null;
  if (attr.name[0].type !== NodeTypes.TextNode) return null;
  return (attr.name[0] as TextNode).value.toLowerCase();
}

export function getStaticAttrValue(attr: ValuedAttrNode): string | null {
  if (attr.value.length !== 1) return null;
  if (attr.value[0].type !== NodeTypes.TextNode) return null;
  return (attr.value[0] as TextNode).value;
}

/**
 * Check if a LiquidVariableOutput node contains exactly `context.location.host`.
 */
function isContextLocationHost(node: LiquidHtmlNode): boolean {
  if (node.type !== NodeTypes.LiquidVariableOutput) return false;
  const { markup } = node as LiquidVariableOutput;
  const raw = typeof markup === 'string' ? markup : markup.rawSource;
  return raw.trim() === 'context.location.host';
}

/**
 * Get the simple variable name from a LiquidVariableOutput node.
 * Returns the name if it's a plain variable lookup (e.g. `{{ url }}`) with no
 * filters or nested lookups. Returns null otherwise.
 */
function getSimpleVariableName(node: LiquidHtmlNode): string | null {
  if (node.type !== NodeTypes.LiquidVariableOutput) return null;
  const { markup } = node as LiquidVariableOutput;
  if (typeof markup === 'string') return null;
  const variable = markup as LiquidVariable;
  if (variable.filters.length > 0) return null;
  if (variable.expression.type !== NodeTypes.VariableLookup) return null;
  const lookup = variable.expression as LiquidVariableLookup;
  if (lookup.name === null || lookup.lookups.length > 0) return null;
  return lookup.name;
}

/**
 * Evaluate a filter argument to either a static string or `:_liquid_` placeholder.
 */
function evaluateFilterArg(filter: LiquidFilter): string | null {
  if (filter.args.length !== 1) return null;
  const arg = filter.args[0];
  if (arg.type === NodeTypes.String) return (arg as LiquidString).value;
  if (arg.type === NodeTypes.VariableLookup) return ':_liquid_';
  return null;
}

/**
 * Resolve an assign markup's RHS to a URL pattern string.
 * Handles string literals with `append` and `prepend` filters.
 * Variable arguments to append/prepend become `:_liquid_` placeholders.
 * Returns null if the value can't be statically resolved to a URL pattern.
 */
export function resolveAssignToUrlPattern(markup: AssignMarkup): string | null {
  if (markup.operator !== '=') return null;
  const value = markup.value;
  if (value.type !== NodeTypes.LiquidVariable) return null;

  const variable = value as LiquidVariable;
  let result: string;

  // Base expression must be a string literal or a variable lookup
  if (variable.expression.type === NodeTypes.String) {
    result = (variable.expression as LiquidString).value;
  } else if (variable.expression.type === NodeTypes.VariableLookup) {
    result = ':_liquid_';
  } else {
    return null;
  }

  // Apply append/prepend filters in order
  for (const filter of variable.filters) {
    const arg = evaluateFilterArg(filter);
    if (arg === null) return null;

    if (filter.name === 'append') {
      result = result + arg;
    } else if (filter.name === 'prepend') {
      result = arg + result;
    } else {
      // Unknown filter — can't determine the result
      return null;
    }
  }

  return normalizeUrlPattern(result);
}

/**
 * Normalize a raw URL string into a matchable URL pattern.
 * Strips query/fragment, validates segments, returns null if not analyzable.
 */
function normalizeUrlPattern(raw: string): string | null {
  let url = raw;

  // Handle self-referencing absolute URLs
  url = url.replace(/^https?:\/\/:_context_host_\//, '/');
  url = url.replace(/^\/\/:_context_host_\//, '/');

  // Must start with / to be a relative URL we can check
  if (!url.startsWith('/')) return null;

  // Strip query string and fragment
  const queryIdx = url.indexOf('?');
  if (queryIdx !== -1) url = url.slice(0, queryIdx);
  const hashIdx = url.indexOf('#');
  if (hashIdx !== -1) url = url.slice(0, hashIdx);

  // If any segment has :_liquid_ mixed with other text, skip
  const segments = url.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s.includes(':_liquid_') && s !== ':_liquid_')) return null;

  return url;
}

/**
 * Extract a URL pattern from an attribute value.
 * Returns null if the URL cannot be analyzed (contains Liquid tags or is fully dynamic).
 *
 * Static text becomes literal path segments.
 * Each {{ expression }} becomes `:_liquid_` (matches one path segment).
 * {{ context.location.host }} is recognized and stripped from absolute self-referencing URLs.
 *
 * When a `variableMap` is provided, a single `{{ varName }}` in the attribute
 * will be resolved through the map (from tracked {% assign %} statements).
 */
export function extractUrlPattern(
  attr: ValuedAttrNode,
  variableMap?: Map<string, string>,
): string | null {
  // Check if the entire attribute is a single variable that we can resolve
  if (variableMap && attr.value.length === 1) {
    const varName = getSimpleVariableName(attr.value[0]);
    if (varName !== null && variableMap.has(varName)) {
      return variableMap.get(varName)!;
    }
  }

  const parts: string[] = [];
  let hasStatic = false;

  for (const node of attr.value) {
    if (node.type === NodeTypes.TextNode) {
      parts.push((node as TextNode).value);
      hasStatic = true;
    } else if (node.type === NodeTypes.LiquidVariableOutput) {
      parts.push(isContextLocationHost(node) ? ':_context_host_' : ':_liquid_');
    } else {
      // Liquid tags — unpredictable structure
      return null;
    }
  }

  // Fully dynamic (no static text at all)
  if (!hasStatic) return null;

  return normalizeUrlPattern(parts.join(''));
}

/**
 * Recursively scan a form subtree for <input type="hidden" name="_method" value="...">
 * Returns the _method value if found, or null.
 */
function findMethodOverride(formNode: HtmlElement): string | null {
  const stack: LiquidHtmlNode[] = [...formNode.children];

  while (stack.length > 0) {
    const child = stack.pop()!;

    if (
      child.type === NodeTypes.HtmlVoidElement &&
      (child as unknown as HtmlVoidElement).name === 'input'
    ) {
      const voidEl = child as unknown as HtmlVoidElement;
      const attrs = (voidEl.attributes as LiquidHtmlNode[]).filter(isValuedAttrNode);
      const typeAttr = attrs.find((a) => getAttrName(a) === 'type');
      const nameAttr = attrs.find((a) => getAttrName(a) === 'name');
      const valueAttr = attrs.find((a) => getAttrName(a) === 'value');

      if (!typeAttr || !nameAttr || !valueAttr) continue;

      const typeVal = getStaticAttrValue(typeAttr);
      const nameVal = getStaticAttrValue(nameAttr);
      if (typeVal?.toLowerCase() !== 'hidden' || nameVal !== '_method') continue;

      const methodVal = getStaticAttrValue(valueAttr);
      if (methodVal) return methodVal.toLowerCase();

      // Liquid value for _method — can't determine method
      return null;
    }

    // Recurse into elements that have children
    if (child.type === NodeTypes.HtmlElement && 'children' in child) {
      const el = child as HtmlElement;
      for (const grandchild of el.children) {
        stack.push(grandchild);
      }
    }
  }

  return null;
}

/**
 * Determine the effective HTTP method for a <form> element,
 * accounting for _method hidden input overrides.
 * Returns null if the method can't be statically determined.
 */
export function getEffectiveMethod(formNode: HtmlElement): string | null {
  const methodAttr = (formNode.attributes as LiquidHtmlNode[]).find(
    (a) => isValuedAttrNode(a) && getAttrName(a) === 'method',
  ) as ValuedAttrNode | undefined;

  let formMethod = 'get';
  if (methodAttr) {
    const val = getStaticAttrValue(methodAttr);
    if (val === null) return null; // Liquid in method attr — skip
    formMethod = val.toLowerCase();
  }

  if (formMethod === 'post') {
    const override = findMethodOverride(formNode);
    if (override !== null) return override;
    return formMethod;
  }

  return formMethod;
}
