/**
 * Tests for test helpers (e.g. selectionOffsets) used across integration tests.
 */

import { selectionOffsets } from "../src/commandRunners";

describe("selectionOffsets helper", () => {
  it("returns start and end for the first occurrence of the substring", () => {
    const text = "const x = add(1); const y = add(2);";
    const first = selectionOffsets(text, "add(1)");
    expect(text.slice(first.start, first.end)).toBe("add(1)");
    const second = selectionOffsets(text, "add(2)");
    expect(text.slice(second.start, second.end)).toBe("add(2)");
  });

  it("throws if substring is not found", () => {
    expect(() => selectionOffsets("hello", "xyz")).toThrow(/not found/);
  });
});
