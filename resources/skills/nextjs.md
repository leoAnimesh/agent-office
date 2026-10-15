---
name: Next.js
description: App Router, server components and data fetching
tags: frontend, react, nextjs, ssr
---
- Check whether the project uses the App Router (`app/`) or the Pages Router (`pages/`) and stay with it.
- Components are server components by default; add `"use client"` only to components that need state, effects or browser APIs.
- Fetch data in server components or route handlers, not in `useEffect`.
- Keep secrets on the server: only `NEXT_PUBLIC_` variables reach the browser.
- Use `next/link` for internal links and `next/image` for images with known sizes.
- Put shared layout in `layout.tsx`; use `loading.tsx` and `error.tsx` for loading and error states.
- Mutations go through server actions or route handlers; revalidate with `revalidatePath`/`revalidateTag` afterwards.
- Run `next build` before you finish: it catches server/client boundary errors that the dev server misses.
