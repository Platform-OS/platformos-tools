/**
 * Project scanner — builds a structured JSON index of a platformOS project.
 *
 * Reads `app/` (pages, partials, layouts, commands, queries, graphql, schema,
 * translations, assets) and `modules/` (top-level module names) in parallel.
 * Returns a `ProjectMap` shape consumed by `dependency-graph`,
 * `project-fact-graph`, and `validate-code`'s diff-aware cross-file checks
 * (sections 2d and 2e).
 *
 * Out of v1 scope: `scanAround` (powered the `project_map` MCP tool with
 * `scope: 'around'`, which is not migrated), and `resolveRenderName` /
 * `parseGraphQLFile` / `extractFunctionCalls` export-level exposure
 * (used internally only).
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import yaml from 'js-yaml';
import {
  extractAllFromAST,
  parseLiquidFile,
  type GraphqlRef,
  type RenderCall,
} from './liquid-parser';
import { getDomainFromPath, type Domain } from './domain-detector';
import { toPosixPath } from './utils';

// ── Public types ───────────────────────────────────────────────────────────

export interface FunctionCall {
  variable: string;
  path: string;
}

export interface SchemaProperty {
  name: string;
  type: string;
}

export interface SchemaEntry {
  path: string;
  properties: SchemaProperty[];
}

export interface GraphqlArg {
  name: string;
  type: string;
}

export interface GraphqlEntry {
  operation: string | null;
  name: string | null;
  args: GraphqlArg[];
  table: string | null;
}

export interface PageEntry {
  path: string;
  slug: string;
  method: string;
  layout: string | null;
  renders: string[];
  render_calls: RenderCall[];
  function_calls: FunctionCall[];
  graphql_calls: GraphqlRef[];
}

export interface PartialEntry {
  path: string;
  params: string[];
  renders: string[];
  render_calls: RenderCall[];
  function_calls: FunctionCall[];
  graphql_calls: GraphqlRef[];
  rendered_by: string[];
}

export interface CommandEntry {
  params: string[];
  phases: string[];
  graphql_calls: GraphqlRef[];
  function_calls: FunctionCall[];
}

export interface QueryEntry {
  params: string[];
  graphql_calls: GraphqlRef[];
  function_calls: FunctionCall[];
}

export interface LayoutEntry {
  path: string;
  renders: string[];
  render_calls: RenderCall[];
  function_calls: FunctionCall[];
  graphql_calls: GraphqlRef[];
}

export interface ResourceEntry {
  schema: string;
  graphql: string[];
  commands: string[];
  queries: string[];
  pages: string[];
  missing: string[];
}

export interface ProjectMapSummary {
  file_counts: Record<string, number>;
  resources: Record<string, ResourceEntry>;
}

export interface ProjectMap {
  project: {
    directory: string;
    environments: string[];
    modules: string[];
    has_config: boolean;
  };
  schema: Record<string, SchemaEntry>;
  graphql: Record<string, GraphqlEntry>;
  commands: Record<string, CommandEntry>;
  queries: Record<string, QueryEntry>;
  pages: Record<string, PageEntry>;
  partials: Record<string, PartialEntry>;
  layouts: Record<string, LayoutEntry>;
  translations: Record<string, Record<string, unknown>>;
  assets: string[];
  summary: ProjectMapSummary;
}

// ── Internal types ─────────────────────────────────────────────────────────

interface ScannedLiquidFile {
  relPath: string;
  absPath: string;
  domain: Domain;
  structural: {
    slug: string | null;
    layout: string | null;
    method: string | null;
    renders: string[];
    renderCalls: RenderCall[];
    graphql: GraphqlRef[];
    filters: Set<string>;
    tags: Set<string>;
    transKeys: Set<string>;
    docParams: Set<string>;
  };
  functionCalls: FunctionCall[];
}

interface RawSchemaProperty {
  name?: string;
  type?: string;
}

interface RawSchemaFile {
  name?: string;
  properties?: RawSchemaProperty[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Scan the entire project and return a structured `ProjectMap`.
 *
 * Most scans run in parallel for throughput; the synchronous tail builds
 * the reverse-index of partial callers from the union of all liquid files
 * so cross-file edges (AddedParam / NewPartialParams / OrphanedPartial)
 * are resolved without a second pass.
 */
export async function scanProject(projectDir: string): Promise<ProjectMap> {
  const appDir = join(projectDir, 'app');

  const [schema, graphql, liquidFiles, translations, modules, environments, hasConfig, assets] =
    await Promise.all([
      scanSchema(appDir),
      scanGraphQL(appDir),
      scanLiquidFiles(appDir),
      scanTranslations(appDir),
      scanModules(projectDir),
      scanEnvironments(projectDir),
      scanConfig(appDir),
      scanAssets(appDir),
    ]);

  const pages: Record<string, PageEntry> = {};
  const partials: Record<string, PartialEntry> = {};
  const commands: Record<string, CommandEntry> = {};
  const queries: Record<string, QueryEntry> = {};
  const layouts: Record<string, LayoutEntry> = {};

  for (const file of liquidFiles) {
    switch (file.domain) {
      case 'pages': {
        // Key pages by {slug}:{method}. Multi-method routes (GET/POST/PUT/DELETE
        // on `blog_posts`) scaffold to 7 files but share only 3–4 slugs; the
        // pre-Phase-2.5 key collapse silently dropped everything but the last
        // file per slug. Fallback when no frontmatter slug: key by relPath+method
        // so the entry never collides with a real slug.
        const method = (file.structural.method ?? 'get').toLowerCase();
        const slug = file.structural.slug ?? file.relPath;
        const key = `${slug}:${method}`;
        pages[key] = {
          path: file.relPath,
          slug,
          method,
          layout: file.structural.layout,
          renders: file.structural.renders,
          render_calls: file.structural.renderCalls,
          function_calls: file.functionCalls,
          graphql_calls: file.structural.graphql,
        };
        break;
      }
      case 'partials': {
        const name = partialNameFromPath(file.relPath);
        partials[name] = {
          path: file.relPath,
          params: [...file.structural.docParams],
          renders: file.structural.renders,
          render_calls: file.structural.renderCalls,
          function_calls: file.functionCalls,
          graphql_calls: file.structural.graphql,
          rendered_by: [],
        };
        break;
      }
      case 'commands': {
        commands[file.relPath] = {
          params: [...file.structural.docParams],
          phases: detectPhases(projectDir, file.relPath),
          graphql_calls: file.structural.graphql,
          function_calls: file.functionCalls,
        };
        break;
      }
      case 'queries': {
        queries[file.relPath] = {
          params: [...file.structural.docParams],
          graphql_calls: file.structural.graphql,
          function_calls: file.functionCalls,
        };
        break;
      }
      case 'layouts': {
        layouts[file.relPath] = {
          path: file.relPath,
          renders: file.structural.renders,
          render_calls: file.structural.renderCalls,
          function_calls: file.functionCalls,
          graphql_calls: file.structural.graphql,
        };
        break;
      }
      default:
        // graphql / schema / translations / config — not liquid file domains.
        break;
    }
  }

  buildReverseIndex(partials, liquidFiles);

  const resources = detectResources(schema, graphql, commands, queries, pages);

  return {
    project: {
      directory: projectDir,
      environments,
      modules,
      has_config: hasConfig,
    },
    schema,
    graphql,
    commands,
    queries,
    pages,
    partials,
    layouts,
    translations,
    assets,
    summary: {
      file_counts: {
        schema: Object.keys(schema).length,
        graphql: Object.keys(graphql).length,
        commands: Object.keys(commands).length,
        queries: Object.keys(queries).length,
        pages: Object.keys(pages).length,
        partials: Object.keys(partials).length,
        layouts: Object.keys(layouts).length,
        assets: assets.length,
      },
      resources,
    },
  };
}

/**
 * Pluralise a schema name using the simple English rules platformOS uses:
 *   - ends in `s`/`x`/`z`/`ch`/`sh` → append `es`
 *   - ends in consonant + `y`      → drop `y`, append `ies`
 *   - otherwise                     → append `s`
 *
 * Consumed by `schema-property-checker` (P17).
 */
export function pluralize(name: string): string {
  if (
    name.endsWith('s') ||
    name.endsWith('x') ||
    name.endsWith('z') ||
    name.endsWith('ch') ||
    name.endsWith('sh')
  ) {
    return `${name}es`;
  }
  if (name.endsWith('y') && !/[aeiou]y$/.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  return `${name}s`;
}

// ── Sub-scanners ───────────────────────────────────────────────────────────

async function scanSchema(appDir: string): Promise<Record<string, SchemaEntry>> {
  const schemaDir = join(appDir, 'schema');
  if (!existsSync(schemaDir)) return {};

  const files = await readdir(schemaDir).catch(() => [] as string[]);
  const schema: Record<string, SchemaEntry> = {};

  await Promise.all(
    files.map(async (file) => {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) return;
      try {
        const content = await readFile(join(schemaDir, file), 'utf8');
        const parsed = yaml.load(content) as RawSchemaFile | undefined;
        if (parsed?.name) {
          schema[parsed.name] = {
            path: `app/schema/${file}`,
            properties: (parsed.properties ?? [])
              .filter((p): p is { name: string; type?: string } => typeof p?.name === 'string')
              .map((p) => ({ name: p.name, type: p.type ?? '' })),
          };
        }
      } catch {
        // skip unparseable files
      }
    }),
  );

  return schema;
}

async function scanGraphQL(appDir: string): Promise<Record<string, GraphqlEntry>> {
  const gqlDir = join(appDir, 'graphql');
  if (!existsSync(gqlDir)) return {};

  const files = await globFiles(gqlDir, '.graphql');
  const graphql: Record<string, GraphqlEntry> = {};

  await Promise.all(
    files.map(async (relFile) => {
      try {
        const content = await readFile(join(gqlDir, relFile), 'utf8');
        const queryPath = relFile.replace(/\.graphql$/, '');
        graphql[queryPath] = parseGraphQLFile(content);
      } catch {
        // skip unparseable files
      }
    }),
  );

  return graphql;
}

function parseGraphQLFile(content: string): GraphqlEntry {
  const result: GraphqlEntry = { operation: null, name: null, args: [], table: null };

  const opMatch = content.match(/^\s*(query|mutation)\s+(\w+)\s*(?:\(([^)]*)\))?/m);
  if (opMatch) {
    result.operation = opMatch[1];
    result.name = opMatch[2];
    if (opMatch[3]) {
      for (const am of opMatch[3].matchAll(/\$(\w+):\s*([^,=)]+)/g)) {
        result.args.push({ name: am[1], type: am[2].trim() });
      }
    }
  }

  const tableMatch = content.match(/table:\s*(?:\{\s*value:\s*"(\w+)"|"(\w+)")/);
  if (tableMatch) {
    result.table = tableMatch[1] ?? tableMatch[2] ?? null;
  }

  return result;
}

async function scanLiquidFiles(appDir: string): Promise<ScannedLiquidFile[]> {
  const liquidFiles: ScannedLiquidFile[] = [];
  const files = await globLiquidFiles(appDir);

  await Promise.all(
    files.map(async (relFile) => {
      const absPath = join(appDir, relFile);
      const relPath = `app/${relFile}`;
      const domain = getDomainFromPath(absPath);
      if (!domain) return;

      try {
        const content = await readFile(absPath, 'utf8');
        const ast = parseLiquidFile(content);
        if (!ast) return;

        const extracted = extractAllFromAST(ast);
        liquidFiles.push({
          relPath,
          absPath,
          domain,
          structural: {
            slug: extracted.slug,
            layout: extracted.layout,
            method: extracted.method,
            renders: extracted.renders,
            renderCalls: extracted.renderCalls,
            graphql: extracted.graphql,
            filters: extracted.filters,
            tags: extracted.tags,
            transKeys: extracted.transKeys,
            docParams: extracted.docParams,
          },
          functionCalls: extractFunctionCalls(content),
        });
      } catch {
        // skip unparseable files
      }
    }),
  );

  return liquidFiles;
}

async function scanTranslations(appDir: string): Promise<Record<string, Record<string, unknown>>> {
  const transDir = join(appDir, 'translations');
  if (!existsSync(transDir)) return {};

  const files = await readdir(transDir).catch(() => [] as string[]);
  const translations: Record<string, Record<string, unknown>> = {};

  await Promise.all(
    files.map(async (file) => {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) return;
      const locale = basename(file, extname(file));
      try {
        const content = await readFile(join(transDir, file), 'utf8');
        const parsed = yaml.load(content);
        if (parsed && typeof parsed === 'object') {
          translations[locale] = flattenYaml(parsed as Record<string, unknown>);
        }
      } catch {
        // skip
      }
    }),
  );

  return translations;
}

async function scanModules(projectDir: string): Promise<string[]> {
  const modulesDir = join(projectDir, 'modules');
  if (!existsSync(modulesDir)) return [];

  try {
    const entries = await readdir(modulesDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function scanEnvironments(projectDir: string): Promise<string[]> {
  const posFile = join(projectDir, '.pos');
  if (!existsSync(posFile)) return [];

  try {
    const content = await readFile(posFile, 'utf8');
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.keys(parsed as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function scanConfig(appDir: string): Promise<boolean> {
  return existsSync(join(appDir, 'config.yml'));
}

interface DirentLike {
  parentPath?: string;
  path?: string;
  name: string;
  isFile(): boolean;
}

async function scanAssets(appDir: string): Promise<string[]> {
  const assetsDir = join(appDir, 'assets');
  if (!existsSync(assetsDir)) return [];
  try {
    const entries = (await readdir(assetsDir, {
      withFileTypes: true,
      recursive: true,
    })) as DirentLike[];
    return entries
      .filter((e) => e.isFile())
      .map((e) =>
        toPosixPath(relative(assetsDir, join(e.parentPath ?? e.path ?? assetsDir, e.name))),
      )
      .sort();
  } catch {
    return [];
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function extractFunctionCalls(content: string): FunctionCall[] {
  const calls: FunctionCall[] = [];
  const seen = new Set<string>();
  const re = /function\s+(\w+)\s*=\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      calls.push({ variable: m[1], path: m[2] });
    }
  }
  return calls;
}

function partialNameFromPath(relPath: string): string {
  return relPath
    .replace(/^app\/views\/partials\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
}

function detectPhases(projectDir: string, relPath: string): string[] {
  const basePath = join(projectDir, relPath.replace(/\.liquid$/, ''));
  const phases = ['main'];
  if (existsSync(join(basePath, 'build.liquid'))) phases.push('build');
  if (existsSync(join(basePath, 'check.liquid'))) phases.push('check');
  return phases;
}

function buildReverseIndex(
  partials: Record<string, PartialEntry>,
  liquidFiles: ScannedLiquidFile[],
): void {
  for (const file of liquidFiles) {
    for (const renderName of file.structural.renders) {
      const resolved = resolveRenderNameInternal(file.relPath, renderName);
      const partial = partials[resolved];
      if (partial) {
        partial.rendered_by.push(file.relPath);
      }
    }
    for (const fc of file.functionCalls) {
      const partialName = fc.path.replace(/^views\/partials\//, '');
      const partial = partials[partialName];
      if (partial) {
        partial.rendered_by.push(file.relPath);
      }
    }
  }
}

/**
 * Resolve a `{% render %}` name to a partial key, honouring relative names.
 *
 * Internal-only — not exported. `dependency-graph.ts` keeps a duplicate to
 * avoid a circular import, matching source layout.
 */
function resolveRenderNameInternal(callerRelPath: string, renderName: string): string {
  if (!renderName) return renderName;
  if (renderName.includes('/')) return renderName;
  if (renderName.startsWith('modules/')) return renderName;

  const partialsPrefix = 'app/views/partials/';
  if (!callerRelPath.startsWith(partialsPrefix)) return renderName;

  const relUnderPartials = callerRelPath
    .slice(partialsPrefix.length)
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
  const slashIdx = relUnderPartials.lastIndexOf('/');
  if (slashIdx < 0) return renderName;
  const dir = relUnderPartials.slice(0, slashIdx);
  return `${dir}/${renderName}`;
}

function detectResources(
  schema: Record<string, SchemaEntry>,
  graphql: Record<string, GraphqlEntry>,
  commands: Record<string, CommandEntry>,
  queries: Record<string, QueryEntry>,
  pages: Record<string, PageEntry>,
): Record<string, ResourceEntry> {
  const resources: Record<string, ResourceEntry> = {};

  for (const [tableName, tableInfo] of Object.entries(schema)) {
    const plural = pluralize(tableName);
    const r: ResourceEntry = {
      schema: tableInfo.path,
      graphql: [],
      commands: [],
      queries: [],
      pages: [],
      missing: [],
    };

    for (const [gqlPath, gqlInfo] of Object.entries(graphql)) {
      if (gqlPath.startsWith(`${plural}/`) || gqlInfo.table === tableName) {
        r.graphql.push(gqlPath);
      }
    }
    for (const cmdPath of Object.keys(commands)) {
      if (cmdPath.includes(`/commands/${plural}/`)) r.commands.push(cmdPath);
    }
    for (const qPath of Object.keys(queries)) {
      if (qPath.includes(`/queries/${plural}/`)) r.queries.push(qPath);
    }
    // Iterate pages by value — the key now includes the method suffix
    // (`{slug}:{method}`) so key-based startsWith would misfire.
    for (const page of Object.values(pages)) {
      const slug = page.slug ?? '';
      if (slug === plural || slug.startsWith(`${plural}/`)) {
        r.pages.push(page.path);
      }
    }

    const ops = new Set(r.graphql.map((g) => basename(g)));
    if (!ops.has('search') && !ops.has('list')) r.missing.push('search query');
    if (!ops.has('find') && !ops.has('get')) r.missing.push('find query');
    if (!ops.has('create')) r.missing.push('create mutation');
    if (!ops.has('update')) r.missing.push('update mutation');
    if (!ops.has('delete')) r.missing.push('delete mutation');

    resources[tableName] = r;
  }

  return resources;
}

function flattenYaml(obj: Record<string, unknown>, prefix: string = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenYaml(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

async function globFiles(dir: string, ext: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = (await readdir(dir, { recursive: true })) as string[];
    // Normalise to POSIX separators at the boundary. Every downstream key
    // (graphql['blog_posts/search'], partials['blog_posts/card'], …) must
    // be forward-slashed regardless of host OS or callers cannot do prefix
    // matches with literal `/`.
    return entries.filter((f) => f.endsWith(ext)).map(toPosixPath);
  } catch {
    return [];
  }
}

async function globLiquidFiles(appDir: string): Promise<string[]> {
  if (!existsSync(appDir)) return [];
  try {
    const entries = (await readdir(appDir, { recursive: true })) as string[];
    return entries.filter((f) => f.endsWith('.liquid')).map(toPosixPath);
  } catch {
    return [];
  }
}
