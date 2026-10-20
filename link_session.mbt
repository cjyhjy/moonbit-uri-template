///|
pub(all) enum BindingChange {
  SetBinding(String, Value)
  RemoveBinding(String)
}

///|
pub(all) struct LinkChange {
  name : String
  before : String
  after : String
} derive(Debug)

///|
priv struct SessionEndpoint {
  name : String
  template : Template
  variables : Array[String]
  contract : ContractTemplate?
}

///|
/// Immutable captured bindings and URI outputs; methods return detached arrays.
struct LinkSession {
  endpoints : Array[SessionEndpoint]
  dependencies : Map[String, Array[Int32]]
  values : SessionBindings
  outputs : Chunks[String]
  sizes : Chunks[Int32]
  positions : Map[String, Int32]
  members_used : Int32
  points_used : Int32
  total : Int32
  limits : ExpansionLimits
  total_limit : Int32
  patch_limit : Int32
}

///|
struct LinkUpdate {
  next : LinkSession
  changes : Array[LinkChange]
  recomputed : Int32
}

///|
pub fn LinkUpdate::session(self : LinkUpdate) -> LinkSession {
  self.next
}

///|
pub fn LinkUpdate::changes(self : LinkUpdate) -> Array[LinkChange] {
  self.changes.copy()
}

///|
pub fn LinkUpdate::recomputed(self : LinkUpdate) -> Int32 {
  self.recomputed
}

///|
pub fn LinkSession::links(self : LinkSession) -> Array[(String, String)] {
  self.endpoints.mapi((i, endpoint) => (endpoint.name, self.outputs.at(i)))
}

///|
pub fn LinkSession::total_bytes(self : LinkSession) -> Int32 {
  self.total
}

///|
pub fn LinkSession::get(
  self : LinkSession,
  name : String,
) -> Result[String, CatalogError] {
  if self.positions.get(name) is Some(index) {
    return Ok(self.outputs.at(index))
  }
  Err({
    name,
    error: problem("UnknownTemplate", "template name is not in session", 0, 0),
  })
}

///|
fn session_problem(code : String, message : String) -> CatalogError {
  { name: "", error: problem(code, message, 0, 0), }
}

///|
fn SessionEndpoint::bindings(
  self : SessionEndpoint,
  shared : SessionBindings,
) -> Variables {
  let values : Map[String, Value] = Map([])
  for name in self.variables {
    if shared.get(name) is Some(value) {
      values[name] = value
    }
  }
  // Internal read-only projection. Never exposed to a caller.
  { values, }
}

///|
fn SessionEndpoint::measure(
  self : SessionEndpoint,
  shared : SessionBindings,
  limits : ExpansionLimits,
) -> Result[Int32, CatalogError] {
  let vars = self.bindings(shared)
  let measured = match self.contract {
    Some(c) => c.measure(vars, limits~)
    None => self.template.measure(vars, limits~)
  }
  measured.map_err(error => { name: self.name, error, })
}

///|
fn SessionEndpoint::render(
  self : SessionEndpoint,
  shared : SessionBindings,
  limits : ExpansionLimits,
) -> Result[String, CatalogError] {
  // All endpoints have already been validated and measured before rendering.
  self.template
  .expand_impl(self.bindings(shared), Some(limits))
  .map_err(error => { name: self.name, error, })
}

///|
/// Contracts are optional endpoint policies and must refer to the same source.
/// Every shared input counts once against the session's cumulative input budget.
pub fn TemplateCatalog::start_session(
  self : TemplateCatalog,
  variables : Variables,
  contracts~ : Array[(String, ContractTemplate)] = [],
  limits~ : ExpansionLimits = ExpansionLimits::new(),
  max_total_output_bytes~ : Int32 = 4194304,
  max_patch_bindings~ : Int32 = 4096,
  max_dependency_edges~ : Int32 = 65536,
) -> Result[LinkSession, CatalogError] {
  if max_total_output_bytes < 0 ||
    max_patch_bindings < 0 ||
    max_dependency_edges < 0 {
    return Err(session_problem("InvalidLimit", "negative session budget"))
  }
  match check_input_budget(variables, limits) {
    Err(error) => return Err({ name: "", error, })
    Ok(_) => ()
  }
  if contracts.length() > self.entries.length() {
    return Err(session_problem("ContractLimit", "too many endpoint contracts"))
  }
  let policies : Map[String, ContractTemplate] = Map([])
  for (name, contract) in contracts {
    if policies.contains(name) {
      return Err(
        session_problem("DuplicateContract", "duplicate endpoint contract"),
      )
    }
    match self.entries.get(name) {
      None =>
        return Err({
          name,
          error: problem("UnknownTemplate", "unknown contract endpoint", 0, 0),
        })
      Some(t) =>
        if t.source_text != contract.template.source_text {
          return Err({
            name,
            error: problem(
              "ContractSource", "contract source does not match endpoint", 0, 0,
            ),
          })
        }
    }
    policies[name] = contract
  }
  let endpoints : Array[SessionEndpoint] = []
  let dependencies : Map[String, Array[Int32]] = Map([])
  let mut remaining_edges = max_dependency_edges
  for name in self.names() {
    let template = self.entries[name]
    let names = template.variables()
    if names.length() > remaining_edges {
      return Err(
        session_problem(
          "DependencyLimit", "endpoint dependencies exceed budget",
        ),
      )
    }
    remaining_edges = remaining_edges - names.length()
    for variable in names {
      match dependencies.get(variable) {
        Some(indices) => indices.push(endpoints.length())
        None => dependencies[variable] = [endpoints.length()]
      }
    }
    endpoints.push({
      name,
      template,
      variables: names,
      contract: policies.get(name),
    })
  }
  for name in variables.values.keys() {
    if !dependencies.contains(name) {
      return Err(
        session_problem(
          "UnusedBinding", "shared binding is not used by any endpoint",
        ),
      )
    }
  }
  let captured = SessionBindings::capture(
    dependencies.keys().to_array(),
    variables,
  )
  let mut members_used = 0
  let mut points_used = 0
  for name, value in variables.values {
    let (members, points) = binding_cost(name, value)
    members_used = members_used + members
    points_used = points_used + points
  }
  let positions : Map[String, Int32] = Map([])
  for index, endpoint in endpoints {
    positions[endpoint.name] = index
  }
  let sizes : Array[Int32] = []
  let mut remaining = max_total_output_bytes
  for endpoint in endpoints {
    let size = match endpoint.measure(captured, limits) {
      Err(e) => return Err(e)
      Ok(size) => size
    }
    if size > remaining {
      return Err(
        session_problem("SessionOutputLimit", "snapshot output exceeds budget"),
      )
    }
    remaining = remaining - size
    sizes.push(size)
  }
  let outputs : Array[String] = []
  for endpoint in endpoints {
    match endpoint.render(captured, limits) {
      Err(e) => return Err(e)
      Ok(uri) => outputs.push(uri)
    }
  }
  Ok({
    endpoints,
    dependencies,
    values: captured,
    outputs: Chunks::from_array(outputs),
    sizes: Chunks::from_array(sizes),
    positions,
    members_used,
    points_used,
    total: max_total_output_bytes - remaining,
    limits,
    total_limit: max_total_output_bytes,
    patch_limit: max_patch_bindings,
  })
}

///|
fn same_value(a : Value, b : Value) -> Bool {
  match (a, b) {
    (Scalar(a), Scalar(b)) => a == b
    (List(a), List(b)) => a == b
    (Assoc(a), Assoc(b)) => a.entries == b.entries
    _ => false
  }
}

///|
/// Stage a patch, validate the complete next environment and total output, then
/// render only affected endpoints. Neither failure nor success mutates self.
pub fn LinkSession::update(
  self : LinkSession,
  changes : Array[BindingChange],
) -> Result[LinkUpdate, CatalogError] {
  if changes.length() > self.patch_limit {
    return Err(session_problem("PatchLimit", "too many patch operations"))
  }
  let seen : Map[String, Bool] = Map([])
  let incoming = Variables::new()
  for change in changes {
    let name = match change {
      SetBinding(name, _) | RemoveBinding(name) => name
    }
    if seen.contains(name) {
      return Err(
        session_problem("DuplicatePatch", "a binding occurs twice in patch"),
      )
    }
    seen[name] = true
    if !self.dependencies.contains(name) {
      return Err(
        session_problem(
          "UnusedBinding", "patch binding is not used by any endpoint",
        ),
      )
    }
    if change is SetBinding(_, value) {
      // Validate incoming content BEFORE copying composite values.
      incoming.values[name] = value
    }
  }
  match check_input_budget(incoming, self.limits) {
    Err(error) => return Err({ name: "", error, })
    Ok(_) => ()
  }
  let (next, changed_names) = self.values.stage(changes)
  let affected : Map[Int32, Bool] = Map([])
  for name in changed_names {
    for index in self.dependencies[name] {
      affected[index] = true
    }
  }
  // Only changed bindings are re-counted; unchanged ones were checked before.
  if next.active.length() > self.limits.max_bindings {
    return Err(session_problem("BindingLimit", "binding count exceeds budget"))
  }
  let mut members_used = self.members_used
  let mut points_used = self.points_used
  for name in changed_names {
    if self.values.get(name) is Some(old) {
      let (members, points) = binding_cost(name, old)
      members_used = members_used - members
      points_used = points_used - points
    }
    if next.get(name) is Some(value) {
      let (members, points) = binding_cost(name, value)
      members_used = members_used + members
      points_used = points_used + points
    }
  }
  if members_used > self.limits.max_members {
    return Err(
      session_problem("MemberLimit", "total collection members exceed budget"),
    )
  }
  if points_used > self.limits.max_total_value_codepoints {
    return Err(
      session_problem(
        "TotalValueLimit", "total input code points exceed budget",
      ),
    )
  }
  if affected.is_empty() {
    return Ok({ next: self, changes: [], recomputed: 0, })
  }
  // Preserve catalog order without traversing every unchanged endpoint twice.
  let indices = affected.keys().to_array()
  indices.sort()
  // Release ALL affected lengths first, so growth/shrink is order-independent.
  let mut remaining = self.total_limit - self.total
  for index in indices {
    remaining = remaining + self.sizes.at(index)
  }
  let sizes : Array[Int32] = []
  for index in indices {
    let endpoint = self.endpoints[index]
    let size = match endpoint.measure(next, self.limits) {
      Err(e) => return Err(e)
      Ok(size) => size
    }
    if size > remaining {
      return Err(
        session_problem("SessionOutputLimit", "snapshot output exceeds budget"),
      )
    }
    remaining = remaining - size
    sizes.push(size)
  }
  let outputs : Array[String] = []
  let emitted : Array[LinkChange] = []
  for index in indices {
    let endpoint = self.endpoints[index]
    let uri = match endpoint.render(next, self.limits) {
      Err(e) => return Err(e)
      Ok(uri) => uri
    }
    let before = self.outputs.at(index)
    if uri != before {
      emitted.push({ name: endpoint.name, before, after: uri, })
    }
    outputs.push(uri)
  }
  // Copy only changed composites; unchanged captured values remain private.
  next.capture_changed(changed_names)
  Ok({
    next: {
      ..self,
      values: next,
      outputs: self.outputs.with_updates(indices, outputs),
      sizes: self.sizes.with_updates(indices, sizes),
      members_used,
      points_used,
      total: self.total_limit - remaining,
    },
    changes: emitted,
    recomputed: affected.length(),
  })
}

///|
pub extend LinkChange with Debug::{to_repr}
