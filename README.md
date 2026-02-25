## Smart Inline Function (TypeScript)

**Smart Inline Function** is a VS Code command that performs a beta-reduction / inlining of a selected TypeScript function call.

It replaces a function call with the body of the function, with arguments substituted into parameters and simple conditionals reduced where possible.

### Philosophy

This is meant to be used to quickly generate code that's not quite boilerplate, but serves as a starting point. Code should be simple at first, but should reveal itself to arbitrarily complex configuration when that becomes useful

examples of leaky abstractions:

- ORMs
- HTML form

example of solutions:

- a simple function for SQL joins that generates SQL and transformation code
- a simple function on a table schema that generates the skeleton of a form with error states & a rest endpoint

The polar opposite of encapsulation: rather than complex & leaky abstractions, use simple & _extremely_ leaky abstractions that are able to give way to full control.

Should work well alongside other scaffolding tools like [yeoman](https://yeoman.io/generators/)

### Features

- **Inline simple functions**
  - Works with:
    - `function runMe(...) { return ... }`
    - `const runMe = (...) => expr`
  - The function body must effectively be a single return expression.
- **Cross-file support**
  - Inlines functions defined:
    - In the **same file**
    - In **other local files** imported via relative paths (e.g. `./foo`).
    - In **npm modules** when:
      - The module is resolved via Node from your workspace
      - It ships TypeScript sources alongside JS, or
      - It ships JS with `.js.map` source maps that point at `.ts` sources.
- **Smart simplification**
  - After parameter substitution, the inlined expression is simplified when possible:
    - Ternary conditionals with constant conditions (e.g. `flag ? "good" : "bad"` with `flag = false`)
    - Common boolean and arithmetic expressions where all operands are literal-like
    - Simple `if` / `else if` / `else` chains where each branch returns an expression and all conditions become statically `true` / `false` after substitution (the whole chain reduces to the chosen branch’s returned expression)

Example:

```ts
function runMe(flag: boolean) {
  return flag ? "good" : "bad";
}

const x = runMe(false);
```

Select `runMe(false)` and run **"Smart Inline Function"**:

```ts
const x = "bad";
```

### Usage

1. Open a TypeScript or TSX file.
2. Select a function call expression (or place the cursor inside it).
3. Run the command:
   - Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
   - Choose **"Smart Inline Function"**.

If successful, the call will be replaced with an equivalent (or simplified) expression.

### Limitations

- Only **simple, expression-style functions** are supported:
  - A single `return` statement in a block body, or an expression-bodied arrow function.
- **Not supported (for now)**:
  - Methods, property access calls (`obj.runMe()`), overloaded signatures, generators, or functions with complex parameter patterns/rest parameters.
  - Large control-flow constructs (multiple statements, early returns, etc.).
- For npm modules:
  - Inlining works only when the module can be resolved from the workspace and actual TypeScript sources can be found (either shipped directly or referenced by `.js.map` files).

### Development

- Install dependencies:

```bash
npm install
```

- Build:

```bash
npm run compile
```

- In VS Code:
  - Open this folder.
  - Press `F5` to launch an Extension Development Host.
