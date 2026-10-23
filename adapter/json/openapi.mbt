///|
struct PreparedOpenApi {
  analysis : Result[@openapi.Analysis, @openapi.OpenApiError]
  compiled : Result[@openapi.Templates, @openapi.OpenApiError]
}

///|
fn openapi_error(e : @openapi.OpenApiError) -> Json {
  if e.code == "UnsupportedOperation" {
    { "code": e.code, "message": e.message }
  } else {
    { "code": e.code, "message": e.message, "path": e.path }
  }
}

///|
pub fn openapi_analyze(source : String) -> String {
  match @openapi.analyze_text(source) {
    Ok(a) => Json::object(Map([("output", a.to_json())])).stringify()
    Err(e) => Json::object(Map([("error", openapi_error(e))])).stringify()
  }
}

///|
pub fn openapi_name(name : String) -> String {
  @openapi.template_name(name)
}

///|
pub fn openapi_prepare(
  source : String,
  base_url : String,
  strict : Bool,
) -> PreparedOpenApi {
  let analysis = @openapi.analyze_text(source)
  let compiled = match analysis {
    Ok(a) => @openapi.compile_analysis(a, base_url, strict)
    Err(e) => Err(e)
  }
  { analysis, compiled, }
}

///|
pub fn PreparedOpenApi::report(self : PreparedOpenApi) -> String {
  match self.compiled {
    Ok(t) => Json::object(Map([("output", t.analysis().to_json())])).stringify()
    Err(e) => {
      let err = match openapi_error(e) {
        Object(m) => m.copy()
        _ => Map([])
      }
      if self.analysis is Ok(a) {
        err["diagnostics"] = Json::array(a.diagnostics())
      }
      Json::object(Map([("error", Json::object(err))])).stringify()
    }
  }
}

///|
pub fn PreparedOpenApi::expand(
  self : PreparedOpenApi,
  key : String,
  source : String,
  names_source : String,
) -> String {
  let t = match self.compiled {
    Ok(t) => t
    Err(e) =>
      return Json::object(Map([("error", openapi_error(e))])).stringify()
  }
  let vars = @jsonlib.parse(source) catch {
    _ => return input_failure("InvalidJson", "invalid JSON input", "")
  }
  let names_json = @jsonlib.parse(names_source) catch {
    _ => return input_failure("InvalidJson", "invalid names JSON", "")
  }
  let names : Array[String] = []
  if names_json is Array(xs) {
    for x in xs {
      if x is String(s) {
        names.push(s)
      }
    }
  }
  match t.expand_with_names(key, vars, names) {
    Ok(s) => Json::object(Map([("output", Json::string(s))])).stringify()
    Err(e) => Json::object(Map([("error", openapi_error(e))])).stringify()
  }
}

///|
pub fn PreparedOpenApi::bindings(
  self : PreparedOpenApi,
  key : String,
  source : String,
) -> String {
  let t = match self.compiled {
    Ok(t) => t
    Err(e) =>
      return Json::object(Map([("error", openapi_error(e))])).stringify()
  }
  let json = @jsonlib.parse(source) catch {
    _ => return input_failure("InvalidJson", "invalid names JSON", "")
  }
  let names : Array[(String, Bool)] = []
  if json is Array(xs) {
    for x in xs {
      if x is Array([String(name), defined]) {
        names.push((name, defined == Json::boolean(true)))
      }
    }
  }
  match t.binding_names(key, names) {
    Ok(pairs) =>
      Json::object(
        Map([
          (
            "output",
            Json::array(
              pairs.map(fn(p) {
                Json::array([Json::string(p.0), Json::string(p.1)])
              }),
            ),
          ),
        ]),
      ).stringify()
    Err(e) => Json::object(Map([("error", openapi_error(e))])).stringify()
  }
}

///|
pub fn PreparedOpenApi::contract(
  self : PreparedOpenApi,
  key : String,
) -> String {
  let t = match self.compiled {
    Ok(t) => t
    Err(e) =>
      return Json::object(Map([("error", openapi_error(e))])).stringify()
  }
  match t.contract_options(key) {
    Ok(options) => Json::object(Map([("output", options)])).stringify()
    Err(e) => Json::object(Map([("error", openapi_error(e))])).stringify()
  }
}
