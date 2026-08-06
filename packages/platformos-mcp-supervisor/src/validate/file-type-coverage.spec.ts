import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { path as pathUtils } from '@platformos/platformos-check-common';
// From `platformos-common`, not check-common, which no longer re-exports it: that package
// is the single owner of what a path IS. This spec's whole purpose is exhaustiveness over
// that enum, so importing it from its owner is what keeps the guard honest.
import { PlatformOSFileType } from '@platformos/platformos-common';

import type { SupervisorContext } from '../context.js';
import { GraphCache } from '../graph-cache/graph-cache.js';
import type { ValidateCodeResult } from '../result/types.js';
import { runValidateCode } from '../transport/validate-code.js';

/**
 * Every file type this server ADMITS must have at least one check that examines it.
 *
 * WHY THIS IS AN INVARIANT AND NOT A FACT. `status: 'ok'` is documented as "the file
 * WAS checked", and `must_fix_before_write: false` is only worth anything if
 * something actually looked. An evaluation found three YAML file-type families where
 * the lint ran and ZERO checks applied — the only two YAML checks returned
 * immediately on any path outside `/translations/` — so a broken model schema came
 * back `ok`. Nothing distinguished that from a file that had been examined and found
 * clean, because on the wire there is no difference.
 *
 * `YAMLSyntaxError` closed that gap, and re-measuring afterwards found no admitted
 * type left uncovered. This file exists so that stays true. The backlog already
 * contains work to ADD file types (scalar patterns, ActivityStreams), and adding one
 * without a check that reads it silently recreates the defect — in the quietest way
 * available, since the new type would simply start returning `ok` for everything.
 *
 * EXHAUSTIVE TWICE, on purpose. `Record<PlatformOSFileType, …>` makes a new enum
 * member a COMPILE error, and the runtime pin below repeats it with a readable
 * message. The compile-time half is the one that cannot be forgotten; the runtime
 * half is the one that explains itself.
 *
 * WHAT IS ASSERTED. That a deliberately broken buffer of each type produces at least
 * one diagnostic — the observable proxy for "something read this file". The exact set
 * of codes is deliberately NOT pinned here: which check objects is check-common's
 * business and will change as checks are added, whereas "somebody objected" is the
 * property this file owns. The four YAML families are the exception and are pinned
 * exactly, because which check covers them is the whole point of the fix.
 */

/** A file of this type, with content something is expected to object to. */
interface Examined {
  filePath: string;
  content: string;
  /** Extra directory spellings for the same type, all of which must behave alike. */
  alsoSpelled?: string[];
}

/** Marker for a type this server does NOT admit — it must decline, not approve. */
const NOT_ADMITTED = Symbol('not admitted');

const BROKEN_LIQUID = "{{ 'a' | no_such_filter_zzz }}\n";
const BROKEN_YAML = `name: car
properties:
 - name: make
   type: string
  year: 1
`;
const BROKEN_GRAPHQL = 'query { no_such_root_field { id } }\n';

const COVERAGE: Record<PlatformOSFileType, Examined | typeof NOT_ADMITTED> = {
  [PlatformOSFileType.Page]: { filePath: 'app/views/pages/i.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Layout]: { filePath: 'app/views/layouts/l.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Partial]: {
    filePath: 'app/views/partials/p.liquid',
    content: BROKEN_LIQUID,
    alsoSpelled: ['app/lib/c.liquid'],
  },
  [PlatformOSFileType.Authorization]: {
    filePath: 'app/authorization_policies/a.liquid',
    content: BROKEN_LIQUID,
  },
  [PlatformOSFileType.Email]: { filePath: 'app/emails/e.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.ApiCall]: { filePath: 'app/api_calls/a.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Sms]: { filePath: 'app/smses/s.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.Migration]: { filePath: 'app/migrations/m.liquid', content: BROKEN_LIQUID },
  [PlatformOSFileType.FormConfiguration]: {
    filePath: 'app/forms/f.liquid',
    content: BROKEN_LIQUID,
  },

  // The four that had nothing at all until `YAMLSyntaxError`.
  [PlatformOSFileType.Table]: {
    filePath: 'app/schema/c.yml',
    content: BROKEN_YAML,
    alsoSpelled: ['app/model_schemas/c.yml', 'app/custom_model_types/c.yml'],
  },
  [PlatformOSFileType.UserProfileType]: {
    filePath: 'app/user_profile_types/u.yml',
    content: BROKEN_YAML,
    alsoSpelled: ['app/instance_profile_types/u.yml', 'app/user_profile_schemas/u.yml'],
  },
  [PlatformOSFileType.TransactableType]: {
    filePath: 'app/transactable_types/t.yml',
    content: BROKEN_YAML,
  },
  [PlatformOSFileType.Translation]: {
    filePath: 'app/translations/en.yml',
    content: BROKEN_YAML,
  },

  // Admitted later than the four above, and the reason this file is a guard rather than
  // a record: each one arrived as a `PlatformOSFileType` with no check written for it,
  // which is exactly the silent regression described at the top. They are covered by
  // `YAMLSyntaxError` for the same reason the families above are — it examines any YAML
  // source, whatever directory it sits in.
  [PlatformOSFileType.ActivityStreamsHandler]: {
    filePath: 'app/activity_streams/handlers/h.yml',
    content: BROKEN_YAML,
  },
  [PlatformOSFileType.ActivityStreamsGroupingHandler]: {
    filePath: 'app/activity_streams/grouping_handlers/g.yml',
    content: BROKEN_YAML,
  },

  // The two SINGLETONS: one file at a fixed path, not a directory of files. Spelled out
  // rather than derived from `getFixedFilePath` on purpose — if the platform ever renames
  // one, this fixture stops being classified and the test fails loudly, where a derived
  // path would quietly follow the rename and assert nothing about the old one.
  [PlatformOSFileType.InstanceConfig]: { filePath: 'app/config.yml', content: BROKEN_YAML },
  [PlatformOSFileType.UserSchema]: { filePath: 'app/user.yml', content: BROKEN_YAML },

  [PlatformOSFileType.GraphQL]: {
    filePath: 'app/graphql/g.graphql',
    content: BROKEN_GRAPHQL,
    alsoSpelled: ['app/graph_queries/g.graphql'],
  },

  // Assets are served, not linted: nothing here has a parser for an image, a stylesheet
  // or a `.js` file, and the `.css/.scss/.js.liquid` partials are excluded the same way.
  // Declining is the honest answer and is what makes the invariant above tractable: a
  // type with no checks must be OUT, not `ok`.
  [PlatformOSFileType.Asset]: NOT_ADMITTED,
};

/**
 * Real assets, in every spelling that matters.
 *
 * WHY A LIST RATHER THAN ONE PATH. This row used to be tested with `app/assets/x.liquid`
 * alone, and that single fixture was measurably the WRONG one: at the time,
 * `isSupportedSourceFile('app/assets/x.liquid', root)` returned `true` — `getFileType`
 * said `Asset`, but a bare `.liquid` has no response format, so `sourceCodeTypeOf` fell
 * back to `html.liquid` and a parser claimed it. The gate refused the file for an
 * unrelated reason, so the test passed while asserting the opposite of what its comment
 * claimed.
 *
 * Both halves are now fixed. `platformos-common` owns the rule (`isParsedFileType`) and
 * applies it in `AppFile` and `isSupportedSourceFile` alike, so an asset is not a source
 * anywhere in the toolchain — the CLI and the language server included, not just this
 * server's gate. These spellings therefore all decline for the SAME reason rather than by
 * accident, and the bare-`.liquid` case is pinned separately below because it is the only
 * one a parser would otherwise have accepted.
 *
 * `.json` is here because a standalone `.json` is an asset on this platform — JSON
 * responses come from `.json.liquid` — so nothing parses it either.
 */
const REAL_ASSETS = [
  'app/assets/logo.png',
  'app/assets/site.css.liquid',
  'app/assets/app.js',
  'app/assets/manifest.json',
];

describe('Integration: every admitted file type is examined by something', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'mcp-sup-coverage-'));
    mkdirSync(join(projectDir, '.git'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  const validate = async (filePath: string, content: string): Promise<ValidateCodeResult> => {
    const ctx: SupervisorContext = {
      projectDir,
      graphCache: new GraphCache({ rootUri: pathUtils.toUri(projectDir) }),
      log: () => {},
    };
    return (await runValidateCode(ctx, { file_path: filePath, content })) as ValidateCodeResult;
  };

  const examined = (result: ValidateCodeResult) => ({
    status: result.status,
    examined: result.errors.length + result.warnings.length + result.infos.length > 0,
  });

  it('has a decision for every PlatformOSFileType, admitted or not', () => {
    // The runtime half of the exhaustiveness guard. `Record<PlatformOSFileType, …>`
    // already makes a new member a compile error; this repeats it with a message that
    // says what to do about it.
    expect(Object.keys(COVERAGE).sort()).toEqual(Object.values(PlatformOSFileType).sort());
  });

  for (const [fileType, fixture] of Object.entries(COVERAGE)) {
    if (fixture === NOT_ADMITTED) {
      it(`${fileType}: declined rather than approved, since nothing lints it`, async () => {
        const outcomes = [];
        for (const filePath of REAL_ASSETS) {
          const result = await validate(filePath, BROKEN_LIQUID);
          outcomes.push({
            status: result.status,
            reason: result.not_applicable_reason,
            blocked: result.must_fix_before_write,
            // The prose must say ASSET, not "not a platformOS source file". The file IS
            // deployed and served — it just has nothing to check — and an author who can
            // see a message is wrong stops reading the ones that are right.
            saysAsset: (result.next_step ?? '').includes('is an asset, not a source file'),
          });
        }

        expect(outcomes).toEqual(
          REAL_ASSETS.map(() => ({
            status: 'not_applicable',
            reason: 'unsupported_type',
            blocked: false,
            saysAsset: true,
          })),
        );
      });

      it(`${fileType}: a bare .liquid under assets/ is refused too, not blocked on`, async () => {
        // THE CASE THAT MADE THIS ROW A LIE, and the reason the gate now refuses assets by
        // TYPE rather than by extension. A bare `.liquid` has no response format, so
        // `sourceCodeTypeOf` falls back to `html.liquid`; the buffer was parsed as Liquid
        // and came back `must_fix_before_write: true` with `LiquidHTMLSyntaxError` — a
        // false block on a file the platform serves as bytes, for the syntax of a language
        // nothing there evaluates. `theme.css.liquid`, the form the platform DOES process,
        // was exempt the whole time.
        //
        // Kept as its own test rather than folded into the list above because it is the
        // only asset spelling a parser accepts: revert the `Asset` branch in
        // `fileApplicability` and this is the single row that fails.
        const result = await validate('app/assets/x.liquid', BROKEN_LIQUID);

        expect({
          status: result.status,
          reason: result.not_applicable_reason,
          blocked: result.must_fix_before_write,
        }).toEqual({ status: 'not_applicable', reason: 'unsupported_type', blocked: false });
      });
      continue;
    }

    it(`${fileType}: a broken buffer is objected to, so 'ok' would have meant something`, async () => {
      const spellings = [fixture.filePath, ...(fixture.alsoSpelled ?? [])];

      const results = [];
      for (const filePath of spellings) {
        results.push(examined(await validate(filePath, fixture.content)));
      }

      // Every directory spelling of one type must behave identically — a type that is
      // covered under `app/schema` and silent under `app/model_schemas` is still a
      // hole, just a harder one to notice.
      expect(results).toEqual(spellings.map(() => ({ status: 'error', examined: true })));
    });
  }

  it('covers every YAML family and directory spelling with YAMLSyntaxError specifically', async () => {
    // Pinned exactly, unlike the rest: these are the families that had NOTHING, and
    // the identity of the check that now covers them is the substance of the fix
    // rather than an implementation detail. If this ever reports a different code —
    // or none — the gap has reopened somewhere.
    //
    // EVERY spelling of every YAML type is listed, including the two fixed-path
    // singletons, because the coverage question is per PATH and not per type: a check
    // that reads `app/schema` and skips `app/model_schemas` leaves a hole in a type this
    // file would otherwise call covered.
    const yamlFiles = [
      'app/schema/c.yml',
      'app/model_schemas/c.yml',
      'app/custom_model_types/c.yml',
      'app/user_profile_types/u.yml',
      'app/instance_profile_types/u.yml',
      'app/user_profile_schemas/u.yml',
      'app/transactable_types/t.yml',
      'app/translations/en.yml',
      'app/activity_streams/handlers/h.yml',
      'app/activity_streams/grouping_handlers/g.yml',
      'app/config.yml',
      'app/user.yml',
    ];

    const codes = [];
    for (const filePath of yamlFiles) {
      const result = await validate(filePath, BROKEN_YAML);
      codes.push([...new Set(result.errors.map((error) => error.check))]);
    }

    expect(codes).toEqual(yamlFiles.map(() => ['YAMLSyntaxError']));
  });
});
