///|
/// Output byte ranges include the punctuation emitted for that variable.
/// One entry per literal or variable occurrence, not per collection member.
pub(all) struct OutputOrigin {
  name : String?
  source : Span
  output_start : Int32
  output_end : Int32
} derive(Debug)

///|
pub(all) struct Expansion {
  output : String
  bytes : Int32
  origins : Array[OutputOrigin]
} derive(Debug)

///|
/// Count encoded bytes using the very same emitter, without building URI text.
pub fn Template::measure(
  self : Template,
  variables : Variables,
  required~ : Array[String] = [],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[Int32, TemplateError] {
  match self.validate_bindings(variables, required, reject_unused, limits) {
    Err(e) => Err(e)
    Ok(_) =>
      self.render_impl(variables, Some(limits), false, false).map(r => r.bytes)
  }
}

///|
pub fn Template::expand_mapped(
  self : Template,
  variables : Variables,
  required~ : Array[String] = [],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[Expansion, TemplateError] {
  match self.validate_bindings(variables, required, reject_unused, limits) {
    Err(e) => Err(e)
    Ok(_) => self.render_impl(variables, Some(limits), true, true)
  }
}

///|
pub(all) struct BatchLimits {
  max_items : Int32
  max_total_input_codepoints : Int32
  max_total_output_bytes : Int32
} derive(Debug)

///|
pub fn BatchLimits::new(
  max_items~ : Int32 = 256,
  max_total_input_codepoints~ : Int32 = 4194304,
  max_total_output_bytes~ : Int32 = 4194304,
) -> BatchLimits {
  { max_items, max_total_input_codepoints, max_total_output_bytes, }
}

///|
/// index=-1 denotes a batch-level error before visiting any item.
pub(all) struct BatchError {
  index : Int32
  error : TemplateError
} derive(Debug)

///|
fn input_texts(vars : Variables) -> Array[String] {
  let texts : Array[String] = []
  for name, value in vars.values {
    texts.push(name)
    match value {
      Scalar(s) => texts.push(s)
      List(xs) => texts.push_iter(xs.iter())
      Assoc(xs) =>
        for (k, v) in xs.entries {
          texts.push(k)
          texts.push(v)
        }
    }
  }
  texts
}

///|
/// Atomic: validate and measure every item before allocating any result URI.
/// Errors include the zero-based failing item. No partial array is returned.
pub fn Template::expand_batch(
  self : Template,
  inputs : Array[Variables],
  required~ : Array[String] = [],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
  batch_limits~ : BatchLimits = BatchLimits::new(),
) -> Result[Array[String], BatchError] {
  if batch_limits.max_items < 0 ||
    batch_limits.max_total_input_codepoints < 0 ||
    batch_limits.max_total_output_bytes < 0 {
    return Err({
      index: -1,
      error: problem("InvalidLimit", "negative batch budget", 0, 0),
    })
  }
  if inputs.length() > batch_limits.max_items {
    return Err({
      index: -1,
      error: problem("BatchItemLimit", "batch count exceeds budget", 0, 0),
    })
  }
  // Validate options even for an empty batch.
  match check_input_budget(Variables::new(), limits) {
    Err(error) => return Err({ index: -1, error, })
    Ok(_) => ()
  }
  let mut remaining_input = batch_limits.max_total_input_codepoints
  let mut remaining_output = batch_limits.max_total_output_bytes
  for index, vars in inputs {
    let input_size = match
      self.validate_bindings(vars, required, reject_unused, limits) {
      Err(error) => return Err({ index, error, })
      Ok(left) => limits.max_total_value_codepoints - left
    }
    if input_size > remaining_input {
      return Err({
        index,
        error: problem(
          "BatchInputLimit", "total input exceeds batch budget", 0, 0,
        ),
      })
    }
    remaining_input = remaining_input - input_size
    let per_item = {
      ..limits,
      max_output_bytes: Int32::min(limits.max_output_bytes, remaining_output),
    }
    match self.render_impl(vars, Some(per_item), false, false) {
      Err(e) => {
        let error = if e.code == "OutputLimit" &&
          remaining_output < limits.max_output_bytes {
          {
            ..e,
            code: "BatchOutputLimit",
            message: "total output exceeds batch budget",
          }
        } else {
          e
        }
        return Err({ index, error, })
      }
      Ok(r) => remaining_output = remaining_output - r.bytes
    }
  }
  let outputs : Array[String] = []
  for index, vars in inputs {
    match self.expand_impl(vars, Some(limits)) {
      Err(error) => return Err({ index, error, })
      Ok(text) => outputs.push(text)
    }
  }
  Ok(outputs)
}

///|
/// Prepared partial binding keeps original operators intact. Fixed names cannot
/// be overridden; input collections are copied. It is not residual-template text.
struct BoundTemplate {
  template : Template
  fixed : Variables
}

///|
pub fn Template::bind(
  self : Template,
  fixed : Variables,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[BoundTemplate, TemplateError] {
  match self.validate_bindings(fixed, [], true, limits) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  let copied = Variables::new()
  for name, value in fixed.values {
    copied.set(name, value)
  }
  Ok({ template: self, fixed: copied, })
}

///|
fn BoundTemplate::merge(
  self : BoundTemplate,
  variables : Variables,
) -> Result[Variables, TemplateError] {
  let merged = Variables::new()
  for name, value in self.fixed.values {
    merged.set(name, value)
  }
  for name, value in variables.values {
    if merged.values.contains(name) {
      return Err(
        problem("FixedBinding", "cannot override a fixed binding", 0, 0),
      )
    }
    merged.set(name, value)
  }
  Ok(merged)
}

///|
pub fn BoundTemplate::expand(
  self : BoundTemplate,
  variables : Variables,
  required~ : Array[String] = [],
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[String, TemplateError] {
  match check_input_budget(variables, limits) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  match self.merge(variables) {
    Err(e) => Err(e)
    Ok(vars) =>
      self.template.expand_checked(vars, required~, reject_unused=true, limits~)
  }
}

///|
pub fn BoundTemplate::measure(
  self : BoundTemplate,
  variables : Variables,
  required~ : Array[String] = [],
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[Int32, TemplateError] {
  match check_input_budget(variables, limits) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  match self.merge(variables) {
    Err(e) => Err(e)
    Ok(vars) =>
      self.template.measure(vars, required~, reject_unused=true, limits~)
  }
}

///|
pub fn Template::source(self : Template) -> String {
  self.source_text
}

///|
pub(all) struct ContractDiff {
  added : Array[String]
  removed : Array[String]
  newly_scalar_only : Array[String]
  source_changed : Bool
} derive(Debug)

///|
fn Template::scalar_only(self : Template) -> Array[String] {
  let names : Array[String] = []
  for segment in self.segments {
    if segment is Expression(_, specs) {
      for spec in specs {
        if spec.modifier is Prefix(_) && !names.contains(spec.name) {
          names.push(spec.name)
        }
      }
    }
  }
  names
}

///|
/// Structural changes, not an automatic business-compatibility verdict.
pub fn Template::diff(self : Template, newer : Template) -> ContractDiff {
  let old = self.variables()
  let next = newer.variables()
  let old_scalar = self.scalar_only()
  {
    added: next.filter(n => !old.contains(n)),
    removed: old.filter(n => !next.contains(n)),
    newly_scalar_only: newer.scalar_only().filter(n => !old_scalar.contains(n)),
    source_changed: self.source_text != newer.source_text,
  }
}

///|
pub extend OutputOrigin with Debug::{to_repr}

///|
pub extend Expansion with Debug::{to_repr}

///|
pub extend BatchLimits with Debug::{to_repr}

///|
pub extend BatchError with Debug::{to_repr}

///|
pub extend ContractDiff with Debug::{to_repr}
