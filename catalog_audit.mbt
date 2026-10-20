///|
pub(all) struct BindingFinding {
  code : String
  variable : String
  span : Span?
} derive(Debug)

///|
fn append_finding(
  findings : Array[BindingFinding],
  finding : BindingFinding,
  limit : Int32,
) -> Bool {
  if findings.length() == limit {
    return false
  }
  findings.push(finding)
  true
}

///|
fn finding_limit() -> TemplateError {
  problem("FindingLimit", "findings exceed budget", 0, 0)
}

///|
fn check_contract_input(
  variables : Variables,
  required : Array[String],
  limits : ExpansionLimits,
) -> Result[Unit, TemplateError] {
  let mut total = match check_input_budget(variables, limits) {
    Err(error) => return Err(error)
    Ok(remaining) => remaining
  }
  if required.length() > limits.max_bindings {
    return Err(
      problem(
        "BindingLimit", "required names exceed binding count budget", 0, 0,
      ),
    )
  }
  for name in required {
    total = consume_input_text(name, limits.max_value_codepoints, total)
    if total == -1 {
      return Err(problem("ValueLimit", "required name exceeds budget", 0, 0))
    }
    if total == -2 {
      return Err(
        problem(
          "TotalValueLimit", "bindings and required names exceed budget", 0, 0,
        ),
      )
    }
  }
  Ok(())
}

///|
/// Collect business-contract defects; optional omissions are not errors.
/// Invalid budgets / excessive reports return Err, never an incomplete clean report.
pub fn Template::check_contract(
  self : Template,
  variables : Variables,
  required~ : Array[String] = [],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
  max_findings~ : Int32 = 256,
) -> Result[Array[BindingFinding], TemplateError] {
  if max_findings < 0 {
    return Err(problem("InvalidLimit", "negative finding budget", 0, 0))
  }
  match check_contract_input(variables, required, limits) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  let first : Map[String, Span] = Map([])
  for segment in self.segments {
    if segment is Expression(_, specs) {
      for spec in specs {
        if !first.contains(spec.name) {
          first[spec.name] = spec.span
        }
      }
    }
  }
  let findings : Array[BindingFinding] = []
  let seen_required : Map[String, Bool] = Map([])
  for name in required {
    if seen_required.contains(name) {
      continue
    }
    seen_required[name] = true
    let defect = match first.get(name) {
      None => Some({ code: "UnknownRequired", variable: name, span: None, })
      Some(span) =>
        match variables.values.get(name) {
          None =>
            Some({ code: "MissingBinding", variable: name, span: Some(span), })
          Some(value) =>
            if !defined(value) {
              Some({ code: "OmittedBinding", variable: name, span: Some(span), })
            } else {
              None
            }
        }
    }
    if defect is Some(finding) {
      if !append_finding(findings, finding, max_findings) {
        return Err(finding_limit())
      }
    }
  }
  if reject_unused {
    // Sorting just the bounded input keys makes diagnostics deterministic.
    let names = variables.values.keys().to_array()
    names.sort()
    for name in names {
      if !first.contains(name) {
        if !append_finding(
            findings,
            { code: "UnusedBinding", variable: name, span: None, },
            max_findings,
          ) {
          return Err(finding_limit())
        }
      }
    }
  }
  for segment in self.segments {
    if segment is Expression(_, specs) {
      for spec in specs {
        if spec.modifier is Prefix(_) &&
          variables.values.get(spec.name) is Some(value) {
          if defined(value) && !(value is Scalar(_)) {
            if !append_finding(
                findings,
                {
                  code: "PrefixOnComposite",
                  variable: spec.name,
                  span: Some(spec.span),
                },
                max_findings,
              ) {
              return Err(finding_limit())
            }
          }
        }
      }
    }
  }
  Ok(findings)
}

///|
pub(all) struct CatalogEntryAudit {
  name : String
  expression_count : Int32
  variable_count : Int32
  max_level : Int32
  findings : Array[TemplateError]
} derive(Debug)

///|
pub(all) struct CatalogAudit {
  entries : Array[CatalogEntryAudit]
  total_findings : Int32
} derive(Debug)

///|
pub fn CatalogAudit::is_clean(self : CatalogAudit) -> Bool {
  self.total_findings == 0
}

///|
pub fn TemplateCatalog::contains(self : TemplateCatalog, name : String) -> Bool {
  self.entries.contains(name)
}

///|
pub fn TemplateCatalog::audit(
  self : TemplateCatalog,
  policy : TemplatePolicy,
  max_findings~ : Int32 = 256,
) -> Result[CatalogAudit, CatalogError] {
  // Empty catalogs must not hide invalid options.
  match parse("").unwrap().audit(policy, max_findings~) {
    Err(error) => return Err({ name: "", error, })
    Ok(_) => ()
  }
  let entries : Array[CatalogEntryAudit] = []
  let mut remaining = max_findings
  for index, name in self.ordered_names {
    let t = self.entries[name]
    let findings = match t.audit(policy, max_findings=remaining) {
      Err(error) => return Err({ name, error, })
      Ok(findings) => findings
    }
    remaining = remaining - findings.length()
    let metadata = self.metadata[index]
    entries.push({
      name,
      expression_count: metadata.expression_count,
      variable_count: metadata.variable_count,
      max_level: metadata.max_level,
      findings,
    })
  }
  Ok({ entries, total_findings: max_findings - remaining, })
}

///|
pub(all) struct RequestInspection {
  index : Int32
  name : String
  findings : Array[BindingFinding]
} derive(Debug)

///|
pub(all) struct RequestAudit {
  requests : Array[RequestInspection]
  total_findings : Int32
} derive(Debug)

///|
pub fn RequestAudit::is_clean(self : RequestAudit) -> Bool {
  self.total_findings == 0
}

///|
/// All requests are inspected; budgets fail closed with an indexed error.
/// Output budgets belong to measure_batch / expand_batch, not binding inspection.
pub fn TemplateCatalog::inspect_requests(
  self : TemplateCatalog,
  requests : Array[CatalogRequest],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
  batch_limits~ : BatchLimits = BatchLimits::new(),
  max_findings~ : Int32 = 256,
) -> Result[RequestAudit, CatalogBatchError] {
  if max_findings < 0 ||
    batch_limits.max_items < 0 ||
    batch_limits.max_total_input_codepoints < 0 ||
    batch_limits.max_total_output_bytes < 0 {
    return Err({
      index: -1,
      name: "",
      error: problem("InvalidLimit", "negative audit budget", 0, 0),
    })
  }
  if requests.length() > batch_limits.max_items {
    return Err({
      index: -1,
      name: "",
      error: problem("BatchItemLimit", "request count exceeds budget", 0, 0),
    })
  }
  match check_input_budget(Variables::new(), limits) {
    Err(error) => return Err({ index: -1, name: "", error, })
    Ok(_) => ()
  }
  let results : Array[RequestInspection] = []
  let mut remaining = max_findings
  let mut input = batch_limits.max_total_input_codepoints
  for index, request in requests {
    let name = request.name
    match check_contract_input(request.variables, request.required, limits) {
      Err(error) => return Err({ index, name, error, })
      Ok(_) => ()
    }
    let texts = input_texts(request.variables)
    texts.push(name)
    texts.push_iter(request.required.iter())
    for text in texts {
      for _ in text.iter() {
        if input == 0 {
          return Err({
            index,
            name,
            error: problem(
              "BatchInputLimit", "audit input exceeds budget", 0, 0,
            ),
          })
        }
        input = input - 1
      }
    }
    let findings = match self.entries.get(name) {
      None => {
        if remaining == 0 {
          return Err({ index, name, error: finding_limit(), })
        }
        [{ code: "UnknownTemplate", variable: "", span: None, }]
      }
      Some(t) =>
        match
          t.check_contract(
            request.variables,
            required=request.required,
            reject_unused~,
            limits~,
            max_findings=remaining,
          ) {
          Err(error) => return Err({ index, name, error, })
          Ok(findings) => findings
        }
    }
    remaining = remaining - findings.length()
    results.push({ index, name, findings, })
  }
  Ok({ requests: results, total_findings: max_findings - remaining, })
}

///|
pub(all) struct CatalogContractDiff {
  added : Array[String]
  removed : Array[String]
  changed : Array[(String, DetailedContractDiff)]
} derive(Debug)

///|
pub fn TemplateCatalog::diff(
  self : TemplateCatalog,
  newer : TemplateCatalog,
) -> CatalogContractDiff {
  let old = self.names()
  let next = newer.names()
  let changed : Array[(String, DetailedContractDiff)] = []
  for name in old {
    if newer.entries.get(name) is Some(t) {
      let before = self.entries[name]
      if before.source_text != t.source_text {
        changed.push((name, before.diff(t)))
      }
    }
  }
  {
    added: next.filter(n => !self.entries.contains(n)),
    removed: old.filter(n => !newer.entries.contains(n)),
    changed,
  }
}

///|
pub extend BindingFinding with Debug::{to_repr}

///|
pub extend CatalogEntryAudit with Debug::{to_repr}

///|
pub extend CatalogAudit with Debug::{to_repr}

///|
pub extend RequestInspection with Debug::{to_repr}

///|
pub extend RequestAudit with Debug::{to_repr}

///|
pub extend CatalogContractDiff with Debug::{to_repr}
