///|
test "parse budgets zero exact unicode and aggregate" {
  let cases = [
    (
      "",
      @lib.ParseLimits::new(max_template_codepoints=0, max_expressions=0),
      "",
    ),
    ("😀", @lib.ParseLimits::new(max_template_codepoints=1), ""),
    ("😀x", @lib.ParseLimits::new(max_template_codepoints=1), "TemplateLimit"),
    ("{x}", @lib.ParseLimits::new(max_expressions=0), "ExpressionLimit"),
    (
      "{x}",
      @lib.ParseLimits::new(
        max_expressions=1,
        max_total_variables=1,
        max_variables_per_expression=1,
      ),
      "",
    ),
    ("{x}{y}", @lib.ParseLimits::new(max_expressions=1), "ExpressionLimit"),
    (
      "{x,x}",
      @lib.ParseLimits::new(max_variables_per_expression=1),
      "VariableLimit",
    ),
    ("{x}{x}", @lib.ParseLimits::new(max_total_variables=1), "VariableLimit"),
    ("{x}", @lib.ParseLimits::new(max_total_variables=0), "VariableLimit"),
    ("", @lib.ParseLimits::new(max_template_codepoints=-1), "InvalidLimit"),
  ]
  for (source, limits, code) in cases {
    let result = @lib.parse_with_limits(source, limits)
    if code == "" {
      assert_true(result is Ok(_))
    } else {
      assert_eq(result.unwrap_err().code, code)
    }
  }
  assert_eq(
    @lib.parse_with_limits("'", @lib.ParseLimits::new(), strict=true).unwrap_err().code,
    "InvalidLiteral",
  )
}

///|
test "streaming exact output boundaries for every operator and value shape" {
  let shapes = [
    @lib.Scalar(""),
    @lib.Scalar("a /😀%20%ZZ"),
    @lib.List([]),
    @lib.List([""]),
    @lib.List(["", "中文", "%20"]),
    @lib.Assoc(@lib.OrderedEntries::from_entries([]).unwrap()),
    @lib.Assoc(
      @lib.OrderedEntries::from_entries([("", ""), ("a/b", "😀%20")]).unwrap(),
    ),
  ]
  for op in ["", "+", "#", ".", "/", ";", "?", "&"] {
    for modifier in ["", "*"] {
      for value in shapes {
        let vars = @lib.Variables::from_entries([("x", value)]).unwrap()
        for
          source in [
            "{" + op + "x" + modifier + "}",
            "😀/{" + op + "x" + modifier + ",x" + modifier + "}/end",
          ] {
          let t = @lib.parse(source).unwrap()
          let expected = t.expand(vars).unwrap()
          let size = expected.length()
          assert_eq(
            t
            .expand_with_limits(
              vars,
              @lib.ExpansionLimits::new(max_output_bytes=size),
            )
            .unwrap(),
            expected,
          )
          if size > 0 {
            let error = t
              .expand_with_limits(
                vars,
                @lib.ExpansionLimits::new(max_output_bytes=size - 1),
              )
              .unwrap_err()
            assert_eq(error.code, "OutputLimit")
            assert_true(error.span.end >= error.span.start)
          }
        }
      }
    }
  }
}

///|
test "output prefix percent escapes literals and failed call isolation" {
  let vars = @lib.Variables::from_entries([
    ("x", @lib.Scalar("%F0%9F%98%80rest")),
  ]).unwrap()
  let t = @lib.parse("{+x:12}").unwrap()
  assert_eq(
    t
    .expand_with_limits(vars, @lib.ExpansionLimits::new(max_output_bytes=12))
    .unwrap(),
    "%F0%9F%98%80",
  )
  assert_eq(
    t
    .expand_with_limits(vars, @lib.ExpansionLimits::new(max_output_bytes=11))
    .unwrap_err().code,
    "OutputLimit",
  )
  assert_eq(
    t
    .expand_with_limits(vars, @lib.ExpansionLimits::new(max_output_bytes=12))
    .unwrap(),
    "%F0%9F%98%80",
  )
  let e = @lib.parse("😀")
    .unwrap()
    .expand_with_limits(
      @lib.Variables::new(),
      @lib.ExpansionLimits::new(max_output_bytes=11),
    )
    .unwrap_err()
  assert_eq(e.span.start, 0)
  assert_eq(e.span.end, 1)
}

///|
test "input budgets include unused names keys and combined collections" {
  let vars = @lib.Variables::from_entries([
    ("x", @lib.List(["😀", "b"])),
    ("unused", @lib.Scalar("s")),
  ]).unwrap()
  let t = @lib.parse("{x}").unwrap()
  for
    (limits, code) in [
      (@lib.ExpansionLimits::new(max_bindings=1), "BindingLimit"),
      (@lib.ExpansionLimits::new(max_members=1), "MemberLimit"),
      (@lib.ExpansionLimits::new(max_value_codepoints=5), "ValueLimit"),
      (
        @lib.ExpansionLimits::new(max_total_value_codepoints=9),
        "TotalValueLimit",
      ),
      (@lib.ExpansionLimits::new(max_output_bytes=-1), "InvalidLimit"),
    ] {
    assert_eq(t.expand_with_limits(vars, limits).unwrap_err().code, code)
  }
  assert_eq(
    t
    .expand_with_limits(
      vars,
      @lib.ExpansionLimits::new(max_total_value_codepoints=10),
    )
    .unwrap(),
    "%F0%9F%98%80,b",
  )
  let assoc = @lib.Variables::from_entries([
    (
      "x",
      @lib.Assoc(@lib.OrderedEntries::from_entries([("longkey", "")]).unwrap()),
    ),
  ]).unwrap()
  assert_eq(
    t
    .expand_with_limits(
      assoc,
      @lib.ExpansionLimits::new(max_value_codepoints=6),
    )
    .unwrap_err().code,
    "ValueLimit",
  )
  let empty = @lib.Variables::new()
  assert_eq(
    @lib.parse("")
    .unwrap()
    .expand_with_limits(
      empty,
      @lib.ExpansionLimits::new(
        max_bindings=0,
        max_members=0,
        max_value_codepoints=0,
        max_total_value_codepoints=0,
        max_output_bytes=0,
      ),
    )
    .unwrap(),
    "",
  )
}

///|
test "input budgets reject hostile repetitions without expanded allocation" {
  let vars = @lib.Variables::new()
  vars.set("x", @lib.List(Array::make(10000, "😀")))
  let t = @lib.parse("{?x*,x*,x*}").unwrap()
  assert_eq(
    t
    .expand_with_limits(vars, @lib.ExpansionLimits::new(max_output_bytes=10))
    .unwrap_err().code,
    "OutputLimit",
  )
  assert_eq(
    t
    .check_bindings_with_limits(
      vars,
      @lib.ExpansionLimits::new(max_members=9999),
    )
    .unwrap_err().code,
    "MemberLimit",
  )
}
