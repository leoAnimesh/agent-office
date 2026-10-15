---
name: Docker
description: Images and compose files
tags: ops, docker
---
- Pin base image versions; prefer slim or distroless images.
- Order Dockerfile steps so dependency installs are cached: copy lockfiles, install, then copy source.
- Use multi-stage builds so build tools stay out of the final image.
- Run as a non-root user.
- Keep a `.dockerignore` that excludes `node_modules`, `.git`, build output and secrets.
- Pass configuration through environment variables; never bake secrets into images.
- Add health checks for long-running services.
