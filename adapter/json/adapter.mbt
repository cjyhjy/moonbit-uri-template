///|
/// JSON input errors include a JSON Pointer path.
pub(all) struct InputError {
  code : String
  message : String
  path : String
} derive(Debug)

///|
pub extend InputError with Debug::{to_repr}

///|
fn input_error(path : String) -> InputError {
  {
    code: "InvalidValueType",
    message: "expected string, string list, string/null object, or null",
    path,
  }
}

///|
fn pointer(name : String) -> String {
  name.replace(old="~", new="~0").replace(old="/", new="~1")
}

///|
fn convert(value : Json, path : String) -> Result[@template.Value?, InputError] {
  match value {
    Null => Ok(None)
    String(text) => Ok(Some(@template.Scalar(text)))
    Array(items) => {
      let values : Array[String] = []
      for i, item in items {
        match item {
          String(text) => values.push(text)
          _ => return Err(input_error(path + "/" + i.to_string()))
        }
      }
      Ok(Some(@template.List(values)))
    }
    Object(items) => {
      let keys = items.keys().to_array()
      keys.sort()
      let entries : Array[(String, String)] = []
      for key in keys {
        match items.get(key) {
          Some(String(text)) => entries.push((key, text))
          Some(Null) | None => ()
          _ => return Err(input_error(path + "/" + pointer(key)))
        }
      }
      match @template.OrderedEntries::from_entries(entries) {
        Ok(value) => Ok(Some(@template.Assoc(value)))
        Err(_) => Err(input_error(path))
      }
    }
    _ => Err(input_error(path))
  }
}

///|
/// Parse a JSON object into typed bindings. Numbers and booleans require explicit strings.
pub fn parse_variables(
  source : String,
) -> Result[@template.Variables, InputError] {
  let value = @jsonlib.parse(source) catch {
    _ =>
      return Err({
        code: "InvalidJson",
        message: "invalid JSON input",
        path: "",
      })
  }
  guard value is Object(items) else {
    return Err({
      code: "ExpectedObject",
      message: "variables must be a JSON object",
      path: "",
    })
  }
  let vars = @template.Variables::new()
  let keys = items.keys().to_array()
  keys.sort()
  for key in keys {
    match items.get(key) {
      Some(value) =>
        match convert(value, "/" + pointer(key)) {
          Ok(Some(value)) => vars.set(key, value)
          Ok(None) => ()
          Err(e) => return Err(e)
        }
      None => ()
    }
  }
  Ok(vars)
}
