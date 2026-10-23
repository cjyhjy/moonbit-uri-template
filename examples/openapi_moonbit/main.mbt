///|
fn main {
  let source =
    #|{"openapi":"3.1.0","paths":{"/repos/{owner}/{repo}/commits":{"get":{"operationId":"repos/list-commits","parameters":[{"name":"owner","in":"path","required":true},{"name":"repo","in":"path","required":true},{"name":"per_page","in":"query","schema":{"type":"integer"}}]}}}}
  let analysis = @openapi.analyze_text(source).unwrap()
  let operation = analysis.operations()[0]
  println(operation.template.unwrap())
  let api = @openapi.compile_analysis(analysis).unwrap()
  let variables = @uri.Variables::new()
  variables.set("owner", @uri.Scalar("octo"))
  variables.set("repo", @uri.Scalar("hello world"))
  variables.set("per_page", @uri.Scalar("10"))
  println(api.expand("repos/list-commits", variables).unwrap())
}
