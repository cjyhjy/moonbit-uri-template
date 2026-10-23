///|
pub(all) enum Severity {
  Error
  Warning
} derive(Debug, Eq)

///|
pub extend Severity with Debug::{to_repr}

///|
pub extend Severity with Eq::{equal, not_equal}

///|
pub(all) enum Shape {
  ScalarShape
  ListShape
  AssocShape
} derive(Debug, Eq)

///|
pub extend Shape with Debug::{to_repr}

///|
pub extend Shape with Eq::{equal, not_equal}

///|
pub(all) enum ParameterLocation {
  Path
  Query
  Header
  Cookie
} derive(Debug, Eq)

///|
pub extend ParameterLocation with Debug::{to_repr}

///|
pub extend ParameterLocation with Eq::{equal, not_equal}

///|
pub struct Parameter {
  name : String
  location : ParameterLocation
  required : Bool
  shape : Shape?
  variable : String?
} derive(Debug, Eq)

///|
pub extend Parameter with Debug::{to_repr}

///|
pub extend Parameter with Eq::{equal, not_equal}

///|
pub struct Unsupported {
  name : String
  location : ParameterLocation
  reason : String
} derive(Debug, Eq)

///|
pub extend Unsupported with Debug::{to_repr}

///|
pub extend Unsupported with Eq::{equal, not_equal}

///|
pub struct Operation {
  id : String?
  http_method : String
  path : String
  template : String?
  parameters : Array[Parameter]
  unsupported : Array[Unsupported]
  example : String?
} derive(Debug, Eq)

///|
pub extend Operation with Debug::{to_repr}

///|
pub extend Operation with Eq::{equal, not_equal}

///|
pub struct Diagnostic {
  code : String
  severity : Severity
  message : String
  path : String
} derive(Debug, Eq)

///|
pub extend Diagnostic with Debug::{to_repr}

///|
pub extend Diagnostic with Eq::{equal, not_equal}

///|
pub struct Truncation {
  errors : Int32
  warnings : Int32
} derive(Debug, Eq)

///|
pub extend Truncation with Debug::{to_repr}

///|
pub extend Truncation with Eq::{equal, not_equal}

///|
fn location_from_string(value : String) -> ParameterLocation {
  match value {
    "path" => Path
    "query" => Query
    "header" => Header
    _ => Cookie
  }
}

///|
fn shape_from_json(value : Json) -> Shape? {
  match value {
    String("scalar") => Some(ScalarShape)
    String("list") => Some(ListShape)
    String("assoc") => Some(AssocShape)
    _ => None
  }
}

///|
fn optional_string(value : Json) -> String? {
  match value {
    String(text) => Some(text)
    _ => None
  }
}

///|
fn parameter_from_json(value : Json) -> Parameter {
  {
    name: str(get(value, "name")),
    location: location_from_string(str(get(value, "in"))),
    required: get(value, "required") == Json::boolean(true),
    shape: shape_from_json(get(value, "shape")),
    variable: optional_string(get(value, "variable")),
  }
}

///|
fn unsupported_from_json(value : Json) -> Unsupported {
  {
    name: str(get(value, "name")),
    location: location_from_string(str(get(value, "in"))),
    reason: str(get(value, "reason")),
  }
}

///|
fn operation_from_json(value : Json) -> Operation {
  {
    id: optional_string(get(value, "id")),
    http_method: str(get(value, "method")),
    path: str(get(value, "path")),
    template: optional_string(get(value, "template")),
    parameters: array(get(value, "parameters")).map(parameter_from_json),
    unsupported: array(get(value, "unsupported")).map(unsupported_from_json),
    example: optional_string(get(value, "example")),
  }
}

///|
fn diagnostic_from_json(value : Json) -> Diagnostic {
  {
    code: str(get(value, "code")),
    severity: if str(get(value, "severity")) == "warning" {
      Warning
    } else {
      Error
    },
    message: str(get(value, "message")),
    path: str(get(value, "path")),
  }
}

///|
fn Operation::captured(self : Operation) -> Operation {
  {
    id: self.id,
    http_method: self.http_method,
    path: self.path,
    template: self.template,
    parameters: self.parameters.copy(),
    unsupported: self.unsupported.copy(),
    example: self.example,
  }
}
