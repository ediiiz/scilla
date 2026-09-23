import type { Lock } from "@scilla/core";

export interface HomeContext {
  /** `scilla-lock.json` of the cwd. */
  readonly project: Lock;
  /** `~/.agents/scilla-lock.json`. */
  readonly global: Lock;
  /** Whether the cwd holds a `scilla.json`, which turns on the Curator actions. */
  readonly isCollection: boolean;
  /** That manifest's `name`, when `isCollection`. */
  readonly collectionName?: string | undefined;
}

/** What the Consumer or Curator chose on the home screen; the CLI executes it. */
export type HomeAction =
  | { readonly kind: "add"; readonly source: string }
  /** `collection` is a lock key; undefined updates every Collection in that scope. */
  | { readonly kind: "update"; readonly collection: string | undefined; readonly global: boolean }
  | { readonly kind: "delete"; readonly collection: string; readonly global: boolean }
  | { readonly kind: "init"; readonly name: string; readonly description: string }
  | { readonly kind: "ref-add"; readonly source: string }
  | { readonly kind: "skill-new"; readonly name: string }
  | { readonly kind: "check" };

export interface InstalledCollection {
  /** The Collection's key in its lock (its source). */
  readonly key: string;
  readonly name: string;
  readonly skills: number;
  readonly global: boolean;
}

export interface PromptSpec {
  readonly label: string;
  readonly placeholder: string;
  /** Whether an empty answer is accepted. */
  readonly optional: boolean;
}

export type PickPurpose = "update" | "delete";

export type MenuEffect =
  | { readonly kind: "done"; readonly action: HomeAction | undefined }
  | { readonly kind: "pick"; readonly purpose: PickPurpose }
  | {
      readonly kind: "prompt";
      readonly prompts: readonly PromptSpec[];
      readonly build: (answers: readonly string[]) => HomeAction;
    };

export interface MenuItem {
  readonly label: string;
  readonly description: string;
  readonly effect: MenuEffect;
}

export type HomeStep =
  | { readonly kind: "menu" }
  | { readonly kind: "pick"; readonly purpose: PickPurpose }
  | {
      readonly kind: "prompt";
      readonly effect: Extract<MenuEffect, { kind: "prompt" }>;
      readonly answers: readonly string[];
    };

/** What a step transition produced: the next step, or the finished result. */
export type HomeTransition =
  | { readonly kind: "step"; readonly step: HomeStep }
  | { readonly kind: "done"; readonly action: HomeAction | undefined };

const entries = (lock: Lock, global: boolean): InstalledCollection[] =>
  Object.entries(lock.collections)
    .map(([key, entry]) => ({ key, name: entry.name, skills: entry.selected.length, global }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

export const installedCollections = (context: HomeContext) => [
  ...entries(context.project, false),
  ...entries(context.global, true),
];

const SOURCE_PLACEHOLDER = "owner/repo, a git URL, or ./local/dir";

const ask = (label: string, placeholder: string, optional = false): PromptSpec => ({
  label,
  placeholder,
  optional,
});

const prompt = (
  prompts: readonly PromptSpec[],
  build: (answers: readonly string[]) => HomeAction,
): MenuEffect => ({
  kind: "prompt",
  prompts,
  build,
});

const updateAll = (context: HomeContext): MenuItem[] => {
  const items: MenuItem[] = [];

  if (Object.keys(context.project.collections).length > 0) {
    items.push({
      label: "Update all",
      description: "Re-traverse every Collection installed in this project",
      effect: { kind: "done", action: { kind: "update", collection: undefined, global: false } },
    });
  }

  if (Object.keys(context.global.collections).length > 0) {
    items.push({
      label: "Update all global",
      description: "Re-traverse every Collection installed in your home directory",
      effect: { kind: "done", action: { kind: "update", collection: undefined, global: true } },
    });
  }

  return items;
};

const consumerItems = (context: HomeContext): MenuItem[] => {
  const hasInstalled = installedCollections(context).length > 0;

  const perCollection: MenuItem[] = [
    {
      label: "Update one",
      description: "Pick a Collection to update",
      effect: { kind: "pick", purpose: "update" },
    },
    {
      label: "Remove a Collection",
      description: "Pick a Collection to remove",
      effect: { kind: "pick", purpose: "delete" },
    },
  ];

  return [
    {
      label: "Add a Collection",
      description: "Install skills from a Collection",
      effect: prompt([ask("Collection source", SOURCE_PLACEHOLDER)], ([source = ""]) => ({
        kind: "add",
        source,
      })),
    },
    ...updateAll(context),
    ...(hasInstalled ? perCollection : []),
  ];
};

const curatorItems = (context: HomeContext): MenuItem[] =>
  context.isCollection
    ? [
        {
          label: "Add a Reference",
          description: "Point this Collection at skills in another repo",
          effect: prompt([ask("Reference source", SOURCE_PLACEHOLDER)], ([source = ""]) => ({
            kind: "ref-add",
            source,
          })),
        },
        {
          label: "New Own Skill",
          description: "Scaffold skills/<name>/SKILL.md",
          effect: prompt([ask("Skill name", "my-skill")], ([name = ""]) => ({
            kind: "skill-new",
            name,
          })),
        },
        {
          label: "Check this Collection",
          description: "Traverse it and show the tree, warnings and collisions",
          effect: { kind: "done", action: { kind: "check" } },
        },
      ]
    : [
        {
          label: "Create a Collection here",
          description: "Write a scilla.json in this directory",
          effect: prompt(
            [
              ask("Collection name", "my-skills"),
              ask("Description", "What these skills are for", true),
            ],
            ([name = "", description = ""]) => ({ kind: "init", name, description }),
          ),
        },
      ];

/** The home menu for this context: Consumer actions, Curator actions, then Quit. */
export const menuItems = (context: HomeContext): MenuItem[] => [
  ...consumerItems(context),
  ...curatorItems(context),
  { label: "Quit", description: "", effect: { kind: "done", action: undefined } },
];

export const chooseItem = (item: MenuItem): HomeTransition => {
  switch (item.effect.kind) {
    case "done": {
      return { kind: "done", action: item.effect.action };
    }

    case "pick": {
      return { kind: "step", step: { kind: "pick", purpose: item.effect.purpose } };
    }

    default: {
      return { kind: "step", step: { kind: "prompt", effect: item.effect, answers: [] } };
    }
  }
};

export const pickCollection = (
  purpose: PickPurpose,
  collection: InstalledCollection,
): HomeAction =>
  purpose === "update"
    ? { kind: "update", collection: collection.key, global: collection.global }
    : { kind: "delete", collection: collection.key, global: collection.global };

/** Record one prompt answer; an empty answer to a required prompt keeps asking. */
export const answerPrompt = (
  step: Extract<HomeStep, { kind: "prompt" }>,
  raw: string,
): HomeTransition => {
  const answer = raw.trim();
  const spec = step.effect.prompts[step.answers.length];

  if (spec === undefined || (answer === "" && !spec.optional)) {
    return { kind: "step", step };
  }

  const answers = [...step.answers, answer];

  return answers.length === step.effect.prompts.length
    ? { kind: "done", action: step.effect.build(answers) }
    : { kind: "step", step: { ...step, answers } };
};

/** What a key does in a choice list on top of the RadioGroup's own arrows and Home/End. */
export type ChoiceKey =
  | { readonly kind: "move"; readonly index: number }
  | { readonly kind: "choose" };

export const choiceKey = (name: string, cursor: number, count: number): ChoiceKey | undefined => {
  if (name === "return" || name === "enter") {
    return { kind: "choose" };
  }

  if (name !== "j" && name !== "k") {
    return undefined;
  }

  const index = cursor + (name === "j" ? 1 : -1);

  return index >= 0 && index < count ? { kind: "move", index } : undefined;
};
