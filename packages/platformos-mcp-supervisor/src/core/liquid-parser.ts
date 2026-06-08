/**
 * Liquid template parser façade.
 *
 * Wraps `@platformos/liquid-html-parser` with two project-specific concerns:
 *
 *   1. Tolerant-parse with a `try/catch` so the synchronous validate_code
 *      pipeline can keep going on broken input (the LSP path catches the
 *      syntax error separately).
 *   2. A single-pass AST walk that extracts every structural element the
 *      downstream stages need (renders, graphql calls, filters, tags,
 *      translation keys, doc params, frontmatter slug/layout/method,
 *      `{% doc prompt %}` blocks) into a typed `ExtractedStructural` object.
 *
 * Re-exports `walk`, `NodeTypes`, and `NamedTags` so call sites that need
 * direct AST traversal do not also need to import the underlying parser
 * package.
 */

import {
  toLiquidHtmlAST,
  walk,
  NodeTypes,
  NamedTags,
  type LiquidHtmlNode,
  type RenderMarkup,
  type LiquidNamedArgument,
} from '@platformos/liquid-html-parser';

export { walk, NodeTypes, NamedTags };
export type { LiquidHtmlNode };

// ── Public types ───────────────────────────────────────────────────────────

/** Surface form of a `{% graphql %}` call — see `classifyGraphqlSourceKind`. */
export type GraphqlSourceKind = 'tag' | 'liquid_inline' | 'liquid_multiline_truncated';

export interface GraphqlRef {
  variable: string;
  queryName: string;
  args: string[];
  source_kind: GraphqlSourceKind;
}

export interface RenderCall {
  partial: string;
  args: string[];
}

export interface ExtractedStructural {
  slug: string | null;
  layout: string | null;
  method: string | null;
  renders: string[];
  renderCalls: RenderCall[];
  graphql: GraphqlRef[];
  filters: Set<string>;
  tags: Set<string>;
  transKeys: Set<string>;
  prompts: string[];
  docParams: Set<string>;
}

// ── Parse ─────────────────────────────────────────────────────────────────

/**
 * Parse Liquid content into an AST in tolerant mode.
 *
 * Returns `null` if the parser cannot recover at all. The validator's lint
 * step still gets a chance to surface the syntax error from the LSP path —
 * the parser's silent-`null` here ensures structural extraction does not
 * cascade-fail every other check.
 */
export function parseLiquidFile(content: string): LiquidHtmlNode | null {
  try {
    return toLiquidHtmlAST(content, { mode: 'tolerant', allowUnclosedDocumentNode: true });
  } catch {
    return null;
  }
}

// ── Extract ───────────────────────────────────────────────────────────────

/**
 * Walk an already-parsed AST and extract every structural element in one pass.
 *
 * The AST is walked exactly once. Render calls and GraphQL calls are
 * deduped by name (first call wins) while the GraphQL `source_kind` is
 * upgraded to the most pessimistic value seen across duplicate calls so
 * downstream rules can detect multi-line truncation regardless of which
 * call survived the dedup.
 */
export function extractAllFromAST(ast: LiquidHtmlNode): ExtractedStructural {
  let slug: string | null = null;
  let layout: string | null = null;
  let method: string | null = null;
  const seenRenders = new Set<string>();
  const renders: string[] = [];
  const renderCalls: RenderCall[] = [];
  const seenGQL = new Set<string>();
  const graphql: GraphqlRef[] = [];
  const filters = new Set<string>();
  const tags = new Set<string>();
  const transKeys = new Set<string>();
  const prompts: string[] = [];
  const docParams = new Set<string>();

  walk(ast, (node) => {
    switch (node.type) {
      case NodeTypes.YAMLFrontmatter: {
        const body = node.body;
        const m = body.match(/^slug:\s*(.+)$/m);
        if (m) slug = m[1].trim();
        const lm = body.match(/^layout:\s*(.+)$/m);
        if (lm) {
          // Strip surrounding quotes — layout: "" or layout: '' means "no layout".
          layout = lm[1].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
        const mm = body.match(/^method:\s*(.+)$/m);
        if (mm) method = mm[1].trim();
        break;
      }

      case NodeTypes.LiquidTag: {
        tags.add(node.name);

        if (node.name === NamedTags.render || node.name === NamedTags.include) {
          collectRender(node.markup, seenRenders, renders, renderCalls, transKeys);
        } else if (node.name === NamedTags.graphql) {
          const markup = node.markup;
          // `markup` may be `string` for `LiquidTagBaseCase` (mid-completion
          // or unparseable). Only the typed `GraphQLMarkup` variant carries
          // the structured `graphql` / `name` / `args` fields we need.
          if (typeof markup !== 'string' && markup.type === NodeTypes.GraphQLMarkup) {
            const gqlPath = markup.graphql;
            if (gqlPath.type === NodeTypes.String) {
              const queryName = gqlPath.value;
              const sourceKind = classifyGraphqlSourceKind(node);
              if (seenGQL.has(queryName)) {
                // Same op called twice. Keep the first entry but upgrade
                // `source_kind` to the most pessimistic value across calls
                // so downstream rules can detect truncation regardless of
                // which call won the dedup.
                if (sourceKind === 'liquid_multiline_truncated') {
                  const existing = graphql.find((g) => g.queryName === queryName);
                  if (existing) existing.source_kind = 'liquid_multiline_truncated';
                }
              } else {
                seenGQL.add(queryName);
                graphql.push({
                  variable: markup.name,
                  queryName,
                  args: extractNamedArgs(markup.args),
                  source_kind: sourceKind,
                });
              }
            }
          }
        }
        break;
      }

      case NodeTypes.LiquidRawTag: {
        tags.add(node.name);
        break;
      }

      case NodeTypes.LiquidFilter: {
        filters.add(node.name);
        break;
      }

      case NodeTypes.LiquidVariable: {
        const hasT = node.filters?.some((f) => f.name === 't');
        if (hasT && node.expression?.type === NodeTypes.String) {
          transKeys.add(node.expression.value);
        }
        break;
      }

      case NodeTypes.LiquidDocPromptNode: {
        prompts.push(node.content.value);
        break;
      }

      case NodeTypes.LiquidDocParamNode: {
        const paramName = node.paramName?.value;
        if (paramName) docParams.add(paramName);
        break;
      }
    }
  });

  return {
    slug,
    layout,
    method,
    renders,
    renderCalls,
    graphql,
    filters,
    tags,
    transKeys,
    prompts,
    docParams,
  };
}

// ── Render / include extraction ───────────────────────────────────────────

/**
 * The `LiquidTag` union covers both `LiquidTagRender`/`LiquidTagInclude`
 * (markup typed as `RenderMarkup`) and the generic base case (markup typed
 * as `string` — happens when the parser cannot fully resolve the call,
 * e.g., mid-completion). We accept either form: the string form is parsed
 * with a regex; the object form reads the typed `partial` field.
 */
function collectRender(
  markup: RenderMarkup | string,
  seenRenders: Set<string>,
  renders: string[],
  renderCalls: RenderCall[],
  transKeys: Set<string>,
): void {
  if (typeof markup === 'string') {
    const partialMatch = markup.match(/^["']([^"']+)['"]/);
    if (partialMatch) {
      const partialName = partialMatch[1];
      if (!seenRenders.has(partialName)) {
        seenRenders.add(partialName);
        renders.push(partialName);
      }
      renderCalls.push({ partial: partialName, args: extractArgsFromMarkupString(markup) });
    }
    // Inline `'key' | t` translation references — captured even when the
    // call itself is unparseable, because the keys still exist in source.
    for (const km of markup.matchAll(/["']([^"']+)['"]\s*\|\s*t\b/g)) {
      transKeys.add(km[1]);
    }
    return;
  }

  const partial = markup.partial;
  if (partial.type === NodeTypes.String) {
    const partialName = partial.value;
    if (!seenRenders.has(partialName)) {
      seenRenders.add(partialName);
      renders.push(partialName);
    }
    renderCalls.push({ partial: partialName, args: extractNamedArgs(markup.args) });
  }
}

/**
 * Classify the surface form of a `{% graphql %}` call.
 *
 *   `'tag'`                        — `{% graphql … %}` (with delimiters).
 *   `'liquid_inline'`              — inside a `{% liquid %}` block, single-line.
 *   `'liquid_multiline_truncated'` — inside a `{% liquid %}` block, written
 *                                    with a `,` + newline continuation. The
 *                                    parser truncates the call at the first
 *                                    newline-comma, so `markup.args` silently
 *                                    drops every argument past that point —
 *                                    and pos-cli's LSP has the same blind
 *                                    spot. The agent sees the args in source;
 *                                    both parsers don't.
 *
 * Detection criterion for the truncated form: visible source text ends on
 * a comma AND the immediately trailing characters contain another `name:`
 * clause on a subsequent line. The trailing-text check is load-bearing —
 * without it, a legitimate inline call that just happens to end on a
 * comma (rare, but possible) would be misclassified.
 */
export function classifyGraphqlSourceKind(node: LiquidHtmlNode): GraphqlSourceKind {
  const src = typeof node.source === 'string' ? node.source : '';
  const start = node.position?.start ?? 0;
  const end = node.position?.end ?? 0;
  const text = src.slice(start, end);
  if (text.startsWith('{%')) return 'tag';
  if (text.trimEnd().endsWith(',')) {
    const trail = src.slice(end, end + 200);
    if (/\n\s*[A-Za-z_]\w*\s*:/.test(trail)) return 'liquid_multiline_truncated';
  }
  return 'liquid_inline';
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractNamedArgs(args: ReadonlyArray<LiquidNamedArgument> | undefined): string[] {
  if (!args) return [];
  const names: string[] = [];
  for (const a of args) {
    if (a.type === NodeTypes.NamedArgument && typeof a.name === 'string') {
      names.push(a.name);
    }
  }
  return names;
}

function extractArgsFromMarkupString(markupStr: string): string[] {
  const args: string[] = [];
  const afterPartial = markupStr.replace(/^["'][^"']+["']\s*,?\s*/, '');
  for (const m of afterPartial.matchAll(/(\w+)\s*:/g)) {
    args.push(m[1]);
  }
  return args;
}
