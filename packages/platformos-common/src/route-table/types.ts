export type RouteSegment =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string }
  | { type: 'wildcard'; name: string };

export interface RouteEntry {
  /** The resolved slug, e.g. "users/:id" or "/" */
  slug: string;
  /** HTTP method: get, post, put, patch, delete. Default: "get" */
  method: string;
  /** Response format: html, json, xml, etc. Default: "html" */
  format: string;
  /** URI of the source .liquid file */
  uri: string;
  /** Parsed required segments */
  requiredSegments: RouteSegment[];
  /** Parsed optional segment groups (each group is a sequence of segments) */
  optionalGroups: RouteSegment[][];
  /**
   * Computed precedence score. More negative = higher priority.
   * Scores are negative (e.g. -10000 for a route with many static segments).
   * When sorting, ascending order puts highest-priority routes first.
   */
  precedence: number;
}
