///|
priv struct OperatorSpec {
  first : String
  separator : String
  named : Bool
  empty : String
  allow_reserved : Bool
}

///|
fn operator_spec(op : Char) -> OperatorSpec {
  match op {
    '+' =>
      {
        first: "",
        separator: ",",
        named: false,
        empty: "",
        allow_reserved: true,
      }
    '#' =>
      {
        first: "#",
        separator: ",",
        named: false,
        empty: "",
        allow_reserved: true,
      }
    '.' =>
      {
        first: ".",
        separator: ".",
        named: false,
        empty: "",
        allow_reserved: false,
      }
    '/' =>
      {
        first: "/",
        separator: "/",
        named: false,
        empty: "",
        allow_reserved: false,
      }
    ';' =>
      {
        first: ";",
        separator: ";",
        named: true,
        empty: "",
        allow_reserved: false,
      }
    '?' =>
      {
        first: "?",
        separator: "&",
        named: true,
        empty: "=",
        allow_reserved: false,
      }
    '&' =>
      {
        first: "&",
        separator: "&",
        named: true,
        empty: "=",
        allow_reserved: false,
      }
    _ =>
      {
        first: "",
        separator: ",",
        named: false,
        empty: "",
        allow_reserved: false,
      }
  }
}
