// collector/main.go
//
// 역할: 각 패키지를 조립하고 실행하는 진입점.
//       비즈니스 로직은 없다 — 배선(wiring)만 한다.
//
// 실행 흐름:
//   1. Hub 시작       (WebSocket 클라이언트 관리)
//   2. Resolver 시작  (Docker API → IP→서비스명 캐시)
//   3. Processor 시작 (이벤트 집계 + spike 감지 + 스냅샷 발행)
//   4. Agent Reader 시작 (tcp_trace subprocess → 이벤트 채널)
//   5. HTTP 서버 시작 (/ws WebSocket, / 테스트 HTML)
//   6. SIGINT/SIGTERM 수신 시 graceful shutdown

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"microtrace/collector/agent"
	"microtrace/collector/hub"
	"microtrace/collector/model"
	"microtrace/collector/remote"
	"microtrace/collector/resolver"
	"microtrace/collector/resource"
	"microtrace/collector/stats"
	"microtrace/collector/store"
)

const (
	agentBinary         = "../agent/tcp_trace"
	resourceAgentBinary = "../resource_agent/resource_agent"
	listenAddr          = ":9090"
	grpcListenAddr      = ":9191"
	dbPath              = "microtrace.db"
)

func main() {
	// ── 1. 애플리케이션 수명 context ───────────────────────────────────
	// SIGINT(Ctrl+C), SIGTERM(docker stop) 수신 시 ctx가 취소된다.
	// 각 패키지의 goroutine은 ctx.Done()을 보고 정리 후 종료한다.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	mode := strings.ToLower(strings.TrimSpace(os.Getenv("MICROTRACE_MODE")))
	if mode == "" {
		mode = "local"
	}

	switch mode {
	case "local":
		runLocal(ctx)
	case "edge":
		runEdge(ctx)
	case "central":
		runCentral(ctx)
	default:
		log.Fatalf("[main] MICROTRACE_MODE 값 오류: %q (local|edge|central 중 하나)", mode)
	}
}

// runLocal — 기존 단일 호스트 개발/검증 모드.
//
// agent/resource_agent subprocess를 직접 실행하고, 같은 프로세스의 stats/hub/store로 연결한다.
func runLocal(ctx context.Context) {
	log.Println("[main] 실행 모드: local")

	var agentProvider agent.EventProvider = agent.NewSubprocessProvider(agentBinary)
	eventCh, err := agentProvider.Start(ctx)
	if err != nil {
		log.Fatalf("[main] agent 시작 실패: %v", err)
	}

	var resCh <-chan model.ResourceSnapshot
	var resProvider resource.ResourceProvider = resource.NewSubprocessProvider(resourceAgentBinary)
	if ch, err := resProvider.Start(ctx); err != nil {
		log.Printf("[main] resource_agent 시작 실패 (자원 수집 비활성화): %v", err)
	} else {
		resCh = ch
	}

	startCollector(ctx, eventCh, resCh, buildResolver(ctx))
}

// runEdge — EC2 워커 모드.
//
// 로컬 agent/resource_agent에서 읽은 telemetry를 central collector로 gRPC 전송한다.
// stats/hub/store는 실행하지 않는다.
func runEdge(ctx context.Context) {
	addr := strings.TrimSpace(os.Getenv("MICROTRACE_CENTRAL_ADDR"))
	if addr == "" {
		log.Fatalf("[main] MICROTRACE_MODE=edge requires MICROTRACE_CENTRAL_ADDR")
	}
	log.Printf("[main] 실행 모드: edge -> %s", addr)

	client, err := remote.NewClient(addr)
	if err != nil {
		log.Fatalf("[main] central collector 클라이언트 생성 실패: %v", err)
	}
	defer client.Close()

	var agentProvider agent.EventProvider = agent.NewSubprocessProvider(agentBinary)
	eventCh, err := agentProvider.Start(ctx)
	if err != nil {
		log.Fatalf("[main] agent 시작 실패: %v", err)
	}

	go func() {
		if err := client.SendEvents(ctx, eventCh); err != nil && ctx.Err() == nil {
			log.Printf("[main] event gRPC 전송 실패: %v", err)
		}
	}()

	var resProvider resource.ResourceProvider = resource.NewSubprocessProvider(resourceAgentBinary)
	if resCh, err := resProvider.Start(ctx); err != nil {
		log.Printf("[main] resource_agent 시작 실패 (자원 전송 비활성화): %v", err)
	} else {
		go func() {
			if err := client.SendResources(ctx, resCh); err != nil && ctx.Err() == nil {
				log.Printf("[main] resource gRPC 전송 실패: %v", err)
			}
		}()
	}

	<-ctx.Done()
	log.Println("[main] 종료 신호 수신, edge 종료")
}

// runCentral — EC2 중앙 collector 모드.
//
// gRPC로 받은 telemetry를 기존 stats/hub/store 파이프라인에 주입한다.
func runCentral(ctx context.Context) {
	addr := strings.TrimSpace(os.Getenv("MICROTRACE_GRPC_ADDR"))
	if addr == "" {
		addr = grpcListenAddr
	}
	log.Printf("[main] 실행 모드: central (gRPC %s)", addr)

	remoteServer := remote.NewServer()
	if err := remoteServer.Start(ctx, addr); err != nil {
		log.Fatalf("[main] gRPC telemetry 서버 시작 실패: %v", err)
	}

	startCollector(ctx, remoteServer.Events(), remoteServer.Resources(), buildResolver(ctx))
}

// startCollector — stats/hub/store/http를 조립한다.
//
// eventCh/resCh가 local subprocess에서 오든 central gRPC에서 오든 이후 파이프라인은 같다.
func startCollector(ctx context.Context, eventCh <-chan model.Event, resCh <-chan model.ResourceSnapshot, svcResolver resolver.ServiceResolver) {
	// ── Hub 시작 ────────────────────────────────────────────────────────
	h := hub.New()
	go h.Run()

	// ── Store 시작 ──────────────────────────────────────────────────────
	// SQLite 초기화 실패 시 경고만 내고 저장 없이 계속 진행한다.
	var storeFn stats.StoreFn
	db, err := store.New(dbPath)
	if err != nil {
		log.Printf("[main] SQLite 초기화 실패 (저장 비활성화): %v", err)
	} else {
		done := make(chan struct{})
		storeDone := make(chan struct{})
		go func() {
			db.Run(done)
			close(storeDone)
		}()
		defer func() {
			close(done)
			<-storeDone
			db.Close()
		}()
		storeFn = stats.StoreFn{
			Conn:     db.WriteConn,
			Resource: db.WriteResource,
		}
		log.Printf("[main] SQLite 저장 활성화: %s", dbPath)
	}

	// ── Processor 시작 ─────────────────────────────────────────────────
	// hub.Broadcast를 함수 포인터로 넘긴다.
	// stats 패키지가 hub/store 패키지를 직접 임포트하지 않아도 된다.
	proc := stats.New(svcResolver, func(msg model.OutboundMsg) {
		h.Broadcast(msg)
	}, storeFn)

	h.SetHistoryFn(proc.GetHistory)

	go proc.Run(eventCh)

	if resCh != nil {
		proc.ForwardResource(resCh)
	}

	// ── HTTP 서버 ───────────────────────────────────────────────────────
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWs)
	mux.HandleFunc("/api/history", makeHistoryHandler(db))
	mux.HandleFunc("/", serveHome)

	srv := &http.Server{Addr: listenAddr, Handler: mux}

	go func() {
		log.Printf("[main] collector 시작 — http://localhost%s", listenAddr)
		log.Printf("[main] WebSocket: ws://localhost%s/ws", listenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[main] HTTP 서버 오류: %v", err)
		}
	}()

	// ── 종료 대기 ───────────────────────────────────────────────────────
	<-ctx.Done()
	log.Println("[main] 종료 신호 수신, graceful shutdown 시작")
	srv.Shutdown(context.Background())
	log.Println("[main] 종료 완료")
}

// buildResolver — 실행 환경에 맞는 IP→서비스명 resolver를 선택한다.
//
// MICROTRACE_RESOLVER:
//
//	auto   기본값. MICROTRACE_HOSTS_FILE이 있으면 static, 없으면 Docker.
//	docker Docker API 기반 컨테이너 이름 매핑.
//	static YAML 설정 파일 기반 EC2/멀티호스트 매핑.
//
// MICROTRACE_HOSTS_FILE:
//
//	static resolver가 읽을 hosts.yaml 경로.
func buildResolver(ctx context.Context) resolver.ServiceResolver {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("MICROTRACE_RESOLVER")))
	if mode == "" {
		mode = "auto"
	}
	hostsFile := strings.TrimSpace(os.Getenv("MICROTRACE_HOSTS_FILE"))

	if mode == "auto" && hostsFile != "" {
		mode = "static"
	}

	switch mode {
	case "static":
		if hostsFile == "" {
			log.Fatalf("[main] MICROTRACE_RESOLVER=static requires MICROTRACE_HOSTS_FILE")
		}
		hostsFile = resolveHostsFilePath(hostsFile)
		table, err := resolver.LoadStaticTable(hostsFile)
		if err != nil {
			log.Fatalf("[main] StaticResolver 설정 로드 실패: %v", err)
		}
		log.Printf("[main] StaticResolver 활성화: %s (%s)", hostsFile, resolver.StaticTableSummary(table))
		return resolver.NewEnrichResolver(resolver.NewStaticResolver(table))

	case "docker", "auto":
		dockerResolver, err := resolver.NewDockerResolver(ctx)
		if err != nil {
			if mode == "docker" {
				log.Fatalf("[main] DockerResolver 초기화 실패: %v", err)
			}
			log.Printf("[main] DockerResolver 초기화 실패, StaticResolver(empty)로 대체: %v", err)
			return resolver.NewStaticResolver(nil)
		}
		log.Printf("[main] DockerResolver 활성화")
		return resolver.NewEnrichResolver(dockerResolver)

	default:
		log.Fatalf("[main] MICROTRACE_RESOLVER 값 오류: %q (auto|docker|static 중 하나)", mode)
		return nil
	}
}

// resolveHostsFilePath — collector가 어느 작업 디렉터리에서 실행돼도 hosts 파일을 찾는다.
//
// make dev HOSTS=collector/hosts.yaml 는 repo root 기준 경로를 넘기지만,
// scripts/dev.sh는 collector를 실행하기 전에 cwd를 collector/로 바꾼다.
// 그래서 현재 cwd 기준 경로를 먼저 보고, 없으면 repo root(../) 기준으로 한 번 더 찾는다.
func resolveHostsFilePath(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	if _, err := os.Stat(path); err == nil {
		return path
	}
	rootRelative := filepath.Join("..", path)
	if _, err := os.Stat(rootRelative); err == nil {
		return rootRelative
	}
	return path
}

// makeHistoryHandler — GET /api/history?src=&dst=&range=1h|6h|24h|7d|all
//
// db가 nil이면 (SQLite 초기화 실패) 빈 배열을 반환한다.
func makeHistoryHandler(db *store.Store) http.HandlerFunc {
	rangeMap := map[string]time.Duration{
		"1h":  1 * time.Hour,
		"6h":  6 * time.Hour,
		"24h": 24 * time.Hour,
		"7d":  7 * 24 * time.Hour,
	}
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if db == nil {
			w.Write([]byte("[]"))
			return
		}

		src := r.URL.Query().Get("src")
		dst := r.URL.Query().Get("dst")
		rangeStr := r.URL.Query().Get("range")
		if src == "" || dst == "" {
			http.Error(w, `{"error":"src and dst required"}`, http.StatusBadRequest)
			return
		}

		// "all" = 보관된 전체 데이터(from 하한 없음). 그 외는 range별 하한.
		var from time.Time // 제로값 = 아주 먼 과거 → 모든 행 포함
		if rangeStr != "all" {
			dur, ok := rangeMap[rangeStr]
			if !ok {
				dur = time.Hour // 기본값 1h
			}
			from = time.Now().Add(-dur)
		}

		rows, err := db.QueryHistory(src, dst, from)
		if err != nil {
			log.Printf("[api] history 조회 실패: %v", err)
			http.Error(w, `{"error":"query failed"}`, http.StatusInternalServerError)
			return
		}

		if rows == nil {
			rows = []store.HistoryRow{}
		}
		json.NewEncoder(w).Encode(rows)
	}
}

// serveHome — 브라우저 테스트용 HTML 페이지 (Wails 대시보드 완성 전까지 사용)
//
// 수신한 WebSocket 메시지를 msg_type에 따라 구분해서 표시한다.
// "event" → 실시간 이벤트 로그
// "stats" → 연결별 p50/p95/p99 현황판
func serveHome(w http.ResponseWriter, r *http.Request) {
	fmt.Fprint(w, `<!DOCTYPE html>
<html>
<head>
  <title>MicroTrace</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: monospace; background: #1a1a1a; color: #ccc; padding: 20px; margin: 0; }
    h2   { color: #fff; margin-top: 0; }
    #status { margin-bottom: 12px; font-size: 14px; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .panel { border: 1px solid #333; padding: 12px; border-radius: 4px; }
    .panel h3 { color: #aaa; margin: 0 0 8px; font-size: 13px; text-transform: uppercase; }

    #eventlog { height: 60vh; overflow-y: auto; }
    #statsboard { height: 60vh; overflow-y: auto; }

    .ev-connect    { color: #4af; }
    .ev-rtt        { color: #0f8; }
    .ev-retransmit { color: #f44; font-weight: bold; }

    .stat-row { display: flex; justify-content: space-between; padding: 4px 0;
                border-bottom: 1px solid #2a2a2a; font-size: 13px; }
    .stat-key   { color: #89c; }
    .stat-vals  { color: #cf9; }
    .stat-spike { background: #3a1a1a; border-left: 3px solid #f44; padding-left: 6px; }
  </style>
</head>
<body>
  <h2>MicroTrace — Live Dashboard</h2>
  <div id="status">연결 중...</div>
  <div class="grid">
    <div class="panel">
      <h3>실시간 이벤트</h3>
      <div id="eventlog"></div>
    </div>
    <div class="panel">
      <h3>연결별 통계 (1초 갱신)</h3>
      <div id="statsboard"></div>
    </div>
  </div>

  <script>
    const eventlog  = document.getElementById('eventlog');
    const statsboard = document.getElementById('statsboard');
    const statusEl  = document.getElementById('status');

    // stats: 연결별 최신 StatSnapshot 보관 (키: "src→dst")
    const statsMap = {};

    function renderStats() {
      statsboard.innerHTML = '';
      for (const [key, s] of Object.entries(statsMap)) {
        const div = document.createElement('div');
        div.className = 'stat-row' + (s.is_spike ? ' stat-spike' : '');
        div.innerHTML =
          '<span class="stat-key">' + key + '</span>' +
          '<span class="stat-vals">' +
            'p50:' + fmt(s.p50_us) + ' p95:' + fmt(s.p95_us) + ' p99:' + fmt(s.p99_us) +
            (s.retransmit_count ? ' <span style="color:#f44">retx:' + s.retransmit_count + '</span>' : '') +
            (s.is_spike ? ' 🔴SPIKE' : '') +
          '</span>';
        statsboard.appendChild(div);
      }
    }

    function fmt(us) {
      if (us >= 1000) return (us/1000).toFixed(1) + 'ms';
      return us + 'µs';
    }

    function connect() {
      const ws = new WebSocket('ws://' + location.hostname + ':9090/ws');

      ws.onopen = () => {
        statusEl.textContent = '● 연결됨';
        statusEl.style.color = '#0f8';
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.msg_type === 'event') {
          const ev = msg.event;
          const div = document.createElement('div');
          div.className = 'ev-' + ev.type;
          const latStr = ev.latency_us ? ' ' + fmt(ev.latency_us) : '';
          div.textContent = '[' + ev.type.toUpperCase() + '] ' +
            ev.src_service + ' → ' + ev.dst_service + ':' + ev.dport + latStr;
          eventlog.prepend(div);
          if (eventlog.children.length > 200) eventlog.lastChild.remove();

        } else if (msg.msg_type === 'stats') {
          const s = msg.stats;
          const key = s.src_service + ' → ' + s.dst_service;
          statsMap[key] = s;
          renderStats();
        }
      };

      ws.onclose = () => {
        statusEl.textContent = '● 연결 끊김 — 3초 후 재연결';
        statusEl.style.color = '#f44';
        setTimeout(connect, 3000);
      };
    }

    connect();
  </script>
</body>
</html>`)
}
