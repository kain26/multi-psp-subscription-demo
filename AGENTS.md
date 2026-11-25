# Multi-PSP Subscription Demo

- Serve `public/` with `python3 -m http.server 4192 --directory public`. The production deployment is the existing `multi-psp-subscription-demo` Cloudflare Pages project.
- Keep this a build-free teaching simulation. Use mock identifiers and events. The browser must never call a PSP or contain credentials.
- Keep standalone routes and their JavaScript isolated. Reuse the existing paper, cobalt, and typography tokens in `public/style.css`. Scope route-specific CSS to the new page.
- Treat provider API names, event names, object scope, and status semantics as documentation-backed facts. Label internal mappings, retry/grace policies, and mock flows as examples. Keep payment evidence, subscription status, and entitlement decisions separate.
- Check direct routes, keyboard step controls, reduced motion, and desktop and mobile layouts before publishing. For a standalone route change, verify the existing homepage remains byte-for-byte identical.
