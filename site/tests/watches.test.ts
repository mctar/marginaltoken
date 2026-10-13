import test from 'node:test'
import assert from 'node:assert/strict'
import { checkWatch, snapshot, parseWatches, safeScenarioPath, type WorkloadWatch } from '../src/lib/watches.ts'
import { planningWorkload } from '../src/lib/planning.ts'
import { feedItems, rss, storyId } from '../scripts/feeds.mjs'
import type { FeedData,PriceModel } from '../src/lib/types'
const now=new Date().toISOString()
const model:PriceModel={key:'lab/test',provider:'lab',display:'Test',source:'openrouter',context:100000,input_mtok:1,output_mtok:2,releaseStage:'stable',supportsTools:true}
const data:FeedData={prices:{generatedAt:now,asOf:now.slice(0,10),models:[model]},history:{generatedAt:now,points:[]},changes:{generatedAt:now,changes:[]},meta:{generatedAt:now,asOf:now.slice(0,10),modelCount:1,indexValue:100,indexBase:100,indexBaseDate:now.slice(0,10),indexBaseMean:1,basket:[],indexHistory:[]},brief:null,provenance:null,offers:null,deployment:null,decisions:null}
const watch:WorkloadWatch={version:1,id:'watch1',name:'Test watch',savedAt:now,path:'/plan/?first=lab%2Ftest',workload:planningWorkload,requirements:{context:2500,tools:true,structured:false,reasoning:false,weights:false},models:[snapshot(model,'tape',planningWorkload,data)],alternatives:[]}
test('watch compares immutable saved quote, lifecycle and requirements against current feeds', () => {
  assert.deepEqual(checkWatch(watch,data).changes,[])
  const next={...data,prices:{...data.prices,models:[{...model,input_mtok:2,supportsTools:false,lifecycle:{status:'deprecated',date:now.slice(0,10),sourceUrl:'https://example.com'}}]}}
  const checked=checkWatch(watch,next)
  assert.ok(checked.changes.some((s) => s.includes('rates changed')))
  assert.ok(checked.changes.some((s) => s.includes('lifecycle')))
  assert.ok(checked.changes.some((s) => s.includes('requirement')))
  assert.equal(watch.models[0].input,1)
  assert.ok(checkWatch(watch,{...data,prices:{...data.prices,models:[]}}).changes.some((s) => s.includes('no longer')))
})
test('portable watches reject invalid storage, out-of-origin links and unbounded data', () => {
  assert.equal(parseWatches(JSON.stringify({version:1,watches:[watch]})).length,1)
  for(const path of ['https://evil.example/plan/','javascript:alert(1)','/notes/','//evil.example/compare/']) assert.throws(() => safeScenarioPath(path))
  assert.throws(() => parseWatches(JSON.stringify({version:1,watches:[watch,watch]})))
  assert.throws(() => parseWatches(JSON.stringify({version:1,watches:[{...watch,workload:{...planningWorkload,inputTokens:-1}}]})))
  assert.throws(() => parseWatches('x'.repeat(200001)))
  assert.throws(() => parseWatches(JSON.stringify({version:1,watches:[{...watch,savedAt:1}]})))
  assert.equal('extra' in parseWatches(JSON.stringify({version:1,watches:[{...watch,extra:'not a watch field'}]}))[0],false)
})
test('RSS identifiers are stable, XML is escaped, and delisting is not labelled retirement', () => {
  const event={type:'price',key:'lab/test',display:'Test & <variant>',field:'input_mtok',date:'2026-10-13',from:1,to:2}
  assert.equal(storyId(event),storyId({...event,display:'Renamed'}))
  assert.notEqual(storyId(event),storyId({...event,to:3}))
  const items=feedItems([],[event,{...event,type:'delisted'}],{models:{}})
  const text=rss('Test & feed','https://example.com/feed',items,now)
  assert.ok(text.includes('Test &amp; &lt;variant&gt;'))
  assert.ok(text.includes('does not establish provider retirement'))
  assert.equal((text.match(/<item>/g) ?? []).length,2)
  assert.equal((rss('Test','https://example.com',[items[0],items[0]],now).match(/<item>/g) ?? []).length,1)
})
