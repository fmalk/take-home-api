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
- Seat offering: enrich all Flights with seats availability
- Pricing: enrich all Flights with booking prices
- Equipment generation: enrich all Flights with airline, plane, flight number
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
- For each valid starting-hub and ending-hub pair, generate up to 3 routes by shuffling airline choice on the first hub leg (subsequent legs follow from connectivity necessity).
- Response array is a list of Routes, each containing an ordered Flight[] from departure to arrival.

## Route Normalization

After a valid Flight[] sequence is built (direct or via hub path), aggregate Flight metadata into the Route level:
- `flightTimeHours`: sum across all legs.
- `flightDistanceKms`: sum across all legs.
- `departure` / `arrival`: inherit from first and last Flight respectively.
- `available` (seats): minimum across all legs (a 0-seat leg blocks the whole route).
- `price`: sum across all legs.
- `pricing`: inherit from the first leg's pricing array (uniform across all legs at present).

## Time Flow

To be determined. Currently all Flights use the query date as both departure and arrival timestamp (no duration modeling).

## Seat Offering

To be determined. Currently all Flights have 0 available seats and a single seat type (regular). Seat availability and cabin classes will be enriched here once modeled.

## Pricing

To be determined. Currently all Flights have $0 price. Pricing per cabin class and dynamic pricing (e.g. by distance, airline, class) will be enriched here once modeled.

## Equipment Generation

To be determined.