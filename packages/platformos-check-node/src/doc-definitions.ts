import { isLiquidHtmlNode } from '@platformos/liquid-html-parser';
import {
  DocDefinition,
  extractDocDefinition,
  filePathSupportsLiquidDoc,
  memo,
} from '@platformos/platformos-check-common';
import {
  AbstractFileSystem,
  App,
  AppFile,
  Parsers,
  UriString,
  createAppFile,
  joinUri,
} from '@platformos/platformos-common';

/**
 * The `getDocDefinition` a lint run over `app` answers with: the `{% doc %}` contract of the
 * partial at a root-relative path, or `undefined` when that file has none.
 *
 * **Nothing is read here, and nothing is enumerated either.** The map fills in on demand, one
 * memo per path actually asked about, with the `load()` INSIDE the memo body — so a file costs
 * a read and a parse only if some check resolves a `{% render %}` to it. Awaiting the loads at
 * map time would load the whole project; seeding from `app.sourceCodes()` still allocated a
 * closure and an entry for all ~3100 files of a real project on every call.
 *
 * Resolving through the passed `app` — rather than from disk — is also what lets `lintBuffer`'s
 * overlaid buffer be cross-referenced with its UNSAVED `{% doc %}` params.
 *
 * A target the app does not contain still has a contract: see {@link docDefinitionOutsideApp}.
 */
export function makeGetDocDefinition(
  app: App,
  fs: AbstractFileSystem,
  parsers: Parsers,
): (relativePath: string) => Promise<DocDefinition | undefined> {
  const docDefinitions = new Map<string, () => Promise<DocDefinition | undefined>>();

  return (relativePath) => {
    let docDefinition = docDefinitions.get(relativePath);
    if (!docDefinition) {
      // Memoized either way, so a target resolved from twenty call sites is read
      // once per run whether or not the app contains it.
      const file = app.get(joinUri(app.rootUri, relativePath));
      docDefinition = memo(() =>
        file
          ? docDefinitionOf(file, app.rootUri)
          : docDefinitionOutsideApp(relativePath, app, fs, parsers),
      );
      docDefinitions.set(relativePath, docDefinition);
    }
    return docDefinition();
  };
}

/**
 * The `{% doc %}` of a file the app does not contain — one outside the walked
 * subtrees, or one that appeared on disk after this run's walk. `DocumentsLocator`
 * resolves those by `stat`ing candidate paths, so a check can be handed a file the
 * index never saw; without its contract, `PartialCallArguments` infers the parameter
 * list from the source and makes an OPTIONAL param a required argument.
 */
function docDefinitionOutsideApp(
  relativePath: string,
  app: App,
  fs: AbstractFileSystem,
  parsers: Parsers,
): Promise<DocDefinition | undefined> {
  const file = createAppFile(joinUri(app.rootUri, relativePath), app.rootUri, fs, parsers);
  // Not in a platformOS directory at all, so it is not a partial and has no contract.
  if (!file) return Promise.resolve(undefined);
  return docDefinitionOf(file, app.rootUri);
}

/** Read and parse `file`, and pull its `{% doc %}` out of the AST. */
async function docDefinitionOf(
  file: AppFile,
  rootUri: UriString,
): Promise<DocDefinition | undefined> {
  if (!filePathSupportsLiquidDoc(file.uri, rootUri)) return undefined;

  try {
    await file.load();
  } catch {
    // A target that cannot be read has no contract to offer. The caller resolved
    // this path a moment ago, so this is a file deleted mid-run or one we may not
    // read — neither of which is worth failing the whole lint over.
    return undefined;
  }

  const ast = file.ast;
  if (!isLiquidHtmlNode(ast)) return undefined;
  return extractDocDefinition(file.uri, ast);
}
