import {
  LiquidHtmlNode,
  LiquidTag,
  NamedTags,
  NodeTypes,
  Position,
  nonTraversableProperties,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import {
  DocumentsLocator,
  DocumentType,
  PlatformOSFileType,
  UriString,
  loadSearchPaths,
} from '@platformos/platformos-common';
import { URI } from 'vscode-uri';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { isLiquidDocument } from '../../utils';

/**
 * `{% rollback %}` is only meaningful inside `{% transaction %}`: the platform's `RollbackTag`
 * raises `rollback performed outside of transaction` when `AfterCommitEverywhere.in_transaction?`
 * is false, so a rollback reached outside one is a guaranteed runtime error rather than a smell.
 *
 * WHY THIS CANNOT BE A SINGLE-FILE CHECK. A partial does not know its own transaction state —
 * the same `app/lib/order/place.liquid` is correct when a page wraps the call and broken when
 * it does not:
 *
 *     {% transaction %}{% function _ = 'order/place' %}{% endtransaction %}   <- fine
 *     {% function _ = 'order/place' %}                                       <- raises
 *
 * The state is only known at the ROOT of a render tree, so that is where this reports: a root
 * file's own rollbacks, and its calls into partials that reach one. A partial's rollback is
 * never reported where it is written, because the call site decides whether it is a bug.
 */

/** Whether a database transaction is open where a node runs. */
type TransactionState = 'in-transaction' | 'no-transaction' | 'unknown';

/**
 * What a file's render STARTS in, before any `{% transaction %}` it writes itself.
 *
 * A `Record`, not a `switch` with a default, so a new {@link PlatformOSFileType} cannot be
 * added without an answer here.
 *
 * The three `unknown` Liquid entries are deliberate silences, each with a reason:
 *
 *   `Partial` — its caller decides. This is the whole reason the check descends render trees.
 *   `FormConfiguration` — a form's callbacks usually run after `SubmitForm`'s own transaction
 *      has closed, but `Commands::FormSubmitViaMutation` submits a form programmatically, so
 *      `{% transaction %}{% graphql _ = 'submit' %}{% endtransaction %}` runs those same
 *      callbacks INSIDE the caller's transaction.
 *   `Authorization` — evaluated before the thing it guards, and so inherits that same
 *      programmatic-submit path.
 *
 * `Migration` is not a silence but the opposite: `DataMigration#execute_queries` wraps the
 * whole render in `AfterCommitEverywhere.in_transaction`, so a bare `{% rollback %}` in a
 * migration is CORRECT and reporting it would be a false positive.
 */
const ENTRY_STATE: Record<PlatformOSFileType, TransactionState> = {
  // -- Liquid ----------------------------------------------------------------
  [PlatformOSFileType.Page]: 'no-transaction',
  [PlatformOSFileType.Layout]: 'no-transaction',
  // Notifications render in a Sidekiq worker (`NotificationWorker`), never inline.
  [PlatformOSFileType.Email]: 'no-transaction',
  [PlatformOSFileType.ApiCall]: 'no-transaction',
  [PlatformOSFileType.Sms]: 'no-transaction',
  [PlatformOSFileType.Migration]: 'in-transaction',
  [PlatformOSFileType.Partial]: 'unknown',
  [PlatformOSFileType.FormConfiguration]: 'unknown',
  [PlatformOSFileType.Authorization]: 'unknown',

  // -- Not Liquid, so unreachable from a LiquidHtml check ---------------------
  [PlatformOSFileType.Table]: 'unknown',
  [PlatformOSFileType.UserProfileType]: 'unknown',
  [PlatformOSFileType.TransactableType]: 'unknown',
  [PlatformOSFileType.Translation]: 'unknown',
  [PlatformOSFileType.ActivityStreamsHandler]: 'unknown',
  [PlatformOSFileType.ActivityStreamsGroupingHandler]: 'unknown',
  [PlatformOSFileType.InstanceConfig]: 'unknown',
  [PlatformOSFileType.UserSchema]: 'unknown',
  [PlatformOSFileType.GraphQL]: 'unknown',
  [PlatformOSFileType.Asset]: 'unknown',
};

/**
 * The innermost enclosing tag that decides a node's transaction state, or `null` when nothing
 * between the node and the top of its file does.
 *
 * `background` is a BARRIER rather than a wrapper: the platform's own documentation for
 * `{% transaction %}` says a background job scheduled inside one "will only be added to the
 * queue after successfully committing the transaction", and `BackgroundTagWorker#perform`
 * renders it with no transaction of its own. So a job never inherits its scheduler's.
 *
 * `content_for` is a barrier to UNKNOWN: its body runs where the matching `{% yield %}` is,
 * which may be in another file entirely, so its lexical position proves nothing.
 */
type Barrier = NamedTags.transaction | NamedTags.background | NamedTags.content_for | null;

const BARRIERS = new Set<string>([
  NamedTags.transaction,
  NamedTags.background,
  NamedTags.content_for,
]);

function stateInside(barrier: Barrier, entryState: TransactionState): TransactionState {
  switch (barrier) {
    case NamedTags.transaction:
      return 'in-transaction';
    case NamedTags.background:
      return 'no-transaction';
    case NamedTags.content_for:
      return 'unknown';
    case null:
      return entryState;
  }
}

/** Tags that render another Liquid file, and the {@link DocumentType} each resolves through. */
const CALL_TAGS: Partial<Record<string, DocumentType>> = {
  [NamedTags.render]: 'render',
  [NamedTags.include]: 'include',
  [NamedTags.theme_render_rc]: 'theme_render_rc',
  [NamedTags.function]: 'function',
  [NamedTags.background]: 'background',
};

/** How a message names the act of reaching the callee. */
const CALL_VERB: Record<DocumentType, string> = {
  render: 'Rendering',
  include: 'Including',
  theme_render_rc: 'Rendering',
  function: 'Calling',
  background: 'Scheduling',
  graphql: 'Running',
  asset: 'Loading',
  layout: 'Rendering',
};

type RollbackSite = { kind: 'rollback'; position: Position; barrier: Barrier };
type CallSite = {
  kind: 'call';
  docType: DocumentType;
  name: string;
  position: Position;
  barrier: Barrier;
};
type Site = RollbackSite | CallSite;

function callSiteOf(tag: LiquidTag, barrier: Barrier): CallSite | undefined {
  const docType = CALL_TAGS[tag.name];
  if (!docType) return undefined;

  // A string markup is the tolerant parser's "this tag's syntax did not match"; the block form
  // of `{% background %}` has no partial at all; and a computed name is not resolvable here.
  const markup = tag.markup;
  if (!markup || typeof markup === 'string' || !('partial' in markup)) return undefined;
  if (markup.partial.type === NodeTypes.VariableLookup) return undefined;

  return { kind: 'call', docType, name: markup.partial.value, position: tag.position, barrier };
}

/**
 * Every `{% rollback %}` and every call into another file, each tagged with the barrier it sits
 * under — a pure function of one file's AST, and therefore memoizable against the parse.
 *
 * Sorted by source position so a file's offenses come out in reading order.
 */
export function collectSites(ast: LiquidHtmlNode): Site[] {
  const sites: Site[] = [];
  const stack: { node: any; barrier: Barrier }[] = [{ node: ast, barrier: null }];

  while (stack.length > 0) {
    const { node, barrier } = stack.pop()!;
    let childBarrier = barrier;

    if (node.type === NodeTypes.LiquidTag) {
      const tag = node as LiquidTag;
      if (tag.name === NamedTags.rollback) {
        sites.push({ kind: 'rollback', position: tag.position, barrier });
        continue;
      }

      const call = callSiteOf(tag, barrier);
      if (call) sites.push(call);
      if (BARRIERS.has(tag.name)) childBarrier = tag.name as Barrier;
    }

    for (const key of Object.keys(node)) {
      if (nonTraversableProperties.has(key)) continue;
      const value = node[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child === 'object' && typeof child.type === 'string') {
          stack.push({ node: child, barrier: childBarrier });
        }
      }
    }
  }

  return sites.sort((a, b) => a.position.start - b.position.start);
}

/** The callee's transaction state, which a `{% background %}` job never inherits. */
function calleeState(call: CallSite, entryState: TransactionState): TransactionState {
  if (call.docType === 'background') return 'no-transaction';
  return stateInside(call.barrier, entryState);
}

const RAISES = 'At runtime the platform raises "rollback performed outside of transaction".';
const BACKGROUND_REASON =
  'A {% background %} job runs only after the transaction that scheduled it commits, so it is never inside one.';

function reason(barrier: Barrier): string {
  return barrier === NamedTags.background ? ` ${BACKGROUND_REASON}` : '';
}

export const RollbackOutsideTransaction: LiquidCheckDefinition = {
  meta: {
    code: 'RollbackOutsideTransaction',
    name: 'Rollback outside of a transaction',
    docs: {
      description:
        'Reports `{% rollback %}` that is reached outside a `{% transaction %}` block, either directly or through a `{% render %}`, `{% function %}` or `{% background %}` call, which raises a runtime error.',
      recommended: true,
      url: 'https://documentation.platformos.com/developer-guide/platformos-check/checks/rollback-outside-transaction',
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const locator = new DocumentsLocator(context.fs, context.app);
    const rootUri = URI.parse(context.config.rootUri);
    const fileType = context.fileType();
    const entryState = fileType ? ENTRY_STATE[fileType] : 'unknown';

    let searchPathsPromise: Promise<string[] | null> | undefined;
    const locations = new Map<string, Promise<UriString | undefined>>();

    /** One resolution per (kind, name) per file checked — a miss otherwise re-walks the disk. */
    function locate(docType: DocumentType, name: string): Promise<UriString | undefined> {
      const key = `${docType} ${name}`;
      let location = locations.get(key);
      if (!location) {
        location =
          docType === 'theme_render_rc'
            ? (searchPathsPromise ??= loadSearchPaths(context.fs, rootUri)).then((searchPaths) =>
                locator.locate(rootUri, docType, name, searchPaths),
              )
            : locator.locate(rootUri, docType, name);
        locations.set(key, location);
      }
      return location;
    }

    /**
     * The callee's sites, held against its parse rather than recomputed: a partial called from
     * ten places is walked once per run, and an unsaved editor buffer is what gets analysed.
     * The `fs` fallback covers a URI outside the walked subtrees, which has no `AppFile`.
     */
    async function sitesOf(uri: UriString): Promise<Site[] | undefined> {
      const file = context.app.get(uri);
      if (file) {
        await file.load();
        const ast = file.ast;
        if (!isLiquidDocument(ast)) return undefined;
        return file.derived('rollbackSites', () => collectSites(ast));
      }

      try {
        return collectSites(toLiquidHtmlAST(await context.fs.readFile(uri)));
      } catch {
        return undefined;
      }
    }

    /**
     * The shortest chain of partial names from `name` down to a `{% rollback %}` that no
     * `{% transaction %}` covers, or `null`. Direct hits are preferred over deeper ones so the
     * reported chain is the shortest explanation, not the first one the walk stumbles into.
     */
    async function chainToRollback(
      docType: DocumentType,
      name: string,
      visited: Set<string>,
    ): Promise<string[] | null> {
      const uri = await locate(docType, name);
      if (!uri || visited.has(uri)) return null;
      visited.add(uri);

      const sites = await sitesOf(uri);
      if (!sites) return null;

      const escapes = (site: Site) =>
        site.kind === 'rollback'
          ? stateInside(site.barrier, 'no-transaction') === 'no-transaction'
          : calleeState(site, 'no-transaction') === 'no-transaction';

      if (sites.some((site) => site.kind === 'rollback' && escapes(site))) return [name];

      for (const site of sites) {
        if (site.kind !== 'call' || !escapes(site)) continue;
        const chain = await chainToRollback(site.docType, site.name, visited);
        if (chain) return [name, ...chain];
      }

      return null;
    }

    return {
      async onCodePathEnd(file) {
        // `context.file` rather than the argument: they are the same file, but only the
        // `AppFile` carries the `derived` memo, so the walk this run does here is the same
        // one a page that renders this file gets for free when it descends into it.
        const sites = context.file.derived('rollbackSites', () => collectSites(file.ast));

        for (const site of sites) {
          if (site.kind === 'rollback') {
            if (stateInside(site.barrier, entryState) !== 'no-transaction') continue;

            context.report({
              message: `{% rollback %} is not inside a {% transaction %} block.${reason(
                site.barrier,
              )} ${RAISES}`,
              startIndex: site.position.start,
              endIndex: site.position.end,
            });
            continue;
          }

          if (calleeState(site, entryState) !== 'no-transaction') continue;

          const chain = await chainToRollback(site.docType, site.name, new Set());
          if (!chain) continue;

          const through = chain.length > 1 ? ` (${chain.join(' → ')})` : '';
          const because =
            site.docType === 'background' ? ` ${BACKGROUND_REASON}` : reason(site.barrier);

          context.report({
            message: `${CALL_VERB[site.docType]} '${site.name}' reaches a {% rollback %} that is not inside a {% transaction %} block${through}.${because} ${RAISES}`,
            startIndex: site.position.start,
            endIndex: site.position.end,
          });
        }
      },
    };
  },
};
