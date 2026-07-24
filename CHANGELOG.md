# Changelog

## [0.5.4](https://github.com/fmalk/take-home-api/compare/v0.5.3...v0.5.4) (2026-07-24)


### Features

* seat normalization ([f720933](https://github.com/fmalk/take-home-api/commit/f720933b6c09603b5bd0a681655665f73d5b8d3e))

## [0.5.3](https://github.com/fmalk/take-home-api/compare/v0.5.2...v0.5.3) (2026-07-24)


### Features

* HUB_EDGE_KEEP_TOP/HUB_EDGE_KEEP_BOTTOM raised from 2/2 to 3/3 ([45db147](https://github.com/fmalk/take-home-api/commit/45db147d92b658233afd3e55566e53ca60597262))

## [0.5.2](https://github.com/fmalk/take-home-api/compare/v0.5.1...v0.5.2) (2026-07-23)

### Features

- add airport listing endpoint for travel v1 API ([026d03c](https://github.com/fmalk/take-home-api/commit/026d03c6e453e25dfa8c3cd8bb784986bbcd8758))
- add currency_rates.csv with builder script for exchange rate updates ([b8c1e69](https://github.com/fmalk/take-home-api/commit/b8c1e69fc9cf6c8c54a0c813da61a1a3e26c897a))
- add local_currency column to airports with country-specific currency mappings ([fac06d9](https://github.com/fmalk/take-home-api/commit/fac06d9987ad0ac0ae847a2ee0865bc48bb57cc8))
- automate semver tagging with release-please ([4a9b451](https://github.com/fmalk/take-home-api/commit/4a9b451a8f8408364064ff8ae89e9f6b1c79dc84))
- better tagging and docker push ([38b06ad](https://github.com/fmalk/take-home-api/commit/38b06ad89768e08130f80e021c8f65f210295200))
- bootstrap reference API with Fastify and travel/v1 scenario ([2002367](https://github.com/fmalk/take-home-api/commit/2002367aaed0eda513097666a895eba44f5b957c))
- generate flight equipment info from aircraft reference data ([d0db6bf](https://github.com/fmalk/take-home-api/commit/d0db6bfa3f4682eed17c81ffaff8cd85a4a78a2f))
- generate routes for every airline combination across all hub legs ([ebc4799](https://github.com/fmalk/take-home-api/commit/ebc4799ad8c70cbf90def8abbdcdc05743d7bd35))
- generate USD flight/route pricing with per-class fares and route-level currency conversion ([71ca299](https://github.com/fmalk/take-home-api/commit/71ca299805acc1c00f6aedeeaf23446a2df1053e))
- implement travel seats feature with pricing-based availability ([f94bc02](https://github.com/fmalk/take-home-api/commit/f94bc0274dad89146234a6a55590560722fc1e22))
- implement travel seats feature with pricing-based availability ([094b994](https://github.com/fmalk/take-home-api/commit/094b9947cc4fb8213f3d55b66b7bf8aaed6e06d4))
- Improve pino logging with structured output and dev pretty-printing ([ed038b5](https://github.com/fmalk/take-home-api/commit/ed038b5ab85c61280ca8a1676c0cebdff31e4586))
- make mode query param case-insensitive ([f7aedde](https://github.com/fmalk/take-home-api/commit/f7aedde989d3a1b651c5954ccf8063f5edd34871))
- support OneWay/RoundTrip flight search with outbound/inbound routes ([fb33f42](https://github.com/fmalk/take-home-api/commit/fb33f42d16badcbaa971cb59b48bb375e2adccef))

### Bug Fixes

- await scenario registration before starting the server ([ebde573](https://github.com/fmalk/take-home-api/commit/ebde57322e1a6c9d23b25a543a7bdd71578f0e22))
- dedupe shared flight legs and store generated instances by ID ([001534f](https://github.com/fmalk/take-home-api/commit/001534f6d82c643849364960d53b8a1d9e97de1b))
- ensure all relative imports have .js extensions for NodeNext ESM ([b65de93](https://github.com/fmalk/take-home-api/commit/b65de939e1557e4c50056bf336f1f406f96c3ecc))
- make onSend hook async in search endpoint ([f07d03a](https://github.com/fmalk/take-home-api/commit/f07d03ac8086892708988c6742c86ba567bcf3d3))
- make onSend hooks async in cities and airports endpoints ([7e136af](https://github.com/fmalk/take-home-api/commit/7e136afd3d2f8a403eaf16329b1d5d4d83898b94))
- mark dependencies as external in esbuild to avoid bundling dynamic requires ([a3ad048](https://github.com/fmalk/take-home-api/commit/a3ad048fded03055b61f14ee79531c00fb4071ae))
- Remove Fastify v5 deprecated logging options ([6ba10d7](https://github.com/fmalk/take-home-api/commit/6ba10d751f2750b8d6c78e42ebb6f0c6710e8e55))
- resolve all ESLint errors ([dfa5555](https://github.com/fmalk/take-home-api/commit/dfa55559985f5f78fc059333e61c9bf290604b11))
- resolve FIATA code duplicates and cultural sensitivity issues in fictional airlines ([c878e2c](https://github.com/fmalk/take-home-api/commit/c878e2ce801c88ea3c22a17b33cc6c9dbeb7f2f0))
- Resolve Mintlify dependency vulnerabilities using npm overrides ([a404ca7](https://github.com/fmalk/take-home-api/commit/a404ca716933d99ba25a0532a4286192cb22031c))
- resolve travel data paths from cwd instead of import.meta.url ([bb17c5a](https://github.com/fmalk/take-home-api/commit/bb17c5ae395c20fb97658834fbbe2f24badc4189))
- restore external dependencies in esbuild to fix npm run start ([f7c6354](https://github.com/fmalk/take-home-api/commit/f7c63549d2c9fa2c85700853bc2b6949c5b23db1))
- signal instance store TTL window to clients via Cache-Control ([2187828](https://github.com/fmalk/take-home-api/commit/2187828e520eebe49b779cbbead86bd391b73052))
- use ESM format for esbuild to support import.meta ([9d2b6d9](https://github.com/fmalk/take-home-api/commit/9d2b6d95343c4b15fc4deed94cb64a0d5732a319))
- use npx to spawn tsx in dev script for cross-platform compatibility ([f4899f9](https://github.com/fmalk/take-home-api/commit/f4899f91021d8aa2d16c2a2b9416e35b640f2042))
- validate returnDate must be after departureDate in RoundTrip searches ([c709fd3](https://github.com/fmalk/take-home-api/commit/c709fd3cfdac056cccf8b85ddda5dd9eba9e95f9))

## [0.5.1](https://github.com/fmalk/take-home-api/compare/take-home-api-v0.5.0...take-home-api-v0.5.1) (2026-07-23)

### Features

- add airport listing endpoint for travel v1 API ([026d03c](https://github.com/fmalk/take-home-api/commit/026d03c6e453e25dfa8c3cd8bb784986bbcd8758))
- add currency_rates.csv with builder script for exchange rate updates ([b8c1e69](https://github.com/fmalk/take-home-api/commit/b8c1e69fc9cf6c8c54a0c813da61a1a3e26c897a))
- add local_currency column to airports with country-specific currency mappings ([fac06d9](https://github.com/fmalk/take-home-api/commit/fac06d9987ad0ac0ae847a2ee0865bc48bb57cc8))
- automate semver tagging with release-please ([4a9b451](https://github.com/fmalk/take-home-api/commit/4a9b451a8f8408364064ff8ae89e9f6b1c79dc84))
- bootstrap reference API with Fastify and travel/v1 scenario ([2002367](https://github.com/fmalk/take-home-api/commit/2002367aaed0eda513097666a895eba44f5b957c))
- generate flight equipment info from aircraft reference data ([d0db6bf](https://github.com/fmalk/take-home-api/commit/d0db6bfa3f4682eed17c81ffaff8cd85a4a78a2f))
- generate routes for every airline combination across all hub legs ([ebc4799](https://github.com/fmalk/take-home-api/commit/ebc4799ad8c70cbf90def8abbdcdc05743d7bd35))
- generate USD flight/route pricing with per-class fares and route-level currency conversion ([71ca299](https://github.com/fmalk/take-home-api/commit/71ca299805acc1c00f6aedeeaf23446a2df1053e))
- implement travel seats feature with pricing-based availability ([f94bc02](https://github.com/fmalk/take-home-api/commit/f94bc0274dad89146234a6a55590560722fc1e22))
- implement travel seats feature with pricing-based availability ([094b994](https://github.com/fmalk/take-home-api/commit/094b9947cc4fb8213f3d55b66b7bf8aaed6e06d4))
- Improve pino logging with structured output and dev pretty-printing ([ed038b5](https://github.com/fmalk/take-home-api/commit/ed038b5ab85c61280ca8a1676c0cebdff31e4586))
- make mode query param case-insensitive ([f7aedde](https://github.com/fmalk/take-home-api/commit/f7aedde989d3a1b651c5954ccf8063f5edd34871))
- support OneWay/RoundTrip flight search with outbound/inbound routes ([fb33f42](https://github.com/fmalk/take-home-api/commit/fb33f42d16badcbaa971cb59b48bb375e2adccef))

### Bug Fixes

- await scenario registration before starting the server ([ebde573](https://github.com/fmalk/take-home-api/commit/ebde57322e1a6c9d23b25a543a7bdd71578f0e22))
- dedupe shared flight legs and store generated instances by ID ([001534f](https://github.com/fmalk/take-home-api/commit/001534f6d82c643849364960d53b8a1d9e97de1b))
- ensure all relative imports have .js extensions for NodeNext ESM ([b65de93](https://github.com/fmalk/take-home-api/commit/b65de939e1557e4c50056bf336f1f406f96c3ecc))
- make onSend hook async in search endpoint ([f07d03a](https://github.com/fmalk/take-home-api/commit/f07d03ac8086892708988c6742c86ba567bcf3d3))
- make onSend hooks async in cities and airports endpoints ([7e136af](https://github.com/fmalk/take-home-api/commit/7e136afd3d2f8a403eaf16329b1d5d4d83898b94))
- mark dependencies as external in esbuild to avoid bundling dynamic requires ([a3ad048](https://github.com/fmalk/take-home-api/commit/a3ad048fded03055b61f14ee79531c00fb4071ae))
- Remove Fastify v5 deprecated logging options ([6ba10d7](https://github.com/fmalk/take-home-api/commit/6ba10d751f2750b8d6c78e42ebb6f0c6710e8e55))
- resolve all ESLint errors ([dfa5555](https://github.com/fmalk/take-home-api/commit/dfa55559985f5f78fc059333e61c9bf290604b11))
- resolve FIATA code duplicates and cultural sensitivity issues in fictional airlines ([c878e2c](https://github.com/fmalk/take-home-api/commit/c878e2ce801c88ea3c22a17b33cc6c9dbeb7f2f0))
- Resolve Mintlify dependency vulnerabilities using npm overrides ([a404ca7](https://github.com/fmalk/take-home-api/commit/a404ca716933d99ba25a0532a4286192cb22031c))
- resolve travel data paths from cwd instead of import.meta.url ([bb17c5a](https://github.com/fmalk/take-home-api/commit/bb17c5ae395c20fb97658834fbbe2f24badc4189))
- restore external dependencies in esbuild to fix npm run start ([f7c6354](https://github.com/fmalk/take-home-api/commit/f7c63549d2c9fa2c85700853bc2b6949c5b23db1))
- signal instance store TTL window to clients via Cache-Control ([2187828](https://github.com/fmalk/take-home-api/commit/2187828e520eebe49b779cbbead86bd391b73052))
- use ESM format for esbuild to support import.meta ([9d2b6d9](https://github.com/fmalk/take-home-api/commit/9d2b6d95343c4b15fc4deed94cb64a0d5732a319))
- use npx to spawn tsx in dev script for cross-platform compatibility ([f4899f9](https://github.com/fmalk/take-home-api/commit/f4899f91021d8aa2d16c2a2b9416e35b640f2042))
- validate returnDate must be after departureDate in RoundTrip searches ([c709fd3](https://github.com/fmalk/take-home-api/commit/c709fd3cfdac056cccf8b85ddda5dd9eba9e95f9))
