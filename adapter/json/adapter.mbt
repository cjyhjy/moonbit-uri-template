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
    message: "expected a string, number, boolean, list of those, object of those, or null",
    path,
  }
}

///|
fn pointer(name : String) -> String {
  name.replace(old="~", new="~0").replace(old="/", new="~1")
}

///|
/// Numbers keep their JSON spelling; booleans become `true` / `false`.
fn text_of(value : Json) -> String? {
  match value {
    String(text) => Some(text)
    True => Some("true")
    False => Some("false")
    Number(n, repr~) =>
      match repr {
        Some(text) => Some(text)
        None =>
          Some(
            if n == n.floor() && n.abs() < 9007199254740992.0 {
              n.to_int64().to_string()
            } else {
              n.to_string()
            },
          )
      }
    _ => None
  }
}

///|
fn convert(value : Json, path : String) -> Result[@template.Value?, InputError] {
  match value {
    Null => Ok(None)
    String(_) | True | False | Number(_, ..) =>
      Ok(Some(@template.Scalar(text_of(value).unwrap())))
    Array(items) => {
      let values : Array[String] = []
      for i, item in items {
        match text_of(item) {
          Some(text) => values.push(text)
          None => return Err(input_error(path + "/" + i.to_string()))
        }
      }
      Ok(Some(@template.List(values)))
    }
    Object(items) => {
      // Members keep their document order, as RFC 6570 expands them in order.
      let entries : Array[(String, String)] = []
      for key, item in items {
        match item {
          Null => ()
          _ =>
            match text_of(item) {
              Some(text) => entries.push((key, text))
              None => return Err(input_error(path + "/" + pointer(key)))
            }
        }
      }
      match @template.OrderedEntries::from_entries(entries) {
        Ok(value) => Ok(Some(@template.Assoc(value)))
        Err(_) => Err(input_error(path))
      }
    }
  }
}

///|
/// Parse a JSON object into bindings. Numbers and booleans are converted to text.
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
