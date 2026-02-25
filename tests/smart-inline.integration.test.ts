/**
 * Integration tests for the Smart Inline Function command.
 * We invoke the same handler used in production (handleSmartInline) with mocked
 * vscode and editor, then assert on showErrorMessage and editor.edit (replace/insert).
 */

import type * as vscode from "vscode";
import { handleSmartInline, type VscodeApi } from "../src/commandHandlers";
import { selectionOffsets } from "../src/commandRunners";
import {
  createMockEditor,
  createMockVscode,
  FAKE_FILE,
  FAKE_WORKSPACE,
} from "./mockVscode";

describe("Smart Inline Function (smartInlineFunction.inline)", () => {
  describe("when selection is on a call to a same-file function", () => {
    it("inlines the function body and preserves variable names (does not substitute const literals)", async () => {
      const source = `
const addTwo = (a: number) => a + 2;
const three = 3;
const result = addTwo(three);
`;
      const { start, end } = selectionOffsets(source, "addTwo(three)");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      expect(replace).toHaveBeenCalled();
      const replaceCall = replace.mock.calls.find(
        (c: unknown[]) =>
          typeof c[1] === "string" && (c[1] as string).trim() === "three + 2",
      );
      expect(replaceCall).toBeDefined();
      expect(replaceCall[1].trim()).toBe("three + 2");
    });

    it("inlines when argument is a property access and preserves the expression", async () => {
      const source = `
const addTwo = (a: number) => a + 2;
const nums = { four: 4 };
const result = addTwo(nums.four);
`;
      const { start, end } = selectionOffsets(source, "addTwo(nums.four)");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      const replaceCalls = replace.mock.calls as Array<[unknown, string]>;
      const exprReplace = replaceCalls.find(
        ([, text]) => text.trim() === "nums.four + 2",
      );
      expect(exprReplace).toBeDefined();
    });

    it("inlines when argument is array access and preserves the expression", async () => {
      const source = `
const addTwo = (a: number) => a + 2;
const arr = [3, 6, 7];
const result = addTwo(arr[1]);
`;
      const { start, end } = selectionOffsets(source, "addTwo(arr[1])");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      const replaceCalls = replace.mock.calls as Array<[unknown, string]>;
      expect(
        replaceCalls.some(([, text]) => text.trim() === "arr[1] + 2"),
      ).toBe(true);
    });

    it("inlines functions with object-destructured params and maps to access expressions", async () => {
      const source = `
const add = ({ a, b }: { a: number; b: number }) => a + b;
const pair = { a: 1, b: 2 };
const result = add(pair);
`;
      const { start, end } = selectionOffsets(source, "add(pair)");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      const replaceCalls = replace.mock.calls as Array<[unknown, string]>;
      expect(
        replaceCalls.some(([, text]) => text.trim() === "pair.a + pair.b"),
      ).toBe(true);
    });

    it("inlines functions with array-destructured params and maps to index access", async () => {
      const source = `
const sumTwo = ([x, y]: number[]) => x + y;
const tup = [10, 20];
const result = sumTwo(tup);
`;
      const { start, end } = selectionOffsets(source, "sumTwo(tup)");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      const replaceCalls = replace.mock.calls as Array<[unknown, string]>;
      expect(
        replaceCalls.some(([, text]) => text.trim() === "tup[0] + tup[1]"),
      ).toBe(true);
    });

    it("collapses if/else when condition can be evaluated from const inputs", async () => {
      const source = `
const fn = (flag: boolean) => { if (flag) return 1; else return 2; };
const OFF = false;
const result = fn(OFF);
`;
      const { start, end } = selectionOffsets(source, "fn(OFF)");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      const replaceCalls = replace.mock.calls as Array<[unknown, string]>;
      expect(replaceCalls.some(([, text]) => text.trim() === "2")).toBe(true);
    });

    it("collapses switch when discriminant is const", async () => {
      const source = `
const label = (n: number) => {
  switch (n) {
    case 1: return "one";
    case 2: return "two";
    default: return "other";
  }
};
const TWO = 2;
const result = label(TWO);
`;
      const { start, end } = selectionOffsets(source, "label(TWO)");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      const replaceCalls = replace.mock.calls as Array<[unknown, string]>;
      expect(replaceCalls.some(([, text]) => text.trim() === '"two"')).toBe(
        true,
      );
    });
  });

  describe("when the inlined function is async", () => {
    it("fails if the call is not awaited and enclosing function is not async", async () => {
      const source = `
const asyncFetch = async () => 42;
function run() {
  const x = asyncFetch();
}
`;
      const { start, end } = selectionOffsets(source, "asyncFetch()");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/not awaited|not async/i),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("succeeds if the call is awaited inside an async function", async () => {
      const source = `
const asyncFetch = async () => 42;
async function run() {
  const x = await asyncFetch();
}
`;
      const { start, end } = selectionOffsets(source, "asyncFetch()");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(editor.edit).toHaveBeenCalledTimes(1);
      const editBuilder = (editor.edit as jest.Mock).mock.calls[0][0];
      const replace = jest.fn();
      const insert = jest.fn();
      await editBuilder({ replace, insert });
      expect(
        replace.mock.calls.some(
          ([, text]: [unknown, string]) => text.trim() === "42",
        ),
      ).toBe(true);
    });
  });

  describe("error cases", () => {
    it("shows error when no call expression is at the selection", async () => {
      const source = `const x = 1 + 2;`;
      const { start, end } = selectionOffsets(source, "1 + 2");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "No function call expression found at the selection.",
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("shows error when callee is not a simple identifier", async () => {
      const source = `
const f = () => 1;
const result = (f)();
`;
      const { start, end } = selectionOffsets(source, "(f)()");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/simple function identifiers/),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("shows error when function cannot be resolved", async () => {
      const source = `const result = unknownFunc(1);`;
      const { start, end } = selectionOffsets(source, "unknownFunc(1)");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Could not resolve/),
      );
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("shows error when function body is too complex to inline", async () => {
      const source = `
function complex() {
  const a = 1;
  const b = 2;
  if (a) return b;
  return a + b;
}
const result = complex();
`;
      const { start, end } = selectionOffsets(source, "complex()");
      const vscode = createMockVscode(FAKE_WORKSPACE);
      const editor = createMockEditor(source, start, end, {
        fileName: FAKE_FILE,
      });

      await handleSmartInline(
        vscode as unknown as VscodeApi,
        editor as unknown as vscode.TextEditor,
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      const msg = (vscode.window.showErrorMessage as jest.Mock).mock
        .calls[0][0];
      expect(msg).toMatch(/too complex|No function call expression/);
      expect(editor.edit).not.toHaveBeenCalled();
    });
  });
});
