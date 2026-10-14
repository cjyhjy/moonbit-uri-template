///|
test "encoded prefix follows decoded code points without splitting octets" {
  let cases = [
    ("%2fabc", 1, "%2f"),
    ("%C3%a9z", 1, "%C3%a9"),
    ("%e4%b8%adz", 1, "%e4%b8%ad"),
    ("%f0%9f%98%80z", 1, "%f0%9f%98%80"),
    ("a%C3%A9z", 2, "a%C3%A9"),
    ("éz", 1, "e"),
    ("中文😀", 9999, "中文😀"),
  ]
  for (text, length, expected) in cases {
    assert_eq(prefix(text, length), expected)
  }
}

///|
test "IRI literal range boundaries exclude controls surrogates and noncharacters" {
  let valid = [
    0xA0, 0xD7FF, 0xE000, 0xF8FF, 0xF900, 0xFDCF, 0xFDF0, 0xFFEF, 0x10000, 0x1FFFD,
    0xDFFFD, 0xE1000, 0xEFFFD, 0xF0000, 0x10FFFD,
  ]
  let invalid = [
    0x7F, 0x80, 0x9F, 0xD800, 0xDFFF, 0xFDD0, 0xFDEF, 0xFFF0, 0xFFFF, 0x1FFFE, 0x1FFFF,
    0xE0000, 0xE0FFF, 0x10FFFE, 0x10FFFF,
  ]
  for point in valid {
    assert_true(literal_char(point.unsafe_to_char()))
  }
  for point in invalid {
    assert_false(literal_char(point.unsafe_to_char()))
  }
}
