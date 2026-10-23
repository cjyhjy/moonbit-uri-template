///|
pub(all) suberror ClientError {
  ClientError(String, String)
} derive(Debug)

///|
pub extend ClientError with Debug::{to_repr}

///|
priv struct Request {
  operation_id : String
  url : String
  repository : String
} derive(ToJson)

///|
priv struct Plan {
  requests : Array[Request]
  document_errors : Int32
  document_warnings : Int32
}

///|
fn[T] unwrap(value : Result[T, @openapi.OpenApiError]) -> T raise ClientError {
  match value {
    Ok(value) => value
    Err(error) => raise ClientError(error.code, error.message)
  }
}

///|
fn route(id : String) -> String raise ClientError {
  match id {
    "repos/get" => "/repos/{owner}/{repo}"
    "repos/list-commits" => "/repos/{owner}/{repo}/commits"
    "repos/list-releases" => "/repos/{owner}/{repo}/releases"
    _ =>
      raise ClientError(
        "OperationNotAllowed", "only repository, commit and release GET operations are allowed",
      )
  }
}

///|
fn repository_part(value : Json, name : String) -> String raise ClientError {
  guard value is String(text) &&
    text.length() > 0 &&
    text.length() <= 100 &&
    text != "." &&
    text != ".." else {
    raise ClientError(
      "RepositoryName",
      name + " must be a nonempty repository identifier",
    )
  }
  for c in text.iter() {
    guard c is ('a'..<='z' | 'A'..<='Z' | '0'..<='9' | '-' | '_' | '.') else {
      raise ClientError(
        "RepositoryName",
        name + " contains an invalid character",
      )
    }
  }
  text
}

///|
fn plan(source : String, config : Json) -> Plan raise {
  let analysis = unwrap(@openapi.analyze_text(source))
  let api = unwrap(
    @openapi.compile_analysis(analysis, base_url="https://api.github.com"),
  )
  guard config is { "requests": Array(inputs), .. } &&
    inputs.length() > 0 &&
    inputs.length() <= 8 else {
    raise ClientError(
      "InvalidConfig", "requests must contain between 1 and 8 entries",
    )
  }
  let requests : Array[Request] = []
  for input in inputs {
    guard input
      is { "operationId": String(id), "variables": Object(bindings), .. } else {
      raise ClientError(
        "InvalidConfig", "each request needs operationId and variables",
      )
    }
    let path = route(id)
    let matches = analysis.operations().filter(fn(op) { op.id == Some(id) })
    guard matches.length() == 1 else {
      raise ClientError(
        "AmbiguousOperation",
        "operationId must occur exactly once: " + id,
      )
    }
    let operation = unwrap(api.get(id))
    guard operation.http_method == "GET" && operation.path == path else {
      raise ClientError(
        "OperationNotAllowed",
        "unexpected method or path for " + id,
      )
    }
    let pointer = "/paths/" + path.split("/").join("~1")
    for diagnostic in analysis.diagnostics() {
      if diagnostic.severity == @openapi.Error &&
        (
          diagnostic.path == pointer ||
          diagnostic.path.has_prefix(pointer + "/")
        ) {
        raise ClientError(diagnostic.code, diagnostic.message)
      }
    }
    let variables = @uri.Variables::new()
    for name, value in bindings {
      match value {
        String(s) => variables.set(name, @uri.Scalar(s))
        Number(n, ..) => variables.set(name, @uri.Scalar(n.to_string()))
        _ =>
          raise ClientError(
            "InvalidBinding",
            "expected a string or number for " + name,
          )
      }
    }
    // Preserve the core's missing/unknown/shape diagnostics before applying client policy.
    let url = unwrap(api.expand(id, variables))
    let owner = repository_part(bindings.get("owner").unwrap(), "owner")
    let repo = repository_part(bindings.get("repo").unwrap(), "repo")
    for name, value in bindings {
      guard ["owner", "repo", "per_page", "page"].contains(name) else {
        raise ClientError(
          "ParameterNotAllowed",
          "this client does not accept " + name,
        )
      }
      if name == "per_page" || name == "page" {
        let n = match value {
          Number(n, ..) => n
          _ => -1.0
        }
        guard n >= 1 &&
          n <= (if name == "per_page" { 100.0 } else { 1000.0 }) &&
          n == n.to_int().to_double() else {
          raise ClientError(
            "PaginationRange",
            name + " must be a positive bounded integer",
          )
        }
      }
    }
    guard url.has_prefix("https://api.github.com/repos/") &&
      url.length() <= 2048 else {
      raise ClientError(
        "RequestScope", "expanded URL is outside the client scope",
      )
    }
    requests.push({ operation_id: id, url, repository: owner + "/" + repo, })
  }
  let diagnostics = analysis.diagnostics()
  {
    requests,
    document_errors: diagnostics
    .filter(fn(d) { d.severity == @openapi.Error })
    .length(),
    document_warnings: diagnostics
    .filter(fn(d) { d.severity == @openapi.Warning })
    .length(),
  }
}

///|
pub async fn read_input(path : String, limit : Int32) -> String {
  let file = @fs.open(path, mode=ReadOnly)
  defer file.close()
  @utf8.decode(read_bounded(file, limit)[:])
}

///|
async fn read_bounded(reader : &@io.Reader, limit : Int32) -> Bytes {
  let buffer = @buffer.Buffer()
  while reader.read_some(max_len=8192) is Some(chunk) {
    if buffer.length() + chunk.length() > limit {
      raise ClientError("SizeLimit", "input or response exceeds its byte limit")
    }
    buffer.write_bytes(chunk[:])
  }
  buffer.to_bytes()
}

///|
fn response_summary(request : Request, body : Json) -> Json raise ClientError {
  match request.operation_id {
    "repos/get" => {
      guard body is { "full_name": String(name), "id": Number(id, ..), .. } &&
        name == request.repository &&
        id > 0 else {
        raise ClientError(
          "ResponseMismatch", "repository response does not match the request",
        )
      }
      { "full_name": name, "id": id }
    }
    "repos/list-commits" => {
      guard body is Array(items) else {
        raise ClientError("ResponseMismatch", "expected a commit array")
      }
      for item in items {
        guard item is { "sha": String(sha), "commit": Object(_), .. } &&
          sha.length() == 40 &&
          sha.iter().all(fn(c) { c is ('0'..<='9' | 'a'..<='f') }) else {
          raise ClientError(
            "ResponseMismatch", "expected commit objects with SHA-1 identifiers",
          )
        }
      }
      let first : Json = match items {
        [{ "sha": value, .. }, ..] => value
        _ => null
      }
      { "count": items.length(), "first": first }
    }
    _ => {
      guard body is Array(items) else {
        raise ClientError("ResponseMismatch", "expected a release array")
      }
      for item in items {
        guard item is { "id": Number(id, ..), "tag_name": String(tag), .. } &&
          id > 0 &&
          tag.length() > 0 else {
          raise ClientError(
            "ResponseMismatch", "expected release objects with IDs and tags",
          )
        }
      }
      let first : Json = match items {
        [{ "tag_name": value, .. }, ..] => value
        _ => null
      }
      { "count": items.length(), "first": first }
    }
  }
}

///|
fn checked_status(code : Int32) -> Unit raise ClientError {
  if code != 200 {
    raise ClientError(
      "HttpStatus",
      "expected 200; received " +
      code.to_string() +
      "; redirects are not followed",
    )
  }
}

///|
async fn fetch_live(request : Request) -> Json {
  @async.with_timeout(15000, () => {
    let client = @http.Client("https://api.github.com", headers={
      "User-Agent": "moonbit-uri-template-native-client/0.1.0",
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    })
    defer client.close()
    let response = client.get(
      request.url["https://api.github.com".length():].to_owned(),
    )
    checked_status(response.code)
    let bytes = read_bounded(client, 1048576)
    let max_nesting_depth = 64
    let body = @json.parse(@utf8.decode(bytes[:]), max_nesting_depth~)
    let summary = response_summary(request, body)
    {
      "operationId": request.operation_id,
      "url": request.url,
      "status": response.code,
      "bytes": bytes.length(),
      "requestId": match response.headers.get("x-github-request-id") {
        Some(id) => Json::string(id)
        None => Json::null()
      },
      "summary": summary,
    }
  })
}

///|
async fn execute(
  source : String,
  config : Json,
  fetch : async (Request) -> Json,
) -> Json {
  let prepared = plan(source, config)
  let responses : Array[Json] = []
  for request in prepared.requests {
    responses.push(fetch(request))
  }
  {
    "ok": true,
    "mode": "live",
    "documentErrors": prepared.document_errors,
    "documentWarnings": prepared.document_warnings,
    "results": responses,
  }
}

///|
pub async fn run(source : String, config : Json, live~ : Bool = false) -> Json {
  if live {
    return execute(source, config, fetch_live)
  }
  let prepared = plan(source, config)
  {
    "ok": true,
    "mode": "plan",
    "documentErrors": prepared.document_errors,
    "documentWarnings": prepared.document_warnings,
    "requests": prepared.requests,
  }
}
