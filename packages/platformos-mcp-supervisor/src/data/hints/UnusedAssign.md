Variable '{{var_name}}' is assigned but never read.
  Either remove the assignment or use the variable downstream.
  Common causes:
    1. Typo in the variable name where it's used later — check spelling
    2. Leftover from refactoring — safe to remove
    3. Intermediate variable replaced by a direct expression — safe to remove
  MUST NOT: Leave dead assignments — they obscure intent and confuse maintainers.