import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { collidingBufferPaths } from './batch-coherence.js';

/**
 * Two entries resolving to one file used to be linted as one buffer (last
 * one wins) while BOTH entries were reported with the winner's verdict — so a
 * buffer that was never validated came back clean, and reversing the argument order
 * flipped which one was lied about.
 */
const ROOT = path.resolve('/srv/app');
const buffer = (filePath: string, content = 'x') => ({ filePath, content });

describe('Unit: collidingBufferPaths', () => {
  describe('refuses every spelling that resolves to one file', () => {
    it.each([
      [
        'the identical relative path twice',
        'app/views/partials/x.liquid',
        'app/views/partials/x.liquid',
      ],
      [
        'absolute and relative spellings of one file',
        path.join(ROOT, 'app/views/partials/x.liquid'),
        'app/views/partials/x.liquid',
      ],
      [
        'a redundant current-directory segment',
        'app/views/partials/x.liquid',
        'app/views/partials/./x.liquid',
      ],
      [
        'a path that climbs out and back in',
        'app/views/partials/x.liquid',
        'app/views/partials/../partials/x.liquid',
      ],
    ])('%s', (_why, first, second) => {
      const refusal = collidingBufferPaths(ROOT, [
        buffer(first, 'broken'),
        buffer(second, 'clean'),
      ]);

      expect(refusal?.code).toEqual('internal_error');
      // Both spellings are named, so the caller can find the entries to remove.
      expect(refusal?.reason).toContain(first);
      expect(refusal?.reason).toContain(second);
    });
  });

  it('refuses regardless of argument order', () => {
    const one = 'app/views/partials/x.liquid';
    const two = path.join(ROOT, 'app/views/partials/x.liquid');

    expect(collidingBufferPaths(ROOT, [buffer(one), buffer(two)])?.code).toEqual('internal_error');
    expect(collidingBufferPaths(ROOT, [buffer(two), buffer(one)])?.code).toEqual('internal_error');
  });

  it('refuses even when the colliding buffers carry identical content', () => {
    // Safe to merge in principle, but "same path twice" is a caller bug either way
    // and a content-equality carve-out is one more branch that can be wrong.
    const refusal = collidingBufferPaths(ROOT, [
      buffer('app/views/pages/a.liquid', 'same'),
      buffer('app/views/pages/a.liquid', 'same'),
    ]);

    expect(refusal?.code).toEqual('internal_error');
  });

  it('names every colliding group, not just the first', () => {
    const refusal = collidingBufferPaths(ROOT, [
      buffer('app/views/pages/a.liquid'),
      buffer('app/views/pages/b.liquid'),
      buffer('app/views/pages/a.liquid'),
      buffer('app/views/pages/b.liquid'),
    ]);

    expect(refusal?.reason).toContain('a.liquid');
    expect(refusal?.reason).toContain('b.liquid');
  });

  it('reports a file repeated three times as one group', () => {
    const refusal = collidingBufferPaths(ROOT, [
      buffer('app/views/pages/a.liquid'),
      buffer('app/views/pages/a.liquid'),
      buffer('app/views/pages/a.liquid'),
    ]);

    expect(refusal?.code).toEqual('internal_error');
  });

  describe('allows requests that name each file once', () => {
    it('accepts distinct files', () => {
      expect(
        collidingBufferPaths(ROOT, [
          buffer('app/views/pages/a.liquid'),
          buffer('app/views/partials/b.liquid'),
          buffer('app/graphql/c.graphql'),
        ]),
      ).toBeUndefined();
    });

    it('accepts a mix of absolute and relative spellings of DIFFERENT files', () => {
      // The keying this guard protects exists so exactly this request keeps working.
      expect(
        collidingBufferPaths(ROOT, [
          buffer(path.join(ROOT, 'app/views/pages/a.liquid')),
          buffer('app/views/partials/b.liquid'),
        ]),
      ).toBeUndefined();
    });

    it('accepts a single buffer', () => {
      expect(collidingBufferPaths(ROOT, [buffer('app/views/pages/a.liquid')])).toBeUndefined();
    });

    it('accepts an empty request', () => {
      expect(collidingBufferPaths(ROOT, [])).toBeUndefined();
    });

    it('does not treat two different files in one directory as a collision', () => {
      expect(
        collidingBufferPaths(ROOT, [
          buffer('app/views/pages/index.liquid'),
          buffer('app/views/pages/index2.liquid'),
        ]),
      ).toBeUndefined();
    });
  });
});
