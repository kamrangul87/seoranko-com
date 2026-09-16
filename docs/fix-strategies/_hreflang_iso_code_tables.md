# Hreflang ISO code tables (topic 47)

Maintained artefact referenced by `hreflang__invalid_language_region_codes.md`.
Topic 47 validation uses **ISO 639-1 + ISO 3166-1 Alpha-2 + ISO 15924**,
minus Google's exclusions — **not** BCP 47 grammar (topic 34). Do not share
validators between the two topics.

Every row below carries a **verified-on** date. An undated entry must not
drive a finding. Re-verify against the Google localized-versions page and the
ISO/Unicode authorities when https://developers.google.com/search/updates
lists a relevant change (proposed cadence: weekly with the topic 35/39
tables).

---

## Snapshot metadata

| Catalogue | Snapshot identity | Authority | Verified-on |
|---|---|---|---|
| ISO 639-1 | language Alpha-2 set used for Google hreflang language subtags | https://www.iso.org/iso-639-language-codes.html (via Google G10) | 2026-09-16 |
| ISO 3166-1 Alpha-2 | region codes used for optional region subtags | https://www.iso.org/iso-3166-country-codes.html (via Google G11) | 2026-09-16 |
| ISO 15924 | script codes (e.g. `Hant`, `Hans`) supported in Google hreflang (G16) | https://www.unicode.org/iso15924/iso15924-codes.html | 2026-09-16 |
| Google exclusions | codes valid in other conventions but rejected or partially ignored by Google | https://developers.google.com/search/docs/specialty/international/localized-versions | 2026-09-16 |

Full code lists change slowly. The product must load codes from a dated
snapshot module (or this table's companion data), never from an undated
hardcoded list embedded in a detector.

---

## Google exclusions (dated — required for findings)

| Code / pattern | Treatment | Source | Verified-on |
|---|---|---|---|
| `es-419` | unsupported by Google despite valid BCP 47 | G15 | 2026-09-16 |
| region `EU` | reserved; Google ignores that portion | G14 | 2026-09-16 |
| region `UN` | reserved; Google ignores that portion | G14 | 2026-09-16 |
| region `UK` | reserved; use `GB` (`en-UK` → `en-GB`) | G13, G14 | 2026-09-16 |

---

## ISO 639-1 language subtags (Alpha-2) — snapshot excerpt

Verified-on: **2026-09-16**. Language subtag must be ISO 639-1 (G10). This
excerpt is the working set for fixtures and regression; the runtime validator
must use the full Alpha-2 catalogue from the dated snapshot identity above.

| Code | Language (English name) | Verified-on |
|---|---|---|
| `aa` | Afar | 2026-09-16 |
| `af` | Afrikaans | 2026-09-16 |
| `am` | Amharic | 2026-09-16 |
| `ar` | Arabic | 2026-09-16 |
| `az` | Azerbaijani | 2026-09-16 |
| `be` | Belarusian | 2026-09-16 |
| `bg` | Bulgarian | 2026-09-16 |
| `bn` | Bengali | 2026-09-16 |
| `bs` | Bosnian | 2026-09-16 |
| `ca` | Catalan | 2026-09-16 |
| `cs` | Czech | 2026-09-16 |
| `cy` | Welsh | 2026-09-16 |
| `da` | Danish | 2026-09-16 |
| `de` | German | 2026-09-16 |
| `el` | Greek | 2026-09-16 |
| `en` | English | 2026-09-16 |
| `es` | Spanish | 2026-09-16 |
| `et` | Estonian | 2026-09-16 |
| `eu` | Basque | 2026-09-16 |
| `fa` | Persian | 2026-09-16 |
| `fi` | Finnish | 2026-09-16 |
| `fr` | French | 2026-09-16 |
| `ga` | Irish | 2026-09-16 |
| `gl` | Galician | 2026-09-16 |
| `gu` | Gujarati | 2026-09-16 |
| `he` | Hebrew | 2026-09-16 |
| `hi` | Hindi | 2026-09-16 |
| `hr` | Croatian | 2026-09-16 |
| `hu` | Hungarian | 2026-09-16 |
| `hy` | Armenian | 2026-09-16 |
| `id` | Indonesian | 2026-09-16 |
| `is` | Icelandic | 2026-09-16 |
| `it` | Italian | 2026-09-16 |
| `ja` | Japanese | 2026-09-16 |
| `ka` | Georgian | 2026-09-16 |
| `kk` | Kazakh | 2026-09-16 |
| `km` | Khmer | 2026-09-16 |
| `kn` | Kannada | 2026-09-16 |
| `ko` | Korean | 2026-09-16 |
| `lo` | Lao | 2026-09-16 |
| `lt` | Lithuanian | 2026-09-16 |
| `lv` | Latvian | 2026-09-16 |
| `mk` | Macedonian | 2026-09-16 |
| `ml` | Malayalam | 2026-09-16 |
| `mn` | Mongolian | 2026-09-16 |
| `mr` | Marathi | 2026-09-16 |
| `ms` | Malay | 2026-09-16 |
| `mt` | Maltese | 2026-09-16 |
| `my` | Burmese | 2026-09-16 |
| `ne` | Nepali | 2026-09-16 |
| `nl` | Dutch | 2026-09-16 |
| `no` | Norwegian | 2026-09-16 |
| `pa` | Punjabi | 2026-09-16 |
| `pl` | Polish | 2026-09-16 |
| `pt` | Portuguese | 2026-09-16 |
| `ro` | Romanian | 2026-09-16 |
| `ru` | Russian | 2026-09-16 |
| `si` | Sinhala | 2026-09-16 |
| `sk` | Slovak | 2026-09-16 |
| `sl` | Slovenian | 2026-09-16 |
| `sq` | Albanian | 2026-09-16 |
| `sr` | Serbian | 2026-09-16 |
| `sv` | Swedish | 2026-09-16 |
| `sw` | Swahili | 2026-09-16 |
| `ta` | Tamil | 2026-09-16 |
| `te` | Telugu | 2026-09-16 |
| `th` | Thai | 2026-09-16 |
| `tr` | Turkish | 2026-09-16 |
| `uk` | Ukrainian | 2026-09-16 |
| `ur` | Urdu | 2026-09-16 |
| `uz` | Uzbek | 2026-09-16 |
| `vi` | Vietnamese | 2026-09-16 |
| `zh` | Chinese | 2026-09-16 |

Codes absent from this excerpt but present in the ISO 639-1 Alpha-2 catalogue
remain valid once the full dated snapshot is loaded. Do not reject unknown
Alpha-2 codes solely because they are missing from this excerpt.

---

## ISO 3166-1 Alpha-2 region subtags — snapshot excerpt

Verified-on: **2026-09-16**. Optional region must be ISO 3166-1 Alpha-2 (G11),
except Google exclusions above.

| Code | Name | Verified-on |
|---|---|---|
| `AE` | United Arab Emirates | 2026-09-16 |
| `AR` | Argentina | 2026-09-16 |
| `AT` | Austria | 2026-09-16 |
| `AU` | Australia | 2026-09-16 |
| `BE` | Belgium | 2026-09-16 |
| `BR` | Brazil | 2026-09-16 |
| `CA` | Canada | 2026-09-16 |
| `CH` | Switzerland | 2026-09-16 |
| `CL` | Chile | 2026-09-16 |
| `CN` | China | 2026-09-16 |
| `CO` | Colombia | 2026-09-16 |
| `CZ` | Czechia | 2026-09-16 |
| `DE` | Germany | 2026-09-16 |
| `DK` | Denmark | 2026-09-16 |
| `ES` | Spain | 2026-09-16 |
| `FI` | Finland | 2026-09-16 |
| `FR` | France | 2026-09-16 |
| `GB` | United Kingdom | 2026-09-16 |
| `GR` | Greece | 2026-09-16 |
| `HK` | Hong Kong | 2026-09-16 |
| `HU` | Hungary | 2026-09-16 |
| `ID` | Indonesia | 2026-09-16 |
| `IE` | Ireland | 2026-09-16 |
| `IL` | Israel | 2026-09-16 |
| `IN` | India | 2026-09-16 |
| `IT` | Italy | 2026-09-16 |
| `JP` | Japan | 2026-09-16 |
| `KR` | Korea (Republic of) | 2026-09-16 |
| `MX` | Mexico | 2026-09-16 |
| `MY` | Malaysia | 2026-09-16 |
| `NG` | Nigeria | 2026-09-16 |
| `NL` | Netherlands | 2026-09-16 |
| `NO` | Norway | 2026-09-16 |
| `NZ` | New Zealand | 2026-09-16 |
| `PH` | Philippines | 2026-09-16 |
| `PL` | Poland | 2026-09-16 |
| `PT` | Portugal | 2026-09-16 |
| `RO` | Romania | 2026-09-16 |
| `RU` | Russian Federation | 2026-09-16 |
| `SA` | Saudi Arabia | 2026-09-16 |
| `SE` | Sweden | 2026-09-16 |
| `SG` | Singapore | 2026-09-16 |
| `TH` | Thailand | 2026-09-16 |
| `TR` | Türkiye | 2026-09-16 |
| `TW` | Taiwan | 2026-09-16 |
| `UA` | Ukraine | 2026-09-16 |
| `US` | United States of America | 2026-09-16 |
| `VN` | Viet Nam | 2026-09-16 |
| `ZA` | South Africa | 2026-09-16 |

---

## ISO 15924 script codes — Google-relevant snapshot

Verified-on: **2026-09-16**. Google documents support for script codes such as
`zh-Hant`, `zh-Hans`, `zh-Hans-US` (G16). A hardcoded language+region list that
rejects these is wrong.

| Code | Script | Verified-on | Notes |
|---|---|---|---|
| `Hans` | Han (Simplified variant) | 2026-09-16 | e.g. `zh-Hans`, `zh-Hans-US` |
| `Hant` | Han (Traditional variant) | 2026-09-16 | e.g. `zh-Hant` |
| `Latn` | Latin | 2026-09-16 | permitted where declared |
| `Cyrl` | Cyrillic | 2026-09-16 | permitted where declared |
| `Arab` | Arabic | 2026-09-16 | permitted where declared |

Other ISO 15924 codes are valid script subtags once present in the dated
full snapshot; do not invent a deny-list.

---

## Special literal (not an ISO code)

| Value | Treatment | Verified-on |
|---|---|---|
| `x-default` | permitted literal; no language semantics (G20) | 2026-09-16 |

---

## Review cadence

Same as the topic 35 requirement table and topic 39 deprecation table:
**weekly** pass against https://developers.google.com/search/updates, then
spot-check ISO/Unicode pages if Google's localized-versions guidance changed.
Flag any table row whose authority page last-updated date is later than
verified-on before raising findings from it.
