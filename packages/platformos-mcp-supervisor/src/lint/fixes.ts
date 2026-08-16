/**
 * The engine's concrete edits, in the shape an agent applies them in.
 *
 * A PURE SHAPE MAPPING and nothing more. `check-node` runs the `Fixer` functions — beside
 * the lint, while the `App` still holds the buffer — and hands back `FixDescription[]`; all
 * that is left here is renaming three fields.
 *
 * RUNNING A FIXER HERE WOULD BE WRONG: a fixer may read back through the `App`
 * (`missing-doc-param`'s calls `indentationOfLineAt`, which reads `file.source`), and after
 * `lintBuffers` has reverted its overlay that either throws or computes against DISK text.
 *
 * NOTHING HERE AUTHORS EDIT TEXT. Every byte came out of a corrector a check drove.
 */
import type { MaterialisedFix } from '@platformos/platformos-check-node';

import type { AgentEdit, AgentFix } from '../result/types.js';

/** The agent-facing fix fields for one offense; keys are absent when the engine offered none. */
export interface OffenseFixes {
  fix?: AgentFix;
  suggestions?: AgentFix[];
}

/** check-common's `FixDescription` → the agent's `AgentEdit`. Field names, nothing else. */
function toEdits(edits: MaterialisedFix['fix'] & {}): AgentEdit[] {
  return edits.map((edit) => ({
    start_index: edit.startIndex,
    end_index: edit.endIndex,
    new_text: edit.insert,
  }));
}

/**
 * Map one offense's materialised fixes onto the diagnostic shape.
 *
 * `fix` and `suggestions` stay separate because the engine draws that distinction and an
 * agent must act on it differently: a fix is the answer and is safe to apply unread, a
 * suggestion is one of several choices and carries the engine's own wording.
 */
export function toAgentFixes(materialised: MaterialisedFix | undefined): OffenseFixes {
  if (!materialised) return {};

  const result: OffenseFixes = {};
  if (materialised.fix) result.fix = { edits: toEdits(materialised.fix) };
  if (materialised.suggestions) {
    result.suggestions = materialised.suggestions.map((suggestion) => ({
      description: suggestion.message,
      edits: toEdits(suggestion.edits),
    }));
  }
  return result;
}
