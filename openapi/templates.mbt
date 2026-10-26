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
  by_key : Map[String, Operation?]
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
  compile_analysis(analyze(doc), base_url~, strict~)
}

///|
pub fn compile_analysis(
  analysis : Analysis,
  base_url~ : String = "",
  strict~ : Bool = false,
) -> Result[Templates, OpenApiError] {
  let diagnostics = analysis.diagnostics()
  let errors = diagnostics.filter(fn(diagnostic) {
    diagnostic.severity == Error
  })
  if !analysis.complete() || (strict && errors.length() > 0) {
    let first = if errors.length() > 0 {
      Some(errors[0])
    } else if diagnostics.length() > 0 {
      Some(diagnostics[0])
    } else {
      None
    }
    return Err({
      code: "OpenApiInvalid",
      message: match first {
        Some(diagnostic) => diagnostic.message
        None => "OpenAPI document is incomplete"
      },
      path: match first {
        Some(diagnostic) => diagnostic.path
        None => ""
      },
    })
  }
  let by_key : Map[String, Operation?] = Map([])
  for operation in analysis.operations() {
    register_operation(
      by_key,
      operation.http_method + " " + operation.path,
      operation,
    )
    if operation.id is Some(id) {
      register_operation(by_key, id, operation)
    }
  }
  let mut base = base_url
  while base.has_suffix("/") {
    base = base[:base.length() - 1].to_owned()
  }
  Ok({ analysis, by_key, compiled: Map([]), base_url: base, })
}

///|
// None records a permanently ambiguous alias; later insertions cannot hide it.
fn register_operation(
  by_key : Map[String, Operation?],
  key : String,
  operation : Operation,
) -> Unit {
  match by_key.get(key) {
    None => by_key[key] = Some(operation)
    Some(Some(previous)) =>
      if previous.http_method != operation.http_method ||
        previous.path != operation.path {
        by_key[key] = None
      }
    Some(None) => ()
  }
}

///|
fn Templates::operation(
  self : Templates,
  key : String,
) -> Result[Operation, OpenApiError] {
  match self.by_key.get(key) {
    Some(Some(operation)) => Ok(operation)
    Some(None) =>
      Err({
        code: "AmbiguousOperation",
        message: "multiple operations match " + key,
        path: "",
      })
    None =>
      Err({
        code: "UnknownOperation",
        message: "no operation " + key,
        path: "",
      })
  }
}

///|
pub fn Templates::get(
  self : Templates,
  key : String,
) -> Result[Operation, OpenApiError] {
  self.operation(key).map(fn(operation) { operation.captured() })
}

///|
fn unsupported_operation(key : String, operation : Operation) -> OpenApiError {
  let reasons = operation.unsupported
    .map(fn(item) { item.name + " (" + item.reason + ")" })
    .join("; ")
  {
    code: "UnsupportedOperation",
    message: key +
    " has no RFC 6570 template: " +
    (if reasons == "" {
      "its path parameters are not declared"
    } else {
      reasons
    }),
    path: "",
  }
}

///|
/// Reject required query parameters whose serialization cannot be represented.
pub fn Operation::check_required_support(
  self : Operation,
) -> Result[Unit, OpenApiError] {
  // Unsupported optional query parameters may be omitted, required ones cannot.
  // Match both name and location so ignored header/cookie declarations cannot
  // make a same-name optional query parameter required.
  for item in self.unsupported {
    if item.location == Query &&
      self.parameters.any(fn(parameter) {
        parameter.name == item.name &&
        parameter.location == item.location &&
        parameter.required
      }) {
      return Err({
        code: "UnsupportedParameter",
        message: item.name + ": " + item.reason,
        path: "/" + ptr(item.name),
      })
    }
  }
  Ok(())
}

///|
fn Templates::compiled_operation(
  self : Templates,
  key : String,
  operation : Operation,
) -> Result[@core.ContractTemplate, OpenApiError] {
  match operation.check_required_support() {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  let cache_key = operation.http_method + " " + operation.path
  match self.compiled.get(cache_key) {
    Some(template) => Ok(template)
    None => {
      guard operation.template is Some(source) else {
        return Err(unsupported_operation(key, operation))
      }
      let template = match core_parse(source) {
        Ok(value) => value
        Err(error) =>
          return Err({ code: error.code, message: error.message, path: "", })
      }
      let required : Array[String] = []
      let rules : Array[@core.BindingRule] = []
      for parameter in operation.parameters {
        if parameter.variable is Some(variable) {
          if parameter.required && !required.contains(variable) {
            required.push(variable)
          }
          if parameter.shape is Some(shape) {
            rules.push({
              name: variable,
              kind: match shape {
                ScalarShape => @core.ScalarKind
                ListShape => @core.ListKind
                AssocShape => @core.AssocKind
              },
            })
          }
        }
      }
      let contract = match template.with_contract(rules, required~) {
        Ok(value) => value
        Err(error) =>
          return Err({ code: error.code, message: error.message, path: "", })
      }
      self.compiled[cache_key] = contract
      Ok(contract)
    }
  }
}

///|
/// Variables use OpenAPI parameter names. Header and cookie bindings are
/// accepted but do not appear in the expanded URI.
pub fn Templates::expand(
  self : Templates,
  key : String,
  variables : @core.Variables,
) -> Result[String, OpenApiError] {
  let operation = match self.operation(key) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  guard operation.template is Some(_) else {
    return Err(unsupported_operation(key, operation))
  }
  let mapped = @core.Variables::new()
  for name in variables.names() {
    match
      operation.unsupported.iter().find_first(fn(item) { item.name == name }) {
      Some(item) =>
        return Err({
          code: "UnsupportedParameter",
          message: name + ": " + item.reason,
          path: "/" + ptr(name),
        })
      None => ()
    }
    // Header/cookie bindings share the flat input namespace but cannot shadow
    // a URL binding with the same name.
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
        path: "/" + ptr(name),
      })
    }
    if parameter.variable is Some(variable) &&
      variables.get(name) is Some(value) {
      mapped.set(variable, value)
    }
  }
  let compiled = match self.compiled_operation(key, operation) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  match
    compiled.expand(
      mapped,
      limits=@core.ExpansionLimits::new(
        max_bindings=4096,
        max_members=65536,
        max_value_codepoints=1048576,
        max_total_value_codepoints=4194304,
        max_output_bytes=1048576,
      ),
    ) {
    Ok(uri) => Ok(self.base_url + uri)
    Err(error) => Err({ code: error.code, message: error.message, path: "", })
  }
}
