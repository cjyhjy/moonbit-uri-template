///|
test "Mooncakes consumer analyzes compiles expands and reads diagnostics" {
  let source =
    #|{"openapi":"3.1.0","paths":{"/pets/{id}":{"get":{"operationId":"pets/get","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}},{"name":"tags","in":"query","schema":{"type":"array"}}]}}}}
  let analysis = @openapi.analyze_text(source).unwrap()
  assert_true(analysis.ok())
  assert_true(analysis.complete())
  assert_eq(analysis.truncated().errors, 0)
  assert_eq(analysis.truncated().warnings, 0)
  let operations = analysis.operations()
  assert_eq(operations.length(), 1)
  let operation = operations[0]
  assert_eq(operation.id, Some("pets/get"))
  assert_eq(operation.http_method, "GET")
  assert_eq(operation.template, Some("/pets/{id}{?tags*}"))
  assert_eq(operation.parameters[0].location, @openapi.Path)
  assert_eq(operation.parameters[1].shape, Some(@openapi.ListShape))
  let templates = @openapi.compile_analysis(analysis).unwrap()
  let variables = @uri.Variables::new()
  variables.set("id", @uri.Scalar("a b"))
  variables.set("tags", @uri.List(["red", "green"]))
  assert_eq(
    templates.expand("pets/get", variables),
    Ok("/pets/a%20b?tags=red&tags=green"),
  )
  let invalid = @openapi.analyze_text(
    (
      #|{"openapi":"2.0","paths":{}}
    ),
  ).unwrap()
  assert_false(invalid.complete())
  let diagnostic = invalid.diagnostics()[0]
  assert_eq(diagnostic.code, "UnsupportedVersion")
  assert_eq(diagnostic.severity, @openapi.Error)
  assert_eq(diagnostic.path, "/openapi")
}
