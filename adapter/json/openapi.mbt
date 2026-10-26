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
fn selected_bindings(
  templates : @openapi.Templates,
  key : String,
  names : Array[(String, Bool)],
) -> Result[Array[(String, String)], @openapi.OpenApiError] {
  let operation = match templates.get(key) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  guard operation.template is Some(_) else {
    let reasons = operation.unsupported
      .map(fn(item) { item.name + " (" + item.reason + ")" })
      .join("; ")
    return Err({
      code: "UnsupportedOperation",
      message: key +
      " has no RFC 6570 template: " +
      (if reasons == "" {
        "its path parameters are not declared"
      } else {
        reasons
      }),
      path: "",
    })
  }
  match operation.check_required_support() {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  let selected : Array[(String, String)] = []
  for (name, defined) in names {
    match
      operation.unsupported.iter().find_first(fn(item) { item.name == name }) {
      Some(item) =>
        if defined {
          return Err({
            code: "UnsupportedParameter",
            message: name + ": " + item.reason,
            path: "/" +
            name.replace_all(old="~", new="~0").replace_all(old="/", new="~1"),
          })
        }
      None => ()
    }
    let preferred = operation.parameters
      .iter()
      .find_first(fn(parameter) {
        parameter.name == name && parameter.variable != None
      })
    let parameter = match preferred {
      Some(_) => preferred
      None =>
        operation.parameters
        .iter()
        .find_first(fn(parameter) { parameter.name == name })
    }
    guard parameter is Some(parameter) else {
      return Err({
        code: "UnknownParameter",
        message: key + " has no parameter " + name,
        path: "/" +
        name.replace_all(old="~", new="~0").replace_all(old="/", new="~1"),
      })
    }
    if parameter.variable is Some(variable) {
      selected.push((name, variable))
    }
  }
  Ok(selected)
}

///|
fn contract_options(
  templates : @openapi.Templates,
  key : String,
) -> Result[Json, @openapi.OpenApiError] {
  let operation = match templates.get(key) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  match selected_bindings(templates, key, []) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  let required : Array[Json] = []
  let types : Map[String, Json] = Map([])
  for parameter in operation.parameters {
    if parameter.variable is Some(variable) {
      if parameter.required && !required.contains(Json::string(variable)) {
        required.push(Json::string(variable))
      }
      if parameter.shape is Some(shape) {
        types[variable] = Json::string(
          match shape {
            @openapi.ScalarShape => "scalar"
            @openapi.ListShape => "list"
            @openapi.AssocShape => "assoc"
          },
        )
      }
    }
  }
  Ok({ "required": Json::array(required), "types": Json::object(types) })
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
    Ok(a) => @openapi.compile_analysis(a, base_url~, strict~)
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
        if a.to_json() is Object(fields) {
          err["diagnostics"] = fields
            .get("diagnostics")
            .unwrap_or(Json::array([]))
        }
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
  let vars = match parse_variables(source) {
    Ok(value) => value
    Err(error) => return input_failure(error.code, error.message, error.path)
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
  match selected_bindings(t, key, names.map(fn(name) { (name, true) })) {
    Err(error) =>
      return Json::object(Map([("error", openapi_error(error))])).stringify()
    Ok(_) => ()
  }
  match t.expand(key, vars) {
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
  match selected_bindings(t, key, names) {
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
  match contract_options(t, key) {
    Ok(options) => Json::object(Map([("output", options)])).stringify()
    Err(e) => Json::object(Map([("error", openapi_error(e))])).stringify()
  }
}
