///|
priv struct Output {
  buffer : StringBuilder
  mut remaining : Int32
  mut started : Bool
  materialize : Bool
}

///|
fn Output::write(self : Output, text : String) -> Bool {
  // All chunks are ASCII: encoded data, variable names, operator punctuation.
  if text.length() > self.remaining {
    return false
  }
  self.remaining = self.remaining - text.length()
  if self.materialize {
    self.buffer.write_string(text)
  }
  true
}

///|
fn Output::begin(self : Output, rule : OperatorSpec) -> Bool {
  let separator = if self.started { rule.separator } else { rule.first }
  self.started = true
  self.write(separator)
}

///|
fn Output::encoded(self : Output, text : String, allow_reserved : Bool) -> Bool {
  // Three-code-point lookahead preserves percent triplets without copying the input.
  let chars = text.iter()
  let mut a = chars.next()
  let mut b = chars.next()
  let mut c = chars.next()
  while a is Some(current) {
    if allow_reserved &&
      current == '%' &&
      b is Some(h1) &&
      c is Some(h2) &&
      is_hex(h1) &&
      is_hex(h2) {
      if self.remaining < 3 {
        return false
      }
      self.remaining = self.remaining - 3
      if self.materialize {
        self.buffer.write_char(current)
        self.buffer.write_char(h1)
        self.buffer.write_char(h2)
      }
      a = chars.next()
      b = chars.next()
      c = chars.next()
    } else {
      let plain = unreserved(current) || (allow_reserved && reserved(current))
      let n = current.to_int()
      let size = if plain {
        1
      } else if n < 0x80 {
        3
      } else if n < 0x800 {
        6
      } else if n < 0x10000 {
        9
      } else {
        12
      }
      if size > self.remaining {
        return false
      }
      self.remaining = self.remaining - size
      if self.materialize {
        if plain {
          self.buffer.write_char(current)
        } else {
          write_encoded(self.buffer, current)
        }
      }
      a = b
      b = c
      c = chars.next()
    }
  }
  true
}

///|
fn Output::named(
  self : Output,
  name : String,
  empty : Bool,
  rule : OperatorSpec,
) -> Bool {
  !rule.named ||
  (self.write(name) && self.write(if empty { rule.empty } else { "=" }))
}

///|
fn emit_value(
  out : Output,
  spec : VarSpec,
  value : Value,
  rule : OperatorSpec,
) -> Bool {
  match value {
    Scalar(text) => {
      let text = match spec.modifier {
        Prefix(n) => prefix(text, n)
        _ => text
      }
      out.begin(rule) &&
      out.named(spec.name, text == "", rule) &&
      out.encoded(text, rule.allow_reserved)
    }
    List(items) => {
      if items.is_empty() {
        return true
      }
      if spec.modifier is Explode {
        for item in items {
          if !(out.begin(rule) &&
            out.named(spec.name, item == "", rule) &&
            out.encoded(item, rule.allow_reserved)) {
            return false
          }
        }
      } else {
        if !(out.begin(rule) &&
          out.named(spec.name, items.length() == 1 && items[0] == "", rule)) {
          return false
        }
        for i, item in items {
          if i > 0 && !out.write(",") {
            return false
          }
          if !out.encoded(item, rule.allow_reserved) {
            return false
          }
        }
      }
      true
    }
    Assoc(entries) => {
      if entries.entries.is_empty() {
        return true
      }
      if spec.modifier is Explode {
        for (key, item) in entries.entries {
          if !(out.begin(rule) &&
            out.encoded(key, rule.allow_reserved) &&
            out.write(if rule.named && item == "" { rule.empty } else { "=" }) &&
            out.encoded(item, rule.allow_reserved)) {
            return false
          }
        }
      } else {
        if !(out.begin(rule) && out.named(spec.name, false, rule)) {
          return false
        }
        for i, entry in entries.entries {
          let (key, item) = entry
          if i > 0 && !out.write(",") {
            return false
          }
          if !(out.encoded(key, rule.allow_reserved) &&
            out.write(",") &&
            out.encoded(item, rule.allow_reserved)) {
            return false
          }
        }
      }
      true
    }
  }
}

///|
fn defined(value : Value) -> Bool {
  match value {
    Scalar(_) => true
    List(items) => !items.is_empty()
    Assoc(entries) => !entries.entries.is_empty()
  }
}

///|
fn Template::render_impl(
  self : Template,
  variables : Variables,
  limits : ExpansionLimits?,
  materialize : Bool,
  trace : Bool,
) -> Result[Expansion, TemplateError] {
  let out : Output = {
    buffer: StringBuilder(),
    remaining: match limits {
      Some(budget) => budget.max_output_bytes
      None => 2147483647
    },
    started: false,
    materialize,
  }
  let capacity = out.remaining
  let origins : Array[OutputOrigin] = []
  for segment in self.segments {
    match segment {
      Literal(text, span) => {
        let start = capacity - out.remaining
        if !out.write(text) {
          return Err(
            problem(
              "OutputLimit",
              "expanded URI exceeds byte budget",
              span.start,
              span.end,
            ),
          )
        }
        if trace && capacity - out.remaining > start {
          origins.push({
            name: None,
            source: span,
            output_start: start,
            output_end: capacity - out.remaining,
          })
        }
      }
      Expression(op, specs) => {
        out.started = false
        let rule = operator_spec(op)
        for spec in specs {
          if variables.values.get(spec.name) is Some(value) {
            if defined(value) &&
              spec.modifier is Prefix(_) &&
              !(value is Scalar(_)) {
              return Err(
                problem(
                  "PrefixOnComposite",
                  "prefix is only valid on scalar values",
                  spec.span.start,
                  spec.span.end,
                ),
              )
            }
            let start = capacity - out.remaining
            if !emit_value(out, spec, value, rule) {
              return Err(
                problem(
                  "OutputLimit",
                  "expanded URI exceeds byte budget",
                  spec.span.start,
                  spec.span.end,
                ),
              )
            }
            if trace && capacity - out.remaining > start {
              origins.push({
                name: Some(spec.name),
                source: spec.span,
                output_start: start,
                output_end: capacity - out.remaining,
              })
            }
          }
        }
      }
    }
  }
  Ok({
    output: out.buffer.to_string(),
    bytes: capacity - out.remaining,
    origins,
  })
}

///|
/// Expand with RFC omission semantics. With no options the call is unbounded
/// (the 0.1 behaviour). Passing `limits`, `required` or `reject_unused` checks
/// every binding first, then streams within the budget; no partial result escapes.
pub fn Template::expand(
  self : Template,
  variables : Variables,
  required? : Array[String],
  reject_unused~ : Bool = false,
  limits? : ExpansionLimits,
) -> Result[String, TemplateError] {
  if limits is None && required is None && !reject_unused {
    return self.expand_impl(variables, None)
  }
  let limits = match limits {
    Some(l) => l
    None => ExpansionLimits::new()
  }
  let required = match required {
    Some(r) => r
    None => []
  }
  match self.validate_bindings(variables, required, reject_unused, limits) {
    Err(e) => Err(e)
    Ok(_) => self.expand_impl(variables, Some(limits))
  }
}

///|
pub fn expand(
  source : String,
  variables : Variables,
) -> Result[String, TemplateError] {
  match parse(source) {
    Ok(template) => template.expand(variables)
    Err(error) => Err(error)
  }
}

///|
fn Template::expand_impl(
  self : Template,
  variables : Variables,
  limits : ExpansionLimits?,
) -> Result[String, TemplateError] {
  self.render_impl(variables, limits, true, false).map(result => result.output)
}
