# TRAVEL

## Considerations

- Airport names, codes, locations, and other related metadata are real (best effort)
  - Airport names and related info are used solely as fictional data for educational purposes. **This project is not affiliated with or endorsed by any airport administration, public or private**.
- Airline names, codes, and other related metadata are fictional; this was to allow the project to adjust edge cases, considerations, rules and constraints that has no bearing to the real world counterparts;
  - Real airlines names are presented as files that can be loaded; default are fictious names
  - Airline names are used solely as fictional data for educational purposes. **This project is not affiliated with or endorsed by any airline**.
  - Logos are intentionally generated placeholder monograms rather than reproductions of airline trademarks.
- Airport and Airlines metadata are conceptual choices, made for educational purposes and to better illustrate real-world cases.
- CSV files in this repository are for informational purposes; they contain real world information, readily available public information.
  - This project claims **no responsibility for information correctness**
  - Metadata around them are fictional.
- **All generated flight data is mocked**, there's no correlation to any real past, present or future flight.
- The three main travel CSV files are the source of truth, read-only by the engine. The `travel.sqlite` is buildable from the CSV files, and the runtime uses it also as read-only.

## Validations

Pay attention to scenario constraints:

- IATA codes as primary keys, not UUIDs;
- Distances in kilometers;
- Flight "numbers" may have letters;
- IATA and ICAO codes are not similar or substrings;
- Country names and ISO codes for sovereign states are not intuitive;
- Dates and times are local, with UTC offset shown;
- Unicode characters;
- Layovers - a route may take many flights until destination;
- Arrival dates advancing a day or more;

## Edge Cases

In advanced scenarios, look out for:

- Cities with the same name, same country;
- UTC Offsets can be decimal (half-hours, quarter-hours);
- Arrival dates regressing a day;
- Classes of seats;
- Alternative currencies;
- Zero seats in a class;
- Airports with zero airlines serving them;
- Loyalty points as currency;

## SQLite Build

`npm run db:build:travel` parses `airports.csv`, `fictional_airlines.csv`, and `real_airlines.csv` into `travel.sqlite` (checked in, alongside the CSVs it's derived from). Tables:

- `airports` — one row per airport CSV row, keyed by IATA code (ICAO is unique-indexed).
- `airlines` — both fictional and real rosters in one table, keyed by IATA code (ICAO unique-indexed), flagged by `is_real`.
- `airport_airlines` — assumed airline coverage per airport (not sourced from anywhere real).
  - Each airport is linked to a few airlines, with busier airports (by `passengers_monthly`) getting more coverage.
  - Assignment is deterministic, so rebuilding the database is reproducible.

## References

Airports information: https://www.world-airport-codes.com/alphabetical/airport-code Airlines information: https://en.wikipedia.org/wiki/Lists_of_airlines Biggest airports by passengers information: https://www.bigairports.com/data/
