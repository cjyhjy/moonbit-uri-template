# Changelog

## 0.2.0 — unreleased

### Fixes

- Prefix modifiers now count raw code points of the value before encoding, for every operator. `{x:3}` with `x="%41bc"` gives `%2541` (was `%2541bc`); `{+x:3}` gives `%41`. This matches Python `uritemplate` and `std-uritemplate`.
- Associative values from JSON / JS objects keep their member order instead of being sorted by key.
- Reserved operators (`=` `,` `!` `@` `|`) report `ReservedOperator` instead of a generic variable-name error.
- The Node SDK reports unpaired UTF-16 surrogates with a JSON Pointer instead of "invalid JSON input".

### Changes

- `Template::expand(vars, required?, reject_unused?, limits?)` replaces `expand_checked` and `expand_with_limits`. With no options it stays unbounded, as in 0.1.
- `check_bindings(vars, limits?)` replaces `check_bindings_with_limits`; `audit(policy, max_findings?)` replaces `audit_with_limit`; `diff` now returns the detailed report (formerly `diff_contract`) on templates and catalogs. `analyze()` replaces `inspect`, `level`, `variable_uses`, `variable_profiles`, `reference_count` and `composite_capable_variables`.
- Node SDK defaults: numbers and booleans are converted with `String()`, `undefined` means unbound, `rejectUnused` and `strict` default to `false`, catalogs allow up to 4096 templates. The CLI and JSON adapter also accept numbers and booleans.
- Link sessions (MoonBit and Node) store bindings and outputs in shared 32-entry blocks and track budgets incrementally, so an update costs O(patch + affected endpoints) instead of O(session). Node `get()` is O(1), and each affected endpoint is expanded once.
- Template and catalog `expandMany` in the Node SDK expand each item once instead of measuring first.

### Added

- Differential test against Python `uritemplate` 4.2.0 and `std-uritemplate` 2.0.11 (644 cases), with an offline replay in `npm test`.
- Bounded parsing and expansion, binding preflight, selective required bindings, runtime shape contracts.
- Measurement, output origins, atomic batches, compiled catalogs, prepared bindings, static policy audits, detailed template/catalog diffs.
- Incremental link sessions with immutable snapshots.
- Typed ESM SDK, CLI `check` / `measure` / `trace` / `analyze` / `compare` / `project`, JSON diagnostics with line/column and UTF-16 offsets, GitHub Actions annotations, typo suggestions.
- Browser playground backed by the same compiled core.
- wasm backend verified alongside JS, wasm-gc and Native.
- Real GitHub downstream client (`integrations/github-audit`).

## 0.1.1 — 2026-10-14

- Treat empty lists and associative values as undefined before prefix validation, matching RFC 6570 Sections 2.3 and 3.2.1.
- Add all-operator regression cases while retaining errors for prefixes on nonempty composites.

## 0.1.0 — 2026-10-14

- Implement RFC 6570 Level 4 operators, composite values and modifiers in MoonBit.
- Add reusable parsed templates, deterministic variable enumeration and diagnostic spans.
- Add strict JSON adapter and thin Node CLI with three commands.
- Vendor pinned upstream tests with provenance and generate portable blackbox tests.
- Verify JS, wasm-gc and Native, CLI integration, and clean packaged consumers.
- Provide reproducible bootstrap, CI, documentation, demo and benchmark scripts.
- Document the single-quote literal compatibility extension.
