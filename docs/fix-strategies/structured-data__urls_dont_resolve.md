# structured-data__urls_dont_resolve

Status: READY
Topic: 36 of the issue register
Tier: A
Shared facts: `_structured_data_shared_facts.md`
Research title: schema__urls_do_not_resolve (topic 36).
Research date: 2026-09-15

---

## what's actually wrong

A URL inside structured data does not resolve, or is not crawlable.

## threshold

A URL-valued property in structured data returns a confirmed non-200, or is
disallowed for Googlebot.

Google's requirement is explicit for images: image URLs must be crawlable and
indexable (D9). The same logic extends to other URL-valued properties, since a
URL that cannot be fetched cannot identify anything.

Severity by property role:

| Property | Role | Severity |
|---|---|---|
| `image` on a type where it is required by the feature table | required | high |
| `image` where recommended (e.g. Article, D7) | recommended | moderate |
| `author.url` / `sameAs` | author disambiguation | moderate |
| `url` identifying the entity | identity | high |
| `publisher.url`, `logo` | recommended | moderate |
| any URL-valued property not in the feature table | — | low |

Confirmation rules are inherited, not reinvented: 4xx per topic 68, 5xx
persistence per topic 3, soft 404 per topic 2a, robots disallow per topic 21's
matcher.

## detect

1. Extract structured data; collect every URL-valued property with the
   property path that produced it.
2. Validate each is absolute. A relative URL in structured data is a defect in
   itself — the markup is consumed out of page context.
3. Fetch each. Classify per the inherited rules.
4. Evaluate each against the robots.txt matcher for Googlebot — a URL that
   resolves but is disallowed still fails D9.
5. Re-fetch before raising.

## fix

- **relative URL** → make absolute. Deterministic where the page's own origin
  applies.
- **URL redirects** → repoint to the final 200 target. Deterministic for a
  single hop.
- **URL returns confirmed 4xx** → the reference is dead. Removing the property
  is deterministic where the property is recommended rather than required;
  where it is required, removal makes the item ineligible, so the correct fix
  is a replacement value, which is a content decision.
- **URL is robots-disallowed** → no markup fix. The conflict is between the
  markup and robots.txt, and which should change is intent (topic 21's
  reasoning applies).

## postcondition

Live: every URL-valued property in the served markup is absolute, returns 200
in zero redirects, and is allowed for Googlebot.

## idempotent?

Yes for absolutisation. No for repointing, which breaks if the target moves.

## risk / blast radius

Generated markup — usually one component for every page of a type. Where
generated at build time, fix the generator.

## rollback

Revert.

## verdict

`auto-fixable` for: absolutising a relative URL, repointing a single-hop
redirect, and removing a dead **recommended** URL property.

`human-review` for a dead **required** URL property, and for any
robots-disallow conflict.

## false-positive guards

| # | Guard | Action |
|---|---|---|
| 1 | URL observed non-200 once | re-fetch first (topic 68) |
| 2 | 5xx is transient | topic 3. Never raise here |
| 3 | URL is cross-origin and unreachable from the crawler | unknown, not broken. State the limitation |
| 4 | `author.url` points at an external profile (social media, ORCID) | expected and encouraged. Only raise on confirmed 4xx |
| 5 | URL is an `@id` used purely as a graph identifier, not a fetchable address | `@id` need not resolve. Never raise |
| 6 | Image URL resolves but is in an unsupported format | separate finding (D9), not a resolution failure |
| 7 | URL disallowed by robots.txt for a non-Googlebot agent | evaluate for Googlebot specifically (topic 21) |
| 8 | Markup injected client-side | assess the served response (topic 67) |

### Explicitly rejected

- **Requiring `@id` values to resolve.** They are identifiers, not addresses.
- **Removing a required URL property to clear the finding.** That trades one
  defect for ineligibility (D1).
- **Auto-editing robots.txt to unblock a schema URL.** Blast radius is the
  whole origin (topic 22).

## fixture

`image` URL returning a confirmed 404; a relative `image` URL; an `image` URL
redirecting once; an `author.url` to a live external profile; an `@id` that
does not resolve; an `image` URL allowed by robots but in an unsupported
format; an `image` URL disallowed for Googlebot.

CI asserts: moderate finding for the first (Article, recommended); auto-fix for
the second and third; nothing for the fourth and fifth; format finding for the
sixth; human-review for the seventh.

## Cross-references

- topics 2a, 3, 21, 68 supply classification; topics 35, 37, 38
