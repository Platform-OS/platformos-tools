import { afterEach, describe, expect, it } from 'vitest';

import { appCheckRun, Offense } from './index';
import { Tree, Workspace, makeTempWorkspace } from './test/test-helpers';

/**
 * An ignored file is a normal part of the app. `ignore` silences the offenses
 * reported ON it and nothing else — every other file still resolves against it.
 */
describe('files the config ignores are still visible to cross-file checks', () => {
  let workspace: Workspace | undefined;

  afterEach(async () => {
    await workspace?.clean();
    workspace = undefined;
  });

  /** A link and a form whose routes are both defined in the ignored module. */
  const HEADER = [
    '<a href="/inbox">Chat</a>',
    '<form action="/sessions" method="post">',
    '  <input type="hidden" name="_method" value="delete">',
    '</form>',
    '',
  ].join('\n');

  /** `/inbox` (GET) and `/sessions` (DELETE), as pages of an ignored module. */
  const CHAT_MODULE_PAGES: Tree = {
    'inbox.liquid': 'Inbox\n',
    'sessions.liquid': ['---', 'method: delete', '---', 'Signed out\n'].join('\n'),
  };

  function projectTree(chatPages: Tree): Tree {
    return {
      '.platformos-check.yml': [
        'extends: platformos-check:nothing',
        'ignore:',
        '  - modules/chat/**',
        'MissingPage:',
        '  enabled: true',
        '',
      ].join('\n'),
      app: { views: { partials: { 'header.liquid': HEADER } } },
      modules: {
        chat: { public: { views: { pages: chatPages } } },
      },
    };
  }

  it('resolves a route defined by a page in an ignored module', async () => {
    workspace = await makeTempWorkspace(projectTree(CHAT_MODULE_PAGES));

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([]);
  });

  it('still reports the routes that no page defines', async () => {
    workspace = await makeTempWorkspace(projectTree({}));

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([
      {
        check: 'MissingPage',
        uri: workspace.uri('app/views/partials/header.liquid'),
        message: "No page found for route '/inbox' (GET)",
      },
      {
        check: 'MissingPage',
        uri: workspace.uri('app/views/partials/header.liquid'),
        message: "No page found for route '/sessions' (DELETE)",
      },
    ]);
  });

  it('does not report ON the ignored module, whose own link goes nowhere', async () => {
    // `ignore` keeps its meaning: being visible to a check is not being linted by it.
    workspace = await makeTempWorkspace(
      projectTree({
        ...CHAT_MODULE_PAGES,
        'inbox.liquid': '<a href="/ghost">Nowhere</a>\n',
      }),
    );

    const { offenses } = await appCheckRun(workspace.root);

    expect(reported(offenses)).toEqual([]);
  });
});

/** The offenses as a reader of `pos-cli check` output sees them. */
function reported(offenses: Offense[]) {
  return offenses
    .map((offense) => ({
      check: offense.check,
      uri: offense.uri,
      message: offense.message,
    }))
    .sort((a, b) => a.message.localeCompare(b.message));
}
