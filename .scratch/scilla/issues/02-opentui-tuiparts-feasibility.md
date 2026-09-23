# OpenTUI and tuiparts feasibility

Type: research
Status: resolved
Blocked by:

## Question

Can we build scilla's TUI on OpenTUI + tuiparts (React) and ship it as `bunx scilla`?
- Runtime constraints: does OpenTUI need Bun, or run under Node? Are there native (Zig) binaries, and how do they install through `bunx` and `npx`?
- The tuiparts **primitives** available for building a scrollable list, multiselect and expandable tree (collection, focus, keyboard, pointer APIs). What does a custom component on them look like?
- OpenTUI React: layout, scrolling, spinner/animation, testing support (snapshot or headless renderer).
- Maturity risks at tuiparts 0.0.6: breaking-change cadence, and whether to vendor recipes.

## Answer

- OpenTUI (now `github.com/anomalyco/opentui`; `sst/opentui` redirects there) runs on Bun >=1.3 or Node >=26.4 (ESM, `node:ffi`, flagged experimental). React has no Node CI lane. Node 24 cannot run it.
- The native Zig core ships prebuilt in 8 optional per-platform packages (`@opentui/core-<os>-<arch>[-musl]`, about 6 MB each). There are no install scripts and no Zig is needed on the user's machine.
- Tested with a probe package: `bunx` follows the bin's shebang. A `#!/usr/bin/env bun` bin works under `bunx`, and under `npx` only if Bun is on PATH. A `node` shebang needs Node 26+.
- tuiparts 0.0.6 has no list, select or tree primitive, and its collection engine is internal. You build on CheckboxGroup (roving focus plus multi-value), RadioGroup, ToggleGroup and Collapsible. There is no indeterminate checkbox, no automatic Tab traversal, and the scrollbox does not follow focus (call `scrollChildIntoView`).
- A tree-multiselect sketch built from CheckboxGroup, Collapsible and scrollbox passed under `testRender` (`@opentui/react/test-utils`, headless, with frame capture for snapshots). OpenTUI has `<scrollbox>`, `<select>` and Timeline, but no spinner.
- Risks: tuiparts peers `@opentui/* ^0.4.3`, which excludes the current 0.5.12. It works, but Bun prints peer warnings. tuiparts ships breaking changes in 0.0.x patch releases and appears to have one maintainer. OpenTUI ships a new minor about every 1–2 months. Recipes are designed to be copied into your project.
- Details: [../research/opentui-tuiparts-feasibility.md](../research/opentui-tuiparts-feasibility.md)
