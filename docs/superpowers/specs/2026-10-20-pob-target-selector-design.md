# Bridge-backed PoB target selector

> Status: draft for user review. This specification covers the real PoB target list and switching flow, not the full chat or MCP integration.

## Goal

Replace the disabled sample-build button with a selector driven by live PoB bridge sessions. A PoB process that has not registered through the bridge is not shown as connected.

## User-visible behavior

- With no registered PoB, show `PoB` without a dropdown arrow.
- With one registered PoB, show its saved build name, or `PoB` if it has no saved build, without an arrow.
- With two or more registered PoBs, show the selected build name and a dropdown arrow. The menu lists all registered instances.
- When names match, append each PoB process start time to distinguish them.
- Switching targets takes effect only after the selected PoB confirms that its bridge session is live. On failure, keep the current target and show an error.
- A PoB that disconnects is removed from the choices. The selected-PoB shutdown behavior remains as defined in `docs/features/pob-bridge.md`.

## Ownership and data flow

1. Electron main owns the PoB bridge listener, the registered-instance list, and the selected target.
2. Each PoB runs a small Lua bridge client. It registers its PID and active saved-build file path, then reports path changes. The bridge sends no build XML, build contents, calculations, or build name.
3. Electron validates that the process is alive and the supplied saved path is readable. It reads the local saved file to derive the build name; no PoB memory or unsaved state is used.
4. A narrow preload API provides the initial target list, target-change requests, and status/list updates to React. The renderer receives no Node or Electron access.
5. The renderer displays and opens the selector based on the number of live, registered bridge sessions. Selecting an instance asks main to verify it before changing the selected target.

## Local transport

Use a TCP listener bound only to `127.0.0.1`. The Agent chooses an available port and publishes the port plus a random per-user session token in a small bridge configuration file under the user's application-data directory. PoB reads this file and connects with LuaSocket, which is present in the local PoB distribution. Messages use newline-delimited JSON and include an event type, PID, and saved-build path only. The token authenticates the local session; the port is not exposed on external network interfaces.

PoB retries registration while the Agent is unavailable, so starting PoB before or after Agent can produce the same live target list. A closed connection removes that instance. Build-path updates replace only that instance's path and derived label.

## Integration activation

The bridge code is not installed merely by opening Agent. A user-initiated integration action in Settings selects a PoB directory, validates the supported hook point, creates a backup, and applies the small Lua bridge hook. The action reports unsupported or failed installations without claiming a connection. Restoring the backup must be available from the same integration area.

The current PoB copy contains `Launch.lua`, `Modules/Build.lua`, LuaSocket, and `dkjson.lua`. The implementation must validate the actual hook APIs before writing to any PoB directory. Updates may replace the hook and must return the UI to disconnected until re-enabled.

## Boundaries

- Do not infer a connection from process names or open windows.
- The bridge transmits only process identity and saved-build path; the Agent reads the file locally.
- Do not read PoB memory, inspect its UI, or access unsaved build changes.
- Automatic Agent startup, single-instance forwarding, MCP/model readiness, chat streaming, and queue behavior are separate work from this selector slice.
- Do not modify a PoB directory until the user explicitly starts integration in Settings.

## Acceptance criteria

- Zero, one, and multiple live bridge sessions render the specified selector states.
- Multiple registered PoBs can be selected; failed verification leaves the current target selected.
- Duplicate build names are distinguishable by process start time.
- A session disconnect removes its option, and a path update changes only its displayed build name.
- Invalid PID, missing/unreadable path, malformed message, or authentication failure never becomes a connected target.
- Renderer access remains limited to the documented preload API.
- A real supported PoB installation can register, report a saved-build path, and be restored to its original files after integration is removed.

## Decisions still required before implementation

- The supported PoB version and exact hook point/signature. The local distribution is a discovery aid, not a compatibility promise.
- The bridge configuration directory and token-file access policy for Windows.
- Whether Settings supports one PoB directory or multiple installations, and how backup conflicts are presented.
- Actual-PoB integration QA cannot be claimed until a supported PoB version and its connection hook are validated.
