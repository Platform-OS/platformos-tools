# Renaming Plan: Shopify/Theme References → platformOS

This document tracks remaining references to Shopify, Theme, and related terminology that need to be updated to platformOS equivalents.

## Status Categories

- ✅ **Keep as-is**: Historical references, attributions, or external dependencies
- 🔄 **To be replaced**: Direct references that should be changed to platformOS terminology
- ⚠️ **Context-dependent**: Needs evaluation based on usage context

---

## 1. Direct Shopify References

### 1.1 Attribution and Historical References ✅
**Decision: Keep as-is** - These are proper attributions to the original project

- `README.md:44` - Fork attribution: "originally forked from Shopify's Theme Tools"
- `LICENSE.md` - Copyright notices: "Original work Copyright 2022-present, Shopify Inc."
- `packages/vscode-extension/LICENSE.md` - Copyright: "Copyright 2022-present, Shopify Inc." - use the same wording as in LICENSE.md - original shopify, modified platformOS

### 1.2 Shopify.dev Documentation Links 🔄
**Decision: document in shopify_documentation_links.md ** - These reference Shopify-specific documentation`` - we need to manually review

- `.github/PULL_REQUEST_TEMPLATE.md:27` - Link to shopify.dev theme check docs
  - Action: update to point to https://documentation.platformos.com/developer-guide/platformos-check/platformos-check

### 1.3 GitHub Repository References 🔄
**Decision: Give credit to Shopify for making those decision, update links to point to platform-os github. Update where applicable**

Files containing `github.com/Shopify/*`:
- `docs/language-server/decisions/001-using-the-liquid-html-parser/README.md` - Multiple links to Shopify repos
  - Action: Update links to Platform-OS forks where they exist, keep historical references as context
- `docs/prettier-plugin-liquid/decisions/*.md` - Links to Shopify theme-check and prettier-plugin-liquid
  - Action: Update to Platform-OS URLs where applicable
- `packages/prettier-plugin-liquid/CONTRIBUTING.md:85` - Fork link
  - Action: Update to Platform-OS fork URL
- `packages/prettier-plugin-liquid/RELEASING.md:39` - GitHub release link
  - Action: Update to Platform-OS repo URL
- `packages/prettier-plugin-liquid/KNOWN_ISSUES.md` - References to Dawn theme
  - Action: Consider updating to platformOS example or keeping as reference
- `packages/prettier-plugin-liquid/playground/index.html:46` - Shopify logo image
  - Action: Replace with Platform-OS logo

### 1.4 Shipit Deployment URLs 🔄
**Decision: Remove references to shipit

- `packages/prettier-plugin-liquid/RELEASING.md:37` - shipit.shopify.io/shopify/prettier-plugin-liquid
- `packages/vscode-extension/RELEASING.md:5` - shipit.shopify.io/Platform-OS/platformos-tools/vscode-marketplace
  - Action: Update to Platform-OS deployment infrastructure or document alternative deployment process

---

## 2. Theme Terminology

### 2.1 Theme Check 🔄
**Decision: Context-dependent**

The term "theme check" appears extensively throughout the codebase. platformOS doesn't use "themes" in the same way as Shopify.

**Occurrences:**
- Package names already renamed to `platformos-check-*` ✅
- Internal references still using "theme-check" or "theme check"
- YAML config files: `packages/platformos-check-node/configs/theme-app-extension.yml`
- Documentation and comments

**Action Plan:**
1. Replace `theme-check` with `platformos-check` in:
   - Variable names and function names
   - Comments and documentation
   - Configuration file names (e.g., `theme-app-extension.yml`) - remove .theme-app-extension.yml, replace .theme-check.yml with .platformos-check
   - Internal tool references

2. Update references to "Theme Check" (capitalized) to "platformOS Check"

### 2.2 Theme Tools 🔄
**Decision: Replace**

- `.github/workflows/release.yml:63-64` - "Theme Tools Release" commit messages
  - Action: Change to "platformOS Tools Release"
- `.spin/constellations/online-store.yml:3` - `theme-tools` reference
- `.spin/constellation.yml:3` - `theme-tools` reference
  - Action: Update to `platformos-tools` . What is .spin ? probably we can just remove it?

### 2.3 Theme Graph 🔄
**Decision: Context-dependent**

The term "theme graph" is used for the module dependency graph structure.

**Occurrences:**
- `packages/platformos-graph/` package
- `CHANGELOG.md:1` - "shopify/theme-graph" header
- Type names: `ThemeGraph`, `ThemeModule`, `ThemeBlockSchema`, etc.
- File: `bin/platformos-graph` already renamed ✅

**Action Plan:**
1. **Package level:**
   - Keep package name as `@platformos/platformos-graph` ✅
   - Update CHANGELOG header from "shopify/theme-graph" to "@platformos/platformos-graph"

2. **Type names:**
   - Consider renaming internal types:
     - `ThemeGraph` → `PlatformosGraph`

3. **Documentation:**
   - Update references from "theme graph" to "platformos graph"
   - `packages/platformos-graph/README.md` - Update all "theme graph" references
   - `packages/platformos-graph/CHANGELOG.md:86` - "Shopify theme" reference

### 2.4 Theme-Liquid-Docs References 🔄
**Decision: Migrate or fork**

The project depends on `Shopify/theme-liquid-docs` for:
- Liquid documentation
- JSON schemas
- Object/filter/tag definitions

**Occurrences:**
- `.gitignore:11` - `packages/node/src/theme-liquid-docs`
- `docs/contributing.md:76-87` - Testing JSON Schema changes
- Multiple CHANGELOG references to schema manifests
- `packages/platformos-check-docs-updater/` - Downloads from Shopify repo
- `packages/platformos-check-docs-updater/src/themeLiquidDocsDownloader.ts:12` - Raw GitHub URL

**Action Plan:**
1. **Short term:** Continue using Shopify/theme-liquid-docs as dependency
2. **Long term:**
   - Fork to Platform-OS/platformos-liquid-docs
   - Adapt schemas for platformOS-specific Liquid tags/filters
   - Update download URLs in themeLiquidDocsDownloader
   - Document platformOS-specific Liquid features

### 2.5 Layout Theme.liquid References ⚠️
**Decision: Evaluate usage**

References to `layout/theme.liquid` - a Shopify-specific file:

**Occurrences:**
- Test files and check implementations
- `packages/platformos-check-common/src/checks/required-layout-theme-object/` - Check specific to theme.liquid

**Action Plan:**
1. platformOS does not need this check - remove the check
2. Update test fixtures

---

## 3. Liquid/Liquid-related References

### 3.1 Liquid-TM-Grammar Submodule ✅
**Decision: Keep or evaluate**

- `.gitmodules:3` - `url = git@github.com:Shopify/liquid-tm-grammar.git`
- Used by VS Code extension for syntax highlighting

**Action:**
- replace with https://github.com/Platform-OS/liquid-tm-grammar

### 3.2 Package Names Already Updated ✅

These packages have been renamed correctly:
- `@platformos/liquid-html-parser` ✅
- `@platformos/prettier-plugin-liquid` ✅
- All `platformos-check-*` packages ✅
- `platformos-language-server-*` packages ✅

---

## 4. Storefront References 🔄

**Decision: Replace or remove**

Files containing "storefront" references (Shopify-specific terminology):
- Some docs and check descriptions may reference "storefronts" or "online stores"

**Occurrences:**
- Limited, mostly in shopify.dev links already noted above

**Action:** Remove or update to platformOS-appropriate terminology

---

## 5. Configuration and Infrastructure

### 5.1 Spin Configuration Files 🔄

- `.spin/constellations/online-store.yml`
- `.spin/constellation.yml`

**Action:** remove .spin

### 5.2 CLA Action ⚠️

- `packages/vscode-extension/syntaxes/.github/workflows/cla.yml:19` - Uses `Shopify/shopify-cla-action@v1`

**Action:** remove

---

## 6. Implementation Priority

### Phase 1: High Priority (User-Facing) 🔴

1. Update release workflow commit messages (`.github/workflows/release.yml`)
2. Update PR template to remove shopify.dev link (`.github/PULL_REQUEST_TEMPLATE.md`)
3. Replace Shopify logo in playground (`packages/prettier-plugin-liquid/playground/index.html`)
4. Update RELEASING.md files to reflect Platform-OS deployment process
5. Update GitHub links in CONTRIBUTING.md to Platform-OS repos

### Phase 2: Medium Priority (Internal References) 🟡

1. Update CHANGELOG headers from "shopify/*" to "@platformos/*"
2. Rename configuration files (`theme-app-extension.yml` → `platformos-app-extension.yml` or similar)
3. Update internal "theme check" terminology in comments and documentation
4. Update `.spin` configuration files
5. Update theme-liquid-docs downloader to prepare for potential fork

### Phase 3: Low Priority (Breaking Changes) 🟢

1. Consider renaming TypeScript types (`ThemeGraph`, `ThemeModule`, etc.)
2. Evaluate forking liquid-tm-grammar if platformOS has syntax differences
3. Migrate from theme-liquid-docs to potential platformos-liquid-docs
4. Update `required-layout-theme-object` check for platformOS equivalents

---

## 7. Non-Changes (Preserve)

### Keep These References ✅

1. All copyright and license attributions to Shopify
2. Fork attribution in README.md
3. Historical links in decision documents (for context)
4. Dependency on Shopify/liquid-tm-grammar (unless platformOS differences require fork)
5. "Shopify Liquid" references when referring to the Liquid variant (vs. Jekyll Liquid, etc.)

---

## 8. Search Patterns Used

For future reference, these grep patterns were used to find references:

```bash
# Main searches
grep -ri "Shopify"
grep -ri "Theme"
grep -ri "shopify\.dev"
grep -ri "github\.com/Shopify"
grep -ri "theme-check"
grep -ri "theme-tools"
grep -ri "theme.liquid"
grep -ri "storefront"

# Specific patterns
grep -ri "shipit\.shopify\.io"
grep -ri "@shopify/"
```

---

## Next Steps

1. Review this document with the team
2. Prioritize which changes to make based on phases above
3. Create tracking issues for each phase
4. Update this document as changes are completed
5. Add checkboxes to track completion status
