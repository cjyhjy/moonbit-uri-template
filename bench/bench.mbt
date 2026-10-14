///|
/// Batch pure-library scenarios; JSON and process startup are excluded.
#export_name("measure")
pub fn measure(reuse : Bool, count : Int32, scenario : Int32) -> Int32 {
  let vars = @uri.Variables::new()
  vars.set("id", @uri.Scalar("42"))
  vars.set("q", @uri.Scalar("中文 moon bit"))
  vars.set("tags", @uri.List(["sdk", "api", "test"]))
  let source = match scenario {
    0 => "/users/{id}"
    1 => "/users/{id}{?q,tags*}"
    2 => {
      let text = StringBuilder()
      for i = 0; i < 200; i = i + 1 {
        text.write_string("/segment/{id}")
      }
      text.to_string()
    }
    _ => {
      let tags : Array[String] = []
      for i = 0; i < 100; i = i + 1 {
        tags.push("标签" + i.to_string())
      }
      vars.set("tags", @uri.List(tags))
      "/search{?tags*}"
    }
  }
  let template = @uri.parse(source).unwrap()
  let mut checksum = 0
  for i = 0; i < count; i = i + 1 {
    let output = if reuse {
      template.expand(vars).unwrap()
    } else {
      @uri.expand(source, vars).unwrap()
    }
    checksum = checksum + output.length()
  }
  checksum
}
