///|
fn finding_json(f : @template.BindingFinding) -> Json {
  let fields = Map([
    ("code", Json::string(f.code)),
    ("variable", Json::string(f.variable)),
    (
      "message",
      Json::string(
        match f.code {
          "MissingBinding" => "required variable is not bound"
          "OmittedBinding" => "required collection is empty"
          "UnknownRequired" => "required name is not referenced"
          "UnusedBinding" => "binding is not referenced"
          "PrefixOnComposite" => "prefix requires a scalar"
          "BindingType" => "binding does not match its declared type"
          _ => "binding contract finding"
        },
      ),
    ),
  ])
  if f.span is Some(span) {
    fields["start"] = int_json(span.start)
    fields["end"] = int_json(span.end)
    fields["offsetUnit"] = Json::string("unicode-code-point")
  }
  Json::object(fields)
}

///|
pub fn PreparedRequest::inspect(
  self : PreparedRequest,
  variables_json : String,
  max_findings : Int32,
) -> String {
  let c = match self.compiled {
    Err(message) => return message
    Ok(c) => c
  }
  if json_guard(variables_json, c.max_json, c.max_depth) is Some(code) {
    return input_failure(code, "variables JSON exceeds budget", "")
  }
  let vars = match parse_variables(variables_json) {
    Err(e) => return input_failure(e.code, e.message, e.path)
    Ok(vars) => vars
  }
  if c.contract is Some(contract) {
    return match contract.inspect(vars, limits=c.limits, max_findings~) {
      Err(e) => template_failure(e)
      Ok(findings) =>
        success(Json::array(findings.map(finding_json)).stringify())
    }
  }
  match
    c.template.check_contract(
      vars,
      required=c.required,
      reject_unused=c.reject_unused,
      limits=c.limits,
      max_findings~,
    ) {
    Err(error) => template_failure(error)
    Ok(findings) => success(Json::array(findings.map(finding_json)).stringify())
  }
}

///|
fn policy_from_json(
  source : String,
) -> Result[@template.TemplatePolicy, String] {
  if json_guard(source, 65536, 8) is Some(code) {
    return Err(input_failure(code, "policy JSON exceeds budget", ""))
  }
  let value = @jsonlib.parse(source) catch {
    _ =>
      return Err(
        input_failure("InvalidPolicy", "policy must be a JSON object", ""),
      )
  }
  guard value is Object(fields) else {
    return Err(input_failure("InvalidPolicy", "policy must be an object", ""))
  }
  let mut policy = @template.TemplatePolicy::new()
  for key, value in fields {
    let path = "/" + pointer(key)
    if [
        "allowReserved", "allowFragment", "allowPrefix", "allowExplode", "forbidRepeatedVariables",
      ].contains(key) {
      if !(value is True) && !(value is False) {
        return Err(input_failure("InvalidPolicy", "expected boolean", path))
      }
      let flag = value is True
      policy = match key {
        "allowReserved" => { ..policy, allow_reserved: flag, }
        "allowFragment" => { ..policy, allow_fragment: flag, }
        "allowPrefix" => { ..policy, allow_prefix: flag, }
        "allowExplode" => { ..policy, allow_explode: flag, }
        _ => { ..policy, forbid_repeated_variables: flag, }
      }
    } else if key == "maxLevel" || key == "maxReferences" {
      guard value is Number(n, ..) else {
        return Err(input_failure("InvalidPolicy", "expected integer", path))
      }
      if !(n >= 0 && n <= 2147483647 && n == n.to_int().to_double()) {
        return Err(
          input_failure("InvalidPolicy", "expected nonnegative integer", path),
        )
      }
      policy = if key == "maxLevel" {
        { ..policy, max_level: n.to_int(), }
      } else {
        { ..policy, max_references: n.to_int(), }
      }
    } else if key == "allowedVariables" {
      if value is Null {
        continue
      }
      guard value is Array(items) else {
        return Err(
          input_failure("InvalidPolicy", "expected string array or null", path),
        )
      }
      let names : Array[String] = []
      for item in items {
        guard item is String(name) else {
          return Err(
            input_failure("InvalidPolicy", "expected variable name", path),
          )
        }
        names.push(name)
      }
      policy = { ..policy, allowed_variables: Some(names), }
    } else {
      return Err(input_failure("InvalidPolicy", "unknown policy field", path))
    }
  }
  Ok(policy)
}

///|
pub fn PreparedRequest::audit(
  self : PreparedRequest,
  policy_json : String,
  max_findings : Int32,
) -> String {
  let c = match self.compiled {
    Err(message) => return message
    Ok(c) => c
  }
  let policy = match policy_from_json(policy_json) {
    Err(message) => return message
    Ok(policy) => policy
  }
  match c.template.audit_with_limit(policy, max_findings~) {
    Err(error) => template_failure(error)
    Ok(findings) =>
      success(
        Json::array(
          findings.map(e => {
            Json::object(
              Map([
                ("code", Json::string(e.code)),
                ("message", Json::string(e.message)),
                ("start", int_json(e.span.start)),
                ("end", int_json(e.span.end)),
                ("offsetUnit", Json::string("unicode-code-point")),
              ]),
            )
          }),
        ).stringify(),
      )
  }
}
