import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateFleet, quoteBill, planningWorkload, wilson } from '../src/lib/planning.ts'
import { csvRows, importUsage, repriceUsage, importEvaluations, csvText } from '../src/lib/imports.ts'
import type { PriceModel } from '../src/lib/types'
import type { Quote } from '../src/lib/quotes'
import { quotesFor } from '../src/lib/quotes.ts'

const model: PriceModel = { key:'lab/test',display:'Test',provider:'lab',source:'openrouter',context:1000000,input_mtok:2,output_mtok:10 }
const q: Quote = { id:'lab:standard', source:'Lab',sourceUrl:'https://example.com',context:1000000,plan:{id:'standard',label:'Standard',input_mtok:2,output_mtok:10,cached_input_mtok:.2,cache_write_mtok:2.5} }
test('fleet charges all initial attempts and the conditional escalation path', () => {
  const w={...planningWorkload,calls:100,inputTokens:100000,outputTokens:10000}
  const first=quoteBill(model,q,w),second=quoteBill(model,{...q,plan:{...q.plan,input_mtok:4,output_mtok:20}},w)
  const a={escalationPct:20,firstAcceptedPct:75,secondAcceptedPct:90,firstReviewPct:10,secondReviewPct:50,reviewMinutes:2}
  const r=calculateFleet(first,second,w,a)
  assert.ok(Math.abs(r.api-42)<1e-10)
  assert.equal(r.accepted,78)
  assert.ok(Math.abs(r.review-100/3)<1e-10)
  assert.equal(calculateFleet(first,second,w,{...a,firstAcceptedPct:0,secondAcceptedPct:0}).costPerSuccess,null)
  assert.equal(calculateFleet(first,{...second,complete:false},w,{...a,escalationPct:0}).complete,true)
})
test('CSV reads BOM, embedded commas, newlines, quotes, and rejects malformed fields', () => {
  assert.deepEqual(csvRows('\uFEFFa,b\r\n"hello,\nworld","a""b"\r\n'),[{a:'hello,\nworld',b:'a"b'}])
  for(const s of ['a,a\n1,2','a,b\n1','a\n"unclosed','a\n"ok"junk']) assert.throws(() => csvRows(s))
  assert.ok(csvText([['=WEBSERVICE("x")']]).startsWith('"\'='))
})
test('OpenAI and Anthropic conventions normalize cache and reasoning once', () => {
  const o=importUsage('model,num_model_requests,input_tokens,output_tokens,reasoning_tokens,input_cached_tokens,input_cache_write_tokens\nlab/test,10,10000,3000,1000,2000,1000','openai')[0]
  assert.equal(o.input,10000);assert.equal(o.output,2000);assert.equal(o.reasoning,1000)
  const a=importUsage('model,num_model_requests,input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens\nlab/test,10,7000,3000,2000,1000','anthropic')[0]
  assert.equal(a.input,10000);assert.equal(a.output,3000);assert.equal(a.reasoning,0)
  assert.equal(repriceUsage(o,model,q).monthlyTotal,repriceUsage(a,model,q).monthlyTotal)
  assert.ok(Math.abs(repriceUsage(o,model,q).monthlyTotal-.0469)<1e-9)
})
test('aggregate averages cannot establish context price bands or invent cache rates', () => {
  const row=importUsage('model,requests,input_tokens,output_tokens,cache_read_tokens\nlab/test,2,200000,1000,1000','normalized')[0]
  assert.equal(repriceUsage(row,model,{...q,plan:{...q.plan,maximumPromptTokens:100000}}).complete,false)
  assert.equal(repriceUsage({...row,minPrompt:50000,maxPrompt:150000},model,{...q,plan:{...q.plan,maximumPromptTokens:100000}}).complete,false)
  assert.equal(repriceUsage({...row,minPrompt:100000,maxPrompt:100000},model,{...q,plan:{...q.plan,maximumPromptTokens:100000}}).complete,true)
  assert.equal(repriceUsage(row,model,{...q,plan:{...q.plan,cached_input_mtok:undefined}}).complete,false)
  assert.throws(() => importUsage('model,requests,input_tokens,output_tokens\nlab/test,0,1,1','normalized'))
})
test('evaluation imports keep exact identities and suite versions; small samples disclose uncertainty', () => {
  const header='model,task,suite,version,setting,accepted,total,date,source\n'
  const e=importEvaluations(header+'lab/test,extract,invoice,v1,effort low,8,10,2026-10-13,local\nlab/test,extract,invoice,v2,effort low,90,100,2026-10-13,local')
  assert.notEqual(e[0].group,e[1].group)
  assert.ok(wilson(8,10).low < wilson(80,100).low)
  assert.throws(() => importEvaluations(header+'lab/test,t,s,v,low,11,10,2026-10-13,local'))
  assert.throws(() => importEvaluations(header+'lab/test,t,s,v,low,1,10,2026-02-30,local'))
  assert.throws(() => importEvaluations(header+'deepseek-flash,t,s,v,low,1,10,2026-10-13,local'))
})
test('published context plans retain the lower/upper prompt boundaries', () => {
  const m={...model,key:'openai/gpt-6.1-sol',provider:'openai',source:'firstparty' as const,rateNote:'Standard rate for prompts up to 272,000 input tokens'}
  const now=new Date().toISOString()
  const quotes=quotesFor(m,{version:1,asOf:now.slice(0,10),generatedAt:now,models:[{key:m.key,billing:{status:'fresh',verifiedAt:now,sourceUrl:'https://example.com',plans:[q.plan,{...q.plan,id:'standard-long-context',label:'Long'}]}}]},null)
  const workload={...planningWorkload,inputTokens:300000}
  assert.equal(quoteBill(m,quotes.find((q) => q.id==='lab:standard')!,workload).complete,false)
  assert.equal(quoteBill(m,quotes.find((q) => q.id==='lab:standard-long-context')!,workload).complete,true)
})
