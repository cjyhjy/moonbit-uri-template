///|
test "sessions recompute dependencies once and preserve old snapshots" {
  let c = @lib.compile_catalog([
    ("search", "/{tenant}/search{?q}"),
    ("resource", "/{tenant}/{file}"),
    ("health", "/health"),
  ]).unwrap()
  let vars = @lib.Variables::from_entries([
    ("tenant", @lib.Scalar("demo")),
    ("file", @lib.Scalar("a")),
    ("q", @lib.Scalar("old")),
  ]).unwrap()
  let old = c.start_session(vars).unwrap()
  vars.set("q", @lib.Scalar("caller-mutated"))
  let next = old.update([@lib.SetBinding("q", @lib.Scalar("中文"))]).unwrap()
  assert_eq(next.recomputed(), 1)
  assert_eq(next.changes()[0].name, "search")
  assert_eq(next.changes()[0].after, "/demo/search?q=%E4%B8%AD%E6%96%87")
  assert_eq(old.get("search").unwrap(), "/demo/search?q=old")
  let both = old
    .update([
      @lib.SetBinding("tenant", @lib.Scalar("team")),
      @lib.SetBinding("q", @lib.Scalar("new")),
    ])
    .unwrap()
  assert_eq(both.recomputed(), 2)
  assert_eq(
    both.changes().map(c => c.name),
    c.names().filter(name => name != "health"),
  )
  next.changes().clear()
  next.session().links().clear()
  assert_eq(next.changes().length(), 1)
  assert_eq(next.session().links().length(), 3)
}

///|
test "sessions no-op patches prefix equivalence and explicit removal" {
  let c = @lib.compile_catalog([("p", "{x:1}{?y}")]).unwrap()
  let old = c
    .start_session(
      @lib.Variables::from_entries([("x", @lib.Scalar("abc"))]).unwrap(),
    )
    .unwrap()
  assert_eq(old.update([]).unwrap().recomputed(), 0)
  assert_eq(
    old
    .update([@lib.SetBinding("x", @lib.Scalar("abc")), @lib.RemoveBinding("y")])
    .unwrap()
    .recomputed(),
    0,
  )
  let same = old.update([@lib.SetBinding("x", @lib.Scalar("axy"))]).unwrap()
  assert_eq(same.recomputed(), 1)
  assert_eq(same.changes().length(), 0)
  let removed = same.session().update([@lib.RemoveBinding("x")]).unwrap()
  assert_eq(removed.session().links()[0].1, "")
  assert_eq(old.links()[0].1, "a")
  assert_eq(
    old
    .update([@lib.RemoveBinding("x"), @lib.SetBinding("x", @lib.Scalar("z"))])
    .unwrap_err().error.code,
    "DuplicatePatch",
  )
  assert_eq(
    old.update([@lib.RemoveBinding("typo")]).unwrap_err().error.code,
    "UnusedBinding",
  )
}

///|
test "sessions measure total output before render including unchanged links" {
  let c = @lib.compile_catalog([("a", "{x}"), ("b", "{y}"), ("health", "OK")]).unwrap()
  let v = @lib.Variables::from_entries([
    ("x", @lib.Scalar("a")),
    ("y", @lib.Scalar("bbbbb")),
  ]).unwrap()
  let old = c.start_session(v, max_total_output_bytes=8).unwrap()
  assert_eq(old.total_bytes(), 8)
  let swap = old
    .update([
      @lib.SetBinding("x", @lib.Scalar("aaaaa")),
      @lib.SetBinding("y", @lib.Scalar("b")),
    ])
    .unwrap()
  assert_eq(swap.session().total_bytes(), 8)
  assert_eq(swap.changes().length(), 2)
  assert_eq(
    old.update([@lib.SetBinding("x", @lib.Scalar("aa"))]).unwrap_err().error.code,
    "SessionOutputLimit",
  )
  assert_eq(old.links()[0].1, "a")
  assert_eq(
    c.start_session(v, max_total_output_bytes=7).unwrap_err().error.code,
    "SessionOutputLimit",
  )
}

///|
test "sessions enforce full input patch and dependency budgets even on empty cases" {
  let empty = @lib.compile_catalog([]).unwrap()
  assert_eq(
    empty
    .start_session(
      @lib.Variables::new(),
      max_total_output_bytes=0,
      max_dependency_edges=0,
    )
    .unwrap()
    .total_bytes(),
    0,
  )
  assert_eq(
    empty
    .start_session(@lib.Variables::new(), max_patch_bindings=-1)
    .unwrap_err().error.code,
    "InvalidLimit",
  )
  let c = @lib.compile_catalog([("one", "{x}"), ("two", "{y}")]).unwrap()
  let v = @lib.Variables::from_entries([("x", @lib.Scalar("a"))]).unwrap()
  assert_eq(
    c.start_session(v, max_dependency_edges=1).unwrap_err().error.code,
    "DependencyLimit",
  )
  let old = c
    .start_session(
      v,
      limits=@lib.ExpansionLimits::new(max_total_value_codepoints=3),
      max_patch_bindings=1,
    )
    .unwrap()
  assert_eq(
    old.update([@lib.SetBinding("y", @lib.Scalar("b"))]).unwrap_err().error.code,
    "TotalValueLimit",
  )
  assert_eq(
    old.update([@lib.SetBinding("x", @lib.List(["a", "b", "c"]))]).unwrap_err().error.code,
    "TotalValueLimit",
  )
  assert_eq(
    old.update([@lib.RemoveBinding("x"), @lib.RemoveBinding("y")]).unwrap_err().error.code,
    "PatchLimit",
  )
  assert_eq(old.total_bytes(), 1)
}

///|
test "session endpoint contracts survive atomic changes and cannot be misattached" {
  let c = @lib.compile_catalog([("user", "/{id}{?fields*}"), ("health", "OK")]).unwrap()
  let t = c.get("user").unwrap()
  let contract = t
    .with_contract(
      [
        { name: "id", kind: @lib.ScalarKind, },
        { name: "fields", kind: @lib.ListKind, },
      ],
      required=["id"],
    )
    .unwrap()
  let v = @lib.Variables::from_entries([("id", @lib.Scalar("42"))]).unwrap()
  let old = c.start_session(v, contracts=[("user", contract)]).unwrap()
  for
    patch in [
      [@lib.RemoveBinding("id")],
      [@lib.SetBinding("fields", @lib.Scalar(""))],
    ] {
    assert_eq(old.update(patch).unwrap_err().name, "user")
    assert_eq(old.get("user").unwrap(), "/42")
  }
  assert_eq(
    c.start_session(v, contracts=[("health", contract)]).unwrap_err().error.code,
    "ContractSource",
  )
  assert_eq(
    c.start_session(v, contracts=[("typo", contract)]).unwrap_err().error.code,
    "UnknownTemplate",
  )
  assert_eq(
    c
    .start_session(v, contracts=[("user", contract), ("user", contract)])
    .unwrap_err().error.code,
    "DuplicateContract",
  )
}

///|
test "session composite snapshots preserve order without caller mutation" {
  let c = @lib.compile_catalog([("query", "{?x*}")]).unwrap()
  let v = @lib.Variables::from_entries([("x", @lib.List(["a"]))]).unwrap()
  let old = c.start_session(v).unwrap()
  let items = ["b"]
  let next = old.update([@lib.SetBinding("x", @lib.List(items))]).unwrap()
  items[0] = "mutated"
  assert_eq(next.session().links()[0].1, "?x=b")
  assert_eq(old.links()[0].1, "?x=a")
  assert_eq(
    next
    .session()
    .update([@lib.SetBinding("x", @lib.List(["b"]))])
    .unwrap()
    .recomputed(),
    0,
  )
  let a = @lib.Assoc(
    @lib.OrderedEntries::from_entries([("a", "1"), ("b", "2")]).unwrap(),
  )
  let b = @lib.Assoc(
    @lib.OrderedEntries::from_entries([("b", "2"), ("a", "1")]).unwrap(),
  )
  let assoc = old.update([@lib.SetBinding("x", a)]).unwrap().session()
  assert_eq(
    assoc.update([@lib.SetBinding("x", b)]).unwrap().changes()[0].after,
    "?b=2&a=1",
  )
}

///|
test "incremental snapshots match full regeneration across 200 state changes" {
  let entries : Array[(String, String)] = []
  for i = 0; i < 200; i = i + 1 {
    entries.push(
      (
        "endpoint" + i.to_string(),
        "/item/" + i.to_string() + "{?v" + i.to_string() + "}",
      ),
    )
  }
  let c = @lib.compile_catalog(entries).unwrap()
  let vars = @lib.Variables::new()
  let mut session = c.start_session(vars).unwrap()
  for i = 0; i < 200; i = i + 1 {
    let name = "v" + i.to_string()
    let value = @lib.Scalar(if i % 2 == 0 { "中文 /" } else { "" })
    vars.set(name, value)
    let update = session.update([@lib.SetBinding(name, value)]).unwrap()
    assert_eq(update.recomputed(), 1)
    session = update.session()
    assert_eq(session.links(), c.start_session(vars).unwrap().links())
  }
}

///|
test "session budgets are tracked incrementally across many updates" {
  let c = @lib.compile_catalog([("a", "/a{?tags*}"), ("b", "/b{?q}")]).unwrap()
  let limits = @lib.ExpansionLimits::new(
    max_members=4,
    max_total_value_codepoints=20,
  )
  let v = @lib.Variables::from_entries([
    ("tags", @lib.List(["x", "y", "z"])),
    ("q", @lib.Scalar("a")),
  ]).unwrap()
  // tags 4 + x y z 3 + q 1 + a 1 = 9 code points, 3 members.
  let s0 = c.start_session(v, limits~).unwrap()
  assert_eq(
    s0
    .update([@lib.SetBinding("tags", @lib.List(["1", "2", "3", "4", "5"]))])
    .unwrap_err().error.code,
    "MemberLimit",
  )
  // Replacing values repeatedly must not accumulate cost.
  let mut s = s0
  for i in 0..<50 {
    s = s
      .update([@lib.SetBinding("q", @lib.Scalar("v\{i % 10}"))])
      .unwrap()
      .session()
  }
  assert_eq(s.get("b").unwrap(), "/b?q=v9")
  // q costs 1 + 2 = 3 now; 11 more points push the total to 21.
  assert_eq(
    s
    .update([@lib.SetBinding("tags", @lib.List(["abcdefghijklmn"]))])
    .unwrap_err().error.code,
    "TotalValueLimit",
  )
  // Removing a binding releases its members for the next patch.
  let freed = s.update([@lib.RemoveBinding("tags")]).unwrap().session()
  let refilled = freed
    .update([@lib.SetBinding("tags", @lib.List(["1", "2", "3", "4"]))])
    .unwrap()
    .session()
  assert_eq(refilled.get("a").unwrap(), "/a?tags=1&tags=2&tags=3&tags=4")
  assert_eq(s0.get("a").unwrap(), "/a?tags=x&tags=y&tags=z")
}
