///|
test "measure and provenance cover Unicode percent encoding and repeated names" {
  let vars = @lib.Variables::from_entries([("x", @lib.Scalar("😀%2F/"))]).unwrap()
  let t = @lib.parse("😀/{x}{+x}").unwrap()
  let r = t.expand_mapped(vars).unwrap()
  assert_eq(r.output, "%F0%9F%98%80/%F0%9F%98%80%252F%2F%F0%9F%98%80%2F/")
  assert_eq(t.measure(vars).unwrap(), r.output.length())
  assert_eq(r.origins.length(), 3)
  assert_eq(r.origins[0].name, None)
  assert_eq(r.origins[1].name, Some("x"))
  assert_eq(r.origins[1].source.start, 3)
  assert_eq(r.origins[1].output_start, 13)
  assert_eq(
    t
    .measure(
      vars,
      limits=@lib.ExpansionLimits::new(max_output_bytes=r.bytes - 1),
    )
    .unwrap_err().code,
    "OutputLimit",
  )
  assert_eq(
    t
    .measure(vars, limits=@lib.ExpansionLimits::new(max_output_bytes=r.bytes))
    .unwrap(),
    r.bytes,
  )
}

///|
test "measure agrees across deterministic mixtures and all operators" {
  let atoms = ["a", " ", "😀", "%2f", "%", "/", "é", "", "中", "&"]
  for i = 0; i < 100; i = i + 1 {
    let vars = @lib.Variables::from_entries([
      ("x", @lib.Scalar(atoms[i % 10] + atoms[(i * 7 + 3) % 10])),
      ("list", @lib.List([atoms[i % 10], atoms[(i + 1) % 10]])),
    ]).unwrap()
    for op in ["", "+", "#", ".", "/", ";", "?", "&"] {
      let t = @lib.parse("base{" + op + "x,list*}").unwrap()
      let text = t.expand(vars).unwrap()
      assert_eq(t.measure(vars).unwrap(), text.length())
      assert_eq(t.expand_mapped(vars).unwrap().output, text)
    }
  }
}

///|
test "batch is atomic and enforces cumulative budgets and item index" {
  let t = @lib.parse("{x}").unwrap()
  let a = @lib.Variables::from_entries([("x", @lib.Scalar("a"))]).unwrap()
  let b = @lib.Variables::from_entries([("x", @lib.Scalar("😀"))]).unwrap()
  assert_eq(
    t
    .expand_batch(
      [a, b],
      batch_limits=@lib.BatchLimits::new(max_total_output_bytes=13),
    )
    .unwrap(),
    ["a", "%F0%9F%98%80"],
  )
  let e = t
    .expand_batch(
      [a, b],
      batch_limits=@lib.BatchLimits::new(max_total_output_bytes=12),
    )
    .unwrap_err()
  assert_eq(e.index, 1)
  assert_eq(e.error.code, "BatchOutputLimit")
  assert_eq(
    t
    .expand_batch(
      [a, b],
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=3),
    )
    .unwrap_err().error.code,
    "BatchInputLimit",
  )
  assert_eq(
    t
    .expand_batch([a, b], batch_limits=@lib.BatchLimits::new(max_items=1))
    .unwrap_err().index,
    -1,
  )
  assert_eq(
    t
    .expand_batch([], limits=@lib.ExpansionLimits::new(max_output_bytes=-1))
    .unwrap_err().error.code,
    "InvalidLimit",
  )
  assert_eq(
    t.expand_batch([], batch_limits=@lib.BatchLimits::new(max_items=0)).unwrap(),
    [],
  )
  assert_eq(
    t.expand_batch([a, @lib.Variables::new()], required=["x"]).unwrap_err().index,
    1,
  )
}

///|
test "batch counts unused inputs and individual errors do not become total errors" {
  let t = @lib.parse("{x:1}").unwrap()
  let a = @lib.Variables::from_entries([("unused", @lib.Scalar("abc"))]).unwrap()
  assert_eq(
    t
    .expand_batch(
      [a],
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=8),
    )
    .unwrap_err().error.code,
    "BatchInputLimit",
  )
  let b = @lib.Variables::from_entries([("x", @lib.List(["a"]))]).unwrap()
  assert_eq(t.expand_batch([b]).unwrap_err().error.code, "PrefixOnComposite")
  let c = @lib.Variables::from_entries([("x", @lib.Scalar("😀"))]).unwrap()
  assert_eq(
    t
    .expand_batch([c], limits=@lib.ExpansionLimits::new(max_output_bytes=11))
    .unwrap_err().error.code,
    "OutputLimit",
  )
}

///|
test "prepared binding copies fixed collections and preserves separators" {
  let fixed = @lib.Variables::from_entries([("tags", @lib.List(["a b", "c"]))]).unwrap()
  let t = @lib.parse("{?tags*,page}").unwrap().bind(fixed).unwrap()
  fixed.set("tags", @lib.List(["changed"]))
  let extra = @lib.Variables::from_entries([("page", @lib.Scalar("2"))]).unwrap()
  assert_eq(t.expand(extra).unwrap(), "?tags=a%20b&tags=c&page=2")
  assert_eq(t.measure(extra).unwrap(), 25)
  assert_eq(t.expand(fixed).unwrap_err().code, "FixedBinding")
  assert_eq(
    t
    .expand(extra, limits=@lib.ExpansionLimits::new(max_bindings=1))
    .unwrap_err().code,
    "BindingLimit",
  )
  assert_eq(
    @lib.parse("{x}").unwrap().bind(fixed).unwrap_err().code,
    "UnusedBinding",
  )
}

///|
test "catalog names source inspection and bounded compilation" {
  let catalog = @lib.compile_catalog([
    ("users", "/users/{id}{?page}"),
    ("repo", "/repos/{owner}/{repo}"),
  ]).unwrap()
  assert_eq(catalog.names(), ["repo", "users"])
  let t = catalog.get("users").unwrap()
  assert_eq(t.source(), "/users/{id}{?page}")
  assert_eq(t.level(), 3)
  assert_eq(t.inspect()[0].span.start, 7)
  assert_eq(t.inspect()[0].span.end, 11)
  let vars = @lib.Variables::from_entries([("id", @lib.Scalar("42"))]).unwrap()
  assert_eq(
    catalog.expand("users", vars, required=["id"]).unwrap(),
    "/users/42",
  )
  assert_eq(
    catalog.expand("users", @lib.Variables::new(), required=["id"]).unwrap_err().name,
    "users",
  )
  assert_eq(catalog.get("absent").unwrap_err().error.code, "UnknownTemplate")
  assert_eq(
    @lib.compile_catalog([("x", ""), ("x", "")]).unwrap_err().error.code,
    "CatalogName",
  )
  assert_eq(
    @lib.compile_catalog([("x", "abc")], max_total_codepoints=3).unwrap_err().error.code,
    "CatalogInputLimit",
  )
  assert_eq(
    @lib.compile_catalog([], limits=@lib.ParseLimits::new(max_expressions=-1)).unwrap_err().error.code,
    "InvalidLimit",
  )
}

///|
test "policy findings and contract diff include modifiers and literal changes" {
  let before = @lib.parse("/{id}{?tags*}").unwrap()
  let after = @lib.parse("/v2/{id:2}{+path}{#fragment}").unwrap()
  let diff = before.diff(after)
  assert_eq(diff.added, ["path", "fragment"])
  assert_eq(diff.removed, ["tags"])
  assert_eq(diff.newly_scalar_only, ["id"])
  assert_true(diff.source_changed)
  assert_true(
    before.diff(@lib.parse("/v2/{id}{?tags*}").unwrap()).source_changed,
  )
  let findings = after.audit(
    @lib.TemplatePolicy::new(
      allow_reserved=false,
      allow_fragment=false,
      allow_prefix=false,
    ),
  )
  assert_eq(findings.length(), 4)
  assert_eq(findings[0].code, "PrefixPolicy")
  assert_eq(
    before.audit(@lib.TemplatePolicy::new(allow_explode=false)).length(),
    1,
  )
  assert_eq(
    before
    .audit(@lib.TemplatePolicy::new(allowed_variables=Some(["id"])))
    .length(),
    1,
  )
}

///|
test "sparse normalization and catalog migration preserve explicit differences" {
  let vars = @lib.Variables::from_entries([
    ("list", @lib.sparse_list([Some("a"), None, Some("")])),
    ("assoc", @lib.sparse_assoc([("a", None), ("b", Some("v"))]).unwrap()),
  ]).unwrap()
  assert_eq(@lib.expand("{?list*,assoc*}", vars).unwrap(), "?list=a&list=&b=v")
  assert_eq(
    @lib.sparse_assoc([("a", None), ("a", Some("v"))]).unwrap_err().code,
    "DuplicateKey",
  )
  let old = @lib.compile_catalog([("a", "{id}"), ("b", "{old}")]).unwrap()
  let next = @lib.compile_catalog([("a", "/v2/{id:1}"), ("c", "{new}")]).unwrap()
  let diff = old.diff(next)
  assert_eq(diff.added, ["c"])
  assert_eq(diff.removed, ["b"])
  assert_eq(diff.changed[0].1.newly_scalar_only, ["id"])
  assert_eq(next.templates_using("id"), ["a"])
  assert_eq(old.measure("a", @lib.Variables::new()).unwrap(), 0)
  let findings = @lib.parse("{x}{x}{?y}")
    .unwrap()
    .audit(
      @lib.TemplatePolicy::new(
        max_level=1,
        max_references=2,
        forbid_repeated_variables=true,
      ),
    )
  assert_eq(findings.map(e => e.code), [
    "LevelPolicy", "RepeatedPolicy", "ReferencePolicy",
  ])
  assert_eq(
    @lib.parse("").unwrap().audit(@lib.TemplatePolicy::new(max_level=5))[0].code,
    "InvalidPolicy",
  )
}
