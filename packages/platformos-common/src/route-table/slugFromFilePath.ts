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
  const slug = stripPageExtensions(relativeToPages, format);

  // index -> root
  if (slug === 'index') {
    return '/';
  }

  // path/to/index -> path/to
  if (slug.endsWith('/index')) {
    return slug.slice(0, -'/index'.length);
  }

  // home -> root (deprecated alias)
  if (slug === DEPRECATED_ROOT_ALIAS) {
    return '/';
  }

  return slug;
}

/** The deprecated spelling of the root page (rule 4); the modern one is `index`. */
const DEPRECATED_ROOT_ALIAS = 'home';

/** `p` without its `.liquid` suffix, tolerated absent. */
function stripLiquidExtension(p: string): string {
  return p.endsWith('.liquid') ? p.slice(0, -'.liquid'.length) : p;
}

/**
 * Rule 1 above on its own: `relativeToPages` with `.liquid` and then `.{format}`
 * stripped. Tolerates the absence of either, so a page's logical NAME (extension
 * already off, format kept — `home.html`) is as valid an input as its path.
 */
function stripPageExtensions(relativeToPages: string, format: string): string {
  const slug = stripLiquidExtension(relativeToPages);
  return slug.endsWith(`.${format}`) ? slug.slice(0, -`.${format}`.length) : slug;
}

/**
 * Whether this page spells the ROOT page through the deprecated `home` alias (rule 4
 * above) rather than `index`. Rule 4 is the only way to learn this — the slug alone
 * cannot say which of `home` and `index` produced its `/`.
 *
 * Accepts the pages-relative path (`home.html.liquid`) or the page's logical name
 * (`home.html`, `home`). `blog/home` is NOT the alias: its slug is `blog/home`.
 */
export function isDeprecatedHomeAlias(relativeToPages: string): boolean {
  return (
    stripPageExtensions(relativeToPages, formatFromFilePath(relativeToPages)) ===
    DEPRECATED_ROOT_ALIAS
  );
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
  const name = stripLiquidExtension(relativeToPages);

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
