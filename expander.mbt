///|
fn expand_value(
  spec : VarSpec,
  value : Value,
  rule : OperatorSpec,
) -> Result[Array[String], TemplateError] {
  let parts : Array[String] = []
  match value {
    Scalar(text) => {
      let text = match spec.modifier {
        Prefix(n) => prefix(text, n)
        _ => text
      }
      parts.push(named_part(spec.name, encode(text, rule.allow_reserved), rule))
    }
    List(items) => {
      // Empty composites are undefined and must be omitted before modifiers.
      if items.is_empty() {
        return Ok([])
      }
      if spec.modifier is Prefix(_) {
        return Err(
          problem(
            "PrefixOnComposite",
            "prefix is only valid on scalar values",
            spec.span.start,
            spec.span.end,
          ),
        )
      }
      if !items.is_empty() {
        if spec.modifier is Explode {
          for item in items {
            parts.push(
              named_part(spec.name, encode(item, rule.allow_reserved), rule),
            )
          }
        } else {
          let encoded = items.map(x => encode(x, rule.allow_reserved)).join(",")
          parts.push(named_part(spec.name, encoded, rule))
        }
      }
    }
    Assoc(entries) => {
      if entries.entries.is_empty() {
        return Ok([])
      }
      if spec.modifier is Prefix(_) {
        return Err(
          problem(
            "PrefixOnComposite",
            "prefix is only valid on scalar values",
            spec.span.start,
            spec.span.end,
          ),
        )
      }
      if !entries.entries.is_empty() {
        if spec.modifier is Explode {
          for (key, item) in entries.entries {
            let name = encode(key, rule.allow_reserved)
            let value = encode(item, rule.allow_reserved)
            parts.push(
              if rule.named {
                named_part(name, value, rule)
              } else {
                name + "=" + value
              },
            )
          }
        } else {
          let flat : Array[String] = []
          for (key, item) in entries.entries {
            flat.push(encode(key, rule.allow_reserved))
            flat.push(encode(item, rule.allow_reserved))
          }
          parts.push(named_part(spec.name, flat.join(","), rule))
        }
      }
    }
  }
  Ok(parts)
}

///|
/// Expand a parsed template. Undefined variables are omitted.
pub fn Template::expand(
  self : Template,
  variables : Variables,
) -> Result[String, TemplateError] {
  let out = StringBuilder()
  for segment in self.segments {
    match segment {
      Literal(text) => out.write_string(text)
      Expression(op, specs) => {
        let rule = operator_spec(op)
        let parts : Array[String] = []
        for spec in specs {
          match variables.values.get(spec.name) {
            None => ()
            Some(value) =>
              match expand_value(spec, value, rule) {
                Ok(items) => parts.push_iter(items.iter())
                Err(e) => return Err(e)
              }
          }
        }
        if !parts.is_empty() {
          out.write_string(rule.first)
          out.write_string(parts.join(rule.separator))
        }
      }
    }
  }
  Ok(out.to_string())
}

///|
/// Parse and expand in one call. For repeated expansion, retain a Template instead.
pub fn expand(
  source : String,
  variables : Variables,
) -> Result[String, TemplateError] {
  match parse(source) {
    Ok(template) => template.expand(variables)
    Err(error) => Err(error)
  }
}
