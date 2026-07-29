/**
 * Derives a URL slug from a page file path relative to the pages directory.
 *
 * Rules (ported from Ruby Page.default_routing_options):
 * 1. Strip file extensions: first `.liquid`, then `.{format}` (e.g. `.html`)
 * 2. If result is `index` -> slug = `/`
 * 3. If result ends with `/index` -> strip it (e.g. `test/index` -> `test`)
 * 4. If result is `home` -> slug = `/` (deprecated alias for root)
 * 5. Otherwise slug = the remaining path
 */
export function slugFromFilePath(relativeToPages: string, format: string = 'html'): string {
  // Strip .liquid extension first
  let slug = relativeToPages;
  if (slug.endsWith('.liquid')) {
    slug = slug.slice(0, -'.liquid'.length);
  }

  // Strip .{format} extension (e.g. .html, .json)
  if (slug.endsWith(`.${format}`)) {
    slug = slug.slice(0, -`.${format}`.length);
  }

  // index -> root
  if (slug === 'index') {
    return '/';
  }

  // path/to/index -> path/to
  if (slug.endsWith('/index')) {
    return slug.slice(0, -'/index'.length);
  }

  // home -> root (deprecated alias)
  if (slug === 'home') {
    return '/';
  }

  return slug;
}

/**
 * The effective URL slug for a page, given its path relative to the pages
 * directory and its parsed frontmatter — the single source of truth shared by
 * {@link RouteTable} and any consumer that needs a page's routing slug (e.g. the
 * dependency graph's self-structural).
 *
 * The rule (ported from the platform): an explicit frontmatter `slug` override
 * wins verbatim (coerced to a string, since YAML may parse it as a non-string);
 * otherwise the slug is derived from the path using the effective format (a
 * frontmatter `format` override, else the format read from the filename).
 *
 * `frontmatter` fields are typed `unknown` because callers pass loosely-parsed
 * YAML; only string values are honoured (matching RouteTable's behaviour).
 */
export function effectivePageSlug(
  relativeToPages: string,
  frontmatter?: { slug?: unknown; format?: unknown } | null,
): string {
  if (frontmatter?.slug !== undefined && frontmatter.slug !== null) {
    return String(frontmatter.slug);
  }
  const format =
    typeof frontmatter?.format === 'string' && frontmatter.format
      ? frontmatter.format
      : formatFromFilePath(relativeToPages);
  return slugFromFilePath(relativeToPages, format);
}

/**
 * Known response formats supported by the platformOS engine.
 * Derived from the platform's FORMAT_ENUM.
 */
export const KNOWN_FORMATS = new Set([
  'html',
  'json',
  'xml',
  'rss',
  'csv',
  'pdf',
  'css',
  'text',
  'js',
  'txt',
  'svg',
  'ics',
]);

/**
 * Extracts the format from a page filename.
 * Returns the format if the file has a double extension like `.json.liquid` or `.xml.liquid`
 * and the extension is a known platformOS format.
 * Returns 'html' as the default if only `.liquid` is present or the extension is unknown.
 */
export function formatFromFilePath(relativeToPages: string): string {
  // Strip .liquid first
  let name = relativeToPages;
  if (name.endsWith('.liquid')) {
    name = name.slice(0, -'.liquid'.length);
  }

  // Check for a remaining extension
  const lastDot = name.lastIndexOf('.');
  const lastSlash = name.lastIndexOf('/');
  if (lastDot > lastSlash && lastDot > 0) {
    const ext = name.slice(lastDot + 1);
    if (KNOWN_FORMATS.has(ext)) {
      return ext;
    }
  }

  return 'html';
}
