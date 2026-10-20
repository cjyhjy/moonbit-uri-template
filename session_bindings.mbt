///|
/// Private copy-on-write blocks. Names/slot index are shared across snapshots;
/// active indices avoid scanning the catalog's unbound variables.
priv struct SessionBindings {
  names : Array[String]
  slots : Map[String, Int32]
  blocks : Array[Array[Value?]]
  active : Array[Int32]
}

///|
fn SessionBindings::capture(
  names : Array[String],
  variables : Variables,
) -> SessionBindings {
  let slots : Map[String, Int32] = Map([])
  for index, name in names {
    slots[name] = index
  }
  let blocks = Array::makei(
    names.length() / 32 + (if names.length() % 32 == 0 { 0 } else { 1 }),
    _ => Array::make(32, None),
  )
  let active = []
  for name, value in variables.values {
    let index = slots[name]
    blocks[index / 32][index % 32] = Some(value.captured())
    active.push(index)
  }
  { names, slots, blocks, active, }
}

///|
fn SessionBindings::get(self : SessionBindings, name : String) -> Value? {
  match self.slots.get(name) {
    None => None
    Some(index) => self.blocks[index / 32][index % 32]
  }
}

///|
fn SessionBindings::entries(self : SessionBindings) -> Iter2[String, Value] {
  let mut cursor = 0
  Iter2::new(fn() {
    if cursor == self.active.length() {
      return None
    }
    let index = self.active[cursor]
    cursor = cursor + 1
    Some((self.names[index], self.blocks[index / 32][index % 32].unwrap()))
  })
}

///|
/// Names and duplicates have already been checked. Changed blocks are private
/// even before validation; failure can therefore discard this entire stage.
fn SessionBindings::stage(
  self : SessionBindings,
  changes : Array[BindingChange],
) -> (SessionBindings, Array[String]) {
  let blocks = self.blocks.copy()
  let copied : Map[Int32, Bool] = Map([])
  let mut active = self.active
  let mut active_copied = false
  let changed = []
  for change in changes {
    let (name, next) = match change {
      SetBinding(name, value) => (name, Some(value))
      RemoveBinding(name) => (name, None)
    }
    let index = self.slots[name]
    let before = self.blocks[index / 32][index % 32]
    let equal = match (before, next) {
      (None, None) => true
      (Some(a), Some(b)) => same_value(a, b)
      _ => false
    }
    if equal {
      continue
    }
    changed.push(name)
    let block = index / 32
    if !copied.contains(block) {
      blocks[block] = blocks[block].copy()
      copied[block] = true
    }
    blocks[block][index % 32] = next
    match (before, next) {
      (None, Some(_)) => {
        if !active_copied {
          active = active.copy()
          active_copied = true
        }
        active.push(index)
      }
      (Some(_), None) => {
        active = active.filter(other => other != index)
        active_copied = true
      }
      _ => ()
    }
  }
  ({ ..self, blocks, active, }, changed)
}

///|
/// Only staged blocks are mutable here, and only after all checks succeed.
fn SessionBindings::capture_changed(
  self : SessionBindings,
  names : Array[String],
) -> Unit {
  for name in names {
    let index = self.slots[name]
    if self.blocks[index / 32][index % 32] is Some(value) {
      self.blocks[index / 32][index % 32] = Some(value.captured())
    }
  }
}
