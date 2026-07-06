import uPlot from 'uplot'

// LatencyChart·ResourceChart가 공유하는 uPlot 줌/팬·축 로직.
// 두 차트의 룩앤필과 인터랙션을 한 곳에서 통일한다.

// 최대 확대 시 최소로 보이는 x축 폭(초). 데이터가 1초 간격이라 10초면 충분히 세밀.
const MIN_ZOOM_SEC = 10

export interface PanZoomState {
  // 사용자가 줌/팬 중이면 true → 새 데이터가 와도 스케일을 유지한다.
  // 완전히 줌아웃(전체 범위 복귀)하면 false로 돌아가 Live 추적을 재개한다.
  userZoomed: boolean
}

function clamp(val: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, val))
}

// 현재 데이터의 x 범위(경계). ready 시점 고정이 아니라 호출마다 최신 data 기준.
function dataBounds(u: uPlot): { min: number; max: number } {
  const xs = u.data[0]
  if (!xs || xs.length === 0) return { min: 0, max: 1 }
  const min = xs[0] as number
  const max = xs[xs.length - 1] as number
  return max > min ? { min, max } : { min, max: min + 1 }
}

// 현재 x 범위가 데이터 전체 범위와 거의 같으면 "줌 안 됨"으로 본다.
function isFullRange(u: uPlot): boolean {
  const b = dataBounds(u)
  const full = b.max - b.min
  const cur = u.scales.x.max! - u.scales.x.min!
  return cur >= full - full * 0.001
}

// 휠 줌 + 드래그 pan 플러그인.
// 경계(데이터 최소/최대)는 매번 data에서 다시 읽어, 데이터가 통째로 바뀌어도 어긋나지 않게 한다.
export function panZoomPlugin(state: PanZoomState): uPlot.Plugin {
  return {
    hooks: {
      ready: (u) => {
        const over = u.over
        over.style.cursor = 'grab'

        // 휠 줌 — 마우스 위치 기준
        over.addEventListener('wheel', (e: WheelEvent) => {
          e.preventDefault()
          const b = dataBounds(u)
          const fullRange = b.max - b.min
          const { left, width } = over.getBoundingClientRect()
          const mouseRatio = (e.clientX - left) / width
          const factor = e.deltaY > 0 ? 1.25 : 0.8
          const curXMin = u.scales.x.min!
          const curXMax = u.scales.x.max!
          const curRange = curXMax - curXMin
          // 최소 줌 폭은 절대값(10초). 전체 범위 대비 상대(%)로 하면 넓게 볼수록
          // 세밀하게 못 파고드는 문제가 생긴다. 데이터가 10초보다 짧으면 그만큼만.
          const minRange = Math.min(MIN_ZOOM_SEC, fullRange)
          const newRange = clamp(curRange * factor, minRange, fullRange)
          const anchor   = curXMin + mouseRatio * curRange
          const newXMin  = clamp(anchor - mouseRatio * newRange, b.min, b.max - newRange)
          u.setScale('x', { min: newXMin, max: newXMin + newRange })
        }, { passive: false })

        // 드래그 pan
        let dragStartX = 0
        let dragStartXMin = 0
        let dragStartXMax = 0
        let dragging = false

        over.addEventListener('mousedown', (e: MouseEvent) => {
          if (e.button !== 0) return
          dragging = true
          dragStartX    = e.clientX
          dragStartXMin = u.scales.x.min!
          dragStartXMax = u.scales.x.max!
          over.style.cursor = 'grabbing'
        })

        window.addEventListener('mousemove', (e: MouseEvent) => {
          if (!dragging) return
          const b = dataBounds(u)
          const { width } = over.getBoundingClientRect()
          const dx = e.clientX - dragStartX
          const range = dragStartXMax - dragStartXMin
          const shift = -(dx / width) * range
          const newXMin = clamp(dragStartXMin + shift, b.min, b.max - range)
          u.setScale('x', { min: newXMin, max: newXMin + range })
        })

        window.addEventListener('mouseup', () => {
          if (!dragging) return
          dragging = false
          over.style.cursor = 'grab'
        })
      },
      // 전체 범위면 userZoomed=false(Live 추적 재개), 아니면 true(스케일 유지).
      setScale: (u, key) => {
        if (key !== 'x') return
        state.userZoomed = !isFullRange(u)
      },
    },
  }
}

// x축 시간 눈금 포맷. 두 차트 공통.
// 보이는 전체 범위(span)에 따라 라벨을 적응시킨다:
//  - 넓은 범위(≥2일, 예: All/7d): 눈금이 일 단위라 시:분이 다 00:00으로 겹침
//    → 상단에 M/D, 하단에 요일 대신 시:분 생략하고 날짜 위주로.
//  - 좁은 범위(<2일): 시:분 위주(+ 날짜 참고).
export const timeAxisValues: uPlot.Axis.Values = (u, splits) => {
  const spanSec = (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0)
  const DAY = 86400
  const wideRange = spanSec >= 2 * DAY  // 2일 이상이면 날짜 위주

  return splits.map(s => {
    if (s == null) return ''
    const d = new Date(s * 1000)
    const hhmm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    const md   = `${d.getMonth() + 1}/${d.getDate()}`
    if (wideRange) {
      // 날짜를 상단에, 시:분은 자정이 아닐 때만 하단에(대부분 자정이라 보통 비움)
      return md + '\n' + (hhmm === '00:00' ? '' : hhmm)
    }
    // 좁은 범위: 시:분 상단, 날짜 하단
    return hhmm + '\n' + md
  })
}

// 두 차트 공통 축 스타일.
export const AXIS_STROKE = '#94a3b8'
export const axisBase = {
  stroke: AXIS_STROKE,
  ticks: { stroke: '#e2e8f0', width: 1 },
  grid:  { stroke: '#f1f5f9', width: 1 },
  font:  '9px JetBrains Mono, monospace',
}

// setData 시 줌 상태를 존중하는 헬퍼: 사용자가 줌 중이면 현재 스케일을 유지한다.
export function applyData(u: uPlot, data: uPlot.AlignedData, state: PanZoomState) {
  if (state.userZoomed) {
    const xMin = u.scales.x.min!
    const xMax = u.scales.x.max!
    u.setData(data, false)  // false = 스케일 자동 리셋 억제
    u.setScale('x', { min: xMin, max: xMax })
  } else {
    u.setData(data)
  }
}
