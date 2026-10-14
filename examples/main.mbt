///|
fn main {
  let vars = @template.Variables::new()
  vars.set("id", @template.Scalar("42"))
  vars.set("page", @template.Scalar("2"))
  match @template.parse("/users/{id}{?page}") {
    Err(e) => println(e.message)
    Ok(template) => {
      match template.expand(vars) {
        Ok(uri) => println(uri)
        Err(e) => println(e.message)
      }
      vars.set("id", @template.Scalar("99"))
      match template.expand(vars) {
        Ok(uri) => println(uri)
        Err(e) => println(e.message)
      }
    }
  }
}
