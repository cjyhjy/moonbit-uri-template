///|
/// Limits count Unicode code points; output is ASCII URI bytes. Zero is allowed.
pub(all) struct ParseLimits {
  max_template_codepoints : Int32
  max_expressions : Int32
  max_variables_per_expression : Int32
  max_total_variables : Int32
} derive(Debug)

///|
pub fn ParseLimits::new(
  max_template_codepoints~ : Int32 = 1048576,
  max_expressions~ : Int32 = 4096,
  max_variables_per_expression~ : Int32 = 256,
  max_total_variables~ : Int32 = 65536,
) -> ParseLimits {
  {
    max_template_codepoints,
    max_expressions,
    max_variables_per_expression,
    max_total_variables,
  }
}

///|
pub(all) struct ExpansionLimits {
  max_bindings : Int32
  max_members : Int32
  max_value_codepoints : Int32
  max_total_value_codepoints : Int32
  max_output_bytes : Int32
} derive(Debug)

///|
pub fn ExpansionLimits::new(
  max_bindings~ : Int32 = 4096,
  max_members~ : Int32 = 65536,
  max_value_codepoints~ : Int32 = 1048576,
  max_total_value_codepoints~ : Int32 = 4194304,
  max_output_bytes~ : Int32 = 1048576,
) -> ExpansionLimits {
  {
    max_bindings,
    max_members,
    max_value_codepoints,
    max_total_value_codepoints,
    max_output_bytes,
  }
}

///|
fn exceeds_codepoints(text : String, limit : Int32) -> Bool {
  let mut remaining = limit
  for _ in text.iter() {
    if remaining == 0 {
      return true
    }
    remaining = remaining - 1
  }
  false
}

///|
// Return remaining total, or -1/-2 for the first individual/total overflow.
// Walk UTF-16 directly to avoid a capturing iterator and per-character options.
// Like String::iter, only a valid surrogate pair counts as one code point.
fn consume_input_text(
  text : String,
  individual : Int32,
  total : Int32,
) -> Int32 {
  let mut index = 0
  let mut left = individual
  let mut remaining = total
  while index < text.length() {
    if left == 0 {
      return -1
    }
    if remaining == 0 {
      return -2
    }
    let unit = text[index].to_int()
    if unit >= 0xD800 && unit <= 0xDBFF && index + 1 < text.length() {
      let next = text[index + 1].to_int()
      if next >= 0xDC00 && next <= 0xDFFF {
        index = index + 1
      }
    }
    index = index + 1
    left = left - 1
    remaining = remaining - 1
  }
  remaining
}

///|
fn input_text_error(remaining : Int32) -> TemplateError {
  if remaining == -1 {
    problem(
      "ValueLimit", "a name, key or value exceeds code point budget", 0, 0,
    )
  } else {
    problem("TotalValueLimit", "total input code points exceed budget", 0, 0)
  }
}

///|
fn check_input_budget(
  vars : Variables,
  limits : ExpansionLimits,
) -> Result[Int32, TemplateError] {
  check_input_entries(vars.values.length(), vars.values.iter2(), limits)
}

///|
fn check_input_entries(
  binding_count : Int32,
  entries : Iter2[String, Value],
  limits : ExpansionLimits,
) -> Result[Int32, TemplateError] {
  if limits.max_bindings < 0 ||
    limits.max_members < 0 ||
    limits.max_value_codepoints < 0 ||
    limits.max_total_value_codepoints < 0 ||
    limits.max_output_bytes < 0 {
    return Err(problem("InvalidLimit", "limits must be nonnegative", 0, 0))
  }
  if binding_count > limits.max_bindings {
    return Err(problem("BindingLimit", "binding count exceeds budget", 0, 0))
  }
  let mut members = limits.max_members
  let mut total = limits.max_total_value_codepoints
  // Includes unused bindings, binding names, associative keys and values.
  for name, value in entries {
    // Collection count still takes precedence over its name/value lengths.
    let count = match value {
      Scalar(_) => 0
      List(items) => items.length()
      Assoc(entries) => entries.entries.length()
    }
    if count > members {
      return Err(
        problem("MemberLimit", "total collection members exceed budget", 0, 0),
      )
    }
    members = members - count
    total = consume_input_text(name, limits.max_value_codepoints, total)
    if total < 0 {
      return Err(input_text_error(total))
    }
    match value {
      Scalar(text) => {
        total = consume_input_text(text, limits.max_value_codepoints, total)
        if total < 0 {
          return Err(input_text_error(total))
        }
      }
      List(items) =>
        for text in items {
          total = consume_input_text(text, limits.max_value_codepoints, total)
          if total < 0 {
            return Err(input_text_error(total))
          }
        }
      Assoc(entries) =>
        for (key, text) in entries.entries {
          total = consume_input_text(key, limits.max_value_codepoints, total)
          if total < 0 {
            return Err(input_text_error(total))
          }
          total = consume_input_text(text, limits.max_value_codepoints, total)
          if total < 0 {
            return Err(input_text_error(total))
          }
        }
    }
  }
  Ok(total)
}

///|
pub extend ParseLimits with Debug::{to_repr}

///|
pub extend ExpansionLimits with Debug::{to_repr}
