A `{% graphql %}` call is inside a `{% for %}` or `{% tablerow %}` loop, creating an N+1 query problem. Each loop iteration makes a separate database round-trip.

**How to fix:**

Move the GraphQL query BEFORE the loop and fetch all needed data in one batch query.

**Example (WRONG — N+1 query):**
```liquid
{% for product_id in product_ids %}
  {% graphql product = 'products/get', id: product_id %}
  {{ product.title }}
{% endfor %}
```

**Example (CORRECT — single batch query):**
```liquid
{% graphql products = 'products/list', ids: product_ids %}
{% for product in products.results %}
  {{ product.title }}
{% endfor %}
```

**Why this matters:**
- 100 loop iterations = 100 database queries instead of 1
- Causes severe performance degradation under load
- May trigger rate limits or timeouts

**Strategies:**
1. Use a batch/list query that accepts an array of IDs
2. Use `{% graphql %}` with pagination before the loop
3. If the data is already available in a parent query, restructure the GraphQL to include nested relations