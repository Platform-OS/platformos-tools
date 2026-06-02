/**
 * MissingAsset rules — `{{ 'foo.css' | asset_url }}` or
 * `{% include_asset 'foo.js' %}` references a file that doesn't exist
 * under `app/assets/`.
 *
 * Pre-rule the check landed as `.unmatched`; fix-generator's
 * `fixMissingAsset` produced an unconditional `create_file` proposal
 * (`app/assets/<path>`). That's wrong roughly half the time — the more
 * common case is a typo or a missing subdirectory prefix
 * (`logo.png` vs `images/logo.png`). The DEMO data showed 0 % resolution,
 * 33 % adoption-but-`partial` (agent ran the create_file then realized the
 * intended file was elsewhere).
 *
 * Subrules:
 *   5  — missing_subdir_prefix: bare filename like `logo.png` matches an
 *        existing asset under a known subdir (`images/logo.png`).
 *        Highest-confidence "this is a typo, fix the reference" signal.
 *   10 — suggest_nearest: Levenshtein vs `assetNames(graph)`. Catches
 *        ordinary typos (`maain.css` → `main.css`).
 *  100 — create_file: nothing close, propose creating it. Mirrors the
 *        existing heuristic so analytics gets stable rule_id even when no
 *        match exists.
 */

import type { Rule } from './engine';
import { assetNames, nearestByLevenshtein } from './queries';

const KNOWN_ASSET_SUBDIRS = ['images', 'styles', 'scripts', 'fonts', 'media'];

export const rules: Rule[] = [
  {
    id: 'MissingAsset.missing_subdir_prefix',
    check: 'MissingAsset',
    priority: 5,
    when: (diag, facts) => {
      const wanted = parseAssetPath(diag.message);
      if (!wanted || wanted.includes('/')) return false;
      if (!facts?.graph) return false;
      const all = assetNames(facts.graph);
      return all.some(a => assetMatchesBareName(a, wanted));
    },
    apply: (diag, facts) => {
      const wanted = parseAssetPath(diag.message);
      if (!wanted || !facts.graph) return null;
      const all = assetNames(facts.graph);
      const matches = all.filter(a => assetMatchesBareName(a, wanted));
      const best = matches[0];
      const matchList = matches.slice(0, 5).map(m => `\`${m}\``).join(', ');
      return {
        rule_id: 'MissingAsset.missing_subdir_prefix',
        hint_md:
          `\`${wanted}\` is not at \`app/assets/${wanted}\` directly, but a file with this name lives under ` +
          `a subdirectory: ${matchList}. \`asset_url\` paths are relative to \`app/assets/\` AND must include ` +
          `the subdirectory (\`images/\`, \`styles/\`, \`scripts/\`, \`fonts/\`, \`media/\`). Fix the reference, ` +
          `don't create a new file.`,
        fixes: [{
          type: 'guidance',
          description:
            `Replace \`'${wanted}'\` with \`'${best}'\` in the \`asset_url\` filter (or \`include_asset\` tag). ` +
            `Do NOT create a new \`app/assets/${wanted}\` — the file already exists at \`app/assets/${best}\`.`,
        }],
        confidence: 0.9,
      };
    },
  },

  {
    id: 'MissingAsset.suggest_nearest',
    check: 'MissingAsset',
    priority: 10,
    when: (diag, facts) => {
      const wanted = parseAssetPath(diag.message);
      if (!wanted) return false;
      if (!facts?.graph) return false;
      const all = assetNames(facts.graph);
      if (all.length === 0) return false;
      return nearestByLevenshtein(wanted, all, 3).length > 0;
    },
    apply: (diag, facts) => {
      const wanted = parseAssetPath(diag.message);
      if (!wanted || !facts.graph) return null;
      const all = assetNames(facts.graph);
      const nearest = nearestByLevenshtein(wanted, all, 3);
      const best = nearest[0].name;
      const list = nearest.map(n => `\`${n.name}\``).join(', ');
      return {
        rule_id: 'MissingAsset.suggest_nearest',
        hint_md:
          `\`${wanted}\` not found under \`app/assets/\`. Did you mean: ${list}? ` +
          `If the reference is a typo, fix it. If you genuinely need a new asset, create the file ` +
          `at \`app/assets/${wanted}\`.`,
        fixes: [{
          type: 'guidance',
          description:
            `Replace \`'${wanted}'\` with \`'${best}'\` in the \`asset_url\` filter (or \`include_asset\` tag). ` +
            `Distance ${nearest[0].distance} — verify the suggestion before applying.`,
        }],
        confidence: nearest[0].distance <= 2 ? 0.85 : 0.65,
      };
    },
  },

  {
    id: 'MissingAsset.create_file',
    check: 'MissingAsset',
    priority: 100,
    when: () => true,
    apply: (diag) => {
      const wanted = parseAssetPath(diag.message);
      const targetPath = wanted ? `app/assets/${wanted}` : 'app/assets/<path>';
      return {
        rule_id: 'MissingAsset.create_file',
        hint_md:
          `\`${wanted ?? 'asset'}\` does not exist under \`app/assets/\`. ` +
          `\`asset_url\` paths are relative to \`app/assets/\` AND must include the subdirectory ` +
          `(\`images/\`, \`styles/\`, \`scripts/\`, \`fonts/\`, \`media/\`). ` +
          `If this is a module-shipped asset the file may already exist inside the module's ` +
          `\`public/assets/\` — module assets are referenced through the same \`asset_url\` filter ` +
          `and should resolve automatically; if they don't, the module isn't installed.`,
        fixes: [{
          type: 'guidance',
          description:
            `Create the asset at \`${targetPath}\`, OR (more likely) fix the reference — module assets ` +
            `live under \`modules/<name>/public/assets/\` and resolve through the same \`asset_url\` filter ` +
            `without any path prefix. Only create a new file when you control the asset and it is genuinely missing.`,
        }],
        confidence: 0.6,
      };
    },
  },
];

function parseAssetPath(message: string | undefined): string | null {
  if (!message) return null;
  const m = message.match(/['"`]([^'"`]+)['"`]\s+does not exist/);
  return m ? m[1] : null;
}

function assetMatchesBareName(assetPath: string, bareName: string): boolean {
  // `assetPath` is relative to app/assets/, e.g. `images/logo.png`. We're
  // matching when the LAST segment equals the bare name AND the leading
  // segment is one of the conventional asset subdirs. This avoids
  // false-positive matches against unrelated nested files
  // (e.g. agent wrote `data.json` and we'd otherwise match `vendor/x/data.json`).
  const slash = assetPath.indexOf('/');
  if (slash < 0) return false;
  const subdir = assetPath.slice(0, slash);
  const tail = assetPath.slice(slash + 1);
  return tail === bareName && KNOWN_ASSET_SUBDIRS.includes(subdir);
}
