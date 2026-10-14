# Changelog

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
