# Security Policy

We take the security of SkyVirt KubeUI seriously. Thank you for helping keep the
project and its users safe.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report them privately in one of these ways:

- **Email:** **security@straightarc.com** — encrypt with our PGP key if you can
  (available on request).
- **GitHub:** use **"Report a vulnerability"** under the repository's *Security*
  tab (GitHub Private Vulnerability Reporting), if enabled.

Please include as much detail as you can:

- A description of the issue and its impact.
- Steps to reproduce or a proof of concept.
- Affected version(s) and configuration.
- Any suggested remediation.

## What to expect

- **Acknowledgement** within **3 business days**.
- An initial assessment and severity triage within **7 business days**.
- We will keep you informed of progress and coordinate a disclosure timeline
  with you. We aim to release a fix for confirmed high-severity issues within
  **30 days**, and will credit reporters who wish to be named.

## Scope

This policy covers the SkyVirt KubeUI codebase in this repository (the Go
backend, the embedded React UI, and the Helm chart). Vulnerabilities in
third-party dependencies should be reported here if they affect KubeUI; we will
coordinate upstream as needed.

## Supported versions

Security fixes are provided for the latest released minor version. Older
versions may receive fixes at the maintainers' discretion.

Thank you for practising responsible disclosure.
