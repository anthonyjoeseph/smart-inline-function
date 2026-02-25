/**
 * Integration tests for the Smart Literal Inline Object command.
 * We invoke the same handler used in production (handleLiteralInlineObject) with mocked
 * vscode and editor, then assert on showErrorMessage and editor.edit (replace).
 */

import { handleLiteralInlineObject, type VscodeApi } from "../src/commandHandlers";
import { selectionOffsets } from "../src/commandRunners";
import {
  createMockEditor,
  createMockVscode,
  FAKE_FILE,
} from "./mockVscode";

describe("Smart Literal Inline Object (smartInlineFunction.literal-inline-object)", () => {
  describe("when selection is inside Object.fromEntries(...) and argument is const", () => {
    it("reduces Object.fromEntries(entries) to an object literal when entries is const", async () => {
      const source = `
const entries = [["a", 1], ["b", 2]];
const obj = Object.fromEntries(entries);
`;
      const { start, end } = selectionOffsets(source, "Object.fromEntries(entries)");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInlineObject(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const replace = jest.fn();
      const insert = jest.fn();
      await (editor.edit as jest.Mock).mock.calls[0][0]({ replace, insert });
      expect(replace).toHaveBeenCalled();
      const text = (replace.mock.calls[0] as any)[1];
      expect(text).toMatch(/a.*1|1.*a/);
      expect(text).toMatch(/b.*2|2.*b/);
    });
  });

  describe("error cases", () => {
    it("shows error when entries is not const", async () => {
      const source = `
let entries = [["a", 1]];
const obj = Object.fromEntries(entries);
`;
      const { start, end } = selectionOffsets(source, "Object.fromEntries(entries)");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInlineObject(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/const|entries/),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("shows error when selection is not inside Object.fromEntries(...)", async () => {
      const source = `const x = { a: 1 };`;
      const { start, end } = selectionOffsets(source, "{ a: 1 }");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInlineObject(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/fromEntries|Selection must/),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("shows error when no expression is at the selection", async () => {
      const source = `const x = 1;`;
      const vscode = createMockVscode();
      const editor = createMockEditor(source, 0, 0, { fileName: FAKE_FILE });

      await handleLiteralInlineObject(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      expect(editor.edit).not.toHaveBeenCalled();
    });
  });
});
