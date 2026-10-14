import type { InfrastructureAssumptions } from '../lib/infrastructure'
import { NumberInput } from '../pages/PlanPage'

export const operatingDefaults = {
  costMode: 'rent' as const,
  gpuPurchase: 10000,
  amortizationMonths: 36,
  powerWatts: 0,
  powerPrice: 0.2,
  staffHours: 0,
  staffHourly: 75,
  operatingMonthly: 0,
  standbyReplicas: 0,
  gpuMemoryGB: 0,
  weightsGB: 0,
  kvGB: 0,
  overheadPct: 20,
}
export function parseOperating(
  p: URLSearchParams,
): Partial<InfrastructureAssumptions> {
  return Object.fromEntries(
    Object.entries(operatingDefaults).map(([k, v]) => [
      k,
      k === 'costMode'
        ? p.get(k) === 'owned'
          ? 'owned'
          : 'rent'
        : p.has(k) && Number.isFinite(Number(p.get(k))) && Number(p.get(k)) >= 0
          ? Math.min(1e12, Number(p.get(k)))
          : v,
    ]),
  )
}
export default function OperatingCosts({
  value,
  onChange,
}: {
  value: InfrastructureAssumptions
  onChange: (v: Partial<InfrastructureAssumptions>) => void
}) {
  const fields: [keyof InfrastructureAssumptions, string][] = [
    ...(value.costMode === 'owned'
      ? ([
          ['gpuPurchase', 'Purchase cost / GPU ($)'],
          ['amortizationMonths', 'Amortization (months)'],
        ] as [keyof InfrastructureAssumptions, string][])
      : []),
    ['powerWatts', 'Average watts / GPU, including standby'],
    ['powerPrice', 'Electricity ($ / kWh)'],
    ['staffHours', 'Staffing hours / month'],
    ['staffHourly', 'Staffing ($ / hour)'],
    ['operatingMonthly', 'Storage, network, support / month ($)'],
    ['standbyReplicas', 'Standby deployments (no serving capacity)'],
    ['gpuMemoryGB', 'Memory / GPU (GB)'],
    ['weightsGB', 'Total model weights / deployment (GB)'],
    ['kvGB', 'KV cache / deployment (GB)'],
    ['overheadPct', 'Memory overhead (%)'],
  ]
  return (
    <div className="plan-panel">
      <h3>Ownership and operating costs</h3>
      <label className="decision-select">
        <span>Hardware cost basis</span>
        <select
          value={value.costMode ?? 'rent'}
          onChange={(e) =>
            onChange({ costMode: e.target.value as 'rent' | 'owned' })
          }
        >
          <option value="rent">Rented · GPU hourly price</option>
          <option value="owned">Owned · purchase amortization</option>
        </select>
      </label>
      <div className="plan-fields">
        {fields.map(([key, label]) => (
          <NumberInput
            key={key}
            label={label}
            value={typeof value[key] === 'number' ? (value[key] as number) : 0}
            onChange={(n) =>
              onChange({ [key]: key === 'standbyReplicas' ? Math.floor(n) : n })
            }
          />
        ))}
      </div>
      <p className="decision-note">
        Owned hardware replaces the rental charge. Add electricity only when it
        is outside the rental quote. Staffing and other monthly costs apply to
        the fleet; standby deployments incur full entered costs and add no
        serving capacity. Zero power/staffing costs mean you have excluded them.
      </p>
      <p className="decision-note">
        Memory is an aggregate capacity estimate; topology, runtime support,
        batching and concurrent context can prevent a deployment that appears to
        fit. Enter the full weights, including all MoE experts. Throughput must
        be measured with the intended input/output mix.
      </p>
    </div>
  )
}
