---
name: Performance
description: Measure, then make it faster
tags: performance, frontend, backend
---
- Measure before and after any optimisation, and report both numbers.
- Frontend: keep bundles small (lazy-load routes and heavy libraries), size images, avoid layout shifts.
- React: avoid needless re-renders; memoise only where a profile shows it helps.
- Backend: find slow queries first; add indexes, batch work, and paginate large results.
- Cache only with a clear invalidation rule.
- Do not trade correctness or readability for a gain you have not measured.
