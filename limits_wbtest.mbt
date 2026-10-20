///|
test "no-presence fast path keeps prefix and budget error precedence" {
  let template = parse("literal/{x:1}/{y:2}").unwrap()
  for
    value in [
      Scalar(""),
      List([]),
      List(["secret"]),
      Assoc(OrderedEntries::from_entries([("a", "b")]).unwrap()),
    ] {
    let vars = Variables::from_entries([("x", value), ("y", List(["b"]))]).unwrap()
    let reported = template.check_bindings(vars).invalid
    let error = template
      .measure(vars, limits=ExpansionLimits::new(max_output_bytes=0))
      .unwrap_err()
    assert_eq(error.code, reported[0].code)
    assert_eq(error.span.start, reported[0].span.start)
    assert_eq(error.span.end, reported[0].span.end)
    assert_eq(
      template
      .measure(vars, limits=ExpansionLimits::new(max_bindings=0))
      .unwrap_err().code,
      "BindingLimit",
    )
  }
  let omitted = Variables::from_entries([("x", List([]))]).unwrap()
  assert_eq(template.measure(omitted).unwrap(), 9)
}

///|
test "input text accounting agrees with character iterator at every boundary" {
  // Independent semantic oracle uses the public Unicode character iterator.
  // Exhaust both budgets, including ties where individual overflow wins.
  for text in ["", "a", "中文", "😀", "a😀中😎z", "\u{0}", "e\u{301}"] {
    let size = text.iter().count()
    for individual = 0; individual <= size + 1; individual = individual + 1 {
      for total = 0; total <= size + 1; total = total + 1 {
        let mut left = individual
        let mut remaining = total
        let mut expected = total
        for _ in text.iter() {
          if left == 0 {
            expected = -1
            break
          }
          if remaining == 0 {
            expected = -2
            break
          }
          left = left - 1
          remaining = remaining - 1
          expected = remaining
        }
        assert_eq(consume_input_text(text, individual, total), expected)
      }
    }
    assert_eq(
      consume_input_text(text, 2147483647, 2147483647),
      2147483647 - size,
    )
  }
}
