import { App, AppFile, RouteTable, UriString } from '@platformos/platformos-common';

import { UNKNOWN, fingerprintOf } from './fingerprints';
import { NodeFileSystem } from './NodeFileSystem';

/**
 * The route table this process is serving, the project it belongs to, and what
 * each page looked like when it went in.
 *
 * `MissingPage` is a recommended check and needs the whole project's routes, which
 * `RouteTable.build()` gets by reading EVERY page's frontmatter. That cost is reads, not
 * ASTs, so lazy parsing does nothing for it — holding one table per process is what
 * removes it, and the fingerprints are what make that safe: a long-lived process must not
 * answer from a table built before the agent it serves started editing files.
 */
let shared: SharedRouteTable | undefined;

interface SharedRouteTable {
  rootUri: UriString;
  table: RouteTable;
  /** Per-page `mtime:size`, or {@link UNKNOWN} when the page's state cannot be compared. */
  fingerprints: Map<UriString, string>;
}

/**
 * Forget the shared route table so the next lint run builds one from the pages
 * currently on disk.
 *
 * Reconciliation already keeps the table honest about added, changed and deleted
 * pages, so this is for embedders that replace the project under a running
 * process by other means — and for tests.
 */
export function resetRouteTable(): void {
  shared = undefined;
}

/**
 * The process's route table for `rootUri`, reconciled against `app`.
 *
 * The first call for a project reads every page — that data has to come from
 * somewhere. Later calls `stat` each page instead and re-read only the ones whose
 * `mtime`/`size` moved, so an unchanged project costs zero page reads while an
 * edited, added or deleted page is still reflected without rebuilding the table.
 *
 * A page carrying an unsaved buffer is registered from the BUFFER's content, so
 * validating a page before it is written resolves that page's own route from what
 * is about to be saved rather than from the stale copy on disk.
 */
export async function getSharedRouteTable(rootUri: UriString, app: App): Promise<RouteTable> {
  if (shared?.rootUri !== rootUri) {
    shared = { rootUri, table: new RouteTable(NodeFileSystem), fingerprints: new Map() };
  }
  const { table, fingerprints } = shared;
  const pages = app.pages();

  if (!table.isBuilt()) {
    const entries = await Promise.all(pages.map((page) => readPage(page)));
    table.buildFromEntries(entries.filter(isPresent).map(({ uri, content }) => [uri, content]));
    for (const { uri, fingerprint } of entries.filter(isPresent))
      fingerprints.set(uri, fingerprint);
    return table;
  }

  await Promise.all(
    pages.map(async (page) => {
      const current = await pageFingerprint(page);
      if (current !== UNKNOWN && fingerprints.get(page.uri) === current) return;

      // The `stat` has already been taken, so `readPage` is told what it found
      // rather than repeating it. It can only be older than the content it labels,
      // which is what makes revalidation conservative.
      const read = await readPage(page, current);
      if (!read) return;
      table.updateFile(read.uri, read.content);
      fingerprints.set(read.uri, read.fingerprint);
    }),
  );

  const live = new Set(pages.map((page) => page.uri));
  for (const uri of [...fingerprints.keys()]) {
    if (live.has(uri)) continue;
    table.removeFile(uri);
    fingerprints.delete(uri);
  }

  return table;
}

/**
 * A page's content plus the fingerprint it had when read, or `undefined` if
 * unreadable. Pass `fingerprint` when the caller has already `stat`ed the page.
 */
async function readPage(
  page: AppFile,
  fingerprint?: string,
): Promise<{ uri: UriString; content: string; fingerprint: string } | undefined> {
  // An overlaid buffer is the authority on its own frontmatter, and its content is
  // already in memory — so this neither reads nor trusts the file on disk.
  const buffered = page.version === undefined ? undefined : page.loadedSource;
  if (buffered !== undefined) {
    return { uri: page.uri, content: buffered, fingerprint: UNKNOWN };
  }

  try {
    const before = fingerprint ?? (await pageFingerprint(page));
    return { uri: page.uri, content: await NodeFileSystem.readFile(page.uri), fingerprint: before };
  } catch {
    // A page that vanished between the glob and this read simply has no route.
    return undefined;
  }
}

/**
 * A page's fingerprint, or {@link UNKNOWN} for one carrying an unsaved buffer —
 * whose content is newer than anything on disk, so no `stat` describes it.
 */
async function pageFingerprint(page: AppFile): Promise<string> {
  if (page.version !== undefined) return UNKNOWN;
  return fingerprintOf(page.uri);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
