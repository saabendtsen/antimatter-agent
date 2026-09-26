# Antimatter Agent

A local-model experiment for playing [Antimatter Dimensions](https://ivark.github.io/AntimatterDimensions/) through a visible browser. [homelab-workspace#369](https://github.com/saabendtsen/homelab-workspace/issues/369) records the experiment contract.

The model uses Pi with only three tools: a Playwright-backed game browser, bounded warm/cold memory, and a round-finishing decision. Each round has a fresh agent session. A playthrough keeps its game save and notes. A successor playthrough receives only a handoff of up to 150 words.

A round can contain a sequence of up to 12 browser actions and 30 browser/memory tool calls. The model normally ends it by calling `finish_round` and choosing a wake time. An eight-minute wall cap prevents a stalled round from consuming the whole playthrough. Pi compaction is disabled inside these fresh sessions; the configured local endpoint currently offers about 120,000 context tokens, while the automatically loaded warm note is limited to 2,200 characters. At 70% estimated context occupancy, the harness stops browser actions and note retrieval but still permits note writes and `finish_round`. Each round records its peak estimated context tokens and percentage of the configured window.

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

`npm start` runs the three-playthrough pre-pilot. Each playthrough stops at 30 rounds or one hour. The controller keeps its state in ignored `state/prepilot/`; restarting it resumes the same playthrough and browser profile. The game browser stays open between rounds. During the pre-pilot, rounds start immediately after the prior round's checkpoint; the model's requested wake is logged but not applied. Use `node src/controller.js --pilot` only after reviewing the pre-pilot; the pilot uses a separate state directory, applies the model's requested wake time, and has a 24-hour limit.

The run history stays under `state/`. Each playthrough's `transcript.jsonl` records completed user, assistant, and tool-result messages with text, tool calls, token usage, and any thinking blocks Pi returns. Image payloads and provider metadata are omitted. The transcript is local and ignored by Git; it is not sent to the public viewer. Pi thinking is currently set to `off` for this pre-pilot, so a thinking block should not be expected. Earlier rounds cannot be reconstructed from the new transcript. `publication/latest.json` and `publication/screen.png` are the reduced public view. Start the publisher separately after the server viewer is deployed:

```cmd
npm run publish
```

The publisher uses the configured `home-server` SSH alias and sends only those two public files to `/srv/homelab-deploy/antimatter-agent/data`. Override the destination with `ANTIMATTER_PUBLIC_HOST` and `ANTIMATTER_PUBLIC_DIR` if the approved server wiring differs. The player has no shell or publisher tool.

## Runtime contract

The viewer image serves static HTML on port 8080 and returns 200 at `/health`. Mount the public data directory read-only at `/srv/data`. The app is read-only and needs no database or secret. The server-specific Compose and Caddy route belong to `saabendtsen/home-server`.
