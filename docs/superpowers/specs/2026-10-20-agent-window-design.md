# Agent Window Implementation Design

## Goal

Build the first runnable PoB Agent desktop application as a separate Electron window. The browser mockup is a visual reference only; the delivered app uses Electron, React, TypeScript, and Vite.

## Scope

- Create the Electron main/preload and React renderer app structure needed to launch one resizable 960×720 window.
- Reproduce the supplied dark chat layout: PoB Agent header and connection badge, central message area, bottom prompt composer with circular send button, PoB/build selector at lower left, and settings entry at lower right.
- Provide the empty settings screen described by `docs/features/agent-window.md`.
- Keep chat and UI state in memory. Do not persist the conversation or window size.
- Use only the narrow preload surface the renderer needs. Do not expose Node or Electron APIs to the renderer.

## Initial Preview State

The supplied screenshot shows a connected PoB, a sample build, and an example exchange. Those values are preview content, not live integration data. The first runnable UI may use that sample to match the approved visual reference, but the UI must make it clear in code that it is fixture content and must not present it as a calculation result. The composer, selector, and settings entry can render, but actions that require the missing integrations must not claim success.

When the app is connected to real PoB/MCP/model services later, their actual state will replace preview content through the agreed bridge. Until then, no model or MCP call, PoB process discovery, build-file access, or IPC protocol is implemented.

## Architecture

- Electron main owns app/window lifecycle and creates the renderer window.
- A minimal preload API forms the renderer boundary; this slice needs no PoB, MCP, or model bridge.
- React renders the chat view and the empty settings view.
- Vite provides the renderer development/build pipeline, with Electron app packaging configuration kept to the minimum needed for local development.

## Validation

- The development command opens the standalone Electron window at 960×720 and allows resizing.
- The window shows the supplied dark chat composition and navigates to the empty settings view.
- Production renderer build completes without exposing Node integration in the renderer.

## Deferred

PoB connection and process lifecycle, single-instance IPC, model/MCP startup and readiness retries, live chat streaming/queue behavior, connection switching, Windows installer packaging, and external runtime configuration remain governed by their existing feature documents and are not part of this first UI slice.
