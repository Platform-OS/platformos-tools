import { LiquidHtmlNode, NodeTypes as LiquidHtmlNodeTypes } from '@platformos/liquid-html-parser';

import { Schema, Settings } from './types/schema-prop-factory';

import {
  AbstractFileSystem,
  App as AppModel,
  AppFile,
  GraphQLDocumentNode,
  PlatformOSFileType,
  RouteTable,
  SourceAppFile,
  SourceCodeType,
  UriString,
} from '@platformos/platformos-common';
import { StringCorrector } from './fixes';

import {
  ArrayNode,
  ASTNode,
  JSONNode,
  JSONNodeTypes,
  LiteralNode,
  ObjectNode,
  PropertyNode,
  ValueNode,
} from './jsonc/types';
import { JsonValidationSet, PlatformOSDocset } from './types/platformos-liquid-docs';
import { DocDefinition } from './liquid-doc/liquidDoc';
import { GraphQLCorrector } from './fixes/correctors/graphql-corrector';

export * from './jsonc/types';
export * from './types/schema-prop-factory';
export * from './types/platformos-liquid-docs';

export const isObjectNode = (node?: ASTNode): node is ObjectNode => node?.type === 'Object';
export const isArrayNode = (node?: ASTNode): node is ArrayNode => node?.type === 'Array';
export const isPropertyNode = (node?: ASTNode): node is PropertyNode => node?.type === 'Property';
export const isValueNode = (node?: ASTNode): node is ValueNode => node?.type === 'Value';
export const isLiteralNode = (node?: ASTNode): node is LiteralNode => node?.type === 'Literal';

export type { AppModel, AppFile, SourceAppFile };

export type SourceCode<T = SourceCodeType> = T extends SourceCodeType
  ? {
      /** A normalized uri the file. */
      uri: string;
      /** The type is used as a discriminant for type narrowing */
      type: T;
      /** The version is used by the Language Server to make sure the Client and Server are in sync */
      version?: number;
      /** The contents of the file */
      source: string;
      /** The AST representation of the file, or an Error instance when the file is unparseable */
      ast: AST[T] | Error;
    }
  : never;

/**
 * An {@link AppFile} of a known {@link SourceCodeType}, carrying the AST that type implies.
 *
 * `platformos-common` sits below the parsers that produce ASTs, so an `AppFile`'s `ast` is
 * typed `unknown` while everything else about it already matches `SourceCode`. This type
 * re-attaches the missing knowledge, and is applied where the runtime test that justifies it
 * happens: `filesOfType`, which has just compared `file.type` against the discriminant
 * `sourceParsers` is keyed on.
 *
 * The conditional distributes for the same reason `SourceCode` does — a non-distributed
 * `{ type: SourceCodeType; ast: AST[SourceCodeType] | Error }` decorrelates the two and is
 * not assignable to `SourceCode<SourceCodeType>`.
 */
export type TypedAppFile<T extends SourceCodeType = SourceCodeType> = T extends SourceCodeType
  ? AppFile & { type: T; ast: AST[T] | Error }
  : never;

export { SourceCodeType };

export type LiquidSourceCode = SourceCode<SourceCodeType.LiquidHtml>;

export type LiquidCheckDefinition<S extends Schema = Schema> = CheckDefinition<
  SourceCodeType.LiquidHtml,
  S
>;
export type LiquidCheck = Check<SourceCodeType.LiquidHtml>;

export { LiquidHtmlNode, LiquidHtmlNodeTypes };

/**
 * A `.json` buffer the EDITOR holds open, never a file of the app.
 *
 * `SOURCE_CODE_TYPE_BY_KEY` has no `.json` row, so `AppFile.type` is never
 * `SourceCodeType.JSON` and no such file reaches a check. The type survives for
 * `toSourceCode`'s editor fallback alone, so the JSON language service can answer hover and
 * completion for an open buffer. There is deliberately no `JSONCheck` beside it.
 */
export type JSONSourceCode = SourceCode<SourceCodeType.JSON>;

export type YAMLSourceCode = SourceCode<SourceCodeType.YAML>;
export type YAMLCheckDefinition<S extends Schema = Schema> = CheckDefinition<
  SourceCodeType.YAML,
  S
>;
export type YAMLCheck = Check<SourceCodeType.YAML>;

/**
 * The GraphQL AST, owned by `platformos-common` and re-exported here — never redeclared,
 * exactly like {@link SourceCodeType}. It carries the parsed document as well as the source,
 * so a `.graphql` file is parsed once by the `App` that holds it.
 */
export type { GraphQLDocumentNode };

// AST[SourceCodeType.LiquidHtml] maps to LiquidHtmlNode
export type AST = {
  [T in SourceCodeType]: {
    [SourceCodeType.JSON]: JSONNode;
    [SourceCodeType.LiquidHtml]: LiquidHtmlNode;
    [SourceCodeType.GraphQL]: GraphQLDocumentNode;
    [SourceCodeType.YAML]: JSONNode; // YAML shares the JSONNode AST
  }[T];
};

export type NodeTypes = {
  [T in SourceCodeType]: {
    [SourceCodeType.JSON]: JSONNodeTypes;
    [SourceCodeType.LiquidHtml]: LiquidHtmlNodeTypes;
    [SourceCodeType.GraphQL]: 'Document';
    [SourceCodeType.YAML]: JSONNodeTypes; // YAML shares JSON node types
  }[T];
};

/** A vscode-uri string. */
export type { UriString };

/** Assumes forward slashes for simplicity internally */
export type RelativePath = string;

export type ChecksSettings = {
  [code in string]?: CheckSettings;
};

export type CheckSettings = {
  enabled: boolean;
  severity?: Severity;
  ignore?: string[];
} & {
  [key in string]: any;
};

export type GraphQLSourceCode = SourceCode<SourceCodeType.GraphQL>;
export type GraphQLCheck = Check<SourceCodeType.GraphQL>;
export type GraphQLCheckDefinition<S extends Schema = Schema> = CheckDefinition<
  SourceCodeType.GraphQL,
  S
>;

export interface Config {
  settings: ChecksSettings;
  checks: CheckDefinition<SourceCodeType, Schema>[];
  rootUri: string; // e.g. file:///path-to-root
  ignore?: string[];
  onError?: (error: Error) => void;
}

export type NodeOfType<T extends SourceCodeType, NT> = Extract<AST[T], { type: NT }>;
export type LiquidHtmlNodeOfType<T> = NodeOfType<SourceCodeType.LiquidHtml, T>;
export type JSONNodeOfType<T> = NodeOfType<SourceCodeType.LiquidHtml, T>;

// Very intentionally eslint-like. Not reinventing the wheel + makes the
// eslint plugin writing skills transferable.
//
// The conditional type here is used to distribute the union if
// CheckDefinition is used with the enum instead of a specific enum value.
//
// That is, we want (CheckDefinition<JSON> | CheckDefinition<LiquidHTML>)[]
//    we don't want (CheckDefinition<JSON | LiquidHtml>)[]
export type CheckDefinition<
  T = SourceCodeType,
  S extends Schema = Schema,
> = T extends SourceCodeType
  ? {
      /**
       * The meta object holds information about the check.
       * Its name, documentation, severity, etc.
       */
      meta: {
        /** A human readable name for the check */
        name: string;

        /**
         * A code for the check (shortname without spaces).
         *
         * Used in configurations and IDEs.
         *
         * Should be unique.
         */
        code: string;

        /** For backwards compatibility, alternative code names for the check */
        aliases?: string[];

        /** The severity determines the icon and color of diagnostics */
        severity: Severity.ERROR | Severity.WARNING | Severity.INFO;

        /** Which AST type the check targets, must be one of SourceCodeType. */
        type: T;

        /** Human readable short description of the check as well as link to documentation. */
        docs: {
          description: string;
          recommended?: boolean;
          url?: string;
        };

        /**
         * Schema of settings passed to your check.
         *
         * Used to support validations of your setting values, documentation,
         * and IDE support.
         */
        schema: Schema;

        /**
         * An optional array that determines which yaml configs will have this check enabled.
         *
         * When no values are given, this check will be `enabled: true` in the `all.yml` configuration
         *
         * When values are given, this check will be `enabled: false` in the `all.yml` configuration
         * and `enabled: true` within all yaml configurations with a matching filename.
         */
        targets?: ConfigTarget[];

        deprecated?: boolean;
        replacedBy?: boolean;
      };

      /**
       * A function that returns a Check, the function scope is a good place to
       * initialize state for a run.
       *
       * - One check is created per file
       * - The state is not shared while traversing all files
       * - To report problems, use the context.report method.
       *
       * @example
       *
       * create(context) {
       *   const tags = []
       *
       *   return {
       *     async LiquidTag(node) {
       *       tags.push(node);
       *     },
       *
       *     async onCodePathEnd() {
       *       tags.forEach(tag => {
       *         ...
       *       });
       *     },
       *   }
       * }
       */
      create(context: Context<T, S>): Partial<Check<T>>;
    }
  : never;

/**
 * A Check is an object that defines visitor methods by node type.
 *
 * @example
 * {
 *   async onCodePathStart(file) {
 *     // Happens at the very beginning
 *   },
 *
 *   AssignMarkup: async (node, file) => {
 *     // Happens once per node, while going down the tree
 *   },
 *
 *   async onCodePathEnd(file) {
 *     // Happens at the very end
 *   }
 * }
 *
 * There is one callback per node and no per-node exit callback: accumulate during the
 * walk and act in `onCodePathEnd`.
 */
export type Check<T> = T extends SourceCodeType
  ? Partial<CheckNodeMethods<T> & CheckLifecycleMethods<T>>
  : never;

export type CheckNodeMethod<T extends SourceCodeType, NT> = (
  node: NodeOfType<T, NT>,
  ancestors: AST[T][],
) => Promise<void>;

type CheckNodeMethods<T extends SourceCodeType> = {
  /** Happens once per node, while going down the tree */
  [NT in NodeTypes[T]]: CheckNodeMethod<T, NT>;
};

type CheckLifecycleMethods<T extends SourceCodeType> = {
  /** Happens before traversing a file, file might be unparseable */
  onCodePathStart(file: SourceCode<T>): Promise<void>;

  /** Happens after traversing a file, file is guaranteed to exist */
  onCodePathEnd(file: SourceCode<T> & { ast: AST[T] }): Promise<void>;
};

export type Translations = {
  [k in string]: string | Translations;
};

/**
 * A reference is a link between two modules.
 *
 * @example
 *
 * It could be a specific range that points to a whole file
 * {
 *   source: { uri: 'file:///app/views/partials/parent.liquid', range: [167, 190] },
 *   target: 'file:///app/views/partials/child.liquid'
 * }
 */
/**
 * The semantic Liquid construct that created a {@link Reference} edge.
 *
 * Optional/additive: older producers may omit it. Lets consumers distinguish a
 * `{% render %}` edge from an `{% include %}` / `{% function %}` / `{% graphql %}`
 * / `{% background %}` / asset / layout-association edge without re-parsing.
 */
export type ReferenceKind =
  'render' | 'include' | 'function' | 'background' | 'graphql' | 'asset' | 'layout';

export type Reference = {
  source: Location;
  target: Location;

  type:
    | 'direct' // explicit dependency, e.g. {% render 'partial' %}
    | 'indirect'; // indirect dependency

  /** Which Liquid construct produced this edge. Optional for backwards compatibility. */
  kind?: ReferenceKind;

  /**
   * The names of the named arguments passed at the call site, in source order —
   * e.g. `['title', 'count']` for `{% render 'card', title: x, count: 3 %}`.
   * Present only for edges that carry named arguments (render/include/function/
   * background/graphql); omitted entirely when there are none. Values are not
   * captured (names are what cross-checking against a partial's `@param`
   * signature needs).
   */
  args?: string[];
};

export type Range = [start: number, end: number]; // represents a range in the source code
export type Location = {
  /** The URI of the module */
  uri: UriString;
  /** Optional range inside that module */
  range?: Range;
};

export interface Dependencies {
  /** The file system abstraction used to read files. */
  fs: AbstractFileSystem;

  /** The typing information */
  platformosDocset?: PlatformOSDocset;

  /** The JSON schemas */
  jsonValidationSet?: JsonValidationSet;

  /**
   * Asynchronously get the Liquid HTML AST for a file.
   * May return undefined when the app isn't preloaded.
   *
   * Used in checks for cross-file checks rather than going through fs.
   */
  getDocDefinition?: (relativePath: string) => Promise<DocDefinition | undefined>;

  /**
   * A provider for the run's RouteTable, called at most once per run and only if a check
   * actually asks for routes. The provider OWNS making its table current: check-node's
   * reconciles a process-level table against the pages on disk, the language server's builds
   * its persistent, event-maintained table on first use. Absent means the run builds a
   * throwaway table itself when asked.
   *
   * A provider, never an awaited table: knowing a route means reading every page in the
   * project, and 87-97% of real-world Liquid contains no `<a href>`/`<form action>` whose
   * URL survives `shouldSkipUrl`. The call also lands while `lintBuffer`'s buffer overlay is
   * in place, which is what lets an unsaved page's frontmatter define its own route.
   */
  routeTable?: () => Promise<RouteTable>;
}

export type IsValidSchema = (uri: string, jsonString: string) => Promise<boolean>;

/** The {@link Dependencies} a caller injects, plus everything {@link check} derives. */
export interface AugmentedDependencies extends Dependencies {
  /**
   * The run's {@link AppModel}.
   *
   * `check` fills this in so checks can resolve a `{% render %}` / `{% graphql %}` /
   * `{% asset %}` name through the app's index — an O(1) lookup — instead of `stat`-ing
   * candidate directories in order, which cost ~40,000 `stat` calls per whole-project run on
   * a 400-partial project. Hand it to `DocumentsLocator`, which still walks for a name the
   * index has no answer for.
   *
   * Not optional: a caller that passed a plain array of sources used to get `undefined` here
   * with no diagnostic.
   */
  app: AppModel;
  fileExists: (uri: UriString) => Promise<boolean>;
  getDefaultTranslations(): Promise<Translations>;
  /**
   * Aggregates ALL translation files for `locale` within the given translations
   * base directory (e.g. `file:///app/translations` or
   * `file:///modules/common-styling/public/translations`).
   *
   * Covers both `{base}/{locale}.yml` and `{base}/{locale}/*.yml`.
   */
  getTranslationsForBase(translationBaseUri: string, locale: string): Promise<Translations>;
  /** Lazily builds and returns a shared RouteTable for the current check run. */
  getRouteTable(): Promise<RouteTable>;
}

type StaticContextProperties<T extends SourceCodeType> = T extends SourceCodeType
  ? {
      report(problem: Problem<T>): void;
      toRelativePath(uri: UriString): RelativePath;
      toUri(relativePath: RelativePath): UriString;
      /**
       * What the platform does with the file at `uri`, or `undefined` when it is not
       * part of the app — anchored at `config.rootUri`.
       *
       * Checks must classify through this rather than by calling `getFileType(uri)`
       * with a bare URI, which cannot be anchored and so answers a different question:
       * `seed/post_import/app/migrations/x.liquid` contains `app/migrations/` and is
       * not a migration. Defaults to the file being checked, which is what almost
       * every caller wants.
       */
      fileType(uri?: UriString): PlatformOSFileType | undefined;
      /**
       * The file being checked. A {@link TypedAppFile} — which IS a `SourceCode<T>`, so every
       * existing use is unaffected — because that is what the engine has always passed: it
       * iterates the run's `App`. Saying so gives a check the file's identity and its
       * `derived` memo instead of just its bytes.
       */
      file: TypedAppFile<T>;
    }
  : never;

export type Context<T extends SourceCodeType, S extends Schema = Schema> = T extends SourceCodeType
  ? StaticContextProperties<T> & AugmentedDependencies & { settings: Settings<S>; config: Config }
  : never;

export type Corrector<T extends SourceCodeType> = T extends SourceCodeType
  ? {
      // Unreachable, and a placeholder rather than `never`: JSON is an editor-buffer
      // type only (see JSONSourceCode), so `autofix` — which walks `app.sourceCodes()`
      // — is never handed one and `createCorrector` throws if it somehow is. `never`
      // here would be more honest but it poisons every call through `Fixer<T>`, whose
      // union of function types intersects its parameters down to `never`.
      [SourceCodeType.JSON]: StringCorrector;
      [SourceCodeType.LiquidHtml]: StringCorrector;
      [SourceCodeType.GraphQL]: GraphQLCorrector;
      [SourceCodeType.YAML]: StringCorrector; // no YAML autofix yet; StringCorrector as placeholder
    }[T]
  : never;

/**
 * A Fixer is a function that returns a Fix (a data representation of the change).
 *
 * The Corrector module is helpful for creating Fix objects.
 */
export type Fixer<T extends SourceCodeType> = T extends SourceCodeType
  ? (corrector: Corrector<T>) => void
  : never;
export type LiquidHtmlFixer = Fixer<SourceCodeType.LiquidHtml>;
export type GraphQLFixer = Fixer<SourceCodeType.GraphQL>;

/**
 * A data representation of a collection of changes to a document. They all
 * assume that they operate on the initial string independently.
 *
 * It is recursive so that fixes can be grouped together.
 */
export type Fix = FixDescription | Fix[];

/**
 * A data representation of a change to a document.
 *
 * To insert:
 *   - startIndex: x, endIndex: x, insert: insertion
 *
 * To replace:
 *   - startIndex: x, endIndex: y, insert: replacement
 *
 * To delete:
 *   - startIndex: x, endIndex: y, insert: ''
 */
export interface FixDescription {
  /** 0-based index, included */
  startIndex: number;
  /** 0-based index, excluded */
  endIndex: number;
  /** What to replace the contents of the range with. To delete, put entry string. */
  insert: string;
}

/**
 * The FixApplicator is a function that takes a list of FixDescription and
 * applies them on the source to produce a result.
 *
 * - In a CLI context, this might be changeString().then(saveFile)
 * - In the Language Server, this function will collect the TextEdit[]
 *   before sending them as a WorkspaceEdit
 *
 * It is assumed that all FixDescription are all applied to the initial
 * document, and not the one produced by previous FixDescription.
 *
 * It is the FixApplicator's job to throw an error if the FixDescription
 * array contains overlapping ranges.
 *
 * It is the FixApplicator's job to change the location of fixes as indexes
 * drift. See [1] and [2] for inspiration, we're following the same
 * pattern.
 *
 * [1]: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textEditArray
 * [2]: https://codemirror.net/docs/ref/#state.EditorState.update
 */
export interface FixApplicator {
  (source: FixableSource, fixes: Fix): Promise<void>;
}

/**
 * What a {@link FixApplicator} needs of the file it is fixing: where to write it,
 * which corrector produced the fixes, and the string they apply to.
 *
 * Narrower than `SourceCode` on purpose. No applicator reads the AST — the CLI's
 * writes the corrected string to disk, the language server's collects `TextEdit`s —
 * and asking for one would mean `autofix` had to claim an AST type for every file
 * in the app, including the ones it skips because they have no fixable offense.
 */
export type FixableSource = { uri: string; type: SourceCodeType; source: string };

/**
 * A suggestion is a Fix that we cannot apply automatically. Perhaps
 * because there are multiple options or because the fix is dangerous and
 * requires care.
 *
 * To be used by code editors.
 */
export type Suggestion<T extends SourceCodeType> = T extends SourceCodeType
  ? {
      message: string;
      fix: Fixer<T>;
    }
  : never;

export type LiquidHtmlSuggestion = Suggestion<SourceCodeType.LiquidHtml>;

export type Problem<T extends SourceCodeType> = T extends SourceCodeType
  ? {
      /** The description of the problem shown to the user */
      message: string;

      /** 0-indexed, included */
      startIndex: number;

      /** 0-indexed, excluded */
      endIndex: number;

      /**
       * The fix attribute is used to provide a "autofix" rule
       * to the offense. It is reserved for safe changes.
       * Unsafe changes should go in `suggest`.
       */
      fix?: Fixer<T>;

      /**
       * Sometimes, it's not appropriate to automatically apply a fix either
       * because it is not safe, or because there are multiple ways to fix it.
       *
       * For instance, we can't know if you'd want to fix a parser blocking
       * script with `defer` or with `async`. The suggest array allows us to
       * provide fixes for either and the user can choose which one they want.
       */
      suggest?: Suggestion<T>[];
    }
  : never;

export type Offense<T extends SourceCodeType = SourceCodeType> = T extends SourceCodeType
  ? {
      type: T;
      check: string;
      message: string;
      uri: string;
      severity: Severity;
      start: Position;
      end: Position;
      fix?: Fixer<T>;
      suggest?: Suggestion<T>[];
    }
  : never;

/**
 * A place in a source file, in the Language Server Protocol's document model.
 *
 * `line` and `character` are BOTH 0-based, and `character` counts UTF-16 code units.
 * The language server hands these straight to VS Code without converting; the MCP
 * supervisor is the one consumer that adds 1 to each. `utils/position.ts` is the only
 * producer and documents why the model is the LSP's.
 */
export interface Position {
  /** Character offset from the start of the file. 0-indexed. */
  index: number;

  /** 0-indexed — NOT 1-indexed, whatever a caller displaying it may do. */
  get line(): number;

  /** 0-indexed, in UTF-16 code units, so an astral character advances it by 2. */
  get character(): number;
}

/** The severity determines the icon and color of diagnostics */
export enum Severity {
  ERROR = 0,
  WARNING = 1,
  INFO = 2,
}

/** The yaml configurations to target checks */
export enum ConfigTarget {
  All = 'all',
  Recommended = 'recommended',
}
