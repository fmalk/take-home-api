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
- Hubs are only guaranteed connected transitively, not via a single direct edge using one airline only.
  - No single airline can traverse all hubs.

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

- If a direct, regional flight is possible, enlist every possible airline as direct routing.
  - Response array will be a list of Routes, each one will contain one available Flight.
- If no direct flight possible:
  - At least one Hub Airport will be used for path finding.
  - If departure airport is regional:
    - Find one regional flight connecting it to a close regular airport. Try finding another secondary regular airport.
  - If departure airport is regular:
    - Decide a close starting Hub airport.
    - Find all possible connections to that Hub.
  - If departure airport is already a Hub, use it as the starting Hub.
  - Repeat those steps for the arrival airport. Decide the destination Hub.
  - Find at most three possible path from starting Hub to destination Hub.
    - We use BFS path finding for Hubs, there's only a few Hubs so searching is fast.
  - Concatenate starting edges, hub edges, and destination edges.
  - Response array will be a list of Routes, each one containing a valid list of ordered Flights.

## Time Flow

To be determined.

## Seat Offering

To be determined.

## Pricing

To be determined.