import * as vscode from "vscode";

import {
  handleLiteralInline,
  handleLiteralInlineArray,
  handleLiteralInlineObject,
  handleSmartInline,
} from "./commandHandlers";

function isSupportedLanguage(languageId: string): boolean {
  return (
    languageId === "typescript" || languageId === "typescriptreact"
  );
}

function runWithEditor(
  vscodeApi: typeof vscode,
  commandName: string,
  unsupportedMessage: string,
  handler: (
    vscodeApi: typeof vscode,
    editor: vscode.TextEditor,
  ) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const editor = vscodeApi.window.activeTextEditor;
    if (!editor) {
      vscodeApi.window.showErrorMessage("No active editor.");
      return;
    }
    if (!isSupportedLanguage(editor.document.languageId)) {
      vscodeApi.window.showErrorMessage(unsupportedMessage);
      return;
    }
    await handler(vscodeApi, editor);
  };
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "smartInlineFunction.inline",
      runWithEditor(
        vscode,
        "Smart Inline Function",
        "Smart Inline Function only supports TypeScript/TSX files.",
        handleSmartInline,
      ),
    ),
    vscode.commands.registerCommand(
      "smartInlineFunction.literal-inline",
      runWithEditor(
        vscode,
        "Smart Literal Inline",
        "Smart Literal Inline only supports TypeScript/TSX files.",
        handleLiteralInline,
      ),
    ),
    vscode.commands.registerCommand(
      "smartInlineFunction.literal-inline-array",
      runWithEditor(
        vscode,
        "Literal Inline Array",
        "Literal Inline Array only supports TypeScript/TSX files.",
        handleLiteralInlineArray,
      ),
    ),
    vscode.commands.registerCommand(
      "smartInlineFunction.literal-inline-object",
      runWithEditor(
        vscode,
        "Literal Inline Object",
        "Literal Inline Object only supports TypeScript/TSX files.",
        handleLiteralInlineObject,
      ),
    ),
  );
}

export function deactivate() {
  // no-op
}
