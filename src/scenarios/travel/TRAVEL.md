# TRAVEL

## Considerations

- Airport names, codes, locations, and other related metadata are real (best effort)
  - Airport names and related info are used solely as fictional data for educational purposes. **This project is not affiliated with or endorsed by any airport administration, public or private**.
- Airline names, codes, and other related metadata are fictional; this was to allow the project to adjust edge cases, considerations, rules and constraints that has no bearing to the real world counterparts;
  - Real airlines names are presented as files that can be loaded; default are fictious names
  - Airline names are used solely as fictional data for educational purposes. **This project is not affiliated with or endorsed by any airline**.
- CSV files in this repository are for informational purposes; they contain real world information, readily available public information.
  - This project claims **no responsibility for information correctness**
- **All generated flight data is mocked**, there's no correlation to any real past, present or future flight.

## Edge Cases

In advanced scenarios, look out for:

- Cities with the same name, same country;
- IATA and ICAO codes are not similar;
- UTC Offsets can be decimal (half-hours, quarter-hours);
- Unicode characters;
- Arrival dates advancing a day or more;
- Arrival dates regressing a day;

## SQLite Build

`npm run db:build:travel` parses `airports.csv`, `fictional_airlines.csv`, and `real_airlines.csv`
into `travel.sqlite` (checked in, alongside the CSVs it's derived from). Tables:

- `airports` — one row per airport CSV row, keyed by IATA code (ICAO is unique-indexed).
- `airlines` — both fictional and real rosters in one table, keyed by IATA code
  (ICAO unique-indexed), flagged by `is_real`.
- `airport_airlines` — assumed airline coverage per airport (not sourced from anywhere
  real). Each airport is linked to 3-10 fictional airlines (the project default roster),
  with busier airports (by `passengers_monthly`) getting more coverage. Assignment is
  deterministic (seeded per airport IATA code), so rebuilding the db is reproducible.

## References

Airports information: https://www.world-airport-codes.com/alphabetical/airport-code
Airlines information: https://en.wikipedia.org/wiki/Lists_of_airlines
Biggest airports by passengers information: https://www.bigairports.com/data/