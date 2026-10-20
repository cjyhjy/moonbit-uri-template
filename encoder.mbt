///|
fn unreserved(c : Char) -> Bool {
  is_name_char(c) || c == '-' || c == '.' || c == '~'
}

///|
fn reserved(c : Char) -> Bool {
  match c {
    ':'
    | '/'
    | '?'
    | '#'
    | '['
    | ']'
    | '@'
    | '!'
    | '$'
    | '&'
    | '\''
    | '('
    | ')'
    | '*'
    | '+'
    | ','
    | ';'
    | '=' => true
    _ => false
  }
}

///|
fn hex_digit(n : Int32) -> Char {
  (if n < 10 { 48 + n } else { 55 + n }).unsafe_to_char()
}

///|
fn write_byte(out : StringBuilder, n : Int32) -> Unit {
  out.write_char('%')
  out.write_char(hex_digit((n >> 4) & 15))
  out.write_char(hex_digit(n & 15))
}

///|
fn write_encoded(out : StringBuilder, c : Char) -> Unit {
  let n = c.to_int()
  if n < 0x80 {
    write_byte(out, n)
  } else if n < 0x800 {
    write_byte(out, 0xC0 | (n >> 6))
    write_byte(out, 0x80 | (n & 63))
  } else if n < 0x10000 {
    write_byte(out, 0xE0 | (n >> 12))
    write_byte(out, 0x80 | ((n >> 6) & 63))
    write_byte(out, 0x80 | (n & 63))
  } else {
    write_byte(out, 0xF0 | (n >> 18))
    write_byte(out, 0x80 | ((n >> 12) & 63))
    write_byte(out, 0x80 | ((n >> 6) & 63))
    write_byte(out, 0x80 | (n & 63))
  }
}

///|
fn encode_chars(
  cs : Array[Char],
  start : Int32,
  end : Int32,
  allow_reserved : Bool,
) -> String {
  let out = StringBuilder()
  let mut i = start
  while i < end {
    if allow_reserved && pct_at(cs, i, end) {
      out.write_char(cs[i])
      out.write_char(cs[i + 1])
      out.write_char(cs[i + 2])
      i = i + 3
    } else {
      let c = cs[i]
      if unreserved(c) || (allow_reserved && reserved(c)) {
        out.write_char(c)
      } else {
        write_encoded(out, c)
      }
      i = i + 1
    }
  }
  out.to_string()
}

///|
/// First `length` code points of the raw value, before any encoding. This is
/// what the reference implementations do for every operator; a percent
/// triplet cut short by the limit is then encoded as a stray `%`.
fn prefix(value : String, length : Int32) -> String {
  let mut index = 0
  let mut count = 0
  while index < value.length() && count < length {
    let unit = value[index].to_int()
    if unit >= 0xD800 && unit <= 0xDBFF && index + 1 < value.length() {
      let next = value[index + 1].to_int()
      if next >= 0xDC00 && next <= 0xDFFF {
        index = index + 1
      }
    }
    index = index + 1
    count = count + 1
  }
  if index == value.length() {
    value
  } else {
    value.unsafe_substring(start=0, end=index)
  }
}
