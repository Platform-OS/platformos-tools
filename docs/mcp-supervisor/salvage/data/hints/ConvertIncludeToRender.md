  → Replace `{% include 'x' %}` with `{% render 'x' %}`
  → render has isolated scope — pass all needed variables explicitly:
    `{% render 'partial', var: value %}`
