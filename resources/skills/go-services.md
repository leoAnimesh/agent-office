---
name: Go services
description: Idiomatic Go for services and tools
tags: backend, go
---
- Run `gofmt` (or `goimports`) on every file you touch.
- Return errors, wrap them with context (`fmt.Errorf("load user: %w", err)`), and handle each one.
- Pass `context.Context` as the first argument through request paths and respect cancellation.
- Keep interfaces small and define them where they are used.
- Avoid package-level mutable state; inject dependencies.
- Guard shared data with a mutex or channels, and run `go test -race` on concurrent code.
- Write table-driven tests and run `go vet ./...` and `go test ./...` before you finish.
