# TUI flows prototype

Type: prototype
Status: resolved
Blocked by: 02

## Question

How should the TUI look and behave? Build a rough OpenTUI/tuiparts prototype with mock data covering:
- the home screen (bare `scilla`)
- the `add` flow: Traversal progress, then the picker (nesting, recommended/optional pre-ticks, origin and executable-warning badges, detail view of a SKILL.md), then confirm and install
- the `update` flow with **new** skills to opt into
- the minimal Curator screens

React to it to settle the screen list, navigation and key bindings, and the custom components needed.

## Answer

Skipped as a separate prototype: the user asked to build v1 directly (2026-09-22). The flows (picker, home screen) are built in `packages/tui`; see [spec.md](../spec.md).
