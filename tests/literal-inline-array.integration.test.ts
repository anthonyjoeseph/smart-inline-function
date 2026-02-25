/**
 * Integration tests for the Smart Literal Inline Array command.
 * We invoke the same handler used in production (handleLiteralInlineArray) with mocked
 * vscode and editor, then assert on showErrorMessage and editor.edit (replace).
 */

import { handleLiteralInlineArray, type VscodeApi } from "../src/commandHandlers";
import { selectionOffsets } from "../src/commandRunners";
import {
  createMockEditor,
  createMockVscode,
  FAKE_FILE,
} from "./mockVscode";

describe("Smart Literal Inline Array (smartInlineFunction.literal-inline-array)", () => {
  describe("when selection is inside .map(...) and source is const", () => {
    it("reduces myArray.map(callback) to an array literal when myArray is const", async () => {
      const source = `
const myArray = [1, 2, 3];
const doubled = myArray.map((x) => x * 2);
`;
      const { start, end } = selectionOffsets(source, "myArray.map((x) => x * 2)");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInlineArray(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const replace = jest.fn();
      const insert = jest.fn();
      await (editor.edit as jest.Mock).mock.calls[0][0]({ replace, insert });
      expect(replace).toHaveBeenCalledWith(expect.anything(), "[2, 4, 6]");
    });

    it("reduces Object.entries(obj).map(callback) when obj is const", async () => {
      const source = `
const obj = { a: 1, b: 2 };
const entries = Object.entries(obj).map(([k, v]) => v * 2);
`;
      const { start, end } = selectionOffsets(
        source,
        "Object.entries(obj).map(([k, v]) => v * 2)",
      );
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInlineArray(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const replace = jest.fn();
      const insert = jest.fn();
      await (editor.edit as jest.Mock).mock.calls[0][0]({ replace, insert });
      expect(replace).toHaveBeenCalled();
      const text = (replace.mock.calls[0] as any)[1];
      expect(text.trim()).toBe("[2, 4]");
    });
  });

  describe("error cases", () => {
    it("shows error when array/object is not const", async () => {
      const source = `
let myArray = [1, 2];
const doubled = myArray.map((x) => x * 2);
`;
      const { start, end } = selectionOffsets(source, "myArray.map((x) => x * 2)");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInlineArray(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/const/),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("shows error when selection is not inside a .map(...) call", async () => {
      const source = `const x = [1, 2, 3];`;
      const { start, end } = selectionOffsets(source, "[1, 2, 3]");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInlineArray(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/\.map|Selection must/),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("shows error when no expression is at the selection", async () => {
      const source = `const x = 1;`;
      const vscode = createMockVscode();
      const editor = createMockEditor(source, 0, 0, { fileName: FAKE_FILE });

      await handleLiteralInlineArray(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      expect(editor.edit).not.toHaveBeenCalled();
    });
  });
});
