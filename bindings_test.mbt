///|
test "preflight distinguishes absent empty collections and empty scalar" {
  let vars = @lib.Variables::from_entries([
    ("empty", @lib.List([])),
    ("present", @lib.Scalar("")),
    ("z", @lib.Scalar("secret")),
    ("a", @lib.Scalar("secret")),
  ]).unwrap()
  let t = @lib.parse("😀/{id}{?empty,present,id}").unwrap()
  let report = t.check_bindings(vars).unwrap()
  assert_eq(report.referenced, ["id", "empty", "present"])
  assert_eq(report.missing.length(), 1)
  assert_eq(report.missing[0].name, "id")
  assert_eq(report.missing[0].span.start, 3)
  assert_eq(report.omitted[0].name, "empty")
  assert_eq(report.unused, ["a", "z"])
  assert_eq(t.expand(vars).unwrap(), "%F0%9F%98%80/?present=")
  assert_eq(t.expand(vars, required=["id"]).unwrap_err().code, "MissingBinding")
  assert_eq(
    t.expand(vars, required=["empty"]).unwrap_err().code,
    "OmittedBinding",
  )
  assert_true(t.expand(vars, required=["present"]) is Ok(_))
  assert_eq(
    t.expand(vars, required=["typo"]).unwrap_err().code,
    "UnknownRequired",
  )
  assert_eq(
    t.expand(vars, reject_unused=true).unwrap_err().code,
    "UnusedBinding",
  )
}

///|
test "preflight finds every prefix mismatch and encoded names stay distinct" {
  let vars = @lib.Variables::from_entries([
    ("x", @lib.List(["one"])),
    ("a", @lib.Scalar("A")),
  ]).unwrap()
  let t = @lib.parse("{x}{x:1}{x:2}{a}{%61}").unwrap()
  let report = t.check_bindings(vars).unwrap()
  assert_eq(report.invalid.length(), 2)
  assert_eq(report.invalid[0].span.start, 4)
  assert_eq(report.invalid[1].span.start, 9)
  assert_eq(report.missing[0].name, "%61")
  assert_eq(t.expand(vars).unwrap_err().code, "PrefixOnComposite")
  vars.set("x", @lib.List([]))
  assert_eq(t.check_bindings(vars).unwrap().invalid.length(), 0)
}

///|
test "one call binding construction copies collections and rejects duplicates" {
  let items = ["a"]
  let vars = @lib.Variables::from_entries([("x", @lib.List(items))]).unwrap()
  items[0] = "changed"
  assert_eq(@lib.expand("{x}", vars).unwrap(), "a")
  assert_eq(
    @lib.Variables::from_entries([
      ("x", @lib.Scalar("a")),
      ("x", @lib.Scalar("b")),
    ]).unwrap_err().code,
    "DuplicateBinding",
  )
}
