///|
test "runtime shape bridge rejects empty wrong kinds and reports type-only changes" {
  let typed = @json.prepare_request(
    "/{id}{?tags*}", "{\"required\":[\"id\"],\"types\":{\"id\":\"scalar\",\"tags\":\"list\"}}",
  )
  for command in ["expand", "measure", "trace"] {
    assert_true(typed.call(command, "{\"id\":[]}").contains("BindingType"))
    assert_true(
      typed
      .call(command, "{\"id\":\"42\",\"tags\":\"SECRET\"}")
      .contains("BindingType"),
    )
    assert_false(
      typed
      .call(command, "{\"id\":\"42\",\"tags\":\"SECRET\"}")
      .contains("SECRET"),
    )
  }
  assert_true(
    typed.inspect("{\"id\":\"42\",\"tags\":\"\"}", 1).contains("BindingType"),
  )
  assert_true(
    typed.inspect("{\"id\":\"42\",\"tags\":\"\"}", 0).contains("FindingLimit"),
  )
  assert_true(typed.call("expand", "{\"id\":\"42\"}").contains("/42"))
  let newer = @json.prepare_request(
    "/{id}{?tags*}", "{\"required\":[\"id\"],\"types\":{\"id\":\"scalar\",\"tags\":\"scalar\"}}",
  )
  let diff = typed.compare(newer)
  assert_true(diff.contains("typeChanges"))
  assert_true(diff.contains("list") && diff.contains("scalar"))
  assert_true(
    @json.prepare_request("/{id}", "{\"types\":{\"typo\":\"scalar\"}}")
    .call("variables", "{}")
    .contains("UnknownRule"),
  )
}

///|
test "prepared contract inspection separates optional omissions and bounded findings" {
  let request = @json.prepare_request(
    "/{id}{?page}", "{\"required\":[\"id\"],\"rejectUnused\":true}",
  )
  let clean = @jsonlib.parse(request.inspect("{\"id\":\"42\"}", 0))
  guard clean is Object(clean_fields) else { fail("expected envelope") }
  assert_eq(clean_fields.get("output"), Some(Json::string("[]")))
  let issues = request.inspect("{\"typo\":\"SECRET\"}", 2)
  assert_true(issues.contains("MissingBinding"))
  assert_true(issues.contains("UnusedBinding"))
  assert_true(!issues.contains("SECRET"))
  let limited = @jsonlib.parse(request.inspect("{}", 0))
  guard limited is Object(fields) else { fail("expected envelope") }
  guard fields.get("error") is Some(Object(error)) else {
    fail("expected error")
  }
  assert_eq(error.get("code"), Some(Json::string("FindingLimit")))
  assert_eq(error.get("start"), None)
}

///|
test "prepared policy bridge validates fields and bounds reports" {
  let request = @json.prepare_request("/{+id}", "{}")
  assert_true(
    request.audit("{\"allowReserved\":false}", 1).contains("ReservedPolicy"),
  )
  assert_true(
    request.audit("{\"allowReserved\":false}", 0).contains("FindingLimit"),
  )
  for
    policy in [
      "{\"typo\":true}", "{\"allowReserved\":\"no\"}", "{\"maxReferences\":-1}",
      "{\"allowedVariables\":[1]}", "{\"maxLevel\":5}",
    ] {
    let response = @jsonlib.parse(request.audit(policy, 10))
    guard response is Object(fields) else { fail("expected envelope") }
    guard fields.get("error") is Some(Object(error)) else {
      fail("expected error")
    }
    assert_eq(error.get("code"), Some(Json::string("InvalidPolicy")))
    assert_eq(error.get("start"), None)
  }
  let allowed = @jsonlib.parse(
    request.audit("{\"allowedVariables\":[\"id\"]}", 0),
  )
  guard allowed is Object(fields) else { fail("expected envelope") }
  assert_eq(fields.get("output"), Some(Json::string("[]")))
}

///|
test "adapter typed values null and stable associative order" {
  let vars = @json.parse_variables(
    "{\"id\":\"42\",\"tags\":[\"a\",\"b\"],\"keys\":{\"z\":\"2\",\"a\":\"1\",\"skip\":null},\"missing\":null}",
  ).unwrap()
  assert_eq(
    @template.expand("/users/{id}{?tags*,keys*,missing}", vars).unwrap(),
    "/users/42?tags=a&tags=b&z=2&a=1",
  )
}

///|
test "adapter input errors retain JSON pointers" {
  let cases = [
    ("[]", "ExpectedObject", ""),
    ("{", "InvalidJson", ""),
    ("{\"id\":[[]]}", "InvalidValueType", "/id/0"),
    ("{\"ok\":{\"k\":[]}}", "InvalidValueType", "/ok/k"),
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
    ("expand", "{x}", "{\"x\":[{}]}", 2),
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

///|
test "bounded bridge rejects budgets and deeply nested JSON before parsing" {
  let cases = [
    ("{x}", "{\"x\":\"😀\"}", "{\"maxOutput\":11}", "OutputLimit"),
    ("{x}", "{}", "{\"requireAll\":true}", "MissingBinding"),
    ("{x}", "{\"x\":[]}", "{\"required\":[\"x\"]}", "OmittedBinding"),
    ("{x}", "{\"x\":\"\"}", "{\"maxJson\":0}", "JsonInputLimit"),
    ("{x}", "{\"x\":[[[]]]}", "{\"maxJsonDepth\":2}", "JsonDepthLimit"),
    ("{x}", "{}", "{\"maxOutput\":-1}", "InvalidOptions"),
    ("{x}", "{}", "{\"strict\":\"yes\"}", "InvalidOptions"),
    ("{x}", "{}", "{\"unknown\":1}", "InvalidOptions"),
  ]
  for (source, vars, options, code) in cases {
    let response = @jsonlib.parse(
      @json.request_with_options("expand", source, vars, options),
    )
    guard response is Object(fields) else { fail("expected envelope") }
    guard fields.get("error") is Some(Object(error)) else {
      fail("expected error")
    }
    assert_eq(error.get("code"), Some(Json::string(code)))
    assert_eq(fields.get("output"), None)
  }
}

///|
test "bounded bridge preflight reports names and never values" {
  let output = @json.request_with_options(
    "check", "{x}{?empty}", "{\"empty\":[],\"unused\":\"SECRET\"}", "{}",
  )
  assert_true(!output.contains("SECRET"))
  assert_true(output.contains("missing"))
  assert_true(output.contains("omitted"))
  let result = @jsonlib.parse(output)
  guard result is Object(fields) else { fail("expected envelope") }
  assert_eq(fields.get("exitCode"), Some(Json::number(0)))
}

///|
test "adapter converts numbers and booleans to their JSON text" {
  let vars = @json.parse_variables(
    "{\"id\":42,\"ratio\":1.5,\"big\":12345678901234567890,\"on\":true,\"ids\":[1,2],\"f\":{\"x\":false}}",
  ).unwrap()
  assert_eq(
    @template.expand("/{id}{?ratio,big,on,ids,f*}", vars).unwrap(),
    "/42?ratio=1.5&big=12345678901234567890&on=true&ids=1,2&x=false",
  )
}
