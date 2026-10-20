///|
pub(all) struct VariableUse {
  name : String
  operator : String
  prefix : Int32?
  explode : Bool
  expression_index : Int32
  span : Span
} derive(Debug)

///|
/// Ordered by first occurrence. All uses are retained, not just a summary.
pub(all) struct VariableProfile {
  name : String
  occurrences : Int32
  first_span : Span
  last_span : Span
  scalar_only : Bool
  uses_explode : Bool
  uses_reserved : Bool
  uses_query : Bool
  uses_fragment : Bool
  maximum_prefix : Int32?
  operators : Array[String]
  prefixes : Array[Int32]
  uses : Array[VariableUse]
} derive(Debug)

///|
pub fn Template::variable_uses(self : Template) -> Array[VariableUse] {
  let result : Array[VariableUse] = []
  let mut expression_index = 0
  for segment in self.segments {
    if segment is Expression(op, specs) {
      for spec in specs {
        result.push({
          name: spec.name,
          operator: if op == ' ' {
            ""
          } else {
            op.to_string()
          },
          prefix: match spec.modifier {
            Prefix(n) => Some(n)
            _ => None
          },
          explode: spec.modifier is Explode,
          expression_index,
          span: spec.span,
        })
      }
      expression_index = expression_index + 1
    }
  }
  result
}

///|
fn profile(name : String, uses : Array[VariableUse]) -> VariableProfile {
  let operators : Array[String] = []
  let prefixes : Array[Int32] = []
  let seen_prefixes : Map[Int32, Bool] = Map([])
  let mut maximum_prefix = None
  let mut explode = false
  for occurrence in uses {
    if !operators.contains(occurrence.operator) {
      operators.push(occurrence.operator)
    }
    explode = explode || occurrence.explode
    if occurrence.prefix is Some(n) {
      if !seen_prefixes.contains(n) {
        prefixes.push(n)
        seen_prefixes[n] = true
      }
      maximum_prefix = Some(
        match maximum_prefix {
          Some(old) => Int32::max(old, n)
          None => n
        },
      )
    }
  }
  {
    name,
    occurrences: uses.length(),
    first_span: uses[0].span,
    last_span: uses[uses.length() - 1].span,
    scalar_only: !prefixes.is_empty(),
    uses_explode: explode,
    uses_reserved: operators.contains("+") || operators.contains("#"),
    uses_query: operators.contains("?") || operators.contains("&"),
    uses_fragment: operators.contains("#"),
    maximum_prefix,
    operators,
    prefixes,
    uses,
  }
}

///|
fn profiles_from_uses(uses : Array[VariableUse]) -> Array[VariableProfile] {
  let names : Array[String] = []
  let groups : Map[String, Array[VariableUse]] = Map([])
  for occurrence in uses {
    match groups.get(occurrence.name) {
      Some(group) => group.push(occurrence)
      None => {
        names.push(occurrence.name)
        groups[occurrence.name] = [occurrence]
      }
    }
  }
  names.map(name => profile(name, groups[name]))
}

///|
pub fn Template::variable_profiles(self : Template) -> Array[VariableProfile] {
  profiles_from_uses(self.variable_uses())
}

///|
pub fn Template::reference_count(self : Template, name : String) -> Int32 {
  let mut count = 0
  for segment in self.segments {
    if segment is Expression(_, specs) {
      for spec in specs {
        if spec.name == name {
          count = count + 1
        }
      }
    }
  }
  count
}

///|
pub fn Template::composite_capable_variables(self : Template) -> Array[String] {
  self.variable_profiles().filter(p => !p.scalar_only).map(p => p.name)
}

///|
pub(all) struct TemplateAnalysis {
  expressions : Array[ExpressionInfo]
  uses : Array[VariableUse]
  profiles : Array[VariableProfile]
  max_level : Int32
  has_reserved_expansion : Bool
  has_fragment : Bool
} derive(Debug)

///|
pub fn Template::analyze(self : Template) -> TemplateAnalysis {
  let expressions = self.inspect()
  let uses = self.variable_uses()
  let mut max_level = 0
  let mut reserved = false
  let mut fragment = false
  for expression in expressions {
    max_level = Int32::max(max_level, expression.level)
    reserved = reserved ||
      expression.operator == "+" ||
      expression.operator == "#"
    fragment = fragment || expression.operator == "#"
  }
  {
    expressions,
    uses,
    profiles: profiles_from_uses(uses),
    max_level,
    has_reserved_expansion: reserved,
    has_fragment: fragment,
  }
}

///|
pub(all) struct VariableChange {
  name : String
  before : VariableProfile
  after : VariableProfile
  operators_changed : Bool
  prefixes_changed : Bool
  explode_changed : Bool
  occurrences_changed : Bool
  uses_changed : Bool
} derive(Debug)

///|
/// A review aid, never a claim of business or URL equivalence.
pub(all) struct DetailedContractDiff {
  added_variables : Array[String]
  removed_variables : Array[String]
  became_scalar_only : Array[String]
  became_composite_capable : Array[String]
  new_repeated_variables : Array[String]
  old_level : Int32
  new_level : Int32
  reserved_added : Bool
  fragment_added : Bool
  literals_changed : Bool
  expression_layout_changed : Bool
  variable_changes : Array[VariableChange]
  source_changed : Bool
} derive(Debug)

///|
fn same_uses(a : Array[VariableUse], b : Array[VariableUse]) -> Bool {
  if a.length() != b.length() {
    return false
  }
  for i, x in a {
    let y = b[i]
    if x.operator != y.operator ||
      x.prefix != y.prefix ||
      x.explode != y.explode ||
      x.expression_index != y.expression_index {
      return false
    }
  }
  true
}

///|
fn same_specs(a : Array[VarSpec], b : Array[VarSpec]) -> Bool {
  if a.length() != b.length() {
    return false
  }
  for i, x in a {
    let y = b[i]
    if x.name != y.name {
      return false
    }
    match (x.modifier, y.modifier) {
      (NoModifier, NoModifier) | (Explode, Explode) => ()
      (Prefix(x), Prefix(y)) => if x != y { return false }
      _ => return false
    }
  }
  true
}

///|
pub fn Template::diff_contract(
  self : Template,
  newer : Template,
) -> DetailedContractDiff {
  let old = self.analyze()
  let next = newer.analyze()
  let old_profiles : Map[String, VariableProfile] = Map([])
  let next_profiles : Map[String, VariableProfile] = Map([])
  for p in old.profiles {
    old_profiles[p.name] = p
  }
  for p in next.profiles {
    next_profiles[p.name] = p
  }
  let scalar : Array[String] = []
  let composite : Array[String] = []
  let repeated : Array[String] = []
  let changes : Array[VariableChange] = []
  for p in next.profiles {
    match old_profiles.get(p.name) {
      None => if p.occurrences > 1 { repeated.push(p.name) }
      Some(before) => {
        if p.scalar_only && !before.scalar_only {
          scalar.push(p.name)
        }
        if !p.scalar_only && before.scalar_only {
          composite.push(p.name)
        }
        if p.occurrences > 1 && before.occurrences <= 1 {
          repeated.push(p.name)
        }
        let uses_changed = !same_uses(before.uses, p.uses)
        if uses_changed {
          changes.push({
            name: p.name,
            before,
            after: p,
            operators_changed: before.uses.map(u => u.operator) !=
            p.uses.map(u => u.operator),
            prefixes_changed: before.uses.map(u => u.prefix) !=
            p.uses.map(u => u.prefix),
            explode_changed: before.uses.map(u => u.explode) !=
            p.uses.map(u => u.explode),
            occurrences_changed: before.occurrences != p.occurrences,
            uses_changed,
          })
        }
      }
    }
  }
  let mut literals_changed = false
  let mut layout_changed = false
  let size = Int32::max(self.segments.length(), newer.segments.length())
  for i = 0; i < size; i = i + 1 {
    let a = self.segments.get(i)
    let b = newer.segments.get(i)
    match (a, b) {
      (Some(Literal(x, _)), Some(Literal(y, _))) =>
        if x != y {
          literals_changed = true
        }
      (Some(Expression(x, xs)), Some(Expression(y, ys))) =>
        if x != y || !same_specs(xs, ys) {
          layout_changed = true
        }
      _ => {
        if a is Some(Literal(_, _)) || b is Some(Literal(_, _)) {
          literals_changed = true
        }
        if a is Some(Expression(_, _)) || b is Some(Expression(_, _)) {
          layout_changed = true
        }
      }
    }
  }
  {
    added_variables: next.profiles
    .filter(p => !old_profiles.contains(p.name))
    .map(p => p.name),
    removed_variables: old.profiles
    .filter(p => !next_profiles.contains(p.name))
    .map(p => p.name),
    became_scalar_only: scalar,
    became_composite_capable: composite,
    new_repeated_variables: repeated,
    old_level: old.max_level,
    new_level: next.max_level,
    reserved_added: !old.has_reserved_expansion && next.has_reserved_expansion,
    fragment_added: !old.has_fragment && next.has_fragment,
    literals_changed,
    expression_layout_changed: layout_changed,
    variable_changes: changes,
    source_changed: self.source_text != newer.source_text,
  }
}

///|
pub fn DetailedContractDiff::requires_review(
  self : DetailedContractDiff,
) -> Bool {
  self.source_changed
}

///|
pub extend VariableUse with Debug::{to_repr}

///|
pub extend VariableProfile with Debug::{to_repr}

///|
pub extend TemplateAnalysis with Debug::{to_repr}

///|
pub extend VariableChange with Debug::{to_repr}

///|
pub extend DetailedContractDiff with Debug::{to_repr}
