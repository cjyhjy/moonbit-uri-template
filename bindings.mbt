///|
pub(all) struct BindingIssue {
  name : String
  span : Span
} derive(Debug)

///|
/// Missing/omitted entries use first occurrence order; unused names are sorted.
pub(all) struct BindingReport {
  referenced : Array[String]
  missing : Array[BindingIssue]
  omitted : Array[BindingIssue]
  unused : Array[String]
  invalid : Array[TemplateError]
} derive(Debug)

///|
/// Construct a copied binding set, rejecting ambiguous duplicate names.
pub fn Variables::from_entries(
  entries : Array[(String, Value)],
) -> Result[Variables, TemplateError] {
  let vars = Variables::new()
  for (name, value) in entries {
    if vars.values.contains(name) {
      return Err(problem("DuplicateBinding", "duplicate binding name", 0, 0))
    }
    vars.set(name, value)
  }
  Ok(vars)
}

///|
/// Read-only preflight. Empty scalar is defined; empty collections are omitted.
/// Reports all incompatible prefix occurrences without expanding any values.
pub fn Template::check_bindings(
  self : Template,
  variables : Variables,
) -> BindingReport {
  let seen : Map[String, Bool] = Map([])
  let missing : Array[BindingIssue] = []
  let omitted : Array[BindingIssue] = []
  let invalid : Array[TemplateError] = []
  for segment in self.segments {
    if segment is Expression(_, specs) {
      for spec in specs {
        let first = !seen.contains(spec.name)
        seen[spec.name] = true
        match variables.values.get(spec.name) {
          None =>
            if first {
              missing.push({ name: spec.name, span: spec.span, })
            }
          Some(value) => {
            if !defined(value) && first {
              omitted.push({ name: spec.name, span: spec.span, })
            }
            if defined(value) &&
              spec.modifier is Prefix(_) &&
              !(value is Scalar(_)) {
              invalid.push(
                problem(
                  "PrefixOnComposite",
                  "prefix is only valid on scalar values",
                  spec.span.start,
                  spec.span.end,
                ),
              )
            }
          }
        }
      }
    }
  }
  let unused = variables.values
    .keys()
    .filter(name => !seen.contains(name))
    .to_array()
  unused.sort()
  { referenced: self.variables(), missing, omitted, unused, invalid, }
}

///|
/// Opt-in contract validation, independent of RFC's default omission behavior.
/// Required names must occur in the template and have a defined value.
pub fn Template::expand_checked(
  self : Template,
  variables : Variables,
  required~ : Array[String] = [],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[String, TemplateError] {
  match self.validate_bindings(variables, required, reject_unused, limits) {
    Err(e) => Err(e)
    Ok(_) => self.expand_impl(variables, Some(limits))
  }
}

///|
pub extend BindingIssue with Debug::{to_repr}

///|
pub extend BindingReport with Debug::{to_repr}

///|
/// Budgeted preflight checks input before building a report.
pub fn Template::check_bindings_with_limits(
  self : Template,
  variables : Variables,
  limits : ExpansionLimits,
) -> Result[BindingReport, TemplateError] {
  match check_input_budget(variables, limits) {
    Err(e) => Err(e)
    Ok(_) => Ok(self.check_bindings(variables))
  }
}

///|
fn Template::validate_bindings(
  self : Template,
  variables : Variables,
  required : Array[String],
  reject_unused : Bool,
  limits : ExpansionLimits,
) -> Result[Unit, TemplateError] {
  match check_input_budget(variables, limits) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  let report = self.check_bindings(variables)
  for name in required {
    if !report.referenced.contains(name) {
      return Err(
        problem(
          "UnknownRequired", "required name is not referenced by the template", 0,
          0,
        ),
      )
    }
    for issue in report.missing {
      if issue.name == name {
        return Err(
          problem(
            "MissingBinding",
            "required variable is not bound",
            issue.span.start,
            issue.span.end,
          ),
        )
      }
    }
    for issue in report.omitted {
      if issue.name == name {
        return Err(
          problem(
            "OmittedBinding",
            "required collection is empty and would be omitted",
            issue.span.start,
            issue.span.end,
          ),
        )
      }
    }
  }
  if reject_unused && !report.unused.is_empty() {
    return Err(
      problem(
        "UnusedBinding", "bindings include names not referenced by the template",
        0, 0,
      ),
    )
  }
  if !report.invalid.is_empty() {
    return Err(report.invalid[0])
  }
  Ok(())
}
