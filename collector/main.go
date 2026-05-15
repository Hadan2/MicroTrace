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
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"microtrace/collector/agent"
	"microtrace/collector/hub"
	"microtrace/collector/model"
	"microtrace/collector/resolver"
	"microtrace/collector/resource"
	"microtrace/collector/stats"
)

const (
	agentBinary        = "../agent/tcp_trace"
	resourceAgentBinary = "../resource_agent/resource_agent"
	listenAddr         = ":9090"
)

func main() {
	// ── 1. 애플리케이션 수명 context ───────────────────────────────────
	// SIGINT(Ctrl+C), SIGTERM(docker stop) 수신 시 ctx가 취소된다.
	// 각 패키지의 goroutine은 ctx.Done()을 보고 정리 후 종료한다.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// ── 2. Hub 시작 ────────────────────────────────────────────────────
	h := hub.New()
	go h.Run()

	// ── 3. Resolver 시작 ───────────────────────────────────────────────
	// DockerResolver: 내부 컨테이너 IP → 컨테이너명
	// EnrichResolver: DockerResolver가 모르는 외부 IP → rDNS 도메인명
	// Docker API 연결 실패 시 StaticResolver로 대체 (IP 그대로 표시)
	var svcResolver resolver.ServiceResolver
	dockerResolver, err := resolver.NewDockerResolver(ctx)
	if err != nil {
		log.Printf("[main] DockerResolver 초기화 실패, StaticResolver로 대체: %v", err)
		svcResolver = resolver.NewStaticResolver(nil)
	} else {
		svcResolver = resolver.NewEnrichResolver(dockerResolver)
	}

	// ── 4. Processor 시작 ──────────────────────────────────────────────
	// hub.Broadcast를 함수 포인터로 넘긴다.
	// stats 패키지가 hub 패키지를 직접 임포트하지 않아도 된다.
	proc := stats.New(svcResolver, func(msg model.OutboundMsg) {
		h.Broadcast(msg)
	})

	h.SetHistoryFn(proc.GetHistory)

	// ── 5. Agent Reader 시작 ───────────────────────────────────────────
	var agentProvider agent.EventProvider = agent.NewSubprocessProvider(agentBinary)
	eventCh, err := agentProvider.Start(ctx)
	if err != nil {
		log.Fatalf("[main] agent 시작 실패: %v", err)
	}
	go proc.Run(eventCh)

	// ── 5b. Resource Agent 시작 ────────────────────────────────────────
	// resource_agent 바이너리가 없으면 경고만 내고 계속 진행한다.
	// 자원 수집 없이도 latency 추적은 정상 동작해야 한다.
	var resProvider resource.ResourceProvider = resource.NewSubprocessProvider(resourceAgentBinary)
	if resCh, resErr := resProvider.Start(ctx); resErr != nil {
		log.Printf("[main] resource_agent 시작 실패 (자원 수집 비활성화): %v", resErr)
	} else {
		proc.ForwardResource(resCh)
	}

	// ── 6. HTTP 서버 ───────────────────────────────────────────────────
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.ServeWs)
	mux.HandleFunc("/", serveHome)

	srv := &http.Server{Addr: listenAddr, Handler: mux}

	go func() {
		log.Printf("[main] collector 시작 — http://localhost%s", listenAddr)
		log.Printf("[main] WebSocket: ws://localhost%s/ws", listenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[main] HTTP 서버 오류: %v", err)
		}
	}()

	// ── 7. 종료 대기 ───────────────────────────────────────────────────
	<-ctx.Done()
	log.Println("[main] 종료 신호 수신, graceful shutdown 시작")
	srv.Shutdown(context.Background())
	log.Println("[main] 종료 완료")
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
