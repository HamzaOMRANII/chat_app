import { expect, it } from "vitest";
import { newer } from "./UpdatePrompt";

it("compares versions number by number", () => {
  expect(newer("0.8.10", "0.8.9")).toBe(true);
  expect(newer("0.9.0", "0.8.10")).toBe(true);
  expect(newer("0.8.9", "0.8.10")).toBe(false);
  expect(newer("0.8.10", "0.8.10")).toBe(false);
  expect(newer("1.0.0", "0.9.9")).toBe(true);
});
