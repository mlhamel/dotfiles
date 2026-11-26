# Eval results

## Runs

| date       | agent     | model                      | task                          | score | tokens in | tokens out | duration |
| ---------- | --------- | -------------------------- | ----------------------------- | ----- | --------- | ---------- | -------- |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash:cloud | add-fallback-gateway-test     | 2/4   | 0         | 0          | 2.0s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash:cloud | docs-tree-sync                | 1/3   | 0         | 0          | 1.9s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash:cloud | fix-nudger-band               | 1/2   | 0         | 0          | 2.1s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash:cloud | fix-plan-exemption            | 1/2   | 0         | 0          | 2.2s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash:cloud | add-darwin-services-fail-case | 1/4   | 0         | 0          | 2.0s     |
| 2026-11-25 | opencode  | ollama/glm-5.3-flash:cloud | docs-tree-sync                | 3/3   | 18372     | 3886       | 18.8s    |
| 2026-11-25 | openhands | ollama/glm-5.3-flash:cloud | docs-tree-sync                | 3/3   | —         | —          | —        |

## Trends (mean per agent × model × task)

| agent     | model                      | task                          | runs | mean score | mean tokens in | mean tokens out | mean duration |
| --------- | -------------------------- | ----------------------------- | ---- | ---------- | -------------- | --------------- | ------------- |
| opencode  | ollama/glm-5.3-flash:cloud | docs-tree-sync                | 2    | 66.7%      | 9186           | 1943            | 10.3s         |
| openhands | ollama/glm-5.3-flash:cloud | docs-tree-sync                | 1    | 100.0%     | —              | —               | —             |
| opencode  | ollama/glm-5.3-flash:cloud | add-darwin-services-fail-case | 1    | 25.0%      | 0              | 0               | 2.0s          |
| opencode  | ollama/glm-5.3-flash:cloud | add-fallback-gateway-test     | 1    | 50.0%      | 0              | 0               | 2.0s          |
| opencode  | ollama/glm-5.3-flash:cloud | fix-nudger-band               | 1    | 50.0%      | 0              | 0               | 2.1s          |
| opencode  | ollama/glm-5.3-flash:cloud | fix-plan-exemption            | 1    | 50.0%      | 0              | 0               | 2.2s          |
