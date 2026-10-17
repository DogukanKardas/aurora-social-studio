// Aurora Social Studio — request handler shared by local server (server.js) and Vercel (api/index.js).
// Storage: Supabase (Postgres via REST + Storage). Auth: signed session cookie.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const env = (k, d = '') => (process.env[k] || d).trim();
// Vercel ↔ Supabase bağlantısı değişkenleri farklı adlarla ekleyebilir; hepsini kabul et.
for (const [target, alts] of [
  ['SUPABASE_URL', ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_PROJECT_URL']],
  ['SUPABASE_SECRET_KEY', ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET']],
]) if (!process.env[target]) { const a = alts.find(k => process.env[k]); if (a) process.env[target] = process.env[a]; }

// ================================================================ errors + http helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.svg': 'image/svg+xml',
};
function send(res, status, body, headers = {}) {
  const str = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': str ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(str ? body : JSON.stringify(body));
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 4e6) fail(413, 'İstek çok büyük'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Geçersiz JSON'); }
}
async function fetchJson(url, opts = {}, label = 'API') {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    const msg = typeof data === 'object' && data ? (data.detail || data.message || data.error?.message || data.error || JSON.stringify(data)) : text;
    fail(502, `${label} hatası (${r.status}): ${String(msg).slice(0, 300)}`);
  }
  return data;
}
function need(key, label) {
  const v = env(key);
  if (!v) fail(400, `${label} için ${key} ortam değişkeni tanımlı değil (Ayarlar sekmesine bak).`);
  return v;
}
const newId = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function baseUrl(req) {
  if (env('PUBLIC_URL')) return env('PUBLIC_URL').replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket?.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// ================================================================ auth (session cookie)
const COOKIE = 'ass_session';
const authSecret = () => env('AUTH_SECRET') || crypto.createHash('sha256').update('aurora|' + env('APP_PASSWORD')).digest('hex');
const sign = v => crypto.createHmac('sha256', authSecret()).update(v).digest('base64url');
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
function makeSession(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + 30 * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readSession(req) {
  const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const s = JSON.parse(Buffer.from(payload, 'base64url').toString()); return s.exp > Date.now() ? s : null; } catch { return null; }
}
function cookieHeader(req, value, maxAge) {
  const secure = baseUrl(req).startsWith('https') ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ================================================================ Supabase storage layer
// One generic table: items(collection, id, data jsonb, created_at). RLS on, no policies → only the secret key can access.
const SB = () => need('SUPABASE_URL', 'Veritabanı').replace(/\/$/, '');
function sbHeaders(extra = {}) {
  const key = need('SUPABASE_SECRET_KEY', 'Veritabanı');
  const h = { apikey: key, ...extra };
  if (!key.startsWith('sb_')) h.Authorization = `Bearer ${key}`; // legacy JWT service_role key
  return h;
}
const db = {
  async list(col) {
    const rows = await fetchJson(`${SB()}/rest/v1/items?collection=eq.${col}&select=data&order=created_at.desc&limit=2000`, { headers: sbHeaders() }, 'Veritabanı');
    return rows.map(r => r.data);
  },
  async get(col, id) {
    const rows = await fetchJson(`${SB()}/rest/v1/items?collection=eq.${col}&id=eq.${encodeURIComponent(id)}&select=data`, { headers: sbHeaders() }, 'Veritabanı');
    return rows[0]?.data || null;
  },
  async put(col, item) {
    await fetchJson(`${SB()}/rest/v1/items?on_conflict=collection,id`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(Array.isArray(item) ? item.map(i => ({ collection: col, id: i.id, data: i, created_at: i.createdAt || now() })) : { collection: col, id: item.id, data: item, created_at: item.createdAt || now() }),
    }, 'Veritabanı');
    return item;
  },
  async del(col, id) {
    await fetchJson(`${SB()}/rest/v1/items?collection=eq.${col}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: sbHeaders({ Prefer: 'return=minimal' }) }, 'Veritabanı');
  },
};
const BUCKET = 'media';
const publicUrl = p => `${SB()}/storage/v1/object/public/${BUCKET}/${p}`;
async function storageUpload(p, buf, contentType) {
  await fetchJson(`${SB()}/storage/v1/object/${BUCKET}/${p}`, {
    method: 'POST', headers: sbHeaders({ 'Content-Type': contentType, 'x-upsert': 'true' }), body: buf,
  }, 'Depolama');
}
async function storageDelete(p) {
  await fetch(`${SB()}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: [p] }),
  }).catch(() => { });
}
async function signedUploadUrl(p) {
  const d = await fetchJson(`${SB()}/storage/v1/object/upload/sign/${BUCKET}/${p}`, {
    method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: '{}',
  }, 'Depolama');
  return `${SB()}/storage/v1${d.url}`;
}

// ================================================================ media library
const extOf = (name, ct = '') => {
  let ext = path.extname(name || '').toLowerCase();
  if (!MIME[ext]) ext = ct.includes('video') ? '.mp4' : ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
  return ext === '.jpeg' ? '.jpg' : ext;
};
const typeOf = ext => (['.mp4', '.webm', '.mov'].includes(ext) ? 'video' : 'image');
async function saveMedia(buf, ext, meta) {
  const id = newId();
  const file = `${id}${ext}`;
  await storageUpload(file, buf, MIME[ext] || 'application/octet-stream');
  const item = { id, file, url: publicUrl(file), type: typeOf(ext), createdAt: now(), ...meta };
  await db.put('media', item);
  return item;
}
async function downloadToLibrary(url, meta) {
  const r = await fetch(url);
  if (!r.ok) fail(502, `Dosya indirilemedi (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  return saveMedia(buf, extOf(new URL(url).pathname, r.headers.get('content-type') || ''), meta);
}

// ================================================================ Claude (content planning)
const BRAND = `You write social media content for Aurora Vehicles Inc., a dash cam sales and professional installation company in Vancouver, BC (8+ years, 3,000+ customers, 50+ dealer partners).
Products: Falcon Vision (4K front, Full HD rear, 1080p cabin), Nova (4K Ultra HD), Hawk Vision (4K, parking-mode recording), AuroraCam. Sony Starvis sensor, f/1.8, 140° FOV.
Services: concealed installation, parking-mode power with battery protection, accessories. Bookings via WhatsApp.
Founding story: the founder's close friend was wrongly blamed for an accident with no footage to prove otherwise.
Voice: premium, calm, restrained, precise. Short sentences. No exclamation marks, no hype, no discount shouting, no fear-mongering, max 1 emoji. Tagline: "Precision in Every Frame".
Content pillars: Kurulum işçiliği (installation craft), Görüntü kalitesi (footage quality), Bilgi ve eğitim (education), Güven ve hikâye (trust & story), Ürün (product).
Captions are in English for a Vancouver audience; end with a soft call to book on WhatsApp; 3-5 local hashtags (e.g. #Vancouver #DashCam #BCDrivers).
Never invent customer testimonials, statistics or prices.`;
async function claude(prompt, maxTokens = 2000) {
  const key = need('ANTHROPIC_API_KEY', 'İçerik üretimi');
  const data = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'), max_tokens: maxTokens,
      system: BRAND + '\nAlways answer with valid JSON only, no markdown fences, no commentary.',
      messages: [{ role: 'user', content: prompt }],
    }),
  }, 'Claude API');
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = text.match(/[\[{][\s\S]*[\]}]/);
  try { return JSON.parse(m ? m[0] : text); } catch { fail(502, 'Claude geçerli JSON döndürmedi, tekrar dene.'); }
}

// ================================================================ Replicate
async function replicateCreate(model, input, wait) {
  const headers = { Authorization: `Bearer ${need('REPLICATE_API_TOKEN', 'Replicate')}`, 'Content-Type': 'application/json' };
  if (wait) headers.Prefer = 'wait=60';
  const [url, body] = model.includes(':')
    ? ['https://api.replicate.com/v1/predictions', { version: model.split(':')[1], input }]
    : [`https://api.replicate.com/v1/models/${model}/predictions`, { input }];
  return fetchJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, 'Replicate');
}
const replicateGet = pid => fetchJson(`https://api.replicate.com/v1/predictions/${encodeURIComponent(pid)}`,
  { headers: { Authorization: `Bearer ${need('REPLICATE_API_TOKEN', 'Replicate')}` } }, 'Replicate');
const outputUrls = o => (Array.isArray(o) ? o : [o]).flat().filter(x => typeof x === 'string' && x.startsWith('http'));

// ================================================================ stock photos
async function stockSearch(source, q) {
  const query = encodeURIComponent(q);
  if (source === 'pexels') {
    const d = await fetchJson(`https://api.pexels.com/v1/search?query=${query}&per_page=24`, { headers: { Authorization: need('PEXELS_API_KEY', 'Pexels') } }, 'Pexels');
    return d.photos.map(p => ({ thumb: p.src.medium, full: p.src.large2x, credit: `Photo by ${p.photographer} on Pexels`, link: p.url }));
  }
  if (source === 'pixabay') {
    const d = await fetchJson(`https://pixabay.com/api/?key=${need('PIXABAY_API_KEY', 'Pixabay')}&q=${query}&per_page=24&image_type=photo&safesearch=true`, {}, 'Pixabay');
    return d.hits.map(h => ({ thumb: h.webformatURL, full: h.largeImageURL, credit: `Image by ${h.user} on Pixabay`, link: h.pageURL }));
  }
  if (source === 'unsplash') {
    const d = await fetchJson(`https://api.unsplash.com/search/photos?query=${query}&per_page=24`, { headers: { Authorization: `Client-ID ${need('UNSPLASH_ACCESS_KEY', 'Unsplash')}` } }, 'Unsplash');
    return d.results.map(p => ({ thumb: p.urls.small, full: p.urls.regular, credit: `Photo by ${p.user.name} on Unsplash`, link: p.links.html, track: p.links.download_location }));
  }
  if (source === 'openverse') {
    // Yalnızca ticari kullanıma ve düzenlemeye izin veren lisanslar (Canva'da düzenlenip paylaşılacak).
    const d = await fetchJson(`https://api.openverse.org/v1/images/?q=${query}&page_size=24&license_type=commercial,modification&mature=false`,
      { headers: { 'User-Agent': 'AuroraSocialStudio/1.0' } }, 'Openverse');
    return (d.results || []).filter(r => r.url).map(r => {
      const lic = `${String(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim();
      const by = r.creator ? ` by ${r.creator}` : '';
      return { thumb: r.thumbnail || r.url, full: r.url, credit: r.license === 'cc0' || r.license === 'pdm' ? `${r.title || 'Image'}${by} (${lic}) via Openverse` : `"${r.title || 'Untitled'}"${by}, ${lic} via Openverse`, link: r.foreign_landing_url || r.url, license: lic };
    });
  }
  fail(400, 'Bilinmeyen kaynak');
}

// ================================================================ tatiller (Nager.Date) + renk paleti (Colormind)
const holidayCache = new Map();
async function holidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const d = await fetchJson(`https://date.nager.at/api/v3/PublicHolidays/${year}/CA`, {}, 'Nager.Date');
  const seen = new Set();
  const list = (Array.isArray(d) ? d : []).filter(h => h.global || (h.counties || []).includes('CA-BC'))
    .filter(h => !seen.has(h.date + h.name) && seen.add(h.date + h.name))
    .map(h => ({ date: h.date, name: h.name, local: h.localName, scope: h.global ? 'Kanada' : 'BC', types: h.types || [] }));
  holidayCache.set(year, list);
  return list;
}
const hexToRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgbToHex = c => '#' + c.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
function localPalette(locked) {
  // Colormind'a ulaşılamazsa: kilitli renklerden türetilen basit, uyumlu bir palet.
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const [first, , mid, , last] = locked;
  if (first && last) return [first, mix(first, last, 0.22), mix(mix(first, last, 0.5), [122, 167, 217], 0.35), mix(first, last, 0.78), last];
  const base = mid || [122, 167, 217];
  return [mix(base, [0, 0, 0], 0.8), mix(base, [0, 0, 0], 0.45), base, mix(base, [255, 255, 255], 0.45), mix(base, [255, 255, 255], 0.8)];
}
async function palette({ mode, base }) {
  const brand = [[11, 11, 12], [232, 226, 212]];
  const pick = hexToRgb(base);
  const locked = mode === 'brand' ? [brand[0], null, null, null, brand[1]]
    : mode === 'color' && pick ? [null, null, pick, null, null] : [null, null, null, null, null];
  try {
    const body = locked.some(Boolean) ? { model: 'default', input: locked.map(c => c || 'N') } : { model: 'default' };
    const r = await withTimeout(fetchJson(env('COLORMIND_URL', 'http://colormind.io/api/'), { method: 'POST', body: JSON.stringify(body) }, 'Colormind'), 8000);
    if (!Array.isArray(r?.result) || r.result.length !== 5) fail(502, 'Colormind beklenmeyen yanıt');
    return { source: 'colormind', colors: r.result.map(rgbToHex) };
  } catch (e) {
    return { source: 'yerel', note: `Colormind'a ulaşılamadı (${e.message}); yerel palet üretildi.`, colors: localPalette(locked).map(rgbToHex) };
  }
}

// ================================================================ Trends (MCP over streamable HTTP)
let mcpSession = null, mcpProtocol = null;
async function mcpRequest(method, params, isNotification = false) {
  const url = env('TRENDS_MCP_URL', 'https://api.trendsmcp.ai/mcp');
  const key = need('TRENDS_MCP_KEY', 'Trend araştırması');
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` };
  if (mcpSession) headers['Mcp-Session-Id'] = mcpSession;
  if (mcpProtocol && method !== 'initialize') headers['MCP-Protocol-Version'] = mcpProtocol;
  const msg = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
  const rid = Math.floor(Math.random() * 1e9);
  if (!isNotification) msg.id = rid;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(msg) });
  const sid = r.headers.get('mcp-session-id');
  if (sid) mcpSession = sid;
  const text = await r.text();
  if (isNotification) return null;
  if (!r.ok) { mcpSession = null; mcpReady = false; fail(r.status === 401 || r.status === 403 ? 400 : 502, `Trends MCP hatası (${r.status}): ${text.slice(0, 300)}`); }
  let reply = null;
  if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try { const m = JSON.parse(line.slice(5).trim()); if (m.id === rid) reply = m; } catch { }
    }
  } else { try { reply = JSON.parse(text); } catch { } }
  if (!reply) fail(502, 'Trends MCP yanıtı okunamadı');
  if (reply.error) fail(502, `Trends MCP: ${reply.error.message || JSON.stringify(reply.error)}`);
  return reply.result;
}
let mcpReady = false;
async function mcpEnsure() {
  if (mcpReady) return;
  mcpSession = null; mcpProtocol = null;
  const init = await mcpRequest('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aurora-social-studio', version: '1.2.0' } });
  mcpProtocol = init?.protocolVersion || '2025-06-18';
  await mcpRequest('notifications/initialized', null, true);
  mcpReady = true;
}
async function mcpCall(method, params) {
  try { await mcpEnsure(); return await mcpRequest(method, params); }
  catch (e) {
    if (e.status === 400) throw e;
    mcpReady = false; // oturum düşmüş olabilir: bir kez yeniden kur
    await mcpEnsure(); return mcpRequest(method, params);
  }
}
// Servisteki gerçek araç/parametre adları: önce kesin ad (trends___get_growth → get_growth), sonra yakın eşleşme.
let trendToolCache = null;
async function trendTools() {
  if (!trendToolCache) {
    const all = []; let cursor;
    for (let i = 0; i < 10; i++) { // sayfalı liste
      const r = await mcpCall('tools/list', cursor ? { cursor } : {});
      all.push(...(r?.tools || []));
      if (!r?.nextCursor) break; cursor = r.nextCursor;
    }
    trendToolCache = all;
  }
  return trendToolCache;
}
const INTENTS = ['get_growth', 'get_time_series', 'get_top_posts', 'get_top_trends'];
const baseName = n => String(n || '').split('__').pop().replace(/^_+/, '');
const INTENT = {
  get_growth: n => /growth|change|percent|delta/i.test(n),
  get_time_series: n => /series|history|historical|interest|over.?time|timeline/i.test(n) && !/top|trending|post/i.test(n),
  get_top_posts: n => /posts?\b|top.?posts/i.test(n) && !/trend/i.test(n),
  get_top_trends: n => /top.?trend|trending|feed|rank/i.test(n) && !/post/i.test(n),
};
function findTool(tools, name) {
  return tools.find(t => t.name === name) || tools.find(t => baseName(t.name) === name)
    || tools.find(t => INTENT[name]?.(baseName(t.name))) || tools.find(t => INTENT[name]?.(t.description || ''));
}
const ARG_SYN = {
  keyword: ['keyword', 'query', 'term', 'q', 'topic', 'search_term', 'search', 'keywords', 'terms'],
  source: ['source', 'sources', 'platform', 'platforms', 'data_source', 'channel'],
  percent_growth: ['percent_growth', 'windows', 'periods', 'growth_windows', 'timeframes', 'timeframe', 'window', 'period'],
  type: ['type', 'feed', 'feed_type', 'list', 'board'],
  limit: ['limit', 'count', 'top_n', 'n', 'max_results'],
  country: ['country', 'geo', 'region', 'country_code', 'location'],
  window: ['window', 'time_window', 'period', 'timeframe', 'range'],
  category: ['category', 'categories', 'topic_category', 'vertical'],
  sort: ['sort', 'sort_by', 'order', 'order_by'],
};
function fitEnum(val, schema) {
  const en = schema?.enum || schema?.items?.enum;
  if (!en || typeof val !== 'string') return val;
  return en.find(e => e === val) || en.find(e => String(e).toLowerCase() === val.toLowerCase())
    || en.find(e => String(e).toLowerCase().includes(val.toLowerCase())) || val;
}
// Açıklamada "one of: a, b, c" gibi listelenen değerleri öneri olarak çıkar (enum yoksa).
function suggestFromText(desc) {
  const m = /(?:one of|options?|values?|valid|supported|allowed|e\.g\.|such as)[^:]*[:\-]\s*([^.\n]+)/i.exec(String(desc || ''));
  if (!m) return null;
  const vals = m[1].split(/,|\||\bor\b/).map(s => s.trim().replace(/^["'`(]+|["'`)]+$/g, '')).filter(s => s && s.length <= 40);
  return vals.length >= 2 ? vals.slice(0, 40) : null;
}
function simpleSchema(t) {
  const params = {};
  for (const [k, s] of Object.entries(t.inputSchema?.properties || {})) {
    const en = s.enum || s.items?.enum || null;
    params[k] = { type: s.type || null, enum: en, suggest: en ? null : suggestFromText(s.description), default: s.default ?? null, description: String(s.description || '').slice(0, 300) };
  }
  const b = baseName(t.name);
  return { name: t.name, intent: INTENTS.includes(b) ? b : INTENTS.find(i => INTENT[i](b)) || null, description: String(t.description || '').slice(0, 400), required: t.inputSchema?.required || [], params };
}
async function trendSchema(force) {
  if (!force) {
    const c = await db.get('kv', 'trend-schema').catch(() => null);
    if (c && Date.now() - c.at < 12 * 36e5 && c.tools?.length) return c.tools;
  }
  if (force) trendToolCache = null;
  const tools = (await trendTools()).map(simpleSchema);
  await db.put('kv', { id: 'trend-schema', at: Date.now(), tools }).catch(() => { });
  return tools;
}
async function resolveTrendTool(name, args) {
  const tools = await trendTools();
  const describe = () => tools.map(t => `${t.name}(${Object.keys(t.inputSchema?.properties || {}).join(', ')})`).join('; ');
  let tool = findTool(tools, name);
  let extra = {};
  if (!tool) { // tek araç + "mode" parametresi düzeni
    tool = tools.find(t => t.inputSchema?.properties?.mode);
    if (tool) extra.mode = fitEnum(name, tool.inputSchema.properties.mode);
  }
  if (!tool) fail(502, `Trend servisinde uygun araç bulunamadı. Mevcut araçlar: ${describe() || 'yok'}`);
  const props = tool.inputSchema?.properties || {};
  const out = { ...extra };
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === '') continue;
    const target = props[k] ? k : (ARG_SYN[k] || []).find(s => props[s] && !(s in out));
    if (!target) { if (!Object.keys(props).length) out[k] = v; continue; }
    let val = v;
    const sch = props[target];
    if (sch.type === 'array' && !Array.isArray(val)) val = [val];
    if (sch.type === 'string' && Array.isArray(val)) val = val[0];
    if (sch.type === 'integer' || sch.type === 'number') val = Number(val);
    out[target] = Array.isArray(val) ? val.map(x => fitEnum(x, sch)) : fitEnum(val, sch);
  }
  for (const req of tool.inputSchema?.required || []) {
    if (!(req in out)) fail(502, `"${tool.name}" aracı "${req}" alanını istiyor ama eşleştirilemedi. Araçlar: ${describe()}`);
  }
  return { name: tool.name, args: out };
}
// Servis bazen hatayı "başarılı" yanıtın içine koyuyor: {"statusCode":502,"body":"{\"error\":...}"}
const parseMaybe = t => { try { return JSON.parse(t); } catch { return null; } };
function trendFailure(text) {
  const j = parseMaybe(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const inner = typeof j.body === 'string' ? (parseMaybe(j.body) || { message: j.body }) : (j.body && typeof j.body === 'object' && !Array.isArray(j.body) ? j.body : j);
  const status = Number(j.statusCode ?? j.status_code ?? (typeof j.status === 'number' ? j.status : 0)) || 0;
  const err = inner.error ?? j.error;
  if (status >= 400 || (err && (typeof err !== 'object' || err.message || err.code))) {
    return { status, code: typeof err === 'object' && err ? String(err.code || err.type || '') : String(err || status), message: (typeof err === 'object' && err ? err.message : '') || inner.message || j.message || '', source: inner.source || j.source || '' };
  }
  return null;
}
function friendlyTrendError(f, args) {
  const src = f.source || args.source || 'Kaynak';
  const c = String(f.code || '').toLowerCase(), m = String(f.message || '').toLowerCase();
  if (f.status === 429 || /quota|rate.?limit|too many|limit exceeded/.test(c + ' ' + m)) return 'Trend servisinin istek sınırına ulaşıldı. Kota yenilenince ya da plan yükseltilince tekrar dene.';
  if (f.status === 401 || f.status === 403 || /unauthor|forbidden|api.?key|invalid.?key/.test(c + ' ' + m)) return 'Trend anahtarı reddedildi (TRENDS_MCP_KEY). Ayarlar → Sistem kontrolü ile kontrol et.';
  if (/unavailable|timeout|temporar/.test(c + ' ' + m) || [500, 502, 503, 504].includes(f.status)) return `"${src}" şu an yanıt vermiyor (servis tarafında geçici sorun). Biraz sonra tekrar dene ya da başka kaynak seç.`;
  if (/not.?found|no.?data|no.?results|empty/.test(c + ' ' + m)) return `Bu konu için "${src}" kaynağında veri bulunamadı. Daha genel bir konu ya da başka kaynak dene.`;
  if (/invalid|unsupported|bad.?request|validation/.test(c + ' ' + m) || f.status === 400 || f.status === 422) return `Servis bu seçimi kabul etmedi: ${f.message || f.code}. Başka bir seçenekle dene.`;
  return `Trend servisi hata döndürdü: ${f.message || f.code || f.status}`;
}
const stableJson = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v);
const usageKey = () => `trend-usage-${new Date().toISOString().slice(0, 7)}`;
async function trendUsage() {
  const u = await db.get('kv', usageKey()).catch(() => null);
  return { month: usageKey().slice(-7), count: u?.count || 0, limit: Number(env('TRENDS_MONTHLY_LIMIT')) || null };
}
async function bumpUsage() {
  const u = (await db.get('kv', usageKey()).catch(() => null)) || { id: usageKey(), count: 0 };
  u.count = (u.count || 0) + 1; u.at = now();
  await db.put('kv', u).catch(() => { });
  return u.count;
}

// ================================================================ Canva Connect
const CANVA_SCOPES = 'asset:read asset:write design:content:read design:content:write design:meta:read';
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function canvaToken(params) {
  const cid = need('CANVA_CLIENT_ID', 'Canva'); const sec = need('CANVA_CLIENT_SECRET', 'Canva');
  const d = await fetchJson('https://api.canva.com/rest/v1/oauth/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${cid}:${sec}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  }, 'Canva');
  const t = { id: 'canva-token', access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in - 60) * 1000 };
  await db.put('kv', t);
  return t;
}
async function canvaAccess() {
  let t = await db.get('kv', 'canva-token');
  if (!t) fail(401, 'Canva bağlı değil. Önce "Canva\'yı bağla" butonuna bas.');
  if (Date.now() > t.expires_at) t = await canvaToken({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  return t.access_token;
}
async function canvaExport(item) {
  const token = await canvaAccess();
  const r = await fetch(item.url);
  if (!r.ok) fail(502, 'Medya dosyası okunamadı');
  const buf = Buffer.from(await r.arrayBuffer());
  const name = (item.title || item.prompt || item.file).slice(0, 50);
  let job = (await fetchJson('https://api.canva.com/rest/v1/asset-uploads', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Asset-Upload-Metadata': JSON.stringify({ name_base64: Buffer.from(name).toString('base64') }) },
    body: buf,
  }, 'Canva yükleme')).job;
  for (let i = 0; i < 60 && job.status === 'in_progress'; i++) {
    await sleep(1500);
    job = (await fetchJson(`https://api.canva.com/rest/v1/asset-uploads/${job.id}`, { headers: { Authorization: `Bearer ${token}` } }, 'Canva')).job;
  }
  if (job.status !== 'success') fail(502, `Canva yükleme tamamlanmadı: ${job.error?.message || job.status}`);
  const size = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920], landscape: [1920, 1080] }[item.canvaSize || 'portrait'];
  const d = await fetchJson('https://api.canva.com/rest/v1/designs', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ design_type: { type: 'custom', width: size[0], height: size[1] }, asset_id: job.asset.id, title: `Aurora — ${name}` }),
  }, 'Canva tasarım');
  return d.design.urls.edit_url;
}

// ================================================================ routes
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));

// --- auth
route('POST', '/api/login', async (req, p, url, res) => {
  const b = await readJson(req);
  const user = env('APP_USER'), pass = env('APP_PASSWORD');
  if (!user || !pass) fail(500, 'APP_USER / APP_PASSWORD tanımlı değil');
  const ok = crypto.timingSafeEqual(sha(b.user || ''), sha(user)) & crypto.timingSafeEqual(sha(b.pass || ''), sha(pass));
  if (!ok) { await sleep(800); fail(401, 'Kullanıcı adı veya şifre hatalı'); }
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, makeSession(user), 30 * 86400) });
});
route('POST', '/api/logout', (req, p, url, res) => { send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) }); });

route('GET', '/api/status', async (req) => ({
  storage: !!env('SUPABASE_URL') && ['secret', 'service_role'].includes(keyKind(env('SUPABASE_SECRET_KEY'))),
  storageKeyKind: keyKind(env('SUPABASE_SECRET_KEY')),
  claude: !!env('ANTHROPIC_API_KEY'), replicate: !!env('REPLICATE_API_TOKEN'),
  pexels: !!env('PEXELS_API_KEY'), pixabay: !!env('PIXABAY_API_KEY'), unsplash: !!env('UNSPLASH_ACCESS_KEY'),
  trends: !!env('TRENDS_MCP_KEY'),
  canvaApp: !!(env('CANVA_CLIENT_ID') && env('CANVA_CLIENT_SECRET')),
  canvaConnected: ['secret', 'service_role'].includes(keyKind(env('SUPABASE_SECRET_KEY'))) ? !!(await db.get('kv', 'canva-token').catch(() => null)) : false,
  imageModel: env('REPLICATE_IMAGE_MODEL', 'black-forest-labs/flux-schnell'),
  videoModel: env('REPLICATE_VIDEO_MODEL', 'minimax/video-01'),
  canvaRedirect: `${baseUrl(req)}/api/canva/callback`,
}));

// --- posts (calendar)
const POST_FIELDS = ['date', 'time', 'platforms', 'format', 'pillar', 'topic', 'caption', 'status', 'mediaIds', 'notes', 'palette', 'ideaId', 'imagePrompt'];
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
route('GET', '/api/posts', async () => {
  let posts = await db.list('posts');
  if (!posts.length && !(await db.get('kv', 'seeded'))) {
    posts = require('../seed.js').posts();
    await db.put('posts', posts);
    await db.put('kv', { id: 'seeded', at: now() });
  }
  return posts;
});
route('POST', '/api/posts', async (req) => {
  const b = await readJson(req);
  if (!isDate(b.date)) fail(400, 'Tarih gerekli');
  return db.put('posts', { id: newId(), platforms: [], mediaIds: [], status: 'Fikir', time: '18:00', ...pick(b, POST_FIELDS), createdAt: now() });
});
route('PUT', '/api/posts/:id', async (req, { id }) => {
  const p = (await db.get('posts', id)) || fail(404, 'Paylaşım yok');
  const b = pick(await readJson(req), POST_FIELDS);
  if ('date' in b && !isDate(b.date)) fail(400, 'Geçersiz tarih');
  return db.put('posts', Object.assign(p, b, { updatedAt: now() }));
});
route('DELETE', '/api/posts/:id', async (req, { id }) => { await db.del('posts', id); return { ok: true }; });

// --- ideas (content planning)
const IDEA_FIELDS = ['title', 'pillar', 'platform', 'format', 'caption', 'hashtags', 'notes', 'imagePrompt', 'source', 'usedPostId', 'usedDate'];
const clip = (v, n) => (v === undefined || v === null ? '' : String(v)).slice(0, n);
const ideaFrom = (b, extra = {}) => ({
  id: newId(), title: clip(b.title, 200) || 'Yeni fikir', pillar: clip(b.pillar, 60), platform: clip(b.platform, 40), format: clip(b.format, 40),
  caption: clip(b.caption, 3000), hashtags: clip(Array.isArray(b.hashtags) ? b.hashtags.join(' ') : b.hashtags, 300), notes: clip(b.notes, 2000),
  imagePrompt: clip(b.imagePrompt ?? b.image_prompt, 1500), source: clip(b.source, 40), createdAt: now(), ...extra,
});
route('GET', '/api/ideas', () => db.list('ideas'));
route('POST', '/api/ideas', async (req) => db.put('ideas', ideaFrom(await readJson(req))));
route('POST', '/api/ideas/bulk', async (req) => {
  const b = await readJson(req);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30).filter(x => x && String(x.title || '').trim());
  if (!items.length) fail(400, 'Eklenecek fikir yok');
  const t = Date.now();
  const list = items.map((x, i) => ideaFrom(x, { source: clip(b.source, 40) || 'gemini', createdAt: new Date(t - i).toISOString() }));
  await db.put('ideas', list);
  return list;
});
route('PUT', '/api/ideas/:id', async (req, { id }) => {
  const i = (await db.get('ideas', id)) || fail(404, 'Fikir yok');
  const b = pick(await readJson(req), IDEA_FIELDS);
  for (const k of Object.keys(b)) if (typeof b[k] === 'string') b[k] = b[k].slice(0, k === 'caption' ? 3000 : 2000);
  return db.put('ideas', Object.assign(i, b, { updatedAt: now() }));
});
// --- Gemini (ya da herhangi bir sohbet asistanı) için hazır istek metinleri — anahtar gerektirmez
const PILLAR_LIST = ['Kurulum işçiliği', 'Görüntü kalitesi', 'Bilgi ve eğitim', 'Güven ve hikâye', 'Ürün'];
const CANADA_CONTEXT = `Audience: drivers in Metro Vancouver and British Columbia, Canada. Local context you may use when relevant: ICBC (BC's public auto insurer) claims and evidence, rain and dark commutes in fall/winter, BC winter tire season (Oct 1 - Mar 31 on most highways), Highway 1, Sea to Sky, Coquihalla, bridges and tunnels, hit-and-runs in parking lots, car theft in Canada. Use Canadian English spelling (e.g. "colour", "neighbour").`;
const IMAGE_RULES = 'English, for an AI image generator: photorealistic, premium, dark and calm mood, background/atmosphere only (real product and install photos are shot separately), no text, no logos, no readable licence plates, no recognisable faces.';
function ideasPrompt(b) {
  const count = Math.min(Math.max(Number(b.count) || 6, 1), 12);
  return `${BRAND}

${CANADA_CONTEXT}

TASK: Generate ${count} distinct social media post ideas for Aurora Vehicles.
Focus / brief: ${clip(b.brief, 1500) || 'a balanced mix across all content pillars'}
${b.pillar ? `Pillar: ${clip(b.pillar, 60)}\n` : ''}${b.platform ? `Platform: ${clip(b.platform, 40)}\n` : ''}${b.trend ? `Trend data to build on (use it, do not invent numbers):\n${clip(b.trend, 1500)}\n` : ''}
OUTPUT FORMAT (important): Reply with ONLY a JSON array. No code fences, no explanation before or after.
Each array item is an object with exactly these keys:
- "title": short topic in Turkish
- "pillar": one of ${JSON.stringify(PILLAR_LIST)}
- "platform": one of "Instagram", "Facebook", "YouTube", "LinkedIn"
- "format": one of "Reel", "Carousel", "Görsel", "Story", "Short", "Uzun video", "Metin + görsel"
- "caption": ready-to-post caption in English, following the voice rules above
- "hashtags": 3-5 local hashtags as one string, e.g. "#Vancouver #BCDrivers #DashCam"
- "notes": in Turkish, what to shoot or prepare (short shot list)
- "image_prompt": ${IMAGE_RULES}`;
}
function captionPrompt(b) {
  return `${BRAND}

${CANADA_CONTEXT}

TASK: Write 3 alternative captions for this post.
Topic: ${clip(b.topic, 300)}
Platform(s): ${(Array.isArray(b.platforms) ? b.platforms : []).join(', ') || 'Instagram'}
Format: ${clip(b.format, 40)}
Pillar: ${clip(b.pillar, 60)}
Notes: ${clip(b.notes, 800)}
${b.tone ? `Style adjustment: ${clip(b.tone, 200)}\n` : ''}Adapt length to the platform (LinkedIn: professional B2B tone for dealers and fleets; YouTube: title-like first line). Put 3-5 local hashtags at the end of each caption.

OUTPUT FORMAT (important): Reply with ONLY this JSON, no code fences, no explanation:
{"captions": ["...", "...", "..."]}`;
}
route('POST', '/api/prompts/ideas', async (req) => ({ prompt: ideasPrompt(await readJson(req)) }));
route('POST', '/api/prompts/caption', async (req) => ({ prompt: captionPrompt(await readJson(req)) }));
route('DELETE', '/api/ideas/:id', async (req, { id }) => { await db.del('ideas', id); return { ok: true }; });
route('POST', '/api/ideas/generate', async (req) => {
  const b = await readJson(req);
  const count = Math.min(Math.max(Number(b.count) || 6, 1), 12);
  const out = await claude(`Generate ${count} distinct social media post ideas.
Focus / brief: ${b.brief || 'a balanced mix across all pillars'}
${b.pillar ? `Pillar: ${b.pillar}` : ''}${b.platform ? `\nPlatform: ${b.platform}` : ''}
Return a JSON array of objects with keys: "title" (Turkish, short topic), "pillar" (one of the 5 Turkish pillar names), "platform" (Instagram, Facebook, YouTube or LinkedIn), "format" (Reel, Carousel, Görsel, Short, Uzun video, Metin + görsel), "caption" (English, ready to post), "notes" (Turkish, what to shoot or prepare).`, 3000);
  const t = Date.now();
  const list = (Array.isArray(out) ? out : out.ideas || []).map((x, i) => ({ id: newId(), title: x.title, pillar: x.pillar, platform: x.platform, format: x.format, caption: x.caption, notes: x.notes, createdAt: new Date(t - i).toISOString() }));
  if (list.length) await db.put('ideas', list);
  return list;
});
route('POST', '/api/caption', async (req) => {
  const b = await readJson(req);
  return claude(`Write 3 alternative captions for this post.
Topic: ${b.topic || ''}\nPlatform(s): ${(b.platforms || []).join(', ') || 'Instagram'}\nFormat: ${b.format || ''}\nPillar: ${b.pillar || ''}\nNotes: ${b.notes || ''}
${b.tone ? `Style adjustment: ${String(b.tone).slice(0, 200)}` : ''}
Adapt length to the platform (LinkedIn: professional B2B tone for dealers/fleets; YouTube: title-like first line).
Return JSON: {"captions": ["...", "...", "..."]}`);
});

// --- tatiller + palet
route('GET', '/api/holidays', async (req, p, url) => {
  const years = [...new Set(String(url.searchParams.get('years') || new Date().getFullYear()).split(',').map(Number).filter(y => y >= 2000 && y <= 2100))].slice(0, 3);
  return (await Promise.all(years.map(holidays))).flat();
});
route('POST', '/api/palette', async (req) => palette(await readJson(req)));

// --- trends
route('GET', '/api/trends/tools', async () => { trendToolCache = null; return trendTools(); });
route('GET', '/api/trends/schema', async (req, p, url) => trendSchema(url.searchParams.get('refresh') === '1'));
route('GET', '/api/trends/usage', () => trendUsage());
// tek trend sorgusu: 24 saat önbellek, kota sayacı, gömülü hata tespiti
async function runTrendCall(tool, args, force) {
  const real = await resolveTrendTool(tool, args);
  const key = `${real.name} ${stableJson(real.args)}`;
  if (!force) { // aynı sorgu 24 saat içinde: kota harcamadan geçmişten ver
    const hit = (await db.list('trends').catch(() => [])).find(e => e.key === key && Date.now() - Date.parse(e.createdAt) < 864e5);
    if (hit) return { ...hit, cached: true };
  }
  await bumpUsage();
  let r;
  try { r = await mcpCall('tools/call', { name: real.name, arguments: real.args }); }
  catch (e) {
    const list = (trendToolCache || []).map(t => t.name).join(', ') || 'liste boş';
    trendToolCache = null;
    fail(e.status || 502, `${e.message} — çağrılan: ${real.name} ${JSON.stringify(real.args)} — servisteki araçlar: ${list}`);
  }
  const text = (r.content || []).map(c => c.text || (c.type === 'resource' ? JSON.stringify(c.resource) : '')).join('\n')
    || (r.structuredContent ? JSON.stringify(r.structuredContent) : '');
  const f = trendFailure(text) || (r.isError ? { status: 0, code: '', message: text.slice(0, 300) } : null);
  if (f) fail(502, friendlyTrendError(f, real.args)); // hata sonucu geçmişe kaydedilmez
  const entry = { id: newId(), tool, args, key, text, createdAt: now() };
  await db.put('trends', entry).catch(e => console.error('trend geçmişi kaydedilemedi:', e.message)); // sonuç yine de gösterilir
  return entry;
}
route('POST', '/api/trends/call', async (req) => {
  const b = await readJson(req);
  if (!b.tool) fail(400, 'Araç seç');
  const entry = await runTrendCall(b.tool, b.args || {}, !!b.force);
  return { ...entry, usage: await trendUsage() };
});
// --- takip listesi (Kanada odaklı anahtar kelimeler; toplu büyüme kontrolü)
const WATCH_DEFAULT = [
  ['ICBC dash cam', 'google search'], ['dash cam Canada', 'google search'], ['dash cam Vancouver', 'google search'], ['ICBC claim', 'google search'],
  ['BC winter tires', 'google search'], ['DriveBC', 'google search'], ['Vancouver car accident', 'google search'], ['car theft Canada', 'google search'],
  ['hit and run Vancouver', 'google search'], ['dash cam installation', 'google search'], ['Thinkware dash cam', 'google search'], ['BlackVue', 'google search'],
].map(([keyword, source]) => ({ keyword, source }));
function unwrapText(text) {
  let d = parseMaybe(text);
  for (let i = 0; i < 4 && d && typeof d === 'object' && !Array.isArray(d); i++) {
    if (typeof d.body === 'string') { const p = parseMaybe(d.body); if (p !== null) { d = p; continue; } }
    else if (d.body && typeof d.body === 'object') { d = d.body; continue; }
    break;
  }
  return d;
}
function growthSummary(text) {
  const d = unwrapText(text);
  const out = {};
  for (const r of (Array.isArray(d?.results) ? d.results : [])) {
    if (r && r.period) out[r.period] = r.status === 'error' || typeof r.growth !== 'number' ? null : { growth: r.growth, recent: r.recent_value, baseline: r.baseline_value, volume: r.recent_volume ?? null };
  }
  return out;
}
const cleanWatch = items => (Array.isArray(items) ? items : []).map(x => ({ keyword: String(x.keyword || '').trim().slice(0, 80), source: String(x.source || 'google search').trim().slice(0, 40) }))
  .filter(x => x.keyword).filter((x, i, a) => a.findIndex(y => y.keyword.toLowerCase() === x.keyword.toLowerCase() && y.source === x.source) === i).slice(0, 40);
route('GET', '/api/trends/watch', async () => {
  const w = await db.get('kv', 'trend-watch');
  const last = await db.get('kv', 'trend-watch-last');
  return { items: w?.items || WATCH_DEFAULT, isDefault: !w, last: last || null };
});
route('PUT', '/api/trends/watch', async (req) => {
  const b = await readJson(req);
  const items = b.reset ? WATCH_DEFAULT : cleanWatch(b.items);
  await db.put('kv', { id: 'trend-watch', items, updatedAt: now() });
  return { items };
});
route('POST', '/api/trends/watch/run', async (req) => {
  const b = await readJson(req);
  const w = await db.get('kv', 'trend-watch');
  let items = w?.items || WATCH_DEFAULT;
  if (Array.isArray(b.only) && b.only.length) items = items.filter(x => b.only.some(o => o.keyword === x.keyword && o.source === x.source));
  const prev = (await db.get('kv', 'trend-watch-last'))?.rows || [];
  const rows = []; let used = 0, cached = 0;
  const queue = [...items];
  async function worker() {
    for (let it; (it = queue.shift());) {
      try {
        const e = await runTrendCall('get_growth', { keyword: it.keyword, source: it.source, percent_growth: ['1M', '3M'] }, !!b.force);
        e.cached ? cached++ : used++;
        rows.push({ ...it, ok: true, at: e.createdAt, cached: !!e.cached, periods: growthSummary(e.text), entryId: e.id });
      } catch (err) {
        used++;
        rows.push({ ...it, ok: false, error: err.message, at: now() });
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const merged = [...rows, ...prev.filter(p => !rows.some(r => r.keyword === p.keyword && r.source === p.source) && items.some(i => i.keyword === p.keyword && i.source === p.source))];
  const snap = { id: 'trend-watch-last', at: now(), rows: merged };
  await db.put('kv', snap);
  return { ...snap, used, cached, usage: await trendUsage() };
});
route('GET', '/api/trends/history', async () => (await db.list('trends')).slice(0, 50));
route('DELETE', '/api/trends/history/:id', async (req, { id }) => { await db.del('trends', id); return { ok: true }; });
route('DELETE', '/api/trends/history', async () => {
  await fetchJson(`${SB()}/rest/v1/items?collection=eq.trends`, { method: 'DELETE', headers: sbHeaders({ Prefer: 'return=minimal' }) }, 'Veritabanı');
  return { ok: true };
});

// --- stock + media
route('GET', '/api/stock', (req, p, url) => stockSearch(url.searchParams.get('source'), url.searchParams.get('q') || 'dash cam'));
route('POST', '/api/media/import', async (req) => {
  const b = await readJson(req);
  if (!b.url) fail(400, 'URL gerekli');
  if (b.track && env('UNSPLASH_ACCESS_KEY')) fetch(b.track, { headers: { Authorization: `Client-ID ${env('UNSPLASH_ACCESS_KEY')}` } }).catch(() => { });
  return downloadToLibrary(b.url, { source: b.source || 'stok', credit: b.credit || '', link: b.link || '', title: b.title || '' });
});
// direct browser → storage upload (bypasses function body-size limits)
route('POST', '/api/media/upload-url', async (req) => {
  const b = await readJson(req);
  const ext = extOf(b.name, b.type || '');
  if (!MIME[ext] || ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json' || ext === '.svg') fail(400, 'Desteklenmeyen dosya türü');
  const file = `${newId()}${ext}`;
  return { file, uploadUrl: await signedUploadUrl(file), contentType: MIME[ext] };
});
route('POST', '/api/media/register', async (req) => {
  const b = await readJson(req);
  if (!/^[a-f0-9]{12}\.[a-z0-9]+$/.test(b.file || '')) fail(400, 'Geçersiz dosya');
  const ext = path.extname(b.file);
  return db.put('media', { id: b.file.split('.')[0], file: b.file, url: publicUrl(b.file), type: typeOf(ext), source: 'yükleme', title: b.name || '', createdAt: now() });
});
route('GET', '/api/media', () => db.list('media'));
route('DELETE', '/api/media/:id', async (req, { id }) => {
  const m = await db.get('media', id);
  if (m) await storageDelete(m.file);
  await db.del('media', id);
  return { ok: true };
});

// --- image generation
route('POST', '/api/image/generate', async (req) => {
  const b = await readJson(req);
  if (!b.prompt) fail(400, 'Açıklama gerekli');
  const model = env('REPLICATE_IMAGE_MODEL', 'black-forest-labs/flux-schnell');
  let pred = await replicateCreate(model, { prompt: b.prompt, aspect_ratio: b.aspect_ratio || '4:5', num_outputs: Math.min(Number(b.count) || 1, 4), output_format: 'jpg' }, true);
  for (let i = 0; i < 90 && !['succeeded', 'failed', 'canceled'].includes(pred.status); i++) { await sleep(2000); pred = await replicateGet(pred.id); }
  if (pred.status !== 'succeeded') fail(502, `Görsel üretilemedi: ${pred.error || pred.status}`);
  const items = [];
  for (const u of outputUrls(pred.output)) items.push(await downloadToLibrary(u, { source: 'replicate', prompt: b.prompt, title: b.prompt.slice(0, 60), model }));
  return items;
});

// --- video generation (async, persisted)
route('POST', '/api/video/generate', async (req) => {
  const b = await readJson(req);
  if (!b.prompt) fail(400, 'Açıklama gerekli');
  const model = env('REPLICATE_VIDEO_MODEL', 'minimax/video-01');
  const input = { prompt: b.prompt };
  if (b.imageId) {
    const m = (await db.get('media', b.imageId)) || fail(404, 'Başlangıç görseli yok');
    input[env('REPLICATE_VIDEO_IMAGE_KEY', 'first_frame_image')] = m.url;
  }
  const pred = await replicateCreate(model, input, false);
  return db.put('video_jobs', { id: pred.id, prompt: b.prompt, model, status: pred.status, createdAt: now() });
});
route('GET', '/api/video/jobs', () => db.list('video_jobs'));
route('GET', '/api/video/jobs/:id', async (req, { id }) => {
  const job = (await db.get('video_jobs', id)) || fail(404, 'İş yok');
  if (job.mediaId || ['failed', 'canceled'].includes(job.status)) return job;
  const pred = await replicateGet(id);
  job.status = pred.status; job.error = pred.error || null;
  if (pred.status === 'succeeded') {
    const u = outputUrls(pred.output)[0];
    if (u) { const m = await downloadToLibrary(u, { source: 'replicate', prompt: job.prompt, title: job.prompt.slice(0, 60), model: job.model }); job.mediaId = m.id; job.url = m.url; }
  }
  return db.put('video_jobs', job);
});

// --- Canva
route('GET', '/api/canva/connect', async (req, p, url, res) => {
  const cid = need('CANVA_CLIENT_ID', 'Canva');
  const verifier = b64url(crypto.randomBytes(64));
  const state = b64url(crypto.randomBytes(16));
  await db.put('kv', { id: `canva-state-${state}`, verifier, createdAt: now() });
  const q = new URLSearchParams({
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 's256',
    scope: CANVA_SCOPES, response_type: 'code', client_id: cid, redirect_uri: `${baseUrl(req)}/api/canva/callback`, state,
  });
  res.writeHead(302, { Location: `https://www.canva.com/api/oauth/authorize?${q}` }); res.end();
});
route('GET', '/api/canva/callback', async (req, p, url, res) => {
  const state = url.searchParams.get('state') || '', code = url.searchParams.get('code');
  const rec = /^[\w-]+$/.test(state) ? await db.get('kv', `canva-state-${state}`) : null;
  if (!code || !rec) return send(res, 400, `Canva bağlantısı başarısız: ${url.searchParams.get('error') || 'geçersiz durum'}`);
  await db.del('kv', `canva-state-${state}`);
  await canvaToken({ grant_type: 'authorization_code', code, code_verifier: rec.verifier, redirect_uri: `${baseUrl(req)}/api/canva/callback` });
  res.writeHead(302, { Location: '/#gorsel' }); res.end();
});
route('POST', '/api/canva/disconnect', async () => { await db.del('kv', 'canva-token'); return { ok: true }; });
route('POST', '/api/canva/export/:id', async (req, { id }) => {
  const m = (await db.get('media', id)) || fail(404, 'Medya yok');
  const b = await readJson(req);
  if (b.canvaSize) m.canvaSize = b.canvaSize;
  m.canvaUrl = await canvaExport(m);
  await db.put('media', m);
  return { editUrl: m.canvaUrl };
});

// ================================================================ diagnostics (Ayarlar → Sistem kontrolü)
function keyKind(k) {
  if (!k) return 'yok';
  if (k.startsWith('sb_secret_')) return 'secret';
  if (k.startsWith('sb_publishable_')) return 'publishable';
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role || 'jwt'; } catch { return 'bilinmeyen'; }
}
const withTimeout = (p, ms = 20000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`zaman aşımı (${ms / 1000} sn)`)), ms))]);
route('GET', '/api/diagnostics', async (req, p, url) => {
  const live = url.searchParams.get('live') === '1';
  const checks = [];
  const check = async (area, name, fn) => {
    const t = Date.now();
    try { const r = await withTimeout(fn()); checks.push({ area, name, status: r?.status || 'ok', detail: r?.detail ?? r ?? '', ms: Date.now() - t }); }
    catch (e) { checks.push({ area, name, status: 'fail', detail: e.message, ms: Date.now() - t }); }
  };
  const skip = detail => ({ status: 'skip', detail });
  const tasks = [];

  // --- ortam
  const NAMES = ['APP_USER', 'APP_PASSWORD', 'AUTH_SECRET', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'REPLICATE_API_TOKEN', 'REPLICATE_IMAGE_MODEL', 'REPLICATE_VIDEO_MODEL',
    'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'UNSPLASH_ACCESS_KEY', 'TRENDS_MCP_KEY', 'TRENDS_MCP_URL', 'TRENDS_MONTHLY_LIMIT', 'CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET', 'PUBLIC_URL'];
  tasks.push(check('Ortam', 'Tanımlı değişkenler', async () => ({ detail: NAMES.filter(n => process.env[n]).join(', ') || 'hiçbiri' })));
  tasks.push(check('Ortam', 'Çalışma ortamı', async () => ({ detail: `Node ${process.version} · bölge ${process.env.VERCEL_REGION || 'yerel'} · adres ${baseUrl(req)}` })));

  // --- veritabanı + depolama
  tasks.push(check('Veritabanı', 'Anahtar türü', async () => {
    const kind = keyKind(env('SUPABASE_SECRET_KEY'));
    if (!env('SUPABASE_URL')) return { status: 'fail', detail: 'SUPABASE_URL yok' };
    if (kind === 'yok') return { status: 'fail', detail: 'SUPABASE_SECRET_KEY yok. Supabase → Project Settings → API Keys → Secret keys (sb_secret_...) gerekli.' };
    if (['publishable', 'anon'].includes(kind)) return { status: 'fail', detail: `Tanımlı anahtar "${kind}" türünde (herkese açık). Yazma için secret key (sb_secret_...) gerekli.` };
    return { detail: `${kind} · ${SB()}` };
  }));
  if (env('SUPABASE_URL') && ['secret', 'service_role'].includes(keyKind(env('SUPABASE_SECRET_KEY')))) {
    tasks.push(check('Veritabanı', 'Okuma', async () => { const r = await fetchJson(`${SB()}/rest/v1/items?select=collection&limit=1`, { headers: sbHeaders() }, 'Veritabanı'); return { detail: `tablo erişilebilir (${r.length} örnek satır)` }; }));
    tasks.push(check('Veritabanı', 'Yazma / silme', async () => { await db.put('kv', { id: 'diag', at: now() }); await db.del('kv', 'diag'); return { detail: 'yaz-sil başarılı' }; }));
    tasks.push(check('Veritabanı', 'İçerik sayıları', async () => {
      const cols = ['posts', 'ideas', 'media', 'trends', 'video_jobs'];
      const counts = await Promise.all(cols.map(c => db.list(c).then(l => `${c}: ${l.length}`)));
      return { detail: counts.join(' · ') };
    }));
    tasks.push(check('Depolama', 'Medya klasörü', async () => { const b = await fetchJson(`${SB()}/storage/v1/bucket/${BUCKET}`, { headers: sbHeaders() }, 'Depolama'); return { detail: `${b.name} · public=${b.public} · sınır ${Math.round((b.file_size_limit || 0) / 1e6)} MB` }; }));
    tasks.push(check('Depolama', 'Yükleme linki', async () => { await signedUploadUrl(`diag-${newId()}.jpg`); return { detail: 'imzalı yükleme linki üretilebiliyor' }; }));
  }

  // --- trend (sıralı: liste → eşleştirme → isteğe bağlı canlı deneme)
  tasks.push((async () => {
    if (!env('TRENDS_MCP_KEY')) return check('Trendler', 'Bağlantı', async () => skip('TRENDS_MCP_KEY yok'));
    let schema = null;
    await check('Trendler', 'Bağlantı ve araç listesi', async () => {
      trendToolCache = null; mcpReady = false;
      schema = await trendSchema(true);
      const fmt = s => Object.entries(s.params).map(([k, v]) => {
        const vals = v.enum || v.suggest;
        return `${k}${s.required.includes(k) ? '*' : ''}${vals ? `∈{${vals.slice(0, 15).join('|')}${vals.length > 15 ? `|…(${vals.length})` : ''}}${v.enum ? '' : '~'}` : ''}`;
      }).join(', ');
      return { detail: `protokol ${mcpProtocol} · ${schema.length} araç (* zorunlu, ~ açıklamadan çıkarıldı): ` + schema.map(s => `${s.name} → ${s.intent || '?'}(${fmt(s)})`).join('; ') };
    });
    if (!schema) return;
    const first = (i, p, d) => { const t = schema.find(s => s.intent === i); const v = t?.params?.[p]; return (v?.enum || v?.suggest || [])[0] ?? d; };
    const pickSrc = i => { const t = schema.find(s => s.intent === i); const en = t?.params?.source?.enum || t?.params?.source?.suggest || []; return en.find(x => /google/i.test(x)) || en[0] || 'google search'; };
    await check('Trendler', 'Araç eşleştirme', async () => {
      const samples = [
        ['get_growth', { keyword: 'dash cam', source: pickSrc('get_growth'), percent_growth: [first('get_growth', 'percent_growth', '1M')] }],
        ['get_time_series', { keyword: 'dash cam', source: pickSrc('get_time_series') }],
        ['get_top_posts', { keyword: 'dash cam', source: pickSrc('get_top_posts'), limit: 5 }],
        ['get_top_trends', { type: first('get_top_trends', 'type', 'Google Trends'), limit: 3, country: 'CA' }],
      ];
      const out = [];
      for (const [n, a] of samples) {
        try { const r = await resolveTrendTool(n, a); out.push(`${n} → ${r.name}${baseName(r.name) === n ? '' : ' (YAKIN EŞLEŞME)'} ${JSON.stringify(r.args)}`); }
        catch (e) { out.push(`${n} → HATA: ${e.message}`); }
      }
      return { status: out.some(x => x.includes('HATA')) ? 'fail' : 'ok', detail: out.join(' | ') };
    });
    if (live) await check('Trendler', 'Canlı deneme (en fazla 2 istek)', async () => {
      // kaynak geçici olarak kapalıysa bir sonraki kaynağı dene
      const t = schema.find(s => s.intent === 'get_growth');
      const srcs = [pickSrc('get_growth'), ...((t?.params?.source?.enum || t?.params?.source?.suggest || ['youtube']).filter(x => x !== pickSrc('get_growth')))].slice(0, 2);
      const wins = t?.params?.percent_growth?.enum || t?.params?.percent_growth?.suggest || [];
      const win = wins.includes('1M') ? '1M' : wins[0] || '1M';
      const notes = [];
      for (const source of srcs) {
        const r = await resolveTrendTool('get_growth', { keyword: 'dash cam', source, percent_growth: [win] });
        await bumpUsage();
        const out = await mcpCall('tools/call', { name: r.name, arguments: r.args });
        const text = (out.content || []).map(c => c.text || '').join(' ') || JSON.stringify(out.structuredContent || out);
        const f = trendFailure(text) || (out.isError ? { status: 0, message: text.slice(0, 300) } : null);
        if (!f) return { detail: `${notes.length ? notes.join(' | ') + ' | ' : ''}${r.name} ${JSON.stringify(r.args)} → ${text.slice(0, 600)}` };
        notes.push(`${source}: ${friendlyTrendError(f, r.args)} (ham: ${text.slice(0, 160)})`);
        if (!/unavailable|timeout|temporar/i.test(`${f.code} ${f.message}`) && ![500, 502, 503, 504].includes(f.status)) break;
      }
      return { status: 'fail', detail: notes.join(' | ') };
    });
    await check('Trendler', 'Bu ayki kullanım', async () => { const u = await trendUsage(); return { detail: `${u.month}: ${u.count} istek${u.limit ? ' / ' + u.limit : ''}` }; });
  })());

  // --- Claude
  tasks.push(check('İçerik (Claude)', 'Anahtar ve model', async () => {
    if (!env('ANTHROPIC_API_KEY')) return skip('ANTHROPIC_API_KEY yok — fikir ve caption üretimi kapalı');
    const d = await fetchJson('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' } }, 'Claude API');
    const ids = (d.data || []).map(m => m.id), want = env('ANTHROPIC_MODEL', 'claude-sonnet-5-5');
    return ids.includes(want) ? { detail: `anahtar geçerli · model ${want} mevcut` } : { status: 'fail', detail: `model "${want}" listede yok. Mevcut: ${ids.slice(0, 12).join(', ')}` };
  }));

  // --- Replicate
  tasks.push(check('Görsel/Video (Replicate)', 'Hesap', async () => {
    if (!env('REPLICATE_API_TOKEN')) return skip('REPLICATE_API_TOKEN yok — görsel ve video üretimi kapalı');
    const a = await fetchJson('https://api.replicate.com/v1/account', { headers: { Authorization: `Bearer ${env('REPLICATE_API_TOKEN')}` } }, 'Replicate');
    return { detail: `hesap: ${a.username || a.name || 'doğrulandı'}` };
  }));
  for (const [label, key, def] of [['Görsel modeli', 'REPLICATE_IMAGE_MODEL', 'black-forest-labs/flux-schnell'], ['Video modeli', 'REPLICATE_VIDEO_MODEL', 'minimax/video-01']]) {
    tasks.push(check('Görsel/Video (Replicate)', label, async () => {
      if (!env('REPLICATE_API_TOKEN')) return skip('anahtar yok');
      const m = env(key, def).split(':')[0];
      const d = await fetchJson(`https://api.replicate.com/v1/models/${m}`, { headers: { Authorization: `Bearer ${env('REPLICATE_API_TOKEN')}` } }, 'Replicate');
      return { detail: `${m} mevcut · ${d.run_count ?? '?'} çalıştırma` };
    }));
  }

  // --- stok
  const stockKeys = { pexels: 'PEXELS_API_KEY', pixabay: 'PIXABAY_API_KEY', unsplash: 'UNSPLASH_ACCESS_KEY' };
  for (const [src, key] of Object.entries(stockKeys)) {
    tasks.push(check('Stok fotoğraf', src, async () => {
      if (!env(key)) return skip(`${key} yok`);
      const r = await stockSearch(src, 'car');
      return { detail: `${r.length} sonuç döndü` };
    }));
  }

  // --- anahtarsız servisler
  tasks.push(check('Ücretsiz servisler', 'Tatiller (Nager.Date)', async () => {
    const y = new Date().getFullYear(); holidayCache.delete(y);
    const l = await holidays(y); return { detail: `${y}: ${l.length} BC/Kanada tatili` };
  }));
  tasks.push(check('Ücretsiz servisler', 'Openverse', async () => ({ detail: `${(await stockSearch('openverse', 'car')).length} ticari lisanslı sonuç` })));
  tasks.push(check('Ücretsiz servisler', 'Renk paleti (Colormind)', async () => {
    const r = await palette({ mode: 'brand' });
    return r.source === 'colormind' ? { detail: r.colors.join(' ') } : { status: 'fail', detail: r.note };
  }));

  // --- Canva
  tasks.push(check('Canva', 'Uygulama ve hesap', async () => {
    if (!(env('CANVA_CLIENT_ID') && env('CANVA_CLIENT_SECRET'))) return skip(`CANVA_CLIENT_ID / SECRET yok. Redirect URL: ${baseUrl(req)}/api/canva/callback`);
    if (!['secret', 'service_role'].includes(keyKind(env('SUPABASE_SECRET_KEY')))) return skip('Canva oturumu veritabanında saklanır; önce veritabanı gerekli');
    const t = await db.get('kv', 'canva-token');
    if (!t) return { status: 'skip', detail: 'uygulama tanımlı, hesap henüz bağlanmadı (Görsel → Canva\'yı bağla)' };
    const me = await fetchJson('https://api.canva.com/rest/v1/users/me', { headers: { Authorization: `Bearer ${await canvaAccess()}` } }, 'Canva');
    return { detail: `bağlı · kullanıcı ${me.team_user?.user_id || 'doğrulandı'}` };
  }));

  await Promise.all(tasks);
  const order = ['Ortam', 'Veritabanı', 'Depolama', 'Trendler', 'İçerik (Claude)', 'Görsel/Video (Replicate)', 'Stok fotoğraf', 'Ücretsiz servisler', 'Canva'];
  checks.sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  return { at: now(), summary: { ok: checks.filter(c => c.status === 'ok').length, fail: checks.filter(c => c.status === 'fail').length, skip: checks.filter(c => c.status === 'skip').length }, checks };
});

// ================================================================ main handler
function serveStatic(res, rel) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Bulunamadı');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(file));
}
const OPEN = new Set(['/login', '/login.html', '/api/login', '/style.css', '/favicon.svg']);

module.exports = async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  try {
    const authed = !!readSession(req);
    if (!authed && !OPEN.has(url.pathname)) {
      if (url.pathname.startsWith('/api/')) fail(401, 'Oturum gerekli');
      res.writeHead(302, { Location: '/login' }); return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        const m = r.method === req.method && r.re.exec(url.pathname);
        if (!m) continue;
        const out = await r.handler(req, m.groups || {}, url, res);
        if (!res.headersSent && out !== undefined) send(res, 200, out);
        return;
      }
      fail(404, 'Bilinmeyen istek');
    }
    if (url.pathname === '/login') return serveStatic(res, 'login.html');
    return serveStatic(res, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || String(e) });
    if (!e.status) console.error(e);
  }
};
