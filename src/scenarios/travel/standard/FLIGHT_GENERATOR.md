# FLIGHT GENERATOR

## Objective

This document defines and explains the Flight Search and routing strategy, as I (author of this project) intended.

The goal is NOT precision, accuracy, or efficiency in finding "best paths". There's no need for an optimization here, it is more important for search to be fast, simple, and the generated routes should "look" realistic, even if real-world path would use different airports and layovers for an itinerary you (reader, contributor) would know well.

## Design

- Every airport has an internal category (regular, isolated, regional, hub)
  - Isolated are cases where the airport doesn't receive civilian flights (military, scientific missions)
  - Regional are small airports, served by few domestic airlines
  - Hubs are larger or strategically placed airports that serve as connection steps for longer flights.
  - You can see a map of all airports at the generated file ./airports-map.html
- Every airport has a predetermined list of airlines that serve it.
  - This serving can be regional, meaning it is a domestic flight; or non-regional, intended to serve a connection to a hub.
- A direct flight between two airports is possible if and only if they are both served by the same airline, one or more airline being available.
- Hubs are only guaranteed connected transitively, not pairwise-direct.
  - build-db.ts links each hub to airlines whose headquarters sit within a distance threshold (MAX_HUB_RANGE_KM ≈ 6000 km). Two hubs on opposite sides of one HQ's range can end up ~12,000 km apart via that HQ.
  - Isolated hub clusters (e.g. HNL in the Pacific) get one intentional bridge edge with no distance check, purely to keep the hub graph connected.
  - Path-finding must therefore consider multi-hop hub traversals, not assume every hub pair has a direct airline link.
- Aircraft performance is not an input to flight time.
  - Aircrafts are chosen by category related to the edges.
- Flights for the past are not possible.
  - Flights for the current day start at 6 hours to the future (using epoch time) at minimum, related to starting airport.

## Nomenclature:

A Flight (edge) has an airport (node) departure and another airport (node) arrival. A simple edge for a pair of nodes.

A Route is a list of ordered Flights, leading from a departure node to an arrival node. It can be empty, it can contain only one Flight if a direct path is available, or it can contain a sequence of Flights that must be taken in order to reach the destination - many edges until the final node; so each of those edges will be served by a Flight.

When a user is "searching for flights", it is actually searching for a collection of Routes that can serve the intended departure to arrival.

## Search Flow:

The algorithm follows this process:

- Path flow: decide possible paths, primarily by counting airline edges along nodes.
  - "Return flight" logic just reverses edge list, same edge choices.
- Time flow: enrich route collection with more routes varying over departure times.
- Equipment generation: enrich all Flights with airline, aircraft, flight number
- Seat offering: enrich all Flights with seats availability
- Pricing: enrich all Flights with booking prices
- Normalization:
  - Ensure Route metadata is consistent with Flight's list (times, distance, prices, available seats)
  - Trim final routes, weight airline distribution.

## Path Flow

When a request is made from a Departure to an Arrival, the algorithm follows:

### Direct Regional Flights

- If both departure and arrival are served by the same airline on a regional edge, enlist every such airline as a direct routing.
  - Response array will be a list of Routes, each one containing one Flight.

### Hub-Based Routing (No Direct Flight)

- Isolated airports (military, scientific) return no results.
- Reduce departure and arrival airports to hub "gateways" — a hub + the sequence of connector flights to reach it:
  - **Regional airport**: find the nearest 1–2 standard (non-hub, non-regional) airports reachable via regional edges; recursively reduce each to a hub (or connect directly to one if it's close enough).
  - **Standard airport**: connect to the nearest hub via any airline serving both.
  - **Hub airport**: use itself as the gateway (zero connector flights).
- Find hub-to-hub paths:
  - Use BFS on the hub graph to find shortest paths (fewest hops).
  - Restrict edges to ≤ 7000 km (hubs aren't pairwise-direct; isolated clusters like HNL have long bridge edges needed for connectivity, but prefer shorter alternatives when available).
  - If no path exists under 7000 km, fall back to the unrestricted graph (so bridged clusters remain reachable).
  - Each hub-to-hub hop uses one airline serving both hubs (randomly selected from available).
- Concatenate: departure connectors + hub path + arrival connectors.
- For each valid starting-hub and ending-hub pair, generate one route per airline combination across all hub legs — every combination found, not a sampled subset.
- Response array is a list of Routes, each containing an ordered Flight[] from departure to arrival, capped at a hard safety limit of 1000 (MAX_ROUTES) that a normal search should never come close to hitting. Trimming down to a presentable size is a later Normalization concern.

## Route Normalization

After a valid Flight[] sequence is built (direct or via hub path), aggregate Flight metadata into the Route level:

- `flightTimeHours`: sum across all legs.
- `flightDistanceKms`: sum across all legs.
- `departure` / `arrival`: inherit from first and last Flight respectively.
- `available` (seats): minimum across all legs (a 0-seat leg blocks the whole route).
- `price`: sum across all legs.
- `pricing`: per currency, the cheapest bookable fare (regular or economy, whichever is lower) on each leg, summed across legs, exposed as a `minimum` field (not a specific seat class — a Route can't promise one class end-to-end when legs may not all sell it). Only currencies every leg actually offers are included, same rule as `available`.
  - `pricing[].available` intentionally reuses the same whole-plane-pool minimum as the Route's own `available`, not the (smaller) per-class pool of whichever class actually won each leg's `minimum` fare. This is a deliberate simplification: it's a browsing figure ("this flight has 45 seats"), not a guarantee that all 45 are bookable at the quoted minimum price — a real travel agent would still show the full plane count here even if the cheap fare only covers a handful of them. A user wanting to book more seats than the cheap-fare class holds would need to redo the search with stricter params; that refinement isn't modeled in this project.

## Time Flow

Enriches each Route already produced by Path Flow with realistic departure/arrival timestamps. Time Flow does not add or remove Routes — it only takes the given collection and spaces out first-leg departure times across it; trimming/weighting the collection is a later concern (see Normalization).

### Flight Duration

- Distance is the primary input: assume a fixed reasonable cruise velocity (e.g. ~800 km/h) and derive a base duration per leg from `flightDistanceKms`.
- Apply a small random delta (e.g. ±5–10%) per leg, independently, so identical-distance legs don't produce identical durations.
- Aircraft performance remains irrelevant to timing (see Design) — the delta is flavor noise, not a simulated performance difference.

### Connection Time

- Between consecutive legs of a Route, insert a layover:
  - **Non-hub edges** (regional/standard connectors): 30–180 minutes.
  - **Hub edges**: 4–7 hours, reflecting the longer-haul nature of hub-to-hub hops.
- Layover duration is randomized per connection within its range, added between the arrival of one leg and the departure of the next.

### Departure Windows & Availability

- Flights in the past are never offered.
- If the search date is the current day, the earliest valid departure is 6 hours from the current time (per airport-local clock).
  - If that 6-hour floor falls past the end of the current day's departure schedule (last slot before midnight), no current-day flights are offered — the earliest available departures roll over to the next day's full schedule instead.
- If the search date is a future day, the earliest valid departure is 5AM local, with no further time-of-day restriction — 5AM is just a floor, not a rigid slot start.

### Departure Time Assignment

- Time Flow assigns each Route in the given collection a first-leg departure time, spaced out across the valid departure window for that day (from whichever floor applies — 5AM, or the 6-hour-from-now floor on the current day — per the Departure Windows & Availability rules above) — it does not generate additional Routes to fill out the day.
- Spacing is distributed roughly evenly across the Route collection's size, so a small collection gets widely-spaced departures and a large one (e.g. a long-haul edge with many candidate Routes) gets tighter spacing, rather than a fixed slot count.
- Once a Route's departure time is assigned, its subsequent leg timestamps follow from Flight Duration and Connection Time above, applied sequentially from that departure onward.

### Timestamp Presentation

- All Flight timestamps are computed and stored local to their airport (departure time local to the departure airport, arrival time local to the arrival airport).
- Timestamps are presented with explicit UTC offset info (e.g. ISO 8601 with offset) rather than converted to a single shared timezone, so two legs in the same Route may carry different offsets.

## Equipment Generation

Each Flight is assigned an aircraft from the `aircraft` reference table (see TRAVEL.md), driving both `travelInfo.aircraft`/`available` and, indirectly, the flight number:

- **Aircraft size** is picked from the leg's departure/arrival airport categories (see Design):
  - Either airport is **regional** → a random **small** aircraft.
  - Both airports are **hubs** (hub-to-hub leg) → a random **large** aircraft.
  - Anything else (regular airports, regular-to-hub feeders) → a random **medium** aircraft.
- `travelInfo.aircraft` is formatted as `"Manufacturer Model"` (e.g. `"Boeing 737"`) from the chosen aircraft row.
- `travelInfo.flightNumber` follows the format `"CC XXAAXAA"`: the airline's two-letter IATA code, a space, then two random letters, two random digits, one random letter, and two random digits.

## Seat Offering

Each Flight is assigned an `available` seat count and a set of cabin classes it sells, both derived at generation time (`makeFlight()`):

- `available` is a random integer in `[10, aircraft.capacity]` — bounded above by the chosen aircraft's capacity, but not fixed to it, so identical aircraft don't always report a full plane.
- Cabin classes come from `pickSeatClasses(airline)`: `regular` is always offered; if the airline has `hasEconomyClass`, `economy` is added; `businessClass` and `firstClass` are added individually per the airline's corresponding flags. `SeatClass` is `'regular' | 'economy' | 'businessClass' | 'firstClass'`.
- There is no per-class seat pool split at generation time — every offered class on a Flight is sold against the same `available` count rather than a fraction of it. Splitting `available` across classes realistically is a Normalization concern (see below).

## Pricing

Each Flight is assigned a per-class, per-currency price table, derived from distance (`classBasePriceUsd()` and `makePricing()` in `generator.ts`):

- Base USD price per seat class: `max(flightDistanceKms * BASE_PRICE_PER_KM_USD, MIN_BASE_PRICE_USD)` (`BASE_PRICE_PER_KM_USD = 0.12`, `MIN_BASE_PRICE_USD = 35`), with independent ±`PRICE_JITTER_RATIO` (0.15) jitter per class.
- The base price is scaled per seat class by `SEAT_CLASS_PRICE_MULTIPLIER`: `regular` 1x, `economy` 0.7x, `businessClass` 2.5x, `firstClass` 4.5x.
- Currencies offered per Flight are USD plus the departure airport's `localCurrency` (deduped if they're the same). Non-USD amounts are converted via `convertFromUsd()` (`currency.ts`), which reads a rate from `src/scenarios/travel/currency_rates.csv`; if a currency has no listed rate, the USD amount is used unconverted as a fallback.
- The result is one `FlightPricing` entry per (seat class × currency) combination actually offered on that Flight.
- The legacy flat `Flight.price` field is `derivePrice()`: the USD price of the cheapest tier available on the Flight, walking `PRICE_TIER_ORDER = ['regular', 'economy', 'businessClass', 'firstClass']`.
- Loyalty points are not implemented as a pricing currency: `Airline.hasLoyaltyProgram` exists as a data field (DB/CSV/types) but is not consumed anywhere in generation.

## Normalization

Route-level aggregation (the numbers described in "Route Normalization" above — `flightTimeHours`, `flightDistanceKms`, `departure`/`arrival`, `available`, `price`, `pricing`) already happens inline during route grouping (`groupRoutes()` / `aggregateRouteMinimumPricing()`), not as a distinct later pass. Two more Normalization steps run on the `Flight[][]` sequence collection after Time Flow, before it's grouped into `Route[]` (`applyNormalization()` in `generator.ts`):

### Airline Distribution Weighting

Not every airline combination Path Flow finds is worth presenting — full diversity produces near-duplicate routes that only differ in which of a dozen carriers flew one leg. `applyAirlineWeighting()` trims this per hub-to-hub edge, independently — never across the whole route collection. That's a deliberate correction from an earlier collection-wide-cap design: a long multi-hop route (several hub-to-hub legs) could get every one of its legs squeezed into one shared budget and end up with zero surviving combinations, even though each individual leg still had plenty of options. Deciding per edge means a leg is never emptied out, so path existence (once Path Flow found one) always survives weighting.

- **Scope**: only hub-to-hub legs are considered. Connector legs (regional, or standard→hub) are left untouched entirely — their airline pool is already small (`reduceToHub` picks from a handful of candidates, not a combination).
- **Per edge** (one hub→hub from/to pair): if it's served by more than 5 distinct airlines, keep only the top 3 by route-representation and the bottom 3 — a few dominant carriers, a few long-tail ones, deliberately not a smooth middle sample. That's always at least 6 survivors whenever trimming happens at all; an edge at or under 5 airlines is left untouched.
- **Premium-only retention**: every premium-only carrier present on the edge (no `regular`/economy tier at all — sells strictly first/business, e.g. NV/B0) is added back in regardless of whether it made the top/bottom cut. These are rare and deliberately educational, so this stage must never be the reason one goes missing — unlike a merely premium but mixed-cabin carrier (e.g. one that also sells regular seats), which has no such guarantee and can be trimmed normally. A later stage (Route Collection Trimming, below) can still legitimately drop one.
- **Route removal**: a Route (`Flight[]` sequence) is dropped if any hub-to-hub leg lost its airline on this pass. Connector legs never disqualify a route, since they're never trimmed.

### Per-Class Seat Pool Splitting

`applySeatClassSplit()` carves each Flight's single `available` pool into a per-class figure instead of every offered class sharing the full count:

- Weights are fixed regardless of which classes an airline offers: `firstClass` 1, `businessClass` 2, `regular` 6, `economy` 7. An airline missing a class (e.g. `hasRegularClass: false`, see the `Airline` type in TRAVEL.md) simply never contributes that weight — the classes it does offer still split proportionally among just themselves, not against a 16-share denominator that assumes all four exist.
- Split via floor + largest-remainder so the per-class parts sum back to exactly the Flight's `available` rather than drifting from independently rounding each share.
- Every offered class keeps at least 1 seat (when `available > 0`), even if its weighted share would round to 0 — a class with `SeatClass` pricing is never advertised as sold out purely from rounding. If enforcing that floor pushes the total over `available` (many offered classes on a very small pool), the excess is clawed back from the lowest-weighted classes first, so premium cabins keep their seat over regular/economy.
- Flight-level `available` (the aircraft pool used by Route aggregation's per-leg minimum) is untouched — only the per-class figures on each `FlightPricing` row change. All currency rows for the same class on a Flight get the same split count, since the pool is per-class, not per-currency.
- Runs after Airline Distribution Weighting and before Route Collection Trimming, in `applyNormalization()`.

### Route Collection Trimming

`MAX_ROUTES` (1000, in Path Flow) is only a hard safety cap on generation, not a realistic result-set size. After Airline Distribution Weighting and the seat-class split, `applyNormalization()` samples the collection down to `MAX_PRESENTED_ROUTES` (50) per direction if it's still over that size — picked uniformly at random rather than by any ranking, so the surviving departures keep an uneven scatter across Time Flow's window as a side effect, instead of the artificial clustering a "keep the first/earliest N" trim would produce. A collection already at or under 50 after weighting is left untouched.
