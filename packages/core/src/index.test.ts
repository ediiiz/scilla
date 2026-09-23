import { expect, test } from "bun:test";
import * as core from "./index.ts";

test("the barrel exposes the public API", () => {
  expect(Object.keys(core).toSorted()).toEqual([
    "Fetcher",
    "ManifestError",
    "ScillaError",
    "SourceError",
    "UNAUDITED_REASONS",
    "addReference",
    "applyPlan",
    "auditSkills",
    "checkInstalled",
    "deleteCollection",
    "deleteSkill",
    "envValue",
    "executablesSummary",
    "findCollection",
    "formatSource",
    "fromLockSource",
    "initCollection",
    "manifestJsonSchema",
    "newOwnSkill",
    "parseSource",
    "planInstall",
    "probeSource",
    "readLock",
    "readManifest",
    "restoreLock",
    "traverse",
    "writeManifest",
  ]);
  expect(new core.ManifestError("x")).toBeInstanceOf(core.ScillaError);
  expect(new core.SourceError("x")).toBeInstanceOf(core.ScillaError);
});
