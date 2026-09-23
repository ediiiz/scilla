// Release step, run from CI (see docs/releasing.md): publish this version of scilla-cli to npm
// unless it is already there, so re-running it on every push to main is harmless.
//   bun scripts/release.ts                 stable release to `latest` (from changesets/action)
//   bun scripts/release.ts --tag next      prerelease; the version must already be a prerelease
//   add --dry-run to go through the motions without uploading
// Publishing goes through npm, not `bun publish`: npm does trusted publishing (OIDC) and provenance.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };

const { values } = parseArgs({
  options: {
    tag: { type: "string", default: "latest" },
    "dry-run": { type: "boolean", default: false },
  },
});

const { name, version } = packageJson;

const spec = `${name}@${version}`;

const packageDir = join(import.meta.dir, "..");

// changesets/action reads git-tag events from this file to push the tag and create the GitHub
// release. It warns when the file is missing, so it always exists, empty when nothing was published.
const output = process.env["CHANGESETS_OUTPUT"];

if (output !== undefined) {
  appendFileSync(output, "");
}

const run = (cmd: readonly string[], cwd: string) => {
  const { exitCode } = Bun.spawnSync([...cmd], { cwd, stdio: ["inherit", "inherit", "inherit"] });

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited with ${exitCode}`);
  }
};

if (version.includes("-") !== (values.tag !== "latest")) {
  throw new Error(
    values.tag === "latest"
      ? `${spec} is a prerelease; publish it with --tag next`
      : `${spec} is not a prerelease, so there is nothing for --tag ${values.tag} (no pending changesets?)`,
  );
}

const view = Bun.spawnSync(["npm", "view", spec, "version"], { cwd: packageDir });

const stderr = view.stderr.toString();

if (view.exitCode === 0 && view.stdout.toString().trim() === version) {
  process.stdout.write(`${spec} is already on npm; nothing to publish.\n`);
  process.exit(0);
}

if (view.exitCode !== 0 && !stderr.includes("E404")) {
  throw new Error(`npm view ${spec} failed:\n${stderr}`);
}

run(["bun", "run", "verify"], join(packageDir, "..", ".."));

run(
  [
    "npm",
    "publish",
    "--provenance",
    "--access",
    "public",
    "--tag",
    values.tag,
    ...(values["dry-run"] ? ["--dry-run"] : []),
  ],
  packageDir,
);

if (output !== undefined && values.tag === "latest" && !values["dry-run"]) {
  appendFileSync(output, `${JSON.stringify({ type: "git-tag", tag: spec, packageName: name })}\n`);
}
