import * as ts from "typescript";

function findSelectedCallExpression(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.CallExpression | undefined {
  let bestMatch: ts.CallExpression | undefined;

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const nodeStart = node.getStart(sourceFile);
      const nodeEnd = node.getEnd();
      const containsSelection =
        nodeStart <= start &&
        nodeEnd >= end &&
        (bestMatch == null ||
          nodeEnd - nodeStart <=
            bestMatch.getEnd() - bestMatch.getStart(sourceFile));

      if (containsSelection) {
        bestMatch = node;
      }
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);
  return bestMatch;
}

function findSelectedExpression(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.Expression | undefined {
  let bestMatch: ts.Expression | undefined;

  function visit(node: ts.Node) {
    if (ts.isExpression(node)) {
      const nodeStart = node.getStart(sourceFile);
      const nodeEnd = node.getEnd();
      const containsSelection =
        nodeStart <= start &&
        nodeEnd >= end &&
        (bestMatch == null ||
          nodeEnd - nodeStart <=
            bestMatch.getEnd() - bestMatch.getStart(sourceFile));

      if (containsSelection) {
        bestMatch = node;
      }
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);
  return bestMatch;
}

/**
 * Returns the innermost CallExpression that is a .map(...) call containing the given node.
 */
function findEnclosingMapCall(node: ts.Node): ts.CallExpression | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "map" &&
        current.arguments.length === 1
      ) {
        return current;
      }
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Returns the innermost CallExpression that is Object.fromEntries(...) containing the given node.
 */
function findEnclosingFromEntriesCall(
  node: ts.Node,
): ts.CallExpression | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Object" &&
        callee.name.text === "fromEntries" &&
        current.arguments.length === 1
      ) {
        return current;
      }
    }
    current = current.parent;
  }
  return undefined;
}

export {
  findSelectedCallExpression,
  findSelectedExpression,
  findEnclosingMapCall,
  findEnclosingFromEntriesCall,
};
