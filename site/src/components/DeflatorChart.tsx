import { shortDate } from '../lib/format'
import type { IndexPoint } from '../lib/types'

type ChartProps = {
  points: IndexPoint[]
}

const WIDTH = 860
const HEIGHT = 330
const LEFT = 56
const RIGHT = 22
const TOP = 24
const BOTTOM = 42

export default function DeflatorChart({ points }: ChartProps) {
  if (!points.length) return <p className="chart-empty">Index history is not yet available.</p>

  const values = points.map((point) => point.value)
  const rawMin = Math.min(...values, 100)
  const rawMax = Math.max(...values, 100)
  const spread = Math.max(rawMax - rawMin, 4)
  const minimum = Math.floor((rawMin - spread * 0.25) / 2) * 2
  const maximum = Math.ceil((rawMax + spread * 0.25) / 2) * 2
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const xFor = (index: number) => LEFT + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const yFor = (value: number) => TOP + ((maximum - value) / (maximum - minimum)) * plotHeight
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - ((maximum - minimum) * index) / 4)
  const onlyPoint = points.length === 1 ? points[0] : null

  return (
    <div className="chart-wrap">
      <svg
        className="deflator-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Deflator index from ${points[0].value.toFixed(2)} to ${points.at(-1)!.value.toFixed(2)}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={yFor(tick)} y2={yFor(tick)} className="chart-grid" />
            <text x={LEFT - 10} y={yFor(tick) + 4} textAnchor="end" className="chart-label">
              {tick.toFixed(0)}
            </text>
          </g>
        ))}
        <line x1={LEFT} x2={WIDTH - RIGHT} y1={yFor(100)} y2={yFor(100)} className="chart-baseline" />
        {onlyPoint ? (
          <line x1={LEFT} x2={WIDTH - RIGHT} y1={yFor(onlyPoint.value)} y2={yFor(onlyPoint.value)} className="chart-line chart-neutral" />
        ) : (
          points.slice(1).map((point, index) => {
            const previous = points[index]
            return (
              <line
                key={`${previous.date}-${point.date}`}
                x1={xFor(index)}
                y1={yFor(previous.value)}
                x2={xFor(index + 1)}
                y2={yFor(point.value)}
                className={`chart-line ${point.value <= previous.value ? 'chart-down' : 'chart-up'}`}
              />
            )
          })
        )}
        {points.map((point, index) => (
          <circle key={`${point.date}-${index}`} cx={xFor(index)} cy={yFor(point.value)} r="4" className="chart-dot" />
        ))}
        <text x={LEFT} y={HEIGHT - 12} textAnchor="start" className="chart-label">
          {shortDate(points[0].date)}
        </text>
        <text x={WIDTH - RIGHT} y={HEIGHT - 12} textAnchor="end" className="chart-label">
          {shortDate(points.at(-1)!.date)}
        </text>
        <text x={WIDTH - RIGHT} y={yFor(100) - 7} textAnchor="end" className="chart-base-label">
          inception 100
        </text>
      </svg>
    </div>
  )
}
