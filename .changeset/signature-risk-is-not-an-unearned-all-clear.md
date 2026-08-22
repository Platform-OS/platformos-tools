---
'@platformos/platformos-mcp-supervisor': patch
---

Stop `impact.signature_risk` answering "checked, every caller matches" when no caller was
visible to check.

The field is three-valued: absent means the file publishes no parameter contract, an empty
array means every caller matches, a populated one names the callers that break. Sending one
logical change as several calls turned the middle value into a false all-clear — a partial
edited alone, with a `@param` made newly required, answered:

```jsonc
"dependents": { "total": 0, "by_kind": {}, "sample": [] },
"signature_risk": []
```

produced because its only caller was in a different call. Nothing was checked, and an absent
answer would have been better than a false one. The empty list is now withheld when no
dependents were found AND the file is not on disk; the type and the server instructions both
say what its absence means.

`dependents` and `status` are deliberately unchanged. A file that is not yet on disk is the
NORMAL case for this tool — the instructions tell an agent to call it before the write — so
withholding the blast radius there would degrade the primary flow to fix a narrow one. Only
the affirmative is withheld.

Send the whole change in one call and nothing is withheld: the caller resolves from the
changeset, and the signature is checked against it.
