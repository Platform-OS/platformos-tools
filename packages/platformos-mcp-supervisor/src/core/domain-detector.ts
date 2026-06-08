import { toPosixPath } from './utils';

/**
 * Domain key derived from a platformOS source file's path. Used to route
 * domain-aware checks (gotchas, structural warnings, scorecard) to the
 * correct rule set.
 *
 * The list mirrors `getDomainFromPath` below. Keep them in lockstep.
 */
export type Domain =
  | 'commands'
  | 'queries'
  | 'pages'
  | 'layouts'
  | 'partials'
  | 'graphql'
  | 'schema'
  | 'translations'
  | 'config';

/**
 * Map a file path to a domain key, or `null` if no domain applies.
 *
 * Substring matches use POSIX-style separators so Windows paths
 * (`C:\…\app\views\pages\home.html.liquid`) resolve identically to Unix
 * paths. Without normalisation the matches silently return `null` on Windows
 * and every downstream domain-aware check sees an empty result.
 *
 * Match order is significant: `lib/commands/` and `lib/queries/` can live
 * under `views/partials/`, so the more specific path prefixes are tested
 * first.
 */
export function getDomainFromPath(absPath: string): Domain | null {
  const p = toPosixPath(absPath);
  if (p.includes('/lib/commands/')) return 'commands';
  if (p.includes('/lib/queries/')) return 'queries';
  if (p.includes('/views/pages/')) return 'pages';
  if (p.includes('/views/layouts/')) return 'layouts';
  if (p.includes('/views/partials/')) return 'partials';
  if (p.includes('/app/graphql/') || p.includes('/graphql/')) return 'graphql';
  if (p.includes('/schema/')) return 'schema';
  if (p.includes('/translations/')) return 'translations';
  if (/\/app\/config\.yml$/.test(p)) return 'config';
  return null;
}
