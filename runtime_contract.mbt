///|
/// Application value shapes; formatting numbers/booleans remains the caller's job.
pub(all) enum BindingKind {
  ScalarKind
  ListKind
  AssocKind
} derive(Eq, Debug)

///|
pub(all) struct BindingRule {
  name : String
  kind : BindingKind
} derive(Debug)

///|
/// Captures rules independently of caller-owned arrays. No bound values retained.
struct ContractTemplate {
  template : Template
  rules : Array[BindingRule]
  required : Array[String]
  reject_unused : Bool
  spans : Map[String, Span]
}

///|
/// Compile shape constraints once, separately from RFC expansion semantics.
/// Prefix variables always require scalars, even for empty composite bindings.
pub fn Template::with_contract(
  self : Template,
  rules : Array[BindingRule],
  required~ : Array[String] = [],
  reject_unused~ : Bool = true,
  max_rules~ : Int32 = 4096,
  max_rule_codepoints~ : Int32 = 65536,
) -> Result[ContractTemplate, TemplateError] {
  if max_rules < 0 || max_rule_codepoints < 0 {
    return Err(problem("InvalidLimit", "negative contract budget", 0, 0))
  }
  if rules.length() > max_rules || required.length() > max_rules {
    return Err(problem("ContractLimit", "too many contract declarations", 0, 0))
  }
  let mut remaining = max_rule_codepoints
  for name in rules.iter().map(r => r.name).concat(required.iter()) {
    for _ in name.iter() {
      if remaining == 0 {
        return Err(
          problem("ContractLimit", "contract names exceed budget", 0, 0),
        )
      }
      remaining = remaining - 1
    }
  }
  let spans : Map[String, Span] = Map([])
  let prefixes : Map[String, Span] = Map([])
  for segment in self.segments {
    if segment is Expression(_, specs) {
      for spec in specs {
        if !spans.contains(spec.name) {
          spans[spec.name] = spec.span
        }
        if spec.modifier is Prefix(_) && !prefixes.contains(spec.name) {
          prefixes[spec.name] = spec.span
        }
      }
    }
  }
  let kinds : Map[String, BindingKind] = Map([])
  for rule in rules {
    if kinds.contains(rule.name) {
      return Err(problem("DuplicateRule", "duplicate type declaration", 0, 0))
    }
    let span = match spans.get(rule.name) {
      Some(span) => span
      None =>
        return Err(problem("UnknownRule", "type name is not referenced", 0, 0))
    }
    if prefixes.contains(rule.name) && rule.kind != ScalarKind {
      return Err(
        problem(
          "IncompatibleRule",
          "prefix requires a scalar type",
          span.start,
          span.end,
        ),
      )
    }
    kinds[rule.name] = rule.kind
  }
  for name in required {
    if !spans.contains(name) {
      return Err(
        problem("UnknownRequired", "required name is not referenced", 0, 0),
      )
    }
  }
  let captured = rules.copy()
  // Deterministic template order, including implicit prefix constraints.
  for name in self.variables() {
    if prefixes.contains(name) && !kinds.contains(name) {
      captured.push({ name, kind: ScalarKind, })
      spans[name] = prefixes[name]
    }
  }
  Ok({
    template: self,
    rules: captured,
    required: required.copy(),
    reject_unused,
    spans,
  })
}

///|
fn Value::kind(self : Value) -> BindingKind {
  match self {
    Scalar(_) => ScalarKind
    List(_) => ListKind
    Assoc(_) => AssocKind
  }
}

///|
fn BindingKind::description(self : BindingKind) -> String {
  match self {
    ScalarKind => "expected a scalar string"
    ListKind => "expected a list of strings"
    AssocKind => "expected an associative value"
  }
}

///|
/// Input/shape/presence validation only; output limits are enforced by measure.
pub fn ContractTemplate::validate(
  self : ContractTemplate,
  variables : Variables,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[Unit, TemplateError] {
  match check_contract_input(variables, self.required, limits) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  for rule in self.rules {
    if variables.values.get(rule.name) is Some(value) &&
      value.kind() != rule.kind {
      let span = self.spans[rule.name]
      return Err(
        problem("BindingType", rule.kind.description(), span.start, span.end),
      )
    }
  }
  self.template.validate_bindings(
    variables,
    self.required,
    self.reject_unused,
    limits,
  )
}

///|
/// Collect presence, unused and shape findings without exposing bound values.
/// The cap applies to the complete report; overflow never returns a clean subset.
pub fn ContractTemplate::inspect(
  self : ContractTemplate,
  variables : Variables,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
  max_findings~ : Int32 = 256,
) -> Result[Array[BindingFinding], TemplateError] {
  let findings = match
    self.template.check_contract(
      variables,
      required=self.required,
      reject_unused=self.reject_unused,
      limits~,
      max_findings~,
    ) {
    Err(e) => return Err(e)
    Ok(findings) => findings
  }
  for rule in self.rules {
    if variables.values.get(rule.name) is Some(value) &&
      value.kind() != rule.kind {
      if findings.length() == max_findings {
        return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
      }
      findings.push({
        code: "BindingType",
        variable: rule.name,
        span: Some(self.spans[rule.name]),
      })
    }
  }
  Ok(findings)
}

///|
pub fn ContractTemplate::expand(
  self : ContractTemplate,
  variables : Variables,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[String, TemplateError] {
  match self.validate(variables, limits~) {
    Err(e) => Err(e)
    Ok(_) => self.template.expand_impl(variables, Some(limits))
  }
}

///|
pub fn ContractTemplate::measure(
  self : ContractTemplate,
  variables : Variables,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[Int32, TemplateError] {
  match self.validate(variables, limits~) {
    Err(e) => Err(e)
    Ok(_) =>
      self.template
      .render_impl(variables, Some(limits), false, false)
      .map(r => r.bytes)
  }
}

///|
pub fn ContractTemplate::expand_mapped(
  self : ContractTemplate,
  variables : Variables,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[Expansion, TemplateError] {
  match self.validate(variables, limits~) {
    Err(e) => Err(e)
    Ok(_) => self.template.render_impl(variables, Some(limits), true, true)
  }
}

///|
pub extend BindingKind with Eq::{equal, not_equal}

///|
pub extend BindingKind with Debug::{to_repr}

///|
pub extend BindingRule with Debug::{to_repr}
