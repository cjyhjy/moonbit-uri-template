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
fn check_input_budget(
  vars : Variables,
  limits : ExpansionLimits,
) -> Result[Unit, TemplateError] {
  if limits.max_bindings < 0 ||
    limits.max_members < 0 ||
    limits.max_value_codepoints < 0 ||
    limits.max_total_value_codepoints < 0 ||
    limits.max_output_bytes < 0 {
    return Err(problem("InvalidLimit", "limits must be nonnegative", 0, 0))
  }
  if vars.values.length() > limits.max_bindings {
    return Err(problem("BindingLimit", "binding count exceeds budget", 0, 0))
  }
  let mut members = limits.max_members
  let mut total = limits.max_total_value_codepoints
  // Includes unused bindings, binding names, associative keys and values.
  for name, value in vars.values {
    let texts : Array[String] = [name]
    match value {
      Scalar(text) => texts.push(text)
      List(items) => {
        if items.length() > members {
          return Err(
            problem(
              "MemberLimit", "total collection members exceed budget", 0, 0,
            ),
          )
        }
        members = members - items.length()
        texts.push_iter(items.iter())
      }
      Assoc(entries) => {
        if entries.entries.length() > members {
          return Err(
            problem(
              "MemberLimit", "total collection members exceed budget", 0, 0,
            ),
          )
        }
        members = members - entries.entries.length()
        for (key, text) in entries.entries {
          texts.push(key)
          texts.push(text)
        }
      }
    }
    for text in texts {
      let mut individual = limits.max_value_codepoints
      for _ in text.iter() {
        if individual == 0 {
          return Err(
            problem(
              "ValueLimit", "a name, key or value exceeds code point budget", 0,
              0,
            ),
          )
        }
        if total == 0 {
          return Err(
            problem(
              "TotalValueLimit", "total input code points exceed budget", 0, 0,
            ),
          )
        }
        individual = individual - 1
        total = total - 1
      }
    }
  }
  Ok(())
}

///|
pub extend ParseLimits with Debug::{to_repr}

///|
pub extend ExpansionLimits with Debug::{to_repr}
