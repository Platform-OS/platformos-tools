Invalid @param type: types in {% doc %} blocks MUST be lowercase.

Valid types: {string}, {number}, {boolean}, {object}, {array}, {untyped}
Invalid (will error): {String}, {Number}, {Boolean}, {Object}, {Array}

Fix: change the type to lowercase.
  WRONG: @param product {Object} The product to display
  RIGHT: @param product {object} The product to display

CAUTION: Adding @param declarations to an existing partial will cause
MissingRenderPartialArguments errors in every file that renders this partial
without passing the new parameter. Check callers before adding params.
