# Contributing to Take Home API

Thank you for your interest in contributing! We welcome contributions from the community. This document outlines the process for contributing to the project.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:

```bash
   git clone https://github.com/your-username/take-home-api.git
   cd take-home-api
```

3. Add the upstream repository:

```bash
   git remote add upstream https://github.com/Cellide/take-home-api.git
```

4. Create a new branch for your feature or fix:

```bash
   git checkout -b feature/your-feature-name
```

## Development Setup

1. Install dependencies:

```bash
   npm install
```

2. Run the development server:

```bash
   npm run dev
```

3. Run tests:

```bash
   npm test
```

4. Lint and format code:

```bash
   npm run lint:fix
   npm run format
```

## Making Changes

- Follow the project's code style and conventions (see CLAUDE.md)
- Write clear, descriptive commit messages
- Keep commits focused and atomic
- Update documentation as needed
- Run tests locally to verify your changes

## Developer Certificate of Origin

By contributing to this project, you agree to certify that:

- The contribution was created in whole or in part by you and you have the right to submit it under the open source license indicated in the file; or
- The contribution is based upon previous work that, to the best of your knowledge, is covered under an appropriate open source license and you have the right under that license to submit that work with modifications, whether created in whole or in part by you, under the same open source license (unless you are permitted to submit under a different license), as indicated in the file; or
- The contribution was provided directly to you by some other person who certified (a), (b) or (c) and you have not modified it.

You acknowledge that this project and the contribution are public and that a record of the contribution (including all personal information you submit with it) is maintained indefinitely and may be redistributed consistent with this project's policies and the requirements of the open source license.

To certify your contributions, sign off on your commits using the `-s` flag:

```bash
git commit -s -m "Your commit message"
```

This adds a "Signed-off-by" line to your commit message.

## Submitting Changes

1. Push your branch to your fork:

```bash
   git push origin feature/your-feature-name
```

2. Create a Pull Request on GitHub
3. Describe your changes clearly in the PR description
4. Reference any related issues using `#issue-number`
5. Ensure all CI checks pass
6. Be responsive to review feedback

## Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Include descriptive commit messages
- Update the scenario README if you're adding new functionality
- Ensure code is linted and formatted
- Add tests for new features (when test coverage is enabled)

## Code of Conduct

Please note that this project is released with a [Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## Questions?

Feel free to open an issue to ask questions about the project or the contribution process. We're here to help!
