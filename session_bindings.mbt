///|
/// Private copy-on-write blocks. Names/slot index are shared across snapshots;
/// active indices avoid scanning the catalog's unbound variables.
priv struct SessionBindings {
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
  { slots, blocks, active, }
}

///|
fn SessionBindings::get(self : SessionBindings, name : String) -> Value? {
  match self.slots.get(name) {
    None => None
    Some(index) => self.blocks[index / 32][index % 32]
  }
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

///|
/// Persistent array in blocks of 32: an update copies the block spine and the
/// touched blocks only, so retained snapshots share unchanged entries.
priv struct Chunks[T] {
  blocks : Array[Array[T]]
  length : Int32
}

///|
fn[T] Chunks::from_array(items : Array[T]) -> Chunks[T] {
  let blocks : Array[Array[T]] = []
  let mut start = 0
  while start < items.length() {
    let end = if start + 32 < items.length() {
      start + 32
    } else {
      items.length()
    }
    blocks.push(items[start:end].to_owned())
    start = end
  }
  { blocks, length: items.length(), }
}

///|
fn[T] Chunks::at(self : Chunks[T], index : Int32) -> T {
  self.blocks[index / 32][index % 32]
}

///|
/// Indices must be sorted; returns a new version and leaves self unchanged.
fn[T] Chunks::with_updates(
  self : Chunks[T],
  indices : Array[Int32],
  values : Array[T],
) -> Chunks[T] {
  let blocks = self.blocks.copy()
  let mut last = -1
  for k, index in indices {
    let block = index / 32
    if block != last {
      blocks[block] = blocks[block].copy()
      last = block
    }
    blocks[block][index % 32] = values[k]
  }
  { blocks, length: self.length, }
}

///|
/// Members and code points of one binding, counted as the input budget does.
fn binding_cost(name : String, value : Value) -> (Int32, Int32) {
  let mut points = codepoints(name)
  let members = match value {
    Scalar(text) => {
      points = points + codepoints(text)
      0
    }
    List(items) => {
      for text in items {
        points = points + codepoints(text)
      }
      items.length()
    }
    Assoc(entries) => {
      for pair in entries.entries {
        points = points + codepoints(pair.0) + codepoints(pair.1)
      }
      entries.entries.length()
    }
  }
  (members, points)
}

///|
fn codepoints(text : String) -> Int32 {
  let mut count = 0
  let mut index = 0
  while index < text.length() {
    let unit = text[index].to_int()
    if unit >= 0xD800 && unit <= 0xDBFF && index + 1 < text.length() {
      let next = text[index + 1].to_int()
      if next >= 0xDC00 && next <= 0xDFFF {
        index = index + 1
      }
    }
    index = index + 1
    count = count + 1
  }
  count
}
