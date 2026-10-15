---
name: Vue
description: Vue 3 components and state
tags: frontend, vue
---
- Match the project's style: Composition API with `<script setup>` unless the code uses the Options API.
- Declare props with `defineProps` and types; emit events with `defineEmits`; never mutate a prop.
- Use `computed` for derived values and `watch` only for side effects.
- Keep shared state in the project's store (Pinia or the existing one), not in ad-hoc globals.
- Give every `v-for` a stable `:key`; never use `v-if` and `v-for` on the same element.
- Use scoped styles or the project's CSS approach; do not add global CSS for one component.
- Test components with the project's runner (Vitest + Vue Test Utils if present).
