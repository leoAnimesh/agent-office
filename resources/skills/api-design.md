---
name: API design
description: HTTP/JSON API conventions
tags: backend, api, http
---
- Validate input at the edge and return 400 with a field-level message.
- Never leak stack traces to clients.
- Use plural resource names.
- Version breaking changes.
