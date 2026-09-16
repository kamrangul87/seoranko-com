# structured-data__invalid_or_mismatched_type

Status: READY
Topic: 37 of the issue register
Tier: A
Shared facts: `_structured_data_shared_facts.md`
Research title: schema__invalid_or_mismatched_type (topic 37).
Research date: 2026-09-15

---

## what's actually wrong

Structured data uses a type that does not exist, a type inappropriate for the
entity, or a property not valid for its type.

## threshold

Four distinct conditions, and only the first two are cleanly mechanical:

| Condition | Source | Mechanical? | Severity |
|---|---|---|---|
| `@type` is not a schema.org type | schema.org vocabulary | **yes** — vocabulary lookup | high |
| property is not valid for its `@type` per schema.org | schema.org vocabulary | **yes** | moderate |
| `Thing` used where `Person` or `Organization` applies | D15 | **yes** for `author` and `publisher`, where Google states the rule explicitly | moderate |
| `Organization` used for a person, or vice versa | D15 | **partly** — see below | moderate |
| type is irrelevant or misleading for the page | D18 | **no** — judgement | topic 38 |

The `Organization`-for-a-person case is only mechanical where the repo or page
supplies the entity kind — a `Person` record in page data, an author profile
route. Inferring personhood from a name is not deterministic and is rejected.

**Malformed JSON-LD that does not parse** is a separate and more severe
finding: the markup is not read at all. Report distinctly from an invalid type.

## detect

1. Extract structured data (D5). Record parse failures separately.
2. Validate each `@type` against the schema.org vocabulary. Handle arrays of
   types, and `@type` values that are valid but not Google-supported — the
   latter is not an error.
3. Validate each property against its type's schema.org definition.
4. For `author` and `publisher`, check against D15.
5. Confirm `@context` is `https://schema.org`. A missing or wrong context means
   the types do not resolve at all.

## fix

- **`@type` misspelled with an unambiguous correct form** (`Artical` →
  `Article`, case differences) → deterministic correction.
- **property misspelled** → deterministic where the correction is unambiguous
  in the type's own property list.
- **`Thing` used for `author` or `publisher`** → set `Person` or
  `Organization` where the repo supplies the entity kind; `human-review`
  otherwise.
- **property not valid for the type** → removal is deterministic, but removing
  it discards information. Propose removal or the correct property, and do not
  apply where the intended meaning is ambiguous.
- **`@context` missing or wrong** → deterministic correction to
  `https://schema.org`.
- **JSON-LD does not parse** → syntax repair is deterministic only for
  unambiguous cases (trailing comma, unescaped quote). Anything else is
  `human-review`, because a wrong guess silently changes meaning.

## postcondition

Live: the served markup parses, every `@type` resolves in schema.org, and
every property is valid for its type.

## idempotent?

Yes.

## risk / blast radius

Generated markup — one component across a type. Correcting a type changes
which feature the item is eligible for, so it is not a cosmetic change.

## rollback

Revert.

## verdict

`auto-fixable` for: `@context` correction, unambiguous `@type` and property
spelling corrections, and unambiguous JSON-LD syntax repair.

`human-review` for: entity-kind decisions, invalid-property removal where
meaning is ambiguous, and non-trivial parse failures.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | `@type` is a valid schema.org type Google does not support | **valid markup.** Never raise. Google supporting it is a separate question |
| 2 | Type is in a schema.org extension or pending vocabulary | validate against the full vocabulary, not the core subset |
| 3 | `@type` is an array of multiple types | permitted. Validate each |
| 4 | Property is valid on a supertype of the declared type | valid by inheritance. Never raise |
| 5 | Entity kind inferred from a name | **rejected.** Not deterministic |
| 6 | Type appears wrong for the page's subject | topic 38, not this finding |
| 7 | Vocabulary snapshot older than the current schema.org release | stale. New types will be wrongly flagged. Record the snapshot version and date |
| 8 | Markup injected client-side | assess the served response (topic 67) |

### Explicitly rejected

- **Flagging valid schema.org types that Google does not support.** Guard 1 —
  the markup is correct; the site may be targeting other consumers.
- **Inferring whether an author is a person or an organization from the
  name.** Not deterministic.
- **Guessing at non-trivial JSON-LD syntax repairs.** A wrong repair changes
  meaning silently, which is worse than the parse failure.
- **Validating against a hardcoded subset of schema.org.** Same error class as
  the BCP 47 list in topic 34.

## fixture

`@type: "Artical"`; `@type: "Course"` (valid, unsupported by some features);
`author` typed as `Thing` with a `Person` record in repo data; a property not
valid for its type; `@context` absent; JSON-LD with a trailing comma; JSON-LD
with structurally ambiguous damage; an `@type` array.

CI asserts: auto-fix for the first, fifth and sixth; **nothing** for the
second and eighth; auto-fix for the third; human-review for the fourth and
seventh.

## Cross-references

- topics 35, 36, 38, 39; topic 34 (hardcoded-list error class); topic 67
