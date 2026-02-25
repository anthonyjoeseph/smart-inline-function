/**
 * Expression substitution and simplification: replace parameters with arguments
 * and fold constant subexpressions (literals, ternaries, binary ops, spreads).
 */

import * as ts from "typescript";
import {
  getBooleanLiteralValue,
  isDeepConstExpr,
  resolveConstExpression,
} from "./inliningConst";

export function substituteAndSimplifyExpression(
  expr: ts.Expression,
  argMap: Map<string, ts.Expression>,
  paramConstEnv: Map<string, ts.Expression>,
): ts.Expression {
  const factory = ts.factory;

  function evalLiteralExpression(node: ts.Expression): unknown | undefined {
    if (paramConstEnv.size > 0) {
      const constExpr = resolveConstExpression(node, paramConstEnv, 0);
      if (constExpr && isDeepConstExpr(constExpr)) {
        const v = evalLiteralExpression(constExpr);
        if (v !== undefined) return v;
      }
    }

    {
      const b = getBooleanLiteralValue(node);
      if (b !== undefined) return b;
    }
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isPrefixUnaryExpression(node)) {
      const v = evalLiteralExpression(node.operand);
      if (v === undefined) return undefined;
      switch (node.operator) {
        case ts.SyntaxKind.ExclamationToken:
          return !v;
        case ts.SyntaxKind.PlusToken:
          if (v == null) throw new Error("Cannot convert null to number");
          return +v;
        case ts.SyntaxKind.MinusToken:
          if (v == null) throw new Error("Cannot negate null");
          return -v;
        default:
          return undefined;
      }
    }
    if (ts.isParenthesizedExpression(node)) {
      return evalLiteralExpression(node.expression);
    }
    if (ts.isBinaryExpression(node)) {
      const left: unknown = evalLiteralExpression(node.left);
      const right: unknown = evalLiteralExpression(node.right);
      if (left === undefined || right === undefined) return undefined;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsToken:
          return left === right;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsToken:
          return left !== right;
        case ts.SyntaxKind.LessThanToken:
          return (left as number) < (right as number);
        case ts.SyntaxKind.LessThanEqualsToken:
          return (left as number) <= (right as number);
        case ts.SyntaxKind.GreaterThanToken:
          return (left as number) > (right as number);
        case ts.SyntaxKind.GreaterThanEqualsToken:
          return (left as number) >= (right as number);
        case ts.SyntaxKind.PlusToken:
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          return (left as number) + (right as number);
        case ts.SyntaxKind.MinusToken:
          return (left as number) - (right as number);
        case ts.SyntaxKind.AsteriskToken:
          return (left as number) * (right as number);
        case ts.SyntaxKind.SlashToken:
          return (left as number) / (right as number);
        default:
          return undefined;
      }
    }
    return undefined;
  }

  const nullTransformationContext = {
    enableEmitNotification: () => {},
    enableSubstitution: () => {},
    endLexicalEnvironment: () => [],
    getCompilerOptions: () => ({}) as ts.CompilerOptions,
    getEmitHost: () => ({}),
    getEmitResolver: () => ({}),
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    isEmitNotificationEnabled: () => false,
    isSubstitutionEnabled: () => false,
    onEmitNode: (
      _hint: ts.EmitHint,
      node: ts.Node,
      emit: (hint: ts.EmitHint, node: ts.Node) => void,
    ) => emit(_hint, node),
    onSubstituteNode: (_hint: ts.EmitHint, node: ts.Node) => node,
    readEmitHelpers: () => undefined,
    requestEmitHelper: () => {},
    resumeLexicalEnvironment: () => {},
    startLexicalEnvironment: () => {},
  } as unknown as ts.TransformationContext;

  function simplify(node: ts.Expression): ts.Expression {
    // Substitute identifiers
    if (ts.isIdentifier(node)) {
      const arg = argMap.get(node.text);
      if (arg) {
        return simplify(arg);
      }
      return node;
    }

    // Conditional (ternary) operator
    if (ts.isConditionalExpression(node)) {
      const cond = simplify(node.condition);
      const whenTrue = simplify(node.whenTrue);
      const whenFalse = simplify(node.whenFalse);
      const condVal = evalLiteralExpression(cond);
      if (condVal === true) {
        return whenTrue;
      }
      if (condVal === false) {
        return whenFalse;
      }
      return factory.createConditionalExpression(
        cond,
        node.questionToken,
        whenTrue,
        node.colonToken,
        whenFalse,
      );
    }

    // Parentheses
    if (ts.isParenthesizedExpression(node)) {
      const inner = simplify(node.expression);
      return factory.createParenthesizedExpression(inner);
    }

    // Template literals
    if (ts.isTemplateExpression(node)) {
      const headText = node.head.text;
      let fullText = headText;
      let allLiteral = true;

      for (const span of node.templateSpans) {
        const exprSimplified = simplify(span.expression);
        const exprVal = evalLiteralExpression(exprSimplified);
        if (typeof exprVal !== "string") {
          allLiteral = false;
        } else {
          fullText += exprVal;
        }
        fullText += span.literal.text;
      }

      if (allLiteral) {
        return factory.createNoSubstitutionTemplateLiteral(fullText);
      }

      const newSpans = node.templateSpans.map((span) =>
        factory.createTemplateSpan(simplify(span.expression), span.literal),
      );
      return factory.createTemplateExpression(node.head, newSpans);
    }

    // Binary
    if (ts.isBinaryExpression(node)) {
      const left = simplify(node.left);
      const right = simplify(node.right);
      const synthetic = factory.createBinaryExpression(
        left,
        node.operatorToken,
        right,
      );
      const val = evalLiteralExpression(synthetic);
      if (val !== undefined) {
        if (typeof val === "boolean") {
          return val ? factory.createTrue() : factory.createFalse();
        }
        if (typeof val === "number") {
          return factory.createNumericLiteral(val);
        }
        if (typeof val === "string") {
          return factory.createStringLiteral(val);
        }
      }
      return synthetic;
    }

    // Prefix unary
    if (ts.isPrefixUnaryExpression(node)) {
      const operand = simplify(node.operand);
      const synthetic = factory.createPrefixUnaryExpression(
        node.operator,
        operand,
      );
      const val = evalLiteralExpression(synthetic);
      if (val !== undefined) {
        if (typeof val === "boolean") {
          return val ? factory.createTrue() : factory.createFalse();
        }
        if (typeof val === "number") {
          return factory.createNumericLiteral(val);
        }
      }
      return synthetic;
    }

    // Array literals with literal-safe spreads
    if (ts.isArrayLiteralExpression(node)) {
      const elements: ts.Expression[] = [];
      let changed = false;

      for (const el of node.elements) {
        if (ts.isSpreadElement(el)) {
          const spreadExprSimplified = simplify(el.expression);
          const resolved =
            paramConstEnv.size > 0
              ? (resolveConstExpression(
                  spreadExprSimplified,
                  paramConstEnv,
                  0,
                ) ?? spreadExprSimplified)
              : spreadExprSimplified;

          if (
            ts.isArrayLiteralExpression(resolved) &&
            isDeepConstExpr(resolved)
          ) {
            for (const inner of resolved.elements) {
              if (ts.isExpression(inner)) {
                elements.push(simplify(inner as ts.Expression));
              }
            }
            changed = true;
          } else {
            if (resolved !== el.expression) {
              changed = true;
            }
            elements.push(factory.createSpreadElement(resolved));
          }
        } else {
          const simpleEl = simplify(el as ts.Expression);
          if (simpleEl !== el) {
            changed = true;
          }
          elements.push(simpleEl);
        }
      }

      if (!changed) {
        return node;
      }
      return factory.createArrayLiteralExpression(
        elements,
        /*multiLine*/ false,
      );
    }

    // Object literals with literal-safe spreads
    if (ts.isObjectLiteralExpression(node)) {
      const properties: ts.ObjectLiteralElementLike[] = [];
      let changed = false;

      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) {
          const spreadExprSimplified = simplify(prop.expression);
          const resolved =
            paramConstEnv.size > 0
              ? (resolveConstExpression(
                  spreadExprSimplified,
                  paramConstEnv,
                  0,
                ) ?? spreadExprSimplified)
              : spreadExprSimplified;

          if (
            ts.isObjectLiteralExpression(resolved) &&
            isDeepConstExpr(resolved)
          ) {
            for (const inner of resolved.properties) {
              if (ts.isPropertyAssignment(inner)) {
                const init = inner.initializer;
                if (ts.isExpression(init)) {
                  const newInit = simplify(init);
                  const newProp = factory.createPropertyAssignment(
                    inner.name,
                    newInit,
                  );
                  properties.push(newProp);
                }
              } else {
                properties.push(factory.createSpreadAssignment(resolved));
                break;
              }
            }
            changed = true;
          } else {
            if (resolved !== prop.expression) {
              changed = true;
            }
            properties.push(factory.createSpreadAssignment(resolved));
          }
        } else if (ts.isPropertyAssignment(prop)) {
          const init = prop.initializer;
          if (ts.isExpression(init)) {
            const newInit = simplify(init);
            if (newInit !== init) {
              changed = true;
            }
            properties.push(
              factory.createPropertyAssignment(prop.name, newInit),
            );
          } else {
            properties.push(prop);
          }
        } else {
          properties.push(prop);
        }
      }

      if (!changed) {
        return node;
      }

      return factory.createObjectLiteralExpression(
        properties,
        /*multiLine*/ false,
      );
    }

    // Call inside expression: still substitute args where possible
    if (ts.isCallExpression(node)) {
      const newArgs = node.arguments.map((arg) => simplify(arg));
      return ts.factory.updateCallExpression(
        node,
        node.expression,
        node.typeArguments,
        newArgs,
      );
    }

    // Fallback: recursively visit children for substitution only
    return ts.visitEachChild(
      node,
      (child) => (ts.isExpression(child) ? simplify(child) : child),
      nullTransformationContext,
    ) as ts.Expression;
  }

  return simplify(expr);
}
