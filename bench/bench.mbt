///|
/// Batched pure-library benchmark; JSON and CLI startup are excluded.
#export_name("measure")
pub fn measure(reuse : Bool, count : Int32) -> Int32 {
  let source = "/users/{id}{?q,tags*}"
  let vars = @uri.Variables::new()
  vars.set("id", @uri.Scalar("42"))
  vars.set("q", @uri.Scalar("中文 moon bit"))
  vars.set("tags", @uri.List(["sdk", "api", "test"]))
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
