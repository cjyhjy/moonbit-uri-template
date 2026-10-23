///|
async test "native HTTP sends the compiled path and validates canonical repository names" {
  @async.with_task_group() <| group => {
    let server = @http.Server(@socket.Addr::parse("127.0.0.1:0"))
    defer server.close()
    let mut requests = 0
    group.spawn_bg(no_wait=true) <| () => {
      server.run_forever() <| ((request, _, connection) => {
        assert_eq(request.meth, @http.Get)
        assert_eq(request.path, "/repos/Octo/Repo")
        assert_eq(
          request.headers.get("accept"),
          Some("application/vnd.github+json"),
        )
        assert_eq(
          request.headers.get("x-github-api-version"),
          Some("2022-11-28"),
        )
        requests += 1
        connection
        ..send_response(200, "OK", extra_headers={
          "x-github-request-id": "loopback-1",
        })
        .write("{\"full_name\":\"octo/repo\",\"id\":1}")
      })
    }
    let request = plan(fixture(), config({ "owner": "Octo", "repo": "Repo" })).requests[0]
    let result = fetch_from(request, "http://127.0.0.1:\{server.addr.port()}")
    assert_true(
      result
      is { "status": Number(200, ..), "requestId": String("loopback-1"), .. },
    )
    assert_eq(requests, 1)
  }
}

///|
async test "native HTTP refuses redirects without a second request" {
  @async.with_task_group() <| group => {
    let server = @http.Server(@socket.Addr::parse("127.0.0.1:0"))
    defer server.close()
    let mut requests = 0
    group.spawn_bg(no_wait=true) <| () => {
      server.run_forever() <| ((_, _, connection) => {
        requests += 1
        connection.send_response(302, "Found", extra_headers={
          "location": "/redirected",
        })
      })
    }
    let request = plan(fixture(), config({ "owner": "octo", "repo": "r" })).requests[0]
    try {
      ignore(fetch_from(request, "http://127.0.0.1:\{server.addr.port()}"))
      fail("redirect should fail")
    } catch {
      ClientError(code, _) => assert_eq(code, "HttpStatus")
      error => raise error
    }
    assert_eq(requests, 1)
  }
}

///|
async test "native HTTP enforces streamed response size" {
  @async.with_task_group() <| group => {
    let server = @http.Server(@socket.Addr::parse("127.0.0.1:0"))
    defer server.close()
    group.spawn_bg(no_wait=true) <| () => {
      server.run_forever() <| ((_, _, connection) => {
        connection..send_response(200, "OK").write("12345")
      })
    }
    let request = plan(fixture(), config({ "owner": "octo", "repo": "r" })).requests[0]
    try {
      ignore(
        fetch_from(
          request,
          "http://127.0.0.1:\{server.addr.port()}",
          response_limit=4,
        ),
      )
      fail("oversized body should fail")
    } catch {
      ClientError(code, _) => assert_eq(code, "SizeLimit")
      error => raise error
    }
  }
}

///|
async test "native HTTP deadline includes waiting for response headers" {
  @async.with_task_group() <| group => {
    let server = @http.Server(@socket.Addr::parse("127.0.0.1:0"))
    defer server.close()
    group.spawn_bg(no_wait=true) <| () => {
      server.run_forever() <| ((_, _, _) => @async.sleep(10000))
    }
    let request = plan(fixture(), config({ "owner": "octo", "repo": "r" })).requests[0]
    try {
      ignore(
        fetch_from(
          request,
          "http://127.0.0.1:\{server.addr.port()}",
          timeout_ms=50,
        ),
      )
      fail("stalled response should time out")
    } catch {
      @async.TimeoutError => ()
      error => raise error
    }
  }
}
