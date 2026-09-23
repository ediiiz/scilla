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

/** Copy a child's output stream to ours as it arrives, and keep the text. */
const tee = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream) => {
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  await stream.pipeTo(
    new WritableStream({
      write(chunk) {
        sink.write(chunk);
        chunks.push(decoder.decode(chunk, { stream: true }));
      },
    }),
  );

  return chunks.join("");
};

/** Run a command with its output streamed through; resolves with its exit code and that output. */
const run = async (cmd: readonly string[], cwd: string) => {
  const child = Bun.spawn([...cmd], { cwd, stdin: "inherit", stdout: "pipe", stderr: "pipe" });

  const [stdout, stderr] = await Promise.all([
    tee(child.stdout, process.stdout),
    tee(child.stderr, process.stderr),
  ]);

  return { exitCode: await child.exited, output: `${stdout}${stderr}` };
};

const must = async (cmd: readonly string[], cwd: string) => {
  const { exitCode } = await run(cmd, cwd);

  if (exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited with ${exitCode}`);
  }
};

const nothingToPublish = () => {
  process.stdout.write(`${spec} is already on npm; nothing to publish.\n`);
  process.exit(0);
};

// npm's answer when the version is on the registry already, which `npm view` can miss for a
// minute after a publish because of registry lag.
const ALREADY_PUBLISHED = /E409|cannot publish over/i;

if (version.includes("-") !== (values.tag !== "latest")) {
  throw new Error(
    values.tag === "latest"
      ? `${spec} is a prerelease; publish it with --tag next`
      : `${spec} is not a prerelease, so there is nothing for --tag ${values.tag} (no pending changesets?)`,
  );
}

const view = Bun.spawnSync(["npm", "view", spec, "version", "--prefer-online"], {
  cwd: packageDir,
});

const stderr = view.stderr.toString();

if (view.exitCode === 0 && view.stdout.toString().trim() === version) {
  nothingToPublish();
}

if (view.exitCode !== 0 && !stderr.includes("E404")) {
  throw new Error(`npm view ${spec} failed:\n${stderr}`);
}

await must(["bun", "run", "verify"], join(packageDir, "..", ".."));

const published = await run(
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

if (published.exitCode !== 0) {
  if (!ALREADY_PUBLISHED.test(published.output)) {
    throw new Error(`npm publish exited with ${published.exitCode}`);
  }

  nothingToPublish();
}

if (output !== undefined && values.tag === "latest" && !values["dry-run"]) {
  appendFileSync(output, `${JSON.stringify({ type: "git-tag", tag: spec, packageName: name })}\n`);
}
