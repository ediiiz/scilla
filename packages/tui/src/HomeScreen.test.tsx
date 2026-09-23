import { afterEach, describe, expect, test } from "bun:test";
import type { HomeAction, HomeContext } from "./home-model.ts";
import { HomeScreen } from "./HomeScreen.tsx";
import { collection, lock } from "./test-fixtures.ts";
import { mountScreen, reporter, unmountAll } from "./test-render.ts";

afterEach(unmountAll);

const consumer: HomeContext = {
  project: lock({ "acme/web": collection("Web Kit", ["a", "b", "c"]) }),
  global: lock({ "acme/ops": collection("Ops Kit", ["x"]) }),
  isCollection: false,
};

const mount = async (context: HomeContext) => {
  const { reported, done } = reporter<HomeAction | undefined>();

  const screen = await mountScreen(<HomeScreen context={context} onDone={done} />, 100, 40);

  return { ...screen, outcome: reported };
};

describe("HomeScreen", () => {
  test("lists installed Collections by scope and the menu", async () => {
    const { frame } = await mount(consumer);
    const text = frame();

    expect(text).toContain("Project");
    expect(text).toContain("Web Kit  3 skills · acme/web");
    expect(text).toContain("Global");
    expect(text).toContain("Ops Kit  1 skills · acme/ops");
    expect(text).toContain("Add a Collection");
    expect(text).toContain("Update all global");
    expect(text).toContain("Create a Collection here");
    expect(text).not.toContain("Add a Reference");
  });

  test("Add a Collection prompts for a source", async () => {
    const { outcome, press, type, frame } = await mount(consumer);

    await press("RETURN");

    expect(frame()).toContain("Collection source");

    await press("RETURN");

    expect(outcome.value).toBe("pending");

    await type("acme/skills");
    await press("RETURN");

    expect(outcome.value).toEqual({ kind: "add", source: "acme/skills" });
  });

  test("Update all updates the project scope", async () => {
    const { outcome, press } = await mount(consumer);

    await press("ARROW_DOWN", "RETURN");

    expect(outcome.value).toEqual({ kind: "update", collection: undefined, global: false });
  });

  test("Remove a Collection picks one, keeping its scope", async () => {
    const { outcome, press, frame } = await mount(consumer);

    await press("j", "j", "j", "j", "RETURN");

    expect(frame()).toContain("Remove which Collection?");

    await press("j", "RETURN");

    expect(outcome.value).toEqual({ kind: "delete", collection: "acme/ops", global: true });
  });

  test("Update one picks a Collection", async () => {
    const { outcome, press } = await mount(consumer);

    await press("j", "j", "j", "RETURN", "RETURN");

    expect(outcome.value).toEqual({ kind: "update", collection: "acme/web", global: false });
  });

  test("Create a Collection here asks for a name and a description", async () => {
    const { outcome, press, type, frame } = await mount({
      ...consumer,
      project: lock(),
      global: lock(),
    });

    expect(frame()).not.toContain("Update one");

    await press("j", "RETURN");
    await type("my-kit");
    await press("RETURN");

    expect(frame()).toContain("Description");

    await press("RETURN");

    expect(outcome.value).toEqual({ kind: "init", name: "my-kit", description: "" });
  });

  test("Curator actions when the cwd is a Collection", async () => {
    const { outcome, press, type, frame } = await mount({
      ...consumer,
      isCollection: true,
      collectionName: "Web Kit",
    });

    expect(frame()).toContain("curating Web Kit");
    expect(frame()).toContain("Check this Collection");

    await press("j", "j", "j", "j", "j", "j", "RETURN");
    await type("quick-skill");
    await press("RETURN");

    expect(outcome.value).toEqual({ kind: "skill-new", name: "quick-skill" });
  });

  test("escape backs out of a prompt, then quits", async () => {
    const { outcome, press, frame } = await mount(consumer);

    await press("RETURN", "ESCAPE");

    expect(outcome.value).toBe("pending");
    expect(frame()).toContain("Add a Collection");

    await press("ESCAPE");

    expect(outcome.value).toBeUndefined();
  });

  test("Quit returns undefined", async () => {
    const { outcome, press } = await mount(consumer);

    await press("j", "j", "j", "j", "j", "j", "RETURN");

    expect(outcome.value).toBeUndefined();
  });

  test("q quits from the menu", async () => {
    const { outcome, press } = await mount(consumer);

    await press("q");

    expect(outcome.value).toBeUndefined();
  });
});
