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
 * Extracts the format from a page filename.
 * Returns the format if the file has a double extension like `.json.liquid` or `.xml.liquid`.
 * Returns 'html' as the default if only `.liquid` is present.
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
    if (ext.length > 0 && ext.length <= 10) {
      return ext;
    }
  }

  return 'html';
}
