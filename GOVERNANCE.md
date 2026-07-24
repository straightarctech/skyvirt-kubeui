# Governance

This document describes how the SkyVirt KubeUI project is governed. Our goal is
lightweight, transparent, and merit-based governance that scales as the
community grows, and that is compatible with the CNCF's expectations for open,
vendor-neutral projects.

## Roles

### Contributors

Anyone who submits an issue, comment, or pull request is a contributor. There is
no formal process — just follow [CONTRIBUTING.md](CONTRIBUTING.md) (including the
DCO sign-off) and the [Code of Conduct](CODE_OF_CONDUCT.md).

### Maintainers

Maintainers are contributors who have shown sustained, high-quality involvement
and have earned the trust of the existing maintainers. They can review and merge
pull requests, triage issues, and steer the roadmap. The current list lives in
[MAINTAINERS.md](MAINTAINERS.md).

**Becoming a maintainer.** A contributor may be nominated by any existing
maintainer after a track record of good pull requests, reviews, and community
participation (typically several months). Nomination is confirmed by
[lazy consensus](#decision-making) of the current maintainers.

**Stepping down / removal.** Maintainers may step down at any time. A maintainer
who has been inactive for an extended period, or who repeatedly acts against the
project's interests or Code of Conduct, may be moved to emeritus status by a
supermajority (two-thirds) vote of the other maintainers.

## Decision-making

We prefer to make decisions by **lazy consensus**: a proposal (usually a pull
request or an issue) is considered accepted if no maintainer objects within a
reasonable review period (normally 3 business days for non-trivial changes).

- **Routine changes** (bug fixes, docs, small features) need one maintainer
  approval and a green CI.
- **Significant changes** (architecture, breaking changes, new dependencies,
  governance) should be discussed in an issue first and need approval from a
  majority of maintainers.
- If consensus cannot be reached, any maintainer may call for an explicit vote.
  Each maintainer has one vote; a simple majority decides, and the change must
  not have a sustained objection ("-1") from a maintainer without a documented
  rationale.

## Roadmap

The roadmap is maintained openly via issues and milestones. Anyone may propose
roadmap items; maintainers prioritise them with community input.

## Code of Conduct

All participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
Enforcement is a maintainer responsibility.

## Changes to this document

Changes to governance follow the "significant changes" process above: proposed
in a pull request and approved by a majority of maintainers.

## Neutrality

The project aspires to open, vendor-neutral governance. While it was created and
is currently stewarded by StraightArc Technologies Pvt. Ltd., the project
actively welcomes maintainers from other organisations, and decisions are made on
technical merit and community benefit — not the interests of any single company.
