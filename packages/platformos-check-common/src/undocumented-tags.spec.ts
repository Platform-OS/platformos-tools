import { describe, expect, it } from 'vitest';

import tagsJson from '../../platformos-check-docs-updater/data/tags.json';
import { AugmentedPlatformOSDocset } from './AugmentedPlatformOSDocset';
import { REGISTERED_TAGS } from './registered-tags';
import { undocumentedTagEntries } from './undocumented-tags';
import type { PlatformOSDocset, TagEntry } from './types';

/**
 * TASK-56. Eight tags the platform registers were reported as `Unknown tag`, and because
 * `LiquidHTMLSyntaxError` is an ERROR that the MCP supervisor treats as BLOCKING, each was
 * an unappealable refusal of code the platform runs.
 *
 * The derivation here is the whole fix, and every judgement it makes is supposed to come
 * from measured data: whether a tag is an ALIAS comes from the handler class, and whether
 * it is DEPRECATED comes from the platform's own comment. These tests exist to stop either
 * from quietly becoming an inference from the name.
 */
/**
 * Only the field these tests read; the docs payload carries many more, and some of them
 * (`return_type: []`, an empty-string `deprecation_reason`) do not line up with `TagEntry`.
 * Narrowing to what is actually used avoids asserting a shape nobody depends on.
 */
type DocumentedTag = { name: string };

const documented = tagsJson as DocumentedTag[];

/** A docset that documents nothing, for isolating the derivation from the real docs. */
const emptyDocset = (tags: TagEntry[] = []): PlatformOSDocset => ({
  filters: async () => [],
  objects: async () => [],
  liquidDrops: async () => [],
  tags: async () => tags,
  graphQL: async () => null,
});

describe('Unit: undocumentedTagEntries', () => {
  it('adds exactly the tags the official docs omit', () => {
    // Pinned whole against the REAL `tags.json`, so this is the actual gap rather than a
    // property of a mock. Eleven names: three Liquid sub-tags the docs never listed, and
    // the eight registered tags of TASK-56.
    expect(undocumentedTagEntries(documented).map((tag) => tag.name)).toEqual([
      'elsif',
      'ifchanged',
      'when',
      'context_rc',
      'execute_query',
      'function_rc',
      'query_graph',
      'render_form',
      'return_rc',
      'sign_in_rc',
      'try_rc',
    ]);
  });

  it('describes each added tag exactly, including what to use instead', () => {
    // Pinned whole because these strings are what an author reads. `summary` reaches LSP
    // hover; `deprecation_reason` becomes the `DeprecatedTag` message.
    //
    // Note what is NOT here: `execute_query` and `query_graph` get no remedy, because they
    // have their OWN handler classes and no comment marking them — they are simply
    // undocumented, and inventing a replacement for them would be worse than saying
    // nothing.
    expect(undocumentedTagEntries(documented)).toEqual([
      { name: 'elsif' },
      { name: 'ifchanged' },
      { name: 'when' },
      {
        name: 'context_rc',
        summary:
          'Alias of `{% context %}` — the platform registers both names against the same handler (`Liquify::Tags::ContextTag`).',
      },
      {
        name: 'execute_query',
        summary:
          'Registered by platformOS (`Liquify::Tags::ExecuteQueryTag`) but absent from the official tag documentation.',
      },
      {
        name: 'function_rc',
        summary:
          'Alias of `{% function %}` — the platform registers both names against the same handler (`Liquify::Tags::FunctionTag`).',
        deprecated: true,
        deprecation_reason:
          'use `{% function %}` instead (the platform\'s registry says "TODO: remove").',
      },
      {
        name: 'query_graph',
        summary:
          'Registered by platformOS (`Liquify::Tags::QueryGraphTag`) but absent from the official tag documentation.',
      },
      {
        name: 'render_form',
        summary:
          'Alias of `{% include_form %}` — the platform registers both names against the same handler (`Liquify::Tags::IncludeFormTag`).',
        deprecated: true,
        deprecation_reason:
          'use `{% include_form %}` instead (the platform\'s registry says "For semi-backwards compatibility, for now...").',
      },
      {
        name: 'return_rc',
        summary:
          'Alias of `{% return %}` — the platform registers both names against the same handler (`Liquify::Tags::ReturnTag`).',
        deprecated: true,
        deprecation_reason:
          'use `{% return %}` instead (the platform\'s registry says "TODO: remove").',
      },
      {
        name: 'sign_in_rc',
        summary:
          'Alias of `{% sign_in %}` — the platform registers both names against the same handler (`Liquify::Tags::SignInTag`).',
        deprecated: true,
        deprecation_reason:
          'use `{% sign_in %}` instead (the platform\'s registry says "TODO: remove").',
      },
      {
        name: 'try_rc',
        // No `deprecated` flag: the registry annotates `function_rc`, `return_rc` and
        // `sign_in_rc` with "TODO: remove" and says nothing about this one. It is an alias
        // on the evidence of the handler class, and that is all we claim.
        summary:
          'Alias of `{% try %}` — the platform registers both names against the same handler (`Liquify::Tags::TryTag`).',
      },
    ]);
  });

  it('reads DEPRECATION from the registry comment, never from the `_rc` suffix', () => {
    // THE CONTROL FOR THE PREVIOUS TEST. Five of the added names end in `_rc`, and the
    // obvious shortcut — treat `_rc` as "release candidate, deprecated" — would be
    // inference dressed as measurement. It is also WRONG for `context_rc`, which the
    // platform registers with no comment at all.
    //
    // So the split must be UNEVEN across the `_rc` names, and this asserts that it is:
    // `function_rc`, `return_rc` and `sign_in_rc` are deprecated because the registry says
    // "TODO: remove" beside them, while `context_rc` and `try_rc` — same suffix, same
    // alias relationship, no comment — are not. Deriving deprecation from the name would
    // move those two and fail here.
    //
    // `render_form` is deprecated without an `_rc` suffix at all, which is the other half
    // of the same point: the suffix is not the signal, the comment is.
    const added = undocumentedTagEntries(documented);
    const deprecated = added.filter((tag) => tag.deprecated).map((tag) => tag.name);
    const notDeprecated = added.filter((tag) => !tag.deprecated).map((tag) => tag.name);

    expect(deprecated).toEqual(['function_rc', 'render_form', 'return_rc', 'sign_in_rc']);
    expect(notDeprecated).toEqual([
      'elsif',
      'ifchanged',
      'when',
      'context_rc',
      'execute_query',
      'query_graph',
      'try_rc',
    ]);
  });

  it('resolves the canonical name from the HANDLER, not from name similarity', () => {
    // `render_form` is the case that distinguishes the two methods, which is why it is
    // named here rather than left to the whole-value assertion above. Nothing about the
    // string "render_form" points at "include_form" — no shared prefix, no `_rc` suffix to
    // strip. The only link is `Liquify::Tags::IncludeFormTag`, and a name-based
    // implementation would either produce no remedy or point at `render`, a Liquid built-in
    // that does something else entirely.
    const renderForm = undocumentedTagEntries(documented).find((tag) => tag.name === 'render_form');

    expect(renderForm?.deprecation_reason).toEqual(
      'use `{% include_form %}` instead (the platform\'s registry says "For semi-backwards compatibility, for now...").',
    );
  });

  it('adds nothing the docset already documents', () => {
    // The list exists only to cover gaps. A duplicate entry would give the same tag two
    // docset entries with different summaries, and which one hover picked would be an
    // accident of ordering.
    const documentedNames = new Set(documented.map((tag) => tag.name));
    const redundant = undocumentedTagEntries(documented).filter((tag) =>
      documentedNames.has(tag.name),
    );

    expect(redundant).toEqual([]);
  });

  it('recomputes the gap against the docset it is GIVEN, not against a build-time snapshot', () => {
    // `data/tags.json` is re-downloaded by the docs-updater's `postbuild`, so the gap has
    // to be computed from the live docset — a snapshot taken when this package was built
    // would go stale precisely when the docs GAIN a tag, and would go stale silently.
    //
    // Asserted by giving it a docset that already documents `render_form`: the entry must
    // disappear, and the rest must remain.
    const withRenderForm = undocumentedTagEntries([...documented, { name: 'render_form' }]);

    expect(withRenderForm.map((tag) => tag.name)).toEqual([
      'elsif',
      'ifchanged',
      'when',
      'context_rc',
      'execute_query',
      'function_rc',
      'query_graph',
      'return_rc',
      'sign_in_rc',
      'try_rc',
    ]);
  });

  it('covers every registered tag the docs omit, so none is left blocking', () => {
    // The completeness half. The tests above pin WHAT is added; this pins that nothing
    // registered was skipped — a registered tag absent from both the docs and this list is
    // exactly the TASK-56 defect, and it would be invisible to every assertion above.
    const documentedNames = new Set(documented.map((tag) => tag.name));
    const addedNames = new Set(undocumentedTagEntries(documented).map((tag) => tag.name));

    const stillMissing = REGISTERED_TAGS.map((tag) => tag.name).filter(
      (name) => !documentedNames.has(name) && !addedNames.has(name),
    );

    expect(stillMissing).toEqual([]);
  });
});

describe('Integration: the docset actually receives them', () => {
  it('reaches AugmentedPlatformOSDocset, so `UnknownTag` accepts these names', async () => {
    // Without this, deleting the spread in `AugmentedPlatformOSDocset.tags()` would leave
    // every test above passing while all eight tags went back to blocking.
    const tags = await new AugmentedPlatformOSDocset(emptyDocset([{ name: 'assign' }])).tags();
    const names = tags.map((tag) => tag.name);

    expect(names.filter((name) => name === 'render_form')).toEqual(['render_form']);
    expect(REGISTERED_TAGS.map((tag) => tag.name).filter((name) => !names.includes(name))).toEqual(
      [],
    );
    // ...and the injected docset's own tags still come through alongside them.
    expect(names).toContain('assign');
  });

  it('does not duplicate a tag the injected docset already carries', async () => {
    // The docset the language server injects is not `tags.json` — it is whatever the
    // instance's docs API returned, which may already carry names this list also knows.
    const tags = await new AugmentedPlatformOSDocset(
      emptyDocset([{ name: 'try' }, { name: 'try_rc', summary: 'from the docs' }]),
    ).tags();

    expect(tags.filter((tag) => tag.name === 'try_rc')).toEqual([
      { name: 'try_rc', summary: 'from the docs' },
    ]);
  });
});
