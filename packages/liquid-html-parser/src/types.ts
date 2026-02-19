export interface Position {
  /** 0-indexed offset in the string, included */
  start: number;
  /** 0-indexed offset, excluded */
  end: number;
}

export enum NodeTypes {
  Document = 'Document',
  LiquidRawTag = 'LiquidRawTag',
  LiquidTag = 'LiquidTag',
  LiquidBranch = 'LiquidBranch',
  LiquidVariableOutput = 'LiquidVariableOutput',
  HtmlSelfClosingElement = 'HtmlSelfClosingElement',
  HtmlVoidElement = 'HtmlVoidElement',
  HtmlDoctype = 'HtmlDoctype',
  HtmlComment = 'HtmlComment',
  HtmlElement = 'HtmlElement',
  HtmlDanglingMarkerClose = 'HtmlDanglingMarkerClose',
  HtmlRawNode = 'HtmlRawNode',
  AttrSingleQuoted = 'AttrSingleQuoted',
  AttrDoubleQuoted = 'AttrDoubleQuoted',
  AttrUnquoted = 'AttrUnquoted',
  AttrEmpty = 'AttrEmpty',
  TextNode = 'TextNode',
  YAMLFrontmatter = 'YAMLFrontmatter',

  LiquidVariable = 'LiquidVariable',
  LiquidFilter = 'LiquidFilter',
  NamedArgument = 'NamedArgument',
  LiquidLiteral = 'LiquidLiteral',
  BooleanExpression = 'BooleanExpression',
  String = 'String',
  Number = 'Number',
  Range = 'Range',
  VariableLookup = 'VariableLookup',
  Comparison = 'Comparison',
  LogicalExpression = 'LogicalExpression',

  AssignMarkup = 'AssignMarkup',
  HashAssignMarkup = 'HashAssignMarkup',
  ContentForMarkup = 'ContentForMarkup',
  CycleMarkup = 'CycleMarkup',
  ForMarkup = 'ForMarkup',
  PaginateMarkup = 'PaginateMarkup',
  RawMarkup = 'RawMarkup',
  RenderMarkup = 'RenderMarkup',
  FunctionMarkup = 'FunctionMarkup',
  GraphQLMarkup = 'GraphQLMarkup',
  GraphQLInlineMarkup = 'GraphQLInlineMarkup',
  RenderVariableExpression = 'RenderVariableExpression',
  RenderAliasExpression = 'RenderAliasExpression',
  LiquidDocDescriptionNode = 'LiquidDocDescriptionNode',
  LiquidDocParamNode = 'LiquidDocParamNode',
  LiquidDocExampleNode = 'LiquidDocExampleNode',
  LiquidDocPromptNode = 'LiquidDocPromptNode',
  JsonHashLiteral = 'JsonHashLiteral',
  JsonArrayLiteral = 'JsonArrayLiteral',
  JsonKeyValuePair = 'JsonKeyValuePair',

  // platformos markup types
  BackgroundMarkup = 'BackgroundMarkup',
  BackgroundInlineMarkup = 'BackgroundInlineMarkup',
  CacheMarkup = 'CacheMarkup',
  LogMarkup = 'LogMarkup',
  SessionMarkup = 'SessionMarkup',
  ExportMarkup = 'ExportMarkup',
  RedirectToMarkup = 'RedirectToMarkup',
  IncludeFormMarkup = 'IncludeFormMarkup',
  SpamProtectionMarkup = 'SpamProtectionMarkup',
}

// These are officially supported with special node types
export enum NamedTags {
  assign = 'assign',
  hash_assign = 'hash_assign',
  capture = 'capture',
  case = 'case',
  content_for = 'content_for',
  cycle = 'cycle',
  decrement = 'decrement',
  echo = 'echo',
  elsif = 'elsif',
  for = 'for',
  form = 'form',
  if = 'if',
  include = 'include',
  increment = 'increment',
  layout = 'layout',
  liquid = 'liquid',
  paginate = 'paginate',
  render = 'render',
  function = 'function',
  graphql = 'graphql',
  section = 'section',
  sections = 'sections',
  tablerow = 'tablerow',
  unless = 'unless',
  when = 'when',
  // platformos tags
  background = 'background',
  cache = 'cache',
  catch = 'catch',
  context = 'context',
  export = 'export',
  include_form = 'include_form',
  log = 'log',
  parse_json = 'parse_json',
  print = 'print',
  redirect_to = 'redirect_to',
  response_headers = 'response_headers',
  response_status = 'response_status',
  return = 'return',
  rollback = 'rollback',
  session = 'session',
  sign_in = 'sign_in',
  spam_protection = 'spam_protection',
  theme_render_rc = 'theme_render_rc',
  transaction = 'transaction',
  try = 'try',
  yield = 'yield',
}

export enum Comparators {
  CONTAINS = 'contains',
  EQUAL = '==',
  GREATER_THAN = '>',
  GREATER_THAN_OR_EQUAL = '>=',
  LESS_THAN = '<',
  LESS_THAN_OR_EQUAL = '<=',
  NOT_EQUAL = '!=',
}

export const HtmlNodeTypes = [
  NodeTypes.HtmlElement,
  NodeTypes.HtmlDanglingMarkerClose,
  NodeTypes.HtmlRawNode,
  NodeTypes.HtmlVoidElement,
  NodeTypes.HtmlSelfClosingElement,
] as const;

export const LiquidNodeTypes = [
  NodeTypes.LiquidTag,
  NodeTypes.LiquidVariableOutput,
  NodeTypes.LiquidBranch,
  NodeTypes.LiquidRawTag,
] as const;

export const LoopNamedTags = [NamedTags.for, NamedTags.tablerow] as const;

// Those properties create loops that would make walking infinite
export const nonTraversableProperties = new Set([
  'parentNode',
  'prev',
  'next',
  'firstChild',
  'lastChild',
]);
