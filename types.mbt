///|
/// Source range in Unicode code points, zero-based and half-open.
pub(all) struct Span {
  start : Int32
  end : Int32
} derive(Debug)

///|
/// A stable error code and the relevant source range.
pub(all) struct TemplateError {
  code : String
  message : String
  span : Span
} derive(Debug)

///|
/// An ordered, unique-key associative value. Construct with `from_entries`.
struct OrderedEntries {
  entries : Array[(String, String)]
} derive(Debug)

///|
/// Values are strings; callers choose numeric and boolean formatting explicitly.
pub(all) enum Value {
  Scalar(String)
  List(Array[String])
  Assoc(OrderedEntries)
} derive(Debug)

///|
/// Mutable bindings. Collection values are copied when inserted.
struct Variables {
  values : Map[String, Value]
} derive(Debug)

///|
priv enum Modifier {
  NoModifier
  Prefix(Int32)
  Explode
} derive(Debug)

///|
priv struct VarSpec {
  name : String
  modifier : Modifier
  span : Span
} derive(Debug)

///|
priv enum Segment {
  Literal(String, Span)
  Expression(Char, Array[VarSpec])
} derive(Debug)

///|
/// A validated template with a hidden, immutable representation.
struct Template {
  segments : Array[Segment]
  source_text : String
} derive(Debug)

///|
pub fn OrderedEntries::from_entries(
  entries : Array[(String, String)],
) -> Result[OrderedEntries, TemplateError] {
  let seen : Map[String, Bool] = Map([])
  for (key, _) in entries {
    if seen.contains(key) {
      return Err(
        problem("DuplicateKey", "duplicate associative key: \{key}", 0, 0),
      )
    }
    seen[key] = true
  }
  Ok({ entries: entries.copy(), })
}

///|
pub fn Variables::new() -> Variables {
  { values: Map([]), }
}

///|
/// Normalize sparse entries before binding; null list members are omitted here.
/// JSON adapter remains strict for list nulls to catch accidental input errors.
pub fn sparse_list(items : Array[String?]) -> Value {
  let result : Array[String] = []
  for item in items {
    if item is Some(text) {
      result.push(text)
    }
  }
  List(result)
}

///|
pub fn sparse_assoc(
  items : Array[(String, String?)],
) -> Result[Value, TemplateError] {
  let seen : Map[String, Bool] = Map([])
  let result : Array[(String, String)] = []
  for (key, value) in items {
    if seen.contains(key) {
      return Err(problem("DuplicateKey", "duplicate associative key", 0, 0))
    }
    seen[key] = true
    if value is Some(text) {
      result.push((key, text))
    }
  }
  Ok(Assoc({ entries: result, }))
}

///|
pub fn Variables::set(self : Variables, name : String, value : Value) -> Unit {
  self.values[name] = value.captured()
}

///|
/// Return a captured value so callers cannot mutate stored collections.
pub fn Variables::get(self : Variables, name : String) -> Value? {
  self.values.get(name).map(fn(value) { value.captured() })
}

///|
/// Binding names in insertion order.
pub fn Variables::names(self : Variables) -> Array[String] {
  self.values.keys().to_array()
}

///|
fn Value::captured(self : Value) -> Value {
  match self {
    Scalar(_) => self
    List(items) => List(items.copy())
    Assoc(entries) => Assoc({ entries: entries.entries.copy(), })
  }
}

///|
pub fn Variables::remove(self : Variables, name : String) -> Unit {
  self.values.remove(name) |> ignore
}

///|
fn problem(
  code : String,
  message : String,
  start : Int32,
  end : Int32,
) -> TemplateError {
  { code, message, span: { start, end, }, }
}

///|
fn chars_text(chars : Array[Char], start : Int32, end : Int32) -> String {
  let out = StringBuilder()
  for i = start; i < end; i = i + 1 {
    out.write_char(chars[i])
  }
  out.to_string()
}

///|
pub extend Span with Debug::{to_repr}

///|
pub extend TemplateError with Debug::{to_repr}

///|
pub extend OrderedEntries with Debug::{to_repr}

///|
pub extend Value with Debug::{to_repr}

///|
pub extend Variables with Debug::{to_repr}

///|
pub extend Template with Debug::{to_repr}
