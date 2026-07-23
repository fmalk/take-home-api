# take-home-api

[![Docker Publish](https://github.com/fmalk/take-home-api/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/fmalk/take-home-api/actions/workflows/docker-publish.yml)
[![Release Please](https://github.com/fmalk/take-home-api/actions/workflows/release-please.yml/badge.svg)](https://github.com/fmalk/take-home-api/actions/workflows/release-please.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/fernandopj/take-home-api)](https://hub.docker.com/r/fernandopj/take-home-api)
[![GitHub release](https://img.shields.io/github/v/release/fmalk/take-home-api)](https://github.com/fmalk/take-home-api/releases)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/fmalk/take-home-api/blob/main/LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)

A ready-made, well-designed REST API mimicking many **real world scenarios**.

Each scenario models a realistic business domain — e-commerce, airline booking, food delivery, banking ledger, show tickets, scheduling appointments — fully implemented and served out of the box. No backend to design, no server to write. Just a real API with a friendly, well-documented flow, ready to run.

Every scenario goes from /api/v1 with simple definitions and endpoints, up to /api/v4 with harder constraints, complex schemas and stricter flows. Use a version better suited for your intended usage.

Doesn't need other containers to run. Uses SQLite and in-memory storage.

## Why

Most "coding challenge" and "system design" tools ask you to build a backend from scratch. This one flips that: the API already exists, fully working, and you learn by **using** it.

That's a closer match to a lot of real engineering work — consuming an API you didn't design, understanding its data model, and building something on top of it.

## Why #2

At an old job, I used this concept for junior/internship hiring and training: show them a very close to real API with our customer scenarios, how would they use it? What modifications would they do? What endpoints do they miss?

We would use those as input to Take Home Coding challenges. We were a mobile-focused company, so consuming API was essential to the job, for everyone. Exposing developers to it was very rewarding.

## What you can do with it

1. **Build a frontend** against a well-modeled, realistic API.
2. **Learn how a REST API works** by following real use-case flows.
3. **Write integration tests** against a live, realistic target.
4. **Take Home assessments**: go to /docs to check how to use the API.
5. *Near-Future*: use the provided MCP server for your AI agents.

Inspirations

Some fake/mock APIs are very well known. This project serves a similar purpose:

- https://jsonplaceholder.typicode.com
- https://fakestoreapi.com
- https://dummyjson.com
- https://reqres.in — the closest in scope

However, this project aim for a much more robust API flow and usage, and more complex but well understood real world applications.

## Scenarios

Each scenario is a self-contained API namespace, versioned by how much of the domain it covers — not just difficulty:

```
/api/travel/v1 → core happy path
/api/travel/v2 → small surface, few more use cases, authentication for some endpoints
/api/travel/v3 → richer surface, dozend endpoints to cover, permission considerations, edge cases
/api/travel/v4 → aimed at a deeper understanding of real-world edge cases and complex data management
```

Every scenario ships with an OpenAPI/Swagger spec and a set of static reference data (cities, airports, products, venues, etc.); transactional data (flights, bookings, schedules, prices) is generated on-the-fly per request. Cache storage can remember sessions for a limited time, to allow real, stateful data: IDs, shop carts, temporary reserved seats, date restrictions.

## Getting started

You can run the API via public docker image:

```bash
docker pull fernandopj/take-home-api
docker run -d --name take-home-api -p 3000:3000 fernandopj/take-home-api
```

Or you can build locally:

```bash
git clone https://github.com/fmalk/take-home-api.git
cd take-home-api
docker build -t take-home-api .
docker run -d --name take-home-api -p 3000:3000 take-home-api
```

## Disclaimer

- This project claims **no responsibility for information correctness, completeness and/or accuracy**
- **All generated data is mocked**, there's no correlation to any real case, be it past, present or future.
  - Generated data is all computed on the fly, meant for **educational and training purposes only**.
- Any real world data used, such as names and cities, may be used by this project if it is vastly understood public information, and such use is meant to help comprehension about the domain, in a **fair use** context.
  - Even if public information, they may be copyrighted work and trademarks, which this project means to respect.
- Real companies logos, liveries, designs, particular UI such as websites or screens, are all avoided by this project.
- Emoticons, emojis, icons, typography, if used by this project must be generally available under a well understood public fair use.

## Project scope

This repository is the reference API service only: one TypeScript / Node.js service hosting all scenarios, distributed via Docker, with detailed execution logs as a first-class feature.

Evaluation, scoring, reporting, a UI, and any hosted/SaaS offering are explicitly out of scope here — those belong to a separate downstream project that consumes this API and its logs.
