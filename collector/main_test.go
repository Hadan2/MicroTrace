package main

import "testing"

func TestResolveHostsFilePathFindsRepoRootRelativePath(t *testing.T) {
	got := resolveHostsFilePath("collector/hosts.example.yaml")
	want := "../collector/hosts.example.yaml"
	if got != want {
		t.Fatalf("resolveHostsFilePath() = %q, want %q", got, want)
	}
}

func TestResolveHostsFilePathKeepsCollectorRelativePath(t *testing.T) {
	got := resolveHostsFilePath("hosts.example.yaml")
	want := "hosts.example.yaml"
	if got != want {
		t.Fatalf("resolveHostsFilePath() = %q, want %q", got, want)
	}
}
