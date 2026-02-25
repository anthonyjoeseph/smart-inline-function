/**
 * Literal folding and literal-inline-array / literal-inline-object:
 * reduce expressions to literals and .map(...) / Object.fromEntries(...) to
 * array/object literals when the source is const.
 */

import * as ts from "typescript";
import {
  collectLiteralConstsVisibleAtCall,
  isDeepConstExpr,
  resolveConstExpression,
} from "./inliningConst";
import { extractReturnExpressionFromStatement } from "./inliningControlFlow";
import { substituteAndSimplifyExpression } from "./inliningSubstitute";

export type LiteralInlineResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/**
 * Fold a standalone expression to literals using the given const environment.
 * Substitutes identifiers with their const values and collapses non-side-effecting
 * code (arithmetic, templates, array/object spreads, ternaries). Function calls
 * are left unchanged (treated as potential side effects).
 */
export function literalFoldExpression(
  expr: ts.Expression,
  constEnv: Map<string, ts.Expression>,
  sourceFile: ts.SourceFile,
): string {
  const argMap = new Map<string, ts.Expression>();
  const paramConstEnv = new Map<string, ts.Expression>();

  for (const [name, exprVal] of constEnv.entries()) {
    const resolved = resolveConstExpression(exprVal, constEnv, 0);
    if (resolved && isDeepConstExpr(resolved)) {
      argMap.set(name, resolved);
      paramConstEnv.set(name, resolved);
    } else {
      argMap.set(name, exprVal);
    }
  }

  const simplified = substituteAndSimplifyExpression(
    expr,
    argMap,
    paramConstEnv,
  );
  const printer = ts.createPrinter({ removeComments: false });
  return printer
    .printNode(ts.EmitHint.Expression, simplified, sourceFile)
    .trim();
}

function getCallbackBodyExpression(
  callback: ts.Expression,
): ts.Expression | undefined {
  if (ts.isArrowFunction(callback)) {
    if (ts.isBlock(callback.body)) {
      return extractReturnExpressionFromStatement(callback.body);
    }
    return callback.body as ts.Expression;
  }
  if (ts.isFunctionExpression(callback) && callback.body) {
    return extractReturnExpressionFromStatement(callback.body);
  }
  return undefined;
}

/**
 * Reduce myArray.map(callback) or Object.entries(myObj).map(callback) to an array literal.
 * Requires the array/object to be a const in scope; otherwise returns an error.
 */
export function literalInlineArray(
  sourceFile: ts.SourceFile,
  mapCall: ts.CallExpression,
): LiteralInlineResult {
  const constEnv = collectLiteralConstsVisibleAtCall(sourceFile, mapCall);
  const factory = ts.factory;

  const callee = mapCall.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "map") {
    return { ok: false, error: "Selection is not a .map(...) call." };
  }
  const arrayLikeExpr = callee.expression;
  const callbackArg = mapCall.arguments[0];
  if (!callbackArg || !ts.isExpression(callbackArg)) {
    return { ok: false, error: "Missing or invalid map callback." };
  }
  const callback = callbackArg as ts.Expression;

  let sourceElements: ts.Expression[];
  if (ts.isIdentifier(arrayLikeExpr)) {
    const resolved = resolveConstExpression(arrayLikeExpr, constEnv, 0);
    if (!resolved || !ts.isArrayLiteralExpression(resolved)) {
      return {
        ok: false,
        error: `"${arrayLikeExpr.text}" must be a const array literal.`,
      };
    }
    if (!isDeepConstExpr(resolved)) {
      return {
        ok: false,
        error: `"${arrayLikeExpr.text}" must be a const array literal.`,
      };
    }
    sourceElements = resolved.elements.filter(
      (el): el is ts.Expression => ts.isExpression(el),
    ) as ts.Expression[];
  } else if (ts.isCallExpression(arrayLikeExpr)) {
    const innerCallee = arrayLikeExpr.expression;
    if (
      !ts.isPropertyAccessExpression(innerCallee) ||
      !ts.isIdentifier(innerCallee.expression) ||
      innerCallee.expression.text !== "Object" ||
      innerCallee.name.text !== "entries"
    ) {
      return {
        ok: false,
        error: "Literal-inline-array supports array or Object.entries(...).map(...) only.",
      };
    }
    const objArg = arrayLikeExpr.arguments[0];
    if (!objArg || !ts.isExpression(objArg)) {
      return { ok: false, error: "Object.entries() requires one argument." };
    }
    const resolved = resolveConstExpression(objArg, constEnv, 0);
    if (!resolved || !ts.isObjectLiteralExpression(resolved)) {
      return {
        ok: false,
        error: "Object.entries() argument must be a const object literal.",
      };
    }
    if (!isDeepConstExpr(resolved)) {
      return {
        ok: false,
        error: "Object.entries() argument must be a const object literal.",
      };
    }
    sourceElements = [];
    for (const prop of resolved.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name;
      const keyExpr =
        ts.isIdentifier(key)
          ? factory.createStringLiteral(key.text)
          : ts.isStringLiteral(key) || ts.isNumericLiteral(key)
            ? key
            : undefined;
      if (!keyExpr || !ts.isExpression(prop.initializer)) continue;
      sourceElements.push(
        factory.createArrayLiteralExpression([
          keyExpr,
          prop.initializer as ts.Expression,
        ]),
      );
    }
  } else {
    return {
      ok: false,
      error: "Literal-inline-array supports array or Object.entries(...).map(...) only.",
    };
  }

  const bodyExpr = getCallbackBodyExpression(callback);
  if (!bodyExpr) {
    return {
      ok: false,
      error: "Map callback must be an arrow function or function expression with a single return.",
    };
  }

  const params = ts.isArrowFunction(callback)
    ? callback.parameters
    : ts.isFunctionExpression(callback)
      ? callback.parameters
      : [];
  const paramNames: string[] = [];
  for (let i = 0; i < Math.min(3, params.length); i++) {
    const name = params[i].name;
    paramNames.push(ts.isIdentifier(name) ? name.text : "");
  }

  const fullArrayExpr = factory.createArrayLiteralExpression(sourceElements);
  const results: ts.Expression[] = [];

  for (let i = 0; i < sourceElements.length; i++) {
    const element = sourceElements[i];
    const argMap = new Map<string, ts.Expression>();
    const paramConstEnv = new Map<string, ts.Expression>();
    if (paramNames[0]) {
      argMap.set(paramNames[0], element);
      if (isDeepConstExpr(element)) paramConstEnv.set(paramNames[0], element);
    }
    if (paramNames[1]) {
      const indexExpr = factory.createNumericLiteral(i);
      argMap.set(paramNames[1], indexExpr);
      paramConstEnv.set(paramNames[1], indexExpr);
    }
    if (paramNames[2]) {
      argMap.set(paramNames[2], fullArrayExpr);
      paramConstEnv.set(paramNames[2], fullArrayExpr);
    }
    const resultExpr = substituteAndSimplifyExpression(
      bodyExpr,
      argMap,
      paramConstEnv,
    );
    results.push(resultExpr);
  }

  const outArray = factory.createArrayLiteralExpression(results, false);
  const printer = ts.createPrinter({ removeComments: false });
  const text = printer
    .printNode(ts.EmitHint.Expression, outArray, sourceFile)
    .trim();
  return { ok: true, text };
}

/**
 * Reduce Object.fromEntries(myEntries) to an object literal.
 * Requires myEntries to be a const array of [key, value] entries.
 */
export function literalInlineObject(
  sourceFile: ts.SourceFile,
  fromEntriesCall: ts.CallExpression,
): LiteralInlineResult {
  const constEnv = collectLiteralConstsVisibleAtCall(
    sourceFile,
    fromEntriesCall,
  );
  const factory = ts.factory;

  const callee = fromEntriesCall.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== "Object" ||
    callee.name.text !== "fromEntries"
  ) {
    return { ok: false, error: "Selection is not Object.fromEntries(...)." };
  }
  const entriesArg = fromEntriesCall.arguments[0];
  if (!entriesArg || !ts.isExpression(entriesArg)) {
    return { ok: false, error: "Object.fromEntries() requires one argument." };
  }

  const resolved = resolveConstExpression(entriesArg, constEnv, 0);
  if (!resolved || !ts.isArrayLiteralExpression(resolved)) {
    return {
      ok: false,
      error: "Object.fromEntries() argument must be a const array of entries.",
    };
  }
  if (!isDeepConstExpr(resolved)) {
    return {
      ok: false,
      error: "Object.fromEntries() argument must be a const array of entries.",
    };
  }

  const properties: ts.ObjectLiteralElementLike[] = [];
  for (const el of resolved.elements) {
    if (!ts.isExpression(el)) continue;
    const entry = el as ts.Expression;
    if (!ts.isArrayLiteralExpression(entry) || entry.elements.length < 2) {
      return {
        ok: false,
        error: "Each entry must be a [key, value] array.",
      };
    }
    const keyExpr = entry.elements[0];
    const valueExpr = entry.elements[1];
    if (!keyExpr || !ts.isExpression(keyExpr) || !valueExpr || !ts.isExpression(valueExpr)) {
      return { ok: false, error: "Invalid entry." };
    }
    const propName =
      ts.isIdentifier(keyExpr) ||
      ts.isStringLiteral(keyExpr) ||
      ts.isNumericLiteral(keyExpr)
        ? keyExpr
        : factory.createComputedPropertyName(keyExpr);
    properties.push(
      factory.createPropertyAssignment(propName, valueExpr as ts.Expression),
    );
  }

  const outObject = factory.createObjectLiteralExpression(properties, false);
  const printer = ts.createPrinter({ removeComments: false });
  const text = printer
    .printNode(ts.EmitHint.Expression, outObject, sourceFile)
    .trim();
  return { ok: true, text };
}
