///|
fn unreserved(c : Char) -> Bool {
  is_name_char(c) || c == '-' || c == '.' || c == '~'
}

///|
fn reserved(c : Char) -> Bool {
  ":/?#[]@!$&'()*+,;=".contains(c.to_string())
}

///|
fn write_byte(out : StringBuilder, n : Int32) -> Unit {
  let hex = "0123456789ABCDEF".to_array()
  out.write_char('%')
  out.write_char(hex[(n >> 4) & 15])
  out.write_char(hex[n & 15])
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
fn encode(value : String, allow_reserved : Bool) -> String {
  let cs = value.to_array()
  let out = StringBuilder()
  let mut i = 0
  while i < cs.length() {
    if allow_reserved && pct_at(cs, i, cs.length()) {
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
fn hex_value(c : Char) -> Int32 {
  if c >= '0' && c <= '9' {
    c.to_int() - 48
  } else if c >= 'A' && c <= 'F' {
    c.to_int() - 55
  } else {
    c.to_int() - 87
  }
}

///|
fn pct_byte(cs : Array[Char], i : Int32) -> Int32 {
  hex_value(cs[i + 1]) * 16 + hex_value(cs[i + 2])
}

// Count decoded Unicode code points, preserving existing percent triplets.

///|
fn prefix(value : String, length : Int32) -> String {
  let cs = value.to_array()
  let mut i = 0
  let mut count = 0
  while i < cs.length() && count < length {
    if pct_at(cs, i, cs.length()) {
      let b = pct_byte(cs, i)
      let width = if b >= 0xC2 && b <= 0xDF {
        2
      } else if b >= 0xE0 && b <= 0xEF {
        3
      } else if b >= 0xF0 && b <= 0xF4 {
        4
      } else {
        1
      }
      let mut consumed = 1
      while consumed < width && pct_at(cs, i + consumed * 3, cs.length()) {
        let next = pct_byte(cs, i + consumed * 3)
        if next < 0x80 || next > 0xBF {
          break
        }
        consumed = consumed + 1
      }
      i = i + consumed * 3
    } else {
      i = i + 1
    }
    count = count + 1
  }
  chars_text(cs, 0, i)
}
