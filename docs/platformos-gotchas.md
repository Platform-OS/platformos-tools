# platformOS gotchas — measured, not assumed

Behaviours of the platformOS runtime and deploy converter that a check cannot record.

**Everything a check enforces has been removed from this file.** A rule with a check is
documented by that check and its tests, which fail when the rule changes; prose cannot fail,
so duplicating a rule here only creates something to rot. What is left is the three kinds of
knowledge no test can hold: *why* a check is written the way it is, *how* to measure the
platform without fooling yourself, and *what* is deliberately not checked at all.

Two oracles are used throughout, and which one applies is never a matter of taste:

| Oracle | Question it answers | Use it for |
|---|---|---|
| `pos-cli deploy --dry-run` | will the **converter** accept this file? | syntax, deployability |
| `/api/app_builder/liquid_exec` | what does the **runtime** do with this value? | semantics, types, raises |

A converter rejection fails the **whole changeset**, not just the offending file. A runtime
raise breaks one render. They are different failure modes, and the dry-run oracle outranks the
runtime one *for syntax only*.

---

## 1. The platform reads YAML **1.1**, and your parser almost certainly reads 1.2

The highest-yield sentence here, and the reason the YAML checks are shaped as they are. Ruby
Psych/libyaml implements YAML **1.1**; npm `yaml` implements 1.2. Three separate defects — a
false block, a false positive, and a documented silence whose stated reason was wrong — all
fell out of nobody having written this down.

**Keys that look different and are ONE key** (measured, Psych 5.3.1):

| YAML | Resolves to |
|---|---|
| `yes:` and `true:` | both boolean `true` — the second value silently wins |
| `TRUE:` and `true:` | both boolean `true` |
| `014:` and `12:` | YAML 1.1 **octal** — both `Integer(12)` |
| `null:` and `~:` | both `nil` |
| `+1:` and `1:` | both `Integer(1)` |
| `0x10:` and `16:` | both `Integer(16)` |
| `1:30:` and `5400:` | YAML 1.1 **sexagesimal** — both `Integer(5400)` |

**Keys that look the same and are TWO keys:**

| YAML | Why |
|---|---|
| `1:` and `"1":` | a number and a string. One key in a JS object, two in a Ruby Hash |
| `1:` and `1.0:` | `Integer(1)` and `Float(1.0)`. Ruby Hash uses `eql?`, which is class-sensitive: `1.eql?(1.0)` is **false** |
| `on:` and `off:` | both booleans, different values |
| `y:` and `n:` | **strings** in Psych, despite the YAML 1.1 spec listing them as booleans |
| `<<:` twice | merge keys, repeatable |

That last row is why this has to be **measured** rather than derived: Psych does not implement
the 1.1 spec's full boolean set. Reading the spec gives the wrong answer.

**Two traps in the "is it one key" test itself**, both measured against
`Psych.safe_load(…).size`, which is the only trustworthy way to ask:

- **`-0.0:` and `0.0:` are ONE key**, even though `-0.0.inspect != 0.0.inspect`. `Float#eql?`
  is value-based, so signed zeros collapse — unlike the `Integer`/`Float` split above, where
  the *classes* differ. Comparing keys by class plus `inspect` gets this exactly backwards.
- **Psych's boolean resolution is case-insensitive well beyond the spec's three spellings.**
  `TrUe:` is boolean `true`, and collides with `true:`, `TRUE:`, `yes:`, `on:` and `oN:`.
  Likewise `.Inf:` and `.INF:` are both `Float::INFINITY` and collide with `.inf:`; `.NAN:`
  collides with `.nan:`. Any list of "the boolean spellings" short enough to write down is
  wrong.
- **`.nan:` twice is ONE key, yet two NaN objects are not `eql?`.** So even *object identity*
  is not a safe proxy: `YAML.load(".nan: x\n.nan: y").size == 1`, while
  `(0.0/0.0).eql?(0.0/0.0)` is `false`. Every proxy for the question disagrees with the
  question somewhere. Load the two-key document and read `.size`.
- **A parser's "source text" may exclude the quotes.** In npm `yaml`, `"yes"` has
  `source: 'yes'` — identical to the plain `yes` that Psych resolves to a boolean. The only
  reliable discriminator is the scalar's *type* (`QUOTE_DOUBLE` vs `PLAIN`). Deciding from
  source text reports `yes:` and `"yes":` as one key, which Psych keeps as two.

Compare keys by **what the platform's parser does with a document containing both**, never by
source text, never by your own parser's resolution, and never by a proxy for Ruby's equality.

The measured answers live in `src/yaml/psych-key-identity.ts`, generated against a live Ruby.
Wherever a checker and its target implement the same format independently, run the
differential rather than reasoning about the spec.

---

## 2. Probing the platform: oracles that lie

- **`pos-cli deploy --dry-run` fails intermittently, and the failure looks like a rejection.**
  Roughly one probe in fifteen came back without `Dry run completed` and **without any Liquid
  error in the output**. Three separate constructs were scored as converter rejections on the
  first pass and came back ACCEPTED 2/2 and 3/3 on re-probe — one would have inverted a
  finding. Require a **positive error message**, never merely the absence of the success line,
  and repeat every rejection. Treating "did not succeed" as "was refused" manufactures
  findings.
- **`liquid_exec` aborts the whole template at the first raise.** Probing several constructs in
  one request measures only the first failure — send one per request.
- **A raise whose message embeds a binary value comes back HTTP 406 with no body.**
  `gzip_compress`, `ecdh_compute` and `hkdf` return binary, so the runtime's own complaint is
  unencodable. Treating any non-2xx as "rendered" turns this into a phantom finding.
- **`type_of` is the cheapest runtime type oracle** — `{{ x | type_of }}` returns `String`,
  `Integer`, `Float`, `Boolean`, `Array`, `Hash`, `Date`, `Time`, `Range`, `null`.
- **`pos-cli sync --file-path` on a deleted file is a silent no-op.** It does not push a
  deletion. Removing a file from an instance needs
  `DELETE /api/app_builder/marketplace_releases/sync` with `path` and `primary_key`, or a full
  deploy.

---

## 3. Formatting platformOS Liquid can delete code

`prettier-plugin-liquid` regenerates source from the AST rather than editing text, so anything
the AST does not carry is deleted on the next format — in the author's own file, with no error
at any layer. This is the standing hazard behind every grammar change: a construct whose markup
survives today as a raw string stops surviving the moment the grammar parses it, unless the
printer learns to print it.

Measured across all 46 tag names and 112 constructs: exactly one construct came back changed in
a way that mattered — a `hash_assign` bracket target (`h['k']`) rewritten to dot access
(`h.k`), which the converter then rejects, failing the whole changeset. That class of rewrite
is what to look for when auditing the printer.

The printer also inserts and moves whitespace-control markers (`-%}`, `{{-`) freely to preserve
rendering while it reflows. That is intended; a diff that treats it as corruption will bury the
one change that is real.

---

## 4. What is *not* validated, and must not be assumed

- The **shape** of a model schema. An unknown property deploys fine.
- Nested `hash_assign` subscripts (`x[0]['k']`) — a known, bounded gap.
- `hash_assign` on a variable never assigned in the file. In a partial the variable may
  legitimately arrive as a render argument, so silence is correct.
- Return types for the six undocumented filters, in the **language server** — it types them all
  as `string` by default.
