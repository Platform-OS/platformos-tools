  `asset_url` paths are relative to `app/assets/` AND MUST include the
  subdirectory (`styles/`, `scripts/`, `images/`, `fonts/`, `media/`). Never
  flat: `{{ 'logo.png' | asset_url }}` is wrong when the file lives at
  `app/assets/images/logo.png` — use `{{ 'images/logo.png' | asset_url }}`.
  DO NOT remove the `asset_url` filter or strip the reference to silence this
  check.
  The supervisor cross-checks MissingAsset against the real filesystem before
  showing it. If you are still seeing it, the file does not exist at the
  reported path OR at any other nested path under `app/assets/`. Either:
    - create the asset at `app/assets/<subdir>/<file>`, or
    - look for an advisory `pos-supervisor:MissingAssetPathHint` in the infos
      array — it names the correct nested path when the basename matches.
  DO NOT loop editing the referring template.
