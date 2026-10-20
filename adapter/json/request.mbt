///|
fn failure(code : Int32, error : Json) -> String {
  Json::object(
    Map([("exitCode", Json::number(code.to_double())), ("error", error)]),
  ).stringify()
}

///|
fn input_failure(code : String, message : String, path : String) -> String {
  failure(
    2,
    Json::object(
      Map([
        ("code", Json::string(code)),
        ("message", Json::string(message)),
        ("path", Json::string(path)),
      ]),
    ),
  )
}

///|
fn template_failure(e : @template.TemplateError) -> String {
  let fields = Map([
    ("code", Json::string(e.code)),
    ("message", Json::string(e.message)),
  ])
  if [
      "BindingLimit", "MemberLimit", "ValueLimit", "TotalValueLimit", "InvalidLimit",
      "UnknownRequired", "UnusedBinding", "InvalidPolicy", "FindingLimit",
    ].contains(e.code) {
    fields["scope"] = Json::string("bindings-or-options")
  } else {
    fields["start"] = Json::number(e.span.start.to_double())
    fields["end"] = Json::number(e.span.end.to_double())
    fields["offsetUnit"] = Json::string("unicode-code-point")
  }
  failure(1, Json::object(fields))
}

///|
fn success(output : String) -> String {
  Json::object(
    Map([("exitCode", Json::number(0)), ("output", Json::string(output))]),
  ).stringify()
}

///|
fn issue_json(issue : @template.BindingIssue) -> Json {
  Json::object(
    Map([
      ("name", Json::string(issue.name)),
      ("start", Json::number(issue.span.start.to_double())),
      ("end", Json::number(issue.span.end.to_double())),
    ]),
  )
}

///|
fn binding_json(report : @template.BindingReport) -> Json {
  Json::object(
    Map([
      ("referenced", Json::array(report.referenced.map(Json::string))),
      ("missing", Json::array(report.missing.map(issue_json))),
      ("omitted", Json::array(report.omitted.map(issue_json))),
      ("unused", Json::array(report.unused.map(Json::string))),
      (
        "invalid",
        Json::array(
          report.invalid.map(e => {
            Json::object(
              Map([
                ("code", Json::string(e.code)),
                ("start", Json::number(e.span.start.to_double())),
                ("end", Json::number(e.span.end.to_double())),
              ]),
            )
          }),
        ),
      ),
      ("offsetUnit", Json::string("unicode-code-point")),
    ]),
  )
}

///|
// Cheap lexical budget guard runs BEFORE recursive JSON parsing and typed copies.
fn json_guard(source : String, max_chars : Int32, max_depth : Int32) -> String? {
  let mut remaining = max_chars
  let mut depth = 0
  let mut quoted = false
  let mut escaped = false
  for c in source.iter() {
    if remaining == 0 {
      return Some("JsonInputLimit")
    }
    remaining = remaining - 1
    if quoted {
      if escaped {
        escaped = false
      } else if c == '\\' {
        escaped = true
      } else if c == '"' {
        quoted = false
      }
    } else if c == '"' {
      quoted = true
    } else if c == '{' || c == '[' {
      if depth >= max_depth {
        return Some("JsonDepthLimit")
      }
      depth = depth + 1
    } else if c == '}' || c == ']' {
      depth = depth - 1
    }
  }
  None
}

///|
/// Opaque compiled bridge; no global handle registry or retained input variables.
struct PreparedRequest {
  compiled : Result[CompiledRequest, String]
}

///|
priv struct CompiledRequest {
  template : @template.Template
  limits : @template.ExpansionLimits
  required : Array[String]
  reject_unused : Bool
  max_json : Int32
  max_depth : Int32
}

///|
fn prepare_failure(
  code : String,
  message : String,
  path : String,
) -> Result[CompiledRequest, String] {
  Err(input_failure(code, message, path))
}

///|
fn compile_request(
  source : String,
  options_json : String,
  force_strict : Bool,
) -> Result[CompiledRequest, String] {
  if json_guard(options_json, 65536, 8) is Some(code) {
    return prepare_failure(code, "options JSON exceeds budget", "")
  }
  let options = @jsonlib.parse(options_json) catch {
    _ =>
      return prepare_failure(
        "InvalidOptions", "options must be a JSON object", "",
      )
  }
  guard options is Object(fields) else {
    return prepare_failure(
      "InvalidOptions", "options must be a JSON object", "",
    )
  }
  let numbers : Map[String, Int32] = Map([
    ("maxTemplate", 1048576),
    ("maxExpressions", 4096),
    ("maxVarsPerExpression", 256),
    ("maxVariables", 65536),
    ("maxBindings", 4096),
    ("maxMembers", 65536),
    ("maxValue", 1048576),
    ("maxTotalValue", 4194304),
    ("maxOutput", 1048576),
    ("maxJson", 4194304),
    ("maxJsonDepth", 32),
  ])
  let mut strict = force_strict
  let mut require_all = false
  let mut reject_unused = false
  let required : Array[String] = []
  for key, value in fields {
    if numbers.contains(key) {
      match value {
        Number(n, ..) => {
          if !(n >= 0 && n <= 2147483647 && n == n.to_int().to_double()) {
            return prepare_failure(
              "InvalidOptions",
              "budget must be an integer in 0..2147483647",
              "/" + key,
            )
          }
          numbers[key] = n.to_int()
        }
        _ =>
          return prepare_failure(
            "InvalidOptions",
            "budget must be an integer",
            "/" + key,
          )
      }
    } else if key == "strict" || key == "requireAll" || key == "rejectUnused" {
      if !(value is True) && !(value is False) {
        return prepare_failure("InvalidOptions", "expected boolean", "/" + key)
      }
      let flag = value is True
      if key == "strict" {
        strict = strict || flag
      } else if key == "requireAll" {
        require_all = flag
      } else {
        reject_unused = flag
      }
    } else if key == "required" {
      guard value is Array(items) else {
        return prepare_failure(
          "InvalidOptions", "required must be a string array", "/required",
        )
      }
      for item in items {
        guard item is String(name) else {
          return prepare_failure(
            "InvalidOptions", "required must be a string array", "/required",
          )
        }
        required.push(name)
      }
    } else {
      return prepare_failure(
        "InvalidOptions",
        "unknown option",
        "/" + pointer(key),
      )
    }
  }
  let parse_limits = @template.ParseLimits::new(
    max_template_codepoints=numbers["maxTemplate"],
    max_expressions=numbers["maxExpressions"],
    max_variables_per_expression=numbers["maxVarsPerExpression"],
    max_total_variables=numbers["maxVariables"],
  )
  let limits = @template.ExpansionLimits::new(
    max_bindings=numbers["maxBindings"],
    max_members=numbers["maxMembers"],
    max_value_codepoints=numbers["maxValue"],
    max_total_value_codepoints=numbers["maxTotalValue"],
    max_output_bytes=numbers["maxOutput"],
  )
  let template = match
    @template.parse_with_limits(source, parse_limits, strict~) {
    Ok(t) => t
    Err(e) => return Err(template_failure(e))
  }
  if require_all || required.length() > 0 {
    let names = template.variables()
    let known : Map[String, Bool] = Map([])
    for name in names {
      known[name] = true
    }
    if require_all {
      required.push_iter(names.iter())
    }
    for name in required {
      if !known.contains(name) {
        return Err(
          template_failure({
            code: "UnknownRequired",
            message: "required name is not referenced by the template",
            span: { start: 0, end: 0, },
          }),
        )
      }
    }
  }
  Ok({
    template,
    limits,
    required,
    reject_unused,
    max_json: numbers["maxJson"],
    max_depth: numbers["maxJsonDepth"],
  })
}

///|
pub fn prepare_request(
  source : String,
  options_json : String,
) -> PreparedRequest {
  { compiled: compile_request(source, options_json, false), }
}

///|
pub fn PreparedRequest::call(
  self : PreparedRequest,
  command : String,
  variables_json : String,
) -> String {
  if ![
      "expand", "validate", "variables", "check", "measure", "trace", "analyze",
    ].contains(command) {
    return input_failure(
      "InvalidCommand", "expected expand, validate, variables, check, measure, trace, or analyze",
      "",
    )
  }
  match self.compiled {
    Err(message) => message
    Ok(compiled) => compiled.call(command, variables_json)
  }
}

///|
fn CompiledRequest::call(
  self : CompiledRequest,
  command : String,
  variables_json : String,
) -> String {
  let template = self.template
  let limits = self.limits
  let required = self.required
  let reject_unused = self.reject_unused
  if command == "validate" || command == "validate-strict" {
    return success("valid")
  }
  if command == "variables" {
    return success(
      Json::array(template.variables().map(Json::string)).stringify(),
    )
  }
  if command == "analyze" {
    return success(analysis_json(template.analyze()).stringify())
  }
  if json_guard(variables_json, self.max_json, self.max_depth) is Some(code) {
    return input_failure(code, "variables JSON exceeds budget", "")
  }
  let vars = match parse_variables(variables_json) {
    Ok(v) => v
    Err(e) => return input_failure(e.code, e.message, e.path)
  }
  if command == "check" {
    return match template.check_bindings_with_limits(vars, limits) {
      Ok(report) => success(binding_json(report).stringify())
      Err(e) => template_failure(e)
    }
  }
  if command == "measure" {
    return match template.measure(vars, required~, reject_unused~, limits~) {
      Ok(n) => success(n.to_string())
      Err(e) => template_failure(e)
    }
  }
  if command == "trace" {
    return match
      template.expand_mapped(vars, required~, reject_unused~, limits~) {
      Err(e) => template_failure(e)
      Ok(r) =>
        success(
          Json::object(
            Map([
              ("uri", Json::string(r.output)),
              ("bytes", Json::number(r.bytes.to_double())),
              (
                "origins",
                Json::array(
                  r.origins.map(o => {
                    Json::object(
                      Map([
                        (
                          "name",
                          match o.name {
                            Some(n) => Json::string(n)
                            None => Json::null()
                          },
                        ),
                        ("start", Json::number(o.source.start.to_double())),
                        ("end", Json::number(o.source.end.to_double())),
                        (
                          "outputStart",
                          Json::number(o.output_start.to_double()),
                        ),
                        ("outputEnd", Json::number(o.output_end.to_double())),
                      ]),
                    )
                  }),
                ),
              ),
            ]),
          ).stringify(),
        )
    }
  }
  match template.expand_checked(vars, required~, reject_unused~, limits~) {
    Ok(value) => success(value)
    Err(e) => template_failure(e)
  }
}

///|
pub fn request_with_options(
  command : String,
  source : String,
  variables_json : String,
  options_json : String,
) -> String {
  if command == "validate-strict" {
    return match compile_request(source, options_json, true) {
      Err(message) => message
      Ok(prepared) => prepared.call("validate", variables_json)
    }
  }
  prepare_request(source, options_json).call(command, variables_json)
}

///|
pub fn request(
  command : String,
  source : String,
  variables_json : String,
) -> String {
  request_with_options(command, source, variables_json, "{}")
}
