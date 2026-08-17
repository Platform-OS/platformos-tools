import { AbstractFileSystem, FileTuple, FileType, UriString } from '../AbstractFileSystem';
import { APP_SOURCE_SUBTREES } from '../path-utils';
import { relativeUriPath } from './uri';

/** A directory listing, keyed by directory URI, for the lifetime of one walk. */
type ReadDirectory = (uri: UriString) => Promise<FileTuple[]>;

/**
 * A directory the walk was told exists and then could not read.
 *
 * The walk stops rather than skipping it: a lint that quietly covers less of the project than
 * it claims is the failure this area keeps producing. But the raw
 * `EACCES: permission denied, scandir '…'` reads like a crash, so the error is TYPED and
 * self-explaining, and the callers that are a user interface report `message` instead of a stack.
 *
 * The headline names the directory RELATIVE to the project root, the only spelling that reads
 * the same in every runtime — an absolute `file://` URI is percent-encoded on Windows and
 * `fsPath` means nothing under a virtual filesystem. The absolute native path is in the cause.
 *
 * Deliberately not "add it to `ignore`": `ignore` is applied to the paths the walk RETURNS, so
 * it cannot stop the walk from opening the directory in the first place.
 */
export class UnreadableDirectoryError extends Error {
  constructor(
    readonly uri: UriString,
    readonly rootUri: UriString,
    readonly cause: unknown,
  ) {
    super(
      `Cannot read directory: ${relativeUriPath(uri, rootUri)}\n` +
        `  ${cause instanceof Error ? cause.message : String(cause)}\n\n` +
        `It is inside the app, so its contents would be deployed, and skipping it ` +
        `would mean reporting on only part of the project. ` +
        `Fix the directory's permissions, or move it out of the app, then run again.`,
    );
    this.name = 'UnreadableDirectoryError';
  }
}

/**
 * Every file the project deploys, found by walking only the subtrees an app file can live in —
 * `app/`, `marketplace_builder/` and each module's `public/` and `private/`, i.e.
 * {@link APP_SOURCE_SUBTREES}.
 *
 * ANCHORED, never blacklisted. A walk that starts at the root and skips directories by NAME
 * gets it wrong in both directions: it drops `app/views/pages/vendor/**`, which is an entire
 * section of a live site, and it still descends into `tmp/app/views/partials/`. Whether a file
 * belongs to the app is its position relative to the project ROOT.
 *
 * `filter` is the CALLER's domain restriction on top of that, and never sees a path outside the
 * subtrees.
 *
 * Existence is decided by listing the parent, not by probing: most projects have no
 * `marketplace_builder/` and no `modules/`, and an absent subtree must not depend on every
 * `AbstractFileSystem` implementation reporting a missing directory the same way. A directory
 * that IS listed and then fails to read still throws, as an {@link UnreadableDirectoryError},
 * so an unreadable project surfaces rather than silently linting as empty.
 *
 * Hidden entries — anything whose name starts with `.` — are skipped, files and directories
 * alike: Emacs lock files are dangling symlinks named `.#page.liquid` and macOS leaves
 * `._page.liquid` beside every file on a non-native filesystem, either of which would otherwise
 * be classified as a real partial. This is also what the lint's `glob` pattern did
 * (`dot: false`), so the two walks agree file for file.
 */
export async function walkAppSourceFiles(
  fs: AbstractFileSystem,
  rootUri: UriString,
  filter: (fileTuple: FileTuple) => boolean = () => true,
): Promise<UriString[]> {
  // Shared across subtrees on purpose: `modules/*/public` and `modules/*/private`
  // expand through the same `modules/` listing and the same per-module listing.
  const readDirectory = memoizeReadDirectory(fs, rootUri);

  const subtreeUris = await Promise.all(
    APP_SOURCE_SUBTREES.map((subtree) => expandSubtree(readDirectory, rootUri, subtree.split('/'))),
  );

  const files = await Promise.all(
    subtreeUris.flat().map((uri) => collectFiles(readDirectory, uri, filter)),
  );

  return files.flat();
}

/**
 * The directories `segments` names under `baseUri`, with `*` standing for exactly
 * one directory (a module name), skipping the ones that do not exist.
 */
async function expandSubtree(
  readDirectory: ReadDirectory,
  baseUri: UriString,
  segments: string[],
): Promise<UriString[]> {
  if (segments.length === 0) return [baseUri];

  const [segment, ...rest] = segments;
  const entries = await readDirectory(baseUri);
  const matches = entries.filter(
    ([uri, type]) =>
      type === FileType.Directory && (segment === '*' ? !isHidden(uri) : basename(uri) === segment),
  );

  const expanded = await Promise.all(
    matches.map(([uri]) => expandSubtree(readDirectory, uri, rest)),
  );

  return expanded.flat();
}

async function collectFiles(
  readDirectory: ReadDirectory,
  dirUri: UriString,
  filter: (fileTuple: FileTuple) => boolean,
): Promise<UriString[]> {
  const entries = await readDirectory(dirUri);

  const results = await Promise.all(
    entries.map((entry) => {
      const [uri, type] = entry;
      if (isHidden(uri)) return Promise.resolve([]);
      if (type === FileType.Directory) return collectFiles(readDirectory, uri, filter);
      return Promise.resolve(filter(entry) ? [uri] : []);
    }),
  );

  return results.flat();
}

function memoizeReadDirectory(fs: AbstractFileSystem, rootUri: UriString): ReadDirectory {
  const listings = new Map<UriString, Promise<FileTuple[]>>();

  return (uri) => {
    let listing = listings.get(uri);
    if (!listing) {
      // A directory this walk was told about and can no longer read is a deletion
      // racing the walk, not a broken project.
      listing = fs.readDirectory(uri).catch((err: any) => {
        if (err?.code === 'ENOENT') return [];
        throw new UnreadableDirectoryError(uri, rootUri, err);
      });
      listings.set(uri, listing);
    }
    return listing;
  };
}

/** The last path segment of a URI a `readDirectory` returned. */
function basename(uri: UriString): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

function isHidden(uri: UriString): boolean {
  return basename(uri).startsWith('.');
}
