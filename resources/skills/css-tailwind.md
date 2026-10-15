---
name: CSS and Tailwind
description: Styling, layout and responsive design
tags: frontend, css, tailwind
---
- Use the project's existing approach (Tailwind, CSS modules, plain CSS) and its design tokens; never hard-code colours that already have a token.
- With Tailwind, compose utilities in markup; extract a component, not an `@apply` class, when a pattern repeats.
- Lay out with flexbox and grid; avoid absolute positioning for layout.
- Design mobile first and check widths of 320px, 768px and 1280px.
- Give flex children `min-width: 0` so long text cannot overflow.
- Keep text contrast at least 4.5:1 and visible focus styles on every interactive element.
- Respect `prefers-reduced-motion` for animations.
