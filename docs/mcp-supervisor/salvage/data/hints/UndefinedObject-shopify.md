'{{var_name}}' is a Shopify theme object — it does NOT exist in platformOS.

→ APPLY: {{suggestion}}

platformOS does NOT have Shopify globals. Common replacements:
  cart      → custom schema (app/schema/cart.yml) + GraphQL queries + session storage
  shop      → context.constants.app_name or custom schema properties
  customer  → {% function current_user = 'modules/user/queries/user/current' %} then current_user.email, .id, .name
  product   → custom schema (app/schema/product.yml) + GraphQL queries
  collection → custom schema + GraphQL with table filter
  checkout  → custom payment flow via modules/payments
  all_products → GraphQL: records(filter: { table: { value: "product" } })

MUST NOT: Declare '@param {{var_name}}' — it is NOT a parameter, it is Shopify contamination.
MUST NOT: Prefix with 'context.' — no context.{{var_name}} exists either.
MUST: Replace with the platformOS equivalent described above.