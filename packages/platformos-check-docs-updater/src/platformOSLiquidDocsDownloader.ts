import envPaths from 'env-paths';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger, noop, tap } from './utils';
import he from 'he';
const paths = envPaths('platformos-liquid-docs');
export const root = paths.cache;

export const PlatformOSLiquidDocsRoot = 'https://documentation.platformos.com/api/liquid';
export const PlatformOSGraphQLSchema = 'https://documentation.platformos.com/api/graphql/schema';

export type Resource = (typeof Resources)[number];
export const Resources = ['filters', 'objects', 'tags', 'platformos_system_translations'] as const;

const PLATFORMOS_LIQUID_DOCS: Record<Resource | 'latest', string> = {
  filters: 'filters.json',
  objects: 'objects.json',
  tags: 'tags.json',
  latest: 'latest.json',
  platformos_system_translations: 'data/platformos_system_translations.json',
};

export async function downloadResource(
  resource: Resource | 'latest',
  destination: string = root,
  log: Logger = noop,
) {
  const remotePath = resourceUrl(resource);
  const localPath = resourcePath(resource, destination);
  const text = await download(remotePath, log);
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
    const res = await fetch(path);
    return res.text();
  }
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

export async function downloadPlatformOSLiquidDocs(destination: string, log: Logger) {
  if (!(await exists(destination))) {
    await fs.mkdir(destination);
  }

  const resources = ['latest'].concat(Resources) as (Resource | 'latest')[];
  await Promise.all(
    resources.map((file) => {
      return downloadResource(file, destination, log)
        .then(
          tap(() =>
            log(
              `Successfully downloaded latest resource:\n\t${resourceUrl(file)}\n\t> ${resourcePath(
                file,
                destination,
              )}`,
            ),
          ),
        )
        .catch((error) => {
          log(
            `Failed to download latest resource:\n\t${resourceUrl(file)} to\n\t${resourcePath(
              file,
              destination,
            )}\n${error}`,
          );
          throw error;
        });
    }),
  );

  // platformOS does not use JSON schemas for sections/blocks/settings, so
  // there are no additional schemas to download.

  await downloadGraphQLSchema(destination, log);
}
