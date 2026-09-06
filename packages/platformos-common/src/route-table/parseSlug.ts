import { RouteSegment } from './types';

/**
 * Parse a single segment string (without slashes) into a RouteSegment.
 * - Starts with `:` -> param
 * - Starts with `*` -> wildcard
 * - Otherwise -> static
 */
function parseSegment(raw: string): RouteSegment {
  // Strip trailing `)` if present (from optional group splitting)
  const cleaned = raw.endsWith(')') ? raw.slice(0, -1) : raw;

  if (cleaned.startsWith(':')) {
    return { type: 'param', name: cleaned.slice(1) };
  }
  if (cleaned.startsWith('*')) {
    return { type: 'wildcard', name: cleaned.slice(1) || '*' };
  }
  return { type: 'static', value: cleaned };
}

function parseSegments(part: string): RouteSegment[] {
  return part
    .split('/')
    .filter((s) => s.length > 0)
    .map(parseSegment);
}

export interface ParsedSlug {
  requiredSegments: RouteSegment[];
  optionalGroups: RouteSegment[][];
}

/**
 * Parse a slug string into required segments and optional groups.
 *
 * Slug syntax:
 *   - `about` -> required: [static('about')]
 *   - `users/:id` -> required: [static('users'), param('id')]
 *   - `users(/:id)` -> required: [static('users')], optional: [[param('id')]]
 *   - `search(/:country)(/:city)` -> required: [static('search')], optional: [[param('country')], [param('city')]]
 *   - `users(/section/*)` -> required: [static('users')], optional: [[static('section'), wildcard('*')]]
 *   - `/` (root) -> required: [], optional: []
 */
export function parseSlug(slug: string): ParsedSlug {
  // Root is special
  if (slug === '/' || slug === '') {
    return { requiredSegments: [], optionalGroups: [] };
  }

  // Split into required part and optional groups by finding `(`
  const firstParen = slug.indexOf('(');

  if (firstParen === -1) {
    // No optional groups
    return {
      requiredSegments: parseSegments(slug),
      optionalGroups: [],
    };
  }

  // Required part is everything before the first `(`
  const requiredPart = slug.slice(0, firstParen);
  const optionalPart = slug.slice(firstParen);

  const requiredSegments = requiredPart.length > 0 ? parseSegments(requiredPart) : [];

  // Parse optional groups: each `(`..`)` pair, stripped of its leading `/`.
  //
  // Scanned rather than matched with `/\(([^)]+)\)/g`: `[^)]+` cannot cross a `)`, so
  // the group always ends at the first `)` after the `(` — exactly what `indexOf` finds —
  // but on a slug of nothing but `(` the quantifier rescans to the end of the string from
  // every one of them, which is O(n²).
  const optionalGroups: RouteSegment[][] = [];
  let cursor = 0;
  while (cursor < optionalPart.length) {
    const open = optionalPart.indexOf('(', cursor);
    if (open === -1) break;
    const close = optionalPart.indexOf(')', open + 1);
    if (close === -1) break;
    cursor = close + 1;

    const groupContent = optionalPart.slice(open + 1, close);
    // Strip leading `/` if present
    const normalized = groupContent.startsWith('/') ? groupContent.slice(1) : groupContent;
    if (normalized.length > 0) {
      optionalGroups.push(parseSegments(normalized));
    }
  }

  return { requiredSegments, optionalGroups };
}

/**
 * Calculate route precedence following the backend's scoring algorithm.
 * Returns a negative number; more negative = higher priority.
 * When sorting ascending, highest-priority routes come first.
 *
 * Segment weights — the engine tests `start_with?(':')` and nothing else, so there are two:
 * - Required parameter (`:param`): 10 points, or 1 inside an optional group
 * - Everything else, a `*` wildcard and an empty component included: 100 points
 *
 * Base: weighted_size * -100
 * Adjustments: slug='/' +1, format='html' +1, format-in-last-component -1
 *
 * Faithful to `Router::RouteBuilder::Route` (`app/models/router/route_builder/route.rb`);
 * `parseSlug.spec.ts` pins it against values measured by running that Ruby.
 */
export function calculatePrecedence(slug: string, format: string): number {
  // Ruby's `String#split` drops trailing empty fields and JavaScript's keeps them; leading
  // and interior empties are kept by both and weigh 100, so `a//b` scores 300.
  const parts = slug.split(/\(?\//);
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();

  let weightedSize = 0;
  for (const part of parts) {
    weightedSize += part.startsWith(':') ? (part.endsWith(')') ? 1 : 10) : 100;
  }

  // `ROOT_SLUGS` is `%w[/]`, so an empty slug is not root — and needs no special case, since
  // it splits to nothing and `weighted_size.zero? -> 1` covers it.
  let precedence = (weightedSize === 0 ? 1 : weightedSize) * -100;
  if (slug === '/') precedence += 1;
  if (format === 'html') precedence += 1;

  // `File.extname` counts a bare trailing dot (`a.` -> `"."`) but not a leading one.
  const lastSlash = slug.lastIndexOf('/');
  const lastComponent = lastSlash >= 0 ? slug.slice(lastSlash + 1) : slug;
  const cleanLast = lastComponent.replace(/[()]/g, '');
  if (cleanLast.lastIndexOf('.') > 0) precedence -= 1;

  return precedence;
}
