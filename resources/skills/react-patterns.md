---
name: React patterns
description: Component and hook conventions
tags: frontend, react
---
- One component per file; name the file after the component.
- Keep state as close to where it is used as possible; lift it only when two siblings need it.
- Derive values during render instead of syncing them with effects.
- Every interactive element is a real `<button>`, `<a href>` or form control.
