import * as vscode from "vscode";
import * as path from "path";
import * as ts from "typescript";

import { findSelectedCallExpression } from "./callSelection";
import { resolveFunctionDefinition } from "./functionResolution";
import {
  collectLiteralConstsVisibleAtCall,
  inlineCallExpression,
} from "./inlining";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "smartInlineFunction.inline",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No active editor.");
        return;
      }

      const document = editor.document;
      if (
        document.languageId !== "typescript" &&
        document.languageId !== "typescriptreact"
      ) {
        vscode.window.showErrorMessage(
          "Smart Inline Function only supports TypeScript/TSX files.",
        );
        return;
      }

      const sourceText = document.getText();
      const sourceFile = ts.createSourceFile(
        document.fileName,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        document.languageId === "typescriptreact"
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS,
      );

      const selection = editor.selection;
      const offsetStart = document.offsetAt(selection.start);
      const offsetEnd = document.offsetAt(selection.end);

      const callExpr = findSelectedCallExpression(
        sourceFile,
        offsetStart,
        offsetEnd,
      );
      if (!callExpr) {
        vscode.window.showErrorMessage(
          "No function call expression found at the selection.",
        );
        return;
      }

      const callee = callExpr.expression;
      if (!ts.isIdentifier(callee)) {
        vscode.window.showErrorMessage(
          "Only simple function identifiers are supported (no methods or property accesses).",
        );
        return;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const workspaceRoot = workspaceFolder
        ? workspaceFolder.uri.fsPath
        : path.dirname(document.fileName);

      try {
        const functionInfo = await resolveFunctionDefinition(
          callee.text,
          sourceFile,
          document.fileName,
          workspaceRoot,
        );

        if (!functionInfo) {
          vscode.window.showErrorMessage(
            `Could not resolve function declaration for "${callee.text}".`,
          );
          return;
        }

        const isAsyncCallee = !!functionInfo.node.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
        );

        if (isAsyncCallee) {
          const asyncContextCheck = validateAsyncCallContext(
            sourceFile,
            callExpr,
          );
          if (!asyncContextCheck.ok) {
            vscode.window.showErrorMessage(
              asyncContextCheck.message ??
                "Cannot inline async function in this context.",
            );
            return;
          }
        }

        const callerConstEnv = collectLiteralConstsVisibleAtCall(
          sourceFile,
          callExpr,
        );

        const inlinedText = inlineCallExpression(
          callExpr,
          functionInfo.node,
          functionInfo.sourceFile,
          callerConstEnv,
        );
        if (!inlinedText) {
          vscode.window.showErrorMessage(
            "This function is too complex to inline safely.",
          );
          return;
        }

        await editor.edit((editBuilder) => {
          const range = new vscode.Range(
            document.positionAt(callExpr.getStart(sourceFile)),
            document.positionAt(callExpr.getEnd()),
          );
          editBuilder.replace(range, inlinedText);
        });
      } catch (err: any) {
        console.error(err);
        vscode.window.showErrorMessage(
          `Smart Inline Function failed: ${err?.message ?? String(err)}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  // no-op
}

interface AsyncContextCheckResult {
  ok: boolean;
  message?: string;
}

function isTopLevelAwaitAllowed(sourceFile: ts.SourceFile): boolean {
  // TypeScript marks modules that allow top-level await with AwaitContext.
  return (sourceFile.flags & ts.NodeFlags.AwaitContext) !== 0;
}

function validateAsyncCallContext(
  sourceFile: ts.SourceFile,
  callExpr: ts.CallExpression,
): AsyncContextCheckResult {
  const parent = callExpr.parent;
  const isAwaited = ts.isAwaitExpression(parent);

  // Walk up to find the nearest enclosing real function-like or the source file.
  let current: ts.Node | undefined = callExpr;
  let enclosingFunction:
    | ts.FunctionDeclaration
    | ts.MethodDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration
    | ts.ConstructorDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | undefined;

  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      enclosingFunction = current;
      break;
    }
    current = current.parent;
  }

  if (enclosingFunction) {
    const isParentAsync = !!enclosingFunction.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
    );

    if (!isParentAsync) {
      return {
        ok: false,
        message:
          "Cannot inline async function here: enclosing function is not async.",
      };
    }

    if (!isAwaited) {
      return {
        ok: false,
        message:
          "Cannot inline async function here: the call is not awaited and inlining would change its behavior.",
      };
    }

    return { ok: true };
  }

  // No enclosing function -> top-level usage.
  if (!isAwaited) {
    return {
      ok: false,
      message:
        "Cannot inline async function at top level unless the call is awaited.",
    };
  }

  if (!isTopLevelAwaitAllowed(sourceFile)) {
    return {
      ok: false,
      message:
        "Cannot inline async function here: top-level await is not allowed in this file.",
    };
  }

  return { ok: true };
}