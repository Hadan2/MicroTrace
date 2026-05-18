import { useRef, useState, useCallback, useEffect } from 'react'

export interface ViewWindow {
  start: number  // history 배열 인덱스 (포함)
  end: number    // history 배열 인덱스 (포함)
}

interface Options {
  totalLength: number
  defaultVisible?: number  // 기본으로 보여줄 포인트 수 (기본: 180)
}

interface Result {
  window: ViewWindow | null    // null = Live 모드 (항상 최신 N개)
  isLive: boolean
  goLive: () => void
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void
}

const DEFAULT_VISIBLE = 180
const MIN_VISIBLE = 10

export function useChartPanZoom({ totalLength, defaultVisible = DEFAULT_VISIBLE }: Options): Result {
  // window=null → Live 모드
  const [window, setWindow] = useState<ViewWindow | null>(null)

  const dragRef = useRef<{ startX: number; startWindow: ViewWindow } | null>(null)
  const visibleRef = useRef(defaultVisible)

  const clamp = useCallback((start: number, end: number, total: number): ViewWindow => {
    const size = end - start
    const clampedEnd = Math.min(total - 1, Math.max(size, end))
    const clampedStart = Math.max(0, clampedEnd - size)
    return { start: clampedStart, end: clampedEnd }
  }, [])

  const goLive = useCallback(() => {
    setWindow(null)
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const startX = e.clientX - rect.left

    // 현재 window 스냅샷 (Live면 최신 N개로 계산)
    const currentEnd = totalLength - 1
    const visible = visibleRef.current
    const currentStart = Math.max(0, currentEnd - visible + 1)
    const startWindow = window ?? { start: currentStart, end: currentEnd }

    dragRef.current = { startX, startWindow }

    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const pw = rect.width  // rect는 mousedown 시점에 캡처됨 (e.currentTarget은 이후 null)
      const { startX, startWindow } = dragRef.current
      const dx = me.clientX - rect.left - startX

      const range = startWindow.end - startWindow.start
      // 드래그 방향 반대로 (오른쪽 드래그 = 과거로)
      const shift = Math.round(-(dx / pw) * range)
      const newStart = startWindow.start + shift
      const newEnd   = startWindow.end   + shift

      setWindow(clamp(newStart, newEnd, totalLength))
    }

    const onUp = () => {
      dragRef.current = null
      globalThis.removeEventListener('mousemove', onMove)
      globalThis.removeEventListener('mouseup', onUp)
    }

    globalThis.addEventListener('mousemove', onMove)
    globalThis.addEventListener('mouseup', onUp)
  }, [window, totalLength, clamp])

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const pw = canvas.clientWidth

    const currentEnd = totalLength - 1
    const visible = visibleRef.current
    const currentStart = Math.max(0, currentEnd - visible + 1)
    const cur = window ?? { start: currentStart, end: currentEnd }

    const range = cur.end - cur.start
    // deltaY > 0 → 줌아웃(더 넓게), < 0 → 줌인(더 좁게)
    const factor = e.deltaY > 0 ? 1.2 : 0.8
    const newRange = Math.min(
      totalLength - 1,
      Math.max(MIN_VISIBLE, Math.round(range * factor))
    )

    // 마우스 위치 기준으로 zoom
    const ratio = mouseX / pw
    const anchor = cur.start + ratio * range
    const newStart = Math.round(anchor - ratio * newRange)
    const newEnd   = Math.round(anchor + (1 - ratio) * newRange)

    const clamped = clamp(newStart, newEnd, totalLength)
    visibleRef.current = clamped.end - clamped.start

    // 끝이 최신이면 Live 모드로 복귀
    if (clamped.end >= totalLength - 1) {
      setWindow(null)
    } else {
      setWindow(clamped)
    }
  }, [window, totalLength, clamp])

  // totalLength 변화 시 Live 모드면 아무것도 안 함, window 모드면 end가 최신에 달라붙지 않도록 유지
  useEffect(() => {
    if (window !== null && window.end >= totalLength - 1) {
      setWindow(null)
    }
  }, [totalLength])

  const isLive = window === null

  return { window, isLive, goLive, onMouseDown, onWheel }
}
