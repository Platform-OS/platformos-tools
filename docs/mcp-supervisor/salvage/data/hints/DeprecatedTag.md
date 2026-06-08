'{% {{tag_name}} %}' is deprecated in platformOS.
{{#if replacement_tag}}
  → Replace: {% {{tag_name}} 'x' %} → {% {{replacement_tag}} 'x' %}
  → '{% {{replacement_tag}} %}' has ISOLATED scope — variables from the parent template are NOT inherited.
    Pass every variable the partial needs explicitly:
    {% {{replacement_tag}} 'partial', var1: value1, var2: value2 %}
  → Fix ALL '{% {{tag_name}} %}' tags in this file in one edit, not one at a time.
{{else}}
  → This tag has no direct replacement. CALL domain_guide for guidance on the correct pattern.
{{/if}}
MUST NOT: Leave '{% {{tag_name}} %}' tags — they will trigger this error on every write.