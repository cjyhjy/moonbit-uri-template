///|
pub(all) struct ExpressionInfo {
  operator : String
  level : Int32
  span : Span
  variables : Array[String]
} derive(Debug)

///|
pub fn Template::inspect(self : Template) -> Array[ExpressionInfo] {
  let result : Array[ExpressionInfo] = []
  for segment in self.segments {
    if segment is Expression(op, specs) {
      let mut level = if op == ' ' {
        1
      } else if op == '+' || op == '#' {
        2
      } else {
        3
      }
      for spec in specs {
        if !(spec.modifier is NoModifier) {
          level = 4
        }
      }
      result.push({
        operator: if op == ' ' {
          ""
        } else {
          op.to_string()
        },
        level,
        span: {
          start: specs[0].span.start - (if op == ' ' { 1 } else { 2 }),
          end: specs[specs.length() - 1].span.end + 1,
        },
        variables: specs.map(s => s.name),
      })
    }
  }
  result
}

///|
pub fn Template::level(self : Template) -> Int32 {
  let mut level = 0
  for expression in self.inspect() {
    level = Int32::max(level, expression.level)
  }
  level
}

///|
/// Static policy. This does not validate a host, scheme, or prevent SSRF.
pub(all) struct TemplatePolicy {
  allow_reserved : Bool
  allow_fragment : Bool
  allow_prefix : Bool
  allow_explode : Bool
  allowed_variables : Array[String]?
  max_level : Int32
  max_references : Int32
  forbid_repeated_variables : Bool
} derive(Debug)

///|
pub fn TemplatePolicy::new(
  allow_reserved~ : Bool = true,
  allow_fragment~ : Bool = true,
  allow_prefix~ : Bool = true,
  allow_explode~ : Bool = true,
  allowed_variables~ : Array[String]? = None,
  max_level~ : Int32 = 4,
  max_references~ : Int32 = 65536,
  forbid_repeated_variables~ : Bool = false,
) -> TemplatePolicy {
  {
    allow_reserved,
    allow_fragment,
    allow_prefix,
    allow_explode,
    allowed_variables,
    max_level,
    max_references,
    forbid_repeated_variables,
  }
}

///|
pub fn Template::audit_with_limit(
  self : Template,
  policy : TemplatePolicy,
  max_findings~ : Int32 = 256,
) -> Result[Array[TemplateError], TemplateError] {
  if max_findings < 0 {
    return Err(problem("InvalidLimit", "negative finding budget", 0, 0))
  }
  let findings : Array[TemplateError] = []
  if policy.max_level < 0 || policy.max_level > 4 || policy.max_references < 0 {
    return Err(
      problem("InvalidPolicy", "invalid level or reference limit", 0, 0),
    )
  }
  let seen : Map[String, Bool] = Map([])
  let mut count = 0
  for info in self.inspect() {
    if info.level > policy.max_level {
      if findings.length() == max_findings {
        return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
      }
      findings.push(
        problem(
          "LevelPolicy",
          "expression exceeds allowed RFC level",
          info.span.start,
          info.span.end,
        ),
      )
    }
  }
  for segment in self.segments {
    if segment is Expression(op, specs) {
      for spec in specs {
        if count >= policy.max_references {
          if findings.length() == max_findings {
            return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
          }
          findings.push(
            problem(
              "ReferencePolicy",
              "reference count exceeds limit",
              spec.span.start,
              spec.span.end,
            ),
          )
        }
        count = count + 1
        if policy.forbid_repeated_variables && seen.contains(spec.name) {
          if findings.length() == max_findings {
            return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
          }
          findings.push(
            problem(
              "RepeatedPolicy",
              "repeated variable is disallowed",
              spec.span.start,
              spec.span.end,
            ),
          )
        }
        seen[spec.name] = true
        if !policy.allow_reserved && (op == '+' || op == '#') {
          if findings.length() == max_findings {
            return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
          }
          findings.push(
            problem(
              "ReservedPolicy",
              "reserved expansion is disallowed",
              spec.span.start,
              spec.span.end,
            ),
          )
        }
        if !policy.allow_fragment && op == '#' {
          if findings.length() == max_findings {
            return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
          }
          findings.push(
            problem(
              "FragmentPolicy",
              "fragment expansion is disallowed",
              spec.span.start,
              spec.span.end,
            ),
          )
        }
        if !policy.allow_prefix && spec.modifier is Prefix(_) {
          if findings.length() == max_findings {
            return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
          }
          findings.push(
            problem(
              "PrefixPolicy",
              "prefix modifier is disallowed",
              spec.span.start,
              spec.span.end,
            ),
          )
        }
        if !policy.allow_explode && spec.modifier is Explode {
          if findings.length() == max_findings {
            return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
          }
          findings.push(
            problem(
              "ExplodePolicy",
              "explode modifier is disallowed",
              spec.span.start,
              spec.span.end,
            ),
          )
        }
        if policy.allowed_variables is Some(names) && !names.contains(spec.name) {
          if findings.length() == max_findings {
            return Err(problem("FindingLimit", "findings exceed budget", 0, 0))
          }
          findings.push(
            problem(
              "VariablePolicy",
              "variable is not allowed",
              spec.span.start,
              spec.span.end,
            ),
          )
        }
      }
    }
  }
  Ok(findings)
}

///|
pub extend ExpressionInfo with Debug::{to_repr}

///|
pub extend TemplatePolicy with Debug::{to_repr}

///|
/// Compatibility entry point. Use audit_with_limit for bounded reports.
pub fn Template::audit(
  self : Template,
  policy : TemplatePolicy,
) -> Array[TemplateError] {
  match self.audit_with_limit(policy, max_findings=2147483647) {
    Ok(findings) => findings
    Err(error) => [error]
  }
}
