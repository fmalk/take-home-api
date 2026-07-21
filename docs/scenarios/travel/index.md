---
title: Travel Scenario
description: Flight search and booking API
---

# Travel Scenario

The Travel scenario simulates an airline booking system. It demonstrates key concepts like search, filtering, authentication, and reservation management across different API versions.

## Overview

The Travel API allows you to:
- Search for flights between cities
- View flight details and pricing
- Make and manage bookings
- Handle user authentication (in v2+)

## API Versions

- **[API v1](/scenarios/travel/v1)** — Simple flight search and basic booking
- **[API v2](/scenarios/travel/v2)** — Authentication, enhanced booking features, more endpoints

Each version builds on the previous, adding more realistic constraints and features. Start with v1 to understand the core flows, then explore v2 for more advanced use cases.

## Static Reference Data

The Travel API uses real reference data for cities, airports, airlines, and aircraft types. This data is pre-loaded and consistent across requests, so you can rely on it for testing and integration.

## Dynamic Data

Flight prices, availability, and booking IDs are generated on-the-fly per request. This gives you realistic data without pre-seeding the database, perfect for testing various scenarios.

## Using the API

Each API version includes an interactive OpenAPI specification. Visit the version pages to explore endpoints, see request/response examples, and try them directly.

All requests use the base path `/api/travel/vX` where `X` is the version number.
