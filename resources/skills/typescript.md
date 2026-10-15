---
name: TypeScript
description: Types that catch mistakes
tags: typescript, javascript
---
- Keep `strict` on. Do not add `any`; use `unknown` and narrow it.
- Type function inputs and exported return values; let local values infer.
- Model states with discriminated unions instead of optional flags.
- Validate data from outside (HTTP, files, user input) at the boundary, e.g. with zod, then trust the types inside.
- Avoid non-null `!` and `as` casts; when one is needed, leave a short comment why.
- Prefer `readonly` arrays and objects for values that should not change.
- Run the project's typecheck (`tsc --noEmit` or its npm script) before you finish.
