///|
#export_name("request_with_options")
pub fn request_with_options(
  command : String,
  source : String,
  variables_json : String,
  options_json : String,
) -> String {
  @adapter.request_with_options(command, source, variables_json, options_json)
}

///|
#export_name("prepare_request")
pub fn prepare_request(
  source : String,
  options : String,
) -> @adapter.PreparedRequest {
  @adapter.prepare_request(source, options)
}

///|
#export_name("prepared_call")
pub fn prepared_call(
  prepared : @adapter.PreparedRequest,
  command : String,
  variables : String,
) -> String {
  prepared.call(command, variables)
}

///|
#export_name("prepared_compare")
pub fn prepared_compare(
  before : @adapter.PreparedRequest,
  after : @adapter.PreparedRequest,
) -> String {
  before.compare(after)
}
