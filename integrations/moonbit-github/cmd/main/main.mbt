///|
extern "C" fn exit(status : Int32) -> Unit = "exit"

///|
async fn main {
  try {
    let args = @env.args()
    guard args.length() == 3 || (args.length() == 4 && args[3] == "--live") else {
      raise @client.ClientError(
        "Usage", "native-client SPEC.json REQUESTS.json [--live]",
      )
    }
    let source = @client.read_input(args[1], 33554432)
    let config = @client.parse_config(@client.read_input(args[2], 65536))
    println(@client.run(source, config, live=args.length() == 4).stringify())
  } catch {
    @client.ClientError(code, message) => {
      let report : Json = { "ok": false, "code": code, "message": message }
      println(report.stringify())
      exit(
        if ["HttpStatus", "ResponseMismatch", "SizeLimit"].contains(code) {
          1
        } else {
          2
        },
      )
    }
    error => {
      let report : Json = {
        "ok": false,
        "code": "ClientFailure",
        "message": error.to_string(),
      }
      println(report.stringify())
      exit(1)
    }
  }
}
