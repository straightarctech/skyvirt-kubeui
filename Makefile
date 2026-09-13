.PHONY: all build web clean test vet fmt docker helm-package sync-version check-version install-hooks

# Single source of truth: the repo-root VERSION file (override with `make VERSION=…`).
VERSION ?= $(shell cat VERSION 2>/dev/null || echo 0.0.0-dev)
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION) -X main.commit=$(GIT_COMMIT) -X main.date=$(BUILD_DATE)"

BIN_DIR := bin
IMAGE_NAME ?= skyvirthci-kubeui
IMAGE_TAG ?= $(VERSION)

all: web build

# ── Go build ────────────────────────────────────────────────────────────────

build: web
	@echo "Building skyvirthci-kubeui..."
	@mkdir -p $(BIN_DIR)
	@rm -rf cmd/kubeui/web/dist
	@mkdir -p cmd/kubeui/web/dist
	@cp -r web/dist/* cmd/kubeui/web/dist/
	CGO_ENABLED=0 go build $(LDFLAGS) -o $(BIN_DIR)/kubeui ./cmd/kubeui

# ── Frontend ────────────────────────────────────────────────────────────────

web:
	@echo "Building web UI (v$(VERSION))..."
	@rm -rf web/dist
	cd web && npm ci --silent && KUBEUI_VERSION=$(VERSION) KUBEUI_COMMIT=$(GIT_COMMIT) npm run build

# ── Docker ──────────────────────────────────────────────────────────────────

# ⚠️⚠️ DEPENDS ON `build` ON PURPOSE. The Dockerfile is the pre-built-binary
# variant — it only COPYs bin/kubeui and bin/helm. Without this dependency,
# `make docker` after a VERSION bump packages whatever stale bin/kubeui happens
# to be on disk and tags it with the NEW version.
#
# That shipped: SkyVirtHCI pinned "KubeUI 1.8.11" (read from this repo's VERSION
# file) around an image whose binary was built at 95f151c and self-reported
# 1.8.9. The product then displayed v1.8.9 while every annotation claimed 1.8.11,
# and the version it advertised was never true.
docker: build
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(IMAGE_NAME):latest
	@# Prove the image carries the version it is tagged with, rather than trusting
	@# the tag. A tag is a label; the binary is the artifact.
	@docker run --rm --entrypoint sh $(IMAGE_NAME):$(IMAGE_TAG) -c \
	  'grep -c "$(VERSION)" /usr/local/bin/kubeui >/dev/null' 2>/dev/null \
	  || { echo "ERROR: $(IMAGE_NAME):$(IMAGE_TAG) does not contain the string $(VERSION) — the image does not match its tag"; exit 1; }
	@echo "verified: image $(IMAGE_NAME):$(IMAGE_TAG) contains $(VERSION)"

# ── Helm ────────────────────────────────────────────────────────────────────

# Stamp the packaged chart from VERSION (the static Chart.yaml value is a fallback).
helm-package:
	helm package deploy/helm/skyvirthci-kubeui -d $(BIN_DIR)/ \
	  --version $(VERSION) --app-version $(VERSION)

# ── Version single-source ────────────────────────────────────────────────────
# VERSION is the one source of truth. `sync-version` rewrites the static files
# that can't read it at rest (Helm chart, values, web/package.json) so a bump is
# `echo <v> > VERSION && make sync-version`. `check-version` fails if they drift.
CHART := deploy/helm/skyvirthci-kubeui/Chart.yaml
VALUES := deploy/helm/skyvirthci-kubeui/values.yaml
VALUES_HUB := deploy/helm/skyvirthci-kubeui/values-hub.yaml
WEBPKG := web/package.json

sync-version:
	@echo "Syncing all version references to $(VERSION)"
	@sed -i -E 's/^version: .*/version: $(VERSION)/' $(CHART)
	@sed -i -E 's/^appVersion: .*/appVersion: "$(VERSION)"/' $(CHART)
	@sed -i -E 's/^(  tag:) .*/\1 "$(VERSION)"/' $(VALUES)
	@sed -i -E 's/^(  tag:) .*/\1 "$(VERSION)"/' $(VALUES_HUB)
	@sed -i -E 's/("version"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"$(VERSION)"/' $(WEBPKG)
	@echo "  updated $(CHART), $(VALUES), $(VALUES_HUB), $(WEBPKG)"

# ⚠️ Check EVERY file sync-version writes. It used to read only CHART and WEBPKG,
# so a drifted values.yaml passed silently — and that is the file that decides
# which image tag is actually pulled. v1.8.12 shipped with appVersion 1.8.12 and
# tag 1.8.11; the check failed only because package.json had drifted too.
check-version:
	@fail=0; \
	for f in "$(CHART):$(VERSION)" "$(VALUES):$(VERSION)" "$(VALUES_HUB):$(VERSION)" "$(WEBPKG):$(VERSION)"; do \
	  file=$${f%%:*}; want=$${f##*:}; \
	  grep -q "$$want" "$$file" || { echo "DRIFT: $$file != VERSION ($$want)"; fail=1; }; \
	done; \
	[ $$fail -eq 0 ] && echo "all version references match VERSION=$(VERSION)" || { echo "run 'make sync-version'"; exit 1; }

# ── Quality ─────────────────────────────────────────────────────────────────

test:
	go test ./...

vet:
	go vet ./...

fmt:
	gofmt -w .

# Git never runs hooks straight from a clone, so a fresh clone has NO commit
# guard until this is run. Point core.hooksPath at the tracked directory rather
# than copying, so a later edit to the hook takes effect without reinstalling.
# Guarded on the directory existing: deploy/hooks is internal-only, so in a tree
# that does not carry it this target must do NOTHING. Setting core.hooksPath to
# a missing directory silently disables every hook for that clone — a worse
# outcome than not installing anything.
install-hooks:
	@if [ -d deploy/hooks ]; then \
	  git config core.hooksPath deploy/hooks; \
	  chmod +x deploy/hooks/*; \
	  echo "hooks installed: core.hooksPath -> deploy/hooks"; \
	  ls -1 deploy/hooks | sed 's/^/  /'; \
	else \
	  echo "no deploy/hooks in this tree - nothing to install"; \
	fi

# ── Clean ───────────────────────────────────────────────────────────────────

clean:
	rm -rf $(BIN_DIR)
	rm -rf web/dist web/node_modules
	rm -rf cmd/kubeui/web
