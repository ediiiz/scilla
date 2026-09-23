# OpenTUI and tuiparts feasibility

Research for [issue 02](../issues/02-opentui-tuiparts-feasibility.md). Checked on 2026-09-22 against the npm registry, the two source repos (shallow clones at `main`), the OpenTUI docs sources in `packages/web/src/content/docs/`, and local experiments on Linux x64 with Bun 1.4.2, Node 24.15.0 and Node 26.10.0. This file states facts and risks only. It makes no stack decision.

## Sources

- OpenTUI: https://opentui.com, repo https://github.com/anomalyco/opentui. `github.com/sst/opentui` now redirects there (HTTP 301 to `anomalyco/opentui`). The npm `repository.url` of `@opentui/*` also points at `anomalyco/opentui`.
- OpenTUI docs used here (sources in the repo; the same pages are on opentui.com/docs):
  - Runtime support: `packages/web/src/content/docs/getting-started/runtime-support.mdx` (https://opentui.com/docs/getting-started/runtime-support)
  - Deploy: `ship/deploy.mdx` (https://opentui.com/docs/ship/deploy)
  - Testing: `core-concepts/testing.mdx` (https://opentui.com/docs/core-concepts/testing)
  - React bindings: `bindings/react.mdx` (https://opentui.com/docs/bindings/react)
  - Components: `components/overview.mdx`, `components/scrollbox.mdx`, `components/select.mdx`
  - Focus: `core-concepts/interaction.mdx`
  - Animation: `application-apis/animation.mdx`
- tuiparts: https://tuiparts.sh, repo https://github.com/tuiparts/tuiparts. Files used: `PRIMITIVES_AND_RECIPES.md`, `docs/primitives-and-recipes.md`, `packages/core/src/**`, `packages/react/src/**`, `registry/**`, `registry/README.md`, `packages/react/CHANGELOG.md`, `pnpm-workspace.yaml`, `docs/adr/0004-stable-foundation-releases.md`.
- npm: `npm view` and `npm pack` of `@opentui/core`, `@opentui/react`, `@opentui/core-linux-x64`, `@tuiparts/core`, `@tuiparts/react`, `opentui-spinner`.

## Versions on 2026-09-22

| Package | Latest | Notes |
| --- | --- | --- |
| `@opentui/core` | 0.5.12 (published 2026-09-22) | 148 stable releases. Minor lines: 0.2 on 2026-04-28, 0.3 on 05-28, 0.4 on 06-09, 0.5 on 08-03. Patch releases every few days. |
| `@opentui/react` | 0.5.12 | Depends on `@opentui/core` 0.5.12 exactly and on `react-reconciler ^0.33`. Peer `react >=19.2.0`. |
| `@tuiparts/core`, `@tuiparts/react` | 0.0.6 (2026-08-05) | Six releases between 2026-07-16 and 2026-08-05. Last repo commit 2026-09-02. Author on npm: Matt Simpson (`msmps`). |

## 1. Runtime constraints

### Bun or Node?

Both are supported, with different floors (runtime-support.mdx, "Runtime versions"):

| Runtime | Requirement |
| --- | --- |
| Bun | 1.3.0 or later (1.4.0+ on Windows arm64) |
| Node.js | 26.4.0 or later, ESM only, `--experimental-ffi` |

`@opentui/core`'s `package.json` has `"engines": { "bun": ">=1.3.0", "node": ">=26.4.0" }`. Its exports map has separate `bun` and `node` conditions (`index.bun.js` and `index.node.js`). Native calls go through `src/platform/ffi.ts`, which uses `bun:ffi` on Bun and `node:ffi` on Node. `require("@opentui/core")` from CommonJS fails with `ERR_REQUIRE_ASYNC_MODULE`.

What I saw locally:

- **Node 24.15.0** (the default `node` on this machine) accepts no `--experimental-ffi` flag (`bad option`). Without it, `createTestRenderer()` throws `Failed to initialize OpenTUI render library: OpenTUI native FFI is not available for this runtime yet`.
- **Node 26.10.0** rendered a frame both with and without the flag. `node --help` on 26.10 lists `--no-experimental-ffi`, so `node:ffi` is on by default there but still prints `ExperimentalWarning: FFI is an experimental feature`. The OpenTUI docs still say to pass the flag. I did not find out which 26.x release turned it on by default.
- **Bun 1.4.2** works with no flags.

Caveats in the docs:

- "React has no Node.js CI lane, so the repository does not establish the same Node.js confidence for React that it establishes for Core and Solid." Node native, packed and SEA acceptance runs **on Linux x64 only**. Bun Core tests run on macOS arm64, Linux x64 and Windows x64.
- The Bun-only surfaces are `@opentui/three`, `@opentui/core/runtime-plugin` and the runtime-plugin-support entry points. Scilla needs none of them.

### Native binaries

- The core is written in Zig. It ships as eight prebuilt shared libraries in optional platform packages: `@opentui/core-{darwin-x64,darwin-arm64,linux-x64,linux-arm64,linux-x64-musl,linux-arm64-musl,win32-x64,win32-arm64}`. Each package sets `os` and `cpu`, the musl packages also set `libc: musl`, and they carry no install scripts. For example `@opentui/core-linux-x64` ships `libopentui.so` (6.3 MB unpacked) plus `index.js` and `index.bun.js`, which export the library path.
- Nothing compiles at install time and Zig is not needed on the user's machine. The docs say the Linux libc is chosen from `OPENTUI_LIBC` (unset or `glibc` gives the plain package, `musl` gives `-musl`), and this must be set before the first Core import. Alpine can also need `apk add libstdc++ libgcc`.
- If optional dependencies are omitted (for example `--omit=optional`), the JS still loads and the first native call fails. The docs mention this under "Native artifacts".
- Size: `@opentui/core` is 14 MB unpacked (it includes tree-sitter assets) plus about 6 MB per native package.

### Running through `bunx` and `npx`

I tested this with a throwaway package `scilla-probe` that depends on `@opentui/core@0.5.12`. Its bin renders one frame with `createTestRenderer()`. I ran it from a local tarball.

| Launcher | Bin shebang | Result |
| --- | --- | --- |
| `bunx --package file:<tgz> scilla-probe` | `#!/usr/bin/env node` | **Fails**: bunx follows the shebang and runs Node 24, which has no FFI. |
| `bunx --bun --package ...` | `#!/usr/bin/env node` | Works (forces Bun). |
| `bunx --package ...` | `#!/usr/bin/env bun` | Works. |
| `npx --package=<tgz> scilla-probe` (npm 11.12, Node 24) | `#!/usr/bin/env bun` | Works **only if `bun` is on PATH**. With Bun removed from PATH it fails with `env: 'bun': No such file or directory` and an `EBADENGINE` warning. |
| `npx` (npm 11.19, Node 26.10) | `#!/usr/bin/env node` | Works, with `ExperimentalWarning: FFI ...` on stderr. |

Other things I saw:

- `bunx` installs into `/tmp/bunx-<uid>-<pkg>@<ver>/`. On linux-x64 it installed **both** `core-linux-x64` and `core-linux-x64-musl`, so Bun seems not to filter on `libc`. That costs about 6 MB extra and is harmless. `npx` installed only the glibc package.
- For `bunx scilla` to work, the bin needs `#!/usr/bin/env bun`, or Bun users have to type `bunx --bun`. With that shebang, `npx scilla` needs Bun installed. The other option is a Node shebang that requires Node 26.4+ and possibly `--experimental-ffi` (for example `#!/usr/bin/env -S node --experimental-ffi`; I did not test this form).
- Option not tested here: `bun build --compile` produces one executable per OS, arch and libc, with the native library and assets embedded (deploy.mdx, "Build Bun executables"). That would remove the runtime requirement, but you would have to ship separate binaries.

## 2. tuiparts primitives for list, multiselect and tree

### What exists

The public subpaths are the same in `@tuiparts/core` and `@tuiparts/react` 0.0.6: `accordion`, `button`, `checkbox`, `checkbox-group`, `collapsible`, `dialog`, `input`, `number-field`, `radio`, `radio-group`, `slider`, `switch`, `tabs`, `textarea`, `toggle`, `toggle-group`. There is **no list, listbox, select, menu, combobox, tree or virtualized-collection primitive**, and I found none on a roadmap in the repo.

The general "collection" engine (`RovingCollectionStore`/`RovingCollectionRenderable` in `packages/core/src/internal/roving-collection.ts`) is **internal**. The 0.0.4 changelog says: "Low-level collection registration and navigation types remain internal rather than becoming part of the public package interface." You can only reach it through the concrete group primitives:

| Primitive (React shape) | State | Keys and pointer | Useful for |
| --- | --- | --- | --- |
| `CheckboxGroup` + `Checkbox.Root`/`.Indicator` | `value: string[]`, `disabled`, `orientation`, `loopFocus`; each item has `checked`, `focused`, `disabled`, `tabbable` | Up/Down (or Left/Right) and Home/End move roving focus without toggling. Enter/Return/Space and primary-button release toggle. | Multiselect |
| `RadioGroup` + `Radio.Root`/`.Indicator` | single `value`, availability | arrows and Home/End select; skips unavailable items | Single-select list |
| `ToggleGroup` + `Toggle` | `value: string[]`, `multiple` flag | as above | Single or multi selection |
| `Collapsible.Root`/`.Trigger`/`.Panel` | `open`, `disabled`, Trigger `focused` | Trigger press toggles. React unmounts a closed Panel unless `keepMounted`. | Tree node expand/collapse |
| `Accordion.*` | `value[]`, single or multiple | Up/Down/Home/End between Triggers | Grouped expanders |

Source: the "Primitive reference" table in `docs/primitives-and-recipes.md` and the option types in `packages/core/src/checkbox-group/primitive.ts` (`defaultValue`, `value`, `onValueChange`, `orientation`, `loopFocus`, `disabled`).

Gaps that matter for scilla:

- **No tri-state (indeterminate) checkbox.** A "select all skills in this repo" parent row has to be built as a plain `Button` or `Checkbox` whose checked state the app computes. Neither `packages/` nor the docs mention "indeterminate".
- **No automatic Tab traversal.** "OpenTUI Core has no automatic Tab traversal or focus-order property. Your application must choose the next renderable and call `focus()`" (interaction.mdx). In my test, `pressTab()` did nothing. You get into a group with `groupRef.current.store.focusTabStop()` or `ref.focus()`.
- **Focus does not scroll the viewport.** A `<scrollbox>` does not follow a focused child. The app has to call `scrollbox.scrollChildIntoView(id)` (scrollbox.mdx, "scrollChildIntoView").
- **No virtualization in tuiparts.** OpenTUI's ScrollBox has `viewportCulling` (on by default), which skips rendering offscreen children. Every item is still mounted and registered with the group.

OpenTUI also has its own components that need no tuiparts: `<select>` (`SelectRenderable`, a single-select vertical list with descriptions and keyboard handling), `<tab-select>`, `<scrollbox>`, `<input>`, `<textarea>`, `<markdown>`, `<diff>` and `<code>`. There is **no spinner component**. You can animate with `Timeline`/`useTimeline()` or a timer. The community package `opentui-spinner` (0.0.7, by msmps) exists but its peers are `@opentui/* ^0.3.4`, which is out of date.

### What a custom component looks like (tested)

I built this tree multiselect sketch and ran it with `bun test` against `@opentui/core@0.5.12`, `@opentui/react@0.5.12` and `@tuiparts/react@0.0.6`. It passed: the item was checked with Space, arrow focus crossed from one Collapsible panel into the next, and the scrollbox followed the focused row.

```tsx
import type { ScrollBoxRenderable } from "@opentui/core"
import type { CheckboxGroupRenderable } from "@tuiparts/core/checkbox-group"
import { Checkbox } from "@tuiparts/react/checkbox"
import { CheckboxGroup } from "@tuiparts/react/checkbox-group"
import { Collapsible } from "@tuiparts/react/collapsible"
import { useEffect, useRef } from "react"

type Node = { repo: string; skills: string[] }

function SkillRow({ value, scroll }: { value: string; scroll: () => ScrollBoxRenderable | null }) {
  return (
    <Checkbox.Root id={value} value={value} flexDirection="row" gap={1}>
      {(s) => (
        <>
          <FollowFocus focused={s.focused} reveal={() => scroll()?.scrollChildIntoView(value)} />
          <text content={s.checked ? "[x]" : "[ ]"} />
          <text content={value} fg={s.focused ? "cyan" : undefined} />
        </>
      )}
    </Checkbox.Root>
  )
}

function FollowFocus({ focused, reveal }: { focused: boolean; reveal: () => void }) {
  useEffect(() => { if (focused) reveal() }, [focused])
  return null
}

export function SkillTree({ tree, onChange }: { tree: Node[]; onChange: (v: readonly string[]) => void }) {
  const scroll = useRef<ScrollBoxRenderable>(null)
  const group = useRef<CheckboxGroupRenderable>(null)
  useEffect(() => { group.current?.store.focusTabStop() }, []) // no automatic Tab traversal
  return (
    <scrollbox ref={scroll} height={12}>
      <CheckboxGroup ref={group} onValueChange={(v) => onChange(v)} flexDirection="column">
        {tree.map((n) => (
          <Collapsible.Root key={n.repo} defaultOpen flexDirection="column">
            <Collapsible.Trigger>
              {(s) => <text content={`${s.open ? "▾" : "▸"} ${n.repo}`} />}
            </Collapsible.Trigger>
            <Collapsible.Panel paddingLeft={2} flexDirection="column">
              {n.skills.map((k) => <SkillRow key={k} value={`${n.repo}:${k}`} scroll={() => scroll.current} />)}
            </Collapsible.Panel>
          </Collapsible.Root>
        ))}
      </CheckboxGroup>
    </scrollbox>
  )
}
```

What the sketch showed:

- Up/Down roving focus goes through every `Checkbox.Root` in rendered order, including rows in different Collapsible panels. Collapsible Triggers are **not** in that roving set. They are separate focus stops that the app must reach itself, for example with Left/Right handled by `useKeyboard`.
- A closed Panel unmounts its rows by default, and they unregister from the group. The group's `value` array is kept, since it is state owned by the group.
- A true tree with arrow-key expand/collapse on one roving set (WAI-ARIA tree style) is not possible with the public primitives. Two ways to get close: (a) the sketch above plus app-level key handling, or (b) a flat list of visible rows where the app owns expansion state and each parent row is a Checkbox or Toggle.

## 3. OpenTUI React: layout, scrolling, animation, testing

- **Layout**: Yoga flexbox props on intrinsic elements, for example `<box flexDirection="column" gap={1} padding={2}>` or the `style={{...}}` prop. Intrinsic elements are kebab-case (`<tab-select>`, `<ascii-font>`). Custom Renderables are registered with `extend({ tag: Class })`, which is how tuiparts does it (`extend({ "otui-checkbox-group": CheckboxGroupRenderable })`). tsconfig needs `"jsxImportSource": "@opentui/react"` (react.mdx).
- **Hooks**: `useKeyboard`, `useRenderer`, `useTerminalDimensions`, `useOnResize`, `usePaste`, `useFocus`/`useBlur`, `useSelectionHandler`, `useTimeline`.
- **Scrolling**: `<scrollbox>` with `stickyScroll`/`stickyStart` (useful for a log pane), `viewportCulling`, `scrollBy`, `scrollTo`, `scrollChildIntoView`, and keyboard scrolling when focused (arrows, PgUp/PgDn, Home/End).
- **Animation**: `Timeline` or `useTimeline()`, which animate numeric properties in step with renderer frames. There is no built-in spinner.
- **Testing**: `@opentui/core/testing` → `createTestRenderer({ width, height })` gives a real `CliRenderer` with in-memory native output and no TTY. It provides `mockInput` (`typeText`, `pressKey`, `pressArrow`, `pressTab`…), `mockMouse`, `renderOnce()`, `waitForFrame(pred)`, `captureCharFrame()` (plain text, suitable for snapshots) and `captureSpans()` (styled). For React, `@opentui/react/test-utils` → `testRender(<App />, opts)` (react.mdx "Testing"). I used this for the sketch. It works under `bun test`. React prints "not wrapped in act(...)" warnings for state updates triggered by input. They are noise, not failures, and wrapping the input calls in `act` would probably silence them.

## 4. Maturity risks

- **Peer range already out of date.** `@tuiparts/core@0.0.6` and `@tuiparts/react@0.0.6` declare `@opentui/core ^0.4.3` (and `@opentui/react ^0.4.3`). Under semver 0.x rules that means `>=0.4.3 <0.5.0`, so the current OpenTUI 0.5.12 is outside it. `bun add` prints `warn: incorrect peer dependency "@opentui/core@0.5.12"` and installs anyway. My tests passed on 0.5.12. On `main`, the tuiparts `catalog:` still pins `^0.4.3`, while only the Dialog companion has moved to `>=0.4.3 <0.6.0` (`pnpm-workspace.yaml`). npm with strict peer deps, or a future breaking OpenTUI minor, could break an install.
- **OpenTUI changes quickly.** There have been four minor lines in about five months and patches every few days. `@opentui/react` pins `@opentui/core` exactly. Node support is new and still flagged as experimental.
- **tuiparts breaks things in patch releases.** ADR-0004 keeps the Foundation on a "patch line", so every release so far has been 0.0.x. 0.0.2 removed `getState()` from Stores, and 0.0.4 changed Checkbox store internals and the callback payloads. With a `^0.0.6` range npm resolves only 0.0.6 exactly, so upgrades are always manual. All six releases came in three weeks (July to August 2026), and there has been none since 2026-08-05. The project appears to have one maintainer.
- **Recipes are copied into your project by design.** `shadcn add` copies the recipe plus a theme (`use-theme`, tokens) into `components/ui`. Updates go through `shadcn add <item> --diff` and a manual merge, and `--overwrite` is discouraged (`registry/README.md`, "Discover And Review Updates"). Keeping recipes in your own tree is the intended model. Primitives stay npm dependencies. They could be copied into the project too (MIT licence), but they import from `@opentui/core` internals such as `BoxRenderable` and `RenderContext`, so a copy would be tied to OpenTUI versions in the same way.
- **The platform matrix is not fully tested.** Eight native targets are published, but the docs say "An available artifact does not prove runtime parity on every published target."

## Open questions not resolved here

- In which Node 26.x release did `node:ffi` become on by default? And does `@opentui/react` work reliably on Node, given there is no CI lane for it?
- Does `npx` on older npm versions honour the `libc` field? npm 11.12 did.
- Does a real TTY session (`createCliRenderer`, not the test renderer) through `bunx` behave the same on macOS and Windows? I only tested Linux x64.
