///|
#export_name("openapi_analyze")
pub fn openapi_analyze(source : String) -> String {
  @adapter.openapi_analyze(source)
}

///|
#export_name("openapi_name")
pub fn openapi_name(name : String) -> String {
  @adapter.openapi_name(name)
}

///|
#export_name("openapi_prepare")
pub fn openapi_prepare(
  source : String,
  base_url : String,
  strict : Bool,
) -> @adapter.PreparedOpenApi {
  @adapter.openapi_prepare(source, base_url, strict)
}

///|
#export_name("openapi_report")
pub fn openapi_report(prepared : @adapter.PreparedOpenApi) -> String {
  prepared.report()
}

///|
#export_name("openapi_expand")
pub fn openapi_expand(
  prepared : @adapter.PreparedOpenApi,
  key : String,
  variables : String,
  names : String,
) -> String {
  prepared.expand(key, variables, names)
}
