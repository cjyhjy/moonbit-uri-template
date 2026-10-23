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
  by_key : Map[String, Operation]
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
  let by_key : Map[String, Operation] = Map([])
  for operation in analysis.operations() {
    by_key[operation.http_method + " " + operation.path] = operation
    if operation.id is Some(id) && !by_key.contains(id) {
      by_key[id] = operation
    }
  }
  let mut base = base_url
  while base.has_suffix("/") {
    base = base[:base.length() - 1].to_owned()
  }
  Ok({ analysis, by_key, compiled: Map([]), base_url: base, })
}

///|
fn Templates::operation(
  self : Templates,
  key : String,
) -> Result[Operation, OpenApiError] {
  match self.by_key.get(key) {
    Some(operation) => Ok(operation)
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
fn Templates::compiled_operation(
  self : Templates,
  key : String,
  operation : Operation,
) -> Result[@core.ContractTemplate, OpenApiError] {
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
    guard operation.parameters
      .iter()
      .find_first(fn(parameter) { parameter.name == name })
      is Some(parameter) else {
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
