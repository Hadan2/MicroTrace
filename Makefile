.PHONY: dev dev-static dev-docker dev-down build-ebpf build-resource collector-test frontend-build

dev:
	@if [ -n "$(HOSTS)" ]; then \
		MICROTRACE_RESOLVER=static MICROTRACE_HOSTS_FILE="$(abspath $(HOSTS))" ./scripts/dev.sh; \
	else \
		./scripts/dev.sh; \
	fi

dev-static:
	@if [ -z "$(HOSTS)" ]; then \
		echo "usage: make dev-static HOSTS=collector/hosts.example.yaml"; \
		exit 1; \
	fi
	MICROTRACE_RESOLVER=static MICROTRACE_HOSTS_FILE="$(abspath $(HOSTS))" ./scripts/dev.sh

dev-docker:
	MICROTRACE_RESOLVER=docker ./scripts/dev.sh

dev-down:
	@if docker compose version >/dev/null 2>&1; then \
		docker compose -f testenv/docker-compose.yml down --remove-orphans; \
	else \
		docker-compose -f testenv/docker-compose.yml down --remove-orphans; \
	fi

build-ebpf:
	$(MAKE) -C agent

build-resource:
	cd resource_agent && go build -o resource_agent .

collector-test:
	cd collector && go test ./...

frontend-build:
	cd frontend && npm run build
