///|
test "adapter typed values null and stable associative order" {
  let vars = @json.parse_variables(
    "{\"id\":\"42\",\"tags\":[\"a\",\"b\"],\"keys\":{\"z\":\"2\",\"a\":\"1\",\"skip\":null},\"missing\":null}",
  ).unwrap()
  assert_eq(
    @template.expand("/users/{id}{?tags*,keys*,missing}", vars).unwrap(),
    "/users/42?tags=a&tags=b&a=1&z=2",
  )
}

///|
test "adapter input errors retain JSON pointers" {
  let cases = [
    ("[]", "ExpectedObject", ""),
    ("{", "InvalidJson", ""),
    ("{\"id\":42}", "InvalidValueType", "/id"),
    ("{\"ok\":true}", "InvalidValueType", "/ok"),
    ("{\"items\":[null]}", "InvalidValueType", "/items/0"),
    ("{\"a/b~\":{\"x/y\":[]}}", "InvalidValueType", "/a~1b~0/x~1y"),
  ]
  for (source, code, path) in cases {
    let e = @json.parse_variables(source).unwrap_err()
    assert_eq(e.code, code)
    assert_eq(e.path, path)
  }
}

///|
test "request envelope separates successful outputs from errors" {
  let sources = [
    ("expand", "{x}", "{\"x\":\"a/b\"}", 0),
    ("expand", "{x:1}", "{\"x\":[\"a\"]}", 1),
    ("expand", "{x}", "{\"x\":false}", 2),
    ("validate", "{x", "{}", 1),
    ("variables", "{x,x}{?y}", "{}", 0),
    ("invalid", "{x}", "{}", 2),
    ("validate-strict", "'{x}'", "{}", 1),
    ("validate-strict", "{+x}", "{}", 0),
  ]
  for (command, source, vars, code) in sources {
    let response = @jsonlib.parse(@json.request(command, source, vars))
    guard response is Object(fields) else { fail("expected response object") }
    assert_eq(fields.get("exitCode"), Some(Json::number(code.to_double())))
    if code == 0 {
      assert_true(fields.get("error") is None)
    } else {
      assert_true(fields.get("output") is None)
    }
  }
}
