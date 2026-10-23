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

///|
test "required unsupported query parameters cannot be omitted" {
  for required in [false, true] {
    let doc : Json = {
      "openapi": "3.1.0",
      "paths": {
        "/search": {
          "get": {
            "operationId": "search",
            "parameters": [
              {
                "name": "filter",
                "in": "query",
                "style": "deepObject",
                "required": required,
                "schema": { "type": "object" },
              },
            ],
          },
        },
      },
    }
    for strict in [false, true] {
      let api = compile(doc, strict~).unwrap()
      if required {
        assert_true(
          api.expand("search", @core.Variables::new())
          is Err({ code: "UnsupportedParameter", path: "/filter", .. }),
        )
      } else {
        assert_eq(api.expand("search", @core.Variables::new()), Ok("/search"))
      }
      assert_true(
        api.expand("search", bindings({ "filter": { "a": "b" } }).unwrap())
        is Err({ code: "UnsupportedParameter", path: "/filter", .. }),
      )
    }
  }
}

///|
test "URL bindings take precedence over same-name header and cookie parameters" {
  for location in ["header", "cookie"] {
    for url_location in ["path", "query"] {
      for ignored_first in [false, true] {
        let ignored : Json = {
          "name": "id",
          "in": location,
          "required": true,
          "schema": { "type": "object" },
        }
        let url : Json = {
          "name": "id",
          "in": url_location,
          "required": true,
          "schema": {
            "type": if url_location == "path" {
              "string"
            } else {
              "array"
            },
          },
        }
        let parameters = Json::array(
          if ignored_first {
            [ignored, url]
          } else {
            [url, ignored]
          },
        )
        let operation : Json = { "operationId": "op", "parameters": parameters }
        let paths : Json = if url_location == "path" {
          { "/a/{id}": { "get": operation } }
        } else {
          { "/a": { "get": operation } }
        }
        let api = compile({ "openapi": "3.1.0", "paths": paths }, strict=true).unwrap()
        assert_true(
          api.expand("op", @core.Variables::new())
          is Err({ code: "MissingBinding", .. }),
        )
        if url_location == "path" {
          assert_eq(
            api.expand("op", bindings({ "id": "x y" }).unwrap()),
            Ok("/a/x%20y"),
          )
          assert_true(
            api.expand("op", bindings({ "id": ["x", "y"] }).unwrap())
            is Err({ code: "BindingType", .. }),
          )
        } else {
          assert_eq(
            api.expand("op", bindings({ "id": ["x", "y"] }).unwrap()),
            Ok("/a?id=x&id=y"),
          )
          assert_true(
            api.expand("op", bindings({ "id": "x" }).unwrap())
            is Err({ code: "BindingType", .. }),
          )
        }
      }
    }
  }
}

///|
test "required non-URL parameters do not make same-name optional query bindings required" {
  for location in ["header", "cookie"] {
    let api = compile({
      "openapi": "3.1.0",
      "paths": {
        "/q": {
          "get": {
            "parameters": [
              {
                "name": "id",
                "in": location,
                "required": true,
                "schema": { "type": "array" },
              },
              { "name": "id", "in": "query", "schema": { "type": "string" } },
              { "name": "trace", "in": location, "required": true },
            ],
          },
        },
      },
    }).unwrap()
    assert_eq(api.expand("GET /q", @core.Variables::new()), Ok("/q"))
    assert_eq(
      api.expand("GET /q", bindings({ "id": "x", "trace": "t" }).unwrap()),
      Ok("/q?id=x"),
    )
    assert_eq(
      api.expand("GET /q", bindings({ "trace": "t" }).unwrap()),
      Ok("/q"),
    )
  }
}

///|
test "required header and cookie do not require same-name unsupported optional queries" {
  for location in ["header", "cookie"] {
    let api = compile(
      {
        "openapi": "3.1.0",
        "paths": {
          "/search": {
            "get": {
              "parameters": [
                { "name": "filter", "in": location, "required": true },
                {
                  "name": "filter",
                  "in": "query",
                  "style": "deepObject",
                  "schema": { "type": "object" },
                },
              ],
            },
          },
        },
      },
      strict=true,
    ).unwrap()
    assert_eq(api.expand("GET /search", @core.Variables::new()), Ok("/search"))
    assert_true(
      api.expand("GET /search", bindings({ "filter": { "a": "b" } }).unwrap())
      is Err({ code: "UnsupportedParameter", path: "/filter", .. }),
    )
  }
}

///|
test "operationId and another operation method-path key are ambiguous in either order" {
  for collision_first in [false, true] {
    let collision : Json = { "get": { "operationId": "GET /b" } }
    let target : Json = { "get": { "operationId": "target" } }
    let paths = if collision_first {
      Json::object(Map([("/a", collision), ("/b", target)]))
    } else {
      Json::object(Map([("/b", target), ("/a", collision)]))
    }
    let api = compile({ "openapi": "3.1.0", "paths": paths }, strict=true).unwrap()
    assert_true(api.get("GET /b") is Err({ code: "AmbiguousOperation", .. }))
    assert_true(
      api.expand("GET /b", @core.Variables::new())
      is Err({ code: "AmbiguousOperation", .. }),
    )
    assert_eq(api.get("GET /a").unwrap().path, "/a")
    assert_eq(api.expand("GET /a", @core.Variables::new()), Ok("/a"))
    assert_eq(api.get("target").unwrap().path, "/b")
    assert_eq(api.expand("target", @core.Variables::new()), Ok("/b"))
    assert_true(api.get("GET /b") is Err({ code: "AmbiguousOperation", .. }))
    assert_true(
      api.expand("GET /b", @core.Variables::new())
      is Err({ code: "AmbiguousOperation", .. }),
    )
  }
}

///|
test "three duplicate operationIds stay ambiguous after method-path cache warmup" {
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/a": { "get": { "operationId": "duplicate" } },
      "/b": { "get": { "operationId": "duplicate" } },
      "/c": { "get": { "operationId": "duplicate" } },
    },
  }
  assert_true(compile(doc, strict=true) is Err({ code: "OpenApiInvalid", .. }))
  let api = compile(doc).unwrap()
  assert_true(api.get("duplicate") is Err({ code: "AmbiguousOperation", .. }))
  assert_true(
    api.expand("duplicate", @core.Variables::new())
    is Err({ code: "AmbiguousOperation", .. }),
  )
  for _ in 0..<2 {
    for path in ["/a", "/b", "/c"] {
      let key = "GET " + path
      assert_eq(api.get(key).unwrap().path, path)
      assert_eq(api.expand(key, @core.Variables::new()), Ok(path))
      assert_true(
        api.get("duplicate") is Err({ code: "AmbiguousOperation", .. }),
      )
      assert_true(
        api.expand("duplicate", @core.Variables::new())
        is Err({ code: "AmbiguousOperation", .. }),
      )
    }
  }
}

///|
test "operationId equal to its own method-path key remains unambiguous" {
  let api = compile({
    "openapi": "3.1.0",
    "paths": {
      "/self": { "get": { "operationId": "GET /self" } },
      "/other": { "get": { "operationId": "other" } },
    },
  }).unwrap()
  assert_eq(api.get("GET /self").unwrap().path, "/self")
  assert_eq(api.expand("GET /self", @core.Variables::new()), Ok("/self"))
  assert_eq(api.expand("other", @core.Variables::new()), Ok("/other"))
  assert_true(api.get("unknown") is Err({ code: "UnknownOperation", .. }))
}
