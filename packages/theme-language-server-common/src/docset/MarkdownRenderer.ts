import { DocsetEntry, FilterEntry, ObjectEntry, TagEntry } from '@platformos/theme-check-common';
import {
  ArrayType,
  PseudoType,
  ShapeType,
  Unknown,
  docsetEntryReturnType,
  isArrayType,
  isShapeType,
} from '../TypeSystem';
import { shapeToTypeString, shapeToDetailString } from '../PropertyShapeInference';
import { Attribute, Tag, Value } from './HtmlDocset';

const HORIZONTAL_SEPARATOR = '\n\n---\n\n';

export type HtmlEntry = Tag | Attribute | Value;
export type DocsetEntryType = 'filter' | 'tag' | 'object';

export function render(
  entry: DocsetEntry | FilterEntry | TagEntry,
  returnType?: PseudoType | ArrayType | ShapeType,
  docsetEntryType?: DocsetEntryType,
) {
  return [title(entry, returnType), docsetEntryBody(entry, returnType, docsetEntryType)]
    .filter(Boolean)
    .join('\n');
}

export function renderHtmlEntry(entry: HtmlEntry, parentEntry?: HtmlEntry) {
  return [title(entry, Unknown), htmlEntryBody(entry, parentEntry)].join('\n');
}

function title(
  entry: DocsetEntry | ObjectEntry | FilterEntry | HtmlEntry,
  returnType?: PseudoType | ArrayType | ShapeType,
) {
  returnType = returnType ?? docsetEntryReturnType(entry as ObjectEntry, Unknown);

  if (isShapeType(returnType)) {
    return `### ${entry.name}: \`${shapeToTypeString(returnType.shape)}\``;
  } else if (isArrayType(returnType)) {
    return `### ${entry.name}: \`${returnType.valueType}[]\``;
  } else if (returnType !== Unknown) {
    return `### ${entry.name}: \`${returnType}\``;
  }

  return `### ${entry.name}`;
}

function sanitize(s: string | undefined) {
  return s
    ?.replace(/(^|\n+)&gt;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/\]\(\//g, '](https://shopify.dev/')
    .trim();
}

function docsetEntryBody(
  entry: DocsetEntry,
  returnType?: PseudoType | ArrayType | ShapeType,
  docsetEntryType?: DocsetEntryType,
) {
  const bodyParts = [
    syntax(entry),
    entry.deprecation_reason,
    entry.summary,
    entry.description,
    platformOSDevReference(entry, returnType, docsetEntryType),
  ];

  // Add shape details if returnType is a ShapeType
  if (returnType && isShapeType(returnType)) {
    bodyParts.unshift(shapeToDetailString(returnType.shape));
  }

  return bodyParts
    .map((x) => x?.toString())
    .map(sanitize)
    .filter(Boolean)
    .join(HORIZONTAL_SEPARATOR);
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
  _?: PseudoType | ArrayType | ShapeType,
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
