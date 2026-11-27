# Specs

OKF-format spec documents for work in this repo. Each file in this folder
is a standalone spec (frontmatter + prose); this index lists them.

- [Measurement v1 — scheduled evals + trend log](measure-eval-v1.md) - make eval results visible over time: append-only history log, deterministic trend summary, and recorded/manual run entry points (draft).
- [Measurement — GitHub Actions scheduled evals](measure-github-actions.md) - run the eval measurement on a schedule in GitHub Actions (Zen free model, no Ollama gateway) and commit the history + summary back to the repo (draft).
- [Measurement — Ollama Cloud API key (GLM in CI)](measure-ollama-cloud.md) - wire the OLLAMA_API_KEY secret into the scheduled measurement so ollama/<model>:cloud models resolve via the Ollama Cloud API with no local gateway (draft).
- [OpenHands — GitHub App for push + PR (multi-repo) with secrets management](openhands-github-app.md) - let the OpenHands ACP agent push branches and open PRs on any repo where a GitHub App is installed, with the app's private key as a host file (mode 600) mounted read-only and installation tokens minted on demand (draft).
