---
name: GitHub Actions
description: CI workflows
tags: ops, ci
---
- Pin third-party actions to a version tag or commit SHA.
- Give workflows the least `permissions` they need.
- Cache dependencies with the setup action's cache option.
- Run the same commands CI runs locally before you push a workflow change.
- Use a matrix for several OS or language versions instead of copying jobs.
- Never print secrets; pass them through `secrets.*` and environment variables.
