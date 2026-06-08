  READ THE ERROR MESSAGE — it tells you the exact line and column of the syntax error.
  Common causes:
    1. Missing `= 'path'` in graphql/function tags:
       WRONG: `{% graphql 'query_name' %}`
       RIGHT: `{% graphql result = 'query_name' %}`
       RIGHT: `{% function result = 'path/to/partial', arg: value %}`
    2. Unclosed HTML tags or Liquid blocks:
       Every `{% if %}` needs `{% endif %}`, `{% for %}` needs `{% endfor %}`
       Every `<div>` needs `</div>` — check nesting order
    3. Inside `{% liquid %}` blocks: each statement on its OWN LINE, NO delimiters:
       WRONG: `{% liquid assign x = 1; echo x %}`
       RIGHT: `{% liquid
         assign x = 1
         echo x
       %}`
    4. Mismatched quotes: `'string'` not `'string"` — check all quote pairs
    5. Array/object literals in render/function/graphql arguments:
       The parser does NOT support inline array `[]` or hash `{}` literals as tag arguments.
       WRONG: `{% render 'partial', items: [] %}`
       WRONG: `{% render 'partial', config: { "key": "value" } %}`
       RIGHT: `{% assign items = [] %}` then `{% render 'partial', items: items %}`
       RIGHT: `{% assign config = { "key": "value" } %}` then `{% render 'partial', config: config %}`
  Fix the EXACT line reported. Do NOT rewrite surrounding code to work around it.
  If multiple syntax errors: fix the FIRST one — later errors often cascade from it.
