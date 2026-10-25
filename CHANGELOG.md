# Changelog

## Unreleased

### Fixes

- OpenAPI: a required query parameter without an RFC 6570 serialization (e.g. `deepObject`) now fails expansion with `UnsupportedParameter` instead of being omitted. Optional ones are still omitted.
- OpenAPI: a header or cookie parameter with the same name as a path or query parameter no longer takes the value; URL parameters win regardless of declaration order.
- OpenAPI: a lookup name that refers to more than one operation (duplicate `operationId`, or an `operationId` equal to another operation's `"GET /path"`) fails with `AmbiguousOperation` instead of picking one.

### Performance

- OpenAPI CLI: JSON input no longer keeps per-character string offsets, which OpenAPI diagnostics don't use. Peak memory on the official GitHub description drops from 502 to 391 MiB and on Cloudflare from 924 to 707 MiB, with byte-identical output (`reports/openapi-memory.json`). Project checks and the playground keep exact offsets.

## 0.5.0 — 2026-10-23 (npm and Mooncakes)

### Added

- The CLI reads YAML OpenAPI descriptions (`.yaml`/`.yml`, or `--format yaml`): YAML 1.2 equivalent to JSON only, with duplicate keys, custom tags, multiple documents and merge keys rejected and aliases bounded. Diagnostics keep YAML line/column. The `yaml` 2.9.1 parser (ISC) is bundled in the npm package and portable archive; analysis stays in MoonBit.
- Public regression set: 200 OpenAPI 3.0/3.1 descriptions from 200 providers (12,963 operations), pinned by URL and SHA-256, with a behaviour baseline and 60 JSON/YAML pairs. Minimal reductions of representative findings run as tests.
- `integrations/moonbit-github`: a native MoonBit client that installs `cjyhjy/uri_template@0.4.0` from Mooncakes, reads GitHub's OpenAPI description and sends read-only HTTPS requests with `moonbitlang/async`. Verified on macOS and Linux.
- `examples/ci/openapi-check.yml` for downstream repositories, and an issue template for integration feedback.

## 0.4.0 — 2026-10-23 (npm and Mooncakes)

### Added

- MoonBit package `cjyhjy/uri_template/openapi`: `analyze`, `compile` and typed `Operation`, `Parameter`, `Diagnostic` values; `Templates::expand` takes the core `Variables` keyed by OpenAPI parameter names. The Node SDK and CLI call the same compiled code. Example: `examples/openapi_moonbit`.
- `Variables::get` and `Variables::names` (read-only, return copies).
- `moonbit-uri-template/openapi`: `compileOpenApi(spec)` turns every OpenAPI 3.0/3.1 operation into one RFC 6570 template following OAS 3.1.1 Appendix C (path styles `simple`/`label`/`matrix`, all `form` query parameters in one `{?...}`, percent-encoded names) and expands by `operationId` with required, shape and unknown-name checks. `analyzeOpenApi` returns the templates and diagnostics.
- The OpenAPI check reports `DuplicateOperationId`, and warnings `ExampleShapeMismatch` and `ExampleNotSerializable`; warnings do not change the exit code. `--templates` lists each operation's template.
- `openapi:public` records templates, unsupported parameters and warnings: GitHub 1242/1242 templates and 2 example warnings, Stripe 612/612 with 366 `deepObject` parameters listed, Cloudflare 3767/3767 with 1783 example warnings.

### Changes

- OpenAPI documents whose strings or keys contain an unpaired UTF-16 surrogate are not analysed: `InvalidInput` at the field's JSON Pointer, exit code 2, as the SDK already does for variables.
- Diagnostic line/column lookup indexes line starts once; with 256 diagnostics, Cloudflare's 27.5 MB description took 4.4 s before.
- Checking the public descriptions takes 0.6 s (GitHub), 0.3 s (Stripe) and 1.3 s (Cloudflare); compiling GitHub's in the SDK about 180 ms.
- Removed `tools/prepare_submission.py`; reviewers use the repository directly.

## 0.3.0 — 2026-10-23 (npm and Mooncakes)

### Added

- `uri-template openapi FILE.json` checks OpenAPI 3.0/3.1 path templates against path-parameter declarations: missing, unused, optional and duplicate parameters, equivalent templated paths and RFC 3986 path literals, with JSON Pointer and line/column diagnostics. Default input limit 32 MiB (`--max-bytes`).
- `npm run openapi:public` checks the pinned GitHub (1242 operations), Stripe (612) and Cloudflare (3767, 27.5 MB) OpenAPI descriptions; it reports two equivalent-path conflicts in GitHub's description.
- Read-only npm registry and Open Library clients whose URLs come from the SDK (`integrations/public-clients`).

### Changes

- The MoonBit core is unchanged from 0.2.0. npm's first release is 0.3.0, published using GitHub Trusted Publishing with verified provenance.

## 0.2.0 — 2026-10-21 (Mooncakes)

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
