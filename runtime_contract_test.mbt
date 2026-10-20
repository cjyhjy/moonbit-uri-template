///|
test "compiled validation preserves precedence first occurrence and mutable input" {
  let t = @lib.parse("😀{x}{x:2}{?tags*,y}").unwrap()
  let c = t
    .with_contract([{ name: "tags", kind: @lib.ListKind, }], required=["y", "x"])
    .unwrap()
  let v = @lib.Variables::from_entries([
    ("x", @lib.List([])),
    ("tags", @lib.List(["a"])),
    ("unused", @lib.Scalar("b")),
  ]).unwrap()
  // Implicit prefix shape wins over missing required and unused bindings.
  let shape = c.validate(v).unwrap_err()
  assert_eq(shape.code, "BindingType")
  assert_eq(shape.span.start, 5)
  v.set("x", @lib.Scalar("abc"))
  let missing_y = c.validate(v).unwrap_err()
  assert_eq(missing_y.code, "MissingBinding")
  assert_eq(missing_y.span.start, 17)
  v.set("y", @lib.Scalar(""))
  v.remove("x")
  let missing_x = c.validate(v).unwrap_err()
  assert_eq(missing_x.code, "MissingBinding")
  // Presence refers to the first use, not the later prefix's shape location.
  assert_eq(missing_x.span.start, 2)
  v.set("x", @lib.Scalar("abc"))
  assert_eq(c.validate(v).unwrap_err().code, "UnusedBinding")
  v.remove("unused")
  assert_true(c.validate(v) is Ok(_))
  v.set("tags", @lib.Assoc(@lib.OrderedEntries::from_entries([]).unwrap()))
  assert_eq(c.validate(v).unwrap_err().code, "BindingType")
  v.set("tags", @lib.List([]))
  assert_true(c.validate(v) is Ok(_))
  let required_tags = t
    .with_contract([], required=["tags", "x"], reject_unused=false)
    .unwrap()
  assert_eq(required_tags.validate(v).unwrap_err().code, "OmittedBinding")
  v.set("tags", @lib.List(["a"]))
  assert_true(required_tags.validate(v) is Ok(_))
}

///|
test "runtime contracts reject wrong empty shapes while preserving RFC omission" {
  let t = @lib.parse("/users/{id}{?fields*,filters*}").unwrap()
  let c = t
    .with_contract(
      [
        { name: "id", kind: @lib.ScalarKind, },
        { name: "fields", kind: @lib.ListKind, },
        { name: "filters", kind: @lib.AssocKind, },
      ],
      required=["id"],
    )
    .unwrap()
  let v = @lib.Variables::from_entries([("id", @lib.Scalar(""))]).unwrap()
  assert_eq(c.expand(v).unwrap(), "/users/")
  v.set("fields", @lib.Scalar(""))
  assert_eq(c.expand(v).unwrap_err().code, "BindingType")
  assert_eq(c.measure(v).unwrap_err().code, "BindingType")
  assert_eq(c.expand_mapped(v).unwrap_err().code, "BindingType")
  assert_eq(c.inspect(v).unwrap()[0].variable, "fields")
  v.set("fields", @lib.List([]))
  v.set("filters", @lib.Assoc(@lib.OrderedEntries::from_entries([]).unwrap()))
  assert_eq(c.expand(v).unwrap(), "/users/")
  v.set("fields", @lib.List(["a b", "中文"]))
  v.set(
    "filters",
    @lib.Assoc(@lib.OrderedEntries::from_entries([("sort", "new")]).unwrap()),
  )
  let uri = c.expand(v).unwrap()
  assert_eq(uri, "/users/?fields=a%20b&fields=%E4%B8%AD%E6%96%87&sort=new")
  assert_eq(c.measure(v).unwrap(), uri.length())
  assert_eq(c.expand_mapped(v).unwrap().output, uri)
  v.remove("id")
  assert_eq(c.validate(v).unwrap_err().code, "MissingBinding")
  assert_eq(
    t.expand(v).unwrap(),
    "/users/?fields=a%20b&fields=%E4%B8%AD%E6%96%87&sort=new",
  )
}

///|
test "contract compilation validates rules budgets and captures caller arrays" {
  let t = @lib.parse("{id}{?tags*}").unwrap()
  let rules : Array[@lib.BindingRule] = [{ name: "id", kind: @lib.ScalarKind, }]
  let required = ["id"]
  let c = t.with_contract(rules, required~).unwrap()
  rules.clear()
  required.clear()
  assert_eq(
    c.validate(@lib.Variables::new()).unwrap_err().code,
    "MissingBinding",
  )
  let bad = @lib.Variables::from_entries([("id", @lib.List([]))]).unwrap()
  assert_eq(c.validate(bad).unwrap_err().code, "BindingType")
  assert_eq(
    t.with_contract([{ name: "typo", kind: @lib.ScalarKind, }]).unwrap_err().code,
    "UnknownRule",
  )
  assert_eq(
    t
    .with_contract([
      { name: "id", kind: @lib.ScalarKind, },
      { name: "id", kind: @lib.ListKind, },
    ])
    .unwrap_err().code,
    "DuplicateRule",
  )
  assert_eq(
    t.with_contract([], required=["typo"]).unwrap_err().code,
    "UnknownRequired",
  )
  assert_eq(t.with_contract([], max_rules=-1).unwrap_err().code, "InvalidLimit")
  assert_eq(
    t
    .with_contract([{ name: "id", kind: @lib.ScalarKind, }], max_rules=0)
    .unwrap_err().code,
    "ContractLimit",
  )
  assert_eq(
    t.with_contract([], required=["id"], max_rule_codepoints=1).unwrap_err().code,
    "ContractLimit",
  )
  assert_true(t.with_contract([], max_rules=0, max_rule_codepoints=0) is Ok(_))
}

///|
test "contract errors locate Unicode variables and never copy supplied values" {
  let t = @lib.parse("😀/{id:2}{?x}").unwrap()
  assert_eq(
    t.with_contract([{ name: "id", kind: @lib.ListKind, }]).unwrap_err().code,
    "IncompatibleRule",
  )
  let c = t.with_contract([], required=["id"]).unwrap()
  let v = @lib.Variables::from_entries([("id", @lib.List([]))]).unwrap()
  let error = c.validate(v).unwrap_err()
  assert_eq(error.code, "BindingType")
  assert_eq(error.span.start, 3)
  assert_eq(error.span.end, 7)
  v.set("id", @lib.List(["secret-value"]))
  assert_eq(c.validate(v).unwrap_err().message, "expected a scalar string")
  v.set("id", @lib.Scalar("abc"))
  v.set("extra", @lib.Scalar("secret-value"))
  assert_eq(c.validate(v).unwrap_err().code, "UnusedBinding")
  assert_eq(
    t.with_contract([], reject_unused=false).unwrap().expand(v).unwrap(),
    "%F0%9F%98%80/ab",
  )
}

///|
test "contract input output and finding budgets cover optional and unused bindings" {
  let c = @lib.parse("{x}{?y}")
    .unwrap()
    .with_contract(
      [{ name: "x", kind: @lib.ListKind, }],
      required=["x", "y"],
      reject_unused=false,
    )
    .unwrap()
  let v = @lib.Variables::from_entries([("x", @lib.List([]))]).unwrap()
  assert_eq(c.inspect(v, max_findings=2).unwrap().map(f => f.code), [
    "OmittedBinding", "MissingBinding",
  ])
  assert_eq(c.inspect(v, max_findings=1).unwrap_err().code, "FindingLimit")
  assert_eq(c.inspect(v, max_findings=-1).unwrap_err().code, "InvalidLimit")
  v.set("x", @lib.Scalar("wrong"))
  assert_eq(c.inspect(v).unwrap().map(f => f.code), [
    "MissingBinding", "BindingType",
  ])
  assert_eq(c.inspect(v, max_findings=1).unwrap_err().code, "FindingLimit")
  v.set("x", @lib.List(["a"]))
  v.set("y", @lib.Scalar("b"))
  v.set("unused", @lib.Scalar("0123456789"))
  assert_eq(
    c
    .validate(
      v,
      limits=@lib.ExpansionLimits::new(max_total_value_codepoints=10),
    )
    .unwrap_err().code,
    "TotalValueLimit",
  )
  let exact = @lib.parse("{id}")
    .unwrap()
    .with_contract([], required=["id"])
    .unwrap()
  let one = @lib.Variables::from_entries([("id", @lib.Scalar("1"))]).unwrap()
  let small = @lib.ExpansionLimits::new(max_total_value_codepoints=4)
  assert_eq(
    exact.validate(one, limits=small).unwrap_err().code,
    "TotalValueLimit",
  )
  assert_eq(
    exact.inspect(one, limits=small).unwrap_err().code,
    "TotalValueLimit",
  )
  assert_eq(
    exact.measure(one, limits=small).unwrap_err().code,
    "TotalValueLimit",
  )
  assert_eq(
    exact
    .expand(one, limits=@lib.ExpansionLimits::new(max_total_value_codepoints=5))
    .unwrap(),
    "1",
  )
  v.remove("unused")
  assert_true(
    c.validate(v, limits=@lib.ExpansionLimits::new(max_output_bytes=0)) is Ok(_),
  )
  assert_eq(
    c
    .measure(v, limits=@lib.ExpansionLimits::new(max_output_bytes=0))
    .unwrap_err().code,
    "OutputLimit",
  )
  assert_eq(
    c.expand(v, limits=@lib.ExpansionLimits::new(max_output_bytes=5)).unwrap(),
    "a?y=b",
  )
}
