.PHONY: all build web clean test vet fmt docker helm-package sync-version check-version

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

docker:
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .
	docker tag $(IMAGE_NAME):$(IMAGE_TAG) $(IMAGE_NAME):latest

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

check-version:
	@fail=0; \
	for f in "$(CHART):$(VERSION)" "$(WEBPKG):$(VERSION)"; do \
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

# ── Clean ───────────────────────────────────────────────────────────────────

clean:
	rm -rf $(BIN_DIR)
	rm -rf web/dist web/node_modules
	rm -rf cmd/kubeui/web
