/**
 * platformOS Liquid docset.
 */
export interface PlatformOSDocset {
  /** Whether it was augmented prior to being passed. */
  isAugmented?: boolean;

  /** Returns Liquid filters available in platformOS. */
  filters(): Promise<FilterEntry[]>;

  /** Returns objects (or Liquid variables) available in platformOS. */
  objects(): Promise<ObjectEntry[]>;

  /** Returns objects (excluding global variables, hidden objects, and deprecated objects) available in platformOS. */
  liquidDrops(): Promise<ObjectEntry[]>;

  /** Returns Liquid tags available in platformOS. */
  tags(): Promise<TagEntry[]>;

  /** Returns the `{% doc %}` vocabulary — its annotations, and the types a `@param` may name. */
  liquidDoc(): Promise<LiquidDocVocabulary>;

  /** Returns graphql root query */
  graphQL(): Promise<string | null>;
}

/**
 * What may be written inside `{% doc %}`. The runtime never interprets a doc block's body, so all of it
 * is documentation and all of it is published; the parser's grammar keeps the only local copy of the
 * annotation names, because a parse has no docset to ask.
 *
 * Empty for a docset published before this document existed, and then the features that read it go quiet
 * rather than report against a list of their own.
 */
export interface LiquidDocVocabulary {
  /** One entry per annotation an author may write — `param`, `example`, `description`. */
  annotations: LiquidDocAnnotationEntry[];

  /**
   * The types a `@param` may name, with the prose to show beside each. The whole type vocabulary,
   * `date` and `time` included; a consumer unions it with the object names from `objects()`.
   */
  param_types: LiquidDocParamTypeEntry[];
}

/** An annotation of a `{% doc %}` block — the name without its `@`, and what an editor shows for it. */
export interface LiquidDocAnnotationEntry {
  /** The annotation's name as written after the `@`, e.g. `param`. */
  name: string;

  /** Markdown prose describing what the annotation declares. */
  description: string;

  /** A complete `{% doc %}` … `{% enddoc %}` block using this annotation. */
  example: string;
}

/** A type an author may write in `@param {…}`. */
export interface LiquidDocParamTypeEntry {
  name: string;
  description: string;
}

/** A URI that will uniquely describe the schema */
export type JSONSchemaURI = string;

export interface SchemaDefinition {
  /** A URI that will uniquely describe the schema */
  uri: JSONSchemaURI;

  /** A JSON Schema as string */
  schema: string;

  /**
   * When absent, does not match on file. Assumed to be used by other
   * schemas.
   *
   * e.g. '\*\*\/sections\/\*.liquid', '\*\*\/locales\/*.json'
   */
  fileMatch?: string[];
}

/** Source of JSON schemas for the app. */
export interface JsonValidationSet {
  /** All relevant SchemaDefinitions. */
  schemas: () => Promise<SchemaDefinition[]>;
}

export interface DocsetEntry {
  /** The name of the entry. */
  name: string;

  /** A brief summary of the entry. */
  summary?: string;

  /** A detailed description of the entry. */
  description?: string;

  /** Whether the entry is deprecated or not. */
  deprecated?: boolean;

  /** The reason why the entry is deprecated. */
  deprecation_reason?: string;

  /** documentation examples */
  examples?: Example[];
}

export interface ObjectEntry extends DocsetEntry {
  /**
   * Holds the information on whether an ObjectEntry refers to a type or global variable.
   *
   * When not defined, we assume it's a global.
   */
  access?: Access;

  /**
   * Object properties and their types
   */
  properties?: ObjectEntry[];

  /**
   * The return type of the variable.
   * When multiple, it's because the return value is an enum (e.g. video | image).
   */
  return_type?: ReturnType[];

  /** Don't care about this */
  json_data?: JsonData;
}

export interface FilterEntry extends DocsetEntry {
  /** Used for categorization on the docs website */
  category?: string;

  /** Argument types */
  parameters?: Parameter[];

  /** Return type */
  return_type?: ReturnType[];

  /** e.g. string | truncate: length, truncate_string */
  syntax?: string;

  /**
   * Other registered spellings of this same filter, e.g. `dig` for `hash_dig`.
   *
   * Was read through an `as any` cast in `AugmentedPlatformOSDocset.expandAliases`, which is
   * the one place that consumes it — the field has been published all along.
   */
  aliases?: string[];

  /**
   * The registered name of the filter that supersedes this one, when it is deprecated.
   *
   * The successor as DATA rather than as a sentence, which is what `DeprecatedFilter`'s rename
   * suggestion needs. It used to be recovered by matching `replaced by [`name`]` against
   * `deprecation_reason`, a pattern that none of the six real reasons uses — so the fix was
   * never offered for any filter, and nothing failed, because an absent suggestion looks like a
   * suggestion nobody wanted.
   *
   * Absent for a docset published before the platform emitted it, and then no rename is offered:
   * `findRecommendedAlternative` reads this field and nothing else.
   */
  deprecation_replacement?: string;

  /**
   * How many arguments the filter accepts, the piped value counted as one.
   *
   * `max` is `null` for a variadic filter — `dig` and friends — which means "cannot refuse an
   * argument", NOT "unknown"; a filter whose bounds are genuinely unknown has no `arity` at all.
   *
   * Absent for a docset published before the platform emitted it, and then the filter simply goes
   * unchecked. Nothing in this repository answers in its place: upstream derives every bound from
   * the Ruby signature, for Liquid's own filters too — they are documented in
   * `docs/liquid/standardfilters.rb`, whose signatures a test there compares against the gem.
   */
  arity?: FilterArityRange;

  /**
   * Whether the `positional: false` parameters are ALL the named arguments the filter accepts.
   *
   * Three states, and absent is not a synonym for either answer: 10 shipped filters publish `true`,
   * 16 publish `false` — `translate` among them, because every key it does not recognise is handed
   * to I18n as an interpolation variable — and the rest say nothing.
   *
   * Only a reader that REFUSES a name needs it; completion and hover need the list alone. The hover
   * says so when the list is a sample, so that its silence about a name is not read as a verdict.
   */
  named_parameters_exhaustive?: boolean;
}

/** @see FilterEntry.arity */
export interface FilterArityRange {
  min: number;
  max: number | null;
}

export interface TagEntry extends DocsetEntry {
  /**
   * The registered name of the tag that supersedes this one, when it is deprecated.
   *
   * The successor as DATA rather than as a sentence, which is what `DeprecatedTag`'s rename
   * needs: that autofix writes to the user's file unattended under `pos-cli check run -a`, and
   * deriving the target from `deprecation_reason` made it depend on how the prose was worded.
   *
   * Absent for a docset published before the platform emitted it, and then the deprecation reason is
   * read as a fallback.
   */
  deprecation_replacement?: string;

  /** Used for categorization on the docs website */
  category?: string;

  /** Argument types */
  parameters?: Parameter[];

  /** e.g. {% for item in array %}\n  expression{% endfor %} */
  syntax?: string;

  /** e.g. item, array, expression */
  syntax_keywords?: SyntaxKeyword[];

  /**
   * What the tag leaves behind, when it leaves anything.
   *
   * Modelled because 33 of the 56 shipped tags carry the key — and it is an EMPTY ARRAY in every
   * one of them, which `docsetReturnType` reads as `untyped`: "the docset does not say", never a
   * type. Nothing may treat an empty array as a claim, which is the same reading a filter with no
   * `return_type` gets.
   */
  return_type?: ReturnType[];
}

export interface Access {
  /** Whether the ObjectEntry is a global variable or a type */
  global: boolean;
  parents: Parent[];
  template: string[];

  /**
   * The ONE kind of app file the object exists in, spelled in platformOS's snake_case
   * (`api_call`). `data` and `response` are api_call objects: `global` is true because
   * they need no parent, not because they are in scope everywhere.
   *
   * Null or absent means the object is not restricted to a single file type.
   */
  app_file_type?: string | null;
}

export interface Parent {
  object: string;
  property: string;
}

/**
 * One argument of a filter or a tag, as the two documents actually publish it.
 *
 * The two shapes are NOT the same, and this interface is their union rather than the filter one
 * borrowed for both. Measured on the shipped files: a filter parameter carries all six fields, and
 * a TAG parameter carries only `description`, `name`, `required` and `types` — all 72 of them.
 *
 * So the three fields only filters publish are optional, and a reader must treat absence as "the
 * docset does not say". `positional` was declared required, which is how `InvalidLoopArguments`
 * came to compare `parameter.positional === false` against `undefined` for every tag argument and
 * report `{% for x in y limit: 2 %}` — valid Liquid — as an unknown argument.
 */
export interface Parameter {
  description: string;
  name: string;
  required: boolean;
  types: string[];

  /** Filters only: whether the argument is written by position rather than by name. */
  positional?: boolean;

  /** Filters only: whether the argument absorbs every remaining one. */
  variadic?: boolean;

  /** Filters only: the value used when the argument is omitted, as a source spelling. */
  default?: string;
}

export interface SyntaxKeyword {
  description: string;
  keyword: string;
}

export interface Example {
  /**
   * The example itself, as Liquid source. 170 of the 176 shipped filters carry one, and the hover
   * renders them.
   *
   * HTML-ESCAPED BY THE DOCUMENTATION PIPELINE, and published that way — `escape`'s example reads
   * `'&lt;p&gt;…'`. Nothing here decodes it: the reference page renders `{{ e.raw_liquid }}`, which
   * escapes again, so the site displays the entities too, and for `html_safe` and `parse_json` the
   * entities ARE the example — decoding `&amp;` would delete what they demonstrate. Whether an
   * entity is the author's or the pipeline's cannot be told apart from here.
   */
  raw_liquid?: string;

  /* don't care about this */
  // description: string;
  // display_type: string;
  // name: string;
  // parameter: boolean;
  // path: string;
  // show_data_tab: boolean;
  // syntax: string;
}

export interface JsonData {
  /* don't care about those */
  // data_from_file: string;
  // handle: string;
  // path: string;
}

export type ReturnType = EnumReturnType | ArrayReturnType | OtherReturnType;

export interface EnumReturnType {
  type: 'string';
  name: string;
  /** Prose about the returned value. Published on every filter and object return type. */
  description?: string;
}

export interface ArrayReturnType {
  type: 'array';
  array_value: string;
  description?: string;
}

export interface OtherReturnType {
  type: 'string' | 'number' | 'untyped' | string;
  name: '';
  description?: string;
}
