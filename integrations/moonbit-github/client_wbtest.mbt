///|
fn fixture() -> String {
  let parameters : Json = [
    {
      "name": "owner",
      "in": "path",
      "required": true,
      "schema": { "type": "string" },
    },
    {
      "name": "repo",
      "in": "path",
      "required": true,
      "schema": { "type": "string" },
    },
  ]
  let listing : Json = [
    {
      "name": "owner",
      "in": "path",
      "required": true,
      "schema": { "type": "string" },
    },
    {
      "name": "repo",
      "in": "path",
      "required": true,
      "schema": { "type": "string" },
    },
    { "name": "per_page", "in": "query", "schema": { "type": "integer" } },
  ]
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/repos/{owner}/{repo}": {
        "get": { "operationId": "repos/get", "parameters": parameters },
      },
      "/repos/{owner}/{repo}/commits": {
        "get": { "operationId": "repos/list-commits", "parameters": listing },
      },
      "/repos/{owner}/{repo}/releases": {
        "get": { "operationId": "repos/list-releases", "parameters": listing },
      },
    },
  }
  doc.stringify()
}

///|
fn config(variables : Json, id~ : String = "repos/get") -> Json {
  { "requests": [{ "operationId": id, "variables": variables }] }
}

///|
fn expect_error(action : () -> Unit raise, expected : String) -> Unit raise {
  try {
    action()
    fail("expected " + expected)
  } catch {
    ClientError(code, _) => assert_eq(code, expected)
    error => raise error
  }
}

///|
test "plans read-only requests from operation IDs and core Variables" {
  let result = plan(
    fixture(),
    config(
      { "owner": "octo", "repo": "hello.world", "per_page": 2 },
      id="repos/list-commits",
    ),
  )
  assert_eq(
    result.requests[0].url,
    "https://api.github.com/repos/octo/hello.world/commits?per_page=2",
  )
  assert_eq(result.document_errors, 0)
}

///|
test "missing and misspelled parameters preserve core diagnostic codes" {
  expect_error(
    () => ignore(plan(fixture(), config({ "owner": "octo" }))),
    "MissingBinding",
  )
  expect_error(
    () => {
      ignore(
        plan(
          fixture(),
          config(
            { "owner": "octo", "repo": "r", "perpage": 1 },
            id="repos/list-commits",
          ),
        ),
      )
    },
    "UnknownParameter",
  )
}

///|
test "invalid bindings and pagination are rejected" {
  expect_error(
    () => ignore(plan(fixture(), config({ "owner": [], "repo": "r" }))),
    "InvalidBinding",
  )
  for n in [0, 101, -1] {
    expect_error(
      () => {
        ignore(
          plan(
            fixture(),
            config(
              { "owner": "octo", "repo": "r", "per_page": n },
              id="repos/list-commits",
            ),
          ),
        )
      },
      "PaginationRange",
    )
  }
}

///|
test "repository names cannot introduce path traversal or another authority" {
  for repo in ["..", "a/b", "a%2Fb", "r?x", "r#x", "r\\x"] {
    expect_error(
      () => ignore(plan(fixture(), config({ "owner": "octo", "repo": repo }))),
      "RepositoryName",
    )
  }
  expect_error(
    () => {
      ignore(
        plan(
          fixture(),
          config({ "owner": "octo", "repo": "r" }, id="repos/delete"),
        ),
      )
    },
    "OperationNotAllowed",
  )
}

///|
test "ambiguous operation IDs and incomplete descriptions are blocked" {
  let doc : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/a": { "get": { "operationId": "repos/get" } },
      "/b": { "get": { "operationId": "repos/get" } },
    },
  }
  expect_error(
    () => {
      ignore(plan(doc.stringify(), config({ "owner": "octo", "repo": "r" })))
    },
    "AmbiguousOperation",
  )
  let external : Json = {
    "openapi": "3.1.0",
    "paths": { "/a": { "$ref": "other.json" } },
  }
  expect_error(
    () => {
      ignore(
        plan(external.stringify(), config({ "owner": "octo", "repo": "r" })),
      )
    },
    "OpenApiInvalid",
  )
}

///|
test "errors on a selected endpoint and non-GET methods are blocked" {
  let invalid : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/repos/{owner}/{repo}": {
        "get": {
          "operationId": "repos/get",
          "parameters": [
            { "name": "owner", "in": "path", "required": false },
            { "name": "repo", "in": "path", "required": true },
          ],
        },
      },
    },
  }
  expect_error(
    () => {
      ignore(
        plan(invalid.stringify(), config({ "owner": "octo", "repo": "r" })),
      )
    },
    "PathParameterRequired",
  )
  let post : Json = {
    "openapi": "3.1.0",
    "paths": {
      "/repos/{owner}/{repo}": { "post": { "operationId": "repos/get" } },
    },
  }
  expect_error(
    () => {
      ignore(plan(post.stringify(), config({ "owner": "octo", "repo": "r" })))
    },
    "OperationNotAllowed",
  )
}

///|
test "empty and oversized batches are refused" {
  expect_error(
    () => ignore(plan(fixture(), { "requests": [] })),
    "InvalidConfig",
  )
  let inputs : Array[Json] = Array::make(9, {
    "operationId": "repos/get",
    "variables": { "owner": "octo", "repo": "r" },
  })
  expect_error(
    () => ignore(plan(fixture(), { "requests": inputs })),
    "InvalidConfig",
  )
}

///|
async test "entire batch is validated before the first transport call" {
  let mut calls = 0
  let input : Json = {
    "requests": [
      {
        "operationId": "repos/get",
        "variables": { "owner": "octo", "repo": "r" },
      },
      { "operationId": "repos/list-commits", "variables": { "owner": "octo" } },
    ],
  }
  try {
    ignore(
      execute(fixture(), input, _ => {
        calls += 1
        Json::null()
      }),
    )
    fail("invalid batch should fail")
  } catch {
    ClientError(code, _) => assert_eq(code, "MissingBinding")
    error => raise error
  }
  assert_eq(calls, 0)
}

///|
test "responses must match the requested repository and endpoint shape" {
  let request = plan(fixture(), config({ "owner": "octo", "repo": "r" })).requests[0]
  ignore(response_summary(request, { "full_name": "octo/r", "id": 1 }))
  expect_error(
    () => ignore(response_summary(request, { "full_name": "wrong/r", "id": 1 })),
    "ResponseMismatch",
  )
  let commits = plan(
      fixture(),
      config({ "owner": "octo", "repo": "r" }, id="repos/list-commits"),
    ).requests[0]
  ignore(response_summary(commits, []))
  ignore(
    response_summary(commits, [
      { "sha": "0123456789012345678901234567890123456789", "commit": {} },
    ]),
  )
  expect_error(
    () => ignore(response_summary(commits, [{ "sha": "not-a-sha" }])),
    "ResponseMismatch",
  )
  let releases = plan(
      fixture(),
      config({ "owner": "octo", "repo": "r" }, id="repos/list-releases"),
    ).requests[0]
  ignore(response_summary(releases, [{ "id": 2, "tag_name": "v1" }]))
  expect_error(() => ignore(response_summary(releases, {})), "ResponseMismatch")
}

///|
test "HTTP errors and redirects are never accepted as successful responses" {
  checked_status(200)
  for code in [301, 302, 307, 401, 403, 404, 429, 500] {
    expect_error(() => checked_status(code), "HttpStatus")
  }
}

///|
async test "streaming size cap rejects a body without reading it all" {
  let reader = @io.MemoryReader(writer => writer.write("12345"))
  defer reader.close()
  try {
    ignore(read_bounded(reader, 4))
    fail("expected size failure")
  } catch {
    ClientError(code, _) => assert_eq(code, "SizeLimit")
    error => raise error
  }
  let exact = @io.MemoryReader(writer => writer.write("1234"))
  defer exact.close()
  assert_eq(read_bounded(exact, 4).length(), 4)
}

///|
async test "a stalled response is cancelled by the request deadline" {
  let reader = @io.MemoryReader(_ => @async.sleep(10000))
  defer reader.close()
  let result = @async.with_timeout_opt(10, () => read_bounded(reader, 4))
  assert_true(result is None)
}
