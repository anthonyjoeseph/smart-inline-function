import * as ts from "typescript";

export function inlineCallExpression(
  callExpr: ts.CallExpression,
  fnDecl: ts.FunctionLikeDeclaration,
  fnSourceFile: ts.SourceFile,
  callerConstEnv: Map<string, ts.Expression>,
): string | undefined {
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
    }
  }

  if (!finalExpr) {
    return undefined; // function body too complex to inline safely
  }

  const inlinedText = printer.printNode(
    ts.EmitHint.Expression,
    finalExpr,
    fnSourceFile,
  );
  return inlinedText.trim();
}

export function collectLiteralConstsVisibleAtCall(
  sourceFile: ts.SourceFile,
  callExpr: ts.CallExpression,
): Map<string, ts.Expression> {
  const result = new Map<string, ts.Expression>();
  const callStart = callExpr.getStart(sourceFile);

  let current: ts.Node | undefined = callExpr;
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

interface IfBranch {
  condition?: ts.Expression; // undefined for final else
  returnExpr: ts.Expression;
}

function getBooleanLiteralValue(node: ts.Expression): boolean | undefined {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function isSimpleLiteral(node: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}

function isDeepConstExpr(node: ts.Expression): boolean {
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

function extractReturnExpressionFromStatement(
  stmt: ts.Statement,
): ts.Expression | undefined {
  if (ts.isReturnStatement(stmt) && stmt.expression) {
    return stmt.expression;
  }
  if (ts.isBlock(stmt) && stmt.statements.length === 1) {
    const inner = stmt.statements[0];
    if (ts.isReturnStatement(inner) && inner.expression) {
      return inner.expression;
    }
  }
  return undefined;
}

function collectIfBranches(ifStmt: ts.IfStatement): IfBranch[] | undefined {
  const branches: IfBranch[] = [];
  let current: ts.IfStatement | undefined = ifStmt;

  while (current) {
    const thenExpr = extractReturnExpressionFromStatement(
      current.thenStatement,
    );
    if (!thenExpr) {
      return undefined;
    }
    branches.push({ condition: current.expression, returnExpr: thenExpr });

    const elseStmt: ts.Statement | undefined = current.elseStatement;
    if (!elseStmt) {
      current = undefined;
    } else if (ts.isIfStatement(elseStmt)) {
      current = elseStmt;
    } else {
      const elseExpr = extractReturnExpressionFromStatement(elseStmt);
      if (!elseExpr) {
        return undefined;
      }
      branches.push({ condition: undefined, returnExpr: elseExpr });
      current = undefined;
    }
  }

  return branches;
}

function tryReduceIfElseChainToExpression(
  body: ts.Block,
  argMap: Map<string, ts.Expression>,
  paramConstEnv: Map<string, ts.Expression>,
): ts.Expression | undefined {
  if (body.statements.length !== 1) {
    return undefined;
  }
  const first = body.statements[0];
  if (!ts.isIfStatement(first)) {
    return undefined;
  }

  const branches = collectIfBranches(first);
  if (!branches || branches.length === 0) {
    return undefined;
  }

  const hasElse = branches[branches.length - 1].condition === undefined;
  const condBranchCount = hasElse ? branches.length - 1 : branches.length;

  const condValues: boolean[] = [];

  for (let i = 0; i < condBranchCount; i++) {
    const cond = branches[i].condition!;
    const simplifiedCond = substituteAndSimplifyExpression(
      cond,
      argMap,
      paramConstEnv,
    );
    const boolVal = getBooleanLiteralValue(simplifiedCond);
    if (boolVal === undefined) {
      // Condition is not statically true/false after substitution -> cannot safely reduce.
      return undefined;
    }
    condValues[i] = boolVal;
  }

  let chosenReturnExpr: ts.Expression | undefined;

  for (let i = 0; i < condBranchCount; i++) {
    if (condValues[i]) {
      chosenReturnExpr = branches[i].returnExpr;
      break;
    }
  }

  if (!chosenReturnExpr) {
    if (hasElse) {
      chosenReturnExpr = branches[branches.length - 1].returnExpr;
    } else {
      return undefined;
    }
  }

  // Now substitute and simplify within the chosen return expression.
  return substituteAndSimplifyExpression(chosenReturnExpr, argMap, paramConstEnv);
}

function resolveConstExpression(
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

function substituteAndSimplifyExpression(
  expr: ts.Expression,
  argMap: Map<string, ts.Expression>,
  paramConstEnv: Map<string, ts.Expression>,
): ts.Expression {
  const factory = ts.factory;

  function evalLiteralExpression(node: ts.Expression): any | undefined {
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
          return +v;
        case ts.SyntaxKind.MinusToken:
          return -v;
        default:
          return undefined;
      }
    }
    if (ts.isParenthesizedExpression(node)) {
      return evalLiteralExpression(node.expression);
    }
    if (ts.isBinaryExpression(node)) {
      const left = evalLiteralExpression(node.left);
      const right = evalLiteralExpression(node.right);
      if (left === undefined || right === undefined) return undefined;
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsToken:
          return left === right;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsToken:
          return left !== right;
        case ts.SyntaxKind.LessThanToken:
          return left < right;
        case ts.SyntaxKind.LessThanEqualsToken:
          return left <= right;
        case ts.SyntaxKind.GreaterThanToken:
          return left > right;
        case ts.SyntaxKind.GreaterThanEqualsToken:
          return left >= right;
        case ts.SyntaxKind.PlusToken:
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          return left + right;
        case ts.SyntaxKind.MinusToken:
          return (left as any) - (right as any);
        case ts.SyntaxKind.AsteriskToken:
          return (left as any) * (right as any);
        case ts.SyntaxKind.SlashToken:
          return (left as any) / (right as any);
        default:
          return undefined;
      }
    }
    return undefined;
  }

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

  const nullTransformationContext = {
    enableEmitNotification: () => {},
    enableSubstitution: () => {},
    endLexicalEnvironment: () => [],
    getCompilerOptions: () => ({}) as ts.CompilerOptions,
    getEmitHost: () => ({}) as any,
    getEmitResolver: () => ({}) as any,
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

  return simplify(expr);
}

