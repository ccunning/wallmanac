# Local build/publish pipeline — the same steps GitHub Actions runs
# (.github/workflows/docker-publish.yml), for when you'd rather push from here.
#
#   make test              run the unit tests in a throwaway node container
#   make build             build the image for this machine
#   make up / down / logs  run it locally via docker compose
#   make login             docker login to Docker Hub
#   make push              multi-arch build + push :latest and :$(VERSION)
#
# Override anything on the command line:  make push DOCKERHUB_USER=me TAG=beta

DOCKERHUB_USER ?= ccunning
IMAGE          ?= $(DOCKERHUB_USER)/wallmanac
VERSION        ?= $(shell node -p "require('./package.json').version" 2>/dev/null || \
                    sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
TAG            ?= $(VERSION)
PLATFORMS      ?= linux/amd64,linux/arm64
REVISION       := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
CREATED        := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
NODE_IMAGE     ?= node:24-alpine
# The demo fixture is written as real UTC instants derived from local wall-clock
# times, so the generator has to run in your timezone, not the container's UTC.
HOST_TZ        ?= $(shell readlink -f /etc/localtime 2>/dev/null | sed -n 's|.*/zoneinfo/||p' | head -1)
ifeq ($(strip $(HOST_TZ)),)
HOST_TZ        := $(shell head -1 /etc/timezone 2>/dev/null)
endif
BUILDER        ?= wallmanac-builder

BUILD_ARGS = --build-arg VERSION=$(VERSION) --build-arg REVISION=$(REVISION) --build-arg CREATED=$(CREATED)

.DEFAULT_GOAL := help
.PHONY: help test build up down logs restart login push release clean fixture demo demo-down demo-logs

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  image: $(IMAGE):$(TAG)  (also tagged latest on push)"

# Copies the repo into the container rather than mounting it read-write, so
# `npm ci` never leaves a node_modules/ behind in your working tree.
test: ## Run the unit tests (no local node install needed)
	docker run --rm -v "$(CURDIR)":/src:ro -w /app $(NODE_IMAGE) \
	  sh -c 'cp -r /src/. /app && npm ci --silent && npm test'

build: ## Build the image for this machine
	docker build $(BUILD_ARGS) -t $(IMAGE):$(TAG) -t $(IMAGE):latest .

up: ## Build and start the stack via docker compose
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

logs: ## Follow the container logs
	docker compose logs -f

restart: ## Restart the container (picks up config/config.js edits)
	docker compose restart

fixture: ## Regenerate demo/demo.ics anchored to today
	docker run --rm -v "$(CURDIR)":/app -w /app -e TZ="$(HOST_TZ)" $(NODE_IMAGE) node tools/generate-demo-ics.js

demo: fixture ## Run the display against the fixture calendar on :8081
	docker compose -f docker-compose.demo.yml up -d --build
	@echo "demo running at http://localhost:8081  (make demo-down to stop)"

demo-down: ## Stop the demo stack
	docker compose -f docker-compose.demo.yml down

demo-logs: ## Follow the demo container logs
	docker compose -f docker-compose.demo.yml logs -f

login: ## Log in to Docker Hub (use an access token, not your password)
	docker login -u $(DOCKERHUB_USER)

# buildx with a dedicated builder so the multi-arch manifest can be pushed in
# one shot; --platform builds can't be loaded into the local daemon, hence the
# separate `build` target above for local runs.
push: test ## Multi-arch build and push to Docker Hub
	docker buildx inspect $(BUILDER) >/dev/null 2>&1 || docker buildx create --name $(BUILDER) --driver docker-container --bootstrap
	docker buildx build --builder $(BUILDER) --platform $(PLATFORMS) $(BUILD_ARGS) \
	  -t $(IMAGE):$(TAG) -t $(IMAGE):latest --push .
	@echo "pushed $(IMAGE):$(TAG) and $(IMAGE):latest for $(PLATFORMS)"

release: ## Tag the current commit with its package.json version and push (CI publishes)
	git tag -a v$(VERSION) -m "wallmanac v$(VERSION)"
	git push origin v$(VERSION)

clean: ## Remove the buildx builder
	-docker buildx rm $(BUILDER)
