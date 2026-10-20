///|
test "heterogeneous catalog batch budgets and failures are atomic" {
  let c = @lib.compile_catalog([("user", "/u/{id}"), ("search", "/s{?q}")]).unwrap()
  let a = @lib.Variables::from_entries([("id", @lib.Scalar("42"))]).unwrap()
  let b = @lib.Variables::from_entries([("q", @lib.Scalar("a b"))]).unwrap()
  let jobs = [
    @lib.CatalogRequest::new("user", a, required=["id"]),
    @lib.CatalogRequest::new("search", b),
  ]
  debug_inspect(c.measure_batch(jobs), content="Ok([5, 10])")
  debug_inspect(
    c.expand_batch(
      jobs,
      batch_limits=@lib.BatchLimits::new(max_total_output_bytes=15),
    ),
    content="Ok([\"/u/42\", \"/s?q=a%20b\"])",
  )
  match
    c.expand_batch(
      jobs,
      batch_limits=@lib.BatchLimits::new(max_total_output_bytes=14),
    ) {
    Err(e) => {
      debug_inspect(e.index, content="1")
      debug_inspect(e.name, content="\"search\"")
      debug_inspect(e.error.code, content="\"BatchOutputLimit\"")
    }
    Ok(_) => fail("expected total budget failure")
  }
  // Input: user(4)+id(2)+42(2)+search(6)+q(1)+a b(3)=18.
  debug_inspect(
    c.measure_batch(
      jobs,
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=18),
    ),
    content="Ok([5, 10])",
  )
  match
    c.expand_batch(
      jobs,
      batch_limits=@lib.BatchLimits::new(max_total_input_codepoints=17),
    ) {
    Err(e) => debug_inspect(e.error.code, content="\"BatchInputLimit\"")
    Ok(_) => fail("expected input budget failure")
  }
  jobs.push(@lib.CatalogRequest::new("missing", a))
  match c.expand_batch(jobs) {
    Err(e) => {
      debug_inspect(e.index, content="2")
      debug_inspect(e.error.code, content="\"UnknownTemplate\"")
    }
    Ok(_) => fail("expected unknown template")
  }
}

///|
test "catalog batch checks required unused empty options and per item budgets" {
  let c = @lib.compile_catalog([("u", "{id}")]).unwrap()
  let vars = @lib.Variables::new()
  let request = @lib.CatalogRequest::new("u", vars, required=["id"])
  match c.expand_batch([request]) {
    Err(e) => debug_inspect(e.error.code, content="\"MissingBinding\"")
    Ok(_) => fail("expected required error")
  }
  vars.set("id", @lib.Scalar("a"))
  vars.set("extra", @lib.Scalar("b"))
  match c.expand_batch([request], reject_unused=true) {
    Err(e) => debug_inspect(e.error.code, content="\"UnusedBinding\"")
    Ok(_) => fail("expected unused error")
  }
  match
    c.expand_batch(
      [request],
      limits=@lib.ExpansionLimits::new(max_output_bytes=0),
    ) {
    Err(e) => debug_inspect(e.error.code, content="\"OutputLimit\"")
    Ok(_) => fail("expected per item limit")
  }
  match
    c.measure_batch([], limits=@lib.ExpansionLimits::new(max_output_bytes=-1)) {
    Err(e) => {
      debug_inspect(e.index, content="-1")
      debug_inspect(e.error.code, content="\"InvalidLimit\"")
    }
    Ok(_) => fail("expected invalid empty batch")
  }
  debug_inspect(
    c.expand_batch(
      [],
      batch_limits=@lib.BatchLimits::new(
        max_items=0,
        max_total_input_codepoints=0,
        max_total_output_bytes=0,
      ),
    ),
    content="Ok([])",
  )
}
