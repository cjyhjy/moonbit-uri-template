///|
fn is_hex(c : Char) -> Bool {
  (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

///|
fn is_name_char(c : Char) -> Bool {
  (c >= 'a' && c <= 'z') ||
  (c >= 'A' && c <= 'Z') ||
  (c >= '0' && c <= '9') ||
  c == '_'
}

///|
fn pct_at(cs : Array[Char], i : Int32, end : Int32) -> Bool {
  i + 2 < end && cs[i] == '%' && is_hex(cs[i + 1]) && is_hex(cs[i + 2])
}

///|
fn literal_char(c : Char) -> Bool {
  let n = c.to_int()
  if n < 128 {
    n >= 33 &&
    n <= 126 &&
    c != '"' &&
    c != '%' &&
    c != '<' &&
    c != '>' &&
    c != '\\' &&
    c != '^' &&
    c != '`' &&
    c != '{' &&
    c != '|' &&
    c != '}'
  } else {
    // RFC 3987 ucschar / iprivate, referenced by RFC 6570's literal grammar.
    (n >= 0xA0 && n <= 0xD7FF) ||
    (n >= 0xE000 && n <= 0xF8FF) ||
    (n >= 0xF900 && n <= 0xFDCF) ||
    (n >= 0xFDF0 && n <= 0xFFEF) ||
    (n >= 0x10000 && n <= 0xDFFFD && (n & 0xFFFF) <= 0xFFFD) ||
    (n >= 0xE1000 && n <= 0xEFFFD) ||
    (n >= 0xF0000 && n <= 0x10FFFD && (n & 0xFFFF) <= 0xFFFD)
  }
}

///|
fn parse_var(
  cs : Array[Char],
  start : Int32,
  end : Int32,
) -> Result[VarSpec, TemplateError] {
  let mut i = start
  let mut after_dot = true
  while i < end {
    if is_name_char(cs[i]) {
      after_dot = false
      i = i + 1
    } else if pct_at(cs, i, end) {
      after_dot = false
      i = i + 3
    } else if cs[i] == '.' && !after_dot {
      after_dot = true
      i = i + 1
    } else {
      break
    }
  }
  if i == start || after_dot {
    return Err(
      problem("InvalidVariableName", "expected a variable name", start, i),
    )
  }
  let name = chars_text(cs, start, i)
  let modifier = if i == end {
    NoModifier
  } else if cs[i] == '*' && i + 1 == end {
    Explode
  } else if cs[i] == ':' {
    let digit_start = i + 1
    if digit_start == end ||
      end - digit_start > 4 ||
      cs[digit_start] < '1' ||
      cs[digit_start] > '9' {
      return Err(
        problem(
          "InvalidModifier", "prefix must be 1..9999 without leading zeros", i, end,
        ),
      )
    }
    let mut size = 0
    for j = digit_start; j < end; j = j + 1 {
      if cs[j] < '0' || cs[j] > '9' {
        return Err(
          problem("InvalidModifier", "invalid prefix modifier", j, end),
        )
      }
      size = size * 10 + cs[j].to_int() - 48
    }
    Prefix(size)
  } else {
    return Err(
      problem(
        "InvalidVariableName", "unexpected character in variable specification",
        i, end,
      ),
    )
  }
  Ok({ name, modifier, span: { start, end, }, })
}

///|
/// Parse and validate an RFC 6570 template. Invalid templates return no partial result.
pub fn parse(source : String) -> Result[Template, TemplateError] {
  let cs = source.to_array()
  let segments : Array[Segment] = []
  let mut i = 0
  let mut literal_start = 0
  while i < cs.length() {
    if cs[i] == '{' {
      if i > literal_start {
        segments.push(Literal(encode(chars_text(cs, literal_start, i), true)))
      }
      let expression_start = i
      i = i + 1
      let mut op = ' '
      if i < cs.length() && "+#./;?&".contains(cs[i].to_string()) {
        op = cs[i]
        i = i + 1
      }
      let specs : Array[VarSpec] = []
      let mut spec_start = i
      while i < cs.length() && cs[i] != '}' {
        if cs[i] == '{' {
          return Err(
            problem("NestedExpression", "nested opening brace", i, i + 1),
          )
        }
        if cs[i] == ',' {
          match parse_var(cs, spec_start, i) {
            Ok(v) => specs.push(v)
            Err(e) => return Err(e)
          }
          spec_start = i + 1
        }
        i = i + 1
      }
      if i == cs.length() {
        return Err(
          problem(
            "UnclosedExpression", "expected closing brace", expression_start, i,
          ),
        )
      }
      match parse_var(cs, spec_start, i) {
        Ok(v) => specs.push(v)
        Err(e) => return Err(e)
      }
      segments.push(Expression(op, specs))
      i = i + 1
      literal_start = i
    } else if pct_at(cs, i, cs.length()) {
      i = i + 3
    } else if literal_char(cs[i]) {
      i = i + 1
    } else {
      return Err(
        problem(
          "InvalidLiteral",
          "invalid literal character or percent sequence",
          i,
          i + 1,
        ),
      )
    }
  }
  if i > literal_start {
    segments.push(Literal(encode(chars_text(cs, literal_start, i), true)))
  }
  Ok({ segments, })
}

///|
/// Variable names in first-occurrence order, retaining their encoded spelling.
pub fn Template::variables(self : Template) -> Array[String] {
  let names : Array[String] = []
  let seen : Map[String, Bool] = Map([])
  for segment in self.segments {
    if segment is Expression(_, specs) {
      for spec in specs {
        if !seen.contains(spec.name) {
          seen[spec.name] = true
          names.push(spec.name)
        }
      }
    }
  }
  names
}
