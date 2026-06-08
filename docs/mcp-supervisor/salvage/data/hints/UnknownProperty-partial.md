Property '{{property_name}}' cannot be verified on '{{object_name}}' — you are in a partial.

The linter cannot track property schemas across file boundaries.
In partials, objects are passed by the caller — their properties are typically valid.

FIX — Add a {% doc %} block at the TOP of this file:
  {% doc %}
    @param {object} {{object_name}}
  {% enddoc %}
  Use the correct type: {object}, {string}, {number}, {boolean}, {array}.
  This tells the linter the parameter type, silencing both UndefinedObject and UnknownProperty.

If '{{object_name}}' is passed by callers, do not rename it — it must match the caller's argument name.