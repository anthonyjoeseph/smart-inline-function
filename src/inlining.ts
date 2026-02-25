/**
 * Smart Inline Function: main entry and public API.
 *
 * This module re-exports the main inline entry (inlineCallExpression,
 * collectLiteralConstsVisibleAtCall) and literal-inline APIs from smaller
 * modules. Other modules: inliningConst, inliningSubstitute, inliningControlFlow,
 * inliningImports, inliningLiteral.
 */

import * as ts from "typescript";
import { isDeepConstExpr, resolveConstExpression } from "./inliningConst";
import {
  tryReduceIfElseChainToExpression,
  tryReduceSwitchToExpression,
} from "./inliningControlFlow";
import {
  collectImportedNames,
  collectUsedImportedNames,
} from "./inliningImports";
import { substituteAndSimplifyExpression } from "./inliningSubstitute";

export interface InlineResult {
  expression: string;
  neededImports: ts.ImportDeclaration[];
}

export function inlineCallExpression(
  callExpr: ts.CallExpression,
  fnDecl: ts.FunctionLikeDeclaration,
  fnSourceFile: ts.SourceFile,
  callerConstEnv: Map<string, ts.Expression>,
): InlineResult | undefined {
  const printer = ts.createPrinter({ removeComments: false });

  const argMap = new Map<string, ts.Expression>();
  const paramConstEnv = new Map<string, ts.Expression>();
  const factory = ts.factory;

  for (let i = 0; i < fnDecl.parameters.length; i++) {
    const param = fnDecl.parameters[i];

    if (param.dotDotDotToken) {
      return undefined; // rest params not supported
    }

    const hasDefault = !!param.initializer;
    const providedArg = callExpr.arguments[i];
    const effectiveArg =
      (providedArg as ts.Expression | undefined) ||
      (hasDefault && ts.isExpression(param.initializer!)
        ? (param.initializer as ts.Expression)
        : undefined);

    if (!effectiveArg) {
      // No argument and no default value -> cannot safely inline.
      return undefined;
    }

    const name = param.name;

    function bindLocal(localName: string, valueExpr: ts.Expression) {
      argMap.set(localName, valueExpr);
      if (callerConstEnv.size > 0) {
        const constExpr = resolveConstExpression(valueExpr, callerConstEnv, 0);
        if (constExpr && isDeepConstExpr(constExpr)) {
          paramConstEnv.set(localName, constExpr);
        }
      }
    }

    // Simple identifier parameter: map directly.
    if (ts.isIdentifier(name)) {
      bindLocal(name.text, effectiveArg);
      continue;
    }

    // Object destructuring parameter, e.g. ({ one, two }: Foo)
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (
          element.dotDotDotToken ||
          element.initializer ||
          !ts.isIdentifier(element.name)
        ) {
          return undefined; // rest, defaults, or nested patterns not yet supported
        }

        const localId = element.name;
        const prop = element.propertyName ?? element.name;

        let accessExpr: ts.Expression | undefined;
        if (ts.isIdentifier(prop)) {
          accessExpr = factory.createPropertyAccessExpression(
            effectiveArg,
            prop,
          );
        } else if (ts.isStringLiteral(prop) || ts.isNumericLiteral(prop)) {
          accessExpr = factory.createElementAccessExpression(
            effectiveArg,
            prop,
          );
        } else {
          return undefined; // computed property names not supported
        }

        bindLocal(localId.text, accessExpr);
      }
      continue;
    }

    // Array/tuple destructuring parameter, e.g. ([one, two]: [number, number])
    if (ts.isArrayBindingPattern(name)) {
      let index = 0;
      for (const element of name.elements) {
        if (ts.isOmittedExpression(element)) {
          // Skip holes but advance index.
          index++;
          continue;
        }
        if (
          !ts.isBindingElement(element) ||
          element.dotDotDotToken ||
          element.initializer ||
          !ts.isIdentifier(element.name)
        ) {
          return undefined; // rest, defaults, or nested patterns not yet supported
        }

        const localId = element.name;
        const accessExpr = factory.createElementAccessExpression(
          effectiveArg,
          factory.createNumericLiteral(index),
        );
        bindLocal(localId.text, accessExpr);
        index++;
      }
      continue;
    }

    // Any other complex parameter pattern is not supported.
    return undefined;
  }

  let finalExpr: ts.Expression | undefined;

  if (ts.isArrowFunction(fnDecl) && fnDecl.body && !ts.isBlock(fnDecl.body)) {
    finalExpr = substituteAndSimplifyExpression(
      fnDecl.body,
      argMap,
      paramConstEnv,
    );
  } else if (fnDecl.body && ts.isBlock(fnDecl.body)) {
    const statements = fnDecl.body.statements;
    if (
      statements.length === 1 &&
      ts.isReturnStatement(statements[0]) &&
      statements[0].expression
    ) {
      finalExpr = substituteAndSimplifyExpression(
        statements[0].expression,
        argMap,
        paramConstEnv,
      );
    } else {
      // Try to reduce a simple if / else-if / else chain where all branches return.
      finalExpr = tryReduceIfElseChainToExpression(
        fnDecl.body,
        argMap,
        paramConstEnv,
      );
      // If that fails, try to reduce a simple switch statement where all cases return.
      if (!finalExpr) {
        finalExpr = tryReduceSwitchToExpression(
          fnDecl.body,
          argMap,
          paramConstEnv,
        );
      }
    }
  }

  if (!finalExpr) {
    return undefined; // function body too complex to inline safely
  }

  // Determine which imported symbols from the callee file are referenced
  // in the final inlined expression, so we can add missing imports in the caller.
  const importedNames = collectImportedNames(fnSourceFile);
  const usedImportedNames = collectUsedImportedNames(finalExpr, importedNames);
  const neededImports = Array.from(
    new Set(
      usedImportedNames.map(
        (decl) =>
          `${(decl.moduleSpecifier as ts.StringLiteral).text}::${decl.getText(
            fnSourceFile,
          )}`,
      ),
    ),
  ).map((key) => {
    const [moduleSpecifierText] = key.split("::");
    // Re-find the declaration by module specifier + textual match.
    const candidates = importedNames.getAllByModule(moduleSpecifierText);
    return (
      candidates.find(
        (d) =>
          d.getText(fnSourceFile) === key.slice(moduleSpecifierText.length + 2),
      ) ?? candidates[0]
    );
  });

  const inlinedText = printer.printNode(
    ts.EmitHint.Expression,
    finalExpr,
    fnSourceFile,
  );
  return {
    expression: inlinedText.trim(),
    neededImports,
  };
}

// Re-export const env and literal APIs so callers can still use a single entry point.
export { collectLiteralConstsVisibleAtCall } from "./inliningConst";
export {
  literalFoldExpression,
  literalInlineArray,
  literalInlineObject,
  type LiteralInlineResult,
} from "./inliningLiteral";
