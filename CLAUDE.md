# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a JavaScript/TypeScript project optimized for modern web development. The project uses industry-standard tools and follows best practices for scalable application development.

## Development Commands

### Package Management

- `npm install` - Install dependencies
- `npm ci` - Install dependencies for CI/CD
- `npm update` - Update dependencies

### Build Commands

- `npm run build` - Build the project for production
- `npm run dev` or `npm start` - Start development server
- `npm run preview` - Preview production build locally

### Testing Commands

- `npm test` or `npm run test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:e2e` - Run end-to-end tests

### Code Quality Commands

- `npm run lint` - Run ESLint for code linting
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run typecheck` - Run TypeScript type checking

### Development Tools

- `npm run storybook` - Start Storybook (if available)
- `npm run analyze` - Analyze bundle size
- `npm run clean` - Clean build artifacts

## Technology Stack

### Core Technologies

- **TypeScript** - Primary programming language
- **Node.js** - Runtime environment
- **npm**- Package management
- **Cache** - has to be in-memory; no Redis, no Elasticache (lib to be determined)
- **Database** - in file such as SQLite or even JSONdb (lib to be determined)

### Common Frameworks

- **Fastify** - Simple and fast NodeJS API server

### Build Tools

- **esbuild** - Extremely fast JavaScript bundler

### Seeding

- **Static reference data** (real-ish cities, airport/airline codes, plane types, currencies, etc.) is committed as source data (e.g. **CSV under a scenario's folder) and loaded into the scenario's DB by a build script (e.g. npm run db:build:travel) — this is enumerable, factual vocabulary, not fabricated**
- **Runtime access is DB-only**: once loaded at build time, reference data is never read from source files during execution. All runtime queries go through the in-memory DB (sql.js), not direct CSV/file reads. This keeps the runtime hermetic and the Docker image portable.
- **Transactional/instance data** (a specific flight, booking, price, timestamp) is never pre-seeded — it's **generated on-the-fly per request**, with tools like Faker
- Reference data (airports, airlines, aircraft, currency rates) is seeded at build time and lives in the DB thereafter. The "no seed data" constraint refers strictly to transactional/instance data — the DB is never empty, only pre-populated with canonical reference vocabulary.

### Testing Framework

- **Jest** - JavaScript testing framework

### Code Quality Tools

- **ESLint** - JavaScript/TypeScript linter
- **Prettier** - Code formatter
- **TypeScript** - Static type checking
- **Husky** - Git hooks

### Services

- GitHub - Repo hosting, Issues
- Mintlify - Documentation

## Project Structure Guidelines

### File Organization

```
src/
├── components/    # Reusable components
├── pages/         # Page components or routes
├── utils/         # Utility functions
├── services/      # API calls and external services
├── types/         # TypeScript type definitions
├── constants/     # Application constants
├── styles/        # Global styles and themes
└── tests/         # Test files
```

### Naming Conventions

- **Files**: Use kebab-case for file names (`user-profile.component.ts`)
- **Components**: Use PascalCase for component names (`UserProfile`)
- **Functions**: Use camelCase for function names (`getUserData`)
- **Constants**: Use UPPER_SNAKE_CASE for constants (`API_BASE_URL`)
- **Types/Interfaces**: Use PascalCase with descriptive names (`UserData`, `ApiResponse`)
- **Variables**: Use lowercase with underscores (`user_id`, `response_json`)

## TypeScript Guidelines

### Type Safety

- Enable strict mode in `tsconfig.json`
- Use explicit types for function parameters and return values
- Prefer interfaces over types for object shapes
- Use union types for multiple possible values
- Avoid `any` type - use `unknown` when type is truly unknown

### Best Practices

- Use type guards for runtime type checking
- Leverage utility types (`Partial`, `Pick`, `Omit`, etc.)
- Create custom types for domain-specific data
- Use Enums for finite sets of values
- Document complex types with JSDoc comments

### Composition Over Duplication

- When multiple versions/scenarios share a shape (a schema, a request/response type, a config object), define it once and compose per-version overrides with the spread operator (`{ ...base, response: { ...base.response, 200: {...} } }`) instead of copy-pasting the whole object.
- Extract a named `type`/`interface` for any inline object shape that shows up more than once (e.g. a `FastifyRequest<{...}>` generic shared by a route and its handler) instead of repeating the literal.
- Reach for generics when a helper or handler shape repeats across scenarios (e.g. a typed cache getter) instead of writing one copy per scenario.
- Derive request/override shapes from an existing domain type with `Partial`, `Pick`, `Omit`, `Record`, etc. rather than redeclaring the fields.
- Still avoid speculative abstraction: factor something out once it's actually duplicated (two-plus real call sites), not in anticipation of scenarios that don't exist yet.

### DIY Philosophy

- Prefer a small hand-rolled solution over a new dependency when the need is a few lines of well-typed code — same reasoning behind this project's in-memory cache and file-based DB choices; avoid infra dependencies the scenario doesn't need.
- DIY doesn't mean ignoring what TypeScript already gives you — reach for the standard utility types before writing a custom equivalent.

## Code Quality Standards

### ESLint Configuration

- Use recommended ESLint rules for JavaScript/TypeScript
- Do not use React-specific rules, this project doesn't use React or JSX
- Configure import/export rules for consistent module usage
- Set up accessibility rules for inclusive development

### Prettier Configuration

- Use consistent indentation (4 spaces recommended)
- Set maximum line length (140 characters)
- Use single quotes for strings
- Add trailing commas for better git diffs

### Testing Standards

- Aim for 80%+ test coverage
- Write unit tests for utilities and business logic
- Use integration tests for component interactions
- Follow AAA pattern (Arrange, Act, Assert)

## Performance Optimization

### Bundle Optimization

- This is not a constraint for this project, use simple bundling; bundle size is not a concern
- Don't code split
- No need for lazy loading
- No image or asset optimization unless trivial
- Tree shaking for dead code is good
- Don't minify or uglify production code
- Source maps are fine

## Security Guidelines

### Dependencies

- Dependabot will be used, so the agents don't have to waste time with audits
- Keep dependencies updated
- Use lock files (`package-lock.json`)
- Avoid dependencies with known vulnerabilities
- Avoid dependencies with problematic licenses

### Code Security

- Sanitize user inputs
- Use HTTPS for API calls
- Implement proper authentication and authorization where the endpoint instructs so
- Store sensitive data securely (environment variables)
- Use Content Security Policy (CSP) headers
- Use CORS headers
- Don't use `awk -F,` for CSV splitting, it introduces bugs from commas, quotes strings

## Development Workflow

### Before Starting

1. Check Node.js version compatibility
2. Install dependencies with `npm install`
3. Copy environment variables from `.env.example`
4. Run type checking with `npm run typecheck`

### During Development

1. Use TypeScript for type safety
2. Run linter frequently to catch issues early
3. Write tests for new features
4. Use meaningful commit messages
5. The user will review committed code

### Before Committing

1. ~~Run full test suite: `npm test`~~ (run only if instructed)
2. Check linting: `npm run lint`
3. Verify formatting: `npm run format:check`
4. Run type checking: `npm run typecheck`
5. Test production build: `npm run build`
