# platformOS Check Compatibility Report

This document lists checks and test scenarios that exist in the Ruby version of platformos-check (`@~/projects/lsp/platformos-check/`) but are missing in the Node.js version (`@packages/platformos-check-common/`).

## Missing Checks in Node.js Version

### 1. ConvertIncludeToRender
**Severity:** suggestion
**Category:** liquid
**Description:** Recommends replacing `include` for `render` tag as `include` is deprecated.

**Features:**
- Detects usage of `include` tag that can be safely converted to `render`
- Skips conversion when the partial name is a variable
- Skips conversion when the included partial contains render-incompatible tags (`break`, `include`)
- Provides auto-correction to replace `include` with `render`
- Recursively checks included partials for incompatible tags

**Test Scenarios:**
- Should not report when include cannot be safely converted
- Should report when include can be converted to render
- Should handle variable names in include statements
- Should detect render-incompatible tags in nested includes

---

### 2. FormAction
**Severity:** error
**Category:** html
**Description:** Validates that form action attributes start with `/` to ensure forms can be submitted multiple times in case of validation errors.

**Features:**
- Checks all `<form>` tags with `action` attributes
- Validates that action starts with `/`, `{%`, `{{`, `#`, or `http`
- Allows empty or missing action attributes
- Handles both quoted and unquoted action attributes

**Test Scenarios:**
- ✓ No offense with proper path starting with `/`
- ✗ Reports invalid action without leading `/`
- ✗ Reports invalid action without quotes
- ✓ No offense when action is dynamic (using variables)
- ✓ No offense when action is dynamic via render
- ✓ No offense when external URL (https://)
- ✓ No offense when no action attribute
- ✓ No offense when action is blank/empty

---

### 3. FormAuthenticityToken
**Severity:** error
**Category:** html
**Description:** Ensures forms with POST/PUT/DELETE methods include CSRF authenticity token for security.

**Features:**
- Checks all `<form>` tags with non-GET methods
- Only validates forms with relative URLs (starting with `/`)
- Detects existing `authenticity_token` inputs
- Validates the token value matches `{{ context.authenticity_token }}`
- Detects duplicate authenticity_token inputs
- Provides auto-correction to add missing token input

**Test Scenarios:**
- ✓ No offense for GET forms
- ✓ No offense for forms with correct authenticity token
- ✗ Reports missing authenticity token for POST forms
- ✗ Reports duplicated authenticity token inputs
- ✓ No offense for forms with external URLs
- Auto-fix: Inserts correct input tag

---

### 4. GraphqlInForLoop
**Severity:** suggestion
**Category:** liquid, performance
**Description:** Detects GraphQL queries invoked inside `for` loops, which can cause N+1 query problems and severe performance issues.

**Features:**
- Detects direct `{% graphql %}` tags inside `{% for %}` loops
- Traces through `render`, `include`, and `function` tags to find nested GraphQL calls
- Ignores GraphQL calls inside `{% background %}` tags (as they run async)
- Reports variable names when GraphQL partial name is dynamic
- Handles nested partials and functions
- Single-file check optimization flag

**Test Scenarios:**
- ✓ No offense when GraphQL is outside for loop
- ✗ Reports GraphQL directly in for loop
- ✗ Reports GraphQL in nested renders/includes within for loop
- ✓ No offense if for loop is inside background tag
- ✓ No offense if background tag is inside for loop
- ✓ No offense if render is not in for loop
- ✗ Reports when GraphQL is in deeply nested includes
- ✗ Reports with variable name when partial name is dynamic
- ✓ No offense if render partial does not exist

---

### 5. HtmlParsingError
**Severity:** error
**Category:** html
**Description:** Reports HTML parsing errors in templates.

**Features:**
- Catches and reports HTML parser exceptions
- Provides detailed error messages from the parser
- Helps identify malformed HTML that could cause rendering issues

**Test Scenarios:**
- ✗ Reports when HTML cannot be parsed
- Shows exception message to help debug

---

### 6. ImgLazyLoading
**Severity:** suggestion
**Category:** html, performance
**Description:** Suggests using the `loading` attribute on images for better performance.

**Features:**
- Checks all `<img>` tags
- Validates presence of `loading` attribute with values `lazy` or `eager`
- Recommends `loading="eager"` for above-the-fold images
- Recommends `loading="lazy"` for below-the-fold images
- Provides auto-correction to add `loading="eager"` by default

**Test Scenarios:**
- ✓ No offense when loading attribute is present with valid value
- ✗ Reports missing loading attribute
- Auto-fix: Adds loading="eager" attribute

---

### 7. IncludeInRender
**Severity:** error
**Category:** liquid
**Description:** Detects invalid use of `include` tag inside `render` context, which is not allowed in Liquid.

**Features:**
- Checks all `{% render %}` tags
- Analyzes the rendered partial for `include` tags
- Recursively checks nested templates
- Provides clear error message indicating which file contains the problematic include

**Test Scenarios:**
- ✓ No offense when render does not contain include
- ✗ Reports when rendered partial contains include tag
- ✗ Reports with file path of the problematic partial
- Message suggests either removing includes or changing render to include

---

### 8. InvalidArgs
**Severity:** error
**Category:** liquid, graphql
**Description:** Validates arguments passed to `render`, `function`, and `graphql` tags.

**Features:**
- Detects duplicated argument keys in all three tag types
- For `graphql` tags with external files:
  - Parses GraphQL file to extract defined arguments
  - Validates all provided arguments are defined
  - Validates all required arguments are provided
  - Skips validation if `args` catch-all parameter is used
- Handles GraphQL parse errors gracefully
- Provides auto-correction to remove duplicated arguments

**Test Scenarios:**
- ✗ Reports duplicated keys in render tags
- ✗ Reports duplicated keys in function tags
- ✗ Reports duplicated keys in graphql tags
- ✗ Reports undefined arguments in GraphQL files
- ✗ Reports missing required arguments in GraphQL files
- ✓ No offense if args parameter is used (catch-all)
- Auto-fix: Removes duplicate arguments

---

### 9. LiquidTag
**Severity:** suggestion
**Category:** liquid
**Description:** Recommends using `{% liquid ... %}` block when multiple consecutive Liquid tags are found, for cleaner and more maintainable code.

**Features:**
- Counts consecutive `{% ... %}` tags
- Configurable minimum threshold (default: 5 consecutive tags)
- Ignores comments
- Ignores tags already inside `{% liquid %}` blocks
- Resets counter on outputted strings or block boundaries
- Only counts non-empty strings

**Test Scenarios:**
- ✓ No offense when fewer than threshold consecutive tags
- ✗ Reports when threshold or more consecutive tags found
- ✓ Ignores comment tags in count
- ✓ Resets count on string output
- ✓ Ignores tags inside liquid blocks

---

### 10. MissingEnableComment
**Severity:** error
**Category:** N/A
**Description:** Ensures that checks disabled with `platformos-check-disable` comments are re-enabled with `platformos-check-enable` before the end of the file.

**Features:**
- Tracks all `platformos-check-disable` comments
- Tracks all `platformos-check-enable` comments
- Reports any checks that were disabled but never re-enabled
- Cannot itself be disabled (special flag: `can_disable false`)
- Handles both global disables and specific check disables

**Test Scenarios:**
- ✓ No offense when disable/enable are balanced
- ✗ Reports when disable without corresponding enable
- ✗ Reports which checks were not re-enabled
- ✗ Reports when "all checks" disabled but not re-enabled

---

### 11. ParseJsonFormat
**Severity:** style
**Category:** liquid
**Description:** Validates and formats JSON inside `{% parse_json %}` tags for consistency.

**Features:**
- Parses JSON content in parse_json tags
- Configurable indentation (default: 2 spaces)
- Configurable start level (default: 0)
- Provides auto-correction with pretty-printed JSON
- Skips if JSON is already properly formatted

**Test Scenarios:**
- ✓ No offense when JSON is properly formatted
- ✗ Reports when JSON formatting could be improved
- Auto-fix: Reformats JSON with proper indentation

---

### 12. ParserBlockingJavaScript
**Severity:** suggestion
**Category:** html, performance
**Description:** Similar to Node.js `parser-blocking-script` but may have different implementation details. Should be verified for compatibility.

**Note:** This check exists in both versions but needs comparison to ensure feature parity.

---

### 13. RequiredLayoutObject
**Severity:** error
**Category:** liquid
**Description:** Ensures layout files include the required `{{ content_for_layout }}` variable.

**Features:**
- Only runs on layout files
- Checks for presence of `content_for_layout` variable
- Provides auto-correction to insert the variable before `</body>` tag
- Critical for proper layout rendering

**Test Scenarios:**
- ✓ No offense when content_for_layout is present
- ✗ Reports missing content_for_layout in layouts
- Auto-fix: Inserts `{{ content_for_layout }}` before </body>

---

### 14. SpaceInsideBraces
**Severity:** style
**Category:** liquid
**Description:** Enforces consistent spacing inside Liquid braces `{% %}` and `{{ }}`, and around operators.

**Features:**
- Checks spacing after opening braces `{{` and `{%`
- Checks spacing before closing braces `}}` and `%}`
- Checks spacing around operators: `,`, `:`, `|`, `==`, `<>`, `<=`, `>=`, `<`, `>`, `!=`
- Handles whitespace control markers `-` properly
- Skips literal strings and assigned/echoed variables
- Provides detailed auto-correction for all violations
- Handles both too many spaces and missing spaces

**Test Scenarios:**
- ✗ Reports space missing after operators
- ✗ Reports too many spaces after operators
- ✗ Reports space missing before operators
- ✗ Reports too many spaces before operators
- ✗ Reports space missing after opening braces
- ✗ Reports too many spaces after opening braces
- ✗ Reports space missing before closing braces
- ✗ Reports too many spaces before closing braces
- Auto-fix: Adds or removes spaces as needed

---

### 15. SyntaxError
**Severity:** error
**Category:** liquid
**Description:** Reports Liquid syntax errors from the parser.

**Features:**
- Captures Liquid syntax errors during parsing
- Reports file-level warnings
- Includes line numbers and context
- Cleans up error messages for readability
- Reports template name when available

**Test Scenarios:**
- ✗ Reports syntax errors with line numbers
- Shows markup context where error occurred
- Handles errors in included templates

---

### 16. TemplateLength
**Severity:** suggestion
**Category:** liquid
**Description:** Warns when templates exceed a maximum number of lines, encouraging better code organization.

**Features:**
- Configurable maximum length (default: 600 lines)
- Counts all lines including whitespace
- Reports actual vs maximum line count
- Encourages splitting large templates into partials

**Test Scenarios:**
- ✓ No offense when under max length
- ✗ Reports when over max length with line count
- Shows [current/max] format in message

---

### 17. TranslationFilesMatch
**Severity:** error
**Category:** translation
**Description:** Validates translation file structure and ensures all languages have matching translation files with consistent structure.

**Features:**
- Validates language code matches directory structure
- Validates language code in file matches the language key in YAML
- Checks for missing translation files across languages
- Validates all translation files have the same key structure
- Handles pluralization keys specially (zero, one, two, few, many, other)
- Provides auto-corrections:
  - Move files to correct language directories
  - Fix language keys in YAML files
  - Create missing translation files
  - Fix structure mismatches

**Test Scenarios:**
- ✗ Reports when file not in correct language directory
- ✗ Reports when YAML language key doesn't match directory
- ✗ Reports missing translation files for other languages
- ✗ Reports when structure differs from default language
- ✓ Handles pluralization keys correctly
- Auto-fix: Moves files, fixes YAML, creates missing files

---

### 18. UnreachableCode
**Severity:** error
**Category:** liquid
**Description:** Detects code that comes after flow control statements (`break`, `continue`, `return`) and can never be executed.

**Features:**
- Detects unreachable code after `break`, `continue`, `return`
- Analyzes flow control in:
  - `if`/`elsif`/`else` blocks
  - `unless` blocks
  - `for` loops
  - `case`/`when`/`else` blocks
  - `try`/`catch`/`ensure` blocks (try_rc)
- Traces through `include` tags to detect breaks in included partials
- Recursively analyzes nested control structures
- Identifies non-obvious unreachable code in nested includes

**Test Scenarios:**
- ✓ No offense with proper flow control
- ✓ No offense in for loop when if is used (conditional break)
- ✗ Reports unreachable code in for loop after unconditional break
- ✗ Reports unreachable code after break in if block
- ✗ Reports unreachable code after break followed by text
- ✗ Reports unreachable code after return
- ✗ Reports in nested if/elsif/else blocks
- ✗ Reports in case/when blocks
- ✗ Reports in try/catch/ensure blocks
- ✗ Reports when break is in nested include
- ✗ Reports when break is in deeply nested includes
- ✓ Handles complex nested control flow

---

### 19. UnusedPartial
**Severity:** suggestion
**Category:** liquid
**Description:** Detects partials that are defined but never used in the application.

**Features:**
- Tracks all `render`, `include`, and `function` tags
- Builds list of used partials
- Compares against all defined partials
- Handles special case: `{% render block %}` (variable referring to block in OS 2.0)
- Ignores check if dynamic partial names are used (can't reliably track)
- Provides auto-correction to delete unused partial files
- Special handling for module files (no auto-delete)

**Test Scenarios:**
- ✓ No offense when all partials are used
- ✗ Reports unused partials
- ✗ Does not auto-delete module files
- ✓ Handles `{% render block %}` pattern correctly
- Ignores check when expressions used for partial names
- Auto-fix: Deletes unused partial files

---

### 20. ValidYaml
**Severity:** error
**Category:** yaml
**Description:** Validates YAML file syntax.

**Features:**
- Reports YAML parsing errors
- Provides error message from YAML parser
- Helps identify syntax issues in configuration and translation files

**Test Scenarios:**
- ✗ Reports YAML parsing errors with detailed message
- Helps locate syntax problems

---

## Checks Present in Both Versions

The following checks exist in both Ruby and Node.js versions, but may need verification for feature parity:

### Checks Likely Similar:
- **DeprecatedFilter** - Both versions check for deprecated filters
- **ImgWidthAndHeight** - Both versions check for width/height on img tags
- **MissingTemplate** - Both versions check for missing partial files
- **TranslationKeyExists** - Both versions validate translation key references
- **UndefinedObject** - Both versions check for undefined variables/objects
- **UnknownFilter** - Both versions detect usage of non-existent filters
- **UnusedAssign** - Both versions detect unused variable assignments
- **ParserBlockingScript/JavaScript** - Similar concept, different names

### Verification Needed:
Each of these should be reviewed to ensure:
1. Feature parity (same validations)
2. Configuration options match
3. Error messages are consistent
4. Auto-corrections work similarly
5. Edge cases are handled identically

---

## Node.js-Only Checks

The following checks exist in Node.js but not in Ruby. Many appear to be Shopify-specific and may not be relevant for platformOS:

**Shopify-Specific:**
- app-block-missing-schema
- app-block-valid-tags
- asset-preload
- asset-size-* (multiple)
- block-id-usage
- cdn-preconnect
- content-for-header-modification
- deprecate-bgsizes
- deprecate-lazysizes
- deprecated-fonts-*
- deprecated-tag
- empty-block-content
- json-missing-block
- liquid-free-settings
- schema-presets-*
- static-stylesheet-and-javascript-tags
- unique-settings-id
- unique-static-block-id
- valid-block-target
- valid-local-blocks
- valid-schema
- valid-schema-name
- valid-settings-key
- valid-static-block-type
- valid-visible-if

**Potentially Useful:**
- duplicate-content-for-arguments
- duplicate-function-arguments
- duplicate-render-snippet-arguments
- graphql (general GraphQL validation)
- graphql-variables
- hardcoded-routes
- invalid-hash-assign-target
- json-syntax-error
- liquid-html-syntax-error (comprehensive syntax checking)
- matching-translations (different from translation-files-match)
- metadata-params
- missing-asset
- missing-content-for-arguments
- orphaned-snippet (similar to unused-partial)
- pagination-size
- remote-asset
- reserved-doc-param-names
- unclosed-html-element
- unique-doc-param-names
- unrecognized-content-for-arguments
- unrecognized-render-snippet-arguments
- unused-doc-param
- valid-content-for-argument-types
- valid-content-for-arguments
- valid-doc-param-types
- valid-html-translation
- valid-json
- valid-render-snippet-argument-types
- variable-name

---

## Summary

### Critical Missing Checks (High Priority):
1. **GraphqlInForLoop** - Performance critical
2. **FormAuthenticityToken** - Security critical
3. **SyntaxError** - Error reporting critical
4. **UnreachableCode** - Code quality critical
5. **RequiredLayoutObject** - Functionality critical
6. **InvalidArgs** - Type safety critical

### Important Missing Checks (Medium Priority):
7. **TranslationFilesMatch** - i18n critical
8. **UnusedPartial** - Code maintenance
9. **IncludeInRender** - Liquid semantics
10. **FormAction** - User experience

### Nice-to-Have Missing Checks (Low Priority):
11. **ConvertIncludeToRender** - Migration helper
12. **LiquidTag** - Style/readability
13. **SpaceInsideBraces** - Style/consistency
14. **TemplateLength** - Code organization
15. **ParseJsonFormat** - Style/consistency
16. **ImgLazyLoading** - Performance optimization
17. **MissingEnableComment** - Linter control
18. **HtmlParsingError** - Already handled by parser?
19. **ValidYaml** - Already handled by parser?

### Total Count:
- **Missing Checks:** 20
- **Existing Checks:** ~8 (need verification)
- **Node.js-Only Checks:** ~60+ (mostly Shopify-specific)

---

## Recommendations

1. **Phase 1 (Critical):** Implement checks 1-6 first as they affect security, performance, and core functionality
2. **Phase 2 (Important):** Implement checks 7-10 for i18n and code quality
3. **Phase 3 (Polish):** Implement checks 11-20 for style and consistency
4. **Verification:** Review all existing checks for feature parity
5. **Documentation:** Ensure all checks have comprehensive test coverage matching Ruby version
