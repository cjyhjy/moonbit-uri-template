///|
pub(all) struct OpenApiError {
  code : String
  message : String
  path : String
} derive(Debug, Eq)

///|
pub extend OpenApiError with Debug::{to_repr}

///|
pub extend OpenApiError with Eq::{equal, not_equal}

///|
struct Templates {
  analysis : Analysis
  by_key : Map[String, Json]
  compiled : Map[String, @core.ContractTemplate]
  base_url : String
}

///|
pub fn Templates::analysis(self : Templates) -> Analysis {
  self.analysis
}

///|
pub fn compile(
  doc : Json,
  base_url~ : String = "",
  strict~ : Bool = false,
) -> Result[Templates, OpenApiError] {
  let analysis = analyze(doc)
  match compile_analysis(analysis, base_url, strict) {
    Ok(v) => Ok(v)
    Err(e) => Err(e)
  }
}

///|
pub fn compile_analysis(
  analysis : Analysis,
  base_url : String,
  strict : Bool,
) -> Result[Templates, OpenApiError] {
  let ds = analysis.diagnostics()
  let errors = ds.filter(fn(d) { get(d, "severity") == Json::string("error") })
  if get(analysis.data, "complete") != Json::boolean(true) ||
    (strict && errors.length() > 0) {
    let first = if errors.length() > 0 {
      Some(errors[0])
    } else if ds.length() > 0 {
      Some(ds[0])
    } else {
      None
    }
    return Err({
      code: "OpenApiInvalid",
      message: match first {
        Some(d) => str(get(d, "message"))
        None => "OpenAPI document is incomplete"
      },
      path: match first {
        Some(d) => str(get(d, "path"))
        None => ""
      },
    })
  }
  let by_key : Map[String, Json] = Map([])
  for op in analysis.operations() {
    by_key[str(get(op, "method")) + " " + str(get(op, "path"))] = op
    if get(op, "id") is String(id) && !by_key.contains(id) {
      by_key[id] = op
    }
  }
  let mut base = base_url
  while base.has_suffix("/") {
    base = base[:base.length() - 1].to_owned()
  }
  Ok({ analysis, by_key, compiled: Map([]), base_url: base, })
}

///|
pub fn Templates::get(
  self : Templates,
  key : String,
) -> Result[Json, OpenApiError] {
  match self.by_key.get(key) {
    Some(op) => Ok(copy_json(op))
    None =>
      Err({
        code: "UnknownOperation",
        message: "no operation " + key,
        path: "",
      })
  }
}

///|
pub fn Templates::expand(
  self : Templates,
  key : String,
  variables : Json,
) -> Result[String, OpenApiError] {
  self.expand_with_names(key, variables, entries(variables).map(fn(x) { x.0 }))
}

///|
/// Explicit names preserve JavaScript's distinction between omitted and undefined fields.
pub fn Templates::expand_with_names(
  self : Templates,
  key : String,
  variables : Json,
  names : Array[String],
) -> Result[String, OpenApiError] {
  let op = match self.get(key) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  let unsupported = array(get(op, "unsupported"))
  guard get(op, "template") is String(source) else {
    let reasons = unsupported
      .map(fn(u) { str(get(u, "name")) + " (" + str(get(u, "reason")) + ")" })
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
  if !obj(variables) {
    return Err({
      code: "InvalidInput",
      message: "variables must be an object",
      path: "",
    })
  }
  let selected = match
    self.binding_names(
      key,
      names.map(fn(name) { (name, has(variables, name)) }),
    ) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  let mapped : Map[String, Json] = Map([])
  for (name, variable) in selected {
    if has(variables, name) {
      mapped[variable] = get(variables, name)
    }
  }
  let cache_key = str(get(op, "method")) + " " + str(get(op, "path"))
  let compiled = match self.compiled.get(cache_key) {
    Some(t) => t
    None => {
      let t = match core_parse(source) {
        Ok(t) => t
        Err(e) => return Err({ code: e.code, message: e.message, path: "", })
      }
      let options = match self.contract_options(key) {
        Ok(v) => v
        Err(e) => return Err(e)
      }
      let required = array(get(options, "required")).map(str)
      let rules = entries(get(options, "types")).map(fn(pair) {
        @core.BindingRule::{
          name: pair.0,
          kind: match str(pair.1) {
            "list" => @core.ListKind
            "assoc" => @core.AssocKind
            _ => @core.ScalarKind
          },
        }
      })
      let ct = match t.with_contract(rules, required~) {
        Ok(v) => v
        Err(e) => return Err({ code: e.code, message: e.message, path: "", })
      }
      self.compiled[cache_key] = ct
      ct
    }
  }
  guard bindings(Json::object(mapped)) is Some(vars) else {
    return Err({
      code: "InvalidInput",
      message: "expected a string, number, boolean, list of those, object of those, or null",
      path: "",
    })
  }
  match
    compiled.expand(
      vars,
      limits=@core.ExpansionLimits::new(
        max_bindings=4096,
        max_members=65536,
        max_value_codepoints=1048576,
        max_total_value_codepoints=4194304,
        max_output_bytes=1048576,
      ),
    ) {
    Ok(uri) => Ok(self.base_url + uri)
    Err(e) => Err({ code: e.code, message: e.message, path: "", })
  }
}

///|
/// Validate supplied parameter names before the host snapshots URI values.
pub fn Templates::binding_names(
  self : Templates,
  key : String,
  names : Array[(String, Bool)],
) -> Result[Array[(String, String)], OpenApiError] {
  let op = match self.get(key) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  let unsupported = array(get(op, "unsupported"))
  let params = array(get(op, "parameters"))
  guard get(op, "template") is String(_) else {
    let reasons = unsupported
      .map(fn(u) { str(get(u, "name")) + " (" + str(get(u, "reason")) + ")" })
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
  let mapped : Array[(String, String)] = []
  for (name, defined) in names {
    let blocked = unsupported
      .iter()
      .find_first(fn(p) { get(p, "name") == Json::string(name) })
    if blocked is Some(u) && defined {
      return Err({
        code: "UnsupportedParameter",
        message: name + ": " + str(get(u, "reason")),
        path: "/" + ptr(name),
      })
    }
    guard params
      .iter()
      .find_first(fn(p) { get(p, "name") == Json::string(name) })
      is Some(param) else {
      return Err({
        code: "UnknownParameter",
        message: key + " has no parameter " + name,
        path: "/" + ptr(name),
      })
    }
    if get(param, "variable") is String(v) {
      mapped.push((name, v))
    }
  }
  Ok(mapped)
}

///|
/// SDK contract options, derived from the same analyzed parameters as native expansion.
pub fn Templates::contract_options(
  self : Templates,
  key : String,
) -> Result[Json, OpenApiError] {
  let op = match self.get(key) {
    Ok(v) => v
    Err(e) => return Err(e)
  }
  match self.binding_names(key, []) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  let required : Array[Json] = []
  let types : Map[String, Json] = Map([])
  for p in array(get(op, "parameters")) {
    if get(p, "variable") is String(v) {
      if get(p, "required") == Json::boolean(true) &&
        !required.contains(Json::string(v)) {
        required.push(Json::string(v))
      }
      if get(p, "shape") is String(s) {
        types[v] = Json::string(s)
      }
    }
  }
  Ok({ "required": Json::array(required), "types": Json::object(types) })
}
