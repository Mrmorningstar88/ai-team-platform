# Rules for agents working in this repo

- Owner (Arut) writes in Russian; UI copy is Russian first, English later.
- Every process the product shows must be animated and explained step by step (use `ProcessFlow`), with a static fallback under `prefers-reduced-motion`.
- UI follows `docs/standards/UI_rulebook.pdf`: color roles from `src/client/styles/tokens.css` (Apple HIG system colors, light and dark), text contrast ≥ 4.5:1, tap targets ≥ 44×44 px, body text 16–18 px, motion 80–320 ms, one primary action per task, verbs on buttons.
- Code follows `docs/standards/Code_Quality_Rulebook.docx`: small reviewable changes, validate all external input at runtime, no secrets in code, tests for behavior that matters.
- Tenant isolation: tenant tables are touched only through `src/worker/repo.ts`, and every query there binds `org_id`. Add a test in `test/api.test.ts` for any new tenant route.
- Before pushing: `npm run typecheck && npm test && npm run build`.
