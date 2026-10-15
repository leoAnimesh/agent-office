---
name: Node and Express
description: Node.js HTTP services
tags: backend, node, javascript
---
- Use `async` handlers and pass errors to one error middleware; never leave a promise unhandled.
- Validate every request body, query and param before use.
- Keep route handlers thin: put logic in plain functions you can test without HTTP.
- Read configuration from environment variables with defaults checked at startup; never commit secrets.
- Return consistent JSON errors with the right status codes (400, 401, 403, 404, 409, 500).
- Do not block the event loop: no sync file or crypto calls in request paths.
- Test routes with the project's tool (supertest or similar) against an in-memory or test database.
