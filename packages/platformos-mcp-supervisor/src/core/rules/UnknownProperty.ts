/**
 * UnknownProperty rules — property does not exist on the given object.
 *
 * Priority order:
 *    10 — schema_property:  object is a known schema table → suggest valid properties
 *    20 — context_property: object is context.* → list valid sub-properties
 *   100 — generic:          property + object extracted but no specialised rule applies
 *  1000 — default:          catch-all for the case where extraction failed —
 *         the LSP message did not yield both `params.property` AND
 *         `params.object`. Stops the diagnostic from landing as
 *         `UnknownProperty.unmatched`.
 */
import type { Rule } from './engine';
import { nearestByLevenshtein } from './queries';

export const rules: Rule[] = [
  {
    id: 'UnknownProperty.schema_property',
    check: 'UnknownProperty',
    priority: 10,
    when: (diag, facts) => {
      const objectName = diag.params?.object;
      if (!objectName) return false;
      if (!facts.graph) return false;
      const schemaNodes = facts.graph.nodesByType('schema');
      return schemaNodes.some(n => n.key === objectName || n.key === objectName.replace(/s$/, ''));
    },
    apply: (diag, facts) => {
      const params = diag.params!;
      const objectName = params.object;
      const propertyName = params.property;

      if (!facts.graph) return null;
      const schemaNodes = facts.graph.nodesByType('schema');
      const schema = schemaNodes.find(n => n.key === objectName || n.key === objectName.replace(/s$/, ''));
      if (!schema?.properties) return null;

      const validProps = schema.properties.map(p => p.name).filter(Boolean);
      if (validProps.length === 0) return null;

      const nearest = nearestByLevenshtein(propertyName, validProps, 3);
      const suggestion = nearest.length > 0
        ? `Did you mean \`${nearest[0].name}\`?`
        : null;
      const propList = validProps.slice(0, 10).map(p => `\`${p}\``).join(', ');

      return {
        rule_id: 'UnknownProperty.schema_property',
        hint_md: `Property \`${propertyName}\` doesn't exist on \`${objectName}\`.${suggestion ? ` ${suggestion}` : ''}\n\nAvailable properties: ${propList}${validProps.length > 10 ? ` (+${validProps.length - 10} more)` : ''}`,
        suggestion: suggestion ?? `Check property name. Available: ${propList}`,
        fixes: [],
        confidence: 0.85,
      };
    },
  },

  {
    id: 'UnknownProperty.context_property',
    check: 'UnknownProperty',
    priority: 20,
    when: (diag, facts) => {
      const objectName = diag.params?.object;
      if (!objectName) return false;
      return objectName.startsWith('context') && !!facts.objectsIndex?.loaded;
    },
    apply: (diag, facts) => {
      const params = diag.params!;
      const objectName = params.object;
      const propertyName = params.property;

      if (!facts.objectsIndex) return null;
      const contextObjects = facts.objectsIndex.contextObjects();
      const allProps: string[] = [];
      for (const obj of contextObjects) {
        allProps.push(...obj.properties);
      }

      const nearest = nearestByLevenshtein(propertyName, allProps, 3);
      const suggestion = nearest.length > 0
        ? `Did you mean \`${nearest[0].name}\`?`
        : null;
      const contextNames = contextObjects.slice(0, 5).map(o => `\`${o.handle}\``).join(', ');

      return {
        rule_id: 'UnknownProperty.context_property',
        hint_md: `Property \`${propertyName}\` not found on \`${objectName}\`.${suggestion ? ` ${suggestion}` : ''}\n\nAvailable context objects: ${contextNames}. Use \`lookup\` to see full property lists.`,
        fixes: [],
        confidence: 0.7,
        see_also: {
          tool: 'domain_guide',
          args: { domain: 'partials', section: 'api' },
          reason: 'Context property not found. domain_guide(partials, api) lists available context.* objects and their properties.',
        },
      };
    },
  },

  {
    id: 'UnknownProperty.generic',
    check: 'UnknownProperty',
    priority: 100,
    when: (diag) => !!(diag.params?.property && diag.params?.object),
    apply: (diag) => {
      const params = diag.params!;
      const propertyName = params.property;
      const objectName = params.object;
      const isPartial = diag.file?.includes('/partials/');

      return {
        rule_id: 'UnknownProperty.generic',
        hint_md: `Property \`${propertyName}\` doesn't exist on \`${objectName}\`.${isPartial ? ' If this is a partial parameter, declare it in the {% doc %} block.' : ''} Check the property name for typos.`,
        fixes: [],
        confidence: 0.4,
      };
    },
  },

  // Last-resort catch-all. Reached when `.generic`'s extraction guard failed
  // (object name OR property name absent from the parsed message). Hint
  // stays generic and points at `lookup` so the agent can still recover
  // without the symbol names.
  {
    id: 'UnknownProperty.default',
    check: 'UnknownProperty',
    priority: 1000,
    when: () => true,
    apply: () => ({
      rule_id: 'UnknownProperty.default',
      hint_md:
        `A property reference does not resolve on its host object. Read the upstream message — ` +
        `it names both the object and the property. Three canonical resolutions:\n` +
        `  • **Typo** — fix the property name on the call site.\n` +
        `  • **Schema property** — if the object is a record from a schema, verify the property ` +
        `against \`app/schema/<table>.yml\`. Use \`lookup\` (completions mode) at the property ` +
        `position to see what's actually defined.\n` +
        `  • **Partial @param** — if this fires inside a partial / command / query, declare the ` +
        `parameter in the file's \`{% doc %}\` block so the linter knows its shape.`,
      fixes: [{
        type: 'guidance',
        description:
          `Re-read the upstream message for the object and property names, then verify against ` +
          `the relevant \`app/schema/<table>.yml\`, the partial's \`{% doc %}\` block, or via ` +
          `\`lookup\` (completions mode) at the property position.`,
      }],
      confidence: 0.4,
    }),
  },
];
