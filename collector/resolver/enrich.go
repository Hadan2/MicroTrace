// resolver/enrich.go
//
// EnrichResolver — DockerResolver가 모르는 IP를 rDNS로 보완한다.
//
// 동작 순서:
//   1. DockerResolver로 조회 → 컨테이너명 반환 (내부 IP)
//   2. 캐시에 있으면 캐시 반환 (rDNS 결과 재사용)
//   3. net.LookupAddr로 rDNS 조회 → 도메인 파싱 후 캐시 저장
//   4. rDNS 결과 없으면 IP 그대로 반환
//
// rDNS 조회는 외부 DNS 쿼리라 수십ms가 걸린다.
// 캐시로 한 번만 조회하고 이후엔 메모리에서 즉시 반환한다.

package resolver

import (
	"net"
	"strings"
	"sync"

	"golang.org/x/net/publicsuffix"
)

// EnrichResolver — Docker 내부 IP는 컨테이너명으로, 외부 IP는 rDNS 도메인으로 변환
type EnrichResolver struct {
	docker *DockerResolver

	mu    sync.RWMutex
	cache map[string]string // IP → 변환 결과 캐시
}

// NewEnrichResolver — EnrichResolver 생성
func NewEnrichResolver(docker *DockerResolver) *EnrichResolver {
	return &EnrichResolver{
		docker: docker,
		cache:  make(map[string]string),
	}
}

// Resolve — IP를 사람이 읽을 수 있는 이름으로 변환한다.
func (r *EnrichResolver) Resolve(ip string) string {
	// 1. Docker 내부 컨테이너 IP인지 먼저 확인
	if name := r.docker.Resolve(ip); name != ip {
		return name
	}

	// 2. rDNS 캐시 확인
	r.mu.RLock()
	if cached, ok := r.cache[ip]; ok {
		r.mu.RUnlock()
		return cached
	}
	r.mu.RUnlock()

	// 3. rDNS 조회 (캐시 미스일 때만 실행)
	result := r.lookupAndParse(ip)

	r.mu.Lock()
	r.cache[ip] = result
	r.mu.Unlock()

	return result
}

// lookupAndParse — rDNS 조회 후 도메인에서 등록 도메인(eTLD+1)을 파싱한다.
//
// 예) "lb-140-82-112-21.github.com" → "github.com"
//     "142.250.196.46"              → "google.com"  (1e100.net 계열)
//     조회 실패                     → IP 그대로
func (r *EnrichResolver) lookupAndParse(ip string) string {
	addrs, err := net.LookupAddr(ip)
	if err != nil || len(addrs) == 0 {
		return ip
	}

	// rDNS 결과는 끝에 '.' 이 붙는 경우가 있음 (FQDN 표기)
	host := strings.TrimSuffix(addrs[0], ".")

	// golang.org/x/net/publicsuffix 로 등록 도메인 추출
	// "lb-140-82-112-21.github.com" → "github.com"
	registered, err := publicsuffix.EffectiveTLDPlusOne(host)
	if err != nil {
		// 파싱 실패 시 원본 호스트명 반환
		return host
	}

	return registered
}
