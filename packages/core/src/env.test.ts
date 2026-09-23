import { expect, test } from "bun:test";
import { envValue } from "./env.ts";

test("envValue treats unset, empty and blank variables as unset", () => {
  const env = { EMPTY: "", BLANK: " \t", SET: "/tmp/x", SPACED: " /tmp/y " };

  expect(envValue(env, "MISSING")).toBeUndefined();
  expect(envValue(env, "EMPTY")).toBeUndefined();
  expect(envValue(env, "BLANK")).toBeUndefined();
  expect(envValue(env, "SET")).toBe("/tmp/x");
  expect(envValue(env, "SPACED")).toBe(" /tmp/y ");
});
