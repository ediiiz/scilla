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
    "changesSkills",
    "checkInstalled",
    "compareInstalled",
    "compareTraversals",
    "deleteCollection",
    "deleteSkill",
    "diffSkill",
    "envValue",
    "executablesSummary",
    "findCollection",
    "formatSource",
    "fromLockSource",
    "initCollection",
    "lockedSkillDir",
    "manifestJsonSchema",
    "newOwnSkill",
    "parseSource",
    "planInstall",
    "probeSource",
    "readLock",
    "readManifest",
    "restoreLock",
    "riskyFiles",
    "traverse",
    "writeManifest",
  ]);
  expect(new core.ManifestError("x")).toBeInstanceOf(core.ScillaError);
  expect(new core.SourceError("x")).toBeInstanceOf(core.ScillaError);
});
