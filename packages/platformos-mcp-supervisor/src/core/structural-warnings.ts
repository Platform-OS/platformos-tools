/**
 * Structural warnings — pos-supervisor intelligence beyond the linter.
 *
 * Produces the `pos-supervisor:*` namespace of diagnostics that pos-cli
 * check / the LSP does NOT ship:
 *
 *   - HTML in pages (pages should be controller-only)
 *   - GraphQL in partials (partials must not run queries)
 *   - Multi-line `{% graphql %}` truncation inside `{% liquid %}` blocks
 *   - Shopify objects / tags / deprecated tags not flagged by the linter
 *   - Filter-argument misuse (wrong args for known filters)
 *   - Invalid layout reference (layout file not found on disk)
 *   - Missing `{% doc %}` block in partials
 *   - Invalid HTTP method in front matter (must be lowercase)
 *   - Missing return in commands
 *   - Invalid / unknown / misleading front matter keys in pages
 *   - Missing slug in pages
 *   - Page method / form-target mismatches (NonGetRenderingPage)
 *   - Missing `{{ content_for_layout }}` in layouts
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import {
  walk,
  NodeTypes,
  NamedTags,
  type LiquidHtmlNode,
} from '@platformos/liquid-html-parser';

import { isShopifyObject, getShopifyObject, getShopifyTag } from './knowledge-loader';
import { getDomainFromPath } from './domain-detector';
import { offsetToLineCol, slugFromPath } from './position-utils';
import { toPosixPath } from './utils';
import { classifyGraphqlSourceKind } from './liquid-parser';

// ── Enumerated checks emitted by this module ───────────────────────────────

/**
 * Every `pos-supervisor:*` check name that `generateStructuralWarnings`
 * may emit. Pinned as a const tuple so downstream code can narrow to
 * `StructuralCheck` instead of arbitrary strings.
 */
export const STRUCTURAL_CHECKS = [
  'pos-supervisor:HtmlInPage',
  'pos-supervisor:GraphqlInPartial',
  'pos-supervisor:GraphqlMultilineInLiquidBlock',
  'pos-supervisor:MissingReturn',
  'pos-supervisor:MissingContentForLayout',
  'pos-supervisor:MissingDocBlock',
  'pos-supervisor:ShopifyObject',
  'pos-supervisor:ShopifyTag',
  'pos-supervisor:DeprecatedTag',
  'pos-supervisor:InvalidSlug',
  'pos-supervisor:InvalidLayout',
  'pos-supervisor:InvalidMethod',
  'pos-supervisor:NonGetRenderingPage',
  'pos-supervisor:MissingSlug',
  'pos-supervisor:InvalidFrontMatter',
  'pos-supervisor:FilterArgMisuse',
] as const;

export type StructuralCheck = (typeof STRUCTURAL_CHECKS)[number];

// ── Public types ───────────────────────────────────────────────────────────

export interface StructuralDiagnostic {
  check: StructuralCheck;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line: number;
  column: number;
  suggestion?: string;
}

/**
 * Snake-case structural snapshot the validator passes in.
 *
 * Mirrors the shape `validate-code` builds from `extractAllFromAST` —
 * `renders_used`, `tags_used`, `doc_params` are the field names downstream
 * stages have referenced since before this module existed; we keep them.
 */
export interface StructuralContext {
  slug?: string | null;
  layout?: string | null;
  method?: string | null;
  renders_used?: string[];
  tags_used?: string[];
  doc_params?: string[];
}

export interface StructuralOptions {
  projectDir?: string;
}

// ── Internal constants ─────────────────────────────────────────────────────

const HTML_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  NodeTypes.HtmlElement,
  NodeTypes.HtmlVoidElement,
  NodeTypes.HtmlSelfClosingElement,
  NodeTypes.HtmlRawNode,
  NodeTypes.HtmlDoctype,
]);

const DEPRECATED_TAGS: ReadonlySet<string> = new Set(['parse_json', 'hash_assign', 'include']);

const VALID_PAGE_FRONT_MATTER_KEYS: ReadonlySet<string> = new Set([
  'slug',
  'method',
  'layout',
  'metadata',
  'response_headers',
  'max_deep_level',
  'redirect_to',
  'redirect_code',
  'searchable',
  'format',
]);

const MISLEADING_FRONT_MATTER_KEYS: Readonly<Record<string, string>> = {
  authorization_policies:
    "Do NOT use `authorization_policies` in front matter — it is a legacy feature. For access control, use `{% function can = 'modules/user/helpers/can_do', requester: profile, do: 'action' %}` or `{% if context.current_user %}` for simple auth checks. Remove this key.",
  cache:
    '`cache` is not a front matter option. Use `{% cache key, expire: 3600 %}` tag in the page body.',
  title:
    '`title` is not a top-level front matter key. Use `metadata.title` instead: `metadata:\\n  title: "Page Title"`.',
  description:
    '`description` is not a top-level front matter key. Use `metadata.description` instead.',
  default_layout:
    '`default_layout` is not a valid front matter key. Use `layout: application` or omit layout (defaults to `application`).',
  content_type:
    '`content_type` is not a front matter key. Use the file extension: `.json.liquid` for JSON, `.xml.liquid` for XML, `.csv.liquid` for CSV.',
  expires: '`expires` is not a front matter key. Use `{% cache key, expire: seconds %}` tag.',
};

const VALID_METHODS: ReadonlySet<string> = new Set(['get', 'post', 'put', 'delete', 'patch']);

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Generate structural warnings from AST + domain context.
 *
 * Each detector function walks the AST independently (mirrors source).
 * Combining the walks would tangle 7 distinct concerns; the per-detector
 * walk is cheap and keeps each check independently testable.
 */
export function generateStructuralWarnings(
  ast: LiquidHtmlNode,
  content: string,
  filePath: string,
  structural: StructuralContext | undefined,
  existingChecks: Set<string>,
  options: StructuralOptions = {},
): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  // Normalise the path once. Downstream helpers (isRootIndexPage,
  // slugFromPath, regex anchors) assume POSIX-style separators.
  const normalisedPath = toPosixPath(filePath);
  const domain = getDomainFromPath(normalisedPath);

  // 1. HTML in pages — controller-only. If the page renders partials,
  // the HTML is usually incidental glue (landing layouts, section
  // wrappers); suppress to avoid the high-regression false positive
  // from the 2026-04-23 DEMO report.
  if (domain === 'pages') {
    const rendersPartials = Array.isArray(structural?.renders_used) && structural!.renders_used!.length > 0;
    if (!rendersPartials) {
      const htmlWarning = detectHtmlInPage(ast, content);
      if (htmlWarning) warnings.push(htmlWarning);
    }
  }

  // 2. Shopify objects in variable output that the linter missed.
  const docParams = new Set(structural?.doc_params ?? []);
  warnings.push(...detectShopifyVariables(ast, content, existingChecks, docParams));

  // 2b. Shopify-only tags.
  warnings.push(...detectShopifyTags(ast, content));

  // 3. Deprecated tags not flagged by the linter.
  warnings.push(...detectDeprecatedTags(structural, existingChecks));

  // 4. Filter-argument misuse.
  warnings.push(...detectFilterArgMisuse(ast, content));

  // 5. Slug validation.
  if (domain === 'pages' && structural?.slug) {
    warnings.push(...validateSlug(structural.slug, content));
  }

  // 6. GraphQL in partials.
  if (domain === 'partials') {
    const gqlWarning = detectGraphqlInPartial(ast, content);
    if (gqlWarning) warnings.push(gqlWarning);
  }

  // 6b. `{% graphql %}` multi-line truncation inside `{% liquid %}`.
  warnings.push(...detectGraphqlMultilineTruncation(ast, content));

  // 7. Layout validation.
  if (domain === 'pages' && structural?.layout && options.projectDir) {
    const layoutWarning = validateLayout(structural.layout, content, options.projectDir);
    if (layoutWarning) warnings.push(layoutWarning);
  }

  // 8. Missing `{% doc %}` block in partials.
  if (domain === 'partials') {
    const docWarning = detectMissingDocBlock(content, structural, domain);
    if (docWarning) warnings.push(docWarning);
  }

  // 9. Method validation.
  if (domain === 'pages' && structural?.method) {
    const methodWarning = validateMethod(structural.method, content);
    if (methodWarning) warnings.push(methodWarning);
  }

  // 9b. Page method / form-target sanity (3 distinct misconfigurations).
  if (domain === 'pages') {
    warnings.push(...validatePageMethodAndForms(structural ?? {}, content));
  }

  // 10. Front matter key validation + missing slug.
  if (domain === 'pages') {
    warnings.push(...validateFrontMatterKeys(content, normalisedPath));
  }

  // 11. Missing return in commands.
  if (domain === 'commands') {
    const returnWarning = detectMissingReturn(structural);
    if (returnWarning) warnings.push(returnWarning);
  }

  // 13. Missing `{{ content_for_layout }}` in layouts.
  if (domain === 'layouts') {
    const contentWarning = detectMissingContentForLayout(content);
    if (contentWarning) warnings.push(contentWarning);
  }

  return warnings;
}

// ── 1. HTML-in-page ────────────────────────────────────────────────────────

interface PositionedNode {
  position?: { start: number; end: number };
}

function detectHtmlInPage(ast: LiquidHtmlNode, content: string): StructuralDiagnostic | null {
  let firstHtmlNode: PositionedNode | null = null;

  walk(ast, (node) => {
    if (firstHtmlNode) return;
    if (HTML_NODE_TYPES.has(node.type) && (node as PositionedNode).position) {
      // HTML comments are fine.
      if (node.type === NodeTypes.HtmlComment) return;
      firstHtmlNode = node as PositionedNode;
    }
  });

  if (!firstHtmlNode) return null;

  // `firstHtmlNode` is guaranteed non-null + positioned by the walk; the
  // local cast acknowledges that the closure-mutated value isn't reflected
  // in TS's control-flow narrowing.
  const node = firstHtmlNode as PositionedNode;
  const pos = offsetToLineCol(content, node.position!.start);
  return {
    check: 'pos-supervisor:HtmlInPage',
    severity: 'warning',
    message:
      'Pages should be controller-only (logic, no inline HTML). Move HTML to a partial and use {% render %}.',
    line: pos.line,
    column: pos.character,
  };
}

// ── 2. Shopify variables ───────────────────────────────────────────────────

function detectShopifyVariables(
  ast: LiquidHtmlNode,
  content: string,
  existingChecks: Set<string>,
  docParams: Set<string>,
): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  const seenVars = new Set<string>();

  walk(ast, (node) => {
    if (node.type !== NodeTypes.VariableLookup) return;
    const name = node.name;
    if (typeof name !== 'string') return;
    if (!node.position) return;
    if (seenVars.has(name)) return;

    if (!isShopifyObject(name)) return;
    // Variables declared as @param — the developer chose this name deliberately.
    if (docParams.has(name)) return;
    // Linter already flagged this variable.
    if (existingChecks.has(`UndefinedObject:${name}`)) return;

    seenVars.add(name);
    const pos = offsetToLineCol(content, node.position.start);

    const info = getShopifyObject(name);
    const suggestion = info?.replacement
      ? `\`${name}\` is a Shopify object. Use: \`${info.replacement}\`${info.note ? ` — ${info.note}` : ''}`
      : `\`${name}\` is a Shopify theme object — not in platformOS.${info?.note ? ` ${info.note}` : ' Use GraphQL queries to fetch data and `context.*` for request/user data.'}`;
    const message = `\`${name}\` is a Shopify theme object — it does not exist in platformOS. Use \`{% graphql %}\` to fetch data and \`context.*\` for request/user data.`;

    warnings.push({
      check: 'pos-supervisor:ShopifyObject',
      severity: 'error',
      message,
      suggestion,
      line: pos.line,
      column: pos.character,
    });
  });

  return warnings;
}

// ── 2b. Shopify tags ───────────────────────────────────────────────────────

function detectShopifyTags(ast: LiquidHtmlNode, content: string): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidTag) return;
    if (!node.position) return;
    const tagInfo = getShopifyTag(node.name);
    if (!tagInfo) return;
    const pos = offsetToLineCol(content, node.position.start);
    const replacementPart = tagInfo.replacement ? ` Use \`{% ${tagInfo.replacement} %}\` instead.` : '';
    warnings.push({
      check: 'pos-supervisor:ShopifyTag',
      severity: 'error',
      message: `\`{% ${node.name} %}\` is a Shopify-only tag — not valid in platformOS.${replacementPart}${tagInfo.note ? ` ${tagInfo.note}` : ''}`.trimEnd(),
      line: pos.line,
      column: pos.character,
    });
  });
  return warnings;
}

// ── 3. Deprecated tags ─────────────────────────────────────────────────────

function detectDeprecatedTags(
  structural: StructuralContext | undefined,
  existingChecks: Set<string>,
): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  if (!structural?.tags_used) return warnings;

  for (const tag of structural.tags_used) {
    if (!DEPRECATED_TAGS.has(tag)) continue;
    // Skip if the linter already flagged this specific tag.
    if (
      existingChecks.has('DeprecatedTag') &&
      ((tag === 'parse_json' && existingChecks.has('DeprecatedTag:parse_json')) ||
        (tag === 'hash_assign' && existingChecks.has('DeprecatedTag:hash_assign')) ||
        (tag === 'include' && existingChecks.has('DeprecatedTag:include')))
    )
      continue;

    let message: string;
    if (tag === 'parse_json') {
      message =
        '`{% parse_json %}` is deprecated. Use `{% assign var = { "key": "value" } %}` for hashes and `{% assign var = ["a", "b"] %}` for arrays.';
    } else if (tag === 'hash_assign') {
      message =
        '`{% hash_assign %}` is deprecated. Use `{% assign var["key"] = "value" %}` or `{% assign var.key = "value" %}`.';
    } else {
      message =
        '`{% include %}` is deprecated. Use `{% render %}` instead — render has isolated scope (variables must be passed explicitly). Exception: module helpers that require scope sharing.';
    }

    warnings.push({
      check: 'pos-supervisor:DeprecatedTag',
      severity: 'warning',
      message,
      line: 0,
      column: 0,
    });
  }

  return warnings;
}

// ── 4. Filter-argument misuse ──────────────────────────────────────────────

interface FilterRule {
  maxPositional: number;
  allowNamed: boolean;
  message: string;
}

const FILTER_ARG_RULES: Readonly<Record<string, FilterRule>> = {
  map: {
    maxPositional: 1,
    allowNamed: false,
    message:
      '`map` takes exactly one argument (property name): `{{ items | map: "property" }}`. Named arguments are not supported.',
  },
  sort: {
    maxPositional: 1,
    allowNamed: false,
    message:
      '`sort` takes one optional argument (property name): `{{ items | sort: "property" }}`. Named arguments are not supported.',
  },
  where: {
    maxPositional: 2,
    allowNamed: false,
    message:
      '`where` takes 1-2 arguments: `{{ items | where: "property", "value" }}`. Named arguments are not supported.',
  },
  slice: {
    maxPositional: 2,
    allowNamed: false,
    message:
      '`slice` takes 1-2 arguments (offset, length): `{{ string | slice: 0, 5 }}`. Named arguments are not supported.',
  },
  replace: {
    maxPositional: 2,
    allowNamed: false,
    message: '`replace` takes 2 arguments: `{{ string | replace: "old", "new" }}`.',
  },
  default: {
    maxPositional: 1,
    allowNamed: true,
    message:
      '`default` takes one value and optional `allow_false: true`: `{{ var | default: "fallback", allow_false: true }}`.',
  },
  t: {
    maxPositional: 0,
    allowNamed: true,
    message:
      '`t` (translate) takes named arguments only: `{{ "key" | t: name: "value" }}`. The first positional arg is the key before the pipe.',
  },
};

function detectFilterArgMisuse(ast: LiquidHtmlNode, content: string): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];

  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidFilter) return;
    if (!node.name || !node.position) return;

    const rule = FILTER_ARG_RULES[node.name];
    if (!rule) return;

    const args = node.args ?? [];
    let namedCount = 0;
    let positionalCount = 0;
    for (const a of args) {
      if (a && (a as { type?: string }).type === NodeTypes.NamedArgument) namedCount++;
      else positionalCount++;
    }

    let violation: string | null = null;
    if (!rule.allowNamed && namedCount > 0) {
      violation = rule.message;
    } else if (positionalCount > rule.maxPositional) {
      violation = rule.message;
    }

    if (violation) {
      const pos = offsetToLineCol(content, node.position.start);
      warnings.push({
        check: 'pos-supervisor:FilterArgMisuse',
        severity: 'warning',
        message: violation,
        line: pos.line,
        column: pos.character,
      });
    }
  });

  return warnings;
}

// ── 5. Slug validation ─────────────────────────────────────────────────────

function validateSlug(slug: string, content: string): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  const slugLine = findFrontmatterLine(content, 'slug');
  const line = slugLine >= 0 ? slugLine : 0;

  const bracketMatch = slug.match(/\[(\w+)\]/);
  if (bracketMatch) {
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug uses \`[${bracketMatch[1]}]\` bracket syntax (Next.js/file-based routing). platformOS uses \`:${bracketMatch[1]}\` for dynamic segments: \`${slug.replace(/\[(\w+)\]/g, ':$1')}\`.`,
      line,
      column: 0,
    });
  }

  const braceMatch = slug.match(/\{(\w+)\}/);
  if (braceMatch) {
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug uses \`{${braceMatch[1]}}\` brace syntax (Express/Swagger style). platformOS uses \`:${braceMatch[1]}\` for dynamic segments: \`${slug.replace(/\{(\w+)\}/g, ':$1')}\`.`,
      line,
      column: 0,
    });
  }

  const angleMatch = slug.match(/<(\w+)>/);
  if (angleMatch) {
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug uses \`<${angleMatch[1]}>\` angle bracket syntax. platformOS uses \`:${angleMatch[1]}\` for dynamic segments: \`${slug.replace(/<(\w+)>/g, ':$1')}\`.`,
      line,
      column: 0,
    });
  }

  if (slug.startsWith('/')) {
    const corrected = slug.replace(/^\/+/, '');
    const hint = corrected === ''
      ? 'For the home page (root `/`), omit the slug line entirely — `app/views/pages/index.liquid` serves `/` by convention without one.'
      : `platformOS slugs are relative: \`${corrected}\`.`;
    warnings.push({
      check: 'pos-supervisor:InvalidSlug',
      severity: 'warning',
      message: `Slug starts with \`/\` — remove the leading slash. ${hint}`,
      line,
      column: 0,
    });
  }

  return warnings;
}

function findFrontmatterLine(content: string, key: string): number {
  const lines = content.split('\n');
  const re = new RegExp(`^\\s*${key}:\\s`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

// ── 6. GraphQL in partials ─────────────────────────────────────────────────

function detectGraphqlInPartial(ast: LiquidHtmlNode, content: string): StructuralDiagnostic | null {
  let firstGraphqlNode: PositionedNode | null = null;

  walk(ast, (node) => {
    if (firstGraphqlNode) return;
    if (
      node.type === NodeTypes.LiquidTag &&
      node.name === NamedTags.graphql &&
      (node as PositionedNode).position
    ) {
      firstGraphqlNode = node as PositionedNode;
    }
  });

  if (!firstGraphqlNode) return null;

  const node = firstGraphqlNode as PositionedNode;
  const pos = offsetToLineCol(content, node.position!.start);
  return {
    check: 'pos-supervisor:GraphqlInPartial',
    severity: 'error',
    message:
      'Do NOT run `{% graphql %}` in partials. Partials receive data via explicit variable passing. Move the query to a page or command and pass results to the partial with `{% render "partial", data: query_result %}`.',
    line: pos.line,
    column: pos.character,
  };
}

// ── 6b. Multi-line graphql truncation ──────────────────────────────────────

function detectGraphqlMultilineTruncation(
  ast: LiquidHtmlNode,
  content: string,
): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  walk(ast, (node) => {
    if (node.type !== NodeTypes.LiquidTag || node.name !== NamedTags.graphql) return;
    if (classifyGraphqlSourceKind(node) !== 'liquid_multiline_truncated') return;
    const pos = node.position
      ? offsetToLineCol(content, node.position.start)
      : { line: 0, character: 0 };
    warnings.push({
      check: 'pos-supervisor:GraphqlMultilineInLiquidBlock',
      severity: 'error',
      message:
        'Multi-line `{% graphql %}` call inside a `{% liquid %}` block: the parser truncates ' +
        'the call at the first newline-comma, so every named argument past it is silently ' +
        "dropped at runtime. Move to single-line tag form: `{% graphql result = 'op', name: value, ... %}`, " +
        'or keep it inside the block but place every `name: value` argument on the same line as `graphql`.',
      line: pos.line,
      column: pos.character,
    });
  });
  return warnings;
}

// ── 7. Layout validation ───────────────────────────────────────────────────

function validateLayout(
  layoutName: string,
  content: string,
  projectDir: string,
): StructuralDiagnostic | null {
  if (!layoutName) return null;

  const candidates: string[] = [];

  const moduleMatch = layoutName.match(/^modules\/([^/]+)\/(.+)$/);
  if (moduleMatch) {
    const moduleName = moduleMatch[1];
    const layoutPath = moduleMatch[2];
    candidates.push(
      `modules/${moduleName}/public/views/layouts/${layoutPath}.html.liquid`,
      `modules/${moduleName}/public/views/layouts/${layoutPath}.liquid`,
      `modules/${moduleName}/private/views/layouts/${layoutPath}.html.liquid`,
      `modules/${moduleName}/private/views/layouts/${layoutPath}.liquid`,
    );
  } else {
    candidates.push(`app/views/layouts/${layoutName}.html.liquid`, `app/views/layouts/${layoutName}.liquid`);
  }

  const found = candidates.some((rel) => existsSync(join(projectDir, rel)));
  if (found) return null;

  const line = findFrontmatterLine(content, 'layout');
  const ext = detectLayoutExtension(projectDir, moduleMatch?.[1] ?? null);
  const expectedPath = moduleMatch
    ? `modules/${moduleMatch[1]}/public/views/layouts/${moduleMatch[2]}${ext}`
    : `app/views/layouts/${layoutName}${ext}`;
  return {
    check: 'pos-supervisor:InvalidLayout',
    severity: 'warning',
    message: `Layout \`${layoutName}\` not found. Expected file: \`${expectedPath}\`. Check the layout name or create the missing layout file.`,
    line: line >= 0 ? line : 0,
    column: 0,
  };
}

/**
 * Pick the layout-file extension convention the project already uses.
 * Falls back to `.liquid` (the modern shape) when no layouts exist on disk.
 */
function detectLayoutExtension(projectDir: string, moduleName: string | null = null): string {
  if (!projectDir) return '.liquid';
  const dir = moduleName
    ? join(projectDir, 'modules', moduleName, 'public', 'views', 'layouts')
    : join(projectDir, 'app', 'views', 'layouts');
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return '.liquid';
  }
  let html = 0;
  let bare = 0;
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    if (entry.endsWith('.html.liquid')) html += 1;
    else if (entry.endsWith('.liquid')) bare += 1;
  }
  if (html === 0 && bare === 0) return '.liquid';
  return html > bare ? '.html.liquid' : '.liquid';
}

// ── 8. Missing doc block ───────────────────────────────────────────────────

function detectMissingDocBlock(
  content: string,
  structural: StructuralContext | undefined,
  domain: string,
): StructuralDiagnostic | null {
  // Scoped to partials only — commands produced too many false positives.
  if (domain !== 'partials') return null;
  if (structural?.tags_used?.includes('doc')) return null;
  if (/@prompt\s*:/m.test(content)) return null;

  return {
    check: 'pos-supervisor:MissingDocBlock',
    severity: 'warning',
    message:
      'Partial is missing a `{% doc %}` block. Document expected parameters so callers know what variables to pass. Example: `{% doc %} @param title {string} Card title {% enddoc %}`.',
    line: 0,
    column: 0,
  };
}

// ── 9. Method validation ───────────────────────────────────────────────────

function validateMethod(method: string, content: string): StructuralDiagnostic | null {
  const line = findFrontmatterLine(content, 'method');
  const lower = method.toLowerCase();

  if (VALID_METHODS.has(method)) return null;

  if (VALID_METHODS.has(lower)) {
    return {
      check: 'pos-supervisor:InvalidMethod',
      severity: 'error',
      message: `Method \`${method}\` must be lowercase: \`${lower}\`. platformOS front matter methods are always lowercase.`,
      line: line >= 0 ? line : 0,
      column: 0,
    };
  }

  return {
    check: 'pos-supervisor:InvalidMethod',
    severity: 'error',
    message: `Invalid method \`${method}\`. Valid values: \`get\`, \`post\`, \`put\`, \`delete\`, \`patch\`.`,
    line: line >= 0 ? line : 0,
    column: 0,
  };
}

// ── 9b. Page method / form-target ──────────────────────────────────────────

interface ParsedForm {
  action: string;
  line: number;
  column: number;
}

function validatePageMethodAndForms(
  structural: StructuralContext,
  content: string,
): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  if (typeof content !== 'string') return warnings;

  const method = (structural.method ?? '').toLowerCase();
  const slug = normalizePageSlug(structural.slug ?? null);
  const isApiSlug = isApiPath(slug);
  const methodLine = findFrontmatterLine(content, 'method');
  const formatHeader = parseFormatHeader(content);

  const hasLayout = isExplicitLayout(structural.layout);
  const rendersPartials = Array.isArray(structural.renders_used) && structural.renders_used.length > 0;
  const hasOutput = /\{\{/.test(content);
  const hasHtmlTags = /<(html|body|div|main|section|article|form|h[1-6]|p|ul|ol|nav|header|footer)\b/i.test(content);
  const looksLikeUiPage = hasLayout || rendersPartials || hasOutput || hasHtmlTags;
  const apiHasHtmlSignal = hasLayout || rendersPartials || hasHtmlTags;

  if (method && method !== 'get' && ['post', 'put', 'delete', 'patch'].includes(method)) {
    if (isApiSlug) {
      if (apiHasHtmlSignal || formatHeader !== 'json') {
        const symptom = apiHasHtmlSignal
          ? `it renders HTML${hasLayout ? ` (layout: \`${structural.layout}\`)` : ' (layout, partials, or HTML tags)'}`
          : '`format: json` is missing — without it the page defaults to HTML';
        warnings.push({
          check: 'pos-supervisor:NonGetRenderingPage',
          severity: 'warning',
          message:
            `API page (slug \`${slug}\`) has \`method: ${method}\` but ${symptom}. ` +
            'Pages under `/api/`, `/_/`, or `/internal/` must return JSON: ' +
            'set `format: json` in front matter, drop the layout, and emit the response with ' +
            '`{% graphql ... %}` + `{{ result | json }}`.',
          line: methodLine >= 0 ? methodLine : 0,
          column: 0,
        });
      }
    } else if (looksLikeUiPage) {
      warnings.push({
        check: 'pos-supervisor:NonGetRenderingPage',
        severity: 'warning',
        message:
          `Page has \`method: ${method}\` but renders HTML (layout, partials, or \`{{ ... }}\` output). ` +
          `Browser GETs to this URL return 404 — only ${method.toUpperCase()} requests reach the handler. ` +
          'If this page should display content, remove the `method` field (defaults to `get`). ' +
          "If it's a form endpoint, move the handler to `app/lib/commands/` and have the form " +
          '`POST` to an API slug.',
        line: methodLine >= 0 ? methodLine : 0,
        column: 0,
      });
    }
  }

  if ((method === '' || method === 'get') && content) {
    for (const form of parsePostForms(content)) {
      if (!form.action) continue;
      if (isApiPath(form.action)) continue;
      if (selfPosts(form.action, slug)) continue;
      warnings.push({
        check: 'pos-supervisor:NonGetRenderingPage',
        severity: 'warning',
        message:
          `Form on GET page posts to \`${form.action}\`. Action paths outside \`/api/\`, \`/_/\`, or ` +
          '`/internal/` must correspond to a page with `method: post` (or matching verb). The canonical ' +
          `pattern is to point form actions at an API slug — set \`<form action="/api/${stripLeadingSlash(form.action)}" method="post">\` ` +
          `and create \`app/views/pages/api/${stripLeadingSlash(form.action)}.liquid\` with \`method: post\` + ` +
          '`format: json`.',
        line: form.line,
        column: form.column,
      });
    }
  }

  return warnings;
}

function normalizePageSlug(slug: string | null | undefined): string {
  if (typeof slug !== 'string') return '';
  let s = slug.trim().toLowerCase();
  if (!s) return '';
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

function isApiPath(path: string | null | undefined): boolean {
  if (typeof path !== 'string' || !path) return false;
  const p = path.startsWith('/') ? path : `/${path}`;
  return /^\/(api|_|internal)\//i.test(p);
}

function parseFormatHeader(content: string): string | null {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1].match(/^format:\s*(.+?)\s*$/m);
  if (!fm) return null;
  return fm[1].replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase() || null;
}

function isExplicitLayout(layout: unknown): boolean {
  if (layout === undefined || layout === null) return false;
  if (typeof layout === 'boolean') return layout === true;
  if (typeof layout !== 'string') return false;
  const trimmed = layout.trim();
  if (!trimmed) return false;
  if (trimmed === 'false' || trimmed === 'null') return false;
  return true;
}

function parsePostForms(content: string): ParsedForm[] {
  const out: ParsedForm[] = [];
  const formRe = /<form\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = formRe.exec(content)) !== null) {
    const attrs = m[1] ?? '';
    const methodMatch = attrs.match(/\bmethod\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    if (!methodMatch) continue;
    const methodVal = (methodMatch[1] ?? methodMatch[2] ?? methodMatch[3] ?? '').toLowerCase();
    if (!['post', 'put', 'patch', 'delete'].includes(methodVal)) continue;
    const actionMatch = attrs.match(/\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    if (!actionMatch) continue;
    const action = (actionMatch[1] ?? actionMatch[2] ?? actionMatch[3] ?? '').trim();
    if (!action) continue;
    const offset = m.index;
    const before = content.slice(0, offset);
    const line = (before.match(/\n/g) ?? []).length;
    const column = offset - (before.lastIndexOf('\n') + 1);
    out.push({ action, line, column });
  }
  return out;
}

function selfPosts(formAction: string, pageSlug: string): boolean {
  if (!formAction || !pageSlug) return false;
  const a = formAction.toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');
  const s = pageSlug.toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');
  return a === s;
}

function stripLeadingSlash(s: string): string {
  return typeof s === 'string' ? s.replace(/^\/+/, '') : s;
}

function isRootIndexPage(filePath: string): boolean {
  if (!filePath) return false;
  const basename = filePath.split('/').pop();
  return basename === 'index.liquid' || basename === 'index.html.liquid';
}

// ── 10. Front matter keys ──────────────────────────────────────────────────

function validateFrontMatterKeys(content: string, filePath: string): StructuralDiagnostic[] {
  const warnings: StructuralDiagnostic[] = [];
  const rootPage = isRootIndexPage(filePath);

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    if (rootPage) return warnings;
    const suggested = slugFromPath(filePath);
    warnings.push({
      check: 'pos-supervisor:MissingSlug',
      severity: 'warning',
      message: `Page has no front matter. Add \`slug\` to define the URL explicitly: \`---\\nslug: ${suggested}\\n---\`.`,
      line: 0,
      column: 0,
    });
    return warnings;
  }

  let doc: Record<string, unknown> | null;
  try {
    doc = yaml.load(fmMatch[1]) as Record<string, unknown> | null;
  } catch {
    return warnings;
  }
  if (!doc || typeof doc !== 'object') return warnings;

  if (!doc.slug && !rootPage) {
    const suggested = slugFromPath(filePath);
    const slugHint = suggested
      ? `Add \`slug: ${suggested}\` for an explicit URL.`
      : 'The URL will be derived from the file path.';
    warnings.push({
      check: 'pos-supervisor:MissingSlug',
      severity: 'warning',
      message: `Page is missing \`slug\` in front matter. ${slugHint}`,
      line: 0,
      column: 0,
    });
  }

  for (const key of Object.keys(doc)) {
    if (VALID_PAGE_FRONT_MATTER_KEYS.has(key)) continue;

    const misleadingMsg = MISLEADING_FRONT_MATTER_KEYS[key];
    if (misleadingMsg) {
      warnings.push({
        check: 'pos-supervisor:InvalidFrontMatter',
        severity: 'error',
        message: misleadingMsg,
        line: findFrontmatterLine(content, key),
        column: 0,
      });
    } else {
      warnings.push({
        check: 'pos-supervisor:InvalidFrontMatter',
        severity: 'warning',
        message: `Unknown front matter key \`${key}\`. Valid keys: slug, method, layout, metadata, response_headers, max_deep_level, redirect_to, redirect_code, searchable, format.`,
        line: findFrontmatterLine(content, key),
        column: 0,
      });
    }
  }

  return warnings;
}

// ── 11. Missing return in commands ─────────────────────────────────────────

function detectMissingReturn(structural: StructuralContext | undefined): StructuralDiagnostic | null {
  if (structural?.tags_used?.includes('return')) return null;

  return {
    check: 'pos-supervisor:MissingReturn',
    severity: 'warning',
    message:
      'Command is missing `{% return %}`. Commands should return a result object: `{% return object %}`. Without a return, the caller gets `null`.',
    line: 0,
    column: 0,
  };
}

// ── 13. Missing content_for_layout in layouts ──────────────────────────────

function detectMissingContentForLayout(content: string): StructuralDiagnostic | null {
  if (/\{\{\s*content_for_layout\s*\}\}/.test(content)) return null;

  return {
    check: 'pos-supervisor:MissingContentForLayout',
    severity: 'error',
    message:
      "Layout is missing `{{ content_for_layout }}`. Every layout must include this exactly once — it renders the page body. Named slots use `{% yield 'name' %}` separately.",
    line: 0,
    column: 0,
  };
}
