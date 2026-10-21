# Bridge-backed PoB target selector Implementation Plan

> Status: superseded historical plan. Do not execute this plan; follow [PoB Bridge](../../features/pob-bridge.md) and [PoB-side bridge changes](../../features/pob-bridge-pob-side.md) for current requirements.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disabled sample-build control with a selector backed only by live, authenticated PoB bridge sessions.

**Architecture:** Electron main owns a loopback TCP listener, validated PoB sessions, the selected target, and local build-name derivation. A narrow context-isolated preload API exposes snapshots, selection, and updates to React. A user-initiated Settings flow is the only path that may install or restore PoB integration files.

**Tech Stack:** Electron 44, Node.js built-ins, React 19, TypeScript 7, LuaSocket and the Lua JSON module shipped with the chosen PoB distribution.

**Spec:** `docs/superpowers/specs/2026-10-20-pob-target-selector-design.md`

## Global Constraints

- Bind the bridge listener only to `127.0.0.1`; use newline-delimited JSON and a random per-user session token.
- Bridge messages contain event type, PID, and saved-build file path only; never transmit build XML, contents, calculations, or build name.
- Validate process liveness and readable saved paths; derive the label by reading the local saved file.
- Do not infer connections from process names or windows, read PoB memory, or include unsaved build state.
- Do not modify any PoB directory until the user explicitly starts integration from Settings.
- Do not add dependencies for the bridge; use Node built-ins and libraries included in the supported PoB distribution.
- Keep renderer access behind the existing isolated preload boundary; expose no Node or Electron objects.
- Keep startup forwarding, MCP/model readiness, chat streaming, and queue behavior out of this selector work.

## Review Focus

- Invalid, stale, or reused PID: reject the registration and never label it connected.
- Malformed, oversized, or unauthenticated messages: close/reject without crashing the listener or leaking the token.
- Missing, unreadable, or non-XML saved path: preserve a valid session only when protocol permits, but display `PoB` and never show a stale build label.
- Duplicate build names and rapid disconnect during target switching: disambiguate with process start time and keep the previous selection unless verification succeeds.
- Unsupported PoB version or hook signature mismatch: Settings must report unsupported and leave installation files unchanged.

## Files and Responsibilities

- Modify `src/main/index.ts`: create/stop the bridge service with app/window lifetime and connect IPC handlers.
- Create `src/main/pob-bridge.ts`: listener, message validation, session lifecycle, local path/name validation, and target verification.
- Modify `src/preload/index.ts`: expose typed, narrow snapshot/select/subscribe API through `contextBridge`.
- Modify `src/renderer/src/App.tsx` and `src/renderer/src/styles.css`: render zero/one/many selector states and selection errors while preserving the current UI.
- Create `src/main/pob-integration.ts`: Settings-triggered PoB directory validation, backup/apply/restore guarded by a validated hook signature.
- Modify `src/renderer/src/App.tsx` and `src/renderer/src/styles.css` for the minimal integration controls only if Settings is currently the agreed integration entry point.

## Tasks

### Task 1: Define bridge session protocol and main-process service

**Files:** Create `src/main/pob-bridge.ts`; modify `src/main/index.ts`.

**Interfaces:**

- Export `PobTarget = { pid: number; processStartedAt: number; buildPath: string | null; buildName: string | null }`.
- Export `PobBridgeService` with `start(): Promise<void>`, `stop(): Promise<void>`, `getTargets(): PobTarget[]`, and `selectTarget(pid: number): Promise<PobTarget>`.
- Accept only authenticated `register` and `build-path-changed` JSONL messages with PID and optional path; associate each connection with the OS process start identity and drop it on socket close or process exit.
- Listen on IPv4 loopback with an ephemeral port; store port and cryptographically random token under Electron `app.getPath('userData')`.

- [ ] Inspect current Electron lifecycle and implement the service with bounded line parsing, token comparison, PID liveness/start-time checks, readable `.xml` path validation, and per-socket cleanup.
- [ ] Derive the displayed build name from the saved file's filename (PoB's current local behavior); never accept a name from the bridge.
- [ ] Start the service after app readiness and stop it on app shutdown; ensure a failed listener start leaves the app alive but disconnected.
- [ ] Run `npm run typecheck` and `npm run build`.
- [ ] Commit only `src/main/pob-bridge.ts` and `src/main/index.ts`.

### Task 2: Expose target snapshots and switching through preload/IPC

**Files:** Modify `src/main/index.ts`, `src/preload/index.ts`.

**Interfaces:**

- `window.pobBridge.getTargets(): Promise<PobTarget[]>`
- `window.pobBridge.selectTarget(pid: number): Promise<{ target: PobTarget } | { error: string }>`
- `window.pobBridge.onTargetsChanged(callback: (targets: PobTarget[]) => void): () => void`
- Main verifies the requested session is still live before publishing the selected PID; failed verification does not change the current selection.

- [ ] Add IPC handlers and an event subscription that return structured-clone-safe data only.
- [ ] Validate renderer-supplied PID as a positive integer and remove listeners when unsubscribe is called.
- [ ] Run `npm run typecheck` and `npm run build`.
- [ ] Commit only `src/main/index.ts` and `src/preload/index.ts` changes, staging only this task's hunks if files have other edits.

### Task 3: Implement selector states in the existing chat footer

**Files:** Modify `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`.

**Interfaces:** Consume only `window.pobBridge` from Task 2.

- [ ] Replace the disabled sample-build control with `PoB` for zero targets, build name (or `PoB`) for one target, and selected name plus dropdown for multiple targets.
- [ ] Show all sessions in the menu; when build names collide, include process start time in the label.
- [ ] On selection, show a visible error and retain the current target if main rejects the switch; remove disconnected sessions from the menu through update events.
- [ ] Preserve current layout, existing SVG send icon, and unrelated working-tree edits.
- [ ] Run `npm run typecheck` and `npm run build`; manually inspect zero, one, multiple, duplicate-name, disconnect, and failed-switch states using a local protocol client without modifying a PoB installation.
- [ ] Commit only this task's `App.tsx` and `styles.css` hunks.

### Task 4: Add explicit Settings integration apply/restore flow

**Files:** Create `src/main/pob-integration.ts`; modify `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` only as needed.

**Interfaces:** Add `window.pobBridge.install(directory: string)` and `window.pobBridge.restore(directory: string)` returning a structured success/error result. The main process owns the native directory picker and must not trust an arbitrary renderer path.

- [ ] First validate the supported PoB version and exact hook signature against a user-selected installation; if unsupported or unknown, return an explanatory error without writing files.
- [ ] On explicit user action only, create a recoverable backup, apply the smallest Lua hook, and provide restore from the same Settings area.
- [ ] Ensure apply/restore failures preserve original files and report the affected path and recovery state.
- [ ] Do not run installation against `.pob` or any other PoB directory during development validation.
- [ ] Run `npm run typecheck` and `npm run build`; manually inspect unsupported-version and Settings action states.
- [ ] Commit only this task's files/hunks.

## Validation and Handoff

- Run `npm run typecheck`, `npm run build`, and `git diff --check` after the relevant tasks.
- Restart the desktop app after UI changes, per the user's standing instruction, and inspect the running window.
- Actual-PoB registration and backup restoration remain unverified until a supported PoB version and hook are validated and the user explicitly invokes integration.
- Do not add or run an automated test suite unless the user requests it.
