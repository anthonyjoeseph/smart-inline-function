# Short answer

It’s not simple to do this correctly in the general case without turning the extension into a full statement‑level refactoring tool.
Your three examples already require three different parent‑rewrites:

## Bare expression in a statement

```ts
function program() {
  runEffect(inlineMe(3));
}
```

To turn `inlineMe`’s multi‑return body into:

```ts
let returnValue: T; // ...inlined control flow that assigns to returnValue...
runEffect(returnValue);
```

you must:

- Find the containing statement,
- Insert a new `let` declaration before it,
- Rewrite that statement’s expression to use `returnValue` instead of the original call.

## Concise arrow callback

```ts
arr.map((val) => inlineMe(val) + 3);
```

To get:

```ts
arr.map((val) => {
  let returnValue: T;
  // ...inlined body that assigns returnValue...
  return returnValue + 3;
});
```

you must:

- Detect that the call sits inside a concise arrow body,
- Convert the arrow into a block body,
- Synthesize a `let returnValue` inside the callback,
- Rewrite the body expression to a `return` using `returnValue`.

## Passing the function itself

```ts
arr.map(inlineMe);
```

Here you’re no longer inlining a call but a function value:

- You’d have to replace `inlineMe` with a new function expression/arrow whose body is a transformed copy of `inlineMe`’s body (with your `let returnValue` pattern), mapped to the callback’s parameter shape.
- This touches imports/exports and type inference more deeply.

And there are many more contexts that appear in real code:

- `const x = inlineMe(3);`
- `return inlineMe(3);`
- `if (inlineMe(3)) { ... }`
- `foo(inlineMe(3) && other())`
- Nested callbacks: `arr.flatMap(v => other(inlineMe(v)))`
- Async mix: `await inlineMe(3)` with multi‑return logic inside, etc.

Doing a bespoke “insert `let returnValue` + restructure enclosing function” for each of these safely (without breaking scoping, control flow, or types) is a substantial AST‑transform project.

## A robust alternative

The one approach that does scale across almost all expression positions without statement‑surgery is:

- Rewrite the call to an IIFE that contains the multi‑return body:

```ts
// Before
runEffect(inlineMe(3));
// After
runEffect(
  (() => {
    let returnValue: T;
    // ...inlined multi-return body, assigning returnValue...
    return returnValue;
  })(),
);
```

This:

- Keeps the inlined result as a single expression (so your existing “replace call expression” model still works).
- Works in all three of your examples (bare call, inside `+ 3`, passed to `map`, etc.).
- Avoids having to special‑case every parent context.

If you’re okay with that style (IIFE wrapper instead of rewriting parents as in your examples), we can implement multi‑return inlining in a principled, non–half‑baked way. If you really want the exact `let returnValue` shapes you described, that’s doable but will require designing a much broader set of parent‑transform rules and constraints.
