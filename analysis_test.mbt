///|
test "profiles preserve every modifier and Unicode source occurrence" {
  let t = @lib.parse("😀/{x:2}/{+x}{?tags*,x:8}{#tail}").unwrap()
  let a = t.analyze()
  assert_eq(a.max_level, 4)
  assert_true(a.has_reserved_expansion && a.has_fragment)
  assert_eq(a.profiles.map(p => p.name), ["x", "tags", "tail"])
  let x = a.profiles[0]
  assert_eq(x.occurrences, 3)
  assert_eq(x.first_span.start, 3)
  assert_eq(x.first_span.end, 6)
  assert_eq(x.prefixes, [2, 8])
  assert_eq(x.maximum_prefix, Some(8))
  assert_eq(x.operators, ["", "+", "?"])
  assert_true(x.scalar_only && x.uses_reserved && x.uses_query)
  assert_false(x.uses_explode || x.uses_fragment)
  assert_eq(x.uses.map(u => u.expression_index), [0, 1, 2])
  assert_eq(t.reference_count("x"), 3)
  assert_eq(t.reference_count("absent"), 0)
  assert_eq(t.composite_capable_variables(), ["tags", "tail"])
  a.profiles[0].uses.clear()
  assert_eq(t.variable_profiles()[0].occurrences, 3)
  assert_eq(t.variable_profiles()[0].uses.length(), 3)
}

///|
test "contract diff sees modifier changes even when summaries match" {
  let a = @lib.parse("{x:2}{x:8}{?tags*}").unwrap()
  let b = @lib.parse("{x:8}{x:2}{?tags}").unwrap()
  let d = a.diff_contract(b)
  assert_true(d.requires_review() && d.expression_layout_changed)
  assert_eq(d.added_variables, [])
  assert_eq(d.became_scalar_only, [])
  assert_eq(d.variable_changes.length(), 2)
  assert_true(d.variable_changes[0].prefixes_changed)
  assert_false(d.variable_changes[0].occurrences_changed)
  assert_eq(d.variable_changes[0].before.maximum_prefix, Some(8))
  assert_eq(d.variable_changes[0].after.maximum_prefix, Some(8))
  assert_true(d.variable_changes[1].explode_changed)
  assert_false(a.diff_contract(a).requires_review())
}

///|
test "contract diff distinguishes literal order reserved fragment and scalar restrictions" {
  let old = @lib.parse("/v1/{x}{?page}").unwrap()
  let next = @lib.parse("/v2/{+x:3}/{x}{#tail}").unwrap()
  let d = old.diff_contract(next)
  assert_eq(d.added_variables, ["tail"])
  assert_eq(d.removed_variables, ["page"])
  assert_eq(d.became_scalar_only, ["x"])
  assert_eq(d.new_repeated_variables, ["x"])
  assert_true(d.literals_changed && d.reserved_added && d.fragment_added)
  assert_eq(d.old_level, 3)
  assert_eq(d.new_level, 4)
  let literal = old.diff_contract(@lib.parse("/v2/{x}{?page}").unwrap())
  assert_true(literal.literals_changed)
  assert_false(literal.expression_layout_changed)
  assert_eq(literal.variable_changes.length(), 0)
  let reorder = @lib.parse("{x,y}")
    .unwrap()
    .diff_contract(@lib.parse("{y,x}").unwrap())
  assert_true(reorder.expression_layout_changed)
  assert_eq(reorder.added_variables, [])
  assert_eq(reorder.variable_changes.length(), 0)
  let relaxing = next.diff_contract(old)
  assert_eq(relaxing.became_composite_capable, ["x"])
  assert_true(
    @lib.parse("abc")
    .unwrap()
    .diff_contract(@lib.parse("xyz").unwrap())
    .requires_review(),
  )
  assert_false(@lib.parse("").unwrap().analyze().has_reserved_expansion)
}

///|
test "static catalog audits validate empty options and cap total findings" {
  let c = @lib.compile_catalog([("b", "{#x}"), ("a", "{+x}")]).unwrap()
  assert_true(c.contains("a"))
  assert_false(c.contains("missing"))
  let policy = @lib.TemplatePolicy::new(allow_reserved=false)
  let report = c.audit(policy, max_findings=2).unwrap()
  assert_eq(report.entries.map(e => e.name), ["a", "b"])
  assert_eq(report.total_findings, 2)
  assert_false(report.is_clean())
  assert_eq(c.audit(policy, max_findings=1).unwrap_err().name, "b")
  assert_eq(
    c.audit(policy, max_findings=1).unwrap_err().error.code,
    "FindingLimit",
  )
  let empty = @lib.compile_catalog([]).unwrap()
  assert_eq(
    empty.audit(@lib.TemplatePolicy::new(max_level=5)).unwrap_err().error.code,
    "InvalidPolicy",
  )
  assert_eq(
    empty.audit(policy, max_findings=-1).unwrap_err().error.code,
    "InvalidLimit",
  )
  assert_true(empty.audit(policy, max_findings=0).unwrap().is_clean())
  let original = @lib.parse("{+x}").unwrap()
  assert_eq(original.audit(policy)[0].code, "ReservedPolicy")
  assert_eq(
    original.audit_with_limit(policy, max_findings=0).unwrap_err().code,
    "FindingLimit",
  )
}

///|
test "request audit collects independent defects with names and source ranges" {
  let c = @lib.compile_catalog([("user", "/u/{id}"), ("prefix", "{q:2}")]).unwrap()
  let wrong = @lib.Variables::from_entries([("ID", @lib.Scalar("42"))]).unwrap()
  let list = @lib.Variables::from_entries([("q", @lib.List(["abc"]))]).unwrap()
  let jobs = [
    @lib.CatalogRequest::new("user", wrong, required=["id"]),
    @lib.CatalogRequest::new("prefix", list),
    @lib.CatalogRequest::new("unknown", @lib.Variables::new()),
  ]
  let r = c.inspect_requests(jobs, reject_unused=true, max_findings=4).unwrap()
  assert_eq(r.total_findings, 4)
  assert_false(r.is_clean())
  assert_eq(r.requests[0].findings.map(f => f.code), [
    "MissingBinding", "UnusedBinding",
  ])
  assert_eq(r.requests[0].findings[0].variable, "id")
  assert_eq(r.requests[0].findings[0].span.unwrap().start, 4)
  assert_true(r.requests[0].findings[1].span is None)
  assert_eq(r.requests[1].findings[0].code, "PrefixOnComposite")
  assert_eq(r.requests[2].findings[0].code, "UnknownTemplate")
  let limited = c
    .inspect_requests(jobs, reject_unused=true, max_findings=3)
    .unwrap_err()
  assert_eq(limited.index, 2)
  assert_eq(limited.name, "unknown")
  assert_eq(limited.error.code, "FindingLimit")
  let optional = [@lib.CatalogRequest::new("user", @lib.Variables::new())]
  assert_true(c.inspect_requests(optional, max_findings=0).unwrap().is_clean())
}

///|
test "audit budgets count contract metadata and include exact empty boundaries" {
  let t = @lib.parse("{x}").unwrap()
  let vars = @lib.Variables::from_entries([("x", @lib.Scalar("a"))]).unwrap()
  assert_eq(
    t
    .check_contract(
      vars,
      required=["x"],
      limits=@lib.ExpansionLimits::new(max_total_value_codepoints=3),
    )
    .unwrap()
    .length(),
    0,
  )
  assert_eq(
    t
    .check_contract(
      vars,
      required=["x"],
      limits=@lib.ExpansionLimits::new(max_total_value_codepoints=2),
    )
    .unwrap_err().code,
    "TotalValueLimit",
  )
  assert_eq(
    t
    .check_contract(
      vars,
      required=["long"],
      limits=@lib.ExpansionLimits::new(max_value_codepoints=3),
    )
    .unwrap_err().code,
    "ValueLimit",
  )
  assert_eq(
    t
    .check_contract(
      vars,
      required=["x", "x"],
      limits=@lib.ExpansionLimits::new(max_bindings=1),
    )
    .unwrap_err().code,
    "BindingLimit",
  )
  assert_eq(
    t.check_contract(vars, required=["missing", "missing"]).unwrap().length(),
    1,
  )
  let c = @lib.compile_catalog([("t", "{x}")]).unwrap()
  let jobs = [@lib.CatalogRequest::new("t", vars, required=["x"])]
  assert_true(
    c
    .inspect_requests(
      jobs,
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=4),
    )
    .unwrap()
    .is_clean(),
  )
  assert_eq(
    c
    .inspect_requests(
      jobs,
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=3),
    )
    .unwrap_err().error.code,
    "BatchInputLimit",
  )
  assert_eq(
    c
    .inspect_requests([], limits=@lib.ExpansionLimits::new(max_output_bytes=-1))
    .unwrap_err().index,
    -1,
  )
  assert_eq(
    c
    .inspect_requests(jobs, batch_limits=@lib.BatchLimits::new(max_items=0))
    .unwrap_err().error.code,
    "BatchItemLimit",
  )
  assert_true(
    c
    .inspect_requests(
      [],
      max_findings=0,
      batch_limits=@lib.BatchLimits::new(
        max_items=0,
        max_total_input_codepoints=0,
      ),
    )
    .unwrap()
    .is_clean(),
  )
}

///|
test "catalog changes contain detailed upgrade findings" {
  let old = @lib.compile_catalog([("a", "{x}"), ("removed", "/old")]).unwrap()
  let next = @lib.compile_catalog([("a", "{+x:3}"), ("added", "/new")]).unwrap()
  let d = old.diff_contract(next)
  assert_eq(d.added, ["added"])
  assert_eq(d.removed, ["removed"])
  assert_eq(d.changed[0].0, "a")
  assert_true(d.changed[0].1.reserved_added)
  assert_eq(d.changed[0].1.became_scalar_only, ["x"])
  assert_eq(old.diff_contract(old).changed.length(), 0)
}

///|
test "many required variables preserve missing-name precedence" {
  let source = StringBuilder()
  let names : Array[String] = []
  let vars = @lib.Variables::new()
  for i = 0; i < 512; i = i + 1 {
    let name = "x" + i.to_string()
    source.write_string("{")
    source.write_string(name)
    source.write_string("}")
    names.push(name)
    vars.set(name, @lib.Scalar("a"))
  }
  let t = @lib.parse(source.to_string()).unwrap()
  assert_eq(t.measure(vars, required=names).unwrap(), 512)
  assert_eq(
    t.check_contract(vars, required=names, max_findings=0).unwrap().length(),
    0,
  )
  let missing = @lib.Variables::new()
  let error = t
    .measure(missing, required=["x511", "not_in_template"])
    .unwrap_err()
  assert_eq(error.code, "MissingBinding")
  assert_eq(error.span.start, t.variable_profiles()[511].first_span.start)
}
