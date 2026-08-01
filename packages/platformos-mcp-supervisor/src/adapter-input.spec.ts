import { join, parse } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  bufferTooLarge,
  fileApplicability,
  MAX_BUFFER_BYTES,
  toAbsoluteFilePath,
} from './adapter-input.js';

/**
 * TASK-13: `validate_code` used to lint ANY path. Because check-common's
 * `toSourceCode` types an unrecognized extension as JSON, `/etc/passwd` came back
 * as `ValidJSON: Expected a JSON object, array or literal.` with
 * `must_fix_before_write: true`, and `/etc/shadow` containing `{}` came back
 * `status: 'ok'` — a false approval for a path outside the project.
 *
 * These pin the pure decision. The end-to-end consequence (no lint, no graph
 * lookup, `not_applicable` out) is pinned in `transport/validate-code.spec.ts`.
 */
const PROJECT = join('/srv', 'app');

const applicable = (filePath: string) => fileApplicability(PROJECT, filePath);

/**
 * The two refusal messages, duplicated from the implementation on purpose: the
 * prose is the entire payload of a declined call, so it is pinned exactly rather
 * than pattern-matched. Both must state that nothing was checked — an agent must
 * never read a refusal as a pass.
 */
const outside = (filePath: string) => ({
  applicable: false as const,
  code: 'outside_project' as const,
  reason:
    `\`${filePath}\` resolves outside the project root (${PROJECT}), so there is no project ` +
    `context to validate it against. This server validates only files inside the project it was ` +
    `started for. Nothing was checked — treat this as "unknown", not as approval.`,
});

const unsupported = (relativePath: string) => ({
  applicable: false as const,
  code: 'unsupported_type' as const,
  reason:
    `\`${relativePath}\` is not a platformOS source file, so there are no checks that apply to ` +
    `it. Validation covers Liquid in a recognized platformOS directory, \`.graphql\` operations, ` +
    `and translation / model \`.yml\`. Nothing was checked — writing this file is your call, not ` +
    `a validated pass.`,
});

describe('Unit: fileApplicability', () => {
  describe('accepts every file type the linter would actually visit', () => {
    it.each([
      'app/views/pages/index.liquid',
      'app/views/partials/card.liquid',
      'app/views/layouts/application.liquid',
      'app/lib/helper.liquid',
      // A page that emits JSON is Liquid — classified by the `.liquid` extension,
      // NOT by the `.json` in its name. Exactly the case a naive extension check
      // would misroute into the JSON fallback this gate exists to prevent.
      'app/views/pages/feed.json.liquid',
      'app/graphql/things/search.graphql',
      'app/translations/en.yml',
      'app/schema/thing.yml',
      'modules/mcp/public/views/partials/tool.liquid',
    ])('%s', (filePath) => {
      expect(applicable(filePath)).toEqual({ applicable: true });
    });

    it('accepts an absolute path inside the project', () => {
      expect(applicable(join(PROJECT, 'app/views/pages/index.liquid'))).toEqual({
        applicable: true,
      });
    });

    it('accepts a path whose `..` segments normalize back inside the project', () => {
      expect(applicable('app/views/pages/../partials/card.liquid')).toEqual({ applicable: true });
    });
  });

  describe('declines paths outside the project root', () => {
    // `''` is refused by the zod schema instead — see validate-code.spec.ts.
    it.each([
      ['an absolute system path', '/etc/passwd'],
      ['a relative traversal', '../../../etc/passwd'],
      ['a traversal onto a plausible-looking file', '../other/app/views/pages/x.liquid'],
      ['an absolute path outside the root', '/tmp/scratch/app/views/pages/x.liquid'],
      // A `startsWith` containment test would ACCEPT this, since
      // '/srv/app-backup'.startsWith('/srv/app'). Only a path-segment comparison
      // rejects it — which is why the implementation tests `relative()`'s output.
      ['a sibling root extending the project name', '/srv/app-backup/app/views/pages/x.liquid'],
    ])('%s', (_label, filePath) => {
      expect(applicable(filePath)).toEqual(outside(filePath));
    });

    it.each([
      ['the project root itself', PROJECT],
      ['the project root via a round trip', 'app/..'],
    ])('%s is a directory, not a file under edit', (_label, filePath) => {
      expect(applicable(filePath)).toEqual(outside(filePath));
    });
  });

  describe('declines in-project files that are not platformOS sources', () => {
    it.each([
      ['markdown', 'README.md'],
      ['plain text', 'app/notes.txt'],
      // The extension whose fallback used to swallow everything else.
      ['standalone json', 'app/pos-modules.json'],
      ['ruby', 'script/deploy.rb'],
      ['no extension at all', 'Makefile'],
      // Liquid, but not in a directory platformOS recognizes — check-node's own
      // App-membership filter drops these too.
      ['unclassified liquid', 'scripts/helper.liquid'],
      // Asset partials are excluded by both this gate and check-node's filter.
      ['a css asset partial', 'app/assets/site.css.liquid'],
      ['a js asset partial', 'app/assets/app.js.liquid'],
      // config.yml is a project config file, not a YAML *source*.
      ['project config yaml', 'app/config.yml'],
      ['the check config itself', '.platformos-check.yml'],
    ])('%s', (_label, filePath) => {
      expect(applicable(filePath)).toEqual(unsupported(filePath));
    });

    it('reports the PROJECT-RELATIVE path even when given an absolute one', () => {
      // Forward slashes, spelled literally rather than built with `join`: the reason
      // string is agent-facing, and an agent that sent `app/notes.txt` must get that
      // spelling back on every platform. Building the expectation with `join` made it
      // agree with whatever the host does, so it passed on POSIX while asserting
      // `app\notes.txt` on Windows — the opposite of the contract.
      //
      // Note this assertion cannot FAIL on POSIX if the separator handling regresses,
      // because there is nothing to convert here. What actually guards that is
      // check-common's `path.spec.ts`, which runs the conversion over Windows-shaped
      // input on any host; removing `normalize`'s backslash replace fails it on Linux.
      expect(applicable(join(PROJECT, 'app/notes.txt'))).toEqual(unsupported('app/notes.txt'));
    });
  });

  it('checks containment BEFORE type, so an unsupported outside path cites the root', () => {
    // Both rules reject `/etc/passwd`; the order determines which reason the agent
    // gets, and "outside the project" is the more actionable of the two.
    expect(applicable('/etc/passwd')).toEqual(outside('/etc/passwd'));
  });
});

/**
 * TASK-15. The size bound is the ONLY guard that acts before a pathological buffer
 * reaches the parser, and it is sized against the FULL lint (~61 ms/KiB), not the
 * parse alone — a first attempt used parse-only numbers and was 4x too generous,
 * letting a legal 400 KiB buffer blow the 30 s deadline in an end-to-end run.
 *
 * A deadline cannot substitute for it: the parse is synchronous, so the deadline
 * timer cannot even FIRE during one (that 400 KiB call returned after 45 s against
 * a 30 s deadline), and further out the parser stops completing at all — 2 MiB
 * throws inside ohm's CST→AST recursion, 4 MiB produced a native V8 abort, which
 * no JS-level handler can catch.
 */
describe('Unit: bufferTooLarge', () => {
  const bytes = (n: number) => 'a'.repeat(n);

  it('accepts a buffer at exactly the limit', () => {
    // Boundary is inclusive — an exactly-limit buffer is legal, so `<=` not `<`.
    expect(bufferTooLarge(bytes(MAX_BUFFER_BYTES))).toBeUndefined();
  });

  it('refuses a buffer one byte over the limit', () => {
    const declined = bufferTooLarge(bytes(MAX_BUFFER_BYTES + 1));

    expect(declined?.code).toEqual('too_large');
    expect(declined?.reason).toEqual(
      'The buffer is 128 KiB, above the 128 KiB limit this server will validate, so it was ' +
        'refused before parsing. Liquid validation costs about 61 ms per KiB and the parser stops ' +
        'completing at all a few MiB out, so checking this would risk hanging the server rather ' +
        'than answering. Nothing was checked — consider splitting the file, which is almost ' +
        'certainly worth doing at this size regardless.',
    );
  });

  it('accepts every realistic file size', () => {
    // The largest real source file found across local projects is 76 KiB.
    expect([
      bufferTooLarge(''),
      bufferTooLarge('{% render "card" %}'),
      bufferTooLarge(bytes(76 * 1024)),
      bufferTooLarge(bytes(120 * 1024)),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('counts BYTES, not string length, so multi-byte content cannot slip past', () => {
    // '€' is 3 bytes in UTF-8. A `content.length` check would see a third of the
    // real cost and admit a buffer three times the intended size — straight into
    // the region where the parser stops returning.
    const justUnderByLength = '€'.repeat(Math.floor(MAX_BUFFER_BYTES / 3) + 1);

    expect(justUnderByLength.length).toBeLessThan(MAX_BUFFER_BYTES);
    expect(bufferTooLarge(justUnderByLength)?.code).toEqual('too_large');
  });

  it('reports the actual size in the reason, so the agent knows by how much', () => {
    expect(bufferTooLarge(bytes(2 * 1024 * 1024))?.reason).toContain('The buffer is 2048 KiB');
  });
});

describe('Unit: toAbsoluteFilePath', () => {
  it('joins a relative path onto the project root', () => {
    expect(toAbsoluteFilePath(PROJECT, 'app/views/pages/index.liquid')).toEqual(
      join(PROJECT, 'app/views/pages/index.liquid'),
    );
  });

  it('returns an absolute path unchanged', () => {
    expect(toAbsoluteFilePath(PROJECT, '/etc/passwd')).toEqual('/etc/passwd');
  });

  it('normalizes `..` segments when joining', () => {
    // Expressed against the filesystem ROOT rather than a literal `/etc/passwd`:
    // this resolves with the host's own separator, so on Windows the answer is
    // `\etc\passwd`. Hard-coding the POSIX spelling asserted the platform, not the
    // normalization this test is about.
    const filesystemRoot = parse(PROJECT).root;

    expect(toAbsoluteFilePath(PROJECT, '../../../etc/passwd')).toEqual(
      join(filesystemRoot, 'etc', 'passwd'),
    );
  });
});
