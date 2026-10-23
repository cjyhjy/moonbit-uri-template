///|
test "Appendix C.4.1 native compiled expansion and lookup" {
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/math": {
        "get": {
          "operationId": "math",
          "parameters": [
            {
              "name": "formulas",
              "in": "query",
              "schema": { "type": "object" },
              "explode": true,
            },
            { "name": "words", "in": "query", "schema": { "type": "array" } },
          ],
        },
      },
    },
  }
  let api = compile(doc).unwrap()
  assert_eq(
    api.expand(
      "math",
      bindings({ "formulas": { "a": "x+y", "b": "x/y", "c": "x^y" } }).unwrap(),
    ),
    Ok("/math?a=x%2By&b=x%2Fy&c=x%5Ey"),
  )
  assert_eq(
    api.expand(
      "GET /math",
      bindings({ "words": ["math", "is", "fun"] }).unwrap(),
    ),
    Ok("/math?words=math&words=is&words=fun"),
  )
  assert_true(api.get("unknown") is Err({ code: "UnknownOperation", .. }))
  assert_true(
    api.expand("math", bindings({ "other": 1 }).unwrap())
    is Err({ code: "UnknownParameter", .. }),
  )
  assert_true(
    api.expand("math", bindings({ "words": "wrong" }).unwrap())
    is Err({ code: "BindingType", .. }),
  )
}

///|
test "native names, path styles and percent-encoded query names" {
  for
    (name, expected) in [
      ("per_page", "per_page"),
      ("a.b", "a.b"),
      ("filter[status]", "filter%5Bstatus%5D"),
      ("user-id", "user%2Did"),
      ("中", "%E4%B8%AD"),
      (".a", "%2Ea"),
    ] {
    assert_eq(template_name(name), expected)
  }
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/a/{id}": {
        "get": {
          "operationId": "op",
          "parameters": [
            {
              "name": "id",
              "in": "path",
              "required": true,
              "style": "matrix",
              "schema": { "type": "string" },
            },
            { "name": "q[x]", "in": "query", "schema": { "type": "string" } },
            { "name": "Accept", "in": "header" },
          ],
        },
      },
    },
  }
  let api = compile(doc, base_url="https://example.com///").unwrap()
  assert_eq(
    api.expand(
      "op",
      bindings({ "id": "a b", "q[x]": "c/d", "Accept": "ok" }).unwrap(),
    ),
    Ok("https://example.com/a/;id=a%20b?q%5Bx%5D=c%2Fd"),
  )
  assert_true(
    api.expand("op", bindings({ "q[x]": "c" }).unwrap())
    is Err({ code: "MissingBinding", .. }),
  )
  assert_true(
    api.expand("op", bindings({ "id": ["x"] }).unwrap())
    is Err({ code: "BindingType", .. }),
  )
}

///|
test "native unsupported parameters and strict compilation" {
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/q": {
        "get": {
          "operationId": "op",
          "parameters": [
            { "name": "deep", "in": "query", "style": "deepObject" },
          ],
        },
      },
    },
  }
  let api = compile(doc).unwrap()
  assert_eq(api.expand("op", @core.Variables::new()), Ok("/q"))
  assert_true(
    api.expand("op", bindings({ "deep": { "a": "b" } }).unwrap())
    is Err({ code: "UnsupportedParameter", .. }),
  )
  let missing : Json = {
    "openapi": "3.1.0",
    "paths": { "/a/{id}": { "get": { "operationId": "op" } } },
  }
  assert_true(
    compile(missing, strict=true) is Err({ code: "OpenApiInvalid", .. }),
  )
  assert_true(
    compile(missing).unwrap().expand("op", @core.Variables::new())
    is Err({ code: "UnsupportedOperation", .. }),
  )
  assert_true(
    compile({ "openapi": "2.0" }) is Err({ code: "OpenApiInvalid", .. }),
  )
  assert_true(analyze_text("{") is Err({ code: "InvalidJson", .. }))
}

///|
test "same source with different operation contracts does not share cached contract" {
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/q": {
        "get": {
          "operationId": "optional",
          "parameters": [
            { "name": "q", "in": "query", "schema": { "type": "string" } },
          ],
        },
        "post": {
          "operationId": "required",
          "parameters": [
            {
              "name": "q",
              "in": "query",
              "required": true,
              "schema": { "type": "string" },
            },
          ],
        },
      },
    },
  }
  let api = compile(doc).unwrap()
  assert_eq(api.expand("optional", @core.Variables::new()), Ok("/q"))
  assert_true(
    api.expand("required", @core.Variables::new())
    is Err({ code: "MissingBinding", .. }),
  )
}

///|
test "public analysis and operation snapshots cannot mutate compiled state" {
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/q": { "get": { "parameters": [{ "name": "q", "in": "query" }] } },
    },
  }
  let api = compile(doc).unwrap()
  let snapshot = api.get("GET /q").unwrap()
  snapshot.parameters[0] = {
    name: "broken",
    location: Query,
    required: false,
    shape: None,
    variable: None,
  }
  let ops = api.analysis().operations()
  ops[0].parameters[0] = {
    name: "broken",
    location: Query,
    required: false,
    shape: None,
    variable: None,
  }
  assert_eq(api.expand("GET /q", bindings({ "q": "a" }).unwrap()), Ok("/q?q=a"))
}
