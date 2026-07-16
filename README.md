# take-home-api

A ready-made, well-designed REST API mimicking many **real world scenarios**.

Each scenario models a realistic business domain — e-commerce, airline booking,
food delivery, banking ledger, show tickets, scheduling appointments — fully
implemented and served out of the box. No backend to design, no server to
write. Just a real API with a friendly, well-documented flow, ready to run.

## Why

Most "coding challenge" tools ask you to build a backend from scratch. This one
flips that: the API already exists, fully working, and you learn by *using* it.

That's a closer match to a lot of real engineering work — consuming an
API you didn't design, understanding its data model, and building something on
top of it.

## Why #2

At an old job, I used this concept for junior hiring and training: show them a very close to real API with our customer scenarios, how would they use it? What modifications would you do?

We would use those as input to Take Home Coding challenges. We were a mobile-focused company, so consuming API was essential to the job, for everyone. Exposing developers to it was very rewarding.

## What you can do with it

1. **Build a frontend** against a well-modeled, realistic API.
2. **Learn how a REST API works** by following real use-case flows.
3. **Write integration tests** against a live, realistic target.

This also makes it a good fit for take-home assessments, teaching REST API
usage in a bootcamp, or as a stable target for AI agent evaluation.

## Scenarios

Each scenario is a self-contained API namespace, versioned by how much of the
domain it covers — not by difficulty:

```
/api/travel/v1 → core happy path
/api/travel/v2 → small surface, few more use cases, authentication for some endpoints
/api/travel/v3 → richer surface, dozend endpoints to cover, permission considerations, edge cases
/api/travel/v4 → aimed at a deeper understanding of real-world edge cases and complex data management
```

Every scenario ships with an OpenAPI/Swagger spec and seed data. Cache storage can remember sessions for a limited time, to allow real, stateful data: shop carts, temporary reserved seats, date restrictions.

## Getting started

You can run the API via docker image locally:

```bash
docker run <image>
```

*(image name and instructions to be added once published to Docker Hub).*

You can also consume it free at:

```bash
https://app.takehome.codes/api
```

*(Open server to be determined later. Throttling limits apply).*

## Project scope

This repository is the reference API service only: one TypeScript / Node.js
service hosting all scenarios, distributed via Docker, with detailed execution
logs as a first-class feature.

Evaluation, scoring, reporting, a UI, and any hosted/SaaS offering are
explicitly out of scope here — those belong to a separate downstream project
that consumes this API and its logs.
