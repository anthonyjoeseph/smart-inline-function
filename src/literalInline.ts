import * as ts from "typescript";
import {
  collectLiteralConstsVisibleAtCall,
  literalFoldExpression,
} from "./inlining";

export function literalInlineExpressionAtSelection(
  sourceFile: ts.SourceFile,
  targetExpr: ts.Expression,
): string {
  const env = collectLiteralConstsVisibleAtCall(sourceFile, targetExpr);
  const result: string = literalFoldExpression(targetExpr, env, sourceFile);
  return result;
}
