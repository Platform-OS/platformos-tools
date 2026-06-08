/**
 * Fix generator — produces concrete, actionable fixes for linter diagnostics.
 *
 * Fix kinds (discriminated `Fix` union):
 *   text_edit       — exact range + replacement text (variable / filter rename)
 *   insert          — insert text at a position (`{% doc %}` block, etc.)
 *   create_file     — create a missing file (`MissingPartial`, layout)
 *   guidance        — description only, no exact edit (complex cases)
 *   add_doc_param   — internal placeholder; merged into one `insert` per call
 *
 * Rule-id stamping: every generated fix is tagged
 * `heuristic:<Check>.<fix_type>` so the rule-performance attribution layer
 * can distinguish heuristic-generated edits from rule-engine edits.
 *
 * v1 trim: `ctx.schemaIndex` is no longer accepted (SchemaIndex dropped in
 * P7; no fix function consumed it).
 */

import { walk, NodeTypes, type LiquidHtmlNode } from '@platformos/liquid-html-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { extractParams } from './diagnostic-record';
import { isShopifyObject, isShopifyFilter } from './knowledge-loader';
import { offsetToLineCol, lineColToOffset, slugFromPath, type LineCol } from './position-utils';
import { POSITION_FUZZY_TOLERANCE } from './constants';
import type { ObjectsIndex } from './objects-index';
import type { FiltersIndex } from './filters-index';
import type { TagsIndex } from './tags-index';

// ── Public types ───────────────────────────────────────────────────────────

export interface FixRange {
  start: LineCol;
  end: LineCol;
}

export interface FixContext {
  before: string;
  after: string;
  line: number;
}

export interface BaseFix {
  rule_id?: string;
  description: string;
  context?: FixContext;
  /** Marker used to identify the generic MissingDocBlock insert at merge time. */
  _source?: string;
  /** add_doc_param merge surface — present on the merged `insert` fix. */
  resolves_params?: string[];
  /** Other rule-emitted ad-hoc fields tolerated at the type level. */
  [key: string]: unknown;
}

export interface TextEditFix extends BaseFix {
  type: 'text_edit';
  range: FixRange;
  new_text: string;
}

export interface InsertFix extends BaseFix {
  type: 'insert';
  range: FixRange;
  new_text: string;
}

export interface CreateFileFix extends BaseFix {
  type: 'create_file';
  path: string;
  scaffold?: string | null;
}

export interface GuidanceFix extends BaseFix {
  type: 'guidance';
}

export interface AddDocParamFix extends BaseFix {
  type: 'add_doc_param';
  param_name: string;
}

export type Fix = TextEditFix | InsertFix | CreateFileFix | GuidanceFix | AddDocParamFix;

export interface FixIndexes {
  objectsIndex?: ObjectsIndex;
  filtersIndex?: FiltersIndex;
  tagsIndex?: TagsIndex;
}

export interface FixDiagnostic {
  check: string;
  severity?: 'error' | 'warning' | 'info';
  message?: string;
  line?: number;
  column?: number;
  endLine?: number | null;
  endColumn?: number | null;
  suggestion?: string;
  /** Bag of ad-hoc fields the enricher / pipeline attached. */
  [key: string]: unknown;
}

export interface GenerateFixesResult {
  proposedFixes: Fix[];
  diagnosticFixes: Map<number, Fix>;
}

export interface ScopeVariable {
  name: string;
  source: string;
}

interface IndexedVariable {
  name: string;
  start: LineCol;
  end: LineCol;
  offset: number;
}

interface IndexedFilter {
  name: string;
  start: LineCol;
  end: LineCol;
}

// ── Cluster + Scorecard types ──────────────────────────────────────────────

export interface ClusterItem {
  line?: number;
  column?: number;
  message?: string;
  fix?: Fix;
}

export interface DiagnosticCluster {
  check: string;
  count: number;
  pattern: string;
  unified_fix: string | null;
  items: ClusterItem[];
}

export interface StructuralLike {
  graphql_queries?: unknown[];
  renders?: unknown[];
  filters_used?: unknown[];
  tags_used?: string[];
  translation_keys?: unknown[];
  prompts?: string[];
}

export interface ScorecardNote {
  level: 'advisory' | 'warning' | 'error';
  message: string;
}

// ── AST helpers ────────────────────────────────────────────────────────────

interface PositionedNode {
  position?: { start: number; end: number };
}

function indexVariables(ast: LiquidHtmlNode, content: string): IndexedVariable[] {
  const vars: IndexedVariable[] = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.VariableLookup) return;
    if (!node.name || typeof node.name !== 'string') return;
    if (!node.position) return;
    const start = offsetToLineCol(content, node.position.start);
    const nameEnd = node.position.start + node.name.length;
    const end = offsetToLineCol(content, nameEnd);
    vars.push({ name: node.name, start, end, offset: node.position.start });
  });
  return vars;
}

function indexFilters(ast: LiquidHtmlNode, content: string): IndexedFilter[] {
  const filters: IndexedFilter[] = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidFilter) return;
    if (!node.name || !node.position) return;
    const raw = content.slice(node.position.start, node.position.end);
    const nameIdx = raw.indexOf(node.name);
    if (nameIdx < 0) return;
    const nameStart = node.position.start + nameIdx;
    const nameEndOff = nameStart + node.name.length;
    filters.push({
      name: node.name,
      start: offsetToLineCol(content, nameStart),
      end: offsetToLineCol(content, nameEndOff),
    });
  });
  return filters;
}

interface DocBlockInfo {
  startOffset: number;
  endOffset: number;
  start: LineCol;
  end: LineCol;
  existingParams: string[];
}

function findDocBlock(ast: LiquidHtmlNode, content: string): DocBlockInfo | null {
  let docNode: PositionedNode | null = null;
  const paramNodes: PositionedNode[] = [];
  walk(ast, (node) => {
    if (node.type === NodeTypes.LiquidRawTag && node.name === 'doc') {
      docNode = node as PositionedNode;
    }
    if (node.type === NodeTypes.LiquidDocParamNode) {
      paramNodes.push(node as PositionedNode);
    }
  });
  if (!docNode) return null;
  const doc = docNode as PositionedNode;
  const existingParams: string[] = [];
  for (const p of paramNodes) {
    if (!p.position) continue;
    const raw = content.slice(p.position.start, p.position.end);
    const m = raw.match(/@param\s+\{[^}]*\}\s+(\w+)/);
    if (m) existingParams.push(m[1]);
  }
  return {
    startOffset: doc.position!.start,
    endOffset: doc.position!.end,
    start: offsetToLineCol(content, doc.position!.start),
    end: offsetToLineCol(content, doc.position!.end),
    existingParams,
  };
}

function findFrontMatterEnd(ast: LiquidHtmlNode, content: string): LineCol | null {
  let fmEnd: LineCol | null = null;
  walk(ast, (node) => {
    if (node.type === NodeTypes.YAMLFrontmatter && (node as PositionedNode).position) {
      fmEnd = offsetToLineCol(content, (node as PositionedNode).position!.end);
    }
  });
  return fmEnd;
}

/**
 * Collect every variable in scope at `targetOffset`. Scoping rules:
 *
 *   - Doc params (`@param`): global to the file.
 *   - For/tablerow iterators: scoped to the loop body.
 *   - assign / capture / graphql / function / parse_json: scoped to
 *     everything AFTER the tag (Liquid is flat-scoped).
 *
 * Deduplicated by name (first occurrence wins).
 */
export function collectScopeAtOffset(
  ast: LiquidHtmlNode | null | undefined,
  targetOffset: number,
): ScopeVariable[] {
  if (!ast) return [];

  interface Definition {
    name: string;
    source: string;
    scopeType: 'global' | 'block' | 'after';
    scopeStart?: number;
    scopeEnd?: number;
    definedAt?: number;
  }
  const definitions: Definition[] = [];

  walk(ast, (node) => {
    if (node.type === NodeTypes.LiquidDocParamNode && node.paramName?.value) {
      definitions.push({ name: node.paramName.value, source: '@param', scopeType: 'global' });
      return;
    }
    if (node.type !== NodeTypes.LiquidTag || !node.position) return;
    const markup = node.markup as
      | { name?: string | { name?: string }; variableName?: string; collection?: { name?: string } }
      | string
      | undefined;

    switch (node.name) {
      case 'for':
      case 'tablerow': {
        if (typeof markup === 'object' && markup?.variableName) {
          const collection = markup.collection?.name ?? '...';
          definitions.push({
            name: markup.variableName,
            source: `{% ${node.name} ${markup.variableName} in ${collection} %}`,
            scopeType: 'block',
            scopeStart: node.position.start,
            scopeEnd: node.position.end,
          });
        }
        break;
      }
      case 'assign': {
        const name = typeof markup === 'object' ? (markup?.name as string | undefined) : undefined;
        if (typeof name === 'string') {
          definitions.push({
            name,
            source: '{% assign %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'capture': {
        const name = typeof markup === 'object' ? (markup?.name as string | undefined) : undefined;
        if (typeof name === 'string') {
          definitions.push({
            name,
            source: '{% capture %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'graphql': {
        const name =
          typeof markup === 'object' && typeof markup?.name === 'string' ? markup.name : null;
        if (name) {
          definitions.push({
            name,
            source: '{% graphql %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'function': {
        const name =
          typeof markup === 'object' && typeof markup?.name === 'object' ? markup.name?.name : null;
        if (typeof name === 'string') {
          definitions.push({
            name,
            source: '{% function %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
      case 'parse_json': {
        const name = typeof markup === 'object' ? (markup?.name as string | undefined) : undefined;
        if (typeof name === 'string') {
          definitions.push({
            name,
            source: '{% parse_json %}',
            scopeType: 'after',
            definedAt: node.position.end,
          });
        }
        break;
      }
    }
  });

  const inScope: ScopeVariable[] = [];
  const seen = new Set<string>();
  for (const def of definitions) {
    let isInScope = false;
    if (def.scopeType === 'global') {
      isInScope = true;
    } else if (def.scopeType === 'block') {
      isInScope = targetOffset >= (def.scopeStart ?? 0) && targetOffset <= (def.scopeEnd ?? 0);
    } else if (def.scopeType === 'after') {
      isInScope = targetOffset >= (def.definedAt ?? 0);
    }
    if (isInScope && !seen.has(def.name)) {
      seen.add(def.name);
      inScope.push({ name: def.name, source: def.source });
    }
  }
  return inScope;
}

function formatScopeInfo(scopeVars: ScopeVariable[]): string {
  if (!scopeVars || scopeVars.length === 0) return '';
  const items = scopeVars.map((v) => `${v.name} (${v.source})`).join(', ');
  return `\nVariables in scope: ${items}`;
}

function findVarAt(
  varIndex: IndexedVariable[],
  line: number | undefined,
  col: number | undefined,
  varName: string,
): IndexedVariable | null {
  if (line == null || col == null) return null;
  for (const v of varIndex) {
    if (v.name === varName && v.start.line === line && v.start.character === col) return v;
  }
  for (const v of varIndex) {
    if (
      v.name === varName &&
      v.start.line === line &&
      Math.abs(v.start.character - col) <= POSITION_FUZZY_TOLERANCE
    )
      return v;
  }
  return null;
}

function findFilterAt(
  filterIndex: IndexedFilter[],
  line: number | undefined,
  col: number | undefined,
  filterName: string,
): IndexedFilter | null {
  if (line == null || col == null) return null;
  for (const f of filterIndex) {
    if (
      f.name === filterName &&
      f.start.line === line &&
      Math.abs(f.start.character - col) <= POSITION_FUZZY_TOLERANCE
    )
      return f;
  }
  return null;
}

// ── Per-check fix functions ────────────────────────────────────────────────

function fixUndefinedObject(
  diagnostic: FixDiagnostic,
  varIndex: IndexedVariable[],
  isPartialLike: boolean,
  objectsIndex: ObjectsIndex | undefined,
): Fix | null {
  const varName = extractParams(diagnostic.check, diagnostic.message ?? '').variable ?? null;
  if (!varName) return null;

  if (isShopifyObject(varName)) {
    return {
      type: 'guidance',
      description: `\`${varName}\` is a Shopify theme object — it does not exist in platformOS. Use \`{% graphql %}\` to fetch data from your schema and \`context.*\` for request/user data.`,
    };
  }

  const contextObj = objectsIndex?.lookup(varName);
  if (contextObj) {
    const varNode = findVarAt(varIndex, diagnostic.line, diagnostic.column, varName);
    if (varNode) {
      return {
        type: 'text_edit',
        range: { start: varNode.start, end: varNode.end },
        new_text: contextObj.handle,
        description: `Replace \`${varName}\` with \`${contextObj.handle}\``,
      };
    }
    return {
      type: 'text_edit',
      range: {
        start: { line: diagnostic.line ?? 0, character: diagnostic.column ?? 0 },
        end: { line: diagnostic.line ?? 0, character: (diagnostic.column ?? 0) + varName.length },
      },
      new_text: contextObj.handle,
      description: `Replace \`${varName}\` with \`${contextObj.handle}\``,
    };
  }

  if (isPartialLike) {
    return {
      type: 'add_doc_param',
      param_name: varName,
      description: `Declare parameter: add \`@param {object} ${varName}\` to {% doc %} block`,
    };
  }
  return null;
}

function fixUnknownFilter(
  diagnostic: FixDiagnostic,
  filterIndex: IndexedFilter[],
  filtersIndex: FiltersIndex | undefined,
  tagsIndex: TagsIndex | undefined,
): Fix | null {
  const filterName = extractParams(diagnostic.check, diagnostic.message ?? '').filter ?? null;
  if (!filterName) return null;

  if (tagsIndex?.isTag(filterName)) {
    return {
      type: 'guidance',
      description: `\`${filterName}\` is a tag, not a filter. Use \`{% ${filterName} ... %}\` block syntax instead of \`| ${filterName}\`.`,
    };
  }
  if (isShopifyFilter(filterName)) {
    return {
      type: 'guidance',
      description: `\`${filterName}\` is a Shopify-specific filter — it does not exist in platformOS. Check platformOS docs for the equivalent functionality.`,
    };
  }
  const closest = filtersIndex?.closestMatch(filterName);
  if (closest && closest.name !== filterName) {
    const filterNode = findFilterAt(filterIndex, diagnostic.line, diagnostic.column, filterName);
    if (filterNode) {
      return {
        type: 'text_edit',
        range: { start: filterNode.start, end: filterNode.end },
        new_text: closest.name,
        description: `Replace \`${filterName}\` with \`${closest.name}\``,
      };
    }
    return {
      type: 'text_edit',
      range: {
        start: { line: diagnostic.line ?? 0, character: diagnostic.column ?? 0 },
        end: {
          line: diagnostic.line ?? 0,
          character: (diagnostic.column ?? 0) + filterName.length,
        },
      },
      new_text: closest.name,
      description: `Replace \`${filterName}\` with \`${closest.name}\``,
    };
  }
  return null;
}

function fixMissingPartial(
  diagnostic: FixDiagnostic,
  projectDir: string | null,
  ast: LiquidHtmlNode | null,
  content: string,
): Fix | null {
  const partialPath = extractParams(diagnostic.check, diagnostic.message ?? '').partial ?? null;
  if (!partialPath) return null;

  if (partialPath.startsWith('modules/')) {
    if (diagnostic.suggestion) {
      return {
        type: 'guidance',
        description: `\`${partialPath}\` is a module path. Fix the path in this file — available paths are in the suggestion field.`,
      };
    }
    return {
      type: 'guidance',
      description: `\`${partialPath}\` cannot be resolved. Call project_map to see installed modules and their available paths.`,
    };
  }

  if (partialPath.startsWith('lib/commands/') || partialPath.startsWith('lib/queries/')) {
    const corrected = partialPath.slice('lib/'.length);
    const edit = buildLibPrefixTextEdit(diagnostic, partialPath, corrected, content);
    if (edit) return edit;
    return {
      type: 'guidance',
      description:
        `Drop the \`lib/\` prefix from \`${partialPath}\`. Function tag paths resolve from ` +
        `\`app/lib/\`, so use \`${corrected}\` instead.`,
    };
  }

  let targetPath: string;
  let fileType: 'partial' | 'command' | 'query' = 'partial';
  if (partialPath.startsWith('commands/')) {
    targetPath = `app/lib/${partialPath}.liquid`;
    fileType = 'command';
  } else if (partialPath.startsWith('queries/')) {
    targetPath = `app/lib/${partialPath}.liquid`;
    fileType = 'query';
  } else {
    targetPath = `app/views/partials/${partialPath}.liquid`;
  }

  if (projectDir) {
    const absTarget = join(projectDir, targetPath);
    if (existsSync(absTarget)) {
      return {
        type: 'guidance',
        description: `File \`${targetPath}\` exists but the linter still reports it as missing. Check that the file is not empty, has no syntax errors, and the path in the render/function tag matches exactly.`,
      };
    }
  }

  const scaffold = generateScaffold(partialPath, fileType, ast, content);
  return {
    type: 'create_file',
    path: targetPath,
    scaffold,
    description: `Create missing file: \`${targetPath}\``,
  };
}

function buildLibPrefixTextEdit(
  diagnostic: FixDiagnostic,
  partialPath: string,
  corrected: string,
  content: string,
): TextEditFix | null {
  if (diagnostic.line == null || diagnostic.column == null || diagnostic.endColumn == null)
    return null;
  let quote = "'";
  if (typeof content === 'string') {
    const lines = content.split('\n');
    const sourceLine = lines[diagnostic.line];
    if (typeof sourceLine === 'string' && diagnostic.column < sourceLine.length) {
      const ch = sourceLine[diagnostic.column];
      if (ch === "'" || ch === '"') quote = ch;
    }
  }
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: diagnostic.column },
      end: { line: diagnostic.endLine ?? diagnostic.line, character: diagnostic.endColumn },
    },
    new_text: `${quote}${corrected}${quote}`,
    description:
      `Drop invalid \`lib/\` prefix — function tag paths resolve from \`app/lib/\`. ` +
      `Replace \`${partialPath}\` with \`${corrected}\`.`,
  };
}

function isLikelyCollection(paramName: string): boolean {
  const name = paramName.toLowerCase();
  const knownSingulars = new Set([
    'status',
    'address',
    'access',
    'progress',
    'process',
    'focus',
    'canvas',
    'alias',
    'class',
    'success',
    'basis',
    'radius',
  ]);
  if (knownSingulars.has(name)) return false;
  if (/_(list|collection|records|results|items|entries)$/.test(name)) return true;
  if (/^(records|results|items|entries|data|rows)$/.test(name)) return true;
  if (name.length > 4 && name.endsWith('s') && !name.endsWith('ss')) return true;
  return false;
}

function singularize(name: string): string {
  if (name.endsWith('ies') && name.length > 4) return name.slice(0, -3) + 'y';
  if (name.endsWith('ses') && name.length > 4) return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss') && name.length > 3) return name.slice(0, -1);
  return name;
}

function generateScaffold(
  partialPath: string,
  fileType: 'partial' | 'command' | 'query',
  ast: LiquidHtmlNode | null,
  content: string,
): string | null {
  if (!ast) return null;
  const params: string[] = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidTag) return;
    if (node.name !== 'render' && node.name !== 'function' && node.name !== 'theme_render_rc')
      return;
    const markup = node.markup as
      | { partial?: { value?: string }; args?: Array<{ name?: string; key?: string }> }
      | string
      | undefined;
    if (typeof markup === 'string') {
      if (!markup.includes(partialPath)) return;
      const argMatches = markup.matchAll(/,\s*(\w+)\s*:/g);
      for (const m of argMatches) {
        if (!params.includes(m[1])) params.push(m[1]);
      }
    } else if (markup && typeof markup === 'object' && markup.partial) {
      const partialValue = markup.partial?.value;
      if (partialValue !== partialPath) return;
      if (markup.args) {
        for (const arg of markup.args) {
          const name = arg.name ?? arg.key;
          if (name && !params.includes(name)) params.push(name);
        }
      }
    }
  });

  if (params.length === 0) return null;

  const docParams = params.map((p) => `  @param {object} ${p}`).join('\n');

  if (fileType === 'command') {
    return `{% doc %}\n${docParams}\n{% enddoc %}\n{% liquid\n  # Build\n  assign object = {} | hash_merge: ${params.map((p) => `${p}: ${p}`).join(', ')}\n\n  # Check\n  # Add validation here\n\n  # Execute\n  return object\n%}`;
  }
  if (fileType === 'query') {
    const graphqlPath = partialPath.replace(/^(lib\/)?queries\//, '');
    return `{% doc %}\n${docParams}\n{% enddoc %}\n{% liquid\n  graphql result = '${graphqlPath}', ${params.map((p) => `${p}: ${p}`).join(', ')}\n  return result\n%}`;
  }
  const paramLines = params
    .map((p) => {
      if (isLikelyCollection(p)) {
        const singular = singularize(p);
        return `  {% for ${singular} in ${p} %}\n    {{ ${singular} }}\n  {% endfor %}`;
      }
      return `  {{ ${p} }}`;
    })
    .join('\n');
  return `{% doc %}\n${docParams}\n{% enddoc %}\n<div>\n${paramLines}\n</div>`;
}

function fixConvertInclude(diagnostic: FixDiagnostic, content: string): Fix | null {
  if (diagnostic.line == null || diagnostic.column == null) return null;
  const line = content.split('\n')[diagnostic.line];
  if (!line) return null;

  if (/include\s+['"]modules\//.test(line)) {
    return {
      type: 'guidance',
      description:
        '`{% include %}` for module helpers (e.g., authorization, redirects) is correct — they need shared scope. Only replace with `{% render %}` if the partial does NOT modify the parent scope.',
    };
  }

  const searchStart = Math.max(0, diagnostic.column - 5);
  const idx = line.indexOf('include', searchStart);
  if (idx < 0) return null;

  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: idx },
      end: { line: diagnostic.line, character: idx + 'include'.length },
    },
    new_text: 'render',
    description:
      'Replace `include` with `render` — render has isolated scope, pass all needed variables explicitly',
  };
}

function fixDeprecatedTag(diagnostic: FixDiagnostic, content: string): Fix | null {
  const msg = diagnostic.message ?? '';
  if (!msg.includes('hash_assign')) return null;
  if (diagnostic.line == null) return null;
  const line = content.split('\n')[diagnostic.line];
  if (!line) return null;
  const idx = line.indexOf('hash_assign');
  if (idx < 0) return null;
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: idx },
      end: { line: diagnostic.line, character: idx + 'hash_assign'.length },
    },
    new_text: 'assign',
    description: 'Replace deprecated `hash_assign` with `assign`',
  };
}

function fixMissingRenderPartialArguments(
  diagnostic: FixDiagnostic,
  ast: LiquidHtmlNode | null,
  content: string,
): Fix {
  const msg = diagnostic.message ?? '';
  const partialMatch =
    msg.match(/partial\s+['"`]([^'"`]+)['"`]/) ?? msg.match(/['"`]([^'"`\/]+\/[^'"`]+)['"`]/);
  const paramMatch =
    msg.match(/argument\s+['"`](\w+)['"`]/) ?? msg.match(/@param\s+(?:\{[^}]*\}\s+)?(\w+)/);

  let scopeInfo = '';
  if (ast && content && diagnostic.line != null) {
    const offset = lineColToOffset(content, diagnostic.line, diagnostic.column ?? 0);
    scopeInfo = formatScopeInfo(collectScopeAtOffset(ast, offset));
  }

  if (!partialMatch || !paramMatch) {
    return {
      type: 'guidance',
      description: `Add the missing required parameter(s) to the \`{% render %}\` call. Check the partial's \`{% doc %}\` block for required \`@param\` declarations.${scopeInfo}`,
    };
  }
  return {
    type: 'guidance',
    description: `Add \`${paramMatch[1]}: <value>\` to the \`{% render '${partialMatch[1]}' %}\` call.${scopeInfo}`,
  };
}

function fixNestedGraphQLQuery(_diagnostic: FixDiagnostic): Fix {
  return {
    type: 'guidance',
    description:
      'Move the `{% graphql %}` call BEFORE the loop and use a batch/list query to fetch all data in one request. Each loop iteration currently makes a separate database query (N+1 problem).',
  };
}

function fixImgLazyLoading(diagnostic: FixDiagnostic, content: string): Fix | null {
  if (diagnostic.line == null) return null;
  const lines = content.split('\n');
  const line = lines[diagnostic.line];
  if (!line) return null;
  const imgIdx = line.indexOf('<img');
  if (imgIdx < 0) return null;
  if (/loading\s*=/.test(line)) return null;
  const closeIdx = line.indexOf('>', imgIdx);
  if (closeIdx < 0) return null;
  const insertBefore = line[closeIdx - 1] === '/' ? closeIdx - 1 : closeIdx;
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: insertBefore },
      end: { line: diagnostic.line, character: insertBefore },
    },
    new_text: ' loading="lazy"',
    description: 'Add `loading="lazy"` to <img> tag for better page load performance',
  };
}

function fixImgWidthAndHeight(diagnostic: FixDiagnostic, content: string): Fix | null {
  if (diagnostic.line == null) return null;
  const lines = content.split('\n');
  const line = lines[diagnostic.line];
  if (!line) return null;
  const imgIdx = line.indexOf('<img');
  if (imgIdx < 0) return null;
  const hasWidth = /width\s*=/.test(line);
  const hasHeight = /height\s*=/.test(line);
  if (hasWidth && hasHeight) return null;
  const closeIdx = line.indexOf('>', imgIdx);
  if (closeIdx < 0) return null;
  const insertBefore = line[closeIdx - 1] === '/' ? closeIdx - 1 : closeIdx;
  const attrs: string[] = [];
  if (!hasWidth) attrs.push('width=""');
  if (!hasHeight) attrs.push('height=""');
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: insertBefore },
      end: { line: diagnostic.line, character: insertBefore },
    },
    new_text: ' ' + attrs.join(' '),
    description: `Add ${attrs.join(' and ')} to <img> tag to prevent layout shift (CLS)`,
  };
}

function fixHardcodedRoutes(diagnostic: FixDiagnostic, _content: string): Fix {
  const msg = diagnostic.message ?? '';
  const pathMatch = msg.match(/['"`](\/[^'"`]+)['"`]/);
  if (!pathMatch) {
    return {
      type: 'guidance',
      description:
        'Avoid hardcoded URL paths — they break when slugs change. Build URLs dynamically using variables and `| append` filter.',
    };
  }
  const hardcodedPath = pathMatch[1];
  return {
    type: 'guidance',
    description: `Avoid hardcoded \`${hardcodedPath}\`. Build the URL dynamically using variables: e.g., \`{% assign url = '/products/' | append: item.id %}\`. This ensures URLs stay correct if slugs change.`,
  };
}

function fixInvalidHashAssignTarget(diagnostic: FixDiagnostic, _content: string): Fix {
  const msg = diagnostic.message ?? '';
  const varMatch = msg.match(/['"`](\w+)['"`]/);
  const varName = varMatch ? varMatch[1] : 'my_hash';
  return {
    type: 'guidance',
    description: `Initialize the variable before setting properties: \`{% assign ${varName} = {} %}\`. Then use \`{% assign ${varName}["key"] = "value" %}\`. Both \`hash_assign\` and \`parse_json\` are deprecated — use \`assign\` with hash literals.`,
  };
}

function fixMissingAsset(diagnostic: FixDiagnostic): Fix {
  const msg = diagnostic.message ?? '';
  const pathMatch = msg.match(/['"`]([^'"`]+)['"`]/);
  if (!pathMatch) {
    return {
      type: 'guidance',
      description:
        'Create the missing asset in `app/assets/`. This check has a high false-positive rate for module assets — verify the file is truly missing.',
    };
  }
  const assetPath = pathMatch[1];
  return {
    type: 'create_file',
    path: `app/assets/${assetPath}`,
    description: `Create missing asset: \`app/assets/${assetPath}\`. If this is a module asset, the file may already exist in the module's asset directory.`,
  };
}

function fixMetadataParamsCheck(
  diagnostic: FixDiagnostic,
  ast: LiquidHtmlNode | null,
  content: string,
): Fix {
  const msg = diagnostic.message ?? '';
  const isFunctionCall = /function call/i.test(msg);
  const targetLabel = isFunctionCall ? "query/command's" : "partial's";

  let scopeInfo = '';
  if (ast && content && diagnostic.line != null) {
    const offset = lineColToOffset(content, diagnostic.line, diagnostic.column ?? 0);
    scopeInfo = formatScopeInfo(collectScopeAtOffset(ast, offset));
  }

  const partialMatch =
    msg.match(/partial\s+['"`]([^'"`]+)['"`]/) ?? msg.match(/['"`]([^'"`\/]+\/[^'"`]+)['"`]/);
  const paramMatch =
    msg.match(/argument\s+['"`](\w+)['"`]/) ?? msg.match(/param(?:eter)?\s+['"`](\w+)['"`]/);

  if (partialMatch && paramMatch) {
    const tagExample = isFunctionCall
      ? `{% function result = '${partialMatch[1]}', ${paramMatch[1]}: <value> %}`
      : `{% render '${partialMatch[1]}', ${paramMatch[1]}: <value> %}`;
    return {
      type: 'guidance',
      description: `Add \`${paramMatch[1]}: <value>\` to the \`${tagExample}\` call. The ${targetLabel} \`{% doc %}\` block requires this parameter. Passing \`null\` is valid for any typed parameter. Common defaults by type: \`[]\` for array, \`{}\` for object, \`""\` for string, \`false\` for boolean.${scopeInfo}`,
    };
  }
  return {
    type: 'guidance',
    description: `Check the target ${targetLabel} \`{% doc %}\` block for required \`@param\` declarations. Pass all required parameters with matching types.${scopeInfo}`,
  };
}

function fixUnknownProperty(
  diagnostic: FixDiagnostic,
  _objectsIndex: ObjectsIndex | undefined,
): Fix {
  const msg = diagnostic.message ?? '';
  if (msg.includes('results') || msg.includes('records')) {
    return {
      type: 'guidance',
      description:
        'GraphQL query results use `result.records.results` for the list and `result.records.total_entries` for count. Do NOT use `result.results` or `result.total_count`.',
    };
  }
  return {
    type: 'guidance',
    description:
      "The linter cannot verify this property exists. Check the object's traversal path with `platformos_hover`. For GraphQL results: `result.records.results` for the list.",
  };
}

function fixLiquidHTMLSyntaxError(diagnostic: FixDiagnostic, content: string): Fix | null {
  const msg = diagnostic.message ?? '';
  if (diagnostic.line == null) return null;
  const lines = content.split('\n');
  const line = lines[diagnostic.line];

  if (line && /\{%[-\s]*(?:graphql|function)\s+\w+\s+['"]/.test(line)) {
    const fixedLine = line.replace(/(\{%[-\s]*(?:graphql|function)\s+\w+)\s+(['"])/, '$1 = $2');
    if (fixedLine !== line) {
      return {
        type: 'text_edit',
        range: {
          start: { line: diagnostic.line, character: 0 },
          end: { line: diagnostic.line, character: line.length },
        },
        new_text: fixedLine,
        description: 'Add missing `=` in graphql/function tag assignment',
      };
    }
  }

  if (msg.includes('end') || msg.includes('unclosed') || msg.includes('Unclosed')) {
    return {
      type: 'guidance',
      description:
        'Unclosed Liquid block detected. Ensure every `{% if %}` has `{% endif %}`, every `{% for %}` has `{% endfor %}`, etc. Inside `{% liquid %}` blocks, each statement goes on its own line without delimiters.',
    };
  }
  if (msg.includes('quote') || msg.includes('Quote') || msg.includes('string')) {
    return {
      type: 'guidance',
      description:
        'Check for mismatched quotes. Single and double quotes must be properly paired. In Liquid, both `\'string\'` and `"string"` are valid.',
    };
  }
  return null;
}

// ── pos-supervisor:* structural fixes ──────────────────────────────────────

function fixStructuralCheck(
  diagnostic: FixDiagnostic,
  content: string,
  ast: LiquidHtmlNode | null,
  filePath: string,
): Fix | null {
  switch (diagnostic.check) {
    case 'pos-supervisor:InvalidMethod':
      return fixInvalidMethod(diagnostic, content);
    case 'pos-supervisor:InvalidSlug':
      return fixInvalidSlugEdit(diagnostic, content);
    case 'pos-supervisor:MissingContentForLayout':
      return fixMissingContentForLayout(diagnostic, content, ast);
    case 'pos-supervisor:MissingReturn':
      return fixMissingReturnInsert(diagnostic, content);
    case 'pos-supervisor:MissingDocBlock':
      return fixMissingDocBlockInsert(diagnostic, content, ast);
    case 'pos-supervisor:MissingSlug':
      return fixMissingSlugInsert(diagnostic, content, filePath);
    case 'pos-supervisor:GraphqlInPartial':
      return {
        type: 'guidance',
        description:
          'Move the `{% graphql %}` call to a page or command. Pass the query results to the partial: `{% render "partial", data: query_result %}`.',
      };
    case 'pos-supervisor:HtmlInPage':
      return {
        type: 'guidance',
        description:
          'Extract HTML into a partial and render it: `{% render "partial_name" %}`. Pages should contain only logic (graphql, assign, render, redirect_to).',
      };
    case 'pos-supervisor:ShopifyObject':
      return fixShopifyObject(diagnostic);
    case 'pos-supervisor:SchemaPropertyType':
      return fixSchemaPropertyType(diagnostic, content);
    case 'pos-supervisor:InvalidLayout':
      return {
        type: 'create_file',
        path: extractLayoutPath(diagnostic.message),
        description: 'Create the missing layout file. Layouts live in `app/views/layouts/`.',
      };
    case 'pos-supervisor:InvalidFrontMatter':
      return fixInvalidFrontMatter(diagnostic, content);
    default:
      return null;
  }
}

function fixInvalidMethod(diagnostic: FixDiagnostic, content: string): Fix | null {
  const msg = diagnostic.message ?? '';
  const methodMatch = msg.match(/`(\w+)`.*lowercase.*`(\w+)`/) ?? msg.match(/`(\w+)`/);
  if (!methodMatch) return null;
  const currentMethod = methodMatch[1];
  const lowerMethod = methodMatch[2] ?? currentMethod.toLowerCase();
  if (diagnostic.line == null) return null;
  const line = content.split('\n')[diagnostic.line];
  if (!line) return null;
  const re = new RegExp(`method:\\s*${currentMethod}\\b`);
  const match = line.match(re);
  if (!match) return null;
  const methodStart = line.indexOf(currentMethod, match.index);
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: methodStart },
      end: { line: diagnostic.line, character: methodStart + currentMethod.length },
    },
    new_text: lowerMethod,
    description: `Fix method case: \`${currentMethod}\` → \`${lowerMethod}\``,
  };
}

function fixInvalidSlugEdit(diagnostic: FixDiagnostic, content: string): Fix | null {
  const msg = diagnostic.message ?? '';
  const correctedMatch = msg.match(/: `([^`]+)`\.$/);
  if (!correctedMatch) return null;
  const correctedSlug = correctedMatch[1];
  if (diagnostic.line == null) return null;
  const line = content.split('\n')[diagnostic.line];
  if (!line) return null;
  const slugMatch = line.match(/slug:\s*(.+)$/);
  if (!slugMatch) return null;
  const valueStart = line.indexOf(slugMatch[1]);
  return {
    type: 'text_edit',
    range: {
      start: { line: diagnostic.line, character: valueStart },
      end: { line: diagnostic.line, character: valueStart + slugMatch[1].length },
    },
    new_text: correctedSlug,
    description: `Fix slug syntax: \`${slugMatch[1].trim()}\` → \`${correctedSlug}\``,
  };
}

function fixMissingContentForLayout(
  _diagnostic: FixDiagnostic,
  content: string,
  _ast: LiquidHtmlNode | null,
): Fix {
  const bodyMatch = content.match(/<body[^>]*>/);
  if (bodyMatch && bodyMatch.index !== undefined) {
    const offset = bodyMatch.index + bodyMatch[0].length;
    const pos = offsetToLineCol(content, offset);
    return {
      type: 'insert',
      range: { start: pos, end: pos },
      new_text: '\n  {{ content_for_layout }}\n',
      description: 'Insert `{{ content_for_layout }}` after `<body>` to render page content',
    };
  }
  return {
    type: 'insert',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    new_text: '{{ content_for_layout }}\n',
    description:
      'Insert `{{ content_for_layout }}` — required for page content to render in layout',
  };
}

function fixMissingReturnInsert(_diagnostic: FixDiagnostic, content: string): Fix {
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '%}') {
      return {
        type: 'insert',
        range: { start: { line: i, character: 0 }, end: { line: i, character: 0 } },
        new_text: '  return object\n',
        description: 'Add `return object` before the end of the liquid block',
      };
    }
  }
  return {
    type: 'insert',
    range: {
      start: { line: lines.length, character: 0 },
      end: { line: lines.length, character: 0 },
    },
    new_text: '{% return object %}\n',
    description: 'Add `{% return object %}` at the end of the command',
  };
}

function fixMissingDocBlockInsert(
  _diagnostic: FixDiagnostic,
  content: string,
  ast: LiquidHtmlNode | null,
): Fix {
  const fmEnd = ast ? findFrontMatterEnd(ast, content) : null;
  const insertLine = fmEnd ? fmEnd.line + 1 : 0;
  return {
    type: 'insert',
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    new_text: '{% doc %}\n  @param {object} param_name - Description\n{% enddoc %}\n\n',
    description: 'Add `{% doc %}` block to document parameters',
    _source: 'MissingDocBlock',
  };
}

function fixMissingSlugInsert(_diagnostic: FixDiagnostic, content: string, filePath: string): Fix {
  const slug = slugFromPath(filePath);
  const slugLine = `slug: ${slug}\n`;
  const hasFrontMatter = content.startsWith('---\n');
  if (hasFrontMatter) {
    return {
      type: 'insert',
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
      new_text: slugLine,
      description: slug
        ? `Add \`slug: ${slug}\` to front matter`
        : 'Add `slug:` to front matter to define the URL explicitly',
    };
  }
  return {
    type: 'insert',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    new_text: `---\n${slugLine}---\n`,
    description: slug
      ? `Add front matter with \`slug: ${slug}\``
      : 'Add front matter with `slug:` to define the URL',
  };
}

function fixShopifyObject(diagnostic: FixDiagnostic): Fix {
  const msg = diagnostic.message ?? '';
  const nameMatch = msg.match(/`(\w+)`/);
  const name = nameMatch ? nameMatch[1] : 'object';
  return {
    type: 'guidance',
    description: `\`${name}\` is a Shopify theme object. In platformOS: use \`{% graphql %}\` to fetch data from your schema, \`context.params\` for request parameters, \`context.current_user\` for user data.`,
  };
}

const TYPE_ALIASES: Readonly<Record<string, string>> = {
  int: 'integer',
  number: 'integer',
  num: 'integer',
  double: 'float',
  decimal: 'float',
  bool: 'boolean',
  str: 'string',
  varchar: 'string',
  char: 'string',
  timestamp: 'datetime',
  time: 'datetime',
  file: 'upload',
  image: 'upload',
  attachment: 'upload',
  blob: 'upload',
  json: 'text',
  object: 'text',
  hash: 'text',
  list: 'array',
};

function fixSchemaPropertyType(diagnostic: FixDiagnostic, content: string): Fix | null {
  const msg = diagnostic.message ?? '';
  const typeMatch = msg.match(/`(\w+)`.*Did you mean `(\w+)`/);
  if (typeMatch) {
    const invalidType = typeMatch[1];
    const suggestedType = typeMatch[2];
    if (diagnostic.line == null) return null;
    const line = content.split('\n')[diagnostic.line];
    if (line) {
      const typeIdx = line.indexOf(invalidType);
      if (typeIdx >= 0) {
        return {
          type: 'text_edit',
          range: {
            start: { line: diagnostic.line, character: typeIdx },
            end: { line: diagnostic.line, character: typeIdx + invalidType.length },
          },
          new_text: suggestedType,
          description: `Fix property type: \`${invalidType}\` → \`${suggestedType}\``,
        };
      }
    }
  }

  const rawTypeMatch = msg.match(/`(\w+)`/);
  if (rawTypeMatch) {
    const invalidType = rawTypeMatch[1];
    const suggestion = TYPE_ALIASES[invalidType.toLowerCase()];
    if (suggestion) {
      if (diagnostic.line == null) return null;
      const line = content.split('\n')[diagnostic.line];
      if (line) {
        const typeIdx = line.indexOf(invalidType);
        if (typeIdx >= 0) {
          return {
            type: 'text_edit',
            range: {
              start: { line: diagnostic.line, character: typeIdx },
              end: { line: diagnostic.line, character: typeIdx + invalidType.length },
            },
            new_text: suggestion,
            description: `Fix property type: \`${invalidType}\` → \`${suggestion}\``,
          };
        }
      }
    }
  }
  return null;
}

function fixInvalidFrontMatter(diagnostic: FixDiagnostic, content: string): Fix | null {
  const msg = diagnostic.message ?? '';
  if (diagnostic.line == null) return null;
  const line = content.split('\n')[diagnostic.line];
  if (!line) return null;
  if (diagnostic.severity === 'error') {
    const keyMatch = msg.match(/`(\w+)`/);
    if (keyMatch) {
      return {
        type: 'text_edit',
        range: {
          start: { line: diagnostic.line, character: 0 },
          end: { line: diagnostic.line, character: line.length },
        },
        new_text: '',
        description: `Remove invalid front matter key \`${keyMatch[1]}\` — ${msg}`,
      };
    }
  }
  return null;
}

function extractLayoutPath(message: string | undefined): string {
  const expected = message?.match(/Expected file:\s*`([^`]+)`/);
  if (expected) return expected[1];
  const layoutName = message?.match(/`([^`]+)`.*not found/)?.[1];
  return layoutName
    ? `app/views/layouts/${layoutName}.liquid`
    : 'app/views/layouts/application.liquid';
}

function fixTranslationKeyExists(diagnostic: FixDiagnostic, content: string): Fix | null {
  const msg = diagnostic.message ?? '';
  const wrongKeyMatch = msg.match(/['"`]([^'"`]+)['"`]/);
  const wrongKey = wrongKeyMatch ? wrongKeyMatch[1] : null;

  if (wrongKey && /\[\d+\]/.test(wrongKey)) return null;

  const suggestMatch = msg.match(/[Dd]id you mean\s+['"`]([^'"`]+)['"`]/);
  if (suggestMatch && wrongKey && wrongKey !== suggestMatch[1] && diagnostic.line != null) {
    const suggestedKey = suggestMatch[1];
    const line = content.split('\n')[diagnostic.line];
    if (line) {
      for (const pattern of [`'${wrongKey}'`, `"${wrongKey}"`]) {
        const idx = line.indexOf(pattern);
        if (idx >= 0) {
          const quote = pattern[0];
          return {
            type: 'text_edit',
            range: {
              start: { line: diagnostic.line, character: idx },
              end: { line: diagnostic.line, character: idx + pattern.length },
            },
            new_text: `${quote}${suggestedKey}${quote}`,
            description: `Replace \`${wrongKey}\` with \`${suggestedKey}\``,
          };
        }
      }
    }
  }
  return {
    type: 'guidance',
    description:
      'Translation key not found. Add it to app/translations/en.yml, or check for typos in the key name.',
  };
}

// ── Doc-param fix merge ────────────────────────────────────────────────────

interface PendingDocFix extends AddDocParamFix {
  index: number;
}

function mergeDocParamFixes(
  paramFixes: PendingDocFix[],
  content: string,
  ast: LiquidHtmlNode | null,
): Fix {
  const uniqueParams = [...new Set(paramFixes.map((f) => f.param_name))];

  const existingDoc = ast ? findDocBlock(ast, content) : null;
  if (existingDoc) {
    const newParams = uniqueParams.filter((p) => !existingDoc.existingParams.includes(p));
    if (newParams.length === 0) {
      return {
        type: 'guidance',
        description: `All parameters (${uniqueParams.join(', ')}) are already declared in {% doc %} block — linter may need a more specific type annotation`,
      };
    }
    const paramLines = newParams.map((p) => `  @param {object} ${p}`).join('\n');
    const enddocMatch = content.indexOf('{% enddoc %}', existingDoc.startOffset);
    if (enddocMatch >= 0) {
      const insertPos = offsetToLineCol(content, enddocMatch);
      return {
        type: 'insert',
        range: { start: insertPos, end: insertPos },
        new_text: paramLines + '\n',
        description: `Add parameter declarations to existing {% doc %} block: ${newParams.join(', ')}`,
        resolves_params: newParams,
      };
    }
  }

  const paramLines = uniqueParams.map((p) => `  @param {object} ${p}`).join('\n');
  const docBlock = `{% doc %}\n${paramLines}\n{% enddoc %}\n\n`;
  const fmEnd = ast ? findFrontMatterEnd(ast, content) : null;
  const insertLine = fmEnd ? fmEnd.line + 1 : 0;
  return {
    type: 'insert',
    range: {
      start: { line: insertLine, character: 0 },
      end: { line: insertLine, character: 0 },
    },
    new_text: docBlock,
    description: `Add {% doc %} block declaring parameters: ${uniqueParams.join(', ')}`,
    resolves_params: uniqueParams,
  };
}

// ── Public API: generateFixes ──────────────────────────────────────────────

function dispatchFix(
  d: FixDiagnostic,
  varIndex: IndexedVariable[],
  filterIdx: IndexedFilter[],
  isPartialLike: boolean,
  ctx: FixIndexes,
  ast: LiquidHtmlNode | null,
  content: string,
  filePath: string,
  projectDir: string | null,
): Fix | null {
  switch (d.check) {
    case 'UndefinedObject':
      return fixUndefinedObject(d, varIndex, isPartialLike, ctx.objectsIndex);
    case 'UnknownFilter':
      return fixUnknownFilter(d, filterIdx, ctx.filtersIndex, ctx.tagsIndex);
    case 'ConvertIncludeToRender':
      return fixConvertInclude(d, content);
    case 'DeprecatedTag':
      return fixDeprecatedTag(d, content);
    case 'MissingPartial':
      return fixMissingPartial(d, projectDir, ast, content);
    case 'MissingRenderPartialArguments':
      return fixMissingRenderPartialArguments(d, ast, content);
    case 'NestedGraphQLQuery':
      return fixNestedGraphQLQuery(d);
    case 'TranslationKeyExists':
      return fixTranslationKeyExists(d, content);
    case 'ImgLazyLoading':
      return fixImgLazyLoading(d, content);
    case 'ImgWidthAndHeight':
      return fixImgWidthAndHeight(d, content);
    case 'HardcodedRoutes':
      return fixHardcodedRoutes(d, content);
    case 'InvalidHashAssignTarget':
      return fixInvalidHashAssignTarget(d, content);
    case 'MissingAsset':
      return fixMissingAsset(d);
    case 'MetadataParamsCheck':
      return fixMetadataParamsCheck(d, ast, content);
    case 'UnknownProperty':
      return fixUnknownProperty(d, ctx.objectsIndex);
    case 'LiquidHTMLSyntaxError':
      return fixLiquidHTMLSyntaxError(d, content);
    default:
      if (typeof d.check === 'string' && d.check.startsWith('pos-supervisor:')) {
        return fixStructuralCheck(d, content, ast, filePath);
      }
      return null;
  }
}

/**
 * Generate proposed fixes for a set of diagnostics. Returns both the
 * deduplicated list (`proposedFixes`) and a per-diagnostic map keyed by
 * the diagnostic's index in the input array.
 */
export function generateFixes(
  diagnostics: FixDiagnostic[],
  ast: LiquidHtmlNode | null,
  content: string,
  filePath: string,
  ctx: FixIndexes,
  projectDir: string | null = null,
): GenerateFixesResult {
  const proposedFixes: Fix[] = [];
  const diagnosticFixes = new Map<number, Fix>();

  const isPartialLike = /\/(partials|commands|queries)\//.test(filePath);
  const varIndex = ast ? indexVariables(ast, content) : [];
  const filterIdx = ast ? indexFilters(ast, content) : [];

  const docParamFixes: PendingDocFix[] = [];

  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    const fix = dispatchFix(
      d,
      varIndex,
      filterIdx,
      isPartialLike,
      ctx,
      ast,
      content,
      filePath,
      projectDir,
    );
    if (!fix) continue;

    // Stamp heuristic rule_id once per fix.
    if (!fix.rule_id) {
      fix.rule_id = `heuristic:${d.check ?? 'Unknown'}.${fix.type ?? 'fix'}`;
    }

    if (fix.type === 'add_doc_param') {
      docParamFixes.push({ ...fix, index: i });
      diagnosticFixes.set(i, {
        type: 'add_doc_param',
        description: fix.description,
        param_name: fix.param_name,
        rule_id: fix.rule_id,
      });
    } else {
      diagnosticFixes.set(i, fix);
      const candidate = fix as Fix & { range?: FixRange; new_text?: string };
      const isDupe = proposedFixes.some((f) => {
        const ff = f as Fix & { range?: FixRange; new_text?: string };
        return (
          ff.type === fix.type &&
          ff.description === fix.description &&
          ff.new_text === candidate.new_text &&
          ff.range?.start?.line === candidate.range?.start?.line &&
          ff.range?.start?.character === candidate.range?.start?.character
        );
      });
      if (!isDupe) proposedFixes.push(fix);
    }
  }

  if (docParamFixes.length > 0) {
    const merged = mergeDocParamFixes(docParamFixes, content, ast);
    // Drop any generic MissingDocBlock insert — the merged fix supersedes it.
    for (let j = proposedFixes.length - 1; j >= 0; j--) {
      if (proposedFixes[j]._source === 'MissingDocBlock') {
        proposedFixes.splice(j, 1);
      }
    }
    proposedFixes.push(merged);
    for (const item of docParamFixes) {
      diagnosticFixes.set(item.index, {
        type: merged.type,
        description: merged.description,
        param_name: item.param_name,
      } as Fix);
    }
  }

  // Attach before/after context to text_edit fixes for the dashboard display.
  for (const fix of diagnosticFixes.values()) {
    if (fix.type === 'text_edit') {
      const ctxInfo = generateFixContext(fix, content);
      if (ctxInfo) (fix as TextEditFix).context = ctxInfo;
    }
  }
  for (const fix of proposedFixes) {
    // Parity with source: attach before/after context only to `text_edit`
    // fixes. `insert` fixes (e.g. MissingDocBlock) are skipped — they
    // synthesise a block of new content, not a line-level edit, so the
    // before/after framing is misleading. P24 parity gate pins this.
    if (fix.type === 'text_edit') {
      const ctxInfo = generateFixContext(fix as TextEditFix, content);
      if (ctxInfo) (fix as TextEditFix).context = ctxInfo;
    }
  }

  return { proposedFixes, diagnosticFixes };
}

function generateFixContext(fix: TextEditFix | InsertFix, content: string): FixContext | null {
  if (!fix.range?.start || fix.new_text == null) return null;
  const lines = content.split('\n');
  const line = lines[fix.range.start.line];
  if (!line) return null;
  const before = line.trim();
  const startChar = fix.range.start.character;
  const endChar = fix.range.end?.character ?? startChar;
  const after = (line.slice(0, startChar) + fix.new_text + line.slice(endChar)).trim();
  if (before === after) return null;
  return { before, after, line: fix.range.start.line };
}

// ── Public API: clusterDiagnostics ─────────────────────────────────────────

const CONTEXT_VAR_NAMES = new Set([
  'params',
  'session',
  'current_user',
  'page',
  'location',
  'headers',
  'environment',
]);

interface ClusterAccumulator extends FixDiagnostic {
  _severity: 'error' | 'warning';
  fix?: Fix;
}

/**
 * Cluster related diagnostics for reduced noise. Groups by check name +
 * extracts a common pattern when 2 or more diagnostics share it.
 */
export function clusterDiagnostics(
  errors: FixDiagnostic[],
  warnings: FixDiagnostic[],
): DiagnosticCluster[] {
  const all: ClusterAccumulator[] = [
    ...errors.map<ClusterAccumulator>((e) => ({ ...e, _severity: 'error' })),
    ...warnings.map<ClusterAccumulator>((w) => ({ ...w, _severity: 'warning' })),
  ];

  const groups = new Map<string, ClusterAccumulator[]>();
  for (const d of all) {
    const key = d.check;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(d);
  }

  const clusters: DiagnosticCluster[] = [];
  for (const [check, items] of groups) {
    if (items.length < 2) continue;

    let pattern: string | null = null;
    let unifiedFix: string | null = null;

    if (check === 'UndefinedObject') {
      const vars = items
        .map((d) => {
          const m = d.message?.match(/['"`]([^'"`]+)['"`]/);
          return m ? m[1] : null;
        })
        .filter((v): v is string => !!v);
      const contextVars = vars.filter((v) => CONTEXT_VAR_NAMES.has(v));
      if (contextVars.length >= 2) {
        pattern = 'context_properties';
        unifiedFix = `These are all \`context\` sub-objects. Prefix each with \`context.\`: ${contextVars.map((v) => `\`context.${v}\``).join(', ')}.`;
      }
    }

    if (check === 'UnknownFilter') {
      pattern = 'multiple_unknown_filters';
      const names = items
        .map((d) => {
          const m = d.message?.match(/`([^`]+)`/);
          return m ? m[1] : null;
        })
        .filter((n): n is string => !!n);
      if (names.length >= 2) {
        unifiedFix = `${names.length} unknown filters found: ${names.map((n) => `\`${n}\``).join(', ')}. Check for Shopify-specific filters and typos.`;
      }
    }

    if (pattern) {
      clusters.push({
        check,
        count: items.length,
        pattern,
        unified_fix: unifiedFix,
        items: items.map((d) => ({
          line: d.line,
          column: d.column,
          message: d.message,
          fix: d.fix,
        })),
      });
    }
  }

  return clusters;
}

// ── Public API: generateScorecard ──────────────────────────────────────────

export function generateScorecard(
  structural: StructuralLike | null | undefined,
  domain: string | null | undefined,
  errors: FixDiagnostic[],
  _warnings: FixDiagnostic[],
): ScorecardNote[] {
  const notes: ScorecardNote[] = [];
  if (!structural) return notes;

  const queryCount = structural.graphql_queries?.length ?? 0;
  const renderCount = structural.renders?.length ?? 0;
  const tagCount = structural.tags_used?.length ?? 0;
  const transKeyCount = structural.translation_keys?.length ?? 0;

  if (domain === 'pages' && queryCount >= 3) {
    notes.push({
      level: 'advisory',
      message: `Page runs ${queryCount} GraphQL queries — consider consolidating into fewer queries or using a command to orchestrate data fetching.`,
    });
  }

  if (domain === 'pages' && renderCount === 0 && tagCount > 3) {
    notes.push({
      level: 'advisory',
      message:
        'Page renders 0 partials. Extract reusable HTML into partials for better maintainability.',
    });
  }

  if (domain === 'commands' && queryCount > 0) {
    const hasTry = structural.tags_used?.includes('try');
    const hasIfErrors = errors.length === 0 && !hasTry;
    if (hasIfErrors) {
      notes.push({
        level: 'advisory',
        message:
          'Command runs GraphQL queries but has no `{% try %}` error handling. Wrap queries in `{% try %}...{% catch error %}` to handle failures gracefully.',
      });
    }
  }

  if (domain === 'partials' && structural.prompts && structural.prompts.length > 0) {
    const paramCount = structural.prompts.reduce(
      (count, p) => count + (p.match(/@param/g)?.length ?? 0),
      0,
    );
    if (paramCount >= 8) {
      notes.push({
        level: 'advisory',
        message: `Partial declares ${paramCount} parameters — consider splitting into smaller, focused partials.`,
      });
    }
  }

  if (transKeyCount >= 10) {
    notes.push({
      level: 'advisory',
      message: `File uses ${transKeyCount} translation keys — verify all keys exist in translation files.`,
    });
  }

  if (renderCount >= 8) {
    notes.push({
      level: 'advisory',
      message: `File renders ${renderCount} partials — ensure each partial serves a distinct purpose and nesting isn't too deep.`,
    });
  }

  return notes;
}
