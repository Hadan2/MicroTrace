# Handoff: MicroTrace Dashboard UI (v0.3 — Latency Root-Cause Profiler)

> 이 패키지는 **MicroTrace의 새 포지셔닝 — "Latency Root-Cause Profiler"** 에 맞춰 라이트 테마로 재설계된 대시보드 UI 디자인입니다.
>
> Claude Code 등 AI 개발 도구가 `frontend/src/` 의 기존 React + TypeScript 코드베이스에 이 디자인을 **픽셀 단위로 재구현**하기 위한 명세서 + 레퍼런스 코드입니다.

---

## TL;DR — 이 폴더의 내용

| 파일 | 용도 |
|---|---|
| `README.md` | (이 문서) 전체 디자인 명세 + 구현 가이드 |
| `MicroTrace Dashboard.html` | **개발 모드 진입점** — 6개 JSX/JS 파일을 합쳐서 실행 |
| `MicroTrace Dashboard (standalone).html` | **단일 파일 번들** — 브라우저로 바로 열어 미리보기 가능 |
| `mt-data.js` | 모의 데이터 엔진 (실제 구현 시 `useWebSocket.ts`로 교체) |
| `mt-topology.jsx` | Graph 뷰 — 커스텀 SVG 토폴로지 |
| `mt-views.jsx` | List 뷰 + Matrix(adjacency) 뷰 + ViewSwitcher 탭 |
| `mt-chart.jsx` | Canvas 기반 LatencyChart + ResourceChart + Sparkline |
| `mt-panels.jsx` | GlobalMetrics, DetailPanel, CauseCandidate, SpikeLog |
| `mt-app.jsx` | TopBar, SectionHeader, TweaksPanel, App layout |
| `screenshots/` | 각 뷰의 레퍼런스 스크린샷 |

### 빠르게 디자인 보는 법
1. `MicroTrace Dashboard (standalone).html` 을 브라우저로 열면 **즉시 동작하는 데모**가 보입니다
2. 모의 데이터가 1초 주기로 흐르며, 5~15초마다 스파이크가 발생합니다
3. 토폴로지/리스트/매트릭스 뷰 전환 가능, 엣지 클릭 시 상세 분석 패널 표시

---

## 1. 제품 포지셔닝

> **"느린 호출이 생겼을 때, 네트워크인지 CPU인지 IO인지 가장 먼저 좁혀주는 eBPF 기반 실시간 진단 도구"**

이는 단순한 모니터링 대시보드가 아닙니다. **레이턴시 스파이크 발생 시 원인을 자동 분류해주는 root-cause profiler** 입니다. 디자인의 모든 요소는 이 목적을 지원하도록 설계됐습니다:

- TopBar 부제목: "Latency Root-Cause Profiler"
- DetailPanel 헤더: "Detail · Root-cause Analysis"
- 스파이크 발생 시 **CauseCandidate 배너** — Network / CPU / Disk I/O / Memory / External API 중 하나로 자동 분류
- 노드/리스트/매트릭스 모든 뷰에서 **destination service의 CPU/IO/Memory pressure 함께 표시**
- DetailPanel에서 **Latency 차트 + Resource 차트를 같은 시간축**에 정렬

---

## 2. 기술 스택 가정

| 항목 | 가정 |
|---|---|
| 프레임워크 | React 18 + TypeScript |
| 빌드 | Vite (기존 frontend/ 구조) |
| 스타일 | inline CSS-in-JS (현재) / Tailwind 또는 CSS Modules 어느 쪽도 가능 |
| 차트 | Canvas 직접 그림 (lightweight-charts 의존성 제거) |
| 토폴로지 | 커스텀 SVG (`@xyflow/react` 의존성 제거) |
| 데이터 | 기존 `useWebSocket.ts` 훅 그대로 사용 |

레퍼런스 코드는 **JSX + 인라인 스타일 + `window.*` 글로벌**로 작성되어 있습니다 (Babel standalone에서 동작하기 위함). 실제 구현 시:
- `window.TopoGraph` → `import { TopoGraph } from './components/TopoGraph'`
- `window.MTData.tick()` → `useWebSocket()` 훅
- 인라인 스타일 → 프로젝트 컨벤션에 맞게 변환

---

## 3. Fidelity

**High-fidelity (hifi)** — 색상, 타이포그래피, 간격, 인터랙션 모두 명세대로 구현하세요.  
시각적 결정은 임의로 바꾸지 마세요. 변경하고 싶다면 디자이너에게 먼저 확인.

---

## 4. Design Tokens

### Color System

```css
:root {
  /* Surfaces */
  --bg-base:       #f6f8fb;   /* 전체 페이지 배경 */
  --bg-surface:    #ffffff;   /* 카드, 패널, TopBar */
  --bg-subtle:     #f8fafc;   /* SectionHeader, hover, 보조 카드 */
  --bg-hover:      #f1f5f9;   /* 버튼 hover */

  /* Borders */
  --border:        #e2e8f0;   /* 일반 테두리 */
  --border-strong: #cbd5e1;   /* 강조 테두리, scrollbar */
  --border-soft:   #f1f5f9;   /* 테이블 행 구분 */

  /* Text */
  --text-primary:   #0f172a;  /* 본문, 메트릭 값 */
  --text-secondary: #475569;  /* 서브 레이블 */
  --text-muted:     #64748b;  /* 섹션 레이블, 보조 텍스트 */
  --text-faint:     #94a3b8;  /* 비활성, 타임스탬프 */

  /* Status (latency severity) */
  --green:   #16a34a;   /* P99 < 5ms — OK */
  --yellow:  #d97706;   /* P99 5–20ms — Warning */
  --orange:  #ea580c;   /* P99 20–100ms — High */
  --red:     #dc2626;   /* P99 > 100ms — Critical, Spike */

  /* Accent */
  --blue:    #2563eb;   /* 선택, 액션, 로고, AVG */

  /* Cause classification (root-cause kind) */
  --cause-network:  #2563eb;
  --cause-cpu:      #dc2626;
  --cause-io:       #7c3aed;
  --cause-memory:   #ea580c;
  --cause-external: #d97706;
}
```

### Cause Color Coding (중요)

스파이크의 root cause는 5종류로 분류되며 각각 고정 색상을 가집니다:

| Cause | Color | Icon | Trigger 조건 |
|---|---|---|---|
| **Network**  | `#2563eb` (blue)   | 🌐 | TCP retransmit / RTT 자체 증가 |
| **CPU**      | `#dc2626` (red)    | 🔥 | dst CPU > 70% OR cpu_throttle 발생 |
| **Disk I/O** | `#7c3aed` (purple) | 💾 | dst io_wait > 30% |
| **Memory**   | `#ea580c` (orange) | 🧠 | dst mem_pressure > 70% |
| **External** | `#d97706` (amber)  | 🔌 | dst가 외부 의존성 + baseline > 30ms |

### Typography

```css
/* Family */
--font-ui:    'Inter', system-ui, -apple-system, sans-serif;
--font-mono:  'JetBrains Mono', 'SF Mono', Consolas, monospace;
```

**철칙:** 숫자/메트릭은 **반드시 `font-mono`**, UI 텍스트/레이블은 `font-ui` 사용.

| 용도 | size | weight | family | color |
|---|---|---|---|---|
| 로고 (MicroTrace) | 15px | 600 | mono | text-primary |
| 부제목 (Latency Root-Cause Profiler) | 11px | 500 | ui | text-muted |
| TopBar 시계 | 13px | 600 | mono | text-primary |
| StatCard 레이블 | 9px | 600 | ui (uppercase, letter-spacing 0.04em) | text-muted |
| StatCard 수치 | 18px | 600 | mono | color (status) |
| StatCard sub | 9px | 400 | ui | text-faint |
| SectionHeader 레이블 | 10px | 700 | ui (uppercase, letter-spacing 0.07em) | text-secondary |
| 서비스명 (내부 노드) | 12px | 600 | ui | text-primary |
| 서비스명 (외부 노드) | 11px | 500 | ui | text-muted |
| 엣지 레이턴시 라벨 (Graph) | 10px | 500/600(sel) | mono | status color |
| 테이블 행 (List) | 11–12px | 500/600 | mono(수치)/ui(텍스트) | 상황별 |
| Percentile 카드 수치 | 16px | 600 | mono | status color |
| Spike Log 행 | 10–11px | 500/600 | mono(수치)/ui(텍스트) | 상황별 |

### Spacing & Sizing

```
TopBar height:              50px
GlobalMetrics row padding:  10px 14px
SectionHeader height:       36px (padding 8px 16px)
StatCard padding:           8px 12px, min-width: 120px, border-radius: 8
Panel border-radius:        10px
Card border-radius:         6–8px
Badge/pill border-radius:   10–12px (rounded full)
Topology pane:              flex 0 0 60%
Detail pane:                flex 0 0 40%
Spike Log default height:   168px (tweakable 120–320)
Main padding:               12px (around panels)
Panel gap:                  12px
```

### Shadows

```css
--shadow-card:    0 1px 2px rgba(15,23,42,0.04);
--shadow-card-h:  0 1px 3px <color>22;    /* highlighted StatCard */
--shadow-elev:    0 16px 40px rgba(15,23,42,0.16);  /* TweaksPanel */
```

`drop-shadow` SVG filter는 노드(`feDropShadow dy=1 stdDeviation=2 floodOpacity=0.08`)에 사용.

---

## 5. Overall Layout

```
┌─────────────────────────────────────────────────────────────┐
│ TopBar (50px) — Logo, tagline, connection status, badges, clock │
├─────────────────────────────────────────────────────────────┤
│ GlobalMetrics (~88px) — 6 StatCards (P95, P99, Spikes, Stressed, Retrans, Connections) │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│  Topology Pane (flex 60%)    │  Detail Pane (flex 40%)      │
│  with View Switcher tabs:    │                              │
│   [Graph] [List] [Matrix]    │  - Connection header         │
│                              │  - CauseCandidate (if spike) │
│                              │  - Percentile cards × 4      │
│                              │  - Secondary stats × 4       │
│                              │  - Close states stacked bar  │
│                              │  - Latency chart             │
│                              │  - Resource chart (CPU/IO/M) │
│                              │                              │
├──────────────────────────────┴──────────────────────────────┤
│ Spike Event Log (168px, height-tweakable)                   │
│ Time | Connection | Cause pill | P99 | Multiplier | Time ago │
└─────────────────────────────────────────────────────────────┘
```

전체 구조: `display: flex; flex-direction: column; min-height: 100vh; overflow-y: auto`  
중앙 row(`min-height: 460px`) 가 viewport보다 크면 body 스크롤.

---

## 6. Screens / Views

### 6.1 TopBar

높이 50px, `background: #ffffff`, `border-bottom: 1px solid #e2e8f0`

```
[Logo SVG] MicroTrace v0.3 | Latency Root-Cause Profiler  ●  collector connected  [10 services] [⚡ 1 stressed] [🔴 2 spikes]  ... LIVE  16:06:15
```

**구성요소 (왼→오):**
- **Logo SVG** — 22×22, 파란 원+십자 (블루 `#2563eb`)
- **"MicroTrace"** — mono 15px 600, color text-primary
- **"v0.3"** — mono 10px, color text-faint
- **Divider** — 1px × 22px, `#e2e8f0`
- **"Latency Root-Cause Profiler"** — ui 11px 500, text-muted
- **Connection status pill**:
  - dot 8×8 + box-shadow glow
  - connected: 녹 `#16a34a` + "collector connected"
  - disconnected: 빨강 `#dc2626` + "reconnecting…"
- **Badges**:
  - `{N} services` — neutral pill (`bg #f1f5f9`, `border #cbd5e1`, `color #475569`)
  - `⚡ {N} stressed` — amber pill (`bg #fff7ed`, `border #fed7aa`, `color #ea580c`) — stressedCount > 0 일 때만
  - `🔴 {N} spike(s)` — red pill (`bg #fef2f2`, `border #fecaca`, `color #dc2626`), `animation: blink 1.4s infinite` — spikeCount > 0 일 때만
- **우측 끝**:
  - "LIVE" — ui 10px 500, text-faint
  - 시계 — mono 13px 600, text-primary (HH:MM:SS)

```css
@keyframes blink { 0%,100% {opacity:1} 50% {opacity:0.55} }
```

### 6.2 GlobalMetrics

`background: #ffffff`, `border-bottom: 1px solid #e2e8f0`, `padding: 10px 14px`, `display: flex; gap: 8px; flex-wrap: wrap`

**6개의 StatCard:**

| 카드 | 값 계산 | 색상 | sub | highlight 조건 |
|---|---|---|---|---|
| Global P95 | 전체 연결 p95 평균 | yellow | — | — |
| Global P99 | 전체 연결 p99 평균 | 범위 기반 (g/y/o/r) | — | gp99 > 20ms |
| Active Spikes | is_spike인 연결 수 | red(>0)/faint(0) | `analyzing causes…` or `all normal` | spikes > 0 |
| Stressed Svcs | stress_kind이 있는 서비스 수 | orange(>0)/faint(0) | `CPU:{N} IO:{N} MEM:{N}` | stressed > 0 |
| Retransmits | 전체 retransmit_count 합 | orange(>20)/text-secondary | "cumulative" | — |
| Connections | snapshots 수 | blue | `{N} svcs` | — |

**StatCard 스타일:**
```
background: #ffffff
border: 1px solid #e2e8f0
border-top: 1px solid #e2e8f0 (평상시) | 2px solid {color} (highlight 시)
border-radius: 8px
padding: 8px 12px
min-width: 120px; flex: 1 1 120px
box-shadow: var(--shadow-card)   /* highlight 시 colored shadow */

label: ui 9px 600 uppercase letter-spacing 0.04em, text-muted
value: mono 18px 600, status color
sub:   ui 9px 400, text-faint
```

### 6.3 Service Topology Pane — Three Views

상단에 **SectionHeader + ViewSwitcher** (`Graph | List | Matrix` 세그먼티드 컨트롤).  
하단에 선택된 뷰 렌더.

#### ViewSwitcher (3-tab segmented control)

```
display: inline-flex
background: #f1f5f9
border-radius: 6px
padding: 2px

각 탭 버튼:
  padding: 4px 10px
  border-radius: 4px
  font: ui 10px 600
  display: flex; align-items: center; gap: 5
  active: bg #ffffff, color text-primary, box-shadow: 0 1px 2px rgba(15,23,42,0.08)
  inactive: bg transparent, color text-muted
  + 12×12 icon SVG (graph/list/matrix glyph)
```

#### 6.3.A — **Graph View** (default, ~20 services 적합)

커스텀 SVG. **ReactFlow 사용 안 함.**

**Canvas:**
- `width: 100%, height: 100%`
- 배경 dot grid: `<pattern>` 22×22, 1px dots at `#e2e8f0`
- Padding: PX=58~92(반응형), PY=36~48

**Node 위치 (NODE_POS, 0..1 정규화):**
```js
{
  'api-gateway':   { x: 0.50, y: 0.08 },
  'auth-svc':      { x: 0.18, y: 0.35 },
  'order-svc':     { x: 0.78, y: 0.35 },
  'redis':         { x: 0.05, y: 0.66 },
  'payment-svc':   { x: 0.50, y: 0.64 },
  'inventory-svc': { x: 0.95, y: 0.66 },
  'notif-svc':     { x: 0.78, y: 0.93 },
  'postgres':      { x: 0.28, y: 0.93 },
  'kafka':         { x: 0.96, y: 0.96 },
  'stripe-api':    { x: 0.52, y: 0.93 },
}
```

**노드 (내부 서비스):**
- rect 156×56, rx=8
- fill: #ffffff
- stroke: 평상시 #cbd5e1 / 선택 #2563eb / 스파이크 #dc2626 / **stressed: 점선 stroke `#dc2626`/`#7c3aed`/`#ea580c` (kind별)**
- drop-shadow filter
- 내부: 서비스명 (ui 12px 600, text-primary) + **3개 micro-bar (CPU/IO/MEM)**
  - 각 micro-bar: 36×6 rounded, `#f1f5f9` bg, 채움 비율 = pct%
  - pct > 70% 이거나 IO > 30% 이면 진한 컬러, 아니면 `#94a3b8 + opacity 0.55`
- stressed시 stress halo: `rect + animate opacity 0.7↔0.25`

**노드 (외부 서비스):**
- rect 112×36, rx=8
- fill: #f8fafc, stroke: #cbd5e1 dashed `5,3`
- 내부: 서비스명만 (ui 11px 500, text-muted)

**Edge:**
- Quadratic Bezier, 중점에서 법선으로 26px 오프셋 → 양방향 엣지 분리
- d = `M{src.x},{src.y} Q{cx},{cy} {dst.x},{dst.y}`
- 정상: strokeWidth 1.6 (선택시 2.4), opacity 0.75 (선택시 1.0)
- 스파이크: strokeWidth 2, strokeDasharray 7,4, `<animate stroke-dashoffset>` 0→-22 0.55s repeat, `filter: url(#topo-glow)` (Gaussian blur stdDeviation=2.5)
- arrowhead marker (6×6, 채워진 삼각형, 같은 색)
- 클릭 영역 확보: 동일 path에 `stroke="transparent" strokeWidth=16` (먼저 그림)
- 선택 시 halo: 같은 path에 strokeWidth 7, opacity 0.18

**Edge 라벨 (베지어 t=0.5):**
- 흰 배경 알약: rect 52×15, rx=3, fill #ffffff, stroke=status color (0.8px)
- 텍스트: mono 10px 500(평상시) / 600(선택시), color=status color
- 내용: `fmtUs(p50_us)`

**Legend (좌하단 absolute):**
- white background pill, padding 6px 10px
- 4개 라인 + "external" 표시

#### 6.3.B — **List View** (Datadog-style, 수십~수백 서비스 적합)

확장성 있는 **정렬 가능 테이블**.

**상단 Filter chips:** `padding: 8px 14px`, `border-bottom: 1px solid #e2e8f0`
- `All · {count}` / `🔴 Spiking · {count}` / `⚡ Stressed · {count}`
- pill 형태: 4px 10px, border-radius 12, ui 10px 600
- active: `border #2563eb, bg #eff6ff, color #2563eb`
- inactive: `border #e2e8f0, bg #ffffff, color #475569`
- 우측: "click column header to sort" (ui 10px, text-faint)

**테이블 헤더 (sticky):**
- `background: #f8fafc`, `border-bottom: 1px solid #e2e8f0`
- 각 셀: padding 7px 10px, ui 10px 700 uppercase letter-spacing 0.05em, text-secondary
- 정렬 가능 컬럼은 cursor pointer, 정렬된 컬럼에 `▲`/`▼` (blue, 9px)

**컬럼 구성:**
| Column | Width | Align | Content |
|---|---|---|---|
| Connection | auto | left | `[spike dot] {src} → {dst} [EXT 뱃지(외부일 때)]` |
| P50 | 70 | right | mono 11, text-secondary |
| P95 | 70 | right | mono 11, text-secondary |
| P99 | 80 | right | mono 12 600, status color |
| Trend | 90 | center | 30포인트 sparkline (70×20 SVG polyline, status color) |
| Retrans | 60 | right | mono 11, orange(>10)/faint |
| Dst Resources | 130 | left | 3개 mini-bar (CPU/IO/MEM, 각 26×5) |
| Status | 90 | center | Cause pill OR latency status pill |

**행:**
- `cursor: pointer`, `transition: background 0.12s`
- hover: bg `#f8fafc`
- 선택: bg `#eff6ff`, border-left `3px solid #2563eb`
- `border-bottom: 1px solid #f1f5f9`

**Status 셀:**
- 스파이크: cause pill (배경 `{color}14`, border `{color}40`, color, icon + label)
- 정상: latency status pill (배경 `V_STATUS_BG[s]`, color)

```js
V_STATUS_BG = {
  ok:       '#dcfce7',
  warning:  '#fef3c7',
  high:     '#fed7aa',
  critical: '#fee2e2',
}
```

#### 6.3.C — **Heatmap Matrix View** (인접행렬, dense 환경 적합)

**상단 toolbar:**
- 좌측: "Adjacency matrix — row=source, column=destination, color=P99" (ui 10px 600, text-muted)
- 우측: 4개 색상 legend (12×12 sq + 라벨)

**Matrix:**
- 첫 행: 열 라벨 (목적지 서비스), 텍스트 -55deg 회전 (`transform-origin: left bottom`), mono 10
- 첫 열: 행 라벨 (출발지 서비스), mono 11, right align
- 셀: 30×30, margin 1px, rounded 3px

**셀 색상:**
- 연결이 있으면: `background = STATUS_COLOR[latencyStatus(p99)]`
- 연결 없으면: `bg #f8fafc, border #f1f5f9`
- 선택: `border 2px solid #0f172a`, `box-shadow 0 0 0 2px #2563eb55`
- 스파이크: `border 2px solid #dc2626`, `animation: matrixPulse 1.2s infinite`, 우상단 6×6 흰 dot 표시

```css
@keyframes matrixPulse {
  0%,100% { box-shadow: 0 0 0 0 #dc262644 }
  50%     { box-shadow: 0 0 0 3px #dc262622 }
}
```

**호버 시 tooltip:**
- `title` 속성: `{src} → {dst}\nP99 {value} · {status or SPIKE}`

**Stressed 서비스 라벨:**
- 행/열 라벨 색상이 `text-primary` → `#dc2626` 으로, weight 500 → 600 으로 변경

### 6.4 DetailPanel (Root-cause Analysis)

`background: #ffffff`, border + radius, 우측 패널 전체 차지.

**비선택 상태:**
- 가운데 정렬 안내: 큰 원형 SVG 아이콘 + "연결을 선택하세요" + "토폴로지에서 엣지를 클릭하면 latency + 리소스 상관관계를 분석합니다"

**선택 상태 (위→아래 순서):**

#### a) Connection Header
```
padding: 14px 16px 12px
border-bottom: 1px solid #e2e8f0

CONNECTION (label, uppercase 0.05em, 10px 600 text-muted)
{src_service}  →  {dst_service}    ✕
(mono 13 600 text-primary, → 화살표 SVG 14×10 #94a3b8)
```

#### b) CauseCandidate Banner (스파이크일 때만)
```
margin: 10px 14px 0
padding: 12px 14px
background: linear-gradient(135deg, {causeColor}0d, {causeColor}05)
border: 1px solid {causeColor}40
border-left: 3px solid {causeColor}
border-radius: 8px

상단 한 줄: [icon] [ROOT CAUSE CANDIDATE label, 10px 600 text-muted] ............... [{N}× baseline, mono 10 600 red]
중간: {cause label, ui 14 600, causeColor}
하단 1: {desc, ui 11, text-secondary}
하단 2: evidence chips (있을 때)
  - "CPU: 87%", "IO wait: 45%", "Mem: 78%", "Retrans: 5"
  - 각 chip: ui 10 500 padding 2px 8px, bg #ffffff, border {causeColor}40, color {causeColor}, 숫자는 mono
```

**Cause descriptions:**
- network: "TCP/네트워크 지연 또는 재전송"
- cpu: "CPU throttling 또는 포화"
- io: "I/O wait 대기 시간 증가"
- memory: "Memory pressure 발생"
- external: "외부 의존성 지연"

#### c) Percentile Cards (4×grid)
```
padding: 12px 14px 8px
display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px

각 카드:
  background: #f8fafc
  border: 1px solid #e2e8f0
  border-radius: 6px
  padding: 8px 6px
  text-align: center

  label: ui 9 600 uppercase letter-spacing 0.05em text-muted
  value: mono 16 600, color = AVG:blue / P50:green / P95:yellow / P99:status-based
```

#### d) Secondary Metrics (4×grid)
```
padding: 0 14px 10px
display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px

각 셀:
  background: #ffffff
  border: 1px solid #e2e8f0
  border-radius: 6px
  padding: 7px 9px

  label: ui 9 600 uppercase letter-spacing 0.05em text-faint
  value: mono 13 500, status color
```

4개: Jitter / Retransmits / Error Rate (RST+Timeout / total) / Samples

#### e) Close States Stacked Bar (close_total > 0 일 때만)
```
padding: 0 14px 10px

label: "Close states · {total} total" (ui 9 600 uppercase, text-muted)
bar: height 8, border-radius 4, bg #f1f5f9
  FIN segment (green), RST (red), Timeout (orange), 비율대로 채움

레전드: 3개 (7×7 사각형 + UPPERCASE + 숫자)
```

#### f) Latency Chart
```
header row:
  "Latency" (uppercase label) + 4-line legend (AVG dashed blue, P50 green, P95 yellow, P99 orange)
chart: height 140, Canvas 기반
```

#### g) Resource Chart (correlated)
```
header row:
  "{dst_service} · Resources" + 3-line legend (CPU red, IO wait purple, Mem orange)
chart: height 120, Canvas 기반, Y축 고정 0-100%, 70% 가이드라인 (점선 빨강)
```

**핵심 디자인 의도:** Latency 차트와 Resource 차트가 **세로로 정렬**되어 동일 시간축에서 비교 가능. 사용자는 latency spike가 발생한 시점에 CPU/IO가 어떻게 변했는지 한눈에 확인.

### 6.5 Latency Chart (Canvas)

`background: #ffffff`, padding `{top:10, right:14, bottom:22, left:56}`

- Y축: 4 grid lines, 자동 스케일 (max × 1.15, min × 0.85, 최소 500µs 범위)
- Y label: mono 9, text-faint, `fmtYLabel()` (µs/ms/s 자동)
- X축: 3 tick (시작/중간/끝), `HH:MM:SS`
- 그리는 순서:
  1. `#ffffff` 배경
  2. Spike overlay (`rgba(220,38,38,0.04)`, 우측 18%, isSpike일 때)
  3. Jitter band (P50 ± jitter/2, `rgba(37,99,235,0.08)`)
  4. AVG (blue dashed 4,3 width 1.2) → P50 (green 1.8) → P95 (yellow 1.8) → P99 (orange/red 2.4)
  5. X labels
  6. Border `#e2e8f0`

데이터: `history.slice(-180)` (최근 180포인트, 약 3분)

### 6.6 Resource Chart (Canvas)

Latency Chart와 동일한 패딩/스타일, 차이점:
- Y축 고정 0~100%, 3개 grid (0/50/100)
- 70% 가이드라인 (red dashed)
- 3개 라인: CPU red / IO wait purple / Mem orange (모두 width 2)
- 좌상단에 label 텍스트 (옵션)

### 6.7 Spike Event Log

`background: #ffffff`, `border-top: 1px solid #e2e8f0`, height tweakable (120~320px, default 168)

**비어있을 때:** "● 스파이크 이벤트 없음 — 모든 연결 정상" (가운데 정렬, green dot + text-faint)

**이벤트 행:**
```
padding: 7px 16px
border-bottom: 1px solid #f1f5f9
display: flex; align-items: center; gap: 12px
cursor: default
hover: bg #f8fafc

[severity dot 7×7, glow 5px]
[HH:MM:SS, mono 10 text-faint, width 72]
[{src} → {dst}, mono 11 text-primary]
[Cause pill, 색상별]
............ flex spacer ............
[P99 {value}, mono 11 600 (critical: red / warning: yellow)]
[{N}× pill — critical:red bg / warning:yellow bg]
[{N}s ago, ui 10 text-faint, width 56, right]
```

severity: `p99 > 80000` → critical(red), else warning(yellow)

최신 이벤트가 맨 위, 최대 100개 보관 (FIFO).

### 6.8 TweaksPanel (Toolbar 토글 시)

`position: fixed, bottom: 24, right: 24, width: 260`  
`background: #ffffff, border: 1px solid #cbd5e1, border-radius: 10, box-shadow: 0 16px 40px rgba(15,23,42,0.16)`  
`padding: 14px 16px`

3개 tweak:
- Tick interval (slider 200~3000ms, step 100)
- Show external (checkbox)
- Log height (slider 120~320px, step 20)

각 행: padding 8px 0, border-bottom #e2e8f0. label ui 11 500 text-secondary. 값 표시 mono 10 blue.

### 6.9 SectionHeader (공통)

```
height: 36px
padding: 8px 16px
background: #f8fafc
border-bottom: 1px solid #e2e8f0
display: flex; align-items: center; gap: 8px

label: ui 10 700 uppercase letter-spacing 0.07em, text-secondary
count badge (optional): ui mono 10 600 padding 1px 8px, bg #ffffff border #e2e8f0 rounded-full
우측 children: margin-left: auto
```

---

## 7. Interactions & Behavior

### 뷰 전환
- ViewSwitcher 클릭 → `viewMode` state: `'graph' | 'list' | 'matrix'`
- 선택된 엣지(`selectedKey`)는 모든 뷰에서 유지됨 → 뷰 전환해도 선택 상태 보존
- Graph: 노드/엣지 SVG | List: 테이블 행 | Matrix: 셀

### Entity 선택 (모든 뷰에서)
- Graph: 엣지 path 클릭
- List: 테이블 행 클릭
- Matrix: 셀 클릭
- 모두 `selectedKey` state 업데이트 → DetailPanel 표시
- 빈 영역 클릭 (Graph) → 선택 해제
- DetailPanel의 ✕ 버튼 → 선택 해제

### List 뷰 인터랙션
- 컬럼 헤더 클릭 → 정렬: 같은 컬럼 재클릭 시 asc/desc 토글, 다른 컬럼 클릭 시 desc로 초기화
- Filter chip 클릭 → All / Spiking / Stressed 필터

### Matrix 뷰 인터랙션
- 셀 hover → 브라우저 tooltip (`title` 속성)
- 셀 클릭 → 해당 connection 선택

### 실시간 업데이트
- WebSocket `stats` 메시지 → 1초 주기로 `snapshots` state 업데이트
- 모든 뷰 자동 리렌더
- 차트에 새 포인트 append (`history.slice(-300)`, 표시는 -180)

### 스파이크 감지 → 자동 분류
- 클라이언트 또는 collector에서 `is_spike: false → true` 전환 시 `cause_kind` 추론:

```typescript
function classifyCause(snap: StatSnapshot, dstService: ServiceSnapshot): CauseKind {
  if (snap.dst_type === 'external' && snap.baseline_us > 30000) return 'external'
  if (dstService?.stress_kind === 'cpu')    return 'cpu'
  if (dstService?.stress_kind === 'io')     return 'io'
  if (dstService?.stress_kind === 'memory') return 'memory'
  return 'network'  // default
}
```

규칙은 우선순위 순. 더 정교한 분류는 Phase 3에서 collector 측 상관 분석으로 발전.

### TweaksPanel 프로토콜 (Tweaks 토글)
```typescript
window.addEventListener('message', e => {
  if (e.data?.type === '__activate_edit_mode')   setTweaksVisible(true)
  if (e.data?.type === '__deactivate_edit_mode') setTweaksVisible(false)
})
window.parent.postMessage({ type: '__edit_mode_available' }, '*')

// 닫기 시
window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*')

// 값 변경 시
window.parent.postMessage({ type: '__edit_mode_set_keys', edits: nextState }, '*')
```

---

## 8. State Management

기존 `frontend/src/types.ts` + `useWebSocket.ts` 를 기반으로 확장.

```typescript
// types.ts에 추가
export type CauseKind = 'network' | 'cpu' | 'io' | 'memory' | 'external'
export type StressKind = 'cpu' | 'io' | 'memory' | null

export interface StatSnapshot {
  // 기존 필드 유지
  src_service: string
  dst_service: string
  src_type: 'internal' | 'external'
  dst_type: 'internal' | 'external'
  avg_us: number
  p50_us: number
  p95_us: number
  p99_us: number
  jitter_us: number
  retransmit_count: number
  sample_count: number
  is_spike: boolean
  spike_threshold_us: number

  // 신규 — Phase 2 기획서 반영
  cause_kind?: CauseKind          // 스파이크 시 분류
  close_states: {
    fin: number
    rst: number
    timeout: number
  }
  // dst 서비스 리소스 스냅샷 (correlated monitoring)
  dst_cpu_pct: number
  dst_io_wait_pct: number
  dst_mem_pressure_pct: number
}

export interface ServiceSnapshot {
  name: string
  cpu_pct: number
  io_wait_pct: number
  mem_pressure_pct: number
  cpu_throttle_pct: number
  stress_kind: StressKind
  history: ResourcePoint[]
}

export interface ResourcePoint {
  time: number
  cpu_pct: number
  io_wait_pct: number
  mem_pressure_pct: number
  cpu_throttle_pct: number
}

export interface SpikeEvent {
  id: string
  timestamp: number
  key: string  // "src→dst"
  src: string
  dst: string
  p99_us: number
  baseline_us: number
  severity: 'warning' | 'critical'
  cause_kind: CauseKind
  // 그 시점 dst 리소스 스냅샷
  dst_cpu_pct: number
  dst_io_wait_pct: number
  dst_mem_pressure_pct: number
}

// useWebSocket.ts 확장: services map 추가
export function useWebSocket(url: string) {
  const [snapshots, setSnapshots] = useState<Record<string, StatSnapshot>>({})
  const [services, setServices]   = useState<Record<string, ServiceSnapshot>>({})
  const [history, setHistory]     = useState<Record<string, HistoryPoint[]>>({})
  const [events, setEvents]       = useState<SpikeEvent[]>([])
  // ...
}
```

### App.tsx 새 구조

```typescript
import { useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import TopBar from './components/TopBar'
import GlobalMetrics from './components/GlobalMetrics'
import SectionHeader from './components/SectionHeader'
import ViewSwitcher from './components/ViewSwitcher'
import TopoGraph from './components/TopoGraph'
import ConnectionListView from './components/ConnectionListView'
import HeatmapMatrixView from './components/HeatmapMatrixView'
import DetailPanel from './components/DetailPanel'
import SpikeLog from './components/SpikeLog'

export default function App() {
  const { snapshots, services, events, connected } = useWebSocket(WS_URL)
  const [selectedKey, setSelected] = useState<string | null>(null)
  const [viewMode, setViewMode]    = useState<'graph'|'list'|'matrix'>('graph')

  const selectedSnap = selectedKey ? snapshots[selectedKey] : null
  const dstService   = selectedSnap ? services[selectedSnap.dst_service] : null

  return (
    <div className="app">
      <TopBar connected={connected} ... />
      <GlobalMetrics snapshots={snapshots} services={services} />
      <div className="middle">
        <div className="topology-pane">
          <SectionHeader label="Service Topology" count={`${len} edges`}>
            <ViewSwitcher value={viewMode} onChange={setViewMode} />
          </SectionHeader>
          {viewMode === 'graph'  && <TopoGraph ... />}
          {viewMode === 'list'   && <ConnectionListView ... />}
          {viewMode === 'matrix' && <HeatmapMatrixView ... />}
        </div>
        <div className="detail-pane">
          <SectionHeader label="Detail · Root-cause Analysis" />
          <DetailPanel snap={selectedSnap} dstService={dstService} onClose={() => setSelected(null)} />
        </div>
      </div>
      <div className="spike-log-pane">
        <SectionHeader label="Spike Event Log" count={events.length} />
        <SpikeLog events={events} />
      </div>
    </div>
  )
}
```

---

## 9. Utility Functions

```typescript
export function fmtUs(us: number): string {
  if (us >= 1_000_000) return `${(us / 1_000_000).toFixed(1)}s`
  if (us >= 1000)      return `${(us / 1000).toFixed(us >= 10_000 ? 1 : 2)}ms`
  return `${Math.round(us)}µs`
}

export function fmtYLabel(us: number): string {
  if (us >= 1_000_000) return `${(us/1_000_000).toFixed(1)}s`
  if (us >= 1000)      return `${(us/1000).toFixed(us>=10_000?0:1)}ms`
  return `${Math.round(us)}µs`
}

export function fmtTime(ms: number): string {
  const d = new Date(ms)
  return d.toTimeString().slice(0, 8)
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function latencyStatus(p99_us: number): 'ok' | 'warning' | 'high' | 'critical' {
  if (p99_us < 5_000)   return 'ok'
  if (p99_us < 20_000)  return 'warning'
  if (p99_us < 100_000) return 'high'
  return 'critical'
}

export const STATUS_COLOR = {
  ok:       '#16a34a',
  warning:  '#d97706',
  high:     '#ea580c',
  critical: '#dc2626',
} as const

export const STATUS_BG = {
  ok:       '#dcfce7',
  warning:  '#fef3c7',
  high:     '#fed7aa',
  critical: '#fee2e2',
} as const

export const CAUSE_META = {
  network:  { label: 'Network',  color: '#2563eb', icon: '🌐', desc: 'TCP/네트워크 지연 또는 재전송' },
  cpu:      { label: 'CPU',      color: '#dc2626', icon: '🔥', desc: 'CPU throttling 또는 포화' },
  io:       { label: 'Disk I/O', color: '#7c3aed', icon: '💾', desc: 'I/O wait 대기 시간 증가' },
  memory:   { label: 'Memory',   color: '#ea580c', icon: '🧠', desc: 'Memory pressure 발생' },
  external: { label: 'External API', color: '#d97706', icon: '🔌', desc: '외부 의존성 지연' },
} as const
```

---

## 10. Integration Notes for Existing Codebase

### 제거할 의존성
```bash
# package.json에서 제거
- "@xyflow/react"   # ReactFlow → 커스텀 SVG로 대체
# (lightweight-charts는 유지 또는 Canvas로 대체 — 둘 다 가능)
```

### 제거/교체할 파일
- `frontend/src/components/TopologyGraph.tsx` → `TopoGraph.tsx` (SVG)
- `frontend/src/components/TopologyTest.tsx` → 삭제
- `frontend/src/components/LatencyChart.tsx` → 유지 가능 (lightweight-charts 그대로 쓰거나 Canvas 재구현)
- `frontend/src/components/DetailPanel.tsx` → 전면 재구현 (CauseCandidate 추가)
- `frontend/src/App.css` → CSS 변수 추가, Tailwind 클래스 정리

### 추가할 파일
```
frontend/src/components/
  TopBar.tsx
  GlobalMetrics.tsx
  StatCard.tsx
  SectionHeader.tsx
  ViewSwitcher.tsx
  TopoGraph.tsx           ← Graph 뷰 (SVG, 기존 TopologyGraph 대체)
  ConnectionListView.tsx  ← List 뷰
  HeatmapMatrixView.tsx   ← Matrix 뷰
  ResourceChart.tsx       ← 신규 (Canvas)
  CauseCandidate.tsx
  SpikeLog.tsx
  TweaksPanel.tsx (선택)

frontend/src/constants/
  topology.ts             ← NODE_POS, STATUS_COLOR 등
  causes.ts               ← CAUSE_META

frontend/src/utils/
  format.ts               ← fmtUs, fmtTime 등
```

### CSS 전략 옵션
1. **CSS variables in `index.css`** + Tailwind 또는 styled-components (추천)
2. **CSS Modules** per component
3. **inline style** (레퍼런스 코드 방식 — 빠르지만 유지보수 어려움)

어느 쪽이든 위 § 4의 토큰 정의를 그대로 적용하세요.

---

## 11. Reference Files

이 폴더의 JSX 파일들은 **레퍼런스 구현**입니다. 실제 동작하는 컴포넌트이므로, 이해가 안 되는 부분이 있으면 해당 JSX를 직접 읽어보세요.

| 레퍼런스 | 매핑되는 새 컴포넌트 |
|---|---|
| `mt-app.jsx > App` | `App.tsx` |
| `mt-app.jsx > TopBar` | `TopBar.tsx` |
| `mt-app.jsx > SectionHeader` | `SectionHeader.tsx` |
| `mt-app.jsx > TweaksPanel` | `TweaksPanel.tsx` (선택) |
| `mt-topology.jsx > TopoGraph` | `TopoGraph.tsx` |
| `mt-topology.jsx > ServiceNode` | `TopoGraph.tsx` 내부 컴포넌트 |
| `mt-views.jsx > ConnectionListView` | `ConnectionListView.tsx` |
| `mt-views.jsx > HeatmapMatrixView` | `HeatmapMatrixView.tsx` |
| `mt-views.jsx > ViewSwitcher` | `ViewSwitcher.tsx` |
| `mt-views.jsx > MiniSpark` | `Sparkline.tsx` (`<svg polyline>`) |
| `mt-chart.jsx > LatencyChart` | `LatencyChart.tsx` (Canvas) |
| `mt-chart.jsx > ResourceChart` | `ResourceChart.tsx` (Canvas) |
| `mt-panels.jsx > GlobalMetrics` | `GlobalMetrics.tsx` |
| `mt-panels.jsx > StatCard` | `StatCard.tsx` |
| `mt-panels.jsx > CauseCandidate` | `CauseCandidate.tsx` |
| `mt-panels.jsx > DetailPanel` | `DetailPanel.tsx` |
| `mt-panels.jsx > SpikeLog` | `SpikeLog.tsx` |
| `mt-data.js` | `useWebSocket.ts` 확장 (data structure 참고용) |

---

## 12. Quick Start Prompt for Claude Code

```
첨부된 `design_handoff_microtrace/` 폴더를 읽고,
1. `MicroTrace Dashboard (standalone).html` 을 브라우저로 열어 디자인 확인
2. `README.md` 의 명세를 정확히 따라
3. `frontend/src/` 에 React + TypeScript 컴포넌트로 재구현

요구사항:
- ReactFlow 의존성 제거하고 커스텀 SVG로 토폴로지 구현
- 3가지 뷰 (Graph/List/Matrix) 모두 구현
- 기존 useWebSocket.ts 훅을 확장하여 services map + spike events 추가
- types.ts 에 CauseKind, StressKind, ServiceSnapshot 등 추가
- 색상/타이포/간격은 README §4 의 design token을 정확히 따를 것
- 인라인 스타일이 아닌 CSS 변수 + Tailwind 또는 CSS Modules 사용 권장

레퍼런스 JSX는 동작하는 코드이지만, 그대로 옮기지 말고
TypeScript + 프로젝트 컨벤션에 맞게 재구성하세요.
```

---

## 13. 추가 확장 아이디어 (선택)

기획서나 사용자 피드백을 받은 후 단계적으로 추가 가능:

- **Tree/Tier 뷰**: gateway → app → data 계층으로 자동 그룹화
- **Sankey diagram**: 트래픽 양을 두께로 시각화
- **Service search & highlight**: regex 또는 fuzzy match
- **Time range selector**: SpikeLog 또는 차트에 1m/5m/15m/1h 토글
- **Drill-down**: 스파이크 클릭 → 그 시점의 raw 이벤트 timeline
- **Saved views**: filter/sort 상태 URL에 직렬화
- **Dark theme 지원**: `:root[data-theme="dark"]` 변수 오버라이드 (이 디자인은 라이트 기본, 다크 옵션 추가는 토큰 시스템 덕에 쉬움)

---

## 14. Open Questions for Designer

구현 중 모호하면 이 문서를 업데이트해야 할 항목:

- [ ] List 뷰에 **그룹핑** (by source service) 옵션 추가할지?
- [ ] Matrix 뷰의 셀 크기를 dynamic하게 조정 (서비스 수에 따라)?
- [ ] DetailPanel을 **expandable/collapsible**로 만들지, 아니면 sidebar에서 풀스크린 모달로?
- [ ] SpikeLog에서 이벤트 행을 클릭하면 어떻게 동작? (현재는 클릭 핸들러 없음 — 해당 연결 선택 + 그 시점으로 차트 점프?)
- [ ] Tweaks 패널을 실제 운영 빌드에서도 노출할지?
- [ ] 한국어/영어 i18n 지원 필요한지? (현재는 한국어 일부 혼용)
