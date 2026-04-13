import { test, expect } from "bun:test";
import { promptActivation } from "../src/cli/prompt";

test("promptActivation is exported as a function", () => {
  expect(typeof promptActivation).toBe("function");
});
