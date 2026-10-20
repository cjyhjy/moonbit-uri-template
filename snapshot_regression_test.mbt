///|
test "retained snapshots survive removals reinsertion and caller mutation" {
  let definitions = []
  let vars = @lib.Variables::new()
  for i = 0; i < 130; i = i + 1 {
    let name = "v" + i.to_string()
    definitions.push((name, "{" + name + "}"))
    vars.set(name, @lib.Scalar("a"))
  }
  let catalog = @lib.compile_catalog(definitions).unwrap()
  let initial = catalog
    .start_session(vars, max_total_output_bytes=2000)
    .unwrap()
  let history = [initial]
  let expected = [initial.links()]
  let mut current = initial
  for i = 0; i < 130; i = i + 1 {
    let name = "v" + i.to_string()
    let list = ["😀", "b"]
    let patch = if i % 2 == 0 {
      vars.remove(name)
      [@lib.RemoveBinding(name)]
    } else {
      vars.set(name, @lib.List(list))
      [@lib.SetBinding(name, @lib.List(list))]
    }
    current = current.update(patch).unwrap().session()
    list[0] = "caller mutation"
    assert_eq(current.links(), catalog.start_session(vars).unwrap().links())
    if i % 13 == 0 {
      assert_eq(
        current
        .update([@lib.SetBinding(name, @lib.Scalar(String::make(2001, 'x')))])
        .unwrap_err().error.code,
        "SessionOutputLimit",
      )
    }
    history.push(current)
    expected.push(current.links())
  }
  let patch = []
  for i = 0; i < 130; i = i + 1 {
    let name = "v" + i.to_string()
    patch.push(@lib.SetBinding(name, @lib.Scalar("z")))
    vars.set(name, @lib.Scalar("z"))
  }
  let restored = current.update(patch).unwrap()
  assert_eq(restored.recomputed(), 130)
  assert_eq(
    restored.session().links(),
    catalog.start_session(vars).unwrap().links(),
  )
  for index, snapshot in history {
    assert_eq(snapshot.links(), expected[index])
    // Reuse old bindings too: cached URI equality alone cannot detect aliasing
    // of the private values that a future branch would read.
    for probe in [0, 31, 32, 63, 64, 129] {
      let name = "v" + probe.to_string()
      let identical = if probe >= index {
        @lib.SetBinding(name, @lib.Scalar("a"))
      } else if probe % 2 == 0 {
        @lib.RemoveBinding(name)
      } else {
        @lib.SetBinding(name, @lib.List(["😀", "b"]))
      }
      assert_eq(snapshot.update([identical]).unwrap().recomputed(), 0)
    }
  }
}

///|
test "catalog audit metadata matches inspection and names remain detached" {
  let sources = ["plain", "{x}", "{+x}", "{#x}", "{?x,y}", "{x:2}", "{x,x*}"]
  let definitions = []
  for i = 0; i < 70; i = i + 1 {
    definitions.push(
      ("n" + i.to_string(), "😀/" + sources[i % sources.length()]),
    )
  }
  let catalog = @lib.compile_catalog(definitions).unwrap()
  let names = catalog.names()
  catalog.names().clear()
  assert_eq(catalog.names(), names)
  let levels = [0, 1, 2, 2, 3, 4, 4]
  for i = 0; i < 70; i = i + 1 {
    assert_eq(catalog.get("n" + i.to_string()).unwrap().level(), levels[i % 7])
  }
  for level = 0; level <= 4; level = level + 1 {
    let policy = @lib.TemplatePolicy::new(
      max_level=level,
      allow_reserved=false,
      allow_fragment=false,
      allow_prefix=false,
      allow_explode=false,
      forbid_repeated_variables=true,
      max_references=1,
      allowed_variables=Some(["x"]),
    )
    let audit = catalog.audit(policy, max_findings=4096).unwrap()
    let mut total = 0
    for entry in audit.entries {
      let template = catalog.get(entry.name).unwrap()
      let inspected = template.inspect()
      assert_eq(entry.expression_count, inspected.length())
      assert_eq(entry.variable_count, template.variables().length())
      let mut expected_level = 0
      for expression in inspected {
        expected_level = Int32::max(expected_level, expression.level)
      }
      assert_eq(entry.max_level, expected_level)
      let expected = template.audit(policy)
      assert_eq(
        entry.findings.map(e => (e.code, e.span.start, e.span.end)),
        expected.map(e => (e.code, e.span.start, e.span.end)),
      )
      total = total + expected.length()
    }
    assert_eq(audit.total_findings, total)
    assert_true(catalog.audit(policy, max_findings=total) is Ok(_))
    assert_eq(
      catalog.audit(policy, max_findings=total - 1).unwrap_err().error.code,
      "FindingLimit",
    )
  }
}

///|
test "batch input accounting keeps Unicode names keys unused values and priority" {
  let vars = @lib.Variables::from_entries([
    ("x", @lib.Scalar("😀")),
    (
      "u",
      @lib.Assoc(@lib.OrderedEntries::from_entries([("中", "😎")]).unwrap()),
    ),
  ]).unwrap()
  // Input is five code points; the catalog request name contributes another two.
  let template = @lib.parse("{x}").unwrap()
  let catalog = @lib.compile_catalog([("中😀", "{x}")]).unwrap()
  let requests = [@lib.CatalogRequest::new("中😀", vars)]
  assert_true(
    template.expand_batch(
      [vars],
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=5),
    )
    is Ok(_),
  )
  assert_eq(
    template
    .expand_batch(
      [vars],
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=4),
    )
    .unwrap_err().error.code,
    "BatchInputLimit",
  )
  assert_true(
    catalog.expand_batch(
      requests,
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=7),
    )
    is Ok(_),
  )
  assert_eq(
    catalog
    .expand_batch(
      requests,
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=6),
    )
    .unwrap_err().error.code,
    "BatchInputLimit",
  )
  assert_eq(
    catalog
    .expand_batch(
      requests,
      limits=@lib.ExpansionLimits::new(max_value_codepoints=0),
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=0),
    )
    .unwrap_err().error.code,
    "ValueLimit",
  )
}
