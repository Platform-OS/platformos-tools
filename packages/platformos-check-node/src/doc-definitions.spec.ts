import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { appCheckRun, Offense } from './index';
import {
  Tree,
  Workspace,
  lintBufferOffenses,
  makeTempWorkspace,
  withCountedLiquidParses,
} from './test/test-helpers';

/**
 * A render target's `{% doc %}` is its contract whether or not the target is itself
 * linted: with no contract, `PartialCallArguments` infers the parameter list from the
 * source and makes an OPTIONAL `[class]` a required argument at every call site.
 */
describe('doc definitions for an ignored render target', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
  });

  const RENDER_CALL = "{% render 'modules/common-styling/user/avatar', size: '2xl' %}";

  /** The target's own contract: `size` required, `class` optional. */
  const AVATAR_WITH_DOC = [
    '{% doc %}',
    '  @param {string} size - avatar size',
    '  @param {string} [class] - additional CSS classes',
    '{% enddoc %}',
    '<img class="{{ class }}" alt="{{ size }}">',
    '',
  ].join('\n');

  /** The same partial with no contract, where inferring from the source is correct. */
  const AVATAR_WITHOUT_DOC = '<img class="{{ class }}" alt="{{ size }}">\n';

  function projectTree(avatar: string, checks: string[] = ['PartialCallArguments']): Tree {
    return {
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'ignore:',
        '  - modules/common-styling/**',
        ...checks.flatMap((check) => [`${check}:`, '  enabled: true']),
        '',
      ].join('\n'),
      app: { views: { pages: { 'profile.liquid': RENDER_CALL } } },
      modules: {
        'common-styling': {
          public: { views: { partials: { user: { 'avatar.liquid': avatar } } } },
        },
      },
    };
  }

  it("checks the call site against an ignored target's {% doc %}", async () => {
    workspace = await makeTempWorkspace(projectTree(AVATAR_WITH_DOC));

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([]);
  });

  it('still infers the parameters when the ignored target has no {% doc %}', async () => {
    workspace = await makeTempWorkspace(projectTree(AVATAR_WITHOUT_DOC));

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([
      {
        check: 'PartialCallArguments',
        uri: workspace.uri('app/views/pages/profile.liquid'),
        message: 'Required parameter class must be passed to render call',
      },
    ]);
  });

  it('does not report ON the ignored target, whose own render call is broken', async () => {
    workspace = await makeTempWorkspace(
      projectTree(`${AVATAR_WITH_DOC}{% render 'ghost' %}`, [
        'PartialCallArguments',
        'MissingPartial',
      ]),
    );

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([]);
    // The same call in a non-ignored file IS reported.
    workspace = await makeTempWorkspace({
      ...projectTree(AVATAR_WITH_DOC, ['PartialCallArguments', 'MissingPartial']),
      app: { views: { pages: { 'profile.liquid': `${RENDER_CALL}{% render 'ghost' %}` } } },
    });

    expect(reported((await appCheckRun(workspace.root)).offenses)).toEqual([
      {
        check: 'MissingPartial',
        uri: workspace.uri('app/views/pages/profile.liquid'),
        message: "'ghost' does not exist",
      },
    ]);
  });

  it('reads the ignored target only because a call site resolved it', async () => {
    workspace = await makeTempWorkspace(projectTree(AVATAR_WITH_DOC));
    const root = workspace.root;

    const parsed = await withCountedLiquidParses(() =>
      lintBufferOffenses({
        root,
        filePath: path.join(root, 'app/views/pages/profile.liquid'),
        content: RENDER_CALL,
        configPath: path.join(root, '.platformos-check.yml'),
      }),
    );

    expect(parsed.result).toEqual([]);
    // The visited buffer, then the target its `{% render %}` resolved to. Nothing is
    // read to BUILD the doc-definition map — only what a check actually asks for.
    expect(parsed.parsedUris).toEqual([
      workspace.uri('app/views/pages/profile.liquid'),
      workspace.uri('modules/common-styling/public/views/partials/user/avatar.liquid'),
    ]);
  });
});

/** The offenses as a reader of `pos-cli check` output sees them. */
function reported(offenses: Offense[]) {
  return offenses.map((offense) => ({
    check: offense.check,
    uri: offense.uri,
    message: offense.message,
  }));
}
