///|
pub struct Analysis {
  data : Json
}

///|
pub fn Analysis::to_json(self : Analysis) -> Json {
  self.data
}

///|
pub fn Analysis::operations(self : Analysis) -> Array[Json] {
  array(get(self.data, "operations")).copy()
}

///|
pub fn Analysis::diagnostics(self : Analysis) -> Array[Json] {
  array(get(self.data, "diagnostics")).copy()
}

///|
priv struct Context {
  doc : Json
  diagnostics : Array[Json]
  operations : Array[Json]
  reported : Map[String, Bool]
  mut errors : Int32
  mut warnings : Int32
  mut complete : Bool
}

///|
fn Context::add(
  self : Context,
  code : String,
  message : String,
  path : String,
  warning~ : Bool = false,
  incomplete~ : Bool = false,
  once~ : Bool = false,
) -> Unit {
  if incomplete {
    self.complete = false
  }
  let key = code + " " + path
  if once {
    if self.reported.contains(key) {
      return
    }
    self.reported[key] = true
  }
  let count = if warning {
    let n = self.warnings
    self.warnings += 1
    n
  } else {
    let n = self.errors
    self.errors += 1
    n
  }
  if count >= 256 {
    if !warning {
      self.complete = false
    }
    return
  }
  self.diagnostics.push({
    "code": code,
    "severity": if warning {
      "warning"
    } else {
      "error"
    },
    "message": message,
    "path": path,
  })
}

///|
fn Context::finish(self : Context) -> Analysis {
  {
    data: {
      "schemaVersion": 2,
      "ok": self.errors == 0,
      "complete": self.complete,
      "operations": self.operations,
      "diagnostics": self.diagnostics,
      "truncated": {
        "errors": Int32::max(0, self.errors - 256),
        "warnings": Int32::max(0, self.warnings - 256),
      },
    },
  }
}

///|
fn Context::resolve(
  self : Context,
  input : Json,
  path : String,
  quiet~ : Bool = false,
) -> (Json, String)? {
  let mut value = input
  let mut pointer = path
  let seen : Map[String, Bool] = Map([])
  fn fail(code : String, message : String) -> (Json, String)? {
    if !quiet {
      self.add(code, message, path, incomplete=true)
    }
    None
  }
  while obj(value) && has(value, "$ref") {
    guard get(value, "$ref") is String(ref_) && ref_.has_prefix("#/") else {
      return fail(
        "UnsupportedReference", "only local JSON Pointer references are supported",
      )
    }
    if !quiet &&
      entries(value)
      .iter()
      .any(fn(e) { !["$ref", "summary", "description"].contains(e.0) }) {
      return fail("ReferenceSiblings", "reference siblings need review")
    }
    if seen.contains(ref_) || seen.length() >= 32 {
      return fail("ReferenceCycle", "cyclic or excessive reference chain")
    }
    seen[ref_] = true
    guard decode_pointer(ref_[1:].to_owned()) is Some(decoded) else {
      return fail("InvalidReference", "invalid JSON Pointer")
    }
    pointer = decoded
    value = self.doc
    for part in decoded[1:].split("/") {
      let chars = part.to_owned().to_array()
      for i, c in chars {
        if c == '~' &&
          (
            i + 1 >= chars.length() ||
            (chars[i + 1] != '0' && chars[i + 1] != '1')
          ) {
          return fail("InvalidReference", "invalid JSON Pointer")
        }
      }
      let key = part
        .to_owned()
        .replace_all(old="~1", new="/")
        .replace_all(old="~0", new="~")
      match value {
        Object(m) =>
          match m.get(key) {
            Some(x) => value = x
            None =>
              return fail(
                "UnresolvedReference", "reference target does not exist",
              )
          }
        Array(a) => {
          let mut found = false
          for i, x in a {
            if i.to_string() == key {
              value = x
              found = true
              break
            }
          }
          if !found {
            return fail(
              "UnresolvedReference", "reference target does not exist",
            )
          }
        }
        _ =>
          return fail("UnresolvedReference", "reference target does not exist")
      }
    }
  }
  if !obj(value) {
    if !quiet {
      self.add("InvalidObject", "expected an object", path, incomplete=true)
    }
    return None
  }
  Some((value, pointer))
}

///|
fn Context::schema_shape(
  self : Context,
  schema : Json,
  path : String,
) -> String? {
  guard self.resolve(schema, path, quiet=true) is Some((s, _)) else {
    return None
  }
  if ["oneOf", "anyOf", "allOf", "not"].iter().any(fn(k) { truth(get(s, k)) }) {
    return None
  }
  let types = match get(s, "type") {
    Array(a) => a
    v => [v]
  }
  let shapes : Map[String, Bool] = Map([])
  for t in types {
    if t == Json::string("null") {
      continue
    }
    let shape = match str(t) {
      "array" => "list"
      "object" => "assoc"
      "string" | "integer" | "number" | "boolean" => "scalar"
      _ => return None
    }
    shapes[shape] = true
  }
  if shapes.length() == 1 {
    shapes.keys().next()
  } else {
    None
  }
}

///|
fn Context::example_of(
  self : Context,
  p : Json,
  pointer : String,
) -> (Json, String)? {
  if has(p, "example") {
    return Some((get(p, "example"), pointer + "/example"))
  }
  for (key, raw) in entries(get(p, "examples")) {
    if self.resolve(raw, pointer + "/examples/" + ptr(key), quiet=true)
      is Some((v, loc)) &&
      has(v, "value") {
      return Some((get(v, "value"), loc + "/value"))
    }
  }
  if self.resolve(get(p, "schema"), pointer + "/schema", quiet=true)
    is Some((s, loc)) {
    if has(s, "example") {
      return Some((get(s, "example"), loc + "/example"))
    }
    let xs = array(get(s, "examples"))
    if xs.length() > 0 {
      return Some((xs[0], loc + "/examples/0"))
    }
  }
  None
}

///|
fn parameter_key(p : Json) -> String {
  Json::array([get(p, "in"), get(p, "name")]).stringify()
}

///|
fn Context::parameters(
  self : Context,
  value : Json,
  present : Bool,
  path : String,
  names : Array[String],
) -> Map[String, (Json, String)] {
  let result : Map[String, (Json, String)] = Map([])
  if !present {
    return result
  }
  guard value is Array(items) else {
    self.add(
      "InvalidParameters",
      "parameters must be an array",
      path,
      incomplete=true,
    )
    return result
  }
  for i, raw in items {
    let where_ = path + "/" + i.to_string()
    guard self.resolve(raw, where_) is Some((p, pointer)) else { continue }
    guard get(p, "name") is String(name) &&
      name != "" &&
      ["path", "query", "header", "cookie"].contains(str(get(p, "in"))) else {
      self.add(
        "InvalidParameter", "parameter requires name and valid in", where_,
      )
      continue
    }
    let key = parameter_key(p)
    if result.contains(key) {
      self.add(
        "DuplicateParameter", "duplicate name and location in the same parameter list",
        where_,
      )
    }
    result[key] = (p, pointer)
    if get(p, "in") == Json::string("path") {
      if get(p, "required") != Json::boolean(true) {
        self.add(
          "PathParameterRequired", "path parameter must set required: true", where_,
        )
      }
      if !names.contains(name) {
        self.add(
          "UnusedPathParameter",
          "path does not contain parameter " + name,
          where_,
        )
      }
    }
  }
  result
}

///|
fn placeholders(path : String) -> Array[(Bool, String)]? {
  let parts : Array[(Bool, String)] = []
  let literal = StringBuilder()
  let chars = path.to_array()
  let mut i = 0
  while i < chars.length() {
    if chars[i] == '}' {
      return None
    }
    if chars[i] != '{' {
      literal.write_char(chars[i])
      i += 1
      continue
    }
    parts.push((false, literal.to_string()))
    literal.reset()
    i += 1
    let name = StringBuilder()
    while i < chars.length() && chars[i] != '}' {
      if chars[i] == '{' {
        return None
      }
      name.write_char(chars[i])
      i += 1
    }
    if i == chars.length() || name.to_string() == "" {
      return None
    }
    parts.push((true, name.to_string()))
    i += 1
  }
  parts.push((false, literal.to_string()))
  Some(parts)
}

///|
fn bad_literal(literal : String) -> String? {
  let a = literal.to_array()
  let mut i = 0
  while i < a.length() {
    let c = a[i]
    if c == '%' &&
      i + 2 < a.length() &&
      hex(a[i + 1]) >= 0 &&
      hex(a[i + 2]) >= 0 {
      i += 3
      continue
    }
    if !alnum(c) && !"-._~!$&'()*+,;=:@/".contains(c.to_string()) {
      return Some(c.to_string())
    }
    i += 1
  }
  None
}

///|
fn core_parse(s : String) -> Result[@core.Template, @core.TemplateError] {
  @core.parse_with_limits(
    s,
    @core.ParseLimits::new(
      max_template_codepoints=1048576,
      max_expressions=4096,
      max_variables_per_expression=256,
      max_total_variables=65536,
    ),
  )
}

///|
pub fn analyze(doc : Json) -> Analysis {
  let ctx : Context = {
    doc,
    diagnostics: [],
    operations: [],
    reported: Map([]),
    errors: 0,
    warnings: 0,
    complete: true,
  }
  let version = str(get(doc, "openapi"))
  let parts = version.split(".").collect()
  if !obj(doc) ||
    parts.length() != 3 ||
    parts[0] != "3" ||
    (parts[1] != "0" && parts[1] != "1") ||
    parts[2].is_empty() ||
    !parts[2].iter().all(fn(c) { c >= '0' && c <= '9' }) {
    ctx.add(
      "UnsupportedVersion",
      "expected OpenAPI 3.0.x or 3.1.x",
      "/openapi",
      incomplete=true,
    )
    return ctx.finish()
  }
  if !has(doc, "paths") && version.has_prefix("3.1.") {
    return ctx.finish()
  }
  if !obj(get(doc, "paths")) {
    ctx.add(
      "InvalidPaths",
      "paths must be an object",
      "/paths",
      incomplete=true,
    )
    return ctx.finish()
  }
  let shapes : Map[String, String] = Map([])
  let ids : Map[String, String] = Map([])
  for (path, raw) in entries(get(doc, "paths")) {
    if path.has_prefix("x-") {
      continue
    }
    let where_ = "/paths/" + ptr(path)
    if !path.has_prefix("/") {
      ctx.add("InvalidPath", "path must start with /", where_)
      continue
    }
    guard placeholders(path) is Some(tokens) else {
      ctx.add(
        "InvalidPathTemplate", "unbalanced or empty path placeholder", where_,
      )
      continue
    }
    let names : Array[String] = []
    let normalized = StringBuilder()
    let literal = StringBuilder()
    let shape = StringBuilder()
    for (is_var, text) in tokens {
      if is_var {
        if !names.contains(text) {
          names.push(text)
        }
        let index = names.search(text).unwrap()
        normalized.write_string("{v" + index.to_string() + "}")
        shape.write_string("{}")
      } else {
        normalized.write_string(text)
        literal.write_string(text)
        shape.write_string(text)
      }
    }
    if bad_literal(literal.to_string()) is Some(bad) {
      let message = if bad == "?" {
        "path contains a query string; declare query parameters instead"
      } else if bad == "#" {
        "path contains a fragment, which is never sent to the server"
      } else {
        "path literal contains " +
        Json::string(bad).stringify() +
        "; percent-encode it"
      }
      ctx.add("InvalidPath", message, where_)
      continue
    }
    match core_parse(normalized.to_string()) {
      Err(e) => {
        ctx.add("InvalidPathTemplate", e.message, where_)
        continue
      }
      Ok(_) => ()
    }
    let key = shape.to_string()
    match shapes.get(key) {
      Some(prev) =>
        ctx.add("EquivalentPaths", "same path hierarchy as " + prev, where_)
      None => shapes[key] = path
    }
    guard ctx.resolve(raw, where_) is Some((item, _)) else { continue }
    let base = ctx.parameters(
      get(item, "parameters"),
      has(item, "parameters"),
      where_ + "/parameters",
      names,
    )
    for
      verb in [
        "get", "put", "post", "delete", "options", "head", "patch", "trace",
      ] {
      if !has(item, verb) {
        continue
      }
      let op_where = where_ + "/" + verb
      let op = get(item, verb)
      if !obj(op) {
        ctx.add("InvalidOperation", "operation must be an object", op_where)
        continue
      }
      let effective = base.copy()
      for
        k, v in ctx.parameters(
          get(op, "parameters"),
          has(op, "parameters"),
          op_where + "/parameters",
          names,
        ) {
        effective[k] = v
      }
      let mut missing = false
      for name in names {
        if !effective.contains(
            Json::array([Json::string("path"), Json::string(name)]).stringify(),
          ) {
          ctx.add(
            "MissingPathParameter",
            "missing path parameter " + name,
            op_where,
          )
          missing = true
        }
      }
      let id = match get(op, "operationId") {
        String(s) => Json::string(s)
        _ => null
      }
      if id is String(s) {
        match ids.get(s) {
          Some(prev) =>
            ctx.add(
              "DuplicateOperationId",
              "operationId " + s + " is also used by " + prev,
              op_where + "/operationId",
            )
          None => ids[s] = upper(verb) + " " + path
        }
      }
      ctx.operations.push(
        ctx.operation(id, verb, path, names, tokens, effective, missing),
      )
    }
  }
  ctx.finish()
}

///|
fn Context::operation(
  self : Context,
  id : Json,
  verb : String,
  path : String,
  names : Array[String],
  tokens : Array[(Bool, String)],
  effective : Map[String, (Json, String)],
  missing : Bool,
) -> Json {
  let params : Array[Json] = []
  let unsupported : Array[Json] = []
  let path_vars : Map[String, String] = Map([])
  let query : Array[String] = []
  let example : Map[String, Json] = Map([])
  let path_names = names.map(template_name)
  let mut example_complete = true
  for _, pair in effective {
    let (p, pointer) = pair
    let name = str(get(p, "name"))
    let location = str(get(p, "in"))
    let shape = self.schema_shape(get(p, "schema"), pointer + "/schema")
    let entry : Map[String, Json] = Map([
      ("name", get(p, "name")),
      ("in", get(p, "in")),
      ("required", Json::boolean(get(p, "required") == Json::boolean(true))),
      (
        "shape",
        match shape {
          Some(s) => Json::string(s)
          None => Json::null()
        },
      ),
      ("variable", Json::null()),
    ])
    params.push(Json::object(entry))
    if location == "header" || location == "cookie" {
      continue
    }
    let style = if get(p, "style") == Json::null() {
      if location == "path" {
        "simple"
      } else {
        "form"
      }
    } else {
      str(get(p, "style"))
    }
    let explode = if get(p, "explode") == Json::null() {
      style == "form"
    } else {
      truth(get(p, "explode"))
    }
    let mut reason : String? = None
    if has(p, "content") {
      reason = Some("content-based serialization has no RFC 6570 equivalent")
    } else if location == "path" &&
      !["simple", "label", "matrix"].contains(style) {
      reason = Some("style " + style + " is not defined for path parameters")
    } else if location == "query" && style != "form" {
      reason = Some("style " + style + " has no RFC 6570 equivalent")
    } else if location == "query" &&
      get(p, "allowReserved") == Json::boolean(true) {
      reason = Some("form style with allowReserved has no RFC 6570 equivalent")
    }
    let variable = template_name(name)
    if reason == None && location == "path" && !names.contains(name) {
      reason = Some("the path does not contain this parameter")
    }
    if reason == None && location == "query" && path_names.contains(variable) {
      reason = Some("name is also used by a path parameter")
    }
    if reason is Some(r) {
      unsupported.push({ "name": name, "in": location, "reason": r })
      continue
    }
    entry["variable"] = Json::string(variable)
    let spec = variable +
      (if explode && shape != Some("scalar") { "*" } else { "" })
    if location == "path" {
      path_vars[variable] = (match style {
          "label" => "."
          "matrix" => ";"
          _ => ""
        }) +
        spec
    } else {
      query.push(spec)
    }
    if self.example_of(p, pointer) is Some((sample, sample_pointer)) {
      let actual = value_shape(sample)
      if actual == Some("nested") {
        self.add(
          "ExampleNotSerializable",
          "example for " +
          location +
          " parameter " +
          name +
          " nests values deeper than RFC 6570 defines",
          sample_pointer,
          warning=true,
          once=true,
        )
      } else if actual is Some(a) && shape is Some(s) && a != s {
        fn word(s : String) -> String {
          match s {
            "scalar" => "a scalar"
            "list" => "a list"
            _ => "an object"
          }
        }
        self.add(
          "ExampleShapeMismatch",
          "example for " +
          location +
          " parameter " +
          name +
          " is " +
          word(a) +
          " but its schema is " +
          word(s),
          sample_pointer,
          warning=true,
          once=true,
        )
      } else if actual != None {
        example[variable] = sample
      }
    }
    if location == "path" && !example.contains(variable) {
      example_complete = false
    }
  }
  let path_unsupported = unsupported
    .iter()
    .any(fn(u) {
      get(u, "in") == Json::string("path") &&
      names.contains(str(get(u, "name")))
    })
  let mut template : Json = null
  let mut example_uri : Json = null
  if !missing && !path_unsupported {
    let s = StringBuilder()
    for (is_var, text) in tokens {
      if is_var {
        s.write_string(
          "{" + path_vars.get(template_name(text)).unwrap_or("undefined") + "}",
        )
      } else {
        s.write_string(text)
      }
    }
    if query.length() > 0 {
      s.write_string("{?" + query.join(",") + "}")
    }
    template = Json::string(s.to_string())
    if example_complete {
      if core_parse(s.to_string()) is Ok(t) &&
        bindings(Json::object(example)) is Some(vars) {
        if t.expand(
            vars,
            limits=@core.ExpansionLimits::new(
              max_bindings=4096,
              max_members=65536,
              max_value_codepoints=1048576,
              max_total_value_codepoints=4194304,
              max_output_bytes=1048576,
            ),
          )
          is Ok(uri) {
          example_uri = Json::string(uri)
        }
      }
    }
  }
  {
    "id": id,
    "method": upper(verb),
    "path": path,
    "template": template,
    "parameters": params,
    "unsupported": unsupported,
    "example": example_uri,
  }
}

///|
pub fn analyze_text(source : String) -> Result[Analysis, OpenApiError] {
  let doc = @json.parse(source) catch {
    _ =>
      return Err({
        code: "InvalidJson",
        message: "OpenAPI document is not valid JSON",
        path: "",
      })
  }
  Ok(analyze(doc))
}
