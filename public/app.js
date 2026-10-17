'use strict';
// ============================================================ ortak
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUSES = ['Fikir', 'Taslak', 'Hazır', 'Zamanlandı', 'Yayınlandı', 'Atla'];
const PLATFORMS = ['Instagram', 'Facebook', 'YouTube', 'LinkedIn'];
const PF = { Instagram: 'IG', Facebook: 'FB', YouTube: 'YT', LinkedIn: 'LI' };
const PILLARS = ['Kurulum işçiliği', 'Görüntü kalitesi', 'Bilgi ve eğitim', 'Güven ve hikâye', 'Ürün'];
const FORMATS = ['Reel', 'Carousel', 'Görsel', 'Story', 'Short', 'Uzun video', 'Metin + görsel', '-'];
const state = { status: {}, posts: [], ideas: [], media: [], holidays: {}, month: null, filter: null, platform: null, view: 'month' };

async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers = { 'Content-Type': 'application/json' }; }
  const r = await fetch(path, o);
  if (r.status === 401 && !path.startsWith('/api/canva')) { location.href = '/login'; throw new Error('Oturum gerekli'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Hata ${r.status}`);
  return d;
}
let toastT;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', err ? 7000 : 3000);
}
async function busy(btn, fn) {
  const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Çalışıyor';
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = label; }
}
const opts = (list, sel, blank) => (blank ? `<option value="">${blank}</option>` : '') + list.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const pfBadges = ps => (ps || []).map(p => `<span class="pf">${PF[p] || esc(p)}</span>`).join(' ');
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const copy = async t => { await navigator.clipboard.writeText(t || ''); toast('Kopyalandı'); };
const mediaTag = (m, attrs = '') => m.type === 'video'
  ? `<video src="${esc(m.url)}" muted loop playsinline preload="metadata" ${attrs} onmouseenter="this.play()" onmouseleave="this.pause()"></video>`
  : `<img src="${esc(m.url)}" loading="lazy" alt="${esc(m.title)}" ${attrs}>`;

// ============================================================ sekmeler
function showTab() {
  const tab = (location.hash || '#takvim').slice(1);
  $$('section').forEach(s => s.classList.toggle('active', s.id === tab));
  $$('nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  if (tab === 'gorsel') { renderCanvaBar(); renderLibrary(); }
  if (tab === 'video') renderVideoImages();
  if (tab === 'trend') loadTrendSchema();
}
window.addEventListener('hashchange', showTab);

// ============================================================ TAKVİM
const DOW = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
const fmtDay = ds => new Date(ds + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' });
const visiblePost = p => (!state.filter || p.status === state.filter) && (!state.platform || (p.platforms || []).includes(state.platform));

// --- tatiller (Nager.Date, sunucu üzerinden) + pazarlama günleri (yerel hesap)
const holidayYears = new Set();
function nthWeekday(y, m, wd, n) { const d = new Date(y, m, 1); d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7); return d; }
function marketingDays(y) {
  const bf = nthWeekday(y, 10, 4, 4); bf.setDate(bf.getDate() + 1);
  const cm = new Date(bf); cm.setDate(bf.getDate() + 3);
  return [
    [`${y}-10-01`, 'BC kış lastiği dönemi başlıyor', 'Çoğu BC otoyolunda 1 Ekim – 31 Mart arası kış lastiği zorunlu. Kış sürüşü içeriği için iyi gün.'],
    [`${y}-03-31`, 'BC kış lastiği dönemi bitiyor', ''],
    [ymd(nthWeekday(y, 2, 0, 2)), 'Saatler ileri alınıyor', 'Sabah sürüşleri bir süre yeniden karanlık.'],
    [ymd(nthWeekday(y, 10, 0, 1)), 'Saatler geri alınıyor', 'Akşam dönüşleri karanlıkta başlıyor: gece kaydı içeriği.'],
    [`${y}-10-31`, 'Halloween', 'Akşam yaya ve çocuk trafiği yüksek: dikkatli sürüş hatırlatması.'],
    [ymd(bf), 'Black Friday', 'Kampanya / paket fiyatı dönemi.'],
    [ymd(cm), 'Cyber Monday', 'Online kampanya günü.'],
    [`${y}-12-26`, 'Boxing Day', 'Yıl sonu kampanya dönemi.'],
    [ymd(nthWeekday(y, 4, 0, 2)), 'Anneler Günü', 'Hediye fikri olarak dashcam.'],
    [ymd(nthWeekday(y, 5, 0, 3)), 'Babalar Günü', 'Hediye fikri olarak dashcam.'],
  ];
}
async function ensureHolidays(years) {
  const need = years.filter(y => !holidayYears.has(y));
  if (!need.length) return;
  need.forEach(y => holidayYears.add(y));
  for (const y of need) for (const [date, name, hint] of marketingDays(y)) (state.holidays[date] ||= []).push({ name, kind: 'pazarlama', hint });
  try {
    const list = await api(`/api/holidays?years=${need.join(',')}`);
    for (const h of list) {
      const day = (state.holidays[h.date] ||= []);
      const i = day.findIndex(x => x.kind === 'pazarlama' && x.name === h.name);
      if (i >= 0) day.splice(i, 1);
      day.unshift({ name: h.name, kind: 'tatil', scope: h.scope, hint: `Resmi tatil (${h.scope}).` });
    }
  } catch (e) { console.warn('Tatiller alınamadı:', e.message); }
}
const holidayTags = ds => (state.holidays[ds] || []).map((h, i) => `<div class="hol ${h.kind}" data-hol="${i}" title="${esc(h.hint || '')}">${esc(h.name)}</div>`).join('');

async function renderCalendar() {
  const m = state.month;
  $('#calTitle').textContent = m.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // Pazartesi başlangıç
  const end = new Date(start); end.setDate(start.getDate() + 41);
  await ensureHolidays([...new Set([start.getFullYear(), end.getFullYear()])]);

  const key = ymd(m).slice(0, 7);
  const monthPosts = state.posts.filter(p => p.date.startsWith(key) && (!state.platform || (p.platforms || []).includes(state.platform)));
  $('#calStats').innerHTML = STATUSES.map(s => {
    const n = monthPosts.filter(p => p.status === s).length;
    return `<div class="stat ${state.filter === s ? 'on' : ''}" data-st="${s}"><b>${n}</b><span class="st-${s}">${s}</span></div>`;
  }).join('') + (state.filter ? `<div class="stat" data-st=""><span class="muted">Filtreyi kaldır</span></div>` : '');
  $$('#calStats .stat').forEach(el => el.onclick = () => { state.filter = el.dataset.st || null; renderCalendar(); });

  // içerik dengesi (atlananlar hariç)
  const active = monthPosts.filter(p => p.status !== 'Atla');
  const count = (list, f) => list.map(x => [x, active.filter(p => f(p, x)).length]);
  const bar = pairs => pairs.map(([n, c]) => `<span class="mixitem">${esc(n)} <b>${c}</b></span>`).join('');
  $('#calMix').innerHTML = active.length
    ? `<div><span class="muted">Sütunlar:</span> ${bar(count(PILLARS, (p, x) => p.pillar === x))}</div><div><span class="muted">Platformlar:</span> ${bar(count(PLATFORMS, (p, x) => (p.platforms || []).includes(x)))}</div>`
    : '';

  $('#cal').style.display = state.view === 'list' ? 'none' : '';
  $('#calList').style.display = state.view === 'list' ? '' : 'none';
  $$('#calView button').forEach(b => b.classList.toggle('on', b.dataset.view === (state.view || 'month')));
  if (state.view === 'list') return renderList(key);

  const today = ymd(new Date());
  let html = DOW.map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const ds = ymd(d);
    const posts = state.posts.filter(p => p.date === ds && visiblePost(p)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    html += `<div class="day ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${ds === today ? 'today' : ''}" data-date="${ds}">
      <div class="num">${d.getDate()}</div>${holidayTags(ds)}
      ${posts.map(p => `<div class="chip st-${esc(p.status)}" draggable="true" data-id="${p.id}">${pfBadges(p.platforms)} <span class="muted">${esc(p.format)}</span><span class="t">${esc(p.topic || '(konu yok)')}</span></div>`).join('')}
    </div>`;
  }
  $('#cal').innerHTML = html;
  $$('#cal .day').forEach(el => {
    el.onclick = e => {
      const chip = e.target.closest('.chip');
      if (chip) return openPost(state.posts.find(p => p.id === chip.dataset.id));
      const hol = e.target.closest('.hol');
      if (hol) return openPostForHoliday(el.dataset.date, state.holidays[el.dataset.date][hol.dataset.hol]);
      openPost(blankPost(el.dataset.date));
    };
    el.ondragover = e => { e.preventDefault(); el.classList.add('drop'); };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = e => { e.preventDefault(); el.classList.remove('drop'); movePost(e.dataTransfer.getData('text/plain'), el.dataset.date); };
  });
  $$('#cal .chip').forEach(c => c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; });
}
function renderList(key) {
  const today = ymd(new Date());
  const days = new Set([...state.posts.filter(p => p.date.startsWith(key) && visiblePost(p)).map(p => p.date), ...Object.keys(state.holidays).filter(d => d.startsWith(key) && state.holidays[d].length)]);
  const sorted = [...days].sort();
  $('#calList').innerHTML = sorted.length ? sorted.map(ds => {
    const posts = state.posts.filter(p => p.date === ds && visiblePost(p)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    return `<div class="lday ${ds === today ? 'today' : ''} ${ds < today ? 'past' : ''}" data-date="${ds}">
      <div class="ldate">${esc(fmtDay(ds))}${holidayTags(ds)}</div>
      <div class="lposts">${posts.map(p => `<div class="lrow" data-id="${p.id}">
          <span class="small muted" style="width:44px">${esc(p.time || '')}</span>
          <span style="width:90px">${pfBadges(p.platforms)}</span>
          <span class="small muted" style="width:96px">${esc(p.format || '')}</span>
          <span class="t" data-open>${esc(p.topic || '(konu yok)')}</span>
          <select class="small st-${esc(p.status)}" data-status>${opts(STATUSES, p.status)}</select>
        </div>`).join('') || '<span class="muted small">Paylaşım yok</span>'}</div>
    </div>`;
  }).join('') : '<div class="empty">Bu ay için paylaşım yok.</div>';
  $$('#calList .lrow').forEach(row => {
    const p = state.posts.find(x => x.id === row.dataset.id);
    row.querySelector('[data-open]').onclick = () => openPost(p);
    row.querySelector('[data-status]').onchange = async e => {
      const status = e.target.value, old = p.status;
      p.status = status; renderCalendar();
      try { Object.assign(p, await api(`/api/posts/${p.id}`, { method: 'PUT', body: { status } })); toast(`Durum: ${status}`); }
      catch (err) { p.status = old; renderCalendar(); toast(err.message, true); }
    };
  });
  $$('#calList .hol').forEach(h => h.onclick = () => { const ds = h.closest('.lday').dataset.date; openPostForHoliday(ds, state.holidays[ds][h.dataset.hol]); });
}
async function movePost(id, date) {
  const p = state.posts.find(x => x.id === id);
  if (!p || p.date === date) return;
  const old = p.date; p.date = date; renderCalendar();
  try { Object.assign(p, await api(`/api/posts/${id}`, { method: 'PUT', body: { date } })); toast(`${fmtDay(date)} gününe taşındı`); }
  catch (e) { p.date = old; renderCalendar(); toast(e.message, true); }
}
const blankPost = date => ({ date, time: '18:00', platforms: ['Instagram', 'Facebook'], status: 'Fikir', mediaIds: [] });
function openPostForHoliday(date, h) {
  openPost({ ...blankPost(date), topic: h.name, notes: h.hint || '', status: 'Fikir' });
}
function nextFreeDate() {
  let d = addDays(ymd(new Date()), 1);
  for (let i = 0; i < 90; i++, d = addDays(d, 1)) {
    const sunday = new Date(d + 'T12:00:00').getDay() === 0;
    const holiday = (state.holidays[d] || []).some(h => h.kind === 'tatil');
    if (!sunday && !holiday && !state.posts.some(p => p.date === d)) return d;
  }
  return addDays(ymd(new Date()), 1);
}
$('#calPrev').onclick = () => { state.month.setMonth(state.month.getMonth() - 1); renderCalendar(); };
$('#calNext').onclick = () => { state.month.setMonth(state.month.getMonth() + 1); renderCalendar(); };
$('#calToday').onclick = () => { const n = new Date(); state.month = new Date(n.getFullYear(), n.getMonth(), 1); renderCalendar(); };
$('#calNew').onclick = () => openPost(blankPost(ymd(new Date())));
$$('#calView button').forEach(b => b.onclick = () => { state.view = b.dataset.view; try { localStorage.setItem('calView', state.view); } catch { } renderCalendar(); });
$('#calPlatform').onchange = () => { state.platform = $('#calPlatform').value || null; renderCalendar(); };
$('#calCsv').onclick = () => {
  const key = ymd(state.month).slice(0, 7);
  const rows = state.posts.filter(p => p.date.startsWith(key) && visiblePost(p)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const cols = [['Tarih', 'date'], ['Saat', 'time'], ['Platformlar', p => (p.platforms || []).join(' + ')], ['Format', 'format'], ['Sütun', 'pillar'], ['Konu', 'topic'], ['Durum', 'status'], ['Caption', 'caption'], ['Notlar', 'notes']];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = String.fromCharCode(0xFEFF) + [cols.map(c => cell(c[0])).join(','), ...rows.map(p => cols.map(([, f]) => cell(typeof f === 'function' ? f(p) : p[f])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `aurora-takvim-${key}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${rows.length} paylaşım dışa aktarıldı`);
};

// paylaşım düzenleyici
let editing = null;
function openPost(p) {
  editing = { ...p, mediaIds: [...(p.mediaIds || [])], palette: p.palette ? [...p.palette] : [] };
  $('#pmTitle').textContent = p.id ? 'Paylaşımı düzenle' : p.dupOf ? 'Kopya — tarihi seç ve kaydet' : 'Yeni paylaşım';
  $('#pmDate').value = p.date || ''; $('#pmTime').value = p.time || '18:00';
  $('#pmStatus').innerHTML = opts(STATUSES, p.status || 'Fikir');
  $('#pmFormat').innerHTML = opts(FORMATS, p.format, 'Seç');
  $('#pmPillar').innerHTML = opts(PILLARS, p.pillar, 'Seç');
  $('#pmPlatforms').innerHTML = PLATFORMS.map(x => `<label class="btn sm" style="margin:0"><input type="checkbox" value="${x}" ${(p.platforms || []).includes(x) ? 'checked' : ''} style="width:auto;margin-right:6px">${x}</label>`).join('');
  $('#pmTopic').value = p.topic || ''; $('#pmCaption').value = p.caption || ''; $('#pmNotes').value = p.notes || '';
  $('#pmSuggestions').innerHTML = '';
  $('#pmDelete').style.visibility = p.id ? 'visible' : 'hidden';
  $('#pmDup').style.display = p.id ? '' : 'none';
  $('#pmImgBox').style.display = p.imagePrompt ? '' : 'none'; $('#pmImgText').textContent = p.imagePrompt || '';
  $('#pmSuggest').textContent = state.status.claude ? 'Caption öner' : 'Caption öner (Gemini)';
  renderPostMedia(); renderPalette(); updateCounter(); updateDayInfo();
  $('#postModal').classList.add('open');
}
function updateDayInfo() {
  const ds = $('#pmDate').value;
  ensureHolidays(ds ? [Number(ds.slice(0, 4))] : []).then(() => {
    const hs = state.holidays[ds] || [];
    $('#pmDayInfo').innerHTML = hs.map(h => `<span class="hol ${h.kind}">${esc(h.name)}</span> <span class="muted">${esc(h.hint || '')}</span>`).join('<br>');
  });
}
const CAP_LIMITS = { Instagram: 2200, LinkedIn: 3000, Facebook: 63206 };
function updateCounter() {
  const t = $('#pmCaption').value, pfs = $$('#pmPlatforms input:checked').map(i => i.value);
  const tags = (t.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  const warn = [];
  for (const p of pfs) if (CAP_LIMITS[p] && t.length > CAP_LIMITS[p]) warn.push(`${p} sınırı ${CAP_LIMITS[p]} karakter`);
  if (pfs.includes('Instagram') && tags > 30) warn.push('Instagram en fazla 30 hashtag');
  if (pfs.includes('YouTube') && (t.split('\n')[0] || '').length > 100) warn.push('YouTube başlığı (ilk satır) 100 karakteri aşıyor');
  if (pfs.includes('LinkedIn') && tags > 5) warn.push('LinkedIn için 3-5 hashtag yeterli');
  $('#pmCount').innerHTML = `${t.length} karakter · ${tags} hashtag` + (warn.length ? ` · <span style="color:var(--warn)">${esc(warn.join(' · '))}</span>` : '');
}
$('#pmCaption').oninput = updateCounter;
$('#pmPlatforms').onchange = updateCounter;
$('#pmDate').onchange = updateDayInfo;
function renderPostMedia() {
  const items = editing.mediaIds.map(id => state.media.find(m => m.id === id)).filter(Boolean);
  $('#pmMedia').innerHTML = items.length ? items.map(m => `<a href="${esc(m.url)}" target="_blank" title="${esc(m.title)}">${mediaTag(m)}</a>`).join('') : '<span class="muted small">Medya eklenmedi.</span>';
}
function renderPalette() {
  const c = editing.palette || [];
  $('#pmPalette').innerHTML = c.length
    ? c.map(h => `<button class="sw" style="background:${esc(h)}" data-hex="${esc(h)}" title="Kopyala"><span>${esc(h)}</span></button>`).join('') + `<button class="btn sm" id="pmPalClear">Kaldır</button>`
    : '<span class="muted small">Palet yok. Canva tasarımında kullanılacak renkler için öner.</span>';
  $$('#pmPalette .sw').forEach(b => b.onclick = () => copy(b.dataset.hex));
  const clr = $('#pmPalClear'); if (clr) clr.onclick = () => { editing.palette = []; renderPalette(); };
}
$('#pmPalMode').onchange = () => { $('#pmPalBase').style.display = $('#pmPalMode').value === 'color' ? '' : 'none'; };
$('#pmPalBtn').onclick = () => busy($('#pmPalBtn'), async () => {
  const r = await api('/api/palette', { method: 'POST', body: { mode: $('#pmPalMode').value, base: $('#pmPalBase').value } });
  editing.palette = r.colors; renderPalette();
  if (r.note) toast(r.note);
});
function readPost() {
  return {
    date: $('#pmDate').value, time: $('#pmTime').value, status: $('#pmStatus').value,
    platforms: $$('#pmPlatforms input:checked').map(i => i.value),
    format: $('#pmFormat').value, pillar: $('#pmPillar').value, topic: $('#pmTopic').value.trim(),
    caption: $('#pmCaption').value, notes: $('#pmNotes').value, mediaIds: editing.mediaIds, palette: editing.palette || [],
    ...(editing.ideaId ? { ideaId: editing.ideaId } : {}),
    ...(editing.imagePrompt ? { imagePrompt: editing.imagePrompt } : {}),
  };
}
$('#pmSave').onclick = () => busy($('#pmSave'), async () => {
  const body = readPost();
  if (!body.date) throw new Error('Tarih seç');
  let saved;
  if (editing.id) {
    saved = await api(`/api/posts/${editing.id}`, { method: 'PUT', body });
    state.posts = state.posts.map(x => x.id === saved.id ? saved : x);
  } else state.posts.push(saved = await api('/api/posts', { method: 'POST', body }));
  // fikirden geldiyse fikri "takvimde" olarak işaretle
  const idea = editing.ideaId && state.ideas.find(i => i.id === editing.ideaId);
  if (idea && idea.usedPostId !== saved.id) {
    Object.assign(idea, { usedPostId: saved.id, usedDate: saved.date });
    api(`/api/ideas/${idea.id}`, { method: 'PUT', body: { usedPostId: saved.id, usedDate: saved.date } }).catch(e => toast(e.message, true));
  }
  const d = new Date(saved.date + 'T12:00:00'); state.month = new Date(d.getFullYear(), d.getMonth(), 1);
  $('#postModal').classList.remove('open'); renderCalendar(); renderIdeas(); toast(`Kaydedildi · ${fmtDay(saved.date)}`);
});
$('#pmDelete').onclick = async () => {
  if (!editing.id || !confirm('Bu paylaşım silinsin mi?')) return;
  try { await api(`/api/posts/${editing.id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message, true); }
  state.posts = state.posts.filter(x => x.id !== editing.id);
  $('#postModal').classList.remove('open'); renderCalendar(); renderIdeas();
};
$('#pmDup').onclick = () => {
  const cur = readPost();
  openPost({ ...cur, ideaId: undefined, mediaIds: [...cur.mediaIds], date: addDays(cur.date || ymd(new Date()), 7), status: 'Taslak', dupOf: editing.id });
};
$('#pmCopy').onclick = () => copy($('#pmCaption').value);
$('#pmImgCopy').onclick = async () => { await copy(imageAsk(editing.imagePrompt || '', $('#pmFormat').value)); toast('Görsel tarifi doğru oranla kopyalandı. ChatGPT\'ye yapıştır.'); };
// caption önerisi: API anahtarı yoksa Gemini ile elle
function parseCaptions(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const o = t.indexOf('{'), c = t.lastIndexOf('}');
  if (o >= 0 && c > o) { try { const j = JSON.parse(t.slice(o, c + 1)); if (Array.isArray(j.captions) && j.captions.length) return j.captions.map(String); } catch { } }
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a >= 0 && b > a) { try { const j = JSON.parse(t.slice(a, b + 1)); if (Array.isArray(j) && j.length) return j.map(String); } catch { } }
  const parts = t.split(/\n\s*(?:-{3,}|\d+[.)]|Caption \d+:?)\s*|\n{2,}/i).map(x => x.trim()).filter(x => x.length > 20);
  if (parts.length) return parts.slice(0, 5);
  throw new Error('Cevapta caption bulunamadı. Gemini\'nin cevabının tamamını yapıştır.');
}
function showCaptionChoices(caps) {
  $('#pmSuggestions').innerHTML = caps.map((c, i) => `<div class="card"><div class="cap">${esc(c)}</div><div class="actions"><button class="btn sm" data-i="${i}">Bunu kullan</button></div></div>`).join('');
  $$('#pmSuggestions [data-i]').forEach(b => b.onclick = () => { $('#pmCaption').value = caps[b.dataset.i]; $('#pmSuggestions').innerHTML = ''; updateCounter(); });
}
$('#pmSuggest').onclick = () => busy($('#pmSuggest'), async () => {
  if (state.status.claude) {
    const r = await api('/api/caption', { method: 'POST', body: { ...readPost(), tone: $('#pmTone').value } });
    return showCaptionChoices(r.captions || []);
  }
  const r = await api('/api/prompts/caption', { method: 'POST', body: { ...readPost(), tone: $('#pmTone').value } });
  await copy(r.prompt);
  $('#pmSuggestions').innerHTML = `<div class="card"><div class="small">İstek kopyalandı. <a href="https://gemini.google.com/app" target="_blank" rel="noopener">Gemini'yi aç ↗</a>, yapıştır ve cevabın tamamını aşağıya yapıştır.</div>
    <textarea id="pmGemPaste" rows="4" class="small" placeholder="Gemini'nin cevabı"></textarea>
    <div class="actions"><button class="btn sm primary" id="pmGemParse">Caption'ları ayıkla</button><button class="btn sm" id="pmGemAgain">İsteği tekrar kopyala</button></div></div>`;
  $('#pmGemAgain').onclick = () => copy(r.prompt);
  $('#pmGemParse').onclick = () => { try { showCaptionChoices(parseCaptions($('#pmGemPaste').value)); } catch (e) { toast(e.message, true); } };
});

// medya seçici
let picked = new Set();
$('#pmAddMedia').onclick = () => {
  picked = new Set(editing.mediaIds);
  $('#pickList').innerHTML = state.media.length ? state.media.map(m => `<div class="mitem ${picked.has(m.id) ? 'sel' : ''}" data-id="${m.id}">${mediaTag(m)}<div class="meta"><span class="t">${esc(m.title || m.source)}</span></div></div>`).join('') : '<div class="empty">Kütüphane boş. Görsel sekmesinden içerik ekle.</div>';
  $$('#pickList .mitem').forEach(el => el.onclick = () => { picked.has(el.dataset.id) ? picked.delete(el.dataset.id) : picked.add(el.dataset.id); el.classList.toggle('sel'); });
  $('#pickModal').classList.add('open');
};
$('#pickDone').onclick = () => { editing.mediaIds = [...picked]; renderPostMedia(); $('#pickModal').classList.remove('open'); };
$('#logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; };
$$('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.remove('open'));
$$('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) m.classList.remove('open'); }));

// ============================================================ İÇERİK
// Fikir üretimi: Gemini (ücretsiz, elle). İstek metni sunucuda kurulur; cevap buraya yapıştırılır.
let gemTrend = '';
const IMG_RATIO = f => /Reel|Story|Short/i.test(f || '') ? ['9:16', 1080, 1920] : /Uzun video/i.test(f || '') ? ['16:9', 1920, 1080] : ['4:5', 1080, 1350];
const imageAsk = (prompt, format) => { const [r, w, h] = IMG_RATIO(format); return `${String(prompt).trim().replace(/\.?$/, '.')} Aspect ratio ${r} (${w}x${h} px). Photorealistic, premium, dark and calm mood. No text, no logos, no readable licence plates, no recognisable faces.`; };
const normPick = (v, list) => { const s = String(v || '').trim().toLowerCase(); return list.find(x => x.toLowerCase() === s) || list.find(x => s && (x.toLowerCase().includes(s) || s.includes(x.toLowerCase()))) || ''; };
// Gemini cevabından fikirleri çıkar: kod bloğu, öncesi/sonrası açıklama, {ideas:[...]} biçimi tolere edilir
function parseIdeas(text) {
  let t = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  let data = null;
  if (a >= 0 && b > a) { try { data = JSON.parse(t.slice(a, b + 1)); } catch { } }
  if (!data) { const o = t.indexOf('{'), c = t.lastIndexOf('}'); if (o >= 0 && c > o) { try { const j = JSON.parse(t.slice(o, c + 1)); data = j.ideas || j.items || j.posts || (Array.isArray(j) ? j : null); } catch { } } }
  if (!Array.isArray(data)) throw new Error('Cevapta fikir listesi bulunamadı. Gemini\'nin cevabının tamamını (köşeli parantezle başlayan kısmı) yapıştırdığından emin ol.');
  const out = data.filter(x => x && typeof x === 'object' && (x.title || x.topic)).map(x => ({
    title: String(x.title || x.topic).trim(), pillar: normPick(x.pillar, PILLARS), platform: normPick(x.platform, PLATFORMS),
    format: normPick(x.format, FORMATS.filter(f => f !== '-')), caption: String(x.caption || '').trim(),
    hashtags: Array.isArray(x.hashtags) ? x.hashtags.join(' ') : String(x.hashtags || '').trim(),
    notes: String(x.notes || x.shot_list || '').trim(), imagePrompt: String(x.image_prompt || x.imagePrompt || '').trim(),
  }));
  if (!out.length) throw new Error('Listede başlığı olan fikir yok.');
  return out;
}
async function gemPrepare() {
  const r = await api('/api/prompts/ideas', { method: 'POST', body: { brief: $('#genBrief').value, pillar: $('#genPillar').value, platform: $('#genPlatform').value, count: $('#genCount').value, trend: gemTrend } });
  $('#gemPrompt').value = r.prompt; $('#gemPaste').value = ''; $('#gemPreview').innerHTML = ''; $('#gemMsg').textContent = '';
  $('#gemPanel').style.display = '';
  $('#gemPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#gemPrep').onclick = () => busy($('#gemPrep'), gemPrepare);
$('#gemClose').onclick = () => { $('#gemPanel').style.display = 'none'; };
$('#gemCopy').onclick = async () => { await copy($('#gemPrompt').value); $('#gemMsg').textContent = 'Kopyalandı. Gemini\'ye yapıştır, cevabı sağdaki kutuya yapıştır.'; };
let gemItems = [];
$('#gemParse').onclick = () => {
  try { gemItems = parseIdeas($('#gemPaste').value); } catch (e) { $('#gemPreview').innerHTML = ''; return toast(e.message, true); }
  $('#gemMsg').textContent = `${gemItems.length} fikir bulundu.`;
  $('#gemPreview').innerHTML = `<div class="cards">${gemItems.map((x, i) => `<label class="card" style="cursor:pointer">
      <div class="row spread"><span><input type="checkbox" data-gi="${i}" checked style="width:auto;margin-right:6px"><b>${esc(x.title)}</b></span>${x.platform ? `<span class="pf">${PF[x.platform] || esc(x.platform)}</span>` : ''}</div>
      <div class="small muted">${esc(x.pillar || 'sütun yok')}${x.format ? ' · ' + esc(x.format) : ''}</div>
      ${x.caption ? `<div class="cap">${esc(x.caption)}${x.hashtags ? '\n' + esc(x.hashtags) : ''}</div>` : ''}
      ${x.notes ? `<div class="small muted">Çekim: ${esc(x.notes)}</div>` : ''}
      ${x.imagePrompt ? `<div class="small muted">Görsel: ${esc(x.imagePrompt.slice(0, 160))}${x.imagePrompt.length > 160 ? '…' : ''}</div>` : ''}
    </label>`).join('')}</div>
    <div class="row"><button class="btn primary" id="gemAdd">Seçilenleri bankaya ekle</button></div>`;
  const upd = () => { $('#gemAdd').textContent = `Seçilenleri bankaya ekle (${$$('#gemPreview [data-gi]:checked').length})`; };
  $$('#gemPreview [data-gi]').forEach(c => c.onchange = upd); upd();
  $('#gemAdd').onclick = () => busy($('#gemAdd'), async () => {
    const sel = $$('#gemPreview [data-gi]:checked').map(c => gemItems[c.dataset.gi]);
    if (!sel.length) throw new Error('En az bir fikir seç');
    const list = await api('/api/ideas/bulk', { method: 'POST', body: { items: sel, source: gemTrend ? 'gemini+trend' : 'gemini' } });
    state.ideas.unshift(...list); renderIdeas();
    $('#gemPanel').style.display = 'none'; gemTrend = ''; $('#genTrend').style.display = 'none';
    toast(`${list.length} fikir bankaya eklendi`);
    $('#ideas').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
};
// trendden fikir: Trendler sekmesindeki sonucun özeti isteğe eklenir
function ideaFromTrend(summary, keyword) {
  gemTrend = summary;
  $('#genBrief').value = `Content ideas built on this trend: "${keyword}". Relate it naturally to dash cams, safe driving or evidence for ICBC claims in Vancouver/BC.`;
  $('#genTrend').innerHTML = `<span class="relb">trend verisi eklendi</span> <span class="muted">${esc(summary.slice(0, 200))}${summary.length > 200 ? '…' : ''}</span> <a href="#" id="genTrendX">kaldır</a>`;
  $('#genTrend').style.display = '';
  $('#genTrendX').onclick = e => { e.preventDefault(); gemTrend = ''; $('#genTrend').style.display = 'none'; };
  location.hash = '#icerik';
  gemPrepare().catch(e => toast(e.message, true));
}
function renderIdeas() {
  const fp = $('#idPillar').value, fpl = $('#idPlatform').value, open = $('#idOpen').checked, q = $('#idSearch').value.trim().toLocaleLowerCase('tr');
  const onCal = i => i.usedPostId && state.posts.find(p => p.id === i.usedPostId);
  const list = state.ideas.filter(i => (!fp || i.pillar === fp) && (!fpl || i.platform === fpl) && (!open || !onCal(i))
    && (!q || `${i.title} ${i.caption} ${i.notes} ${i.hashtags || ''}`.toLocaleLowerCase('tr').includes(q)));
  const used = state.ideas.filter(onCal).length;
  $('#ideaCount').textContent = `${state.ideas.length} fikir · ${used} takvimde${list.length !== state.ideas.length ? ` · ${list.length} gösteriliyor` : ''}`;
  $('#ideas').innerHTML = list.length ? list.map(i => {
    const post = onCal(i);
    return `<div class="card ${post ? 'used' : ''}" data-id="${i.id}">
      <div class="row spread"><b>${esc(i.title)}</b>${i.platform ? `<span class="pf">${PF[i.platform] || esc(i.platform)}</span>` : ''}</div>
      <div class="row small muted">${esc(i.pillar)}${i.format ? ' · ' + esc(i.format) : ''}${post ? ` · <span class="st-Yayınlandı">Takvimde: ${esc(fmtDay(post.date))}</span>` : ''}${/trend/.test(i.source || '') ? ' · <span class="relb">trendden</span>' : ''}</div>
      ${i.caption || i.hashtags ? `<div class="cap">${esc(i.caption)}${i.hashtags ? (i.caption ? '\n' : '') + esc(i.hashtags) : ''}</div>` : ''}
      ${i.notes ? `<div class="small muted">Çekim: ${esc(i.notes)}</div>` : ''}
      ${i.imagePrompt ? `<details class="small"><summary class="muted">Görsel tarifi</summary><div class="muted" style="margin-top:4px">${esc(i.imagePrompt)}</div></details>` : ''}
      <div class="actions">${post ? '<button class="btn sm" data-a="open">Takvimde aç</button>' : '<button class="btn sm primary" data-a="cal">Takvime ekle</button>'}<button class="btn sm" data-a="edit">Düzenle</button><button class="btn sm" data-a="copy">Caption'ı kopyala</button>${i.imagePrompt ? '<button class="btn sm" data-a="img" title="ChatGPT\'ye yapıştır; doğru oran eklenir">Görsel tarifini kopyala</button>' : ''}<button class="btn sm danger" data-a="del">Sil</button></div>
    </div>`;
  }).join('') : `<div class="empty">${state.ideas.length ? 'Filtreye uyan fikir yok.' : 'Henüz fikir yok. Yukarıdan Gemini ile üret ya da elle ekle.'}</div>`;
  $$('#ideas .card').forEach(card => card.onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    const idea = state.ideas.find(x => x.id === card.dataset.id);
    if (a === 'copy') return copy([idea.caption, idea.hashtags].filter(Boolean).join('\n\n'));
    if (a === 'img') { await copy(imageAsk(idea.imagePrompt, idea.format)); return toast('Görsel tarifi kopyalandı. ChatGPT\'ye yapıştır; üretilen görseli Görsel sekmesinden yükle.'); }
    if (a === 'edit') return openIdea(idea);
    if (a === 'del') {
      if (!confirm('Fikir silinsin mi?')) return;
      try { await api(`/api/ideas/${idea.id}`, { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
      state.ideas = state.ideas.filter(x => x !== idea); return renderIdeas();
    }
    if (a === 'open') { location.hash = '#takvim'; return openPost(onCal(idea)); }
    if (a === 'cal') {
      const pf = idea.platform ? [idea.platform] : ['Instagram'];
      if (pf[0] === 'Instagram') pf.push('Facebook');
      location.hash = '#takvim';
      openPost({ date: nextFreeDate(), time: '18:00', platforms: pf, format: idea.format, pillar: idea.pillar, topic: idea.title,
        caption: [idea.caption, idea.hashtags].filter(Boolean).join('\n\n'), notes: idea.notes, imagePrompt: idea.imagePrompt || '', status: 'Taslak', mediaIds: [], ideaId: idea.id });
    }
  });
}
let editingIdea = null;
function openIdea(i) {
  editingIdea = i;
  $('#imTitle').value = i.title || ''; $('#imCaption').value = i.caption || ''; $('#imHashtags').value = i.hashtags || '';
  $('#imNotes').value = i.notes || ''; $('#imImage').value = i.imagePrompt || '';
  $('#imPillar').innerHTML = opts(PILLARS, i.pillar, 'Seç'); $('#imPlatform').innerHTML = opts(PLATFORMS, i.platform, 'Seç'); $('#imFormat').innerHTML = opts(FORMATS.filter(f => f !== '-'), i.format, 'Seç');
  $('#ideaModal').classList.add('open');
}
$('#imSave').onclick = () => busy($('#imSave'), async () => {
  if (!$('#imTitle').value.trim()) throw new Error('Başlık boş olamaz');
  const body = { title: $('#imTitle').value.trim(), pillar: $('#imPillar').value, platform: $('#imPlatform').value, format: $('#imFormat').value,
    caption: $('#imCaption').value, hashtags: $('#imHashtags').value.trim(), notes: $('#imNotes').value, imagePrompt: $('#imImage').value.trim() };
  const saved = await api(`/api/ideas/${editingIdea.id}`, { method: 'PUT', body });
  Object.assign(editingIdea, saved); $('#ideaModal').classList.remove('open'); renderIdeas(); toast('Fikir güncellendi');
});
['#idPillar', '#idPlatform', '#idOpen'].forEach(s => $(s).onchange = renderIdeas);
$('#idSearch').oninput = renderIdeas;
$('#genBtn').onclick = () => busy($('#genBtn'), async () => {
  const list = await api('/api/ideas/generate', { method: 'POST', body: { brief: $('#genBrief').value, pillar: $('#genPillar').value, platform: $('#genPlatform').value, count: $('#genCount').value } });
  state.ideas.unshift(...list); renderIdeas(); toast(`${list.length} fikir eklendi`);
});
$('#manBtn').onclick = () => busy($('#manBtn'), async () => {
  if (!$('#manTitle').value.trim()) throw new Error('Başlık yaz');
  const i = await api('/api/ideas', { method: 'POST', body: { title: $('#manTitle').value, pillar: $('#manPillar').value, platform: $('#manPlatform').value, format: $('#manFormat').value, caption: $('#manCaption').value, source: 'elle' } });
  state.ideas.unshift(i); renderIdeas(); $('#manTitle').value = ''; $('#manCaption').value = ''; toast('Bankaya eklendi');
});

// ============================================================ HAZIR SEÇENEKLER
const OWN = '__own__';
const TREND_SOURCES = [
  ['google search', 'Google aramaları'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'],
  ['reddit', 'Reddit (topluluk)'], ['amazon', 'Amazon'], ['google news', 'Google Haberler'],
];
const GEN_PRESETS = [
  ['Kış öncesi: karanlık ve yağmurlu sürüşte net kayıt', 'Fall/winter in Vancouver: dark commutes, rain and glare. Why footage clarity at night matters.'],
  ['Park modu ve akü koruması', 'Parking mode explained: hit-and-runs in parking lots, low-voltage cutoff, battery protection.'],
  ['Gizli kablo, temiz kurulum işçiliği', 'Installation craft: hidden wiring, trim work, no dangling cables, before/after.'],
  ['Kaza sonrası kayıt ve ICBC süreci', 'After an incident: saving footage, sharing it with ICBC, how evidence protects the driver.'],
  ['Ürün tanıtımı: Falcon Vision / Nova / Hawk Vision', 'Product spotlights for Falcon Vision, Nova and Hawk Vision; one clear benefit each.'],
  ['Bayi ve filo müşterileri (LinkedIn)', 'B2B content for dealerships and fleet managers: one install standard, 50+ dealer partners.'],
  ['Kuruluş hikâyesi ve güven', 'Founding story and trust: why Aurora exists, 8+ years, 3,000+ customers.'],
  ['Sık sorulan sorular', 'The questions customers ask most before buying or installing a dash cam.'],
];
const IMG_PRESETS = [
  ['Siyah stüdyo, metin için boş alan', 'Minimal matte black studio background, soft rim light from the left, large empty space for text, premium automotive mood, no text, no logos'],
  ['Gece şehir trafiği, yağmurlu ön cam', 'View through a rainy car windshield at night, blurred city traffic lights and bokeh, cinematic, moody, no visible license plates, no text'],
  ['Vancouver silueti gece', 'Vancouver city skyline at night seen from across the water, calm reflections, deep blue and black tones, minimal, no text'],
  ['Araç içi gece, gösterge ışıkları', 'Dark car interior at night, subtle dashboard glow, shallow depth of field, premium and calm, no people, no text'],
  ['Islak asfalt, şehir ışığı yansıması', 'Close-up of wet asphalt road at night reflecting warm city lights, abstract, cinematic, dark tones, no text'],
  ['Koyu soyut doku', 'Dark abstract texture, subtle carbon fibre and brushed metal, soft gradient light, minimal background for social media, no text'],
  ['Kış sabahı, buğulu cam', 'Early winter morning, frosted car windshield with soft blue light, quiet residential street, no visible plates, no text'],
];
const STOCK_PRESETS = ['dash cam', 'car interior night', 'rainy road night', 'vancouver traffic', 'highway night lights', 'car dashboard', 'parking lot', 'winter driving', 'mechanic working car'];
const VID_PRESETS = [
  ['Gece sürüşü, yağmurlu cam', 'Slow cinematic shot through a rainy windshield at night, city lights streaking, wipers moving gently, moody and calm'],
  ['Araç içinde yavaş kamera hareketi', 'Slow dolly shot across a dark car interior at night, dashboard glow, shallow depth of field, premium feel'],
  ['Şehir ışıkları, ıslak yol', 'Low angle tracking shot over wet asphalt at night reflecting city lights, cinematic, smooth motion'],
  ['Siyah arka plan, ışık süzmesi', 'Minimal black background with a slow sweep of soft light across the frame, elegant, abstract, loopable'],
  ['Vancouver gece silueti', 'Slow aerial drift toward the Vancouver skyline at night, calm water reflections, blue hour tones'],
];
function presetSelect(sel, list, target, ownLabel = 'Kendim yazacağım…') {
  sel.innerHTML = '<option value="">— seç —</option>' + list.map(([l], i) => `<option value="${i}">${esc(l)}</option>`).join('') + `<option value="${OWN}">${ownLabel}</option>`;
  sel.onchange = () => {
    if (sel.value === OWN) { target.value = ''; target.focus(); return; }
    if (sel.value !== '') target.value = list[sel.value][1];
  };
}

// ============================================================ TRENDLER
// Büyüme/zaman serisi dünya geneli veridir (ülke filtresi yok) → Kanada sinyali için yerel kelimeler kullanılır.
// Canlı listelerde (Google Trends, YouTube, TikTok hashtag, X) ülke seçilebilir → varsayılan Kanada.
let trLast = null, trLastReq = null, trSchema = null, trSchemaLoading = null;
const MODE_INTENT = { growth: 'get_growth', series: 'get_time_series', posts: 'get_top_posts', top: 'get_top_trends' };
const TR_LABEL = { 'google search': 'Google aramaları', google: 'Google', 'google news': 'Google Haberler', 'google shopping': 'Google Alışveriş', 'google images': 'Google Görseller',
  youtube: 'YouTube', tiktok: 'TikTok', reddit: 'Reddit', amazon: 'Amazon', instagram: 'Instagram', x: 'X (Twitter)', twitter: 'X (Twitter)', facebook: 'Facebook', linkedin: 'LinkedIn', pinterest: 'Pinterest', wikipedia: 'Wikipedia', news: 'Haberler', 'news volume': 'Haber hacmi', 'news sentiment': 'Haber tonu' };
const WIN_LABEL = { '7D': 'Son 7 gün', '1W': 'Son 1 hafta', '14D': 'Son 14 gün', '2W': 'Son 2 hafta', '30D': 'Son 30 gün', '1M': 'Son 1 ay', '2M': 'Son 2 ay', '3M': 'Son 3 ay', '6M': 'Son 6 ay', '9M': 'Son 9 ay', '12M': 'Son 12 ay', '1Y': 'Son 1 yıl', '18M': 'Son 18 ay', '24M': 'Son 24 ay', '2Y': 'Son 2 yıl', MTD: 'Bu ay başından beri', QTD: 'Bu çeyrek başından beri', YTD: 'Yılbaşından bu yana', '1d': 'Son 1 gün', '3d': 'Son 3 gün', '7d': 'Son 7 gün', '14d': 'Son 14 gün', '30d': 'Son 30 gün' };
const COUNTRY_LABEL = { CA: 'Kanada', US: 'ABD', GB: 'Birleşik Krallık', AU: 'Avustralya', TR: 'Türkiye', DE: 'Almanya', IN: 'Hindistan' };
const FEED_LABEL = { 'Google Trends': 'Google aramalarında yükselenler', 'Google Trends by Category': 'Google aramaları (kategoriye göre)', 'YouTube Trending': 'YouTube trendleri', 'TikTok Trending Hashtags': 'TikTok trend hashtag\'leri', 'TikTok Trending Hashtags by Category': 'TikTok hashtag\'leri (kategoriye göre)', 'TikTok Trending Searches': 'TikTok trend aramaları', 'X (Twitter) Trending': 'X (Twitter) gündemi', 'Reddit Hot Posts': 'Reddit popüler gönderiler', 'Google News Top News': 'Google Haberler manşetler', 'Amazon Best Sellers by Category': 'Amazon çok satanlar (kategoriye göre)' };
const COUNTRY_FEEDS = ['Google Trends', 'Google Trends by Category', 'YouTube Trending', 'TikTok Trending Hashtags', 'TikTok Trending Hashtags by Category', 'X (Twitter) Trending'];
const RELEVANT_SOURCES = ['google search', 'youtube', 'google news', 'google shopping', 'tiktok', 'reddit', 'amazon', 'news volume', 'wikipedia'];
const FALLBACK = {
  source: RELEVANT_SOURCES.slice(0, 7),
  postSource: ['tiktok', 'instagram'],
  percent_growth: ['1M', '3M', '7D', '2M', 'MTD', 'QTD', '6M', '12M', 'YTD'],
  type: Object.keys(FEED_LABEL),
};
// Kanada / BC odaklı anahtar kelimeler (İngilizce; servis İngilizce arama verisi kullanıyor)
const TREND_KW_GROUPS = [
  ['Dashcam — Kanada / yerel', ['dash cam Canada', 'dash cam Vancouver', 'best dash cam Canada', 'dash cam installation Vancouver', 'ICBC dash cam', 'dash cam BC']],
  ['Dashcam — genel', ['dash cam', 'dash cam installation', 'front and rear dash cam', '4k dash cam', 'dash cam with parking mode', 'hardwire dash cam']],
  ['ICBC ve sigorta', ['ICBC', 'ICBC claim', 'ICBC rates', 'ICBC dash cam footage', 'car insurance BC', 'staged accident']],
  ['Trafik ve yollar (BC)', ['Vancouver traffic', 'DriveBC', 'Highway 1 traffic', 'Sea to Sky Highway', 'Coquihalla', 'Massey Tunnel', 'Port Mann Bridge', 'Lions Gate Bridge']],
  ['Kaza ve güvenlik', ['Vancouver car accident', 'hit and run Vancouver', 'road rage Canada', 'car theft Canada', 'catalytic converter theft', 'parking lot hit and run']],
  ['Mevsim ve sürüş', ['BC winter tires', 'snow Vancouver', 'black ice', 'winter driving BC', 'Vancouver rain']],
  ['Rakipler ve markalar', ['Thinkware dash cam', 'BlackVue', 'Garmin dash cam', 'Viofo', 'Vantrue', 'Nextbase', 'Tesla dashcam', 'Tesla Sentry Mode']],
  ['Bayi, filo, sürücüler', ['fleet dash cam', 'Uber driver dash cam', 'rideshare dash cam', 'car dealership Vancouver', 'used cars Vancouver']],
];
const HASHTAG_GROUPS = [
  ['Dashcam', ['dashcam', 'dashcamfootage', 'dashcamvideos', 'dashcamlife', 'carcamera']],
  ['Vancouver / BC', ['vancouver', 'vancouverbc', 'yvr', 'bcdrivers', 'britishcolumbia', 'icbc']],
  ['Sürüş ve yollar', ['roadrage', 'baddrivers', 'canadadrivers', 'wintertires', 'winterdriving']],
  ['Araç kültürü', ['carsofvancouver', 'tesla', 'carmods', 'cartok', 'cardetailing']],
];
// canlı listelerde markayla ilgili konuları işaretle
const RELEVANT = /\b(car|cars|auto|autos|driv\w*|road|roads|highway|traffic|crash\w*|accident\w*|collision|icbc|insurance|snow|ice|winter|tires?|tyres?|storm|rain|weather|tesla|ev|vehicles?|trucks?|dash ?cams?|camera|theft|stolen|police|rcmp|vancouver|bc|surrey|burnaby|richmond|coquitlam|ferry|bridge|tunnel)\b/i;
const trTool = intent => (trSchema || []).find(t => t.intent === intent);
const trParam = (intent, p) => trTool(intent)?.params?.[p];
const trValues = (intent, p) => { const s = trParam(intent, p); return s?.enum?.length ? s.enum : s?.suggest?.length ? s.suggest : null; };
const trLabel = (v, map = TR_LABEL) => map[v] || map[String(v).toLowerCase()] || map[String(v).toUpperCase()] || v;
function fillSelect(sel, values, labelMap, keep, blank) {
  const prev = keep ?? sel.value;
  sel.innerHTML = (blank ? `<option value="">${blank}</option>` : '') + values.map(v => `<option value="${esc(v)}">${esc(trLabel(v, labelMap))}</option>`).join('');
  if (values.map(String).includes(String(prev))) sel.value = prev;
}
function kwOptions(groups, prev, own = true) {
  return groups.map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(k => `<option ${k === prev ? 'selected' : ''}>${esc(k)}</option>`).join('')}</optgroup>`).join('')
    + (own ? `<option value="${OWN}" ${prev === OWN ? 'selected' : ''}>Kendim yazacağım…</option>` : '');
}
async function loadTrendSchema(force) {
  if (trSchema && !force) return;
  if (!trSchemaLoading) trSchemaLoading = api('/api/trends/schema' + (force ? '?refresh=1' : '')).then(s => { trSchema = s; $('#trSchemaNote').style.display = 'none'; })
    .catch(e => { trSchema = []; $('#trSchemaNote').textContent = 'Servisin seçenek listesi okunamadı, varsayılan liste kullanılıyor (' + e.message + ').'; $('#trSchemaNote').style.display = ''; })
    .finally(() => { trSchemaLoading = null; });
  await trSchemaLoading;
  trFillOptions(); trUpdate(); loadTrendUsage(); loadWatch();
}
function trFillOptions() {
  // Ücretsiz plan son 90 günü kapsıyor: 3 aydan uzun dönemler sona, "ücretli plan" notuyla
  const all = trValues('get_growth', 'percent_growth') || FALLBACK.percent_growth;
  const long = w => /^(6M|9M|12M|1Y|18M|24M|2Y|36M|3Y|48M|4Y|60M|5Y|YTD|ALL)$/i.test(w);
  const win = [...all.filter(w => !long(w)), ...all.filter(long)];
  const combo = ['1M', '3M'].filter(w => win.includes(w));
  const wopts = (combo.length >= 2 ? [combo.join(',')] : []).concat(win);
  const wl = { ...WIN_LABEL, [combo.join(',')]: 'Son 1 ay ve 3 ay (karşılaştırmalı)' };
  for (const w of win) if (long(w)) wl[w] = trLabel(w, WIN_LABEL) + ' (ücretli plan)';
  fillSelect($('#trWindow'), wopts, wl);
  // canlı listeler: markayla ilgili olanlar, servisin listesindeki sırayla
  const feeds = trValues('get_top_trends', 'type');
  fillSelect($('#trFeed'), feeds ? FALLBACK.type.filter(f => feeds.includes(f)).concat(feeds.filter(f => !FALLBACK.type.includes(f))) : FALLBACK.type, FEED_LABEL);
  fillSelect($('#trCountry'), Object.keys(COUNTRY_LABEL), COUNTRY_LABEL, $('#trCountry').value || 'CA');
  // takip listesi kaynakları
  const srcs = (trValues('get_growth', 'source') || FALLBACK.source).filter(s => RELEVANT_SOURCES.includes(s));
  fillSelect($('#wSource'), srcs.length ? srcs : FALLBACK.source, TR_LABEL, $('#wSource').value || 'google search');
  $('#wKeyword').innerHTML = kwOptions(TREND_KW_GROUPS, $('#wKeyword').value || 'dash cam Canada');
}
function trUpdate() {
  const mode = $('#trMode').value, intent = MODE_INTENT[mode];
  $('#trTopicBox').style.display = mode === 'top' ? 'none' : '';
  $('#trWindowBox').style.display = mode === 'growth' ? '' : 'none';
  $('#trFeedBox').style.display = mode === 'top' ? '' : 'none';
  $('#trLimitBox').style.display = mode === 'posts' || mode === 'top' ? '' : 'none';
  $('#trGeoNote').style.display = mode === 'growth' || mode === 'series' ? '' : 'none';
  $('#trKwLabel').textContent = mode === 'posts' ? 'Hashtag' : 'Konu';
  if (mode === 'posts') {
    fillSelect($('#trSource'), trValues('get_top_posts', 'source') || FALLBACK.postSource, TR_LABEL);
    const prev = $('#trKeyword').dataset.mode === 'posts' ? $('#trKeyword').value : 'dashcam';
    $('#trKeyword').innerHTML = HASHTAG_GROUPS.map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(k => `<option value="${esc(k)}" ${k === prev ? 'selected' : ''}>#${esc(k)}</option>`).join('')}</optgroup>`).join('')
      + `<option value="${OWN}" ${prev === OWN ? 'selected' : ''}>Kendim yazacağım…</option>`;
  } else if (mode !== 'top') {
    const srcs = (trValues(intent, 'source') || FALLBACK.source).filter(s => RELEVANT_SOURCES.includes(s));
    fillSelect($('#trSource'), srcs.length ? srcs : FALLBACK.source, TR_LABEL);
    const prev = $('#trKeyword').dataset.mode !== 'posts' && $('#trKeyword').value ? $('#trKeyword').value : 'dash cam Canada';
    $('#trKeyword').innerHTML = kwOptions(TREND_KW_GROUPS, prev);
  }
  $('#trKeyword').dataset.mode = mode === 'posts' ? 'posts' : 'kw';
  $('#trKeywordCustom').style.display = $('#trKeyword').value === OWN ? '' : 'none';
  $('#trKeywordCustom').placeholder = mode === 'posts' ? 'Hashtag yaz (# olmadan)' : 'Kendi konunu yaz (İngilizce)';
  // canlı liste seçenekleri
  const feed = $('#trFeed').value;
  const hasCountry = COUNTRY_FEEDS.includes(feed);
  $('#trCountryBox').style.display = hasCountry ? '' : 'none';
  $('#trCountryNote').style.display = mode === 'top' && !hasCountry ? '' : 'none';
  $('#trTWindowBox').style.display = $('#trSort').value === 'rank_change' ? '' : 'none';
  $('#trCategoryBox').style.display = /by Category|Top Websites/.test(feed) ? '' : 'none';
}
['#trMode', '#trSource', '#trKeyword', '#trFeed', '#trSort'].forEach(s => $(s).addEventListener('change', trUpdate));
async function loadTrendUsage(u) {
  try { u = u || await api('/api/trends/usage'); } catch { return; }
  state.trUsage = u;
  $('#trUsage').textContent = `Bu ay ${u.count}${u.limit ? ' / ' + u.limit : ''} istek kullanıldı. Aynı sorgu 24 saat içinde tekrar istenirse kota harcamadan geçmişten gelir.`;
  renderWatchInfo();
}
function trBuildRequest() {
  const mode = $('#trMode').value;
  if (mode === 'top') {
    const feed = $('#trFeed').value, args = { type: feed, limit: Number($('#trLimit').value) };
    if (COUNTRY_FEEDS.includes(feed) && $('#trCountry').value) args.country = $('#trCountry').value;
    if ($('#trSort').value) { args.sort = $('#trSort').value; args.window = $('#trTWindow').value; }
    if (/by Category|Top Websites/.test(feed) && $('#trCategory').value.trim()) args.category = $('#trCategory').value.trim();
    return { tool: 'get_top_trends', args };
  }
  let keyword = ($('#trKeyword').value === OWN ? $('#trKeywordCustom').value : $('#trKeyword').value).trim();
  if (!keyword) throw new Error(mode === 'posts' ? 'Bir hashtag seç ya da yaz' : 'Bir konu seç ya da yaz');
  if (mode === 'posts') keyword = keyword.replace(/^#/, '').replace(/\s+/g, '');
  const args = { keyword, source: $('#trSource').value };
  if (mode === 'growth') return { tool: 'get_growth', args: { ...args, percent_growth: $('#trWindow').value.split(',') } };
  if (mode === 'posts') return { tool: 'get_top_posts', args: { ...args, limit: Math.min(20, Number($('#trLimit').value)) } };
  return { tool: 'get_time_series', args };
}
async function trRunRequest(req, force) {
  const r = await api('/api/trends/call', { method: 'POST', body: { ...req, force: !!force } });
  trLastReq = req; showTrend(r);
  $('#trRefresh').style.display = r.cached ? '' : 'none';
  if (r.cached) toast('Bu sorgu son 24 saatte yapılmış; geçmişten gösteriliyor (kota harcanmadı).');
  if (r.usage) loadTrendUsage(r.usage);
  loadTrendHistory();
}
$('#trRun').onclick = () => busy($('#trRun'), async () => { await loadTrendSchema(); await trRunRequest(trBuildRequest()); });
$('#trRefresh').onclick = () => busy($('#trRefresh'), async () => { if (trLastReq) await trRunRequest(trLastReq, true); });
$$('[data-quick]').forEach(b => b.onclick = () => busy(b, async () => {
  await loadTrendSchema();
  await trRunRequest({ tool: 'get_top_trends', args: { type: b.dataset.quick, limit: 25, country: 'CA' } });
  $('#trView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

// --- Kanada takip listesi
let watch = { items: [], last: null };
const wKey = x => `${x.keyword}|${x.source}`;
async function loadWatch() {
  try { watch = await api('/api/trends/watch'); } catch (e) { $('#wTable').innerHTML = `<p class="small" style="color:var(--err)">${esc(e.message)}</p>`; return; }
  renderWatch();
}
function renderWatchInfo() {
  const n = watch.items?.length || 0, u = state.trUsage;
  const last = watch.last?.at ? `Son kontrol: ${new Date(watch.last.at).toLocaleString('tr-TR')}. ` : 'Henüz kontrol edilmedi. ';
  $('#wInfo').textContent = `${n} kelime takipte. ${last}"Hepsini kontrol et" en fazla ${n} istek harcar; son 24 saatte kontrol edilenler ücretsiz gelir.${u ? ` Bu ay ${u.count}${u.limit ? ' / ' + u.limit : ''} istek kullanıldı.` : ''}`;
  $('#wRun').textContent = `Hepsini kontrol et (${n})`;
}
function trendWord(p1, p3) {
  if (p1 == null && p3 == null) return ['—', 'muted'];
  if ((p1 ?? 0) > 5 && (p3 ?? 0) > 5) return ['Yükseliyor ↑', 'ok'];
  if ((p1 ?? 0) < -5 && (p3 ?? 0) < -5) return ['Düşüyor ↓', 'err'];
  if (p1 != null && p3 != null && p1 > p3 + 10) return ['Toparlanıyor ↗', 'ok'];
  if (p1 != null && p3 != null && p1 < p3 - 10) return ['Yavaşlıyor ↘', 'warn'];
  return ['Yatay →', 'muted'];
}
function renderWatch() {
  renderWatchInfo();
  const rows = (watch.items || []).map(it => {
    const r = (watch.last?.rows || []).find(x => wKey(x) === wKey(it));
    const g1 = r?.periods?.['1M']?.growth ?? null, g3 = r?.periods?.['3M']?.growth ?? null;
    return { ...it, r, g1, g3 };
  }).sort((a, b) => (b.g1 ?? -1e9) - (a.g1 ?? -1e9));
  const cell = v => v == null ? '<span class="muted">—</span>' : `<b style="color:${v >= 0 ? 'var(--ok)' : 'var(--err)'}">${pctTxt(v)}</b>`;
  $('#wTable').innerHTML = rows.length ? `<div class="wt"><div class="wh">Konu</div><div class="wh">Kaynak</div><div class="wh">Son 1 ay</div><div class="wh">Son 3 ay</div><div class="wh">Yorum</div><div class="wh"></div>
    ${rows.map(x => {
      const [word, cls] = x.r && !x.r.ok ? ['Hata', 'err'] : trendWord(x.g1, x.g3);
      return `<div><a href="#" data-w-open="${esc(wKey(x))}">${esc(x.keyword)}</a>${x.r && !x.r.ok ? `<div class="small" style="color:var(--err)">${esc(x.r.error)}</div>` : ''}</div>
        <div class="small muted">${esc(trLabel(x.source))}</div><div>${cell(x.g1)}</div><div>${cell(x.g3)}</div>
        <div class="small" style="color:var(--${cls === 'muted' ? 'muted' : cls})">${word}</div>
        <div><button class="btn sm" data-w-del="${esc(wKey(x))}" title="Listeden çıkar">✕</button></div>`;
    }).join('')}</div>
    <p class="small muted">İlgi puanları dünya geneli aramalardan gelir; yerel kelimeler (ICBC, BC, Vancouver) Kanada'daki ilgiyi daha iyi yansıtır. Bir kelimeye tıklayınca ayrıntısı açılır (geçmişten, ücretsiz).</p>`
    : '<div class="empty">Takip listesi boş. Yukarıdan kelime ekle ya da önerilen listeyi yükle.</div>';
  $$('[data-w-del]').forEach(b => b.onclick = () => saveWatch(watch.items.filter(x => wKey(x) !== b.dataset.wDel)));
  $$('[data-w-open]').forEach(a => a.onclick = e => {
    e.preventDefault();
    const it = watch.items.find(x => wKey(x) === a.dataset.wOpen);
    busy($('#trRun'), () => trRunRequest({ tool: 'get_growth', args: { keyword: it.keyword, source: it.source, percent_growth: ['1M', '3M'] } }).then(() => $('#trView').scrollIntoView({ behavior: 'smooth' })));
  });
}
async function saveWatch(items, reset) {
  try { const r = await api('/api/trends/watch', { method: 'PUT', body: reset ? { reset: true } : { items } }); watch.items = r.items; renderWatch(); }
  catch (e) { toast(e.message, true); }
}
$('#wKeyword').onchange = () => { $('#wCustom').style.display = $('#wKeyword').value === OWN ? '' : 'none'; };
$('#wAdd').onclick = () => {
  const keyword = ($('#wKeyword').value === OWN ? $('#wCustom').value : $('#wKeyword').value).trim();
  if (!keyword) return toast('Bir kelime seç ya da yaz', true);
  const it = { keyword, source: $('#wSource').value };
  if (watch.items.some(x => wKey(x) === wKey(it))) return toast('Bu kelime zaten listede');
  saveWatch([...watch.items, it]); $('#wCustom').value = ''; toast(`"${keyword}" takibe alındı`);
};
$('#wReset').onclick = () => { if (confirm('Önerilen Kanada listesi yüklensin mi? Mevcut liste değişir.')) saveWatch(null, true); };
$('#wRun').onclick = () => busy($('#wRun'), async () => {
  const n = watch.items.length;
  if (!n) throw new Error('Takip listesi boş');
  if (!confirm(`${n} kelime kontrol edilecek. Son 24 saatte bakılmayanlar için toplam en fazla ${n} istek harcanır. Devam edilsin mi?`)) return;
  const r = await api('/api/trends/watch/run', { method: 'POST', body: {} });
  watch.last = { at: r.at, rows: r.rows }; renderWatch(); if (r.usage) loadTrendUsage(r.usage); loadTrendHistory();
  toast(`${r.used} yeni istek, ${r.cached} sonuç geçmişten geldi`);
});

// sonucu okunur hale getir: özet cümle + yorum + kartlar / grafik / liste. Ham JSON yalnızca "Ham veri"de.
const parseJ = t => { try { return JSON.parse(t); } catch { return null; } };
// Servis cevabı zarf içinde gelebiliyor: {"statusCode":200,"body":"{...}"} → içteki veriyi aç
function unwrapTrend(text) {
  let d = parseJ(text);
  if (d === null && typeof text === 'string') { for (const part of text.split('\n')) { const p = parseJ(part); if (p) { d = p; break; } } }
  for (let i = 0; i < 4 && d && typeof d === 'object' && !Array.isArray(d); i++) {
    if (typeof d.body === 'string') { const p = parseJ(d.body); if (p !== null) { d = p; continue; } }
    else if (d.body && typeof d.body === 'object') { d = d.body; continue; }
    if (typeof d.text === 'string' && Object.keys(d).length <= 2) { const p = parseJ(d.text); if (p !== null) { d = p; continue; } }
    break;
  }
  return d;
}
function walk(o, fn, key = '') { fn(o, key); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, fn, k); }
const shortDate = s => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? String(s) : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }); };
const pctTxt = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}%${Math.abs(Math.round(v * 10) / 10).toLocaleString('tr-TR')}`;
const nfmt = n => n >= 1e6 ? (n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' mn' : n >= 1e3 ? (n / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' bin' : (Math.round(n * 10) / 10).toLocaleString('tr-TR');
const winTxt = w => trLabel(w, WIN_LABEL).replace(/^Son /, 'son ');
const ERR_TR = { date_out_of_range: 'Ücretsiz plan yalnızca son 90 günün verisini veriyor; bu dönem için plan yükseltmek gerekiyor.', no_data: 'Bu dönem için veri yok.', insufficient_data: 'Hesaplamak için yeterli veri yok.' };
function noteTr(note) {
  if (!note) return '';
  if (/90 days/i.test(note)) return 'Ücretsiz plan son 90 günlük veriyi kapsıyor. 6 ve 12 aylık karşılaştırmalar için TrendsMCP planını yükseltmek gerekiyor.';
  return note;
}
function seriesOf(data) {
  let best = null;
  walk(data, (v) => {
    if (!Array.isArray(v) || v.length < 3 || typeof v[0] !== 'object' || !v[0]) return;
    const keys = Object.keys(v[0]);
    const dk = keys.find(k => /date|time|week|period|day|month/i.test(k));
    const vk = keys.find(k => k !== dk && /value|interest|score|index|volume|count/i.test(k) && typeof v[0][k] === 'number') || keys.find(k => k !== dk && typeof v[0][k] === 'number');
    if (dk && vk && (!best || v.length > best.pts.length)) best = { pts: v.map(p => [String(p[dk]).slice(0, 10), Number(p[vk])]).filter(p => isFinite(p[1])), vk };
  });
  return best;
}
const METRIC_KEYS = [['score', 'puan'], ['upvotes', 'oy'], ['ups', 'oy'], ['views', 'izlenme'], ['view_count', 'izlenme'], ['plays', 'oynatma'], ['likes', 'beğeni'], ['like_count', 'beğeni'], ['comments', 'yorum'], ['num_comments', 'yorum'], ['comment_count', 'yorum'], ['shares', 'paylaşım'], ['engagement', 'etkileşim'], ['volume', 'arama hacmi'], ['search_volume', 'arama hacmi'], ['traffic', 'trafik'], ['growth', 'büyüme %'], ['rank', 'sıra']];
function itemsOf(data) {
  let best = null;
  walk(data, (v) => { if (Array.isArray(v) && v.length >= 1 && (!best || v.length > best.length) && v.some(x => typeof x === 'string' || (x && typeof x === 'object'))) best = v; });
  return (best || []).map(x => {
    if (typeof x === 'string') return { title: x };
    if (!x || typeof x !== 'object') return null;
    const title = x.title || x.name || x.keyword || x.query || x.hashtag || x.term || x.topic || x.search_term || x.text || x.caption || x.description;
    if (!title) return null;
    const url = [x.url, x.link, x.permalink, x.post_url, x.video_url, x.share_url].find(u => typeof u === 'string' && /^https?:\/\//.test(u));
    const metrics = []; const seen = new Set();
    for (const [k, l] of METRIC_KEYS) if (typeof x[k] === 'number' && !seen.has(l)) { seen.add(l); metrics.push(k === 'growth' ? `${pctTxt(x[k])} büyüme` : k === 'rank' ? `${x[k]}. sıra` : `${nfmt(x[k])} ${l}`); }
    const by = x.author || x.channel || x.channel_title || (x.subreddit ? 'r/' + String(x.subreddit).replace(/^r\//, '') : '') || x.username || x.creator || '';
    const when = x.created_at || x.published_at || x.date || '';
    return { title: String(title).slice(0, 200), url, meta: [typeof by === 'string' ? by : '', ...metrics, when ? shortDate(when) : ''].filter(Boolean).join(' · ') };
  }).filter(Boolean);
}
function sparkline(pts) {
  const W = 520, H = 160, vals = pts.map(p => p[1]), max = Math.max(...vals), min = Math.min(...vals), rng = max - min || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (W - 20) + 10, H - 20 - ((p[1] - min) / rng) * (H - 40)]);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="İlgi grafiği">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${xy.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/>
    <circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="4" fill="var(--accent)"/>
    <text x="10" y="${H - 4}" fill="var(--muted)" font-size="11">${esc(shortDate(pts[0][0]))}</text>
    <text x="${W - 10}" y="${H - 4}" fill="var(--muted)" font-size="11" text-anchor="end">${esc(shortDate(pts.at(-1)[0]))}</text></svg>`;
}
const box = (title, body) => `<div class="tr-sum"><b>${title}</b><div>${body}</div></div>`;
function renderGrowth(d, a) {
  const rows = Array.isArray(d?.results) ? d.results : [];
  if (!rows.length) return '';
  const kw = d.search_term || a.keyword, src = trLabel(d.data_source || a.source);
  const ok = rows.filter(r => r.status !== 'error' && typeof r.growth === 'number');
  let html = '';
  if (ok.length) {
    const parts = ok.map(r => `${winTxt(r.period)} ${pctTxt(r.growth)}`);
    const dir = ok.every(r => r.growth > 0) ? 'yükselişte' : ok.every(r => r.growth < 0) ? 'düşüşte' : 'karışık seyrediyor';
    html += box('Özet', `“${esc(kw)}” için ${esc(src)} ilgisi ${dir}: ${esc(parts.join(', '))}.`);
    const s = ok.find(r => r.period === '1M') || ok[0], l = ok.find(r => r.period !== s.period);
    let mean;
    if (l && s.growth > 5 && l.growth > 5) mean = 'İlgi hem kısa hem uzun vadede artıyor. Bu konu şu an içerik için iyi bir zamanlama.';
    else if (l && s.growth < -5 && l.growth < -5) mean = 'İlgi bir süredir azalıyor. Bu konuyu öne çıkarmak yerine yükselen başka bir konuya ağırlık vermek daha verimli olabilir.';
    else if (l && s.growth > l.growth) mean = 'Uzun vadede zayıf ama son dönemde toparlanıyor. Takipte tutulacak bir konu.';
    else if (l) mean = 'Uzun vadeye göre son dönemde ivme kaybediyor.';
    else mean = s.growth > 5 ? 'Son dönemde ilgi artıyor.' : s.growth < -5 ? 'Son dönemde ilgi azalıyor.' : 'İlgi yatay seyrediyor.';
    html += box('Ne anlama geliyor?', esc(mean));
  }
  html += `<div class="tr-cards">${rows.map(r => {
    if (r.status === 'error' || typeof r.growth !== 'number') return `<div class="tr-card off"><span class="muted">${esc(trLabel(r.period, WIN_LABEL))}</span><b class="muted">Veri yok</b><span class="small muted">${esc(ERR_TR[r.error] || r.message || 'Hesaplanamadı')}</span></div>`;
    const vol = typeof r.recent_volume === 'number' ? `<span class="small muted">Tahmini aylık arama: ${typeof r.baseline_volume === 'number' ? nfmt(r.baseline_volume) + ' → ' : ''}${nfmt(r.recent_volume)}${r.volume_estimated ? ' (tahmini)' : ''}</span>` : '';
    return `<div class="tr-card"><span class="muted">${esc(trLabel(r.period, WIN_LABEL))}</span><b style="color:${r.growth >= 0 ? 'var(--ok)' : 'var(--err)'}">${pctTxt(r.growth)}</b>
      <span class="small">${r.growth >= 0 ? 'Artış' : 'Azalış'}</span>
      ${typeof r.baseline_value === 'number' ? `<span class="small muted">İlgi puanı ${nfmt(r.baseline_value)} → ${nfmt(r.recent_value)}<br>${esc(shortDate(r.baseline_date))} → ${esc(shortDate(r.recent_date))}</span>` : ''}${vol}</div>`;
  }).join('')}</div>`;
  const notes = [noteTr(d.note), ok.some(r => typeof r.baseline_value === 'number') ? 'İlgi puanı 0–100 arası göreli bir değerdir; 100, dönemdeki en yüksek ilgiyi gösterir. Mutlak arama sayısı değildir.' : ''].filter(Boolean);
  if (notes.length) html += `<p class="small muted">${notes.map(esc).join('<br>')}</p>`;
  return html;
}
function renderSeries(d, a) {
  const s = seriesOf(d);
  if (!s || s.pts.length < 3) return '';
  const first = s.pts[0][1], last = s.pts.at(-1)[1], peak = s.pts.reduce((x, y) => y[1] > x[1] ? y : x), low = s.pts.reduce((x, y) => y[1] < x[1] ? y : x);
  const ch = first ? (last - first) / first * 100 : null;
  const kw = d.search_term || a.keyword, src = trLabel(d.data_source || a.source);
  let html = box('Özet', `“${esc(kw)}” için ${esc(src)} ilgisi ${esc(shortDate(s.pts[0][0]))} – ${esc(shortDate(s.pts.at(-1)[0]))} arasında ${ch === null ? 'izlendi' : ch >= 0 ? `${pctTxt(ch)} arttı` : `${pctTxt(ch)} azaldı`}. En yüksek ilgi ${esc(shortDate(peak[0]))} tarihindeydi.`);
  html += sparkline(s.pts);
  html += `<div class="stats"><div class="stat"><b>${nfmt(last)}</b><span class="muted">son değer</span></div><div class="stat"><b>${nfmt(peak[1])}</b><span class="muted">en yüksek (${esc(shortDate(peak[0]))})</span></div><div class="stat"><b>${nfmt(low[1])}</b><span class="muted">en düşük (${esc(shortDate(low[0]))})</span></div>${ch === null ? '' : `<div class="stat"><b style="color:${ch >= 0 ? 'var(--ok)' : 'var(--err)'}">${pctTxt(ch)}</b><span class="muted">dönem başına göre</span></div>`}</div>`;
  if (d.note) html += `<p class="small muted">${esc(noteTr(d.note))}</p>`;
  return html;
}
function renderTrendList(d, a, kind) {
  const l = itemsOf(d);
  if (!l.length) return '';
  const rel = x => kind !== 'posts' && RELEVANT.test(x.title);
  const nRel = l.filter(rel).length;
  const where = `${esc(trLabel(a.type, FEED_LABEL) || 'Liste')}${a.country ? ' · ' + esc(trLabel(a.country, COUNTRY_LABEL)) : a.type && !COUNTRY_FEEDS.includes(a.type) ? '' : ' · ABD'}`;
  const head = kind === 'posts' ? `#${esc(String(a.keyword).replace(/^#/, ''))} hashtag'inde ${esc(trLabel(a.source))} üzerinde en çok etkileşim alan ${l.length} paylaşım. Başlığa tıklayınca orijinali açılır; formatlarına ve ilk cümlelerine bak.`
    : `${where}: şu an öne çıkan ${l.length} konu.${nRel ? ` Bunlardan <b>${nRel}</b> tanesi markayla ilgili görünüyor (araç, sürüş, yol, hava, Vancouver/BC) ve işaretlendi.` : ' Bu listede markayla doğrudan ilgili konu görünmüyor.'}`;
  return box('Özet', head) + `<ol class="stack" style="padding-left:20px;margin:0">${l.slice(0, 50).map(x => `<li>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}${rel(x) ? ' <span class="relb">markayla ilgili</span>' : ''}${x.meta ? `<div class="small muted">${esc(x.meta)}</div>` : ''}</li>`).join('')}</ol>` + (d?.note ? `<p class="small muted">${esc(noteTr(d.note))}</p>` : '');
}
// bilinmeyen biçim: JSON yerine okunur alan listesi
const KEY_TR = { search_term: 'Konu', keyword: 'Konu', data_source: 'Kaynak', source: 'Kaynak', period: 'Dönem', growth: 'Değişim', direction: 'Yön', recent_value: 'Son değer', baseline_value: 'Başlangıç değeri', recent_date: 'Son tarih', baseline_date: 'Başlangıç tarihi', note: 'Not', message: 'Mesaj', status: 'Durum', country: 'Ülke', type: 'Liste', total: 'Toplam', count: 'Adet' };
function renderGeneric(d) {
  if (!d || typeof d !== 'object') return '';
  const rows = [];
  for (const [k, v] of Object.entries(d)) {
    if (['metadata', 'meta', 'statusCode'].includes(k)) continue;
    if (v === null || typeof v === 'object') continue;
    rows.push(`<div class="muted">${esc(KEY_TR[k] || k.replace(/_/g, ' '))}</div><div>${esc(k === 'note' ? noteTr(v) : typeof v === 'number' ? nfmt(v) : v)}</div>`);
  }
  const list = itemsOf(d);
  return (rows.length ? `<div class="svc">${rows.join('')}</div>` : '') + (list.length ? `<ol class="stack" style="padding-left:20px;margin:8px 0 0">${list.slice(0, 30).map(x => `<li>${esc(x.title)}${x.meta ? `<div class="small muted">${esc(x.meta)}</div>` : ''}</li>`).join('')}</ol>` : '');
}
function showTrend(t) {
  trLast = t; $('#trSave').disabled = false; $('#trIdea').disabled = false;
  const data = unwrapTrend(t.text);
  $('#trResult').textContent = data && typeof data === 'object' ? JSON.stringify(data, null, 2) : (t.text || '(boş sonuç)');
  const a = t.args || {};
  const title = `<p class="small muted">${esc(TOOL_TR[t.tool] || t.tool)} · ${esc(t.tool === 'get_top_posts' ? '#' + String(a.keyword).replace(/^#/, '') : a.keyword || trLabel(a.type, FEED_LABEL) || '')}${a.source ? ' · ' + esc(trLabel(a.source)) : ''}${a.country ? ' · ' + esc(trLabel(a.country, COUNTRY_LABEL)) : ''} · ${new Date(t.createdAt).toLocaleString('tr-TR')}${t.cached ? ' · <span style="color:var(--info)">geçmişten</span>' : ''}</p>`;
  let html = '';
  if (data && typeof data === 'object') {
    if (t.tool === 'get_growth') html = renderGrowth(data, a);
    if (!html && t.tool === 'get_time_series') html = renderSeries(data, a);
    if (!html && (t.tool === 'get_top_posts' || t.tool === 'get_top_trends')) html = renderTrendList(data, a, t.tool === 'get_top_posts' ? 'posts' : 'top');
    if (!html) html = renderSeries(data, a) || renderTrendList(data, a, 'top') || renderGeneric(data);
  } else if (t.text) html = `<p>${esc(String(t.text).slice(0, 1200))}</p>`;
  $('#trView').innerHTML = title + (html || `<p class="muted">Bu sonuçta gösterilecek veri yok. Başka bir konu ya da kaynak dene.</p>`);
}
$('#trIdea').onclick = () => {
  if (!trLast) return;
  const a = trLast.args || {};
  const summary = [...$$('#trView .tr-sum div')].map(e => e.innerText).join(' ') || $('#trView').innerText.slice(0, 800);
  const items = trLast.tool === 'get_top_trends' || trLast.tool === 'get_top_posts' ? [...$$('#trView li')].slice(0, 15).map(li => li.innerText.split('\n')[0]).join('; ') : '';
  ideaFromTrend(`${summary}${items ? ' Items: ' + items : ''}`.slice(0, 1500), a.keyword ? (trLast.tool === 'get_top_posts' ? '#' : '') + a.keyword : trLabel(a.type, FEED_LABEL));
};
$('#trSave').onclick = () => busy($('#trSave'), async () => {
  if (!trLast) return;
  const a = trLast.args || {};
  const label = a.keyword ? `${a.keyword} (${trLabel(a.source)})` : a.type || trLast.tool;
  const summary = [...$$('#trView .tr-sum div')].map(e => e.innerText).join('\n') || $('#trView').innerText;
  const i = await api('/api/ideas', { method: 'POST', body: { title: `Trend: ${label}`, notes: summary.slice(0, 600) } });
  state.ideas.unshift(i); renderIdeas(); toast('Fikir bankasına eklendi');
});
const TOOL_TR = { get_growth: 'Büyüme', get_time_series: 'Zaman içinde ilgi', get_top_posts: 'Öne çıkan paylaşımlar', get_top_trends: 'Canlı liste' };
async function loadTrendHistory() {
  const h = await api('/api/trends/history').catch(() => []);
  $('#trClear').style.display = h.length ? '' : 'none';
  $('#trHistory').innerHTML = h.length ? h.map(t => `<div class="card" data-id="${t.id}"><b>${esc(t.args.keyword || t.args.type || t.tool)}</b><div class="small muted">${esc(TOOL_TR[t.tool] || t.tool)}${t.args.source ? ' · ' + esc(trLabel(t.args.source)) : ''}${t.args.country ? ' · ' + esc(trLabel(t.args.country, COUNTRY_LABEL)) : ''}</div><div class="small muted">${new Date(t.createdAt).toLocaleString('tr-TR')}</div><div class="actions"><button class="btn sm" data-a="show">Göster</button><button class="btn sm danger" data-a="del">Sil</button></div></div>`).join('') : '<div class="empty">Geçmiş yok.</div>';
  $$('#trHistory .card').forEach(c => c.onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    const t = h.find(x => x.id === c.dataset.id);
    if (a === 'show') { showTrend(t); $('#trRefresh').style.display = 'none'; return window.scrollTo({ top: 0, behavior: 'smooth' }); }
    try { await api(`/api/trends/history/${t.id}`, { method: 'DELETE' }); loadTrendHistory(); } catch (err) { toast(err.message, true); }
  });
}
$('#trClear').onclick = async () => {
  if (!confirm('Tüm trend geçmişi silinsin mi? (Kota sayacı etkilenmez.)')) return;
  try { await api('/api/trends/history', { method: 'DELETE' }); loadTrendHistory(); toast('Geçmiş temizlendi'); } catch (e) { toast(e.message, true); }
};

// ============================================================ GÖRSEL + CANVA
function renderCanvaBar() {
  const s = state.status;
  $('#canvaBar').innerHTML = !s.canvaApp
    ? `<span><span class="dot"></span>Canva uygulaması tanımlı değil — Ayarlar sekmesindeki adımları izle.</span>`
    : s.canvaConnected
      ? `<span><span class="dot on"></span>Canva bağlı. Kütüphanedeki her görsel tek tıkla Canva'da düzenlenebilir tasarıma dönüşür.</span><button class="btn sm" id="canvaOff">Bağlantıyı kes</button>`
      : `<span><span class="dot"></span>Canva henüz bağlanmadı.</span><a class="btn primary sm" href="/api/canva/connect">Canva'yı bağla</a>`;
  const off = $('#canvaOff');
  if (off) off.onclick = async () => { await api('/api/canva/disconnect', { method: 'POST' }); await loadStatus(); renderCanvaBar(); };
}
function renderLibrary() {
  $('#library').innerHTML = state.media.length ? state.media.map(m => `<div class="mitem" data-id="${m.id}">
      <a href="${esc(m.url)}" target="_blank">${mediaTag(m)}</a>
      <div class="meta">
        <span class="t" title="${esc(m.prompt || m.title)}">${esc(m.title || m.source)}</span>
        <span class="muted">${esc(m.source)}${m.credit ? ' · ' + (m.link ? `<a href="${esc(m.link)}" target="_blank">${esc(m.credit)}</a>` : esc(m.credit)) : ''}</span>
        <select data-size class="small"><option value="portrait">Canva: 4:5 gönderi</option><option value="square">Canva: 1:1 kare</option><option value="story">Canva: 9:16 story/reel</option><option value="landscape">Canva: 16:9 yatay</option></select>
        <div class="row">
          <button class="btn sm primary" data-a="canva">Canva'ya aktar</button>
          ${m.canvaUrl ? `<a class="btn sm" href="${esc(m.canvaUrl)}" target="_blank">Canva'da aç</a>` : ''}
          <a class="btn sm" href="${esc(m.url)}" download>İndir</a>
          <button class="btn sm danger" data-a="del">Sil</button>
        </div>
      </div></div>`).join('') : '<div class="empty">Kütüphane boş. AI ile üret, stoktan ekle ya da kendi fotoğrafını yükle.</div>';
  $$('#library .mitem').forEach(el => {
    const m = state.media.find(x => x.id === el.dataset.id);
    if (m.canvaSize) el.querySelector('[data-size]').value = m.canvaSize;
    el.onclick = async e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'del') {
        if (!confirm('Kütüphaneden kaldırılsın mı?')) return;
        await api(`/api/media/${m.id}`, { method: 'DELETE' });
        state.media = state.media.filter(x => x !== m); return renderLibrary();
      }
      if (a === 'canva') busy(e.target, async () => {
        const r = await api(`/api/canva/export/${m.id}`, { method: 'POST', body: { canvaSize: el.querySelector('[data-size]').value } });
        m.canvaUrl = r.editUrl; window.open(r.editUrl, '_blank'); renderLibrary(); toast("Canva'da açıldı");
      });
    };
  });
}
$('#imgBtn').onclick = () => busy($('#imgBtn'), async () => {
  if (!$('#imgPrompt').value.trim()) throw new Error('Açıklama yaz');
  const items = await api('/api/image/generate', { method: 'POST', body: { prompt: $('#imgPrompt').value, aspect_ratio: $('#imgRatio').value, count: $('#imgCount').value } });
  state.media.unshift(...items); renderLibrary(); toast(`${items.length} görsel kütüphaneye eklendi`);
});
let stock = [];
$('#stBtn').onclick = () => busy($('#stBtn'), async () => {
  const src = $('#stSource').value;
  const q = ($('#stPreset').value === OWN ? $('#stQuery').value : $('#stPreset').value).trim();
  if (!q) throw new Error('Arama kelimesi yaz');
  $('#stQuery').dataset.last = q;
  stock = await api(`/api/stock?source=${src}&q=${encodeURIComponent(q)}`);
  $('#stResults').innerHTML = stock.length ? stock.map((s, i) => `<div class="mitem"><img src="${esc(s.thumb)}" loading="lazy"><div class="meta"><a class="muted" href="${esc(s.link)}" target="_blank">${esc(s.credit)}</a><button class="btn sm" data-i="${i}">Kütüphaneye ekle</button></div></div>`).join('') : '<div class="empty">Sonuç yok.</div>';
  $$('#stResults button').forEach(b => b.onclick = () => busy(b, async () => {
    const s = stock[b.dataset.i];
    const m = await api('/api/media/import', { method: 'POST', body: { url: s.full, credit: s.credit, link: s.link, track: s.track, source: src, title: $('#stQuery').dataset.last || '' } });
    state.media.unshift(m); renderLibrary(); b.textContent = 'Eklendi ✓'; b.disabled = true;
  }));
});
$('#stQuery').onkeydown = e => { if (e.key === 'Enter') $('#stBtn').click(); };
$('#upFile').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const [i, f] of files.entries()) {
    if (f.size > 50e6) { toast(`${f.name} 50 MB'tan büyük`, true); continue; }
    toast(`Yükleniyor ${i + 1}/${files.length}: ${f.name}`);
    try {
      const s = await api('/api/media/upload-url', { method: 'POST', body: { name: f.name, type: f.type } });
      const up = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Type': s.contentType, 'x-upsert': 'true' }, body: f });
      if (!up.ok) throw new Error(`Yükleme başarısız (${up.status})`);
      state.media.unshift(await api('/api/media/register', { method: 'POST', body: { file: s.file, name: f.name } }));
      renderLibrary();
    } catch (err) { toast(`${f.name}: ${err.message}`, true); }
  }
  toast('Yükleme tamamlandı');
};

// ============================================================ VİDEO
function renderVideoImages() {
  const sel = $('#vidImage').value;
  $('#vidImage').innerHTML = '<option value="">Yok — sadece metinden</option>' + state.media.filter(m => m.type === 'image').map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc((m.title || m.source).slice(0, 60))}</option>`).join('');
  loadVideoJobs();
}
$('#vidBtn').onclick = () => busy($('#vidBtn'), async () => {
  if (!$('#vidPrompt').value.trim()) throw new Error('Açıklama yaz');
  await api('/api/video/generate', { method: 'POST', body: { prompt: $('#vidPrompt').value, imageId: $('#vidImage').value || undefined } });
  toast('Video üretimi başladı. Birkaç dakika sürebilir.'); loadVideoJobs();
});
let vidTimer;
async function loadVideoJobs() {
  clearTimeout(vidTimer);
  let jobs = await api('/api/video/jobs').catch(() => []);
  const pending = jobs.filter(j => !j.mediaId && !['failed', 'canceled'].includes(j.status));
  if (pending.length) {
    jobs = await Promise.all(jobs.map(j => pending.includes(j) ? api(`/api/video/jobs/${j.id}`).catch(() => j) : j));
    if (jobs.some(j => j.mediaId && !state.media.find(m => m.id === j.mediaId))) state.media = await api('/api/media');
  }
  $('#vidJobs').innerHTML = jobs.length ? jobs.map(j => `<div class="card">
      <div class="small">${esc(j.prompt)}</div>
      <div class="small muted">${j.mediaId ? '<span class="st-Yayınlandı">Hazır</span>' : ['failed', 'canceled'].includes(j.status) ? `<span style="color:var(--err)">Başarısız: ${esc(j.error || j.status)}</span>` : '<span class="spinner"></span> Üretiliyor…'}</div>
      ${j.url ? `<video src="${esc(j.url)}" controls style="width:100%;border-radius:8px"></video><div class="actions"><a class="btn sm" href="${esc(j.url)}" download>İndir</a><a class="btn sm" href="#gorsel">Kütüphanede gör</a></div>` : ''}
    </div>`).join('') : '<p class="muted">Henüz video yok.</p>';
  if (jobs.some(j => !j.mediaId && !['failed', 'canceled'].includes(j.status)) && location.hash === '#video') vidTimer = setTimeout(loadVideoJobs, 8000);
}

// ============================================================ AYARLAR
async function loadStatus() { state.status = await api('/api/status'); renderSettings(); }
function renderSettings() {
  const s = state.status;
  const rows = [
    ['storage', 'Veritabanı ve depolama', `SUPABASE_URL ve SUPABASE_SECRET_KEY (sb_secret_...) — takvim, fikirler ve medya burada saklanır. Şu anki anahtar türü: ${esc(s.storageKeyKind || 'yok')}`],
    ['claude', 'İçerik planlama', 'ANTHROPIC_API_KEY — fikir ve caption üretimi. Anahtar: console.anthropic.com'],
    ['replicate', 'Görsel ve video üretimi', `REPLICATE_API_TOKEN — replicate.com. Görsel modeli: ${esc(s.imageModel)}, video modeli: ${esc(s.videoModel)}`],
    ['pexels', 'Pexels', 'PEXELS_API_KEY — pexels.com/api (ücretsiz)'],
    ['pixabay', 'Pixabay', 'PIXABAY_API_KEY — pixabay.com/api/docs (ücretsiz)'],
    ['unsplash', 'Unsplash', 'UNSPLASH_ACCESS_KEY — unsplash.com/developers (ücretsiz)'],
    ['trends', 'Trend araştırması', 'TRENDS_MCP_KEY — trendsmcp.ai anahtarı (ücretsiz planda istek sınırı var)'],
    ['canvaApp', 'Canva uygulaması', `CANVA_CLIENT_ID ve CANVA_CLIENT_SECRET — canva.com/developers → Integrations. Redirect URL: <code>${esc(s.canvaRedirect)}</code>. İzinler: asset read/write, design content read/write, design meta read.`],
    ['canvaConnected', 'Canva hesabı', 'Görsel sekmesindeki "Canva\'yı bağla" ile bir kez giriş yapılır.'],
  ];
  $('#svcList').innerHTML = rows.map(([k, n, d]) => `<div><span class="dot ${s[k] ? 'on' : ''}"></span>${n}</div><div class="small muted">${d}</div>`).join('');
}

// ============================================================ başlat
async function init() {
  const n = new Date();
  state.month = new Date(n.getFullYear(), n.getMonth(), 1);
  ['#genPillar', '#manPillar'].forEach(s => $(s).innerHTML = opts(PILLARS, '', 'Hepsi / seç'));
  ['#genPlatform', '#manPlatform'].forEach(s => $(s).innerHTML = opts(PLATFORMS, '', 'Hepsi / seç'));
  $('#manFormat').innerHTML = opts(FORMATS.filter(f => f !== '-'), '', 'Seç');
  $('#idPillar').innerHTML = opts(PILLARS, '', 'Tüm sütunlar');
  $('#idPlatform').innerHTML = opts(PLATFORMS, '', 'Tüm platformlar');
  $('#calPlatform').innerHTML = opts(PLATFORMS, '', 'Tüm platformlar');
  try { if (localStorage.getItem('calView') === 'list') state.view = 'list'; } catch { }
  trFillOptions(); trUpdate(); // servis listesi gelene kadar varsayılanlar
  presetSelect($('#genPreset'), GEN_PRESETS, $('#genBrief'));
  presetSelect($('#imgPreset'), IMG_PRESETS, $('#imgPrompt'));
  presetSelect($('#vidPreset'), VID_PRESETS, $('#vidPrompt'));
  $('#stPreset').innerHTML = STOCK_PRESETS.map(k => `<option>${esc(k)}</option>`).join('') + `<option value="${OWN}">Kendim yazacağım…</option>`;
  $('#stSource').onchange = () => { $('#stNote').style.display = $('#stSource').value === 'openverse' ? '' : 'none'; };
  $('#stPreset').onchange = () => { $('#stQuery').style.display = $('#stPreset').value === OWN ? '' : 'none'; };
  // her çağrı bağımsız: biri düşerse diğerleri yine yüklenir
  await loadStatus().catch(e => toast('Durum okunamadı: ' + e.message, true));
  const [posts, ideas, media] = await Promise.allSettled([api('/api/posts'), api('/api/ideas'), api('/api/media')]);
  state.posts = posts.value || []; state.ideas = ideas.value || []; state.media = media.value || [];
  const firstErr = [posts, ideas, media].find(r => r.status === 'rejected');
  if (firstErr && state.status.storage) toast('Veriler yüklenemedi: ' + firstErr.reason.message, true);
  $('#genBtn').style.display = state.status.claude ? '' : 'none';
  renderBanner(); renderCalendar(); renderIdeas(); loadTrendHistory(); showTab();
}
function renderBanner() {
  const s = state.status, b = $('#setupBanner');
  if (s.storage) { b.style.display = 'none'; return; }
  const why = s.storageKeyKind === 'publishable' || s.storageKeyKind === 'anon'
    ? 'Tanımlı Supabase anahtarı herkese açık türde; kayıt için <b>secret key</b> gerekli.'
    : 'Veritabanı anahtarı tanımlı değil.';
  b.innerHTML = `<span><span class="dot"></span>${why} Takvim, fikirler ve medya şu an kaydedilmiyor.</span><a class="btn sm" href="#ayarlar">Ayarlar → Sistem kontrolü</a>`;
  b.style.display = '';
}

// ============================================================ SİSTEM KONTROLÜ
const DIAG_ICON = { ok: '<span style="color:var(--ok)">✓</span>', fail: '<span style="color:var(--err)">✗</span>', skip: '<span class="muted">–</span>' };
$('#diagRun').onclick = () => busy($('#diagRun'), async () => {
  $('#diagOut').innerHTML = '<p class="muted"><span class="spinner"></span> Servisler deneniyor…</p>';
  const r = await api('/api/diagnostics' + ($('#diagLive').checked ? '?live=1' : ''));
  let area = '';
  $('#diagOut').innerHTML = `<p class="small"><b style="color:var(--ok)">${r.summary.ok} çalışıyor</b> · <b style="color:var(--err)">${r.summary.fail} hatalı</b> · <span class="muted">${r.summary.skip} kurulmamış</span> · ${new Date(r.at).toLocaleString('tr-TR')}</p>
    <div class="stack">${r.checks.map(c => {
      const head = c.area !== area ? `<h3 style="margin-top:14px">${esc(area = c.area)}</h3>` : '';
      return `${head}<div class="row" style="align-items:flex-start;gap:10px;flex-wrap:nowrap"><div style="width:16px">${DIAG_ICON[c.status] || ''}</div><div style="width:190px;flex:none">${esc(c.name)}</div><div class="small ${c.status === 'fail' ? '' : 'muted'}" style="word-break:break-word;flex:1">${esc(typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail))}</div><div class="small muted" style="flex:none">${c.ms} ms</div></div>`;
    }).join('')}</div>
    <button class="btn sm" id="diagCopy" style="margin-top:12px">Raporu kopyala</button>`;
  $('#diagCopy').onclick = () => copy(r.checks.map(c => `[${c.status}] ${c.area} / ${c.name}: ${typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)}`).join('\n'));
});
init();
