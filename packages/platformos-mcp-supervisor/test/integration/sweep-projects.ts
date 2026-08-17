/**
 * The two corpora `project-sweep.spec.ts` runs the real pipeline over, as VALUES.
 *
 * NOT a directory of files on disk, which is what these were. Every other spec in this
 * package writes its workspace from a literal into a temp directory, and a sweep is not
 * special enough to be the exception — a fixture you have to open a second file to read is
 * a fixture nobody reads, and a fixture nobody reads drifts from the expectations pinned
 * against it.
 *
 * THE FILE LIST IS THIS OBJECT'S KEYS, which is the point. Discovering the corpus with a
 * `globSync` cost two defects at once: the pattern hand-copied `SOURCE_FILE_EXTENSIONS`, so
 * a fourth source extension would have silently shrunk the corpus, and on Windows the
 * answer came back `app\views\x.liquid` — where the lint keys its result by the caller's
 * own string — so every finding was identical and every key was spelled differently. Keys
 * in a literal are forward-slashed by construction and cannot drift from what is swept.
 *
 * THE CONTENT IS DELIBERATELY BROKEN in `BROKEN_PROJECT`, one defect class per file, and
 * deliberately ordinary in `ORDINARY_PROJECT`. Neither is clean; the second is the control
 * for a pipeline that would report everything on everything.
 *
 * The buffers are these strings, not the bytes read back from the temp directory, so the
 * line endings are the ones written here on every platform. A checked-out fixture is
 * subject to git's `core.autocrlf` and arrives CRLF on Windows, which moves every offset
 * an offense reports.
 */

/** A project as a map from root-relative POSIX path to file content. */
export type ProjectTree = Record<string, string>;

/** A project written to break as many checks as possible, one class per file. */
export const BROKEN_PROJECT: ProjectTree = {
  ".pos": `staging:
  url: https://example.staging.platform-os.com
`,
  "app/assets/inline_widget.liquid": `{% doc %}
  @param data {object} Data
{% enddoc %}
{% if data.valid
  <p>Valid</p>
{% endif %}
`,
  "app/config.yml": `escape_output_instead_of_sanitize: true
graphql_argument_type_mismatch_mode: error
liquid_add_old_variables: false
liquid_check_mode: error
liquid_raise_mode: true
require_table_for_record_delete_mutation: true
safe_translate: true
skip_elasticsearch: true
slug_exact_match: true
string_interpolation: true
sync_assets: true
sync_translations: true
websockets_require_csrf_token: true
high_performance_sql_filtering: true
`,
  "app/graphql/errors/bad_query.graphql": `query bad_query($id: ID!, $unused_var: String) {
  records(
    per_page: 1
    filter: {
      table: "product"
      id: $id
    }
  ) {
    results {
      id
      title
      nonexistent_field
    }
  }
}
`,
  "app/graphql/products/create.graphql": `mutation create($title: String!) {
  record_create(
    record: {
      table: "product"
      properties: [
        { name: "title", value: $title }
      ]
    }
  ) { id }
}
`,
  "app/graphql/products/search.graphql": `query search($query: String, $page: Int = 1) {
  records(
    per_page: 20
    page: $page
    filter: {
      table: { value: "product" }
    }
  ) {
    results { id properties }
  }
}
`,
  "app/lib/commands/products/create/build.liquid": `{% doc %}
  @param title {string} Product title
{% enddoc %}
{% liquid
  assign object = null | hash_merge: title: title
  return object
%}
`,
  "app/lib/commands/products/create/check.liquid": `{% doc %}
  @param object {object} Built object
{% enddoc %}
{% liquid
  assign errors = null | hash_merge
  if object.title == blank
    assign errors = errors | hash_merge: title: 'is required'
  endif
  return errors
%}
`,
  "app/lib/commands/products/create/main.liquid": `{% doc %}
  @param title {string} Product title
{% enddoc %}
{% liquid
  function built = 'commands/products/create/build', title: title
  function errors = 'commands/products/create/check', object: built
  function result = 'commands/products/nonexistent_execute', object: built
  return result
%}
`,
  "app/lib/commands/products/delete/main.liquid": `{% doc %}
  @param id {string} Record ID
{% enddoc %}
{% liquid
  graphql result = 'products/create', title: 'delete_placeholder'
  return result
%}
`,
  "app/lib/commands/products/update/build.liquid": `{% doc %}
  @param id {string} ID
  @param title {string} Title
{% enddoc %}
{% liquid
  assign object = null | hash_merge: id: id, title: title
  return object
%}
`,
  "app/lib/commands/products/update/main.liquid": `{% doc %}
  @param id {string} Product ID
  @param title {string} New title
{% enddoc %}
{% liquid
  graphql result = 'products/create', title: title
  assign updated = result
%}
`,
  "app/lib/queries/products/search.liquid": `{% doc %}
  @param page {Int} Page number
  @param limit {Int} Items per page
  @param keyword {string} Search keyword
{% enddoc %}
{% liquid
  assign page = page | default: 1
  assign limit = limit | default: 20
  graphql result = 'products/search', page: page, query: keyword
  return result.records
%}
`,
  "app/schema/invalid_schema.yml": `name: invalid_schema
properties:
  - name: title
    type: string
  - name: title
    type: integer
  - name: bad_type_field
    type: nonexistent_type
  - name: 123invalid
    type: string
`,
  "app/schema/product.yml": `name: product
properties:
  - name: title
    type: string
  - name: price
    type: float
  - name: active
    type: boolean
`,
  "app/translations/en.yml": `en:
  products:
    title: Products
    new: New Product
`,
  "app/views/layouts/application.html.liquid": `<!DOCTYPE html>
<html>
<head><title>{{ context.page.metadata.title }}</title></head>
<body>{{ content_for_layout }}</body>
</html>
`,
  "app/views/pages/admin/dashboard.html.liquid": `---
slug: admin
layout: application
---
{% liquid
  include 'modules/user/helpers/can_do_or_redirect', requester: context.current_user, do: 'admin.access', return_url: '/sessions/login'
  function products = 'queries/products/search'
  render 'products/caller', items: products.records.results
%}
`,
  "app/views/pages/errors/bad_layout.html.liquid": `---
slug: errors/bad-layout
layout: nonexistent_layout
---
{% render 'products/no_doc' %}
`,
  "app/views/pages/errors/bad_method.html.liquid": `---
slug: errors/bad-method
method: GET
layout: application
---
{% render 'products/no_doc' %}
`,
  "app/views/pages/products/bad_page.html.liquid": `---
layout: application
---
<div class="container">
  <h1>Products</h1>
  <p>This HTML should be in a partial</p>
  <ul>
    {% for p in products %}
      <li>{{ p.title }}</li>
    {% endfor %}
  </ul>
</div>
`,
  "app/views/pages/products/index.html.liquid": `---
slug: products
layout: application
---
{% render 'products/nonexistent_widget' %}
{% render 'products/caller', items: null %}
`,
  "app/views/pages/products/invalid_fm.html.liquid": `---
slug: products/invalid
authorization_policies: admin
cache: true
title: Wrong Place
content_type: json
---
{% render 'products/caller' %}
`,
  "app/views/pages/products/no_slug.html.liquid": `---
layout: application
---
{% render 'products/caller', items: null %}
`,
  "app/views/pages/products/unused.html.liquid": `---
slug: products/unused
layout: application
---
{% liquid
  assign unused_variable = 'this is never used'
  assign another_unused = context.params.id
  render 'products/no_doc'
%}
`,
  "app/views/partials/errors/bad_hash_assign.liquid": `{% doc %}
  @param config {object} Config object
{% enddoc %}
{% hash_assign "invalid_target" = "value" %}
{% hash_assign config["valid_key"] = "value" %}
{{ config.valid_key }}
`,
  "app/views/partials/errors/bad_images.liquid": `{% doc %}
  @param src {string} Image source
{% enddoc %}
<img src="{{ src }}">
<img src="{{ src }}" loading="lazy">
<img src="{{ src }}" width="300" height="200">
`,
  "app/views/partials/errors/hardcoded_routes.liquid": `{% doc %}
  @param product {object} Product data
{% enddoc %}
<a href="/products/{{ product.id }}">View</a>
<a href="/admin/products/{{ product.id }}/edit">Edit</a>
<form action="/products/{{ product.id }}/delete" method="post">
  <button>Delete</button>
</form>
`,
  "app/views/partials/errors/missing_asset.liquid": `{% doc %}
  @param theme {string} Theme name
{% enddoc %}
<link rel="stylesheet" href="{{ 'styles/nonexistent.css' | asset_url }}">
<script src="{{ 'scripts/missing.js' | asset_url }}"></script>
`,
  "app/views/partials/errors/nested_graphql.liquid": `{% doc %}
  @param id {string} Product ID
{% enddoc %}
{% graphql product = 'products/search' %}
{% for p in product.records.results %}
  {% graphql details = 'products/create', title: p.properties.title %}
{% endfor %}
`,
  "app/views/partials/errors/syntax_error.liquid": `{% doc %}
  @param data {object} Data
{% enddoc %}
{% if data.valid
  <p>Valid</p>
{% endif %}
`,
  "app/views/partials/errors/unknown_property.liquid": `{% doc %}
  @param item {object} Item to display
{% enddoc %}
{% for entry in item.entries %}
  {{ forloop.nonexistent_prop }}
  {{ entry.fake_field }}
{% endfor %}
{{ item.nonexistent_property }}
{{ context.current_user.nonexistent_property }}
`,
  "app/views/partials/errors/unused_params.liquid": `{% doc %}
  @param used_param {string} This is used
  @param unused_param {string} This is never used
  @param another_unused {object} Also never used
{% enddoc %}
<p>{{ used_param }}</p>
`,
  "app/views/partials/errors/uses_include.liquid": `{% doc %}
  @param show_footer {boolean} Show footer
{% enddoc %}
{% if show_footer %}
  {% include 'shared/orphan', message: 'Footer' %}
{% endif %}
`,
  "app/views/partials/products/bad_filters.liquid": `{% doc %}
  @param text {string} Text to format
{% enddoc %}
{{ text | nonexistent_filter }}
{{ text | moneyy }}
{{ text | upcase | reversee }}
`,
  "app/views/partials/products/caller.liquid": `{% doc %}
  @param items {array} Products list
{% enddoc %}
{% for item in items %}
  {% render 'products/shopify_contaminated' %}
{% endfor %}
`,
  "app/views/partials/products/deprecated_patterns.liquid": `{% doc %}
  @param data {string} JSON data
{% enddoc %}
{% parse_json config %}
  {"key": "value", "name": {{ data }}}
{% endparse_json %}
{% hash_assign config["extra"] = "added" %}
{{ config.key }}
`,
  "app/views/partials/products/gql_in_partial.liquid": `{% doc %}
  @param category {string} Category filter
{% enddoc %}
{% graphql products = 'products/search', query: category %}
{% for p in products.records.results %}
  <div>{{ p.properties.title }}</div>
{% endfor %}
`,
  "app/views/partials/products/include_test.liquid": `{% doc %}
  @param show_header {boolean} Show header
{% enddoc %}
{% if show_header %}
  {% include 'shared/orphan', message: 'Header' %}
{% endif %}
`,
  "app/views/partials/products/no_doc.liquid": `
<div class="card">
  <h3>{{ title }}</h3>
  <p>{{ description }}</p>
</div>
`,
  "app/views/partials/products/shopify_contaminated.liquid": `{% doc %}
  @param product_id {string} Product ID
{% enddoc %}
<div class="product">
  {{ cart.item_count }}
  {{ shop.name }}
  {{ customer.email }}
  {{ product.title }}
  {{ 1999 | money }}
  {{ product.image | img_url: '300x' }}
</div>
`,
  "app/views/partials/products/undef_vars.liquid": `{% doc %}
  @param name {string} Product name
{% enddoc %}
<h1>{{ name }}</h1>
<p>{{ description }}</p>
<span>{{ params.id }}</span>
<div>{{ some_random_variable }}</div>
`,
  "app/views/partials/shared/orphan.liquid": `{% doc %}
  @param message {string} Message text
{% enddoc %}
<div class="alert">{{ message }}</div>
`,
  "lib/helpers/misplaced_partial.liquid": `{% doc %}
  @param data {object} Data
{% enddoc %}
{% if data.valid
  <p>Valid</p>
{% endif %}
`,
  "modules/user/public/views/partials/lib/helpers/can_do_or_redirect.liquid": `{% doc %}
  @param requester {object} Current user
  @param do {string} Action to check
  @param return_url {string} Redirect URL
{% enddoc %}
{% liquid
  if requester == blank
    redirect_to return_url
  endif
  return true
%}
`,
};

/** A project written to work rather than to break — the control. */
export const ORDINARY_PROJECT: ProjectTree = {
  ".pos": `staging:
  url: https://example.staging.oregon.platform-os.com
`,
  "app/assets/styles/app.css": `body { font-family: sans-serif; }
`,
  "app/config.yml": `escape_output_instead_of_sanitize: true
graphql_argument_type_mismatch_mode: error
liquid_add_old_variables: false
liquid_check_mode: error
liquid_raise_mode: true
require_table_for_record_delete_mutation: true
safe_translate: true
skip_elasticsearch: true
slug_exact_match: true
string_interpolation: true
sync_assets: true
sync_translations: true
websockets_require_csrf_token: true
high_performance_sql_filtering: true
`,
  "app/graphql/blog_posts/create.graphql": `mutation create($title: String!, $body: String, $author_id: String) {
  record_create(
    record: {
      table: "blog_post"
      properties: [
        { name: "title", value: $title }
        { name: "body", value: $body }
        { name: "author_id", value: $author_id }
      ]
    }
  ) {
    id
    properties
  }
}
`,
  "app/graphql/blog_posts/delete.graphql": `mutation delete($id: ID!) {
  record_delete(
    id: $id
  ) {
    id
  }
}
`,
  "app/graphql/blog_posts/find.graphql": `query find($id: ID!) {
  records(
    per_page: 1
    filter: {
      table: { value: "blog_post" }
      id: { value: $id }
    }
  ) {
    results {
      id
      properties
    }
  }
}
`,
  "app/graphql/blog_posts/search.graphql": `query search($query: String, $page: Int = 1) {
  records(
    per_page: 20
    page: $page
    filter: {
      table: { value: "blog_post" }
      properties: [
        { name: "title", contains: $query }
      ]
    }
  ) {
    total_entries
    results {
      id
      properties
    }
  }
}
`,
  "app/lib/commands/blog_posts/create/build.liquid": `{% doc %}
  @param title {string} Blog post title
  @param body {string} Blog post body
  @param author_id {string} Author user ID
{% enddoc %}

{% liquid
  assign object = null | hash_merge: title: title, body: body, author_id: author_id
  return object
%}
`,
  "app/lib/commands/blog_posts/create/check.liquid": `{% doc %}
  @param object {object} Built object to validate
{% enddoc %}

{% liquid
  assign errors = null | hash_merge

  if object.title == blank
    assign errors = errors | hash_merge: title: 'is required'
  endif

  return errors
%}
`,
  "app/lib/commands/blog_posts/create/main.liquid": `{% doc %}
  @param title {string} Blog post title
  @param body {string} Blog post body
  @param author_id {string} Author user ID
{% enddoc %}

{% liquid
  function object = 'commands/blog_posts/create/build', title: title, body: body, author_id: author_id
  function errors = 'commands/blog_posts/create/check', object: object

  assign error_count = errors | size
  if error_count > 0
    return errors
  endif

  graphql result = 'blog_posts/create', title: object.title, body: object.body, author_id: object.author_id
  return result
%}
`,
  "app/lib/commands/blog_posts/delete/build.liquid": `{% doc %}
  @param id {string} Record ID to delete
{% enddoc %}

{% liquid
  assign object = null | hash_merge: id: id
  return object
%}
`,
  "app/lib/commands/blog_posts/delete/check.liquid": `{% doc %}
  @param object {object} Built object to validate
{% enddoc %}

{% liquid
  assign errors = null | hash_merge

  if object.id == blank
    assign errors = errors | hash_merge: id: 'is required'
  endif

  return errors
%}
`,
  "app/lib/commands/blog_posts/delete/main.liquid": `{% doc %}
  @param id {string} Record ID to delete
{% enddoc %}

{% liquid
  function object = 'commands/blog_posts/delete/build', id: id
  function errors = 'commands/blog_posts/delete/check', object: object

  assign error_count = errors | size
  if error_count > 0
    return errors
  endif

  graphql result = 'blog_posts/delete', id: object.id
  return result
%}
`,
  "app/lib/queries/blog_posts/find.liquid": `{% doc %}
  @param id {string} Record ID
{% enddoc %}

{% liquid
  graphql g = 'blog_posts/find', id: id
  assign results = g.records.results
  if results.size > 0
    return results[0]
  endif

  return null
%}
`,
  "app/lib/queries/blog_posts/search.liquid": `{% doc %}
  @param query {string} Search term
  @param page {Int} Page number
{% enddoc %}

{% liquid
  graphql g = 'blog_posts/search', query: query, page: page
  return g.records
%}
`,
  "app/schema/blog_post.yml": `name: blog_post
properties:
  - name: title
    type: string
  - name: body
    type: text
  - name: author_id
    type: string
`,
  "app/translations/en.yml": `en:
  blog_posts:
    title: Blog Posts
    new: New Post
    edit: Edit Post
    delete: Delete Post
    confirm_delete: Are you sure?
    fields:
      title: Title
      body: Body
`,
  "app/views/layouts/application.html.liquid": `<!DOCTYPE html>
<html>
<head>
  <title>{{ context.page.metadata.title | default: 'Blog' }}</title>
  <link rel="stylesheet" href="{{ 'styles/app.css' | asset_url }}">
</head>
<body>
  {{ content_for_layout }}
</body>
</html>
`,
  "app/views/pages/blog_posts/index.html.liquid": `---
slug: blog_posts
---
{% render 'blog_posts/list' %}
`,
  "app/views/pages/blog_posts/show.html.liquid": `---
slug: blog_posts/show
---
{% render 'blog_posts/show', id: context.params.id %}
`,
  "app/views/pages/test.html.liquid": `---
slug: my-page
---
{% render 'shared/header' %}
{{ 'greeting' | t }}
{% graphql g = 'products/search' %}`,
  "app/views/partials/blog_posts/card.liquid": `{% doc %}
  @param blog_post {object} Blog post record
{% enddoc %}

<div class="blog-post-card">
  <h3>{{ blog_post.properties.title }}</h3>
  <p>{{ blog_post.properties.body | truncate: 200 }}</p>
</div>
`,
  "app/views/partials/blog_posts/list.liquid": `{% doc %}
  @param query {string} Optional search term
{% enddoc %}

{% liquid
  function items = 'queries/blog_posts/search', query: query
%}

{% for item in items.results %}
  {% render 'blog_posts/card', blog_post: item %}
{% endfor %}
`,
  "app/views/partials/blog_posts/show.liquid": `{% doc %}
  @param id {string} Blog post record ID
{% enddoc %}

{% liquid
  function blog_post = 'queries/blog_posts/find', id: id
%}

<article>
  <h1>{{ blog_post.properties.title }}</h1>
  <div>{{ blog_post.properties.body }}</div>
</article>
`,
  "app/views/partials/permissions.liquid": `{% doc %}
  @param action {string} Action to check (create, update, delete)
{% enddoc %}

{% liquid
  assign allowed = false

  if context.current_user.id != blank
    if action == 'create' or action == 'update' or action == 'delete'
      assign allowed = true
    endif
  endif

  return allowed
%}
`,
  "modules/user/public/views/partials/lib/helpers/can_do.liquid": `{% doc %}
  @param requester_id {string} User ID requesting access
  @param action {string} Action to check
{% enddoc %}

{% liquid
  assign allowed = false
  if requester_id != blank
    if action != blank
      assign allowed = true
    endif
  endif
  return allowed
%}
`,
};
