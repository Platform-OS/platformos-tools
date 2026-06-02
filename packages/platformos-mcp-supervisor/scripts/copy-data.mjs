#!/usr/bin/env node
/**
 * Copies `src/data/` into `dist/data/` after `tsc -b` finishes.
 *
 * The TypeScript compiler emits .js/.d.ts only — non-source assets must be
 * copied manually so runtime loaders (`hint-loader`, `knowledge-loader`)
 * resolve `join(__dirname, '..', 'data')` to a real directory when the
 * package runs from `dist/`.
 *
 * Same path resolution also works in dev (TS sources): `__dirname` is
 * `src/core/`, `..` is `src/`, `data/` is `src/data/`. No fallback needed.
 */
import { cpSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const src = join(pkgRoot, 'src', 'data');
const dst = join(pkgRoot, 'dist', 'data');

if (!existsSync(src)) {
  console.error(`copy-data: source not found at ${relative(pkgRoot, src)}`);
  process.exit(1);
}

cpSync(src, dst, { recursive: true });
