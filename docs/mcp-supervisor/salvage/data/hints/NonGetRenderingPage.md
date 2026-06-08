A page with `method: post` (or `put`/`delete`/`patch`) only responds to that HTTP verb. Browsers navigate with GET, so this page will show **404 / not found** to real users.

**Two common patterns and how to fix each:**

1. **You wanted a landing page with a form.**
   Remove the `method` field from the page's front matter (defaults to `get`). The form on the page should `POST` to a separate handler:
   ```liquid
   ---
   slug: contact
   layout: application
   ---
   <form action="/api/contacts/create" method="post">
     …
   </form>
   ```
   Put the handler logic in `app/lib/commands/contacts/create.liquid` (or similar) and register a page under `app/views/pages/api/contacts/create.liquid` with `method: post` + a GraphQL mutation.

2. **You wanted an API endpoint.**
   Keep `method: post` but remove the HTML. The page body should be:
   ```liquid
   ---
   slug: api/contacts/create
   method: post
   format: json
   ---
   {% graphql r = "contacts/create", input: context.params %}
   {{ r | json }}
   ```
   The suppressor in `pos-supervisor` recognises slugs starting with `/api/`, `/_/`, `/internal/` and won't warn in that case.

Quick decision tree:
- Do real users visit this URL in a browser? → `method: get`.
- Is this a programmatic handler? → slug under `/api/…` and return JSON.
