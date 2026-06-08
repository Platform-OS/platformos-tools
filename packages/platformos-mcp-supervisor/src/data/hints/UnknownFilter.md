'{{filter_name}}' is not a valid filter in platformOS Liquid.
{{#if has_suggestion}}
  → APPLY: {{suggestion}}
{{else}}
  → NOT a known filter — CALL lookup (completions mode) at the filter position to see available filters.
     Filters are used as: {{ value | filter_name }}
     Tags are used as: {% tag_name %}  — do not use tags as filters.
{{/if}}
Fixing existing code: if this filter is from Shopify or another platform, replace the entire expression with the platformOS equivalent — there may not be a 1:1 filter replacement.
Building new code: find the correct platformOS filter via lookup.