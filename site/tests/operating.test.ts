import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateInfrastructure, defaultInfrastructureAssumptions as defaults, infrastructurePath } from '../src/lib/infrastructure.ts'
import type { PriceModel } from '../src/lib/types'
const model: PriceModel={key:'lab/test',provider:'lab',display:'Test',context:10000,source:'openrouter',input_mtok:1,output_mtok:2}
test('owned amortization replaces rental and standby incurs cost without capacity', () => {
  const a={...defaults,inputMillions:10,outputMillions:10,gpusPerReplica:1,gpuHourly:100,costMode:'owned' as const,gpuPurchase:3600,amortizationMonths:36,licensePerGpuYear:0,powerWatts:100,powerPrice:.2,staffHours:2,staffHourly:50,operatingMonthly:20,standbyReplicas:1}
  const r=calculateInfrastructure(model,null,'tape',a)
  assert.equal(r.replicas,1);assert.equal(r.computeMonthly,200);assert.ok(Math.abs(r.powerMonthly-29.2)<1e-9);assert.ok(Math.abs(r.runMonthly-349.2)<1e-9)
  const noStandby=calculateInfrastructure(model,null,'tape',{...a,standbyReplicas:0})
  assert.equal(r.outputCapacityPerReplica,noStandby.outputCapacityPerReplica)
  assert.equal(r.totalCapacityMillions,noStandby.totalCapacityMillions)
  assert.ok(infrastructurePath(model.key,'tape',a).includes('costMode=owned'))
})
test('memory overflow, zero serving capacity and invalid ownership period cannot claim savings', () => {
  const a={...defaults,gpusPerReplica:1,gpuMemoryGB:24,weightsGB:20,kvGB:8,overheadPct:20}
  assert.equal(calculateInfrastructure(model,null,'tape',a).memoryFits,false)
  assert.equal(calculateInfrastructure(model,null,'tape',a).complete,false)
  assert.equal(calculateInfrastructure(model,null,'tape',{...a,gpuMemoryGB:48}).memoryFits,true)
  assert.equal(calculateInfrastructure(model,null,'tape',{...defaults,outputTokensPerSecond:0}).complete,false)
  assert.equal(calculateInfrastructure(model,null,'tape',{...defaults,costMode:'owned',amortizationMonths:0}).complete,false)
})
