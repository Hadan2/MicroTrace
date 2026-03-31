// resolver/resolver.go
//
// 역할: IP 주소를 사람이 읽을 수 있는 서비스 이름으로 변환한다.
//
// 설계 원칙 (확장 경계):
//   stats 패키지는 ServiceResolver 인터페이스만 호출한다.
//   환경이 바뀌어도 stats, hub 코드는 건드리지 않는다.
//
//   1단계 (현재): DockerResolver — Docker API로 IP → 컨테이너 이름
//   2단계 (EC2):  StaticResolver  — hosts.yaml 설정 파일 기반
//   3단계 (k8s):  K8sResolver     — k8s API로 Pod/Service 이름
//
// DockerResolver 동작 방식:
//   - 시작 시 한 번 컨테이너 목록을 가져와 캐시에 저장
//   - 이후 Docker 이벤트 스트림을 구독해서 컨테이너 생성/삭제 시 캐시 갱신
//   - IP 조회 시 캐시만 참조 (API 호출 없음 → 고빈도 이벤트에서도 블로킹 없음)

package resolver

import (
	"context"
	"log"
	"sync"

	dockerclient "github.com/moby/moby/client"
	"github.com/moby/moby/api/types/events"
)

// ─────────────────────────────────────────────
// ServiceResolver — IP → 서비스 이름 변환 인터페이스
//
// 모든 구현체(Docker, Static, K8s)는 이 인터페이스를 만족해야 한다.
// stats 패키지는 이 인터페이스만 알고, 구현체를 직접 참조하지 않는다.
// ─────────────────────────────────────────────
type ServiceResolver interface {
	// Resolve — IP를 서비스 이름으로 변환한다.
	// 알 수 없는 IP면 IP 그대로 반환한다 (에러 반환 안 함 — 이벤트 처리를 막지 않기 위해).
	Resolve(ip string) string
}

// ─────────────────────────────────────────────
// DockerResolver — Docker API 기반 구현체 (1단계 로컬 환경)
// ─────────────────────────────────────────────
type DockerResolver struct {
	client *dockerclient.Client
	mu     sync.RWMutex
	cache  map[string]string // IP → 컨테이너 이름
}

// NewDockerResolver — DockerResolver를 생성하고 초기 캐시를 채운다.
//
// ctx: 애플리케이션 수명과 같은 context (main에서 넘겨준 context)
// 이벤트 구독 goroutine이 ctx가 취소될 때 종료된다.
func NewDockerResolver(ctx context.Context) (*DockerResolver, error) {
	cli, err := dockerclient.NewClientWithOpts(
		dockerclient.FromEnv,
		dockerclient.WithAPIVersionNegotiation(),
	)
	if err != nil {
		return nil, err
	}

	r := &DockerResolver{
		client: cli,
		cache:  make(map[string]string),
	}

	// 시작 시 현재 실행 중인 컨테이너 목록으로 캐시 초기화
	if err := r.refreshAll(ctx); err != nil {
		// Docker 데몬에 연결 못해도 경고만 내고 계속 진행
		// (Docker 없는 환경에서도 collector가 실행되어야 함)
		log.Printf("[resolver] Docker 초기 캐시 실패 (Docker 없는 환경?): %v", err)
	}

	// 컨테이너 생성/삭제 이벤트를 구독해서 캐시 자동 갱신
	go r.watchEvents(ctx)

	return r, nil
}

// Resolve — IP를 컨테이너 이름으로 변환한다.
// 캐시에 없으면 IP 그대로 반환.
func (r *DockerResolver) Resolve(ip string) string {
	r.mu.RLock()
	name, ok := r.cache[ip]
	r.mu.RUnlock()

	if ok {
		return name
	}
	return ip
}

// refreshAll — 현재 실행 중인 모든 컨테이너의 IP를 캐시에 저장한다.
func (r *DockerResolver) refreshAll(ctx context.Context) error {
	result, err := r.client.ContainerList(ctx, dockerclient.ContainerListOptions{})
	if err != nil {
		return err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	for _, c := range result.Items {
		name := containerName(c.Names)
		if c.NetworkSettings != nil {
			for _, net := range c.NetworkSettings.Networks {
				if net.IPAddress.IsValid() {
					ip := net.IPAddress.String()
					r.cache[ip] = name
					log.Printf("[resolver] 캐시 추가: %s → %s", ip, name)
				}
			}
		}
	}
	return nil
}

// watchEvents — Docker 이벤트 스트림을 구독하여 캐시를 실시간 갱신한다.
//
// 컨테이너가 시작되면 IP를 캐시에 추가.
// 컨테이너가 멈추면 해당 IP를 캐시에서 제거.
// ctx 취소 시 goroutine 종료.
func (r *DockerResolver) watchEvents(ctx context.Context) {
	f := dockerclient.Filters{}.
		Add("type", "container").
		Add("event", "start").
		Add("event", "die")

	result := r.client.Events(ctx, dockerclient.EventsListOptions{Filters: f})

	for {
		select {
		case <-ctx.Done():
			return
		case err := <-result.Err:
			if err != nil {
				log.Printf("[resolver] Docker 이벤트 스트림 오류: %v — 캐시 갱신 중단", err)
				return
			}
		case msg := <-result.Messages:
			r.handleEvent(ctx, msg)
		}
	}
}

// handleEvent — 컨테이너 start/die 이벤트에 맞게 캐시를 갱신한다.
func (r *DockerResolver) handleEvent(ctx context.Context, msg events.Message) {
	switch msg.Action {
	case "start":
		// 새 컨테이너 — IP를 조회해서 캐시에 추가
		inspectResult, err := r.client.ContainerInspect(ctx, msg.Actor.ID, dockerclient.ContainerInspectOptions{})
		if err != nil {
			log.Printf("[resolver] ContainerInspect 실패 (%s): %v", msg.Actor.ID[:12], err)
			return
		}
		info := inspectResult.Container
		name := info.Name
		if len(name) > 0 && name[0] == '/' {
			name = name[1:]
		}
		r.mu.Lock()
		if info.NetworkSettings != nil {
			for _, net := range info.NetworkSettings.Networks {
				if net.IPAddress.IsValid() {
					ip := net.IPAddress.String()
					r.cache[ip] = name
					log.Printf("[resolver] 컨테이너 시작 → 캐시 추가: %s → %s", ip, name)
				}
			}
		}
		r.mu.Unlock()

	case "die":
		// 컨테이너 종료 — 해당 IP 캐시에서 제거
		r.mu.Lock()
		for ip, name := range r.cache {
			if name == msg.Actor.Attributes["name"] {
				delete(r.cache, ip)
				log.Printf("[resolver] 컨테이너 종료 → 캐시 제거: %s → %s", ip, name)
			}
		}
		r.mu.Unlock()
	}
}

// containerName — Docker API가 반환하는 Names 슬라이스에서 대표 이름을 꺼낸다.
// Docker는 이름 앞에 '/'를 붙여 반환한다 (예: "/service-a").
func containerName(names []string) string {
	if len(names) == 0 {
		return "unknown"
	}
	name := names[0]
	if len(name) > 0 && name[0] == '/' {
		return name[1:]
	}
	return name
}

// ─────────────────────────────────────────────
// StaticResolver — 설정 파일/맵 기반 구현체 (2단계 EC2 환경, 테스트용)
//
// NewStaticResolver(map[string]string{"10.0.0.1": "service-a"})
// DockerResolver를 쓸 수 없는 환경이나 테스트에서 사용한다.
// ─────────────────────────────────────────────
type StaticResolver struct {
	table map[string]string
}

func NewStaticResolver(table map[string]string) *StaticResolver {
	if table == nil {
		table = make(map[string]string)
	}
	return &StaticResolver{table: table}
}

func (r *StaticResolver) Resolve(ip string) string {
	if name, ok := r.table[ip]; ok {
		return name
	}
	return ip
}
