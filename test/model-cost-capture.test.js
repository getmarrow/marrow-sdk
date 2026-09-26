const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { extractModelUsageFromResponse: extract, modelUsageRequestFacts: facts, normalizeModelUsageInput: normalize } = require('../dist/model-usage.js');
const { MarrowClient } = require('../dist');
const clean = v => v;
const at = '2026-09-26T20:00:00.000Z';
const openaiUrl = 'https://api.openai.com/v1/responses';
const request = (model = 'gpt-4.1-mini') => ({ method: 'POST', body: JSON.stringify({ model, input: 'synthetic fixture' }) });
const response = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const openai = { id: 'resp_fixture', model: 'gpt-4.1-mini', service_tier: 'default', created_at: Date.parse(at)/1000, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } } };
const anthropicUrl = 'https://api.anthropic.com/v1/messages';
const anthropicRequest = { method: 'POST', body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }] }) };
const anthropic = { id: 'msg_fixture', model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 0 }, service_tier: 'standard', inference_geo: 'global' } };
const capture = (body = openai, url = openaiUrl, init = request()) => extract(url, response(body), facts(url, init));
function client() { process.env.MARROW_API_KEY = ['mrw', 'test', 'fixture'].join('_') + 'A'.repeat(24); return new MarrowClient(process.env.MARROW_API_KEY); }
function backendPrice() {
 const base=process.env.MARROW_COST_BACKEND_SNAPSHOT;
 const code=readFileSync(base+'/src/services/model-cost.service.ts','utf8');
 const catalog=JSON.parse(readFileSync(base+'/src/data/model-pricing-catalog.json','utf8'));
 const mod={exports:{}};
 const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(js,{exports:mod.exports,require(name){if(name==='../data/model-pricing-catalog.json')return catalog;if(name==='../utils/crypto')return {sha256(){throw Error('No ledger calls in pricing test')}};throw Error('Unexpected import '+name)},Date,Number,Math,Object,JSON,Set,Map});
 return usage=>mod.exports.priceUsage(usage,'2026-09-27T23:00:00.000Z');
}

test('money normalizer preserves compact contract and never coerces unknown into zero', () => {
 const input = { provider: 'openai', model: 'gpt-4.1-mini', billing_host: 'first_party', usage_event_id: 'openai:resp_fixture', occurred_at: at, token_semantics: 'input_includes_cache', usage_kind: 'cumulative', usage_role: 'marrow_overhead', cache_write_tokens: 0, pricing_dimensions: { tier: 'standard', region: 'global', modality: 'text' }, billing_mode: 'subscription', cost_source: 'provider_response', cost_usd: 0, coverage_complete: false, overhead_complete: true, baseline_usage_id: 'usage_baseline', comparison_id: 'comparison_1', task_fingerprint: 'task_1', constraints_fingerprint: 'constraint_1' };
 assert.deepEqual(normalize(input, clean), input);
 for (const invalid of [null, '', false, '12', -1, Infinity, NaN, 1.5]) assert.throws(()=>normalize({ input_tokens: invalid }, clean), /input_tokens/);
 assert.equal(normalize({ input_tokens: 0 }, clean).input_tokens, 0);
 assert.equal(normalize({ prompt: 'private', pricing_dimensions: { tier: 'standard', bad: { nested: true } } }, clean).pricing_dimensions, undefined);
 assert.equal(normalize({ token_semantics: 'guessed', coverage_complete: 'true' }, clean).token_semantics, undefined);
});

test('OpenAI response and chat cache counts retain inclusive semantics, response identity and no guessed completeness', async () => {
 const usage = await capture();
 assert.equal(usage.input_tokens, 100); assert.equal(usage.cached_tokens, 30); assert.equal(usage.output_tokens, 20); assert.equal(usage.cache_write_tokens, 0); assert.equal(usage.total_tokens, 120);
 assert.equal(usage.token_semantics, 'input_includes_cache'); assert.equal(usage.usage_event_id, 'openai:resp_fixture');
 assert.deepEqual(usage.pricing_dimensions, { modality: 'text', region: 'global', tier: 'standard' });
 assert.equal(usage.coverage_complete, undefined); assert.equal(usage.overhead_complete, undefined); assert.equal(usage.baseline_usage_id, undefined);
 const chat = await capture({ id: 'chatcmpl-fixture', model: 'gpt-4.1-mini', service_tier: 'default', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30 } } }, 'https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'requested-alias', messages: [{ role: 'user', content: 'fixture' }] }) });
 assert.equal(chat.model, 'gpt-4.1-mini'); assert.equal(chat.usage_event_id, 'openai:chatcmpl-fixture'); assert.equal(chat.total_tokens, 120);
 assert.equal((await capture()).usage_event_id, usage.usage_event_id);
 assert.equal((await capture({ ...openai, id: 'msg_wrong_provider' })).usage_event_id, undefined);
 assert.equal((await capture({ ...openai, usage_kind: 'cumulative' })).usage_kind, 'cumulative');
});

test('Anthropic preserves disjoint read/write buckets and actual single or mixed TTL metadata', async () => {
 const usage = await capture(anthropic, anthropicUrl, anthropicRequest);
 assert.equal(usage.input_tokens, 100); assert.equal(usage.cached_tokens, 30); assert.equal(usage.cache_write_tokens, 10); assert.equal(usage.total_tokens, 160); assert.equal(usage.token_semantics, 'disjoint');
 assert.deepEqual(usage.pricing_dimensions, { modality: 'text', tier: 'standard', region: 'global', cache_ttl: '5m' });
 const mixed = await capture({ ...anthropic, usage: { ...anthropic.usage, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 5 } } }, anthropicUrl, anthropicRequest);
 assert.equal(mixed.pricing_dimensions.cache_ttl, 'mixed_unresolved');
 assert.equal(await capture({ ...anthropic, usage: { ...anthropic.usage, cache_creation: { ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 } } }, anthropicUrl, anthropicRequest), null);
});

test('endpoint boundary, redirects, streaming and missing fields fail closed without manufacturing pricing dimensions', async () => {
 for (const url of ['https://evilopenai.com/v1/responses','https://api.openai.com.evil.test/v1/responses','http://api.openai.com/v1/responses','https://user:pass@api.openai.com/v1/responses','https://api.openai.com:8443/v1/responses','https://proxy.example/v1/responses','https://api.openai.com/v1/batches']) assert.equal(await capture(openai,url),null);
 const redirected = response(openai); Object.defineProperty(redirected,'url',{value:'https://proxy.example/v1/responses'}); assert.equal(await extract(openaiUrl,redirected),null);
 assert.equal(await extract(openaiUrl,new Response('data: fixture',{headers:{'content-type':'text/event-stream'}})),null);
 assert.equal(await capture({ ...openai, usage: { input_tokens: null, output_tokens: 20 } }),null);
 const incomplete = await capture({ ...openai, service_tier: undefined, usage: { output_tokens: 20 } });
 assert.equal(incomplete.input_tokens,undefined); assert.equal(incomplete.token_semantics,undefined); assert.equal(incomplete.pricing_dimensions.tier,undefined);
 const multimodal = await capture(openai,openaiUrl,{method:'POST',body:JSON.stringify({input:[{role:'user',content:[{type:'input_image',image_url:'private'}]}]})});
 assert.equal(multimodal.pricing_dimensions.modality,undefined);
 assert.equal(JSON.stringify(multimodal).includes('private'),false);
});

test('direct and Commit payloads retain extracted richer evidence and explicit subscription declarations', async () => {
 const calls=[]; const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return response({data:{recorded:true,committed:true,success_rate:1,decision_id:'fixture_decision'}})};
 try {
  const marrow=client(); const usage={...await capture(),billing_mode:'subscription',coverage_complete:false,overhead_complete:false};
  await marrow.modelUsage(usage);
  await marrow.think({action:'synthetic fixture',type:'implementation'});
  await marrow.commit({success:true,outcome:'Synthetic fixture outcome',modelUsage:usage});
  const direct=calls.find(c=>c.url.endsWith('/model-usage')).body; const commit=calls.find(c=>c.url.endsWith('/commit')).body.model_usage;
  assert.deepEqual(commit,direct); assert.equal(direct.billing_mode,'subscription'); assert.equal(direct.token_semantics,'input_includes_cache'); assert.equal(direct.usage_event_id,'openai:resp_fixture');
 } finally {globalThis.fetch=original;}
});

test('actual capture and submission evidence prices against the pinned backend service/catalog', { skip: !process.env.MARROW_COST_BACKEND_SNAPSHOT }, async () => {
 const actualPrice=backendPrice();
 const price=usage=>actualPrice(normalize(usage,clean));
 const open=price(await capture()); assert.ok(Math.abs(open.amount-0.000063)<1e-12,JSON.stringify(open));
 const ant=price(await capture(anthropic,anthropicUrl,anthropicRequest)); assert.ok(Math.abs(ant.amount-0.0006465)<1e-12,JSON.stringify(ant));
 assert.equal(price({...await capture(),billing_mode:'subscription'}).basis,'api_equivalent');
 assert.equal(price({...await capture(),usage_kind:'cumulative'}).amount,null);
 const mixed=await capture({...anthropic,usage:{...anthropic.usage,cache_creation:{ephemeral_5m_input_tokens:5,ephemeral_1h_input_tokens:5}}},anthropicUrl,anthropicRequest);assert.equal(price(mixed).amount,null);
});

test('invalid supplied cache buckets cannot reach pricing through direct, Commit or passive capture', { skip: !process.env.MARROW_COST_BACKEND_SNAPSHOT }, async () => {
 const price=backendPrice(), calls=[], priced=[]; const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body); calls.push({url:String(url),body});
  const usage=String(url).endsWith('/model-usage')?body:body.model_usage;
  if(usage) priced.push(price(usage));
  return response({data:{recorded:true,committed:true,success_rate:1,decision_id:'fixture_decision'}});
 };
 try {
  const marrow=client(), usage={...await capture(),coverage_complete:true,overhead_complete:true};
  await marrow.think({action:'cache bucket boundary fixture',type:'implementation'});
  for(const bucket of ['cached_tokens','cache_write_tokens']) for(const invalid of [null,'12',-1,Infinity,NaN,false,1.5,Number.MAX_SAFE_INTEGER+1]) {
   const malformed={...usage,[bucket]:invalid}, before=calls.length;
   assert.throws(()=>normalize(malformed,clean),new RegExp(bucket));
   await assert.rejects(marrow.modelUsage(malformed),new RegExp(bucket));
   await assert.rejects(marrow.commit({success:true,outcome:'Synthetic boundary fixture',modelUsage:malformed}),new RegExp(bucket));
   assert.equal(calls.length,before,'invalid evidence must fail before transport or pricing');
   for(const detail of ['cached_tokens','cache_write_tokens']) {
    assert.equal(await capture({...openai,usage:{...openai.usage,input_tokens_details:{...openai.usage.input_tokens_details,[detail]:invalid}}}),null);
   }
   for(const field of ['cache_read_input_tokens','cache_creation_input_tokens']) {
    assert.equal(await capture({...anthropic,usage:{...anthropic.usage,[field]:invalid}},anthropicUrl,anthropicRequest),null);
   }
   for(const field of ['ephemeral_5m_input_tokens','ephemeral_1h_input_tokens']) {
    assert.equal(await capture({...anthropic,usage:{...anthropic.usage,cache_creation:{...anthropic.usage.cache_creation,[field]:invalid}}},anthropicUrl,anthropicRequest),null);
   }
  }
  assert.equal(priced.length,0,'rejected observations produce no calculated amount');
  // A malformed preferred alias cannot fall through to an otherwise valid alias or TTL sum.
  assert.equal(await capture({...openai,usage:{...openai.usage,cached_tokens:null}}),null);
  const zero={...usage,cached_tokens:0,cache_write_tokens:0};
  await marrow.modelUsage(zero); await marrow.commit({success:true,outcome:'Observed zero fixture',modelUsage:zero});
  const absent={...zero}; delete absent.cached_tokens; delete absent.cache_write_tokens;
  await marrow.think({action:'optional absence boundary fixture',type:'implementation'});
  await marrow.modelUsage(absent); await marrow.commit({success:true,outcome:'Optional absence fixture',modelUsage:absent});
  assert.equal(priced.length,4);
  for(const result of priced) assert.ok(Math.abs(result.amount-0.000072)<1e-12,JSON.stringify(result));
  assert.equal(calls.filter(c=>c.url.endsWith('/model-usage'))[1].body.cached_tokens,undefined);
  // OpenAI omits the optional write bucket normally; this is distinct from an explicit invalid value.
  const noWrite={...openai,usage:{...openai.usage,input_tokens_details:{cached_tokens:30}}};
  const captured=await capture(noWrite);
  assert.equal(captured.cache_write_tokens,undefined);
  assert.ok(Math.abs(price(normalize(captured,clean)).amount-0.000063)<1e-12);
 } finally {globalThis.fetch=original;}
});


test('new compact identity and pricing fields reject embedded credentials without colliding redacted IDs', async () => {
 const sentinel = ['mrw', 'test', 'fixture'].join('_') + 'B'.repeat(24);
 const other = ['cfut', 'fixture'].join('_') + 'C'.repeat(24);
 for (const secret of [sentinel, other]) {
  const usage = { billing_host: `host:${secret}`, usage_event_id: `openai:resp_fixture:${secret}`, comparison_id: `comparison:${secret}`, model: `model:${secret}`, pricing_dimensions: { tier: 'standard', api_key: secret } };
  const safe = normalize(usage, clean);
  assert.equal(safe.usage_event_id, undefined); assert.equal(safe.model, undefined); assert.equal(safe.pricing_dimensions, undefined);
  assert.equal(JSON.stringify(safe).includes(secret), false);
  assert.equal(normalize({ pricing_dimensions: { tier: `standard:${secret}` } }, clean).pricing_dimensions, undefined);
  const captured = await capture({ ...openai, id: `resp_fixture:${secret}`, model: `model:${secret}` });
  assert.equal(captured.usage_event_id, undefined); assert.equal(captured.model, undefined); assert.equal(JSON.stringify(captured).includes(secret), false);
 }
 assert.equal(normalize({usage_event_id:'provider:opaque'},()=> '[redacted]').usage_event_id,undefined);
 const calls=[]; const original=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return response({data:{recorded:true,committed:true,success_rate:1,decision_id:'fixture_decision'}})};
 try {
  const marrow=client(); const payload={...await capture(),usage_event_id:`openai:resp_fixture:${sentinel}`,pricing_dimensions:{access_token:other}};
  await marrow.modelUsage(payload); await marrow.think({action:'synthetic secret fixture',type:'implementation'}); await marrow.commit({success:true,outcome:'Synthetic outcome',modelUsage:payload});
  assert.equal(JSON.stringify(calls).includes(sentinel),false); assert.equal(JSON.stringify(calls).includes(other),false);
 } finally {globalThis.fetch=original;}
});
