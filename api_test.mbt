///|
test "public API reuse and variable discovery" {
  let template = @lib.parse("/users/{id}{?page,id,A,a,a.b,%61}").unwrap()
  assert_eq(template.variables(), ["id", "page", "A", "a", "a.b", "%61"])
  let vars = @lib.Variables::new()
  vars.set("id", @lib.Scalar("42"))
  vars.set("page", @lib.Scalar("2"))
  assert_eq(
    @lib.expand("/users/{id}{?page}", vars).unwrap(),
    "/users/42?page=2",
  )
  vars.set("id", @lib.Scalar("99"))
  assert_eq(template.expand(vars).unwrap(), "/users/99?page=2&id=99")
  vars.remove("page")
  assert_eq(template.expand(vars).unwrap(), "/users/99?id=99")
  vars.set("a", @lib.Scalar("raw"))
  vars.set("%61", @lib.Scalar("encoded"))
  assert_eq(@lib.expand("{a}/{%61}", vars).unwrap(), "raw/encoded")
}

///|
test "collections snapshot inputs and preserve order" {
  let pairs = [("b", "2"), ("a", "1")]
  let entries = @lib.OrderedEntries::from_entries(pairs).unwrap()
  pairs[0] = ("broken", "value")
  let items = ["red", "green"]
  let vars = @lib.Variables::new()
  vars.set("list", @lib.List(items))
  vars.set("keys", @lib.Assoc(entries))
  items[0] = "broken"
  assert_eq(
    @lib.expand("{?list*,keys*}", vars).unwrap(),
    "?list=red&list=green&b=2&a=1",
  )
  let duplicate = @lib.OrderedEntries::from_entries([("x", "1"), ("x", "2")]).unwrap_err()
  assert_eq(duplicate.code, "DuplicateKey")
}

///|
test "all operators preserve missing empty and collection semantics" {
  let vars = @lib.Variables::new()
  vars.set("empty", @lib.Scalar(""))
  vars.set("list", @lib.List(["", "a/b"]))
  vars.set("zero", @lib.List([]))
  vars.set(
    "mapzero",
    @lib.Assoc(@lib.OrderedEntries::from_entries([]).unwrap()),
  )
  let cases = [
    ("{empty}", ""),
    ("{#empty}", "#"),
    ("{.empty}", "."),
    ("{/empty}", "/"),
    ("{;empty}", ";empty"),
    ("{?empty}", "?empty="),
    ("{&empty}", "&empty="),
    ("{+empty}", ""),
    ("{?missing,zero,mapzero}", ""),
    ("{?missing,empty}", "?empty="),
    ("{list}", ",a%2Fb"),
    ("{+list}", ",a/b"),
    ("{#list*}", "#,a/b"),
    ("{.list*}", "..a%2Fb"),
    ("{/list*}", "//a%2Fb"),
    ("{;list*}", ";list;list=a%2Fb"),
    ("{?list*}", "?list=&list=a%2Fb"),
    ("{&list*}", "&list=&list=a%2Fb"),
  ]
  for (source, expected) in cases {
    assert_eq(@lib.expand(source, vars).unwrap(), expected)
  }
}

///|
test "Unicode literal encoding and prefix boundaries" {
  let vars = @lib.Variables::new()
  vars.set("x", @lib.Scalar("中😀é"))
  assert_eq(
    @lib.expand("中文/{x:2}", vars).unwrap(),
    "%E4%B8%AD%E6%96%87/%E4%B8%AD%F0%9F%98%80",
  )
  assert_eq(@lib.expand("{x:3}", vars).unwrap(), "%E4%B8%AD%F0%9F%98%80e")
  vars.set("x", @lib.Scalar("%E4%B8%AD%F0%9F%98%80abc"))
  assert_eq(@lib.expand("{+x:1}", vars).unwrap(), "%E4%B8%AD")
  assert_eq(@lib.expand("{+x:2}", vars).unwrap(), "%E4%B8%AD%F0%9F%98%80")
  assert_eq(@lib.expand("{x:1}", vars).unwrap(), "%25E4%25B8%25AD")
}

///|
test "percent modes and scalar explode" {
  let vars = @lib.Variables::new()
  vars.set("x", @lib.Scalar("%2f%zz%/a b"))
  assert_eq(@lib.expand("{x*}", vars).unwrap(), "%252f%25zz%25%2Fa%20b")
  assert_eq(@lib.expand("{+x}", vars).unwrap(), "%2f%25zz%25/a%20b")
  assert_eq(@lib.expand("{#x}", vars).unwrap(), "#%2f%25zz%25/a%20b")
  assert_eq(@lib.expand("a%2fb", vars).unwrap(), "a%2fb")
}

///|
test "errors carry code point spans and never partial output" {
  let e = @lib.parse("😀/{id").unwrap_err()
  assert_eq(e.code, "UnclosedExpression")
  assert_eq(e.span.start, 2)
  assert_eq(e.span.end, 5)
  let cases = [
    "{}", "{?}", "{a,}", "{a..b}", "{.a.}", "{%GG}", "{a:0}", "{a:01}", "{a:10000}",
    "{a:1*}", "{!a}", "{a{b}}", "x%", "x%2", "x%GG", "x y", "x\n", "x}", "<x>",
  ]
  for source in cases {
    assert_true(@lib.parse(source) is Err(_), msg=source)
  }
  let vars = @lib.Variables::new()
  vars.set("x", @lib.List(["a"]))
  let e = @lib.expand("before/{x:1}/after", vars).unwrap_err()
  assert_eq(e.code, "PrefixOnComposite")
  assert_eq(e.span.start, 8)
  assert_eq(e.span.end, 11)
}

///|
test "deterministic generated inputs parser robustness and reuse equivalence" {
  let alphabet = "abcXYZ019_%{}:*,.+#/?&;中😀".to_array()
  let mut seed = 1729
  let vars = @lib.Variables::new()
  vars.set("x", @lib.Scalar("中文/a%2F"))
  for case_index = 0; case_index < 500; case_index = case_index + 1 {
    let text = StringBuilder()
    for char_index = 0; char_index < 20; char_index = char_index + 1 {
      seed = (seed * 97 + 13) % 65521
      text.write_char(alphabet[seed % alphabet.length()])
    }
    let source = text.to_string()
    match @lib.parse(source) {
      Err(_) => ()
      Ok(t) => {
        let result = t.expand(vars)
        match result {
          Err(_) => assert_true(@lib.expand(source, vars) is Err(_))
          Ok(value) => {
            assert_eq(t.expand(vars).unwrap(), value)
            assert_eq(@lib.expand(source, vars).unwrap(), value)
          }
        }
      }
    }
    let source = "/item/" + seed.to_string() + "{?x}"
    let t = @lib.parse(source).unwrap()
    let before = t.expand(vars).unwrap()
    vars.set("unused", @lib.Scalar(seed.to_string()))
    assert_eq(t.expand(vars).unwrap(), before)
    assert_eq(@lib.expand(source, vars).unwrap(), before)
  }
}

///|
test "strict grammar mode keeps expansion semantics and rejects literal apostrophes" {
  let vars = @lib.Variables::new()
  vars.set("x", @lib.Scalar("a'b"))
  assert_eq(@lib.parse_strict("{x}").unwrap().expand(vars).unwrap(), "a%27b")
  assert_eq(@lib.parse_strict("{+x}").unwrap().expand(vars).unwrap(), "a'b")
  assert_eq(@lib.parse("'{x}'").unwrap().expand(vars).unwrap(), "'a%27b'")
  let error = @lib.parse_strict("😀'{x}'").unwrap_err()
  assert_eq(error.code, "InvalidLiteral")
  assert_eq(error.span.start, 1)
  assert_eq(error.span.end, 2)
  assert_eq(
    @lib.parse_strict("%27{x}%27").unwrap().expand(vars).unwrap(),
    "%27a%27b%27",
  )
}
