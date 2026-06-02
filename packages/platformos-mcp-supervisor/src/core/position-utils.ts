/**
 * Shared position utilities — offset ↔ line:col conversion and path-derived
 * slug helpers.
 *
 * Single source of truth for these conversions (previously duplicated in
 * `fix-generator` and `structural-warnings`).
 *
 * Line/character coordinates are 0-based to match LSP. Callers that surface
 * positions to humans (validate_code final response) convert to 1-based at
 * the edge.
 */

export interface LineCol {
  /** 0-based line number. */
  line: number;
  /** 0-based column index (LSP terminology: "character"). */
  character: number;
}

/**
 * Convert a 0-based byte offset into a `{ line, character }` position.
 */
export function offsetToLineCol(content: string, offset: number): LineCol {
  let line = 0;
  let col = 0;
  const cap = Math.min(offset, content.length);
  for (let i = 0; i < cap; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, character: col };
}

/**
 * Convert a 0-based line + column into a byte offset.
 *
 * The column is clamped to the line's actual length so out-of-range inputs
 * resolve to the line's end-of-content position rather than overrunning.
 */
export function lineColToOffset(content: string, line: number, col: number): number {
  const lines = content.split('\n');
  let offset = 0;
  const stop = Math.min(line, lines.length);
  for (let i = 0; i < stop; i++) {
    offset += lines[i].length + 1; // +1 for the stripped \n
  }
  return offset + Math.min(col, (lines[line] ?? '').length);
}

/**
 * Derive a suggested page slug from a file path.
 *
 *   app/views/pages/blog_posts/show.html.liquid → blog_posts/show
 *   app/views/pages/blog_posts/new.liquid       → blog_posts/new
 *   app/views/pages/index.liquid                → ''  (root)
 *
 * Handles both relative and absolute paths.
 */
export function slugFromPath(filePath: string | null | undefined): string {
  if (!filePath) return 'your-page-url';
  const rel = filePath
    .replace(/^.*app\/views\/pages\//, '')
    .replace(/\.html\.liquid$/, '')
    .replace(/\.liquid$/, '');
  return rel === 'index' ? '' : rel;
}
