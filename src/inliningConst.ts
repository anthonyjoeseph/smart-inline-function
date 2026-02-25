/**
 * Const-environment helpers: resolve identifiers to const values,
 * and check whether expressions are "deep" const (literal-only).
 */

import * as ts from "typescript";

export function getBooleanLiteralValue(
  node: ts.Expression,
): boolean | undefined {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

export function isSimpleLiteral(node: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}

export function isDeepConstExpr(node: ts.Expression): boolean {
  if (isSimpleLiteral(node)) return true;

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(
      (el) => ts.isExpression(el) && isDeepConstExpr(el as ts.Expression),
    );
  }

  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((prop) => {
      if (!ts.isPropertyAssignment(prop)) return false;
      const name = prop.name;
      if (
        !ts.isIdentifier(name) &&
        !ts.isStringLiteral(name) &&
        !ts.isNumericLiteral(name)
      ) {
        return false;
      }
      return ts.isExpression(prop.initializer)
        ? isDeepConstExpr(prop.initializer as ts.Expression)
        : false;
    });
  }

  return false;
}

export function resolveConstExpression(
  expr: ts.Expression,
  env: Map<string, ts.Expression>,
  depth: number,
): ts.Expression | undefined {
  if (depth > 8) return undefined;

  if (ts.isIdentifier(expr)) {
    const bound = env.get(expr.text);
    if (!bound) return undefined;
    return ts.isExpression(bound)
      ? resolveConstExpression(bound as ts.Expression, env, depth + 1) ?? bound
      : undefined;
  }

  if (ts.isParenthesizedExpression(expr)) {
    return resolveConstExpression(expr.expression, env, depth + 1);
  }

  if (ts.isPropertyAccessExpression(expr)) {
    const base = resolveConstExpression(expr.expression, env, depth + 1);
    if (!base || !ts.isObjectLiteralExpression(base)) return undefined;

    const propName = expr.name.text;
    const matching = base.properties.find(
      (p) =>
        ts.isPropertyAssignment(p) &&
        ((ts.isIdentifier(p.name) && p.name.text === propName) ||
          (ts.isStringLiteral(p.name) && p.name.text === propName) ||
          (ts.isNumericLiteral(p.name) && p.name.text === propName)),
    ) as ts.PropertyAssignment | undefined;
    if (!matching || !ts.isExpression(matching.initializer)) return undefined;
    return (
      resolveConstExpression(
        matching.initializer as ts.Expression,
        env,
        depth + 1,
      ) ?? (matching.initializer as ts.Expression)
    );
  }

  if (ts.isElementAccessExpression(expr)) {
    const base = resolveConstExpression(expr.expression, env, depth + 1);
    if (!base) return undefined;

    const arg = expr.argumentExpression;
    if (!arg) return undefined;

    if (ts.isArrayLiteralExpression(base)) {
      if (ts.isNumericLiteral(arg)) {
        const index = Number(arg.text);
        if (!Number.isInteger(index) || index < 0) return undefined;
        const elem = base.elements[index];
        if (!elem || !ts.isExpression(elem)) return undefined;
        return (
          resolveConstExpression(elem as ts.Expression, env, depth + 1) ??
          (elem as ts.Expression)
        );
      }
      return undefined;
    }

    if (ts.isObjectLiteralExpression(base)) {
      if (ts.isStringLiteral(arg) || ts.isNumericLiteral(arg)) {
        const key = arg.text;
        const matching = base.properties.find(
          (p) =>
            ts.isPropertyAssignment(p) &&
            ((ts.isIdentifier(p.name) && p.name.text === key) ||
              (ts.isStringLiteral(p.name) && p.name.text === key) ||
              (ts.isNumericLiteral(p.name) && p.name.text === key)),
        ) as ts.PropertyAssignment | undefined;
        if (!matching || !ts.isExpression(matching.initializer))
          return undefined;
        return (
          resolveConstExpression(
            matching.initializer as ts.Expression,
            env,
            depth + 1,
          ) ?? (matching.initializer as ts.Expression)
        );
      }
      return undefined;
    }

    return undefined;
  }

  return undefined;
}

/**
 * Collect const bindings visible at a given node (e.g. a call site):
 * from the same block/source file, only declarations that end before the node.
 */
export function collectLiteralConstsVisibleAtCall(
  sourceFile: ts.SourceFile,
  nodeAt: ts.Node,
): Map<string, ts.Expression> {
  const result = new Map<string, ts.Expression>();
  const callStart = nodeAt.getStart(sourceFile);

  let current: ts.Node | undefined = nodeAt;
  while (current) {
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      const block = current as ts.Block | ts.SourceFile;
      for (const stmt of block.statements) {
        if (stmt.getEnd() > callStart) {
          break;
        }
        if (!ts.isVariableStatement(stmt)) continue;
        const isConst =
          (stmt.declarationList.flags & ts.NodeFlags.Const) ===
          ts.NodeFlags.Const;
        if (!isConst) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            decl.initializer &&
            ts.isExpression(decl.initializer) &&
            isDeepConstExpr(decl.initializer as ts.Expression)
          ) {
            const name = decl.name.text;
            if (!result.has(name)) {
              result.set(name, decl.initializer as ts.Expression);
            }
          }
        }
      }
    }
    current = current.parent;
  }

  return result;
}
