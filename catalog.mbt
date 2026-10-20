///|
struct TemplateCatalog {
  entries : Map[String, Template]
  ordered_names : Array[String]
  metadata : Array[CatalogMetadata]
}

///|
priv struct CatalogMetadata {
  expression_count : Int32
  variable_count : Int32
  max_level : Int32
}

///|
pub(all) struct CatalogError {
  name : String
  error : TemplateError
} derive(Debug)

///|
/// Compile a bounded directory once; later lookup reuses parsed templates.
pub fn compile_catalog(
  entries : Array[(String, String)],
  max_templates~ : Int32 = 256,
  max_total_codepoints~ : Int32 = 4194304,
  limits~ : ParseLimits = ParseLimits::new(),
  strict~ : Bool = false,
) -> Result[TemplateCatalog, CatalogError] {
  if max_templates < 0 || max_total_codepoints < 0 {
    return Err({
      name: "",
      error: problem("InvalidLimit", "negative catalog budget", 0, 0),
    })
  }
  if entries.length() > max_templates {
    return Err({
      name: "",
      error: problem("CatalogLimit", "too many templates", 0, 0),
    })
  }
  match parse_with_limits("", limits, strict~) {
    Err(error) => return Err({ name: "", error, })
    Ok(_) => ()
  }
  let compiled : Map[String, Template] = Map([])
  let mut remaining = max_total_codepoints
  for (name, source) in entries {
    if name == "" || compiled.contains(name) {
      return Err({
        name,
        error: problem("CatalogName", "empty or duplicate template name", 0, 0),
      })
    }
    for text in [name, source] {
      for _ in text.iter() {
        if remaining == 0 {
          return Err({
            name,
            error: problem(
              "CatalogInputLimit", "catalog source exceeds total budget", 0, 0,
            ),
          })
        }
        remaining = remaining - 1
      }
    }
    match parse_with_limits(source, limits, strict~) {
      Err(error) => return Err({ name, error, })
      Ok(t) => compiled[name] = t
    }
  }
  let ordered_names = compiled.keys().to_array()
  ordered_names.sort()
  let metadata = ordered_names.map(fn(name) {
    let t = compiled[name]
    let mut expression_count = 0
    let mut max_level = 0
    for segment in t.segments {
      if segment is Expression(op, specs) {
        expression_count = expression_count + 1
        max_level = Int32::max(max_level, expression_level(op, specs))
      }
    }
    { expression_count, variable_count: t.variables().length(), max_level, }
  })
  Ok({ entries: compiled, ordered_names, metadata, })
}

///|
pub fn TemplateCatalog::get(
  self : TemplateCatalog,
  name : String,
) -> Result[Template, CatalogError] {
  match self.entries.get(name) {
    Some(t) => Ok(t)
    None =>
      Err({
        name,
        error: problem(
          "UnknownTemplate", "template name is not in catalog", 0, 0,
        ),
      })
  }
}

///|
pub fn TemplateCatalog::names(self : TemplateCatalog) -> Array[String] {
  self.ordered_names.copy()
}

///|
pub fn TemplateCatalog::templates_using(
  self : TemplateCatalog,
  variable : String,
) -> Array[String] {
  self.names().filter(name => self.entries[name].variables().contains(variable))
}

///|
pub fn TemplateCatalog::measure(
  self : TemplateCatalog,
  name : String,
  variables : Variables,
  required~ : Array[String] = [],
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[Int32, CatalogError] {
  match self.get(name) {
    Err(e) => Err(e)
    Ok(t) =>
      match t.measure(variables, required~, limits~) {
        Ok(n) => Ok(n)
        Err(error) => Err({ name, error, })
      }
  }
}

///|
pub(all) struct CatalogDiff {
  added : Array[String]
  removed : Array[String]
  changed : Array[(String, ContractDiff)]
} derive(Debug)

///|
pub fn TemplateCatalog::diff(
  self : TemplateCatalog,
  newer : TemplateCatalog,
) -> CatalogDiff {
  let old = self.names()
  let next = newer.names()
  let changed : Array[(String, ContractDiff)] = []
  for name in old {
    if newer.entries.get(name) is Some(t) {
      let diff = self.entries[name].diff(t)
      if diff.source_changed {
        changed.push((name, diff))
      }
    }
  }
  {
    added: next.filter(n => !old.contains(n)),
    removed: old.filter(n => !next.contains(n)),
    changed,
  }
}

///|
pub extend CatalogDiff with Debug::{to_repr}

///|
pub fn TemplateCatalog::expand(
  self : TemplateCatalog,
  name : String,
  variables : Variables,
  required~ : Array[String] = [],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
) -> Result[String, CatalogError] {
  match self.get(name) {
    Err(e) => Err(e)
    Ok(t) =>
      match t.expand_checked(variables, required~, reject_unused~, limits~) {
        Ok(s) => Ok(s)
        Err(error) => Err({ name, error, })
      }
  }
}

///|
pub extend CatalogError with Debug::{to_repr}
