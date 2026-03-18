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

  // Parse optional groups: split on `(` to get each group, strip `)` and leading `/`
  const optionalGroups: RouteSegment[][] = [];
  const groupRegex = /\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = groupRegex.exec(optionalPart)) !== null) {
    const groupContent = match[1];
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
 * Segment weights:
 * - Static/hardcoded: 100 points
 * - Required parameter (:param): 10 points
 * - Optional parameter (inside parens): 1 point
 *
 * Base: weighted_size * -100
 * Adjustments: slug='/' +1, format='html' +1, format-in-last-component -1
 */
export function calculatePrecedence(slug: string, format: string): number {
  if (slug === '/' || slug === '') {
    // Special case for root: weighted_size=0 -> use 1
    let precedence = 1 * -100;
    precedence += 1; // root "/" adjustment
    if (format === 'html') precedence += 1;
    return precedence;
  }

  // Split on `(?/` boundary to get all segments with their weight context
  // The Ruby code: slug.split(%r{\(?/}).inject(0) { ... }
  const parts = slug.split(/\(?\//);
  let weightedSize = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    if (part.startsWith(':')) {
      weightedSize += part.endsWith(')') ? 1 : 10;
    } else if (part.startsWith('*')) {
      weightedSize += part.endsWith(')') ? 1 : 10;
    } else {
      weightedSize += 100;
    }
  }

  let precedence = (weightedSize === 0 ? 1 : weightedSize) * -100;

  if (format === 'html') precedence += 1;

  // Check if format is embedded in last slug component (e.g. `data.json`)
  const lastSlash = slug.lastIndexOf('/');
  const lastComponent = lastSlash >= 0 ? slug.slice(lastSlash + 1) : slug;
  // Strip optional group parens for checking
  const cleanLast = lastComponent.replace(/[()]/g, '');
  const dotIdx = cleanLast.lastIndexOf('.');
  if (dotIdx > 0 && dotIdx < cleanLast.length - 1) {
    precedence -= 1;
  }

  return precedence;
}
