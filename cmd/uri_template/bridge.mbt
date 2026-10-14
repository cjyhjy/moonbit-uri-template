///|
/// JavaScript entry point. All interpretation runs in MoonBit.
#export_name("request")
pub fn request(
  command : String,
  source : String,
  variables_json : String,
) -> String {
  @adapter.request(command, source, variables_json)
}
