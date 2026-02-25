/**
 * Mocks for testing command handlers. We assert on showErrorMessage calls
 * and on the edits (replace/insert) passed to editor.edit so we test the
 * same "product" behavior as production.
 */

import * as path from "path";

const FAKE_FILE = path.join(__dirname, "fake.ts");
const FAKE_WORKSPACE = path.dirname(__dirname);

function positionAtOffset(text: string, offset: number): { line: number; character: number } {
  const lines = text.split(/\r?\n/);
  let current = 0;
  for (let line = 0; line < lines.length; line++) {
    const lineEnd = current + lines[line].length;
    if (offset <= lineEnd) {
      return { line, character: offset - current };
    }
    current = lineEnd + 1;
  }
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1]?.length ?? 0,
  };
}

function offsetAtPosition(text: string, position: { line: number; character: number }): number {
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (let l = 0; l < position.line && l < lines.length; l++) {
    offset += lines[l].length + 1;
  }
  return offset + Math.min(position.character, lines[position.line]?.length ?? 0);
}

export interface MockEditBuilder {
  replace: jest.Mock<void, [range: { start: unknown; end: unknown }, text: string]>;
  insert: jest.Mock<void, [position: unknown, text: string]>;
}

export interface MockEditor {
  document: {
    getText: () => string;
    fileName: string;
    languageId: string;
    uri: { fsPath: string };
    offsetAt: (position: { line: number; character: number }) => number;
    positionAt: (offset: number) => { line: number; character: number };
  };
  selection: { start: { line: number; character: number }; end: { line: number; character: number } };
  edit: jest.Mock<Promise<boolean>, [(editBuilder: MockEditBuilder) => void | Promise<void>]>;
}

export interface MockVscode {
  Range: new (
    start: { line: number; character: number },
    end: { line: number; character: number },
  ) => { start: unknown; end: unknown };
  window: {
    showErrorMessage: jest.Mock<void, [message: string]>;
    activeTextEditor: MockEditor | undefined;
  };
  workspace: {
    getWorkspaceFolder: (uri: { fsPath: string }) => { uri: { fsPath: string } } | undefined;
  };
}

/**
 * Create a mock editor with the given source text and selection range (by offset).
 * edit() will run the callback with a mock editBuilder and record replace/insert calls.
 */
export function createMockEditor(
  sourceText: string,
  selectionStart: number,
  selectionEnd: number,
  options: { fileName?: string; languageId?: string } = {},
): MockEditor {
  const fileName = options.fileName ?? FAKE_FILE;
  const languageId = options.languageId ?? "typescript";

  const replace = jest.fn<void, [range: { start: unknown; end: unknown }, text: string]>();
  const insert = jest.fn<void, [position: unknown, text: string]>();

  const document = {
    getText: () => sourceText,
    fileName,
    languageId,
    uri: { fsPath: path.dirname(fileName) },
    offsetAt(position: { line: number; character: number }) {
      return offsetAtPosition(sourceText, position);
    },
    positionAt(offset: number) {
      return positionAtOffset(sourceText, offset);
    },
  };

  const edit = jest.fn<
    Promise<boolean>,
    [(editBuilder: MockEditBuilder) => void | Promise<void>]
  >(async (callback) => {
    await callback({ replace, insert });
    return true;
  });

  const selection = {
    start: positionAtOffset(sourceText, selectionStart),
    end: positionAtOffset(sourceText, selectionEnd),
  };

  return {
    document,
    selection,
    edit,
  };
}

/**
 * Create mock vscode with showErrorMessage spy and workspace.
 * window.activeTextEditor is not set; tests pass the editor to the handler explicitly.
 */
export function createMockVscode(workspaceRoot?: string): MockVscode {
  const showErrorMessage = jest.fn<void, [message: string]>();

  const Range = jest.fn(
    (
      start: { line: number; character: number },
      end: { line: number; character: number },
    ) => ({ start, end }),
  ) as unknown as MockVscode["Range"];

  return {
    Range,
    window: {
      showErrorMessage,
      activeTextEditor: undefined,
    },
    workspace: {
      getWorkspaceFolder: () =>
        workspaceRoot != null ? { uri: { fsPath: workspaceRoot } } : undefined,
    },
  };
}

export function getWorkspaceRootForFile(fileName: string): string {
  return FAKE_WORKSPACE;
}

export { FAKE_FILE, FAKE_WORKSPACE };
