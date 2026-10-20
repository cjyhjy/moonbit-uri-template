///|
/// One request in a heterogeneous catalog batch.
pub(all) struct CatalogRequest {
  name : String
  variables : Variables
  required : Array[String]
} derive(Debug)

///|
pub fn CatalogRequest::new(
  name : String,
  variables : Variables,
  required~ : Array[String] = [],
) -> CatalogRequest {
  { name, variables, required, }
}

///|
/// index=-1 means a batch option/count error; otherwise identifies the request.
pub(all) struct CatalogBatchError {
  index : Int32
  name : String
  error : TemplateError
} derive(Debug)

///|
/// Validate the entire plan without materializing any result URI.
/// Aggregate input counts variable names/values and catalog request names.
pub fn TemplateCatalog::measure_batch(
  self : TemplateCatalog,
  requests : Array[CatalogRequest],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
  batch_limits~ : BatchLimits = BatchLimits::new(),
) -> Result[Array[Int32], CatalogBatchError] {
  if batch_limits.max_items < 0 ||
    batch_limits.max_total_input_codepoints < 0 ||
    batch_limits.max_total_output_bytes < 0 {
    return Err({
      index: -1,
      name: "",
      error: problem("InvalidLimit", "negative batch budget", 0, 0),
    })
  }
  if requests.length() > batch_limits.max_items {
    return Err({
      index: -1,
      name: "",
      error: problem("BatchItemLimit", "batch count exceeds budget", 0, 0),
    })
  }
  match check_input_budget(Variables::new(), limits) {
    Err(error) => return Err({ index: -1, name: "", error, })
    Ok(_) => ()
  }
  let sizes : Array[Int32] = []
  let mut remaining_input = batch_limits.max_total_input_codepoints
  let mut remaining_output = batch_limits.max_total_output_bytes
  for index, request in requests {
    let name = request.name
    let template = match self.get(name) {
      Err(e) => return Err({ index, name, error: e.error, })
      Ok(t) => t
    }
    match
      template.validate_bindings(
        request.variables,
        request.required,
        reject_unused,
        limits,
      ) {
      Err(error) => return Err({ index, name, error, })
      Ok(_) => ()
    }
    let texts = input_texts(request.variables)
    texts.push(name)
    for text in texts {
      for _ in text.iter() {
        if remaining_input == 0 {
          return Err({
            index,
            name,
            error: problem(
              "BatchInputLimit", "total input exceeds batch budget", 0, 0,
            ),
          })
        }
        remaining_input = remaining_input - 1
      }
    }
    let per_item = {
      ..limits,
      max_output_bytes: Int32::min(limits.max_output_bytes, remaining_output),
    }
    match
      template.render_impl(request.variables, Some(per_item), false, false) {
      Err(e) => {
        let error = if e.code == "OutputLimit" &&
          remaining_output < limits.max_output_bytes {
          {
            ..e,
            code: "BatchOutputLimit",
            message: "total output exceeds batch budget",
          }
        } else {
          e
        }
        return Err({ index, name, error, })
      }
      Ok(r) => {
        sizes.push(r.bytes)
        remaining_output = remaining_output - r.bytes
      }
    }
  }
  Ok(sizes)
}

///|
/// Atomic multi-template expansion: preflight all requests before producing URIs.
pub fn TemplateCatalog::expand_batch(
  self : TemplateCatalog,
  requests : Array[CatalogRequest],
  reject_unused~ : Bool = false,
  limits~ : ExpansionLimits = ExpansionLimits::new(),
  batch_limits~ : BatchLimits = BatchLimits::new(),
) -> Result[Array[String], CatalogBatchError] {
  match self.measure_batch(requests, reject_unused~, limits~, batch_limits~) {
    Err(e) => return Err(e)
    Ok(_) => ()
  }
  let results : Array[String] = []
  for index, request in requests {
    match
      self
      .get(request.name)
      .unwrap()
      .expand_impl(request.variables, Some(limits)) {
      Err(error) => return Err({ index, name: request.name, error, })
      Ok(uri) => results.push(uri)
    }
  }
  Ok(results)
}

///|
pub extend CatalogRequest with Debug::{to_repr}

///|
pub extend CatalogBatchError with Debug::{to_repr}
