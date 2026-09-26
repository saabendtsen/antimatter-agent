# Antimatter Agent

A local-model experiment for playing [Antimatter Dimensions](https://ivark.github.io/AntimatterDimensions/) through a visible browser. [homelab-workspace#369](https://github.com/saabendtsen/homelab-workspace/issues/369) records the experiment contract.

The model uses Pi with only three tools: a Playwright-backed game browser, bounded warm/cold memory, and a round-finishing decision. Each round has a fresh agent session. A playthrough keeps its game save and notes. A successor playthrough receives only a handoff of up to 150 words.

The browser tool exposes visible page text, controls, navigation, clicks, and screenshots. The current text-only local model uses text and controls; screenshot results are available when the configured model accepts images. The separate public viewer always receives screenshots.

## Run on the development PC

The existing `local-llm-worker` endpoint must be healthy, and Pi must have `local-worker/local-worker` configured. By default the harness uses Pi's configured loopback endpoint. If the worker is already bound to the LAN address, set `ANTIMATTER_MODEL_URL` to its `/v1` URL and `ANTIMATTER_MODEL_KEY_FILE` to the existing key file outside Git. The key is loaded by the host process and is never a player tool or prompt. With Node.js 22 or later:

```cmd
npm ci
npx playwright install chromium
npm test
npm run test:e2e
npm run smoke
npm start
```

`npm start` runs the three-playthrough pre-pilot. Each playthrough stops at 30 rounds or one hour. The controller keeps its state in ignored `state/prepilot/`; restarting it resumes the same playthrough and browser profile. The game browser stays open between rounds. Use `node src/controller.js --pilot` only after reviewing the pre-pilot; the pilot uses a separate state directory and a 24-hour limit.

The run history stays under `state/`. `publication/latest.json` and `publication/screen.png` are the reduced public view. Start the publisher separately after the server viewer is deployed:

```cmd
npm run publish
```

The publisher uses the configured `home-server` SSH alias and sends only those two public files to `/srv/homelab-deploy/antimatter-agent/data`. Override the destination with `ANTIMATTER_PUBLIC_HOST` and `ANTIMATTER_PUBLIC_DIR` if the approved server wiring differs. The player has no shell or publisher tool.

## Runtime contract

The viewer image serves static HTML on port 8080 and returns 200 at `/health`. Mount the public data directory read-only at `/srv/data`. The app is read-only and needs no database or secret. The server-specific Compose and Caddy route belong to `saabendtsen/home-server`.
