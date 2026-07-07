package resolver

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadStaticTableHosts(t *testing.T) {
	path := writeTempConfig(t, `
hosts:
  10.0.1.10: service-a
  10.0.2.20: service-b
`)

	table, err := LoadStaticTable(path)
	if err != nil {
		t.Fatalf("LoadStaticTable() error = %v", err)
	}
	if got := table["10.0.1.10"]; got != "service-a" {
		t.Fatalf("10.0.1.10 = %q, want service-a", got)
	}
	if got := table["10.0.2.20"]; got != "service-b" {
		t.Fatalf("10.0.2.20 = %q, want service-b", got)
	}
}

func TestLoadStaticTableServices(t *testing.T) {
	path := writeTempConfig(t, `
services:
  service-a:
    - 10.0.1.10
  service-b:
    - 10.0.2.20
    - 10.0.2.21
`)

	table, err := LoadStaticTable(path)
	if err != nil {
		t.Fatalf("LoadStaticTable() error = %v", err)
	}
	if got := table["10.0.2.21"]; got != "service-b" {
		t.Fatalf("10.0.2.21 = %q, want service-b", got)
	}
}

func TestLoadStaticTableRejectsInvalidIP(t *testing.T) {
	path := writeTempConfig(t, `
hosts:
  not-an-ip: service-a
`)

	if _, err := LoadStaticTable(path); err == nil {
		t.Fatal("LoadStaticTable() error = nil, want invalid IP error")
	}
}

func writeTempConfig(t *testing.T, contents string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "hosts.yaml")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}
