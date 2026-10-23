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
    api.expand("math", { "formulas": { "a": "x+y", "b": "x/y", "c": "x^y" } }),
    Ok("/math?a=x%2By&b=x%2Fy&c=x%5Ey"),
  )
  assert_eq(
    api.expand("GET /math", { "words": ["math", "is", "fun"] }),
    Ok("/math?words=math&words=is&words=fun"),
  )
  assert_true(api.get("unknown") is Err({ code: "UnknownOperation", .. }))
  assert_true(
    api.expand("math", { "other": 1 }) is Err({ code: "UnknownParameter", .. }),
  )
  assert_true(
    api.expand("math", { "words": "wrong" }) is Err({ code: "BindingType", .. }),
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
    api.expand("op", { "id": "a b", "q[x]": "c/d", "Accept": "ok" }),
    Ok("https://example.com/a/;id=a%20b?q%5Bx%5D=c%2Fd"),
  )
  assert_true(
    api.expand("op", { "q[x]": "c" }) is Err({ code: "MissingBinding", .. }),
  )
  assert_true(
    api.expand("op", { "id": ["x"] }) is Err({ code: "BindingType", .. }),
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
  assert_eq(api.expand("op", {}), Ok("/q"))
  assert_true(
    api.expand("op", { "deep": { "a": "b" } })
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
    compile(missing).unwrap().expand("op", {})
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
  assert_eq(api.expand("optional", {}), Ok("/q"))
  assert_true(api.expand("required", {}) is Err({ code: "MissingBinding", .. }))
}

///|
test "host binding selection preserves undefined names and skips request headers" {
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/q": {
        "get": {
          "parameters": [
            { "name": "q[x]", "in": "query" },
            { "name": "Accept", "in": "header" },
            { "name": "deep", "in": "query", "style": "deepObject" },
          ],
        },
      },
    },
  }
  let api = compile(doc).unwrap()
  assert_eq(
    api.binding_names("GET /q", [("q[x]", false), ("Accept", true)]),
    Ok([("q[x]", "q%5Bx%5D")]),
  )
  assert_eq(api.binding_names("GET /q", [("deep", false)]), Ok([]))
  assert_true(
    api.binding_names("GET /q", [("deep", true)])
    is Err({ code: "UnsupportedParameter", .. }),
  )
  assert_true(
    api.binding_names("GET /q", [("unknown", false)])
    is Err({ code: "UnknownParameter", .. }),
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
  if snapshot is Object(m) {
    m["template"] = Json::string("/changed")
  }
  let ops = api.analysis().operations()
  if ops[0] is Object(m) {
    m["template"] = Json::string("/changed")
  }
  assert_eq(api.expand("GET /q", { "q": "a" }), Ok("/q?q=a"))
}
