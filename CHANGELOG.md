# Changelog

## 0.2.0 candidate usability follow-up (unreleased)

- Typed ESM SDK with inferred variable names, selective required bindings, compiled reuse and atomic batches; independently installed local npm tarball.
- MoonBit catalog batches across templates, with input/output budgets and indexed named failures.
- Prepared template reuse in project checks and conservative typo repair suggestions with JSON Pointers.
- Remove repeated temporary allocations in encoding and parsing; retain all correctness and budget checks.

## 0.2.0 — Unreleased (local candidate)

- Add explicit parse/input/output budgets and bounded streaming expansion.
- Add copied binding construction, source-located preflight and selective required contracts.
- Add CLI check, JSON diagnostics, UTF-16 offsets, caret snippets, stdin and budget flags.
- Bound raw JSON length/depth before parsing in the shared request bridge.
- Add a local worker-backed browser playground using the same compiled core.
- Re-run both pinned peer projects and shared probes on three backends.
- Keep original core convenience APIs compatible; bridge/CLI defaults are now bounded.


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

Public release status is tracked in docs/ACCEPTANCE.md.

### 0.2.0 candidate extension — 2026-10-20

- Add shared-emitter measurement, variable-level output origins, atomic input/output-budgeted batches, compiled catalogs, prepared bindings, policy inspection and contract/catalog diffs.
- Add explicit sparse-value normalization and validate the wasm backend alongside JS, wasm-gc and Native.
- Add project manifest validation with exact JSON-source locations, bounded diagnostics, atomic output and GitHub Actions annotations.
- Add a real GitHub audit consumer, separate fault-injection evidence, fixed-peer probes/benchmarks and resubmission technical attachments. Candidate only; not published.
