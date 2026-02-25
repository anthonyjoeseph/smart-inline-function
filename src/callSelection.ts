import * as ts from "typescript";

export function findSelectedCallExpression(
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
