# Project Brief

> Condensed summary of `original-chat-conversation.md`, structured as working context for AI sessions. Source is a brainstorming chat that turned a keyword research question into a product concept.

## The Concept

A **ready-made, well-designed REST API** that models a realistic business scenario, meant to be **consumed** — not built. The API ships fully developed from the start; users don't design or implement the backend. Instead they learn by _using_ it in a friendly, easy-to-follow way.

Three main ways to learn from it:

1. **Build a frontend** against a well-modeled real-world scenario, consuming the provided API.
2. **Learn how a REST API works** by following its use cases / flows.
3. **Write your own integration tests** to learn how to do integration testing.

**Origin.** It comes from an in-house recruiting application the author built at a previous (mobile-focused) job, where consuming APIs was central to the work. Candidates were given a take-home API with an easy-to-follow flow so they could understand the team's environment and come up with their own frontend scenarios against it. That proven, hands-on "consume a realistic API" experience is the seed of this project.

## Positioning

Avoid branding as an "interview platform" or "API playground" (the latter reads as Swagger/Postman tooling to developers). Instead position as a **realistic, well-modeled reference API to consume and learn from** — a hands-on learning sandbox rather than a coding-test gauntlet. That framing serves multiple audiences and creates a stronger moat:

- Companies → take-home / assessment for API-consuming roles (frontend, mobile)
- Developers → practice consuming a real API, building a frontend, writing tests
- Instructors/bootcamps → teaching REST API usage and integration testing
- AI coding agents → a stable, realistic API target for evaluation
- Conferences → workshops

Recruiting/assessment use becomes _one application_ built on a widely-adopted reference API, not the product itself.

## Go-to-Market Strategy (OSS-first funnel)

Ship as an **open-source GitHub project** (TypeScript) with a public **Docker image**. OSS is the marketing engine — developers spin up the reference API and try it themselves before HR is ever involved, sidestepping the trust barrier of a new assessment tool.

Funnel: GitHub project → developers discover → use it to learn / build against → team adopts it for take-homes → need records of use, collaboration, history → upgrade to SaaS.

**Keep the OSS version complete — do not cripple it.** `docker run yourproject` should immediately give: the fully-working reference API, an easy-to-follow use-case flow, Swagger/OpenAPI docs, seed data (static reference vocab like cities/airports; transactional data is generated on request — see `CLAUDE.md`), automatic reset, and a README. The value is a realistic API you can consume right away.

### Offerings (not a split — same product, different delivery)

The OSS _is_ the product; the SaaS is a convenience layer on top. There is no crippled/complete divide — the same API is available three ways:

1. **OSS source + Dockerfile** — the canonical offering. Clone the repo, build the container, self-host. Fully-featured and free.
2. **OSS API hosted on a real server** — the same open-source API, run by us on a public instance so people can try it with zero setup. Free-usage terms (rate limits, fair-use) to be decided later.
3. **SaaS — a no-touch, ready-to-use evaluation environment.** For people who want to _keep records of usage_ (e.g. interviews and take-home tests): provisioned instances, candidate/session tracking, history, and reporting. The SaaS sells convenience and record-keeping, not access to the API itself.

## Scenarios

Example domains: e-commerce, airline booking, food delivery, banking ledger, show tickets, appointments.

Each scenario provides: a set of endpoints, a data model, business rules and use-case flows, an OpenAPI/Swagger spec, and seed data (its static reference vocabulary — cities, airport/airline codes, etc.) — everything needed to _consume_ the API.

**Versioned by API surface within the same business domain.** The version number reflects how much of the domain the API covers, not a candidate's seniority:

- `/api/travel/v1` → a smaller API: fewer endpoints/methods and fields, covering the core happy path.
- `/api/travel/v4` → a richer API: more endpoints and fields, covering more cases and edge conditions.

Same domain, growing surface area. Consumers can start on a v1 and graduate to a higher version as they get comfortable, and evaluators can pick a version that matches the depth they want to test.

## Architecture

**Scope of this project:** a single backend service that hosts the reference APIs. Everything downstream (evaluation, scoring, reporting, UI, SaaS) is explicitly _out of scope_ — see "Out of scope" below.

- **One service, many scenarios.** Each scenario is a self-contained API mounted under its own namespace, e.g. `/api/travel/v1`, `/api/ecommerce/v2`. Adding a scenario means adding a new namespace module, not a new service.
- **All TypeScript.** A plain **vanilla Node.js** HTTP service — no heavy framework required to start.
- **Run via a CLI.** The service is started from a simple command-line entry point. A process manager like `pm2` is likely overkill for now; keep the runner minimal.
- **Docker-first distribution.** Ship a `Dockerfile` and publish a public image to **Docker Hub** so anyone can `docker run` the reference API with zero setup.
- **Detailed execution logs are a core requirement.** The engine must write thorough, structured logs of every request/response and use-case flow. These logs are what a future evaluation layer would consume, so they matter from day one.
- **Composition-first TypeScript.** Since scenarios share most of their API shape (schemas, request/response types) across versions, define the shared piece once per scenario and compose per-version overrides with spread, generics, and utility types (`Partial`/`Pick`/`Omit`) rather than duplicating it per version. Full policy lives in `CLAUDE.md`.

### Out of scope (a future project that _consumes_ this one)

Evaluator, scoring, reporting, UI, and the SaaS layer are **not** part of this project. They belong to a separate, downstream product that would build on top of this service — primarily by consuming its execution logs. Keeping them out now keeps this project focused on being a clean, well-modeled, consumable API.
