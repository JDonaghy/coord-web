# coord-web

The Phone/Web Control Center for [claude-coordinator](https://github.com/JDonaghy/code-coordinator) — a React / Vite / TypeScript PWA. It is a **pure HTTP + WebSocket client**: every byte of state comes from `coord`'s dashboard API (`coord/dashboard/server.py` in claude-coordinator), served by `coord web` / `coord serve`. There is no backend code in this repo and none should be added here — API routes, the SSE poller, and the terminal PTY↔WS bridge all live in claude-coordinator.

This repo was split out of `claude-coordinator`'s `coord/dashboard/webapp/` with history preserved (claude-coordinator#2005, epic #2002) — `git log --follow` on any file reaches its pre-split commits. Full product context (what the app does, the terminal takeover feature, the API surface, the deploy mechanism) lives in claude-coordinator's [`docs/PHONE_WEBAPP.md`](https://github.com/JDonaghy/code-coordinator/blob/main/docs/PHONE_WEBAPP.md) — read that first for anything beyond "how do I build/test this repo."

## One open cross-repo question — do not improvise an answer to it here

- **Generated API types drift silently.** `src/api/generated.ts` and `src/api/client.ts`'s wire types are meant to be generated from claude-coordinator's OpenAPI spec (`coord.dashboard.server.openapi_spec()`), but the generator (`scripts/codegen.py`) and the spec it reads both live in claude-coordinator. This repo's CI has **no drift check** for it right now — see claude-coordinator#2258. If a PR here changes a wire type by hand, double check it still matches what the coordinator actually serves; don't assume CI would have caught a mismatch.

## The sealed acceptance suite — settled, and it lives here

`tests/acceptance/ms-3` (the oracle-loop suite) **is in this repo**, grafted with full history by `git subtree` in #16. claude-coordinator#2007 (UX-5) settled where it belongs and is closed; the reasoning is in claude-coordinator's [`docs/ADR_COORD_WEB_ACCEPTANCE_SUITE.md`](https://github.com/JDonaghy/code-coordinator/blob/main/docs/ADR_COORD_WEB_ACCEPTANCE_SUITE.md).

What follows from that, and matters while working here:

- **Sealing is path-based, not a repo boundary.** `tests/acceptance/**` is sealed by `AcceptanceConfig.sealed_paths()` and enforced by the adversarial reviewer, exactly as it was before the move — living in the same repo as the code it pins changes nothing. (`coord/` and `tui/tests/acceptance.rs` already seal the repos they live in.) **Any `type="work"` diff touching `tests/acceptance/**` is an unconditional `request-changes`.** Write your own unit tests (`src/**/__tests__/`) and Playwright specs (`e2e/`) instead.
- **`coord acceptance run` is wired against this checkout.** `acceptance.drivers.coord-web` is registered in `coordinator.yml` — `kind: web-playwright`, `capability: browser`, `run: npm run test:acceptance -- {ms}`.
- **CI runs it** as the `acceptance` job (`.github/workflows/ci.yml`), so a red slice is caught rather than sitting unnoticed (the failure mode of claude-coordinator#1950).
- **Changing what the suite asserts means amending the contract first.** `tests/acceptance/ms-NN/contract.md` is the spec the specs derive from; a worker cannot edit either. Amend the contract (coordinator work), let a `type="test-author"` leg re-derive the specs, and record the interim red in `manifest.yml`'s `expected_red:`.

## Build & test

```bash
npm install
npm run build        # tsc && vite build -> dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest run — component/filter-logic unit tests
npm run test:e2e     # playwright test — real browser, real coord web --fixture process
```

`npm run test:e2e` needs the `coord` CLI on `$PATH` for `e2e/live-update-fixture.spec.ts`, which boots a real `coord web --fixture` process rather than a fake transport — `pip install code-coordinator` (public PyPI package, no credentials) is enough; see that spec's own header. CI does this in `.github/workflows/ci.yml`.

## Testing conventions

Same bar as claude-coordinator: **a PR that changes user-visible behavior ships a black-box test that drives the running app and asserts on rendered output**, not just a unit test on an internal function. Two tiers:

- **Vitest** (`src/components/__tests__/`) — fast, component-level, a hand-rolled fake `EventSource` for SSE where needed (`realtime.spec.ts`'s Playwright counterpart exists precisely because a fake transport can't catch the real wire shape drifting).
- **Playwright e2e** (`e2e/`) — real headless browser. Most specs run against a fixture/mock; `live-update-fixture.spec.ts` alone boots the real CLI process end to end and is correspondingly slower — see its header before touching it.

## Deploy

Not GitHub Actions, and not a release. `coord-web-dist-build.timer` on the coordinator's daemon host fetches this repo's `main`, builds it in a dedicated worktree, health-checks the result on a scratch port, and atomically republishes `coord web`'s served bundle — all decoupled from any `claude-coordinator` release. See claude-coordinator's [`docs/PHONE_WEBAPP.md`](https://github.com/JDonaghy/code-coordinator/blob/main/docs/PHONE_WEBAPP.md#going-live-automatically-1543) and [`docs/ADR_COORD_WEB_DIST.md`](https://github.com/JDonaghy/code-coordinator/blob/main/docs/ADR_COORD_WEB_DIST.md) for the full mechanism and why it's built this way. A merge to `main` here goes live on its own cadence — it is not gated on anything in claude-coordinator.

## File map

| Path | What lives there |
|---|---|
| `src/api/client.ts` | Typed API client + all wire types (see the drift caveat above) |
| `src/App.tsx` | React Router root (`/` Home, `/detail/:id` Detail) |
| `src/components/Home.tsx` | Pipeline card list + filter tabs + live-sessions-first ordering + pull-to-refresh |
| `src/components/Detail.tsx` | Per-item detail: test gate, review section, merge section, diff viewer |
| `src/components/PipelineCard.tsx` | Card component for the Home screen |
| `src/components/SessionCard.tsx` | Live-session card — tap to open the terminal takeover view |
| `src/components/Terminal.tsx` | xterm.js pane + WS client + reconnect/backoff + "ended" state |
| `src/components/MobileKeyBar.tsx` | Esc / arrows / Enter / Ctrl-C / Tab / `/` key bar for the terminal pane |
| `e2e/terminal.spec.ts` | Playwright E2E for the terminal takeover flow |
| `e2e/live-update-fixture.spec.ts` | The one spec that boots a real `coord web --fixture` process — see its header |
| `vite.config.ts` | Vite + PWA plugin config |
| `dist/` | Build output (gitignored) — what `coord-web-dist-build.timer` publishes |
