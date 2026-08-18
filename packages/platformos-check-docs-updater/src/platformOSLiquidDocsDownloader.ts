import envPaths from 'env-paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger, noop, tap } from './utils';
import he from 'he';
const paths = envPaths('platformos-liquid-docs');
export const root = paths.cache;

export const PlatformOSLiquidDocsRoot = 'https://documentation.platformos.com/api/liquid';
export const PlatformOSGraphQLSchema = 'https://documentation.platformos.com/api/graphql/schema';

export type Resource = (typeof Resources)[number] | (typeof OptionalResources)[number];
export const Resources = ['filters', 'objects', 'tags'] as const;

/**
 * Resources whose ABSENCE is not a failed download.
 *
 * `liquid_doc.json` is newer than the endpoint that serves it. Every consumer reads a missing docset
 * file as "the platform does not have it" and goes quiet, which is the right answer while the
 * documentation site catches up — whereas counting it among the required set would make one 404 abort
 * the whole refresh, and `downloadPlatformOSLiquidDocs` writes nothing unless every file arrived. That
 * is a docset frozen at whatever `data/` shipped, for every user, until the deploy lands.
 *
 * A resource leaves this list when its endpoint is old enough that a 404 means something is wrong.
 */
export const OptionalResources = ['liquid_doc'] as const;

const PLATFORMOS_LIQUID_DOCS: Record<Resource | 'latest', string> = {
  filters: 'filters.json',
  objects: 'objects.json',
  tags: 'tags.json',
  liquid_doc: 'liquid_doc.json',
  latest: 'latest.json',
};

export async function downloadResource(
  resource: Resource | 'latest',
  destination: string = root,
  log: Logger = noop,
) {
  const remotePath = resourceUrl(resource);
  const localPath = resourcePath(resource, destination);
  const text = assertJson(resource, await download(remotePath, log));
  await fs.writeFile(localPath, text, 'utf8');
  return text;
}

export async function downloadGraphQLSchema(destination: string = root, log: Logger = noop) {
  const localPath = graphQLPath(destination);
  const text = await download(PlatformOSGraphQLSchema, log);
  await fs.writeFile(localPath, he.decode(text), 'utf8');
  return text;
}

export function graphQLPath(destination: string = root) {
  return path.join(destination, `graphql.graphql`);
}

/**
 * How long any docs request may take. `setup()` runs a revision check on the LINT path, so an
 * unbounded request hung every consumer that lints for as long as the host held the socket open.
 */
export const DOWNLOAD_TIMEOUT_MS = 3_000;

export async function download(path: string, log: Logger) {
  if (path.startsWith('file:')) {
    return await fs
      .readFile(path.replace(/^file:/, ''), 'utf8')
      .then(tap(() => log(`Using local file: ${path}`)))
      .catch((error) => {
        log(`Failed to read local file: ${path}`);
        throw error;
      });
  } else {
    log(path);
    const res = await fetch(path, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    // A NON-2xx BODY IS NOT DATA. Without this the CDN's own error page — an HTML document
    // served with a 404 or a 502 — was written into `filters.json` verbatim, and the failure
    // surfaced later as a parse error against a file that looks committed and correct.
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} for ${path}`);
    }
    return res.text();
  }
}

/**
 * The body of a resource that must be JSON, or a throw naming the resource.
 *
 * `res.ok` is not enough on its own: a proxy or a login redirect can serve HTML with a 200, and
 * that body is indistinguishable from data until something parses it. Parsing here means a bad
 * response can never reach the disk, which is the difference between a build that fails and a
 * repository with a corrupt docset committed in it.
 */
function assertJson(resource: Resource | 'latest', text: string): string {
  try {
    JSON.parse(text);
  } catch {
    const preview = text.slice(0, 80).replace(/\s+/g, ' ');
    throw new Error(`${resource} did not come back as JSON (starts: ${preview})`);
  }
  return text;
}

export function resourcePath(resource: Resource | 'latest', destination: string = root) {
  return path.join(destination, `${resource}.json`);
}

export function resourceUrl(resource: Resource | 'latest') {
  const resourceRoot = process.env.PLATFORMOS_TLD_ROOT
    ? `file:${process.env.PLATFORMOS_TLD_ROOT}`
    : PlatformOSLiquidDocsRoot;
  const relativePath = PLATFORMOS_LIQUID_DOCS[resource];
  return `${resourceRoot}/${relativePath}`;
}

export async function exists(path: string) {
  try {
    await fs.stat(path);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Refresh every docset file, or leave every one of them alone.
 *
 * FETCH ALL, THEN WRITE. Writing each response as it arrived left the destination TORN on a
 * partial failure — a new `filters.json` beside last release's `tags.json`, and a `latest.json`
 * whose revision claimed a state the other files were not in. `platformOSLiquidDocsManager`
 * gates its refresh on that revision, so a torn write makes the next run decide everything is
 * current and never repair itself.
 *
 * ONE ROUND OF FETCHES, including the GraphQL schema: atomicity comes from deferring the
 * WRITES, not from ordering the reads.
 *
 * An {@link OptionalResources} entry is the exception to all-or-nothing, in one direction only:
 * written when it arrives, skipped when it does not, so a resource whose endpoint does not
 * exist yet cannot hold back the four that do. A file that is simply absent makes its consumer
 * go quiet; the state that breaks things is a file present with the wrong release's contents.
 */
export async function downloadPlatformOSLiquidDocs(destination: string, log: Logger) {
  if (!(await exists(destination))) {
    await fs.mkdir(destination, { recursive: true });
  }

  const required = ['latest'].concat(Resources) as (Resource | 'latest')[];

  const requiredFetches = required.map(async (file) => {
    try {
      const text = assertJson(file, await download(resourceUrl(file), log));
      return { path: resourcePath(file, destination), text };
    } catch (error) {
      log(
        `Failed to download latest resource:\n\t${resourceUrl(file)} to\n\t${resourcePath(
          file,
          destination,
        )}\n${error}`,
      );
      throw error;
    }
  });

  const optionalFetches = OptionalResources.map(async (file) => {
    try {
      return [
        {
          path: resourcePath(file, destination),
          text: assertJson(file, await download(resourceUrl(file), log)),
        },
      ];
    } catch (error) {
      log(`Optional resource ${resourceUrl(file)} is unavailable, skipping it: ${error}`);
      return [];
    }
  });

  const schemaFetch = download(PlatformOSGraphQLSchema, log).then(he.decode);
  // A required resource failing means the schema is never awaited, and an un-awaited rejection is a
  // process-level unhandled rejection. This handler exists only to claim it; the `await` below still sees
  // the rejection, because attaching a handler does not consume the original promise.
  schemaFetch.catch(() => {});

  const fetched = await Promise.all(requiredFetches);
  const optional = (await Promise.all(optionalFetches)).flat();
  const schema = await schemaFetch;

  // Nothing required above threw, so every file below is from the same release.
  for (const { path: localPath, text } of fetched.concat(optional)) {
    await fs.writeFile(localPath, text, 'utf8');
    log(`Successfully downloaded latest resource:\n\t> ${localPath}`);
  }
  await fs.writeFile(graphQLPath(destination), schema, 'utf8');
}
