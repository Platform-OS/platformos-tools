import yaml from 'js-yaml';
import { URI, Utils } from 'vscode-uri';
import { AbstractFileSystem, FileType } from '../AbstractFileSystem';
import { getAppPaths, getModulePaths, PlatformOSFileType } from '../path-utils';
import { RouteEntry, RouteSegment } from './types';
import { slugFromFilePath, formatFromFilePath } from './slugFromFilePath';
import { parseSlug, calculatePrecedence } from './parseSlug';

interface PageFrontmatter {
  slug?: string;
  method?: string;
  format?: string;
}

function extractFrontmatter(source: string): PageFrontmatter | null {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('---')) return null;

  const end = trimmed.indexOf('---', 3);
  if (end === -1) return null;

  const yamlBlock = trimmed.slice(3, end).trim();
  if (yamlBlock.length === 0) return null;

  try {
    const result = yaml.load(yamlBlock);
    if (typeof result !== 'object' || result === null) return null;
    return result as PageFrontmatter;
  } catch {
    return null;
  }
}

/**
 * Extract the path relative to the pages directory from a full URI.
 * Handles both app-level and module page paths.
 *
 * App-level: matches `/(app|marketplace_builder)/(views/pages|pages)/`
 * Module-level: matches `/(public|private)/(views/pages|pages)/`
 * (marketplace_builder module pages always go through public/private subdirs,
 * so the second pattern covers them.)
 *
 * Examples:
 *   file:///project/app/views/pages/about.html.liquid -> about.html.liquid
 *   file:///project/modules/admin/public/views/pages/dashboard.html.liquid -> dashboard.html.liquid
 */
function extractRelativePagePath(uri: string): string | null {
  const patterns = [
    /\/(app|marketplace_builder)\/(views\/pages|pages)\//,
    /\/(public|private)\/(views\/pages|pages)\//,
  ];

  for (const pattern of patterns) {
    const match = uri.match(pattern);
    if (match) {
      const idx = uri.indexOf(match[0]) + match[0].length;
      return uri.slice(idx);
    }
  }

  return null;
}

function buildRouteEntry(uri: string, slug: string, method: string, format: string): RouteEntry {
  const { requiredSegments, optionalGroups } = parseSlug(slug);
  const precedence = calculatePrecedence(slug, format);

  return {
    slug,
    method,
    format,
    uri,
    requiredSegments,
    optionalGroups,
    precedence,
  };
}

/**
 * Try to match a list of URL segments against a list of route segments.
 * Returns true if all URL segments are consumed and matched.
 */
function matchSegments(
  urlSegments: UrlSegment[],
  routeSegments: RouteSegment[],
  urlStart: number,
): number | false {
  let ui = urlStart;

  for (let ri = 0; ri < routeSegments.length; ri++) {
    const rs = routeSegments[ri];

    if (rs.type === 'wildcard') {
      // Wildcard consumes all remaining segments but requires at least one
      if (ui >= urlSegments.length) return false;
      return urlSegments.length;
    }

    if (ui >= urlSegments.length) {
      // Ran out of URL segments but route still has more
      return false;
    }

    const us = urlSegments[ui];

    if (us.type === 'dynamic') {
      // Liquid interpolation matches any route segment type
      ui++;
      continue;
    }

    // us.type === 'static'
    if (rs.type === 'static') {
      if (us.value !== rs.value) return false;
      ui++;
    } else if (rs.type === 'param') {
      // :param matches any single static segment
      ui++;
    }
  }

  return ui;
}

type UrlSegment = { type: 'static'; value: string } | { type: 'dynamic' };

function parseUrlPattern(pattern: string): UrlSegment[] {
  // Strip leading and trailing slashes
  let path = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (path === '') return [];

  return path.split('/').map((seg) => {
    if (seg === ':_liquid_') {
      return { type: 'dynamic' };
    }
    return { type: 'static', value: seg };
  });
}

export class RouteTable {
  private routes: Map<string, RouteEntry[]> = new Map(); // uri -> entries (a page can register multiple entries for index aliasing)

  constructor(private fs: AbstractFileSystem) {}

  async build(rootUri: URI): Promise<void> {
    this.routes.clear();

    const pageUris = await this.discoverPageFiles(rootUri);
    for (const uri of pageUris) {
      try {
        const content = await this.fs.readFile(uri);
        this.addPageFromContent(uri, content);
      } catch {
        // Skip files we can't read
      }
    }
  }

  updateFile(uri: string, content: string): void {
    this.removeFile(uri);
    this.addPageFromContent(uri, content);
  }

  removeFile(uri: string): void {
    this.routes.delete(uri);
  }

  /**
   * Find all routes matching a URL pattern and optional method.
   * The pattern can contain `:_liquid_` segments for Liquid interpolations.
   * Results are sorted by precedence (highest priority first = lowest number).
   */
  match(urlPattern: string, method?: string): RouteEntry[] {
    const urlSegments = parseUrlPattern(urlPattern);

    const results: RouteEntry[] = [];

    for (const entries of this.routes.values()) {
      for (const entry of entries) {
        if (method && entry.method !== method) continue;
        if (this.matchEntry(urlSegments, entry)) {
          results.push(entry);
        }
      }
    }

    results.sort((a, b) => a.precedence - b.precedence);
    return results;
  }

  hasMatch(urlPattern: string, method?: string): boolean {
    const urlSegments = parseUrlPattern(urlPattern);

    for (const entries of this.routes.values()) {
      for (const entry of entries) {
        if (method && entry.method !== method) continue;
        if (this.matchEntry(urlSegments, entry)) return true;
      }
    }
    return false;
  }

  allRoutes(): RouteEntry[] {
    const all: RouteEntry[] = [];
    for (const entries of this.routes.values()) {
      all.push(...entries);
    }
    return all.sort((a, b) => a.precedence - b.precedence);
  }

  private matchEntry(urlSegments: UrlSegment[], entry: RouteEntry): boolean {
    // Try matching with required segments only
    const afterRequired = matchSegments(urlSegments, entry.requiredSegments, 0);
    if (afterRequired !== false && afterRequired === urlSegments.length) {
      return true;
    }

    // Try matching with required + optional groups progressively
    if (afterRequired !== false && entry.optionalGroups.length > 0) {
      return this.matchOptionalGroups(urlSegments, entry.optionalGroups, afterRequired);
    }

    return false;
  }

  private matchOptionalGroups(
    urlSegments: UrlSegment[],
    groups: RouteSegment[][],
    startIdx: number,
  ): boolean {
    // Try each optional group in sequence
    let current = startIdx;

    for (const group of groups) {
      if (current === urlSegments.length) {
        // Remaining optional groups can be omitted
        return true;
      }

      const after = matchSegments(urlSegments, group, current);
      if (after !== false) {
        current = after;
        if (current === urlSegments.length) return true;
      }
      // If this optional group doesn't match, that's OK — it's optional.
      // But we stop trying further groups if it didn't advance.
    }

    return current === urlSegments.length;
  }

  private addPageFromContent(uri: string, content: string): void {
    const relativePath = extractRelativePagePath(uri);
    if (!relativePath) return;

    const frontmatter = extractFrontmatter(content);
    const fileFormat = formatFromFilePath(relativePath);

    const method = (frontmatter?.method || 'get').toLowerCase();
    const format = frontmatter?.format || fileFormat;

    let slug: string;
    if (frontmatter?.slug !== undefined && frontmatter.slug !== null) {
      slug = String(frontmatter.slug);
    } else {
      slug = slugFromFilePath(relativePath, format);
    }

    const entries: RouteEntry[] = [];

    // Primary route
    entries.push(buildRouteEntry(uri, slug, method, format));

    // Index aliasing: if slug was derived from stripping /index,
    // also register the /index variant
    if (!frontmatter?.slug) {
      const slugWithIndex = slug + '/index';
      // Only add alias if the raw derivation actually stripped /index
      // (i.e., the file is named index.{format}.liquid or index.liquid)
      const baseName = relativePath.split('/').pop() || '';
      const isIndexFile =
        baseName === 'index.liquid' ||
        baseName === `index.${format}.liquid` ||
        baseName === `index.${format}`;
      if (isIndexFile && slug !== '/') {
        entries.push(buildRouteEntry(uri, slugWithIndex, method, format));
      }
    }

    this.routes.set(uri, entries);
  }

  private async discoverPageFiles(rootUri: URI): Promise<string[]> {
    const uris: string[] = [];

    // App-level pages
    const appPaths = getAppPaths(PlatformOSFileType.Page);
    for (const basePath of appPaths) {
      const baseUri = Utils.joinPath(rootUri, basePath);
      await this.walkDirectory(baseUri.toString(), uris);
    }

    // Module pages — discover module names first
    const moduleNames = await this.discoverModuleNames(rootUri);
    for (const moduleName of moduleNames) {
      const modulePaths = getModulePaths(PlatformOSFileType.Page, moduleName);
      for (const basePath of modulePaths) {
        const baseUri = Utils.joinPath(rootUri, basePath);
        await this.walkDirectory(baseUri.toString(), uris);
      }
    }

    return uris;
  }

  private async discoverModuleNames(rootUri: URI): Promise<string[]> {
    const names = new Set<string>();

    for (const prefix of ['app/modules', 'modules']) {
      const dirUri = Utils.joinPath(rootUri, prefix).toString();
      try {
        const entries = await this.fs.readDirectory(dirUri);
        for (const [name, type] of entries) {
          if (type === FileType.Directory) {
            // Extract the module name from the entry.
            // readDirectory may return a full URI (file:///…/modules/admin) or
            // a bare name ("admin"). Use URI.parse().path to normalise, then
            // take the last non-empty segment.
            const parsed = URI.parse(name).path || name;
            const segments = parsed.split('/').filter((s) => s.length > 0);
            const moduleName = segments[segments.length - 1];
            if (moduleName) names.add(moduleName);
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return Array.from(names);
  }

  private async walkDirectory(dirUri: string, results: string[]): Promise<void> {
    let entries: [string, FileType][];
    try {
      entries = await this.fs.readDirectory(dirUri);
    } catch {
      return;
    }

    const subdirs: Promise<void>[] = [];
    for (const [name, type] of entries) {
      if (type === FileType.Directory) {
        subdirs.push(this.walkDirectory(name, results));
      } else if (type === FileType.File && name.endsWith('.liquid')) {
        // All platformOS page files use the .liquid extension (e.g. page.html.liquid,
        // page.json.liquid). Non-.liquid pages are not supported by the platform.
        results.push(name);
      }
    }
    await Promise.all(subdirs);
  }
}
