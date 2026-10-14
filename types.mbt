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
  Literal(String)
  Expression(Char, Array[VarSpec])
} derive(Debug)

///|
/// A validated template with a hidden, immutable representation.
struct Template {
  segments : Array[Segment]
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
pub fn Variables::set(self : Variables, name : String, value : Value) -> Unit {
  self.values[name] = match value {
    Scalar(_) => value
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
