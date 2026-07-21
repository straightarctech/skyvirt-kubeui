# Contributing to SkyVirt KubeUI

First off — thank you for taking the time to contribute. SkyVirt KubeUI is
free and open source (Apache-2.0), and it gets better because people like you
file issues, propose ideas, and send pull requests. Contributions of every
size are welcome, from typo fixes to whole new resource views.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Ways to contribute

- **Report a bug** — open an issue with clear steps to reproduce, the KubeUI
  version, your Kubernetes distribution/version, and what you expected.
- **Request a feature** — describe the problem you're trying to solve, not just
  the solution. Real use cases help us prioritise.
- **Improve docs** — the README, this guide, and inline comments.
- **Send code** — see the workflow below.

Before starting a large change, please open an issue to discuss it first, so we
can agree on the approach and save you rework.

---

## Developer Certificate of Origin (DCO) — sign your commits

This project uses the [Developer Certificate of Origin](DCO). Every commit must
be signed off, certifying that you wrote the code (or have the right to submit
it) under the project's license. Add a `Signed-off-by` line to each commit:

```
git commit -s -m "feat(pods): add container QoS column"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and a reachable email. Pull requests whose commits are not
signed off cannot be merged. To sign off commits you already made, use
`git rebase --signoff <base>` or amend with `git commit -s --amend`.

---

## Development setup

**Prerequisites:** Go 1.22+, Node 20+, and a Kubernetes cluster (any distro;
[kind](https://kind.sigs.k8s.io/) or [k3s](https://k3s.io/) work great for
local dev).

```bash
# clone your fork
git clone https://github.com/<your-user>/skyvirt-kubeui.git
cd skyvirt-kubeui

# build the web UI, then the single Go binary that embeds it
make web      # builds web/dist
make build    # compiles bin/kubeui with the UI embedded

# run against your current kubeconfig (auth disabled for local dev)
AUTH_ENABLED=false ./bin/kubeui
# open http://localhost:8080
```

Front-end only (fast iteration):

```bash
cd web && npm ci && npm run dev
```

Handy targets: `make vet`, `make test`, `make fmt`, `make docker`,
`make helm-package`. Run `make` with no target to see them all.

---

## Pull request workflow

1. **Fork** the repo and create a branch from `main`
   (e.g. `feat/label-filter`, `fix/pod-detail-crash`).
2. Make your change. Keep it focused — one logical change per PR.
3. **Match the surrounding code**: `gofmt`-clean Go; the front end is
   TypeScript + React with theme tokens (use `var(--th-*)`), and `tsc --noEmit`
   must pass. Run `make vet` and `cd web && npx tsc --noEmit`.
4. Add or update tests where it makes sense.
5. **Sign off** every commit (`git commit -s`).
6. Push and open a PR against `main`. Fill in the PR template — what changed,
   why, and how you tested it. Screenshots for UI changes are very welcome.
7. A maintainer will review. Address feedback by pushing more commits (we squash
   on merge). CI must be green.

### Commit messages

We use short, imperative Conventional-Commit-style subjects:

```
feat(networking): add MetalLB pool selector to Services
fix(watch): reconnect with backoff after 410 Gone
docs(readme): document air-gap install
```

---

## Reporting security issues

Please **do not** open a public issue for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for private disclosure.

---

## Governance & maintainers

Project decisions and the maintainer list are described in
[GOVERNANCE.md](GOVERNANCE.md) and [MAINTAINERS.md](MAINTAINERS.md). We welcome
new maintainers — sustained, high-quality contributions are the path in.

Thanks again, and welcome aboard. 🚀
