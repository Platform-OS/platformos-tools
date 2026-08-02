import { DocumentSelector } from 'vscode';
import { APP_SOURCE_SUBTREES, SOURCE_FILE_EXTENSIONS } from '@platformos/platformos-common';

/**
 * VS Code's language id for a platformOS source extension, where it is not just the
 * extension itself.
 *
 * Language ids are VS Code's fact, not the platform's, and they are not one-to-one
 * with extensions: both YAML spellings are the `yaml` language. This map is the only
 * thing this file gets to decide — WHICH extensions are platformOS sources stays
 * `platformos-common`'s answer, so this list cannot drift out of sync with the lint's
 * again. It did: there was no yaml entry here at all, so VS Code never forwarded a
 * translation, table, user-profile-type or transactable-type buffer to the language
 * server, and none of them got diagnostics, completions or go-to-definition.
 */
const LANGUAGE_ID_BY_EXTENSION = new Map([['yml', 'yaml']]);

/**
 * Extensions that VS Code also sees on masses of files which are not platformOS
 * sources — `.github/workflows/ci.yml`, `docker-compose.yml`, every action and chart
 * in a repository.
 *
 * Their selectors are anchored to the directories an app can live in, so opening a CI
 * config does not hand it to the language server to open, parse and lint. Liquid and
 * GraphQL need no such anchor: a `.liquid` file is a platformOS file wherever it sits,
 * and narrowing them would take diagnostics away from anyone whose file is outside a
 * recognised subtree.
 */
const NEEDS_APP_SUBTREE_ANCHOR = new Set(['yml']);

/**
 * The first segment of every subtree an app file can live in — `app`,
 * `marketplace_builder`, `modules`.
 *
 * This is deliberately looser than {@link APP_SOURCE_SUBTREES}, which pins a module's
 * `public`/`private` level too, and looser than the lint's walk, which anchors at the
 * project ROOT so that `tmp/app/…` is excluded. A `DocumentFilter.pattern` is a plain
 * glob matched against the whole path, with no workspace anchor available here, so
 * matching the first segment at any depth is as tight as this can get. It costs
 * nothing: every YAML check gates on `getFileType`, so a stray `tmp/app/x.yml` that
 * slips through produces no offenses.
 */
const APP_SUBTREE_ROOTS = [...new Set(APP_SOURCE_SUBTREES.map((subtree) => subtree.split('/')[0]))];

/**
 * The document selectors are the documents VS Code sends requests and notifications
 * to the language server for.
 *
 * We specifically don't want to answer completion requests in package.json files and
 * so on. Nor do we want to handle js, css, scss liquid files.
 *
 * There are no `json`/`jsonc` entries. They used to select
 * `**\/{config,locales,sections,templates}/**\/*.json`, which is Shopify's directory
 * layout: platformOS has no sections and no templates, and serves JSON from
 * `.json.liquid`, so a `.json` file is an asset rather than a source. Nothing was
 * being served through them either — `JSONLanguageService` needs
 * `jsonValidationSet.schemas()`, and the platformOS docset returns `[]` for it
 * (`platformOSLiquidDocsManager`: "platformOS does not use JSON schemas"), so its
 * completions, hover and document links were all inert.
 */
export const documentSelectors: DocumentSelector = [
  ...SOURCE_FILE_EXTENSIONS.map((extension) => {
    const bare = extension.slice(1);
    return {
      language: LANGUAGE_ID_BY_EXTENSION.get(bare) ?? bare,
      pattern: NEEDS_APP_SUBTREE_ANCHOR.has(bare)
        ? `**/{${APP_SUBTREE_ROOTS.join(',')}}/**/*${extension}`
        : `**/*${extension}`,
    };
  }),
  { language: 'css', pattern: '**/assets/**/*.css' },
];
