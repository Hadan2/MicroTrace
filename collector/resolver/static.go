package resolver

import (
	"fmt"
	"net"
	"os"
	"sort"

	"gopkg.in/yaml.v3"
)

type staticResolverConfig struct {
	Hosts    map[string]string   `yaml:"hosts"`
	Services map[string][]string `yaml:"services"`
}

// LoadStaticTable — EC2/static 환경의 IP→서비스명 매핑 파일을 읽는다.
//
// 지원하는 YAML 형식:
//
//	hosts:
//	  10.0.1.10: service-a
//
//	services:
//	  service-a:
//	    - 10.0.1.10
func LoadStaticTable(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("static resolver 설정 파일 읽기 실패: %w", err)
	}

	var cfg staticResolverConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("static resolver YAML 파싱 실패: %w", err)
	}

	table := make(map[string]string)
	for ip, name := range cfg.Hosts {
		if err := addStaticHost(table, ip, name); err != nil {
			return nil, err
		}
	}
	for name, ips := range cfg.Services {
		for _, ip := range ips {
			if err := addStaticHost(table, ip, name); err != nil {
				return nil, err
			}
		}
	}

	if len(table) == 0 && cfg.Hosts == nil && cfg.Services == nil {
		var direct map[string]string
		if err := yaml.Unmarshal(data, &direct); err != nil {
			return nil, fmt.Errorf("static resolver 설정이 비어 있음")
		}
		for ip, name := range direct {
			if err := addStaticHost(table, ip, name); err != nil {
				return nil, err
			}
		}
	}

	if len(table) == 0 {
		return nil, fmt.Errorf("static resolver 설정이 비어 있음")
	}
	return table, nil
}

func addStaticHost(table map[string]string, ip, name string) error {
	if net.ParseIP(ip) == nil {
		return fmt.Errorf("static resolver IP 형식 오류: %q", ip)
	}
	if name == "" {
		return fmt.Errorf("static resolver 서비스명이 비어 있음: %s", ip)
	}
	if prev, ok := table[ip]; ok && prev != name {
		return fmt.Errorf("static resolver 중복 IP: %s (%s, %s)", ip, prev, name)
	}
	table[ip] = name
	return nil
}

// StaticTableSummary — 로그에 남길 짧고 안정적인 매핑 요약을 만든다.
func StaticTableSummary(table map[string]string) string {
	ips := make([]string, 0, len(table))
	for ip := range table {
		ips = append(ips, ip)
	}
	sort.Strings(ips)

	limit := len(ips)
	if limit > 5 {
		limit = 5
	}

	out := ""
	for i := 0; i < limit; i++ {
		if i > 0 {
			out += ", "
		}
		ip := ips[i]
		out += ip + "→" + table[ip]
	}
	if len(ips) > limit {
		out += fmt.Sprintf(", ... +%d", len(ips)-limit)
	}
	return out
}
