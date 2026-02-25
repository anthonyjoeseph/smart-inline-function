/**
 * Command handlers: the "product" layer that uses runners and drives
 * vscode.window (showErrorMessage) and editor.edit. Used by the extension
 * and by tests with a mocked vscode so we test the same code path as production.
 */

import * as path from "path";
import * as ts from "typescript";
import type * as vscode from "vscode";

import {
  runLiteralInline,
  runLiteralInlineArray,
  runLiteralInlineObject,
  runSmartInline,
} from "./commandRunners";

/** Minimal vscode API needed by handlers; tests pass a mock that satisfies this. */
export interface VscodeApi {
  Range: typeof vscode.Range;
  window: {
    showErrorMessage: (message: string) => void;
    activeTextEditor: vscode.TextEditor | undefined;
  };
  workspace: {
    getWorkspaceFolder?: (
      uri: vscode.Uri,
    ) => { uri: { fsPath: string } } | undefined;
  };
}

function getWorkspaceRoot(
  vscodeApi: VscodeApi,
  document: { fileName: string; uri: vscode.Uri },
): string {
  const folder = vscodeApi.workspace?.getWorkspaceFolder?.(document.uri);
  return folder ? folder.uri.fsPath : path.dirname(document.fileName);
}

function scriptKind(languageId: string): "ts" | "tsx" {
  return languageId === "typescriptreact" ? "tsx" : "ts";
}

/**
 * Handler for Smart Inline Function. Uses runSmartInline and then
 * showErrorMessage or editor.edit (replace + optional import insertion).
 */
export async function handleSmartInline(
  vscodeApi: VscodeApi,
  editor: vscode.TextEditor,
): Promise<void> {
  try {
    await doHandleSmartInline(vscodeApi, editor);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscodeApi.window.showErrorMessage(
      `Smart Inline Function failed: ${message}`,
    );
  }
}

async function doHandleSmartInline(
  vscodeApi: VscodeApi,
  editor: vscode.TextEditor,
): Promise<void> {
  const document = editor.document;
  const sourceText = document.getText();
  const selection = editor.selection;
  const offsetStart = document.offsetAt(selection.start);
  const offsetEnd = document.offsetAt(selection.end);
  const workspaceRoot = getWorkspaceRoot(vscodeApi, document);

  const result = await runSmartInline({
    sourceText,
    start: offsetStart,
    end: offsetEnd,
    fileName: document.fileName,
    workspaceRoot,
    scriptKind: scriptKind(document.languageId),
  });

  if (!result.ok) {
    vscodeApi.window.showErrorMessage(result.error);
    return;
  }

  await editor.edit((editBuilder) => {
    const existingText = document.getText();
    const toAdd = result.neededImportTexts.filter(
      (line) => !existingText.includes(line),
    );
    if (toAdd.length > 0) {
      const callerSourceFile = ts.createSourceFile(
        document.fileName,
        existingText,
        ts.ScriptTarget.Latest,
        true,
        document.languageId === "typescriptreact"
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS,
      );
      const existingImports = callerSourceFile.statements.filter((s) =>
        ts.isImportDeclaration(s),
      );
      const insertOffset =
        existingImports.length > 0
          ? existingImports[existingImports.length - 1].getEnd()
          : 0;
      editBuilder.insert(document.positionAt(insertOffset), toAdd.join(""));
    }
    const range = new vscodeApi.Range(
      document.positionAt(result.replaceStart),
      document.positionAt(result.replaceEnd),
    );
    editBuilder.replace(range, result.expression);
  });
}

/**
 * Handler for Smart Literal Inline.
 */
export async function handleLiteralInline(
  vscodeApi: VscodeApi,
  editor: vscode.TextEditor,
): Promise<void> {
  const document = editor.document;
  const sourceText = document.getText();
  const offsetStart = document.offsetAt(editor.selection.start);
  const offsetEnd = document.offsetAt(editor.selection.end);

  const result = runLiteralInline({
    sourceText,
    start: offsetStart,
    end: offsetEnd,
    fileName: document.fileName,
    scriptKind: scriptKind(document.languageId),
  });

  if (!result.ok) {
    vscodeApi.window.showErrorMessage(result.error);
    return;
  }

  await editor.edit((editBuilder) => {
    const range = new vscodeApi.Range(
      document.positionAt(result.replaceStart),
      document.positionAt(result.replaceEnd),
    );
    editBuilder.replace(range, result.text);
  });
}

/**
 * Handler for Smart Literal Inline Array.
 */
export async function handleLiteralInlineArray(
  vscodeApi: VscodeApi,
  editor: vscode.TextEditor,
): Promise<void> {
  const document = editor.document;
  const sourceText = document.getText();
  const offsetStart = document.offsetAt(editor.selection.start);
  const offsetEnd = document.offsetAt(editor.selection.end);

  const result = runLiteralInlineArray({
    sourceText,
    start: offsetStart,
    end: offsetEnd,
    fileName: document.fileName,
    scriptKind: scriptKind(document.languageId),
  });

  if (!result.ok) {
    vscodeApi.window.showErrorMessage(result.error);
    return;
  }

  await editor.edit((editBuilder) => {
    const range = new vscodeApi.Range(
      document.positionAt(result.replaceStart),
      document.positionAt(result.replaceEnd),
    );
    editBuilder.replace(range, result.text);
  });
}

/**
 * Handler for Smart Literal Inline Object.
 */
export async function handleLiteralInlineObject(
  vscodeApi: VscodeApi,
  editor: vscode.TextEditor,
): Promise<void> {
  const document = editor.document;
  const sourceText = document.getText();
  const offsetStart = document.offsetAt(editor.selection.start);
  const offsetEnd = document.offsetAt(editor.selection.end);

  const result = runLiteralInlineObject({
    sourceText,
    start: offsetStart,
    end: offsetEnd,
    fileName: document.fileName,
    scriptKind: scriptKind(document.languageId),
  });

  if (!result.ok) {
    vscodeApi.window.showErrorMessage(result.error);
    return;
  }

  await editor.edit((editBuilder) => {
    const range = new vscodeApi.Range(
      document.positionAt(result.replaceStart),
      document.positionAt(result.replaceEnd),
    );
    editBuilder.replace(range, result.text);
  });
}
