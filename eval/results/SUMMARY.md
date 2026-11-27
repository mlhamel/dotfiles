# Eval results

## Runs

| date       | agent     | model                      | task                          | score | tokens in | tokens out | duration |
| ---------- | --------- | -------------------------- | ----------------------------- | ----- | --------- | ---------- | -------- |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | fix-nudger-band               | 2/2   | 10766     | 835        | 8.5s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | fix-plan-exemption            | 2/2   | 13834     | 1920       | 13.2s    |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | add-fallback-gateway-test     | 4/4   | 18003     | 2787       | 15.3s    |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | docs-tree-sync                | 3/3   | 21954     | 3538       | 18.7s    |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | add-darwin-services-fail-case | 4/4   | 32073     | 2518       | 76.7s    |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | add-fallback-gateway-test     | 2/4   | 0         | 0          | 2.9s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | docs-tree-sync                | 1/3   | 0         | 0          | 2.9s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | fix-nudger-band               | 1/2   | 0         | 0          | 2.3s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | fix-plan-exemption            | 1/2   | 0         | 0          | 2.3s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | add-darwin-services-fail-case | 1/4   | 0         | 0          | 2.3s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | fix-plan-exemption            | 1/2   | 0         | 0          | 1.8s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | add-fallback-gateway-test     | 2/4   | 0         | 0          | 1.7s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | docs-tree-sync                | 1/3   | 0         | 0          | 1.8s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | fix-nudger-band               | 1/2   | 0         | 0          | 1.8s     |
| 2026-11-27 | opencode  | ollama/glm-5.3-flash       | add-darwin-services-fail-case | 1/4   | 0         | 0          | 1.8s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash       | add-fallback-gateway-test     | 2/4   | 0         | 0          | 2.0s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash       | docs-tree-sync                | 1/3   | 0         | 0          | 1.8s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash       | fix-nudger-band               | 1/2   | 0         | 0          | 1.9s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash       | fix-plan-exemption            | 1/2   | 0         | 0          | 2.1s     |
| 2026-11-26 | opencode  | ollama/glm-5.3-flash       | add-darwin-services-fail-case | 1/4   | 0         | 0          | 1.8s     |
| 2026-11-26 | opencode  | glm-5.3-flash              | add-fallback-gateway-test     | 2/4   | 0         | 0          | 1.3s     |
| 2026-11-26 | opencode  | glm-5.3-flash              | docs-tree-sync                | 1/3   | 0         | 0          | 1.3s     |
| 2026-11-26 | opencode  | glm-5.3-flash              | fix-nudger-band               | 1/2   | 0         | 0          | 1.3s     |
| 2026-11-26 | opencode  | glm-5.3-flash              | fix-plan-exemption            | 1/2   | 0         | 0          | 1.7s     |
| 2026-11-26 | opencode  | glm-5.3-flash              | add-darwin-services-fail-case | 1/4   | 0         | 0          | 1.3s     |
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
| opencode  | glm-5.3-flash              | add-darwin-services-fail-case | 1    | 25.0%      | 0              | 0               | 1.3s          |
| opencode  | glm-5.3-flash              | add-fallback-gateway-test     | 1    | 50.0%      | 0              | 0               | 1.3s          |
| opencode  | glm-5.3-flash              | docs-tree-sync                | 1    | 33.3%      | 0              | 0               | 1.3s          |
| opencode  | glm-5.3-flash              | fix-nudger-band               | 1    | 50.0%      | 0              | 0               | 1.3s          |
| opencode  | glm-5.3-flash              | fix-plan-exemption            | 1    | 50.0%      | 0              | 0               | 1.7s          |
| opencode  | ollama/glm-5.3-flash       | add-darwin-services-fail-case | 4    | 43.8%      | 8018           | 630             | 20.7s         |
| opencode  | ollama/glm-5.3-flash       | add-fallback-gateway-test     | 4    | 62.5%      | 4501           | 697             | 5.5s          |
| opencode  | ollama/glm-5.3-flash       | docs-tree-sync                | 4    | 50.0%      | 5489           | 885             | 6.3s          |
| opencode  | ollama/glm-5.3-flash       | fix-nudger-band               | 4    | 62.5%      | 2692           | 209             | 3.6s          |
| opencode  | ollama/glm-5.3-flash       | fix-plan-exemption            | 4    | 62.5%      | 3459           | 480             | 4.8s          |
