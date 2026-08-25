---
id: TASK-83.5
title: >-
  `layout: false` message claims a fallback that never happens — the deploy is
  rejected
status: Done
assignee: []
created_date: '2026-08-22 16:32'
updated_date: '2026-08-22 17:02'
labels:
  - platformos-check
  - frontmatter
  - correctness
  - docs
dependencies: []
parent_task_id: TASK-83
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The check tells the author that `layout: false` works:

> `layout: false` falls back to the default layout. Use `layout: ''` to disable layout rendering.

It does not. Measured twice on a live instance:

```
---
slug: probe
layout: false
---
```
```
$ pos-cli deploy --dry-run
Validation failed:
views/pages/zz_case.liquid: undefined method 'sub' for false      (exit 1)
```

Cause, `page_converter.rb:143`:

```ruby
def set_layout(page, value)
  page.layout = value&.sub(%r{^layouts/}, '') unless value.nil?
end
```

`&.` guards `nil`, not `false`. YAML parses `layout: false` as the boolean and `false.sub` raises. `self.use_layout` (`:155`) only supplies the instance default when `layout` is **nil**, so the boolean never reaches the fallback path the message describes. `set_layout_name` (`:151`) has the same shape.

The suggested replacement is correct and stays: `layout: ''` validates and deploys clean (measured).

## Why it matters beyond the wording

This message is the evidence behind the reasoning in `blocking.ts` that `layout: false` is a benign finding, which is the stated reason `ValidFrontmatter` could not join `BLOCKING_CHECKS` without introducing a false block. Correcting the message removes that objection; TASK-83.1 acts on it.

## Scope

Message text plus the docblock that states the rationale, and the two spec assertions pinning the old wording (`valid-frontmatter/index.spec.ts:328`, `:360`). The message does not appear in `transport/instructions.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The message states that the deploy is rejected, rather than that the value falls back to the default layout
- [x] #2 The `layout: ''` suggestion is unchanged and still produces a buffer that validates clean, asserted by applying the suggestion and re-running the check
- [x] #3 The docblock cites `page_converter.rb` set_layout and the measured converter error rather than describing runtime fallback behaviour
- [x] #4 No occurrence of the old wording survives anywhere in the repository
- [x] #5 A changeset accompanies the change
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered inside TASK-83.1 rather than as a separate change.

`InvalidFrontmatterValue` is the new home of the `layout: false` diagnostic, so writing that check meant writing this message. Shipping a brand-new check carrying wording already measured to be false was not a defensible increment, so the correction landed with it.

The message now says the deploy converter rejects the file and fails the whole changeset, instead of claiming a fallback to the default layout. The docblock cites `page_converter.rb`'s `set_layout` (`value&.sub(…) unless value.nil?` guards `nil`, not `false`) and the measured `undefined method 'sub' for false`, and notes that `use_layout` only supplies the instance default when `layout` is absent, so a boolean never reaches the fallback path the old wording described.

The `layout: ''` suggestion is unchanged. Its two pinned assertions were updated, and no occurrence of the old wording survives anywhere in the repository.

The wider consequence is recorded in `blocking.ts`: this message was the evidence behind the claim that `layout: false` was the one harmless finding, which was the stated reason `ValidFrontmatter` could not join `BLOCKING_CHECKS`. With it corrected, that objection is gone and `InvalidFrontmatterValue` blocks.
<!-- SECTION:FINAL_SUMMARY:END -->
