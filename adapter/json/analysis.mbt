///|
fn bool_json(value : Bool) -> Json {
  Json::boolean(value)
}

///|
fn int_json(value : Int32) -> Json {
  Json::number(value.to_double())
}

///|
fn strings_json(values : Array[String]) -> Json {
  Json::array(values.map(Json::string))
}

///|
fn span_json(span : @template.Span) -> Json {
  Json::object(
    Map([("start", int_json(span.start)), ("end", int_json(span.end))]),
  )
}

///|
fn use_json(u : @template.VariableUse) -> Json {
  Json::object(
    Map([
      ("name", Json::string(u.name)),
      ("operator", Json::string(u.operator)),
      (
        "prefix",
        match u.prefix {
          Some(n) => int_json(n)
          None => Json::null()
        },
      ),
      ("explode", bool_json(u.explode)),
      ("expressionIndex", int_json(u.expression_index)),
      ("span", span_json(u.span)),
    ]),
  )
}

///|
fn profile_json(p : @template.VariableProfile) -> Json {
  Json::object(
    Map([
      ("name", Json::string(p.name)),
      ("occurrences", int_json(p.occurrences)),
      ("firstSpan", span_json(p.first_span)),
      ("lastSpan", span_json(p.last_span)),
      ("scalarOnly", bool_json(p.scalar_only)),
      ("usesExplode", bool_json(p.uses_explode)),
      ("usesReserved", bool_json(p.uses_reserved)),
      ("usesQuery", bool_json(p.uses_query)),
      ("usesFragment", bool_json(p.uses_fragment)),
      (
        "maximumPrefix",
        match p.maximum_prefix {
          Some(n) => int_json(n)
          None => Json::null()
        },
      ),
      ("operators", strings_json(p.operators)),
      ("prefixes", Json::array(p.prefixes.map(int_json))),
      ("uses", Json::array(p.uses.map(use_json))),
    ]),
  )
}

///|
fn analysis_json(a : @template.TemplateAnalysis) -> Json {
  Json::object(
    Map([
      ("offsetUnit", Json::string("unicode-code-point")),
      ("maxLevel", int_json(a.max_level)),
      ("hasReservedExpansion", bool_json(a.has_reserved_expansion)),
      ("hasFragment", bool_json(a.has_fragment)),
      ("uses", Json::array(a.uses.map(use_json))),
      ("profiles", Json::array(a.profiles.map(profile_json))),
      (
        "expressions",
        Json::array(
          a.expressions.map(e => {
            Json::object(
              Map([
                ("operator", Json::string(e.operator)),
                ("level", int_json(e.level)),
                ("span", span_json(e.span)),
                ("variables", strings_json(e.variables)),
              ]),
            )
          }),
        ),
      ),
    ]),
  )
}

///|
fn diff_fields(d : @template.DetailedContractDiff) -> Map[String, Json] {
  Map([
    ("offsetUnit", Json::string("unicode-code-point")),
    ("addedVariables", strings_json(d.added_variables)),
    ("removedVariables", strings_json(d.removed_variables)),
    ("becameScalarOnly", strings_json(d.became_scalar_only)),
    ("becameCompositeCapable", strings_json(d.became_composite_capable)),
    ("newRepeatedVariables", strings_json(d.new_repeated_variables)),
    ("oldLevel", int_json(d.old_level)),
    ("newLevel", int_json(d.new_level)),
    ("reservedAdded", bool_json(d.reserved_added)),
    ("fragmentAdded", bool_json(d.fragment_added)),
    ("literalsChanged", bool_json(d.literals_changed)),
    ("expressionLayoutChanged", bool_json(d.expression_layout_changed)),
    ("sourceChanged", bool_json(d.source_changed)),
    (
      "variableChanges",
      Json::array(
        d.variable_changes.map(c => {
          Json::object(
            Map([
              ("name", Json::string(c.name)),
              ("before", profile_json(c.before)),
              ("after", profile_json(c.after)),
              ("operatorsChanged", bool_json(c.operators_changed)),
              ("prefixesChanged", bool_json(c.prefixes_changed)),
              ("explodeChanged", bool_json(c.explode_changed)),
              ("occurrencesChanged", bool_json(c.occurrences_changed)),
              ("usesChanged", bool_json(c.uses_changed)),
            ]),
          )
        }),
      ),
    ),
  ])
}

///|
fn name_difference(a : Array[String], b : Array[String]) -> Array[String] {
  let known : Map[String, Bool] = Map([])
  for name in b {
    known[name] = true
  }
  let result : Array[String] = []
  for name in a {
    if !known.contains(name) {
      result.push(name)
      known[name] = true
    }
  }
  result
}

///|
pub fn PreparedRequest::compare(
  self : PreparedRequest,
  newer : PreparedRequest,
) -> String {
  let before = match self.compiled {
    Err(message) => return message
    Ok(value) => value
  }
  let after = match newer.compiled {
    Err(message) => return message
    Ok(value) => value
  }
  let diff = before.template.diff_contract(after.template)
  let fields = diff_fields(diff)
  let added = name_difference(after.required, before.required)
  let removed = name_difference(before.required, after.required)
  let budgets : Array[Json] = []
  for
    (name, old, next) in [
      ("maxBindings", before.limits.max_bindings, after.limits.max_bindings),
      ("maxMembers", before.limits.max_members, after.limits.max_members),
      (
        "maxValue",
        before.limits.max_value_codepoints,
        after.limits.max_value_codepoints,
      ),
      (
        "maxTotalValue",
        before.limits.max_total_value_codepoints,
        after.limits.max_total_value_codepoints,
      ),
      (
        "maxOutput",
        before.limits.max_output_bytes,
        after.limits.max_output_bytes,
      ),
      ("maxJson", before.max_json, after.max_json),
      ("maxJsonDepth", before.max_depth, after.max_depth),
    ] {
    if old != next {
      budgets.push(
        Json::object(
          Map([
            ("name", Json::string(name)),
            ("before", int_json(old)),
            ("after", int_json(next)),
            ("tightened", bool_json(next < old)),
          ]),
        ),
      )
    }
  }
  fields["addedRequired"] = strings_json(added)
  fields["removedRequired"] = strings_json(removed)
  fields["rejectUnusedBefore"] = bool_json(before.reject_unused)
  fields["rejectUnusedAfter"] = bool_json(after.reject_unused)
  fields["budgetChanges"] = Json::array(budgets)
  fields["requiresReview"] = bool_json(
    diff.requires_review() ||
    !added.is_empty() ||
    !removed.is_empty() ||
    before.reject_unused != after.reject_unused ||
    !budgets.is_empty(),
  )
  success(Json::object(fields).stringify())
}
