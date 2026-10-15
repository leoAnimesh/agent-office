---
name: Auth and security
description: Authentication, sessions and access control
tags: backend, security, auth
---
- Never write your own crypto or password hashing; use the framework's or bcrypt/argon2.
- Check authorization on the server for every request that reads or changes data, not only in the UI.
- Store sessions in HttpOnly, Secure, SameSite cookies, or short-lived tokens; never put tokens in URLs.
- Protect state-changing requests against CSRF when cookies authenticate them.
- Rate-limit login, sign-up and password reset.
- Do not reveal whether an account exists in login or reset errors.
- Keep secrets in environment variables or a secret store; never log them.
