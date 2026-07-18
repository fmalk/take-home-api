# Security Policy

## Reporting Security Vulnerabilities

We take the security of the Take Home API seriously. If you discover a security vulnerability, **we encourage you to submit a public GitHub issue**. An alternate, private channel is `security at cellide dot com`.

Since this is a public repository and many people may rely on it, security problems should be known, understood and patched as soon as possible.

Please include the following information in your report:

- A clear description of the vulnerability
- Steps to reproduce the issue (if applicable)
- Potential impact of the vulnerability
- Any suggested remediation

We will acknowledge your report ASAP and work with you to understand and address the issue.

## Security Best Practices

When using this project:

1. **Keep dependencies updated** - Regularly update npm dependencies to patch security vulnerabilities
2. **Use environment variables** - Store sensitive configuration in environment variables, never in code
3. **Enable HTTPS** - Always use HTTPS in any environment server
4. **Validate input** - Sanitize and validate all user inputs
5. **Use secure headers** - Enable appropriate security headers (CSP, X-Frame-Options, etc.)
6. **Review code** - Have security-conscious code reviews before merging

## Supported Versions

We provide security updates for the latest stable release. We recommend always using the latest version.

## Dependencies

We use Dependabot to monitor and update dependencies for security vulnerabilities. Vulnerability reports are addressed promptly.

## Responsible Disclosure

We appreciate responsible disclosure and will make efforts to:

1. Verify the vulnerability
2. Work on a fix
3. Release the fix in a timely manner
4. Credit the reporter (unless they prefer anonymity)

We have no issues about public disclosure within the context of this repository.
