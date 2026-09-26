# Antimatter agent experiment

This repository owns the game controller, public viewer, tests, and image build. Read `README.md`
when running a playthrough or changing the viewer runtime contract. The existing
`local-llm-worker` repository owns the shared llama.cpp runtime. `saabendtsen/home-server` owns
server deployment manifests and ingress. Follow the parent workspace's zero-cost and Git workflow.

The local model is the player. Give it only the bounded browser and memory tools in this repository.
The player must have no shell, arbitrary filesystem, web search, game source, or publishing credentials.
Do not put model weights, browser profiles, run logs, screenshots, or secrets in Git.
