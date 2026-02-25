/**
 * Integration tests for the Smart Literal Inline command.
 * We invoke the same handler used in production (handleLiteralInline) with mocked
 * vscode and editor, then assert on showErrorMessage and editor.edit (replace).
 */

import { handleLiteralInline, type VscodeApi } from "../src/commandHandlers";
import { selectionOffsets } from "../src/commandRunners";
import {
  createMockEditor,
  createMockVscode,
  FAKE_FILE,
} from "./mockVscode";

describe("Smart Literal Inline (smartInlineFunction.literal-inline)", () => {
  describe("when selection is on an expression with const bindings in scope", () => {
    it("folds arithmetic to a literal", async () => {
      const source = `
const arg = 3;
const sum = arg + 3;
`;
      const { start, end } = selectionOffsets(source, "arg + 3");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInline(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const replace = jest.fn();
      const insert = jest.fn();
      await (editor.edit as jest.Mock).mock.calls[0][0]({ replace, insert });
      expect(replace).toHaveBeenCalledWith(expect.anything(), "6");
    });

    it("folds template literal when embedded expressions are const", async () => {
      const source = `
const month = "June";
const myString = \`\${month} says hello!\`;
`;
      const { start, end } = selectionOffsets(
        source,
        "`${month} says hello!`",
      );
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInline(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const replace = jest.fn();
      const insert = jest.fn();
      await (editor.edit as jest.Mock).mock.calls[0][0]({ replace, insert });
      expect(replace).toHaveBeenCalled();
      expect((replace.mock.calls[0] as any)[1]).toMatch(/June says hello!/);
    });

    it("flattens array spread when spread source is const array", async () => {
      const source = `
const arg = [7, 8];
const bigArray = [...arg, 4, 5];
`;
      const { start, end } = selectionOffsets(source, "[...arg, 4, 5]");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInline(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const replace = jest.fn();
      const insert = jest.fn();
      await (editor.edit as jest.Mock).mock.calls[0][0]({ replace, insert });
      expect(replace).toHaveBeenCalledWith(expect.anything(), "[7, 8, 4, 5]");
    });

    it("flattens object spread when spread source is const object", async () => {
      const source = `
const base = { a: 1 };
const obj = { ...base, b: 2 };
`;
      const { start, end } = selectionOffsets(source, "{ ...base, b: 2 }");
      const vscode = createMockVscode();
      const editor = createMockEditor(source, start, end, { fileName: FAKE_FILE });

      await handleLiteralInline(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const replace = jest.fn();
      const insert = jest.fn();
      await (editor.edit as jest.Mock).mock.calls[0][0]({ replace, insert });
      expect(replace).toHaveBeenCalled();
      const text = (replace.mock.calls[0] as any)[1];
      expect(text).toMatch(/a.*1/);
      expect(text).toMatch(/b.*2/);
    });
  });

  describe("error cases", () => {
    it("shows error when no expression is at the selection", async () => {
      const source = `const x = ;`;
      const vscode = createMockVscode();
      const editor = createMockEditor(source, 0, source.length, { fileName: FAKE_FILE });

      await handleLiteralInline(vscode as unknown as VscodeApi, editor as any);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/No expression/),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });
  });
});
