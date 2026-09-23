import type {
  Choice,
  ChoiceStatus,
  CollectionEntry,
  Lock,
  Plan,
  ResolvedSkill,
} from "@scilla/core";

export interface SkillFixture {
  readonly name: string;
  readonly status?: ChoiceStatus;
  readonly selected?: boolean;
  readonly optional?: boolean;
  readonly via?: readonly string[];
  readonly executables?: readonly string[];
  readonly note?: string;
  readonly description?: string;
  /** The skill folder on disk; defaults to a path that doesn't exist. */
  readonly dir?: string;
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

export const skill = (fixture: SkillFixture): ResolvedSkill => ({
  name: fixture.name,
  description: fixture.description ?? `Does ${fixture.name} things.`,
  kind: "github",
  url: "https://github.com/acme/skills.git",
  path: `skills/${fixture.name}`,
  commit: COMMIT,
  dir: fixture.dir ?? `/tmp/checkouts/${fixture.name}`,
  optional: fixture.optional ?? false,
  executables: fixture.executables ?? [],
  via: fixture.via ?? [],
  reference: fixture.via?.[0],
});

export const choice = (fixture: SkillFixture): Choice => ({
  skill: skill(fixture),
  status: fixture.status ?? "available",
  selected: fixture.selected ?? false,
  note: fixture.note,
});

export const plan = (
  fixtures: readonly SkillFixture[],
  warnings: readonly string[] = [],
  removed: readonly string[] = [],
): Plan => ({
  key: "acme/skills",
  removed,
  choices: fixtures.map(choice),
  traversal: {
    name: "Acme Skills",
    description: "Skills for building rockets.",
    source: {
      kind: "github",
      url: "https://github.com/acme/skills.git",
      path: "",
      ref: undefined,
      skill: undefined,
    },
    commit: COMMIT,
    skills: fixtures.map(skill),
    warnings,
  },
});

export const collection = (name: string, selected: readonly string[]): CollectionEntry => ({
  name,
  source: { kind: "github", url: `https://github.com/acme/${name}.git`, path: "" },
  commit: COMMIT,
  selected: [...selected],
  declined: [],
});

export const lock = (collections: Readonly<Record<string, CollectionEntry>> = {}): Lock => ({
  version: 1,
  collections: { ...collections },
  skills: {},
});
