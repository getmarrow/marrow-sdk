import { MarrowModelUsageInput } from './types';

type Fields = Record<string, unknown>;
type RequestFacts = { model?: string; modality?: string };
const count = (v: unknown): number | undefined => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const credential = /(?:mrw_(?:live|test)_[A-Za-z0-9_-]{8,}|mrw_[0-9a-f-]{36}_[a-f0-9]{16,}|(?:sk|pk|ghp|github_pat|npm|cfut)[_-][A-Za-z0-9_-]{12,})/i;
const label = (v: unknown): string | undefined => typeof v === 'string' && /^[a-zA-Z0-9_.:/@-]{1,160}$/.test(v) && !credential.test(v) ? v : undefined;
const object = (v: unknown): Fields => v && typeof v === 'object' && !Array.isArray(v) ? v as Fields : {};
const firstCount = (...values: unknown[]): number | undefined => values.map(count).find(v => v !== undefined);
const path = (v: unknown, keys: string): unknown => keys.split('.').reduce<unknown>((item, key) => object(item)[key], v);

// Exact request endpoints establish billing-host provenance. Never infer it from a model name or response shape.
function providerEndpoint(rawUrl: string): { provider: string; region?: string } | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) return null;
    const hosts: Record<string, { provider: string; paths: string[]; region?: string }> = {
      'api.openai.com': { provider: 'openai', paths: ['/v1/responses', '/v1/chat/completions'], region: 'global' },
      'api.anthropic.com': { provider: 'anthropic', paths: ['/v1/messages'] },
      'api.x.ai': { provider: 'xai', paths: ['/v1/responses', '/v1/chat/completions'], region: 'global' },
      'us.api.x.ai': { provider: 'xai', paths: ['/v1/responses', '/v1/chat/completions'], region: 'us' },
      'api.deepseek.com': { provider: 'deepseek', paths: ['/chat/completions', '/v1/chat/completions'] },
      'api.moonshot.ai': { provider: 'kimi', paths: ['/v1/chat/completions', '/v1/responses'], region: 'global' },
      'api.kimi.ai': { provider: 'kimi', paths: ['/v1/chat/completions', '/v1/responses'], region: 'global' },
      'api.groq.com': { provider: 'groq', paths: ['/openai/v1/chat/completions'] },
      'openrouter.ai': { provider: 'openrouter', paths: ['/api/v1/chat/completions'] },
      'dashscope.aliyuncs.com': { provider: 'qwen', paths: ['/compatible-mode/v1/chat/completions', '/api/v1/services/aigc/text-generation/generation'] },
      'api.moonshot.cn': { provider: 'kimi', paths: ['/v1/chat/completions'] },
      'api.minimax.chat': { provider: 'minimax', paths: ['/v1/text/chatcompletion_v2'] },
      'api.minimaxi.com': { provider: 'minimax', paths: ['/v1/text/chatcompletion_v2'] },
      'api.z.ai': { provider: 'zai', paths: ['/api/paas/v4/chat/completions'], region: 'global' },
    };
    if (u.hostname === 'generativelanguage.googleapis.com' && /^\/v1(?:beta)?\/models\/[a-zA-Z0-9_.-]+:generateContent$/.test(u.pathname)) return { provider: 'google' };
    const endpoint = hosts[u.hostname];
    return endpoint?.paths.includes(u.pathname) ? endpoint : null;
  } catch { return null; }
}

function textContent(value: unknown): boolean {
  if (typeof value === 'string') return true;
  return Array.isArray(value) && value.every(part => {
    const p = object(part);
    return ['text', 'input_text', 'output_text'].includes(String(p.type)) && typeof p.text === 'string';
  });
}

export async function modelUsageRequestFacts(input: Request | string | URL, init?: RequestInit): Promise<RequestFacts> {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!providerEndpoint(url)) return {};
    // Retain only compact facts; never send request content, headers or tool arguments.
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body)
      : !init?.body && typeof Request !== 'undefined' && input instanceof Request ? await input.clone().json() : null;
    const data = object(raw);
    const messages = data.messages ?? data.input;
    const textual = typeof messages === 'string' || Array.isArray(messages) && messages.length > 0 && messages.every(message => {
      const m = object(message);
      return textContent(m.content) && ['user', 'assistant', 'system', 'developer'].includes(String(m.role));
    });
    // Tools, files, non-text modalities or unknown request shapes cannot establish text-only pricing.
    const modality = textual && !data.tools && !data.audio && (!data.modalities || JSON.stringify(data.modalities) === '["text"]') && (!data.system || textContent(data.system)) ? 'text' : undefined;
    return { model: label(data.model), modality };
  } catch { return {}; }
}

export async function extractModelUsageFromResponse(rawUrl: string, response: Response, request: Promise<RequestFacts> = Promise.resolve({})): Promise<MarrowModelUsageInput | null> {
  const endpoint = providerEndpoint(rawUrl);
  if (!endpoint || !response.ok || !/\bjson\b/i.test(response.headers.get('content-type') || '')) return null;
  // A cross-host redirect cannot inherit the original endpoint's provenance.
  if (response.url && (!providerEndpoint(response.url) || new URL(response.url).hostname !== new URL(rawUrl).hostname)) return null;
  let data: Fields;
  try { data = object(await response.clone().json()); } catch { return null; }
  const usage = object(data.usage ?? path(data, 'response.usage') ?? path(data, 'message.usage') ?? path(data, 'meta.usage') ?? data.usageMetadata ?? data.token_usage);
  if (!Object.keys(usage).length) return null;
  // Reject supplied malformed counts before alias fallback or TTL aggregation can hide them.
  // Undefined is an absent optional bucket; null, strings and invalid numbers are not zero.
  const tokenPaths = [
    'input_tokens', 'prompt_tokens', 'inputTokenCount', 'promptTokenCount', 'totalInputTokens',
    'output_tokens', 'completion_tokens', 'outputTokenCount', 'candidatesTokenCount', 'totalOutputTokens',
    'cached_tokens', 'cache_read_input_tokens', 'prompt_tokens_details.cached_tokens',
    'input_tokens_details.cached_tokens', 'input_token_details.cache_read', 'cachedContentTokenCount',
    'cache_creation_input_tokens', 'input_tokens_details.cache_write_tokens',
    'cache_creation.ephemeral_5m_input_tokens', 'cache_creation.ephemeral_1h_input_tokens',
    'total_tokens', 'totalTokenCount', 'totalTokens',
  ];
  if (tokenPaths.some(key => { const value = path(usage, key); return value !== undefined && count(value) === undefined; })) return null;
  const facts = await request;
  const responseModel = data.model ?? data.modelVersion ?? path(data, 'response.model') ?? path(data, 'message.model') ?? path(data, 'metadata.model');
  const model = responseModel === undefined ? facts.model : label(responseModel);
  const input = firstCount(usage.input_tokens, usage.prompt_tokens, usage.inputTokenCount, usage.promptTokenCount, usage.totalInputTokens);
  const output = firstCount(usage.output_tokens, usage.completion_tokens, usage.outputTokenCount, usage.candidatesTokenCount, usage.totalOutputTokens);
  let cached = firstCount(usage.cached_tokens, usage.cache_read_input_tokens, path(usage, 'prompt_tokens_details.cached_tokens'), path(usage, 'input_tokens_details.cached_tokens'), path(usage, 'input_token_details.cache_read'), usage.cachedContentTokenCount);
  let writes = firstCount(usage.cache_creation_input_tokens, path(usage, 'input_tokens_details.cache_write_tokens'));
  const dimensions: Record<string, string | number> = {};
  if (facts.modality) dimensions.modality = facts.modality;
  if (endpoint.region) dimensions.region = endpoint.region;
  const actualTier = usage.service_tier ?? data.service_tier ?? path(data, 'response.service_tier');
  if (actualTier === 'default' && endpoint.provider === 'openai') dimensions.tier = 'standard';
  else if (['standard', 'priority', 'flex', 'fast', 'batch'].includes(String(actualTier))) dimensions.tier = String(actualTier);
  if (['global', 'us'].includes(String(usage.inference_geo))) dimensions.region = String(usage.inference_geo);
  let semantics: MarrowModelUsageInput['token_semantics'];
  if (endpoint.provider === 'openai') {
    semantics = 'input_includes_cache';
    // Cached detail omitted by a compatible response is unknown, not an observed zero.
  } else if (endpoint.provider === 'anthropic') {
    semantics = 'disjoint';
    const creation = object(usage.cache_creation);
    const five = count(creation.ephemeral_5m_input_tokens), hour = count(creation.ephemeral_1h_input_tokens);
    if (five !== undefined && hour !== undefined) {
      if (count(five + hour) === undefined) return null;
      if (writes === undefined) writes = five + hour;
      if (five + hour !== writes) return null;
      if (five > 0 && hour === 0) dimensions.cache_ttl = '5m';
      else if (hour > 0 && five === 0) dimensions.cache_ttl = '1h';
      else if (five > 0 && hour > 0) dimensions.cache_ttl = 'mixed_unresolved';
    }
  }
  const total = firstCount(usage.total_tokens, usage.totalTokenCount, usage.totalTokens);
  if (![input, output, cached, writes, total].some(v => v !== undefined && v > 0)) return null;
  const rawId = label(data.id ?? path(data, 'response.id') ?? path(data, 'message.id'));
  const id = rawId && ((endpoint.provider === 'openai' && /^(resp_|chatcmpl-)/.test(rawId)) || (endpoint.provider === 'anthropic' && /^msg_/.test(rawId))) ? `${endpoint.provider}:${rawId}` : undefined;
  const numericCreated = data.created_at ?? data.created ?? path(data, 'response.created_at');
  const created = typeof numericCreated === 'number' && Number.isFinite(numericCreated) && numericCreated > 0 && numericCreated < 8640000000000 ? new Date(numericCreated * 1000).toISOString() : undefined;
  // A missing cache bucket keeps pricing unresolved; do not silently price it as zero.
  if (cached === undefined || endpoint.provider === 'anthropic' && writes === undefined) semantics = undefined;
  return {
    provider: endpoint.provider, model, billing_host: endpoint.provider === 'openrouter' ? 'openrouter' : 'first_party', usage_event_id: id,
    occurred_at: created, input_tokens: input, output_tokens: output, cached_tokens: cached, cache_write_tokens: writes,
    total_tokens: total ?? (input !== undefined && output !== undefined && semantics && cached !== undefined
      ? input + output + (semantics === 'disjoint' ? cached + (writes || 0) : 0) : undefined),
    token_semantics: semantics, usage_kind: usage.usage_kind === 'cumulative' || data.usage_kind === 'cumulative' ? 'cumulative' : 'delta',
    pricing_dimensions: dimensions, source: 'sdk_passive_fetch', marrow_intervention: 'passive_model_usage_capture',
  };
}

export function normalizeModelUsageInput(input: MarrowModelUsageInput, sanitize: (v: string) => string): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const strings: Array<keyof MarrowModelUsageInput> = ['agent_id', 'session_id', 'workflow_id', 'decision_id', 'task_type', 'action_type', 'source', 'marrow_intervention'];
  for (const key of strings) { const v = input[key]; if (typeof v === 'string' && v.trim()) body[key] = sanitize(v).slice(0, 180); }
  for (const key of ['provider', 'model', 'billing_host', 'usage_event_id', 'baseline_usage_id', 'comparison_id', 'task_fingerprint', 'constraints_fingerprint'] as const) {
    const v = label(input[key]); if (v && sanitize(v) === v) body[key] = v;
  }
  for (const key of ['input_tokens', 'output_tokens', 'cached_tokens', 'cache_write_tokens', 'total_tokens', 'baseline_tokens', 'estimated_tokens_saved'] as const) {
    const value = input[key], v = count(value);
    if (value !== undefined && v === undefined) throw new TypeError(`${key} must be a nonnegative safe integer`);
    if (v !== undefined) body[key] = v;
  }
  for (const key of ['cost_usd', 'latency_ms', 'estimated_cost_saved_usd', 'estimated_minutes_saved'] as const) {
    const v = input[key]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0) body[key] = v;
  }
  const enums = { token_semantics: ['input_includes_cache', 'disjoint'], usage_kind: ['delta', 'cumulative'], usage_role: ['task', 'marrow_overhead'], billing_mode: ['api', 'subscription'], cost_source: ['provider_response'] };
  for (const key of Object.keys(enums) as Array<keyof typeof enums>) if (enums[key].includes(String(input[key]))) body[key] = input[key];
  for (const key of ['success', 'coverage_complete', 'overhead_complete'] as const) if (typeof input[key] === 'boolean') body[key] = input[key];
  if (typeof input.occurred_at === 'string' && input.occurred_at.length <= 64 && Number.isFinite(Date.parse(input.occurred_at))) body.occurred_at = new Date(input.occurred_at).toISOString();
  const dims = object(input.pricing_dimensions), entries = Object.entries(dims);
  if (entries.length > 0 && entries.length <= 12 && entries.every(([k, v]) => /^[a-zA-Z0-9_]{1,64}$/.test(k) && !/(?:secret|token|api[_-]?key|password|credential|authorization|private[_-]?key)/i.test(k) && (label(v) !== undefined && sanitize(String(v)) === v || typeof v === 'number' && Number.isFinite(v) && v >= 0))) {
    body.pricing_dimensions = Object.fromEntries(entries.map(([k, v]) => [k, typeof v === 'string' ? sanitize(v) : v]));
  }
  return body;
}
