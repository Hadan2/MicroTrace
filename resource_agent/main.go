// resource_agent/main.go
//
// 역할: Docker 컨테이너별 cgroup v2 파일을 읽어 자원 사용량을 수집하고,
//       1초(기본값, COLLECT_INTERVAL_MS 환경변수로 변경 가능)마다 JSON을 stdout으로 출력한다.
//
// 아키텍처:
//   - collector/agent/reader.go가 이 프로세스를 subprocess로 실행한다.
//   - stdout → collector의 chan model.ResourceSnapshot
//   - Docker API: 컨테이너 목록 + PID 조회
//   - /proc/<pid>/cgroup: cgroup v2 경로 동적 탐색 (하드코딩 없음)
//   - /sys/fs/cgroup/<path>/{cpu.stat, memory.current, memory.events, io.stat}

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	dockerclient "github.com/moby/moby/client"
)

// collectInterval — 수집 주기. 환경변수 COLLECT_INTERVAL_MS로 덮어쓸 수 있다.
const defaultIntervalMs = 1000

// ResourceSnapshot — stdout에 출력되는 JSON 구조체
// collector/model/event.go의 ResourceSnapshot과 필드가 일치해야 한다.
type ResourceSnapshot struct {
	ServiceName      string  `json:"service_name"`
	TimestampMs      int64   `json:"timestamp_ms"`
	CPUPct           float64 `json:"cpu_pct"`
	CPUThrottlePct   float64 `json:"cpu_throttle_pct"`
	MemCurrentBytes  uint64  `json:"mem_current_bytes"`
	MemLimitBytes    uint64  `json:"mem_limit_bytes"`
	MemPressurePct   float64 `json:"mem_pressure_pct"`
	IOReadBytesPerS  uint64  `json:"io_read_bytes_per_s"`
	IOWriteBytesPerS uint64  `json:"io_write_bytes_per_s"`
	IOWaitPct        float64 `json:"io_wait_pct"`
	OOMKillCount     uint64  `json:"oom_kill_count"`

	// PSI (Pressure Stall Information) — memory.pressure 파일에서 읽음.
	// some: 최소 1개 태스크가 메모리 때문에 멈춘 시간 비율 (avg10, 최근 10초 평균)
	// full: 모든 태스크가 동시에 멈춘 시간 비율 (avg10)
	PSIMemSomePct float64 `json:"psi_mem_some_pct"`
	PSIMemFullPct float64 `json:"psi_mem_full_pct"`
}

// cpuPrev — CPU delta 계산을 위한 이전 tick 상태
type cpuPrev struct {
	usageUsec    uint64
	throttledUs  uint64
	nrThrottled  uint64
}

// ioPrev — IO delta 계산을 위한 이전 tick 상태
type ioPrev struct {
	rbytes uint64
	wbytes uint64
}

// memPrev — memory.events delta 계산을 위한 이전 tick 상태
type memPrev struct {
	high    uint64
	oomKill uint64
}

// containerState — 컨테이너별 이전 tick 상태
type containerState struct {
	cpuPrev cpuPrev
	ioPrev  ioPrev
	memPrev memPrev
	hasPrev bool // 첫 tick은 delta를 계산할 수 없으므로 스킵
}

func main() {
	interval := resolveInterval()

	cli, err := dockerclient.NewClientWithOpts(dockerclient.FromEnv, dockerclient.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatalf("[resource_agent] Docker 클라이언트 초기화 실패: %v", err)
	}
	defer cli.Close()

	// 컨테이너별 이전 tick 상태 보관
	stateMap := make(map[string]*containerState) // key = container name

	stdout := bufio.NewWriter(os.Stdout)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	log.Printf("[resource_agent] 시작 — 수집 주기: %v", interval)

	for range ticker.C {
		collect(cli, stateMap, stdout, interval)
	}
}

// resolveInterval — 환경변수 COLLECT_INTERVAL_MS를 읽어 수집 주기를 결정한다.
func resolveInterval() time.Duration {
	if v := os.Getenv("COLLECT_INTERVAL_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
		log.Printf("[resource_agent] COLLECT_INTERVAL_MS 파싱 실패, 기본값 %dms 사용", defaultIntervalMs)
	}
	return defaultIntervalMs * time.Millisecond
}

// collect — 전체 컨테이너를 한 번 순회하며 스냅샷을 수집하고 stdout으로 출력한다.
func collect(cli *dockerclient.Client, stateMap map[string]*containerState, w *bufio.Writer, interval time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	result, err := cli.ContainerList(ctx, dockerclient.ContainerListOptions{})
	if err != nil {
		log.Printf("[resource_agent] 컨테이너 목록 조회 실패: %v", err)
		return
	}

	now := time.Now().UnixMilli()
	intervalSec := interval.Seconds()

	for _, c := range result.Items {
		name := containerName(c.Names)
		if name == "" {
			continue
		}

		cgroupPath, err := resolveCgroupPath(c.ID, cli)
		if err != nil {
			log.Printf("[resource_agent] %s: cgroup 경로 탐색 실패: %v", name, err)
			continue
		}

		st, ok := stateMap[name]
		if !ok {
			st = &containerState{}
			stateMap[name] = st
		}

		snap, err := readSnapshot(name, cgroupPath, st, now, intervalSec)
		if err != nil {
			log.Printf("[resource_agent] %s: 스냅샷 수집 실패: %v", name, err)
			continue
		}
		if snap == nil {
			// 첫 tick — 기준값만 저장하고 출력하지 않음
			continue
		}

		data, err := json.Marshal(snap)
		if err != nil {
			log.Printf("[resource_agent] %s: JSON 직렬화 실패: %v", name, err)
			continue
		}

		fmt.Fprintf(w, "%s\n", data)
	}

	// 한 tick 안의 모든 컨테이너를 처리한 뒤 한 번만 Flush
	if err := w.Flush(); err != nil {
		log.Printf("[resource_agent] stdout flush 실패: %v", err)
	}
}

// containerName — Docker 컨테이너 이름 목록에서 첫 번째 이름을 정리해서 반환한다.
// Docker는 이름 앞에 "/" 를 붙이는 경우가 있다.
func containerName(names []string) string {
	if len(names) == 0 {
		return ""
	}
	return strings.TrimPrefix(names[0], "/")
}

// resolveCgroupPath — Docker inspect → PID → /proc/<pid>/cgroup → cgroup v2 경로를 찾는다.
//
// cgroup v2는 항상 "0::/<path>" 형태 한 줄만 존재한다.
// 하드코딩 없이 /proc에서 항상 동적으로 계산한다.
func resolveCgroupPath(containerID string, cli *dockerclient.Client) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	info, err := cli.ContainerInspect(ctx, containerID, dockerclient.ContainerInspectOptions{})
	if err != nil {
		return "", fmt.Errorf("inspect 실패: %w", err)
	}

	pid := info.Container.State.Pid
	if pid == 0 {
		return "", fmt.Errorf("컨테이너가 실행 중이 아님 (pid=0)")
	}

	cgroupFile := fmt.Sprintf("/proc/%d/cgroup", pid)
	f, err := os.Open(cgroupFile)
	if err != nil {
		return "", fmt.Errorf("/proc/%d/cgroup 열기 실패: %w", pid, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		// cgroup v2: "0::/<path>"
		if strings.HasPrefix(line, "0::") {
			relPath := strings.TrimPrefix(line, "0::")
			return "/sys/fs/cgroup" + relPath, nil
		}
	}

	return "", fmt.Errorf("cgroup v2 항목을 찾지 못함 (pid=%d)", pid)
}

// readSnapshot — cgroup 파일 4개를 읽어 ResourceSnapshot을 생성한다.
//
// 첫 호출 시에는 기준값만 저장하고 nil을 반환한다 (delta 계산 불가).
// 두 번째 호출부터 초당 비율로 변환된 스냅샷을 반환한다.
func readSnapshot(name, cgroupPath string, st *containerState, nowMs int64, intervalSec float64) (*ResourceSnapshot, error) {
	// ── CPU stat ──────────────────────────────────────────────────────────
	cpuCur, err := readCPUStat(cgroupPath)
	if err != nil {
		return nil, fmt.Errorf("cpu.stat: %w", err)
	}

	// ── Memory ────────────────────────────────────────────────────────────
	memCur, err := readUint64File(cgroupPath + "/memory.current")
	if err != nil {
		return nil, fmt.Errorf("memory.current: %w", err)
	}
	memLimit, _ := readUint64File(cgroupPath + "/memory.max") // "max" 문자열이면 0으로 처리

	memEvCur, err := readMemoryEvents(cgroupPath)
	if err != nil {
		return nil, fmt.Errorf("memory.events: %w", err)
	}

	// ── IO stat ───────────────────────────────────────────────────────────
	ioCur, err := readIOStat(cgroupPath)
	if err != nil {
		return nil, fmt.Errorf("io.stat: %w", err)
	}

	// ── IO wait (/proc/stat) ──────────────────────────────────────────────
	ioWaitPct, err := readIOWaitPct()
	if err != nil {
		// IO wait는 선택적 — 실패해도 나머지 지표는 출력한다
		log.Printf("[resource_agent] %s: io_wait 수집 실패: %v", name, err)
		ioWaitPct = 0
	}

	// ── PSI memory.pressure ───────────────────────────────────────────────
	// some avg10: 최근 10초 중 최소 1개 태스크가 메모리 때문에 stall된 시간 비율
	// full avg10: 최근 10초 중 모든 태스크가 동시에 stall된 시간 비율
	// 파일이 없는 커널(< 4.20)이나 설정에 따라 없을 수 있으므로 선택적으로 처리
	psiSome, psiFull := readPSIMemory(cgroupPath)

	if !st.hasPrev {
		// 첫 tick: 기준값 저장만 하고 반환하지 않음
		st.cpuPrev = cpuCur
		st.ioPrev  = ioCur
		st.memPrev = memEvCur
		st.hasPrev = true
		return nil, nil
	}

	// ── Delta 계산 ────────────────────────────────────────────────────────
	// CPU 사용률: (delta usage_usec / interval_usec) × 100
	deltaUsage := safeDeltaU64(cpuCur.usageUsec, st.cpuPrev.usageUsec)
	intervalUsec := intervalSec * 1_000_000
	cpuPct := clamp100(float64(deltaUsage) / intervalUsec * 100)

	// CPU 스로틀 비율: delta throttled_usec / interval_usec
	deltaThrottled := safeDeltaU64(cpuCur.throttledUs, st.cpuPrev.throttledUs)
	cpuThrottlePct := clamp100(float64(deltaThrottled) / intervalUsec * 100)

	// IO 처리량
	deltaRBytes := safeDeltaU64(ioCur.rbytes, st.ioPrev.rbytes)
	deltaWBytes := safeDeltaU64(ioCur.wbytes, st.ioPrev.wbytes)
	ioReadPerS := uint64(float64(deltaRBytes) / intervalSec)
	ioWritePerS := uint64(float64(deltaWBytes) / intervalSec)

	// 메모리 압력: high 이벤트 발생 여부를 0-100 지수로 표현
	// high 이벤트가 1이상 발생했으면 50%, 2이상이면 75%, ... 으로 비율을 적용
	deltaHigh := safeDeltaU64(memEvCur.high, st.memPrev.high)
	deltaOOM  := safeDeltaU64(memEvCur.oomKill, st.memPrev.oomKill)
	memPressurePct := memPressureScore(deltaHigh)

	// 기준값 갱신
	st.cpuPrev = cpuCur
	st.ioPrev  = ioCur
	st.memPrev = memEvCur

	return &ResourceSnapshot{
		ServiceName:      name,
		TimestampMs:      nowMs,
		CPUPct:           cpuPct,
		CPUThrottlePct:   cpuThrottlePct,
		MemCurrentBytes:  memCur,
		MemLimitBytes:    memLimit,
		MemPressurePct:   memPressurePct,
		IOReadBytesPerS:  ioReadPerS,
		IOWriteBytesPerS: ioWritePerS,
		IOWaitPct:        ioWaitPct,
		OOMKillCount:     deltaOOM,
		PSIMemSomePct:    psiSome,
		PSIMemFullPct:    psiFull,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// cgroup v2 파일 파서
// ─────────────────────────────────────────────────────────────────────────────

// readCPUStat — cpu.stat 파싱: usage_usec, throttled_usec, nr_throttled
func readCPUStat(cgroupPath string) (cpuPrev, error) {
	f, err := os.Open(cgroupPath + "/cpu.stat")
	if err != nil {
		return cpuPrev{}, err
	}
	defer f.Close()

	var result cpuPrev
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 {
			continue
		}
		val, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "usage_usec":
			result.usageUsec = val
		case "throttled_usec":
			result.throttledUs = val
		case "nr_throttled":
			result.nrThrottled = val
		}
	}
	return result, scanner.Err()
}

// readMemoryEvents — memory.events 파싱: high, oom_kill
func readMemoryEvents(cgroupPath string) (memPrev, error) {
	f, err := os.Open(cgroupPath + "/memory.events")
	if err != nil {
		return memPrev{}, err
	}
	defer f.Close()

	var result memPrev
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 {
			continue
		}
		val, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "high":
			result.high = val
		case "oom_kill":
			result.oomKill = val
		}
	}
	return result, scanner.Err()
}

// readIOStat — io.stat 파싱: 모든 디바이스의 rbytes/wbytes를 합산한다.
//
// io.stat 형식: "major:minor rbytes=N wbytes=N rios=N wios=N dbytes=N dios=N"
func readIOStat(cgroupPath string) (ioPrev, error) {
	f, err := os.Open(cgroupPath + "/io.stat")
	if err != nil {
		// io.stat가 없는 컨테이너(예: no disk access)는 0으로 처리
		return ioPrev{}, nil
	}
	defer f.Close()

	var result ioPrev
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		// 첫 필드: "major:minor" — 나머지 필드: "key=value"
		for _, field := range fields[1:] {
			kv := strings.SplitN(field, "=", 2)
			if len(kv) != 2 {
				continue
			}
			val, err := strconv.ParseUint(kv[1], 10, 64)
			if err != nil {
				continue
			}
			switch kv[0] {
			case "rbytes":
				result.rbytes += val
			case "wbytes":
				result.wbytes += val
			}
		}
	}
	return result, scanner.Err()
}

// readUint64File — 파일 내용이 숫자 한 줄인 경우 읽어서 uint64로 반환한다.
// "max" 같은 비숫자 값은 0으로 처리한다.
func readUint64File(path string) (uint64, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	val, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		// "max" 같은 값 → 무제한 → 0
		return 0, nil
	}
	return val, nil
}

// readIOWaitPct — /proc/stat의 iowait 필드를 읽어 CPU 대비 비율을 반환한다.
//
// /proc/stat 첫 줄: "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
// iowait_pct = iowait / (user+nice+system+idle+iowait+irq+softirq) × 100
//
// 주의: 이 값은 컨테이너가 아닌 호스트 전체 기준이다.
// cgroup v2에는 iowait가 없으므로 차선책으로 사용한다.
func readIOWaitPct() (float64, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		// fields[0]="cpu", [1]=user, [2]=nice, [3]=system, [4]=idle, [5]=iowait
		if len(fields) < 6 {
			return 0, nil
		}
		vals := make([]uint64, len(fields)-1)
		for i, s := range fields[1:] {
			v, _ := strconv.ParseUint(s, 10, 64)
			vals[i] = v
		}
		iowait := vals[4]
		var total uint64
		for _, v := range vals {
			total += v
		}
		if total == 0 {
			return 0, nil
		}
		return clamp100(float64(iowait) / float64(total) * 100), nil
	}
	return 0, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

// safeDeltaU64 — 누적 카운터의 delta를 계산한다.
// 카운터가 리셋되거나 curr < prev인 경우 0을 반환한다 (음수 방지).
func safeDeltaU64(curr, prev uint64) uint64 {
	if curr < prev {
		return 0
	}
	return curr - prev
}

// clamp100 — 값을 [0, 100] 범위로 제한한다.
func clamp100(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// readPSIMemory — cgroup의 memory.pressure 파일을 읽어 some/full avg10 값을 반환한다.
//
// 파일 형식:
//
//	some avg10=0.12 avg60=0.03 avg300=0.01 total=123456
//	full avg10=0.00 avg60=0.00 avg300=0.00 total=0
//
// avg10: 최근 10초 평균. 실시간 판단에 가장 적합한 윈도우.
// 파일이 없거나(커널 < 4.20, PSI 비활성화) 파싱 실패 시 (0, 0)을 반환한다.
func readPSIMemory(cgroupPath string) (some, full float64) {
	f, err := os.Open(cgroupPath + "/memory.pressure")
	if err != nil {
		return 0, 0
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		fields := strings.Fields(line)
		// fields[0] = "some" 또는 "full", 이후는 "key=value" 쌍
		if len(fields) < 2 {
			continue
		}
		var target *float64
		switch fields[0] {
		case "some":
			target = &some
		case "full":
			target = &full
		default:
			continue
		}
		for _, kv := range fields[1:] {
			if !strings.HasPrefix(kv, "avg10=") {
				continue
			}
			val, err := strconv.ParseFloat(strings.TrimPrefix(kv, "avg10="), 64)
			if err == nil {
				*target = clamp100(val)
			}
			break
		}
	}
	return some, full
}

// memPressureScore — memory.events의 high 이벤트 횟수를 0-100 점수로 변환한다.
//
// high 이벤트: 메모리가 high 한도를 초과할 때 발생 (OOM 이전 경고).
// 1초 안에 high 이벤트가 없으면 0%, 1번 이상이면 50%, 10번 이상이면 90%.
func memPressureScore(deltaHigh uint64) float64 {
	if deltaHigh == 0 {
		return 0
	}
	// 로그 스케일로 0-100 사이 변환: score = 1 - 1/(1 + deltaHigh)
	score := (1.0 - 1.0/float64(1+deltaHigh)) * 100
	return clamp100(score)
}
