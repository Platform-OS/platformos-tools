import {
  DocsetEntry,
  FilterEntry,
  ObjectEntry,
  Parameter,
  TagEntry,
} from '@platformos/platformos-check-common';
import {
  ArrayType,
  PseudoType,
  ShapeType,
  UnionType,
  Unknown,
  docsetEntryReturnType,
  isArrayType,
  isShapeType,
  isUnionType,
  typeToDisplayString,
} from '../TypeSystem';
import { shapeToTypeString, shapeToDetailString } from '../PropertyShapeInference';
import { Attribute, Tag, Value } from './HtmlDocset';

const HORIZONTAL_SEPARATOR = '\n\n---\n\n';

export type HtmlEntry = Tag | Attribute | Value;
export type DocsetEntryType = 'filter' | 'tag' | 'object';

/**
 * Anything the docset publishes as an entry.
 *
 * Spelled as the union rather than as the base type so that `'parameters' in entry` NARROWS instead of
 * needing a cast: a tag and a filter publish different fields, and the sections below read the ones
 * only some entries have.
 */
type DocsetEntryLike = DocsetEntry | FilterEntry | TagEntry;

export function render(
  entry: DocsetEntry | FilterEntry | TagEntry,
  returnType?: PseudoType | ArrayType | ShapeType | UnionType,
  docsetEntryType?: DocsetEntryType,
) {
  return [title(entry, returnType), docsetEntryBody(entry, returnType, docsetEntryType)]
    .filter(Boolean)
    .join('\n');
}

export function renderHtmlEntry(entry: HtmlEntry, parentEntry?: HtmlEntry) {
  return [title(entry, Unknown), htmlEntryBody(entry, parentEntry)].join('\n');
}

/**
 * ONE argument of a filter, hovered or completed on its own.
 *
 * A `Parameter` is NOT a `DocsetEntry`, and rendering it through {@link render} treated it as one:
 * `locale` hovered as `### locale` with no type and a `[platformOS Reference](…/liquid/filters#locale)`
 * link — a filter page for a name that is not a filter. The parent's link is the one that resolves.
 */
export function renderParameter(parameter: Parameter, parentEntry?: FilterEntry) {
  const type = parameterType(parameter);
  const reference = parentEntry && platformOSDevReference(parentEntry, undefined, 'filter');

  const facts = [
    parameter.required ? '*required*' : undefined,
    parameter.default ? `*default:* \`${parameter.default}\`` : undefined,
  ].filter(Boolean);

  const body = [
    prose({ description: parameter.description }),
    facts.length ? facts.join(', ') : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    [title({ name: parameter.name }, type ?? Unknown), body].filter(Boolean).join('\n'),
    reference,
  ]
    .filter(Boolean)
    .join(HORIZONTAL_SEPARATOR);
}

function title(
  entry: DocsetEntry | ObjectEntry | FilterEntry | HtmlEntry,
  returnType?: PseudoType | ArrayType | ShapeType | UnionType,
) {
  const label = typeLabel(returnType ?? docsetEntryReturnType(entry as ObjectEntry, Unknown));

  return label ? `### ${entry.name}: \`${label}\`` : `### ${entry.name}`;
}

/** How a type is spelled to the reader, or nothing when the docset does not say. */
function typeLabel(returnType: PseudoType | ArrayType | ShapeType | UnionType) {
  if (isUnionType(returnType)) {
    return typeToDisplayString(returnType);
  } else if (isShapeType(returnType)) {
    return shapeToTypeString(returnType.shape);
  } else if (isArrayType(returnType)) {
    // `array_value` is empty on all 31 array-returning filters, and `[]` names no type — `split`
    // titled itself `### split: \`[]\``.
    return returnType.valueType ? `${returnType.valueType}[]` : 'array';
  } else if (returnType !== Unknown) {
    return returnType;
  }

  return undefined;
}

function sanitize(s: string | undefined) {
  return s
    ?.replace(/(^|\n+)&gt;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\]\(\//g, '](https://documentation.platformos.com/')
    .trim();
}

/**
 * Everything under the title.
 *
 * The `---` rule separates the reference link from the entry and NOTHING ELSE. Ruling off every part
 * is what made a two-sentence filter hover three horizontal rules tall; sections carry a bold heading
 * instead, which is what tells them apart now that there are five of them.
 */
function docsetEntryBody(
  entry: DocsetEntryLike,
  returnType?: PseudoType | ArrayType | ShapeType | UnionType,
  docsetEntryType?: DocsetEntryType,
) {
  const sections = [
    returnType && isShapeType(returnType) ? shapeToDetailString(returnType.shape) : undefined,
    syntax(entry),
    deprecation(entry),
    prose(entry),
    parameterSections(entry),
    returns(entry),
    examples(entry),
  ];

  return [
    sections.filter(Boolean).join('\n\n'),
    platformOSDevReference(entry, returnType, docsetEntryType),
  ]
    .filter(Boolean)
    .join(HORIZONTAL_SEPARATOR);
}

/**
 * The entry's prose, ONCE.
 *
 * `summary` and `description` are the same sentence in all 176 shipped filters — upstream publishes
 * `summary` as `description`'s fallback — so printing both printed every filter's description twice.
 */
function prose(entry: Pick<DocsetEntry, 'summary' | 'description'>) {
  const summary = sanitize(entry.summary?.toString());
  const description = sanitize(entry.description?.toString());

  if (summary && description && summary !== description) {
    return `${summary}\n\n${description}`;
  }

  return summary || description;
}

/**
 * The successor as a NAME where one is published.
 *
 * The six deprecated filters' `deprecation_reason` is a fragment carrying a relative anchor —
 * `"[any](#any) filter"` — which reads as nothing in a hover and links nowhere. `deprecation_replacement`
 * is the same fact as data. No shipped entry carries a reason without being deprecated, so the label
 * cannot be attached to a current filter.
 */
function deprecation(entry: DocsetEntryLike) {
  const replacement =
    'deprecation_replacement' in entry ? entry.deprecation_replacement : undefined;

  if (replacement) {
    return `**Deprecated** — use \`${replacement}\` instead.`;
  }

  const reason = sanitize(entry.deprecation_reason?.toString());

  return reason ? `**Deprecated** — ${reason}` : undefined;
}

/**
 * The arguments, split the way they are WRITTEN rather than the way they are listed.
 *
 * `positional === false` is upstream's statement that an argument is passed as `name: value`; absent
 * means the document does not say, which is what all 72 tag parameters publish, so they list as
 * positional.
 */
function parameterSections(entry: DocsetEntryLike) {
  if (!('parameters' in entry)) return undefined;

  const parameters = entry.parameters;
  if (!parameters?.length) return undefined;

  const positional = parameters.filter((parameter) => parameter.positional !== false);
  const named = parameters.filter((parameter) => parameter.positional === false);
  const open =
    'named_parameters_exhaustive' in entry && entry.named_parameters_exhaustive === false;

  const sections = [
    positional.length
      ? section(
          'Parameters',
          positional.map((p) => parameterItem(p, false)),
        )
      : undefined,
    named.length
      ? section(
          'Named arguments',
          named.map((p) => parameterItem(p, true)),
        )
      : undefined,
    // Said, not assumed: 16 filters accept named arguments they do not list — `translate` hands every
    // key it does not recognise to I18n as an interpolation variable — so a reader must not take the
    // list's silence about a name for a verdict on it.
    named.length && open
      ? 'This filter accepts other named arguments than the ones listed above.'
      : undefined,
  ];

  return sections.filter(Boolean).join('\n\n');
}

function parameterItem(parameter: Parameter, named: boolean) {
  const type = parameterType(parameter);

  const parts = [
    `\`${parameter.name}${named ? ':' : ''}\``,
    type ? `\`${type}\`` : undefined,
    parameter.required ? '*required*' : undefined,
    parameter.default ? `*default:* \`${parameter.default}\`` : undefined,
  ].filter(Boolean);

  const description = oneLine(sanitize(parameter.description));

  return `- ${parts.join(' ')}${description ? ` — ${description}` : ''}`;
}

function parameterType(parameter: Parameter) {
  const types = parameter.types?.filter(Boolean);

  return types?.length ? types.join(' | ') : undefined;
}

/**
 * What the entry evaluates to, in the words the docset uses for it.
 *
 * The TYPE is already in the title, and read from the same place so the two cannot disagree; what is
 * only here is the sentence — 171 of 176 filters carry one, and none of them was ever shown. Tags
 * publish `return_type: []`, which says nothing and renders nothing.
 */
function returns(entry: DocsetEntryLike) {
  if (!('return_type' in entry)) return undefined;

  const description = oneLine(sanitize(entry.return_type?.[0]?.description?.toString()));
  if (!description) return undefined;

  const type = typeLabel(docsetEntryReturnType(entry as ObjectEntry, Unknown));

  return `**Returns**${type ? ` \`${type}\`` : ''} — ${description}`;
}

/**
 * The examples, verbatim.
 *
 * NOT run through {@link sanitize}: its entity decoding would rewrite `parse_json`'s and `html_safe`'s
 * examples into ones that no longer demonstrate anything, and its leading-`&gt;` rule would splice
 * a multi-line example's lines together. See `Example.raw_liquid`.
 */
function examples(entry: DocsetEntry) {
  const snippets = (entry.examples ?? [])
    .map((example) => example.raw_liquid?.trim())
    .filter(Boolean);

  if (!snippets.length) return undefined;

  // One fence. A blank line between snippets only where one of them spans lines — `cache` and `form`
  // publish blocks that read as a single long example when run together, while `translate`'s five
  // one-liners are a compact list and spacing them out only makes the hover taller.
  const spaced = snippets.some((snippet) => snippet!.includes('\n'));

  return section('Examples', ['```liquid', snippets.join(spaced ? '\n\n' : '\n'), '```']);
}

/** A bold heading and its lines, with the blank line that starts a list or a fence. */
function section(heading: string, lines: (string | undefined)[]) {
  return `**${heading}**\n\n${lines.join('\n')}`;
}

/** A description that has to sit inside a list item, so its own newlines cannot end the item. */
function oneLine(text: string | undefined) {
  return text?.replace(/\s*\n\s*/g, ' ');
}

function htmlEntryBody(entry: HtmlEntry, parentEntry?: HtmlEntry) {
  return [description(entry), references(entry), references(parentEntry)]
    .filter(Boolean)
    .join(HORIZONTAL_SEPARATOR);
}

function syntax(entry: DocsetEntry | FilterEntry | TagEntry) {
  if (!('syntax' in entry) || !entry.syntax) {
    return undefined;
  }

  // TagEntry entries already have liquid tags as a part of the syntax
  // explanation so we can return them directly.
  if (entry.syntax.startsWith('{%')) {
    return `\`\`\`liquid\n${entry.syntax}\n\`\`\``;
  }

  // Wrap the syntax in liquid tags to ensure we get proper syntax highlighting
  // if it's available.
  return `\`\`\`liquid\n{{ ${entry.syntax} }}\n\`\`\``;
}

function description(entry: HtmlEntry) {
  if (!entry.description || typeof entry.description === 'string') {
    return entry.description;
  }

  return entry.description.value;
}

const platformOSDevRoot = `https://documentation.platformos.com/api-reference/liquid`;

function platformOSDevReference(
  entry: DocsetEntry,
  _?: PseudoType | ArrayType | ShapeType | UnionType,
  docsetEntryType?: DocsetEntryType,
) {
  switch (docsetEntryType) {
    case 'tag': {
      if (entry.name === 'include') {
        return `[platformOS Reference](${platformOSDevRoot}/include)`;
      } else if (['for', 'cycle', 'ifchanged', 'tablerow'].includes(entry.name)) {
        return `[platformOS Reference](${platformOSDevRoot}/loops#${entry.name})`;
      } else if (entry.name === 'liquid') {
        return `[platformOS Reference](${platformOSDevRoot}/theme#liquid)`;
      } else if ('platformOS' in entry && entry.platformOS === true) {
        return `[platformOS Reference](${platformOSDevRoot}/platformos-tags#${entry.name.replaceAll(
          '_',
          '-',
        )})`;
      } else {
        return undefined;
      }
    }

    case 'filter': {
      if ('platformOS' in entry) {
        return `[platformOS Reference](${platformOSDevRoot}/platformos-filters#${entry.name.replaceAll(
          '_',
          '-',
        )})`;
      } else {
        return `[platformOS Reference](${platformOSDevRoot}/filters#${entry.name})`;
      }
    }

    default: {
      return undefined;
    }
  }
}

function references(entry: HtmlEntry | undefined) {
  if (!entry || !('references' in entry) || !entry.references || entry.references.length === 0) {
    return undefined;
  }

  if (entry.references.length === 1) {
    const [ref] = entry.references;
    return `[${ref.name}](${ref.url})`;
  }

  return [`#### Learn more`, entry.references.map((ref) => `- [${ref.name}](${ref.url})`)].join(
    '\n\n',
  );
}
