import { describe, expect, test } from "bun:test";
import {
  answerPrompt,
  choiceKey,
  chooseItem,
  installedCollections,
  menuItems,
  type HomeContext,
} from "./home-model.ts";
import { collection, lock } from "./test-fixtures.ts";

const empty: HomeContext = { project: lock(), global: lock(), isCollection: false };

describe("home model", () => {
  test("an empty home offers Add, Create and Quit only", () => {
    expect(menuItems(empty).map((item) => item.label)).toEqual([
      "Add a Collection",
      "Create a Collection here",
      "Quit",
    ]);
  });

  test("a Collection cwd offers the Curator actions instead of Create", () => {
    const labels = menuItems({ ...empty, isCollection: true }).map((item) => item.label);

    expect(labels).toEqual([
      "Add a Collection",
      "Add a Reference",
      "New Own Skill",
      "Check this Collection",
      "Quit",
    ]);
  });

  test("installed Collections are sorted by name within each scope, project first", () => {
    const context: HomeContext = {
      ...empty,
      project: lock({ b: collection("Beta", []), a: collection("Alpha", ["x", "y"]) }),
      global: lock({ g: collection("Gamma", ["z"]) }),
    };

    expect(installedCollections(context)).toEqual([
      { key: "a", name: "Alpha", skills: 2, global: false },
      { key: "b", name: "Beta", skills: 0, global: false },
      { key: "g", name: "Gamma", skills: 1, global: true },
    ]);
  });

  test("prompts trim answers and keep asking on an empty required one", () => {
    const refAdd = menuItems({ ...empty, isCollection: true })[1];
    const started = refAdd === undefined ? undefined : chooseItem(refAdd);

    if (started?.kind !== "step" || started.step.kind !== "prompt") {
      throw new Error("expected a prompt step");
    }

    expect(answerPrompt(started.step, "   ")).toEqual(started);
    expect(answerPrompt(started.step, "  acme/x  ")).toEqual({
      kind: "done",
      action: { kind: "ref-add", source: "acme/x" },
    });
  });

  test("choice lists add j/k and Enter to the RadioGroup's own keys", () => {
    expect(choiceKey("j", 0, 3)).toEqual({ kind: "move", index: 1 });
    expect(choiceKey("k", 0, 3)).toBeUndefined();
    expect(choiceKey("j", 2, 3)).toBeUndefined();
    expect(choiceKey("return", 1, 3)).toEqual({ kind: "choose" });
    expect(choiceKey("down", 0, 3)).toBeUndefined();
  });
});
