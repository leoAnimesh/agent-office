---
name: Security review
description: Spot common vulnerabilities before they ship
tags: security
---
- Treat all input as untrusted: validate type, length and format at the boundary.
- Look for injection: SQL, shell commands, HTML (XSS), file paths (`../`), and template strings.
- Do not pass user input to a shell; use argument arrays.
- Escape output for its context; never insert raw HTML from users.
- Check that every endpoint enforces who may call it.
- Check new dependencies: maintained, widely used, pinned in the lockfile.
- Report anything risky you find in your summary even if it is outside your task.
