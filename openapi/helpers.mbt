///|
fn get(j : Json, key : String) -> Json {
  match j {
    Object(m) => m.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn has(j : Json, key : String) -> Bool {
  match j {
    Object(m) => m.contains(key)
    _ => false
  }
}

///|
fn obj(j : Json) -> Bool {
  j is Object(_)
}

///|
fn entries(j : Json) -> Array[(String, Json)] {
  match j {
    Object(m) => m.iter().collect()
    _ => []
  }
}

///|
fn array(j : Json) -> Array[Json] {
  match j {
    Array(a) => a
    _ => []
  }
}

///|
fn str(j : Json) -> String {
  match j {
    String(s) => s
    _ => j.stringify()
  }
}

///|
fn truth(j : Json) -> Bool {
  match j {
    Null | False => false
    String(s) => s != ""
    Number(n, ..) => n != 0
    _ => true
  }
}

///|
fn ptr(s : String) -> String {
  s.replace_all(old="~", new="~0").replace_all(old="/", new="~1")
}

///|
fn alnum(c : Char) -> Bool {
  (c >= 'a' && c <= 'z') ||
  (c >= 'A' && c <= 'Z') ||
  (c >= '0' && c <= '9') ||
  c == '_'
}

///|
fn hex(c : Char) -> Int32 {
  if c >= '0' && c <= '9' {
    c.to_int() - 48
  } else if c >= 'a' && c <= 'f' {
    c.to_int() - 87
  } else if c >= 'A' && c <= 'F' {
    c.to_int() - 55
  } else {
    -1
  }
}

///|
pub fn template_name(name : String) -> String {
  let chars = name.to_array()
  let mut valid = chars.length() > 0
  for i, c in chars {
    if !alnum(c) &&
      !(c == '.' &&
      i > 0 &&
      i + 1 < chars.length() &&
      alnum(chars[i - 1]) &&
      alnum(chars[i + 1])) {
      valid = false
    }
  }
  if valid {
    return name
  }
  let out = StringBuilder()
  for b in @utf8.encode(name) {
    let n = b.to_int()
    if alnum(n.unsafe_to_char()) {
      out.write_char(n.unsafe_to_char())
    } else {
      out.write_string("%")
      out.write_char("0123456789ABCDEF"[n / 16].to_int().unsafe_to_char())
      out.write_char("0123456789ABCDEF"[n % 16].to_int().unsafe_to_char())
    }
  }
  out.to_string()
}

///|
fn decode_pointer(s : String) -> String? {
  let chars = s.to_array()
  let bytes : Array[Byte] = []
  let mut i = 0
  while i < chars.length() {
    if chars[i] == '%' {
      if i + 2 >= chars.length() ||
        hex(chars[i + 1]) < 0 ||
        hex(chars[i + 2]) < 0 {
        return None
      }
      bytes.push((hex(chars[i + 1]) * 16 + hex(chars[i + 2])).to_byte())
      i += 3
    } else {
      for b in @utf8.encode(chars[i].to_string()) {
        bytes.push(b)
      }
      i += 1
    }
  }
  let decoded = @utf8.decode(Bytes::from_array(bytes)) catch {
    _ => return None
  }
  Some(decoded)
}

///|
fn value_shape(j : Json) -> String? {
  fn scalar(x : Json) -> Bool {
    x is String(_) || x is Number(_, ..) || x is True || x is False
  }
  match j {
    Null => None
    Array(a) => Some(if a.iter().all(scalar) { "list" } else { "nested" })
    Object(m) => Some(if m.values().all(scalar) { "assoc" } else { "nested" })
    _ => Some("scalar")
  }
}

///|
fn bindings(j : Json) -> @core.Variables? {
  fn scalar(x : Json) -> String? {
    match x {
      String(s) => Some(s)
      True => Some("true")
      False => Some("false")
      Number(n, ..) =>
        Some(
          if n == n.floor() && n.abs() < 9007199254740992.0 {
            n.to_int64().to_string()
          } else {
            n.to_string()
          },
        )
      _ => None
    }
  }
  let vars = @core.Variables::new()
  for (key, v) in entries(j) {
    match v {
      Null => ()
      Array(a) => {
        let xs : Array[String] = []
        for x in a {
          guard scalar(x) is Some(s) else { return None }
          xs.push(s)
        }
        vars.set(key, @core.List(xs))
      }
      Object(m) => {
        let xs : Array[(String, String)] = []
        for k, x in m {
          if x is Null {
            continue
          }
          guard scalar(x) is Some(s) else { return None }
          xs.push((k, s))
        }
        match @core.OrderedEntries::from_entries(xs) {
          Ok(e) => vars.set(key, @core.Assoc(e))
          Err(_) => return None
        }
      }
      _ => {
        guard scalar(v) is Some(s) else { return None }
        vars.set(key, @core.Scalar(s))
      }
    }
  }
  Some(vars)
}

///|
fn upper(s : String) -> String {
  String::from_array(
    s
    .to_array()
    .map(fn(c) {
      if c >= 'a' && c <= 'z' {
        (c.to_int() - 32).unsafe_to_char()
      } else {
        c
      }
    }),
  )
}
