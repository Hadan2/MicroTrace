.PHONY: dev dev-down build-ebpf build-resource collector-test frontend-build

dev:
	./scripts/dev.sh

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
