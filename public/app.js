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
  const csv = '﻿' + [cols.map(c => cell(c[0])).join(','), ...rows.map(p => cols.map(([, f]) => cell(typeof f === 'function' ? f(p) : p[f])).join(','))].join('\r\n');
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
$('#pmSuggest').onclick = () => busy($('#pmSuggest'), async () => {
  const r = await api('/api/caption', { method: 'POST', body: { ...readPost(), tone: $('#pmTone').value } });
  $('#pmSuggestions').innerHTML = (r.captions || []).map((c, i) => `<div class="card"><div class="cap">${esc(c)}</div><div class="actions"><button class="btn sm" data-i="${i}">Bunu kullan</button></div></div>`).join('');
  $$('#pmSuggestions button').forEach(b => b.onclick = () => { $('#pmCaption').value = r.captions[b.dataset.i]; $('#pmSuggestions').innerHTML = ''; updateCounter(); });
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
function renderIdeas() {
  const fp = $('#idPillar').value, fpl = $('#idPlatform').value, open = $('#idOpen').checked, q = $('#idSearch').value.trim().toLocaleLowerCase('tr');
  const onCal = i => i.usedPostId && state.posts.find(p => p.id === i.usedPostId);
  const list = state.ideas.filter(i => (!fp || i.pillar === fp) && (!fpl || i.platform === fpl) && (!open || !onCal(i))
    && (!q || `${i.title} ${i.caption} ${i.notes}`.toLocaleLowerCase('tr').includes(q)));
  const used = state.ideas.filter(onCal).length;
  $('#ideaCount').textContent = `${state.ideas.length} fikir · ${used} takvimde${list.length !== state.ideas.length ? ` · ${list.length} gösteriliyor` : ''}`;
  $('#ideas').innerHTML = list.length ? list.map(i => {
    const post = onCal(i);
    return `<div class="card ${post ? 'used' : ''}" data-id="${i.id}">
      <div class="row spread"><b>${esc(i.title)}</b>${i.platform ? `<span class="pf">${PF[i.platform] || esc(i.platform)}</span>` : ''}</div>
      <div class="row small muted">${esc(i.pillar)}${i.format ? ' · ' + esc(i.format) : ''}${post ? ` · <span class="st-Yayınlandı">Takvimde: ${esc(fmtDay(post.date))}</span>` : ''}</div>
      ${i.caption ? `<div class="cap">${esc(i.caption)}</div>` : ''}
      ${i.notes ? `<div class="small muted">${esc(i.notes)}</div>` : ''}
      <div class="actions">${post ? '<button class="btn sm" data-a="open">Takvimde aç</button>' : '<button class="btn sm primary" data-a="cal">Takvime ekle</button>'}<button class="btn sm" data-a="copy">Kopyala</button><button class="btn sm danger" data-a="del">Sil</button></div>
    </div>`;
  }).join('') : `<div class="empty">${state.ideas.length ? 'Filtreye uyan fikir yok.' : 'Henüz fikir yok. Yukarıdan üret ya da elle ekle.'}</div>`;
  $$('#ideas .card').forEach(card => card.onclick = async e => {
    const a = e.target.dataset.a; if (!a) return;
    const idea = state.ideas.find(x => x.id === card.dataset.id);
    if (a === 'copy') return copy(idea.caption);
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
      openPost({ date: nextFreeDate(), time: '18:00', platforms: pf, format: idea.format, pillar: idea.pillar, topic: idea.title, caption: idea.caption, notes: idea.notes, status: 'Taslak', mediaIds: [], ideaId: idea.id });
    }
  });
}
['#idPillar', '#idPlatform', '#idOpen'].forEach(s => $(s).onchange = renderIdeas);
$('#idSearch').oninput = renderIdeas;
$('#genBtn').onclick = () => busy($('#genBtn'), async () => {
  const list = await api('/api/ideas/generate', { method: 'POST', body: { brief: $('#genBrief').value, pillar: $('#genPillar').value, platform: $('#genPlatform').value, count: $('#genCount').value } });
  state.ideas.unshift(...list); renderIdeas(); toast(`${list.length} fikir eklendi`);
});
$('#manBtn').onclick = () => busy($('#manBtn'), async () => {
  if (!$('#manTitle').value.trim()) throw new Error('Başlık yaz');
  const i = await api('/api/ideas', { method: 'POST', body: { title: $('#manTitle').value, pillar: $('#manPillar').value, platform: $('#manPlatform').value, format: $('#manFormat').value, caption: $('#manCaption').value } });
  state.ideas.unshift(i); renderIdeas(); $('#manTitle').value = ''; $('#manCaption').value = ''; toast('Bankaya eklendi');
});

// ============================================================ HAZIR SEÇENEKLER
const OWN = '__own__';
const TREND_SOURCES = [
  ['google search', 'Google aramaları'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'],
  ['reddit', 'Reddit (topluluk)'], ['amazon', 'Amazon'], ['google news', 'Google Haberler'],
];
const TREND_TOPICS = ['dash cam', 'dash cam installation', 'dash cam with parking mode', 'front and rear dash cam', '4k dash cam',
  'car camera', 'dashcam footage', 'car accident', 'road rage', 'ICBC claim', 'winter driving', 'Vancouver traffic', 'Tesla dashcam'];
const TREND_SUBREDDITS = ['Dashcam', 'vancouver', 'britishcolumbia', 'IdiotsInCars', 'cars', 'CarAV'];
const TREND_TIKTOK = ['dashcam', 'dashcamfootage', 'carcamera', 'vancouver', 'cartok', 'roadrage'];
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
let trLast = null;
function trUpdate() {
  const mode = $('#trMode').value, src = $('#trSource').value;
  $('#trTopicBox').style.display = mode === 'top' ? 'none' : '';
  $('#trWindowBox').style.display = mode === 'growth' ? '' : 'none';
  $('#trFeedBox').style.display = mode === 'top' ? '' : 'none';
  const list = src === 'reddit' ? TREND_SUBREDDITS : src === 'tiktok' ? TREND_TIKTOK : TREND_TOPICS;
  const prev = $('#trKeyword').value;
  $('#trKeyword').innerHTML = list.map(k => `<option ${k === prev ? 'selected' : ''}>${esc(k)}</option>`).join('') + `<option value="${OWN}" ${prev === OWN ? 'selected' : ''}>Kendim yazacağım…</option>`;
  $('#trKeywordCustom').style.display = $('#trKeyword').value === OWN ? '' : 'none';
}
$('#trSource').innerHTML = TREND_SOURCES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
['#trMode', '#trSource', '#trKeyword'].forEach(s => $(s).addEventListener('change', trUpdate));
trUpdate();
$('#trRun').onclick = () => busy($('#trRun'), async () => {
  const mode = $('#trMode').value;
  let tool, args;
  if (mode === 'top') { tool = 'get_top_trends'; args = { type: $('#trFeed').value, limit: 20 }; }
  else {
    const keyword = ($('#trKeyword').value === OWN ? $('#trKeywordCustom').value : $('#trKeyword').value).trim();
    if (!keyword) throw new Error('Bir konu seç ya da yaz');
    args = { keyword, source: $('#trSource').value };
    if (mode === 'growth') { tool = 'get_growth'; args.percent_growth = $('#trWindow').value.split(','); }
    else tool = 'get_time_series';
  }
  trLast = await api('/api/trends/call', { method: 'POST', body: { tool, args } });
  showTrend(trLast); loadTrendHistory();
});

// sonucu okunur hale getir: grafik, büyüme kartları ya da sıralı liste
const parseJ = t => { try { return JSON.parse(t); } catch { return null; } };
function walk(o, fn, key = '') { fn(o, key); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, fn, k); }
function seriesOf(data) {
  let best = null;
  walk(data, (v) => {
    if (!Array.isArray(v) || v.length < 3 || typeof v[0] !== 'object' || !v[0]) return;
    const keys = Object.keys(v[0]);
    const dk = keys.find(k => /date|time|week|period|day|month/i.test(k));
    const vk = keys.find(k => k !== dk && typeof v[0][k] === 'number');
    if (dk && vk && (!best || v.length > best.pts.length)) best = { pts: v.map(p => [String(p[dk]).slice(0, 10), Number(p[vk])]).filter(p => isFinite(p[1])), vk };
  });
  return best;
}
function growthOf(data) {
  const named = [], loose = [];
  walk(data, (v, k) => {
    if (typeof v === 'number' && /growth|change|percent|pct/i.test(k)) loose.push([k, v]);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const name = v.name || v.window || v.period || v.label, val = [v.growth, v.percent_growth, v.percent, v.change, v.value].find(x => typeof x === 'number');
      if (name && typeof val === 'number') named.push([String(name), val]);
    }
  });
  const out = named.length ? named : loose;
  const seen = new Set(); return out.filter(([k]) => !seen.has(k) && seen.add(k));
}
function listOf(data) {
  let best = null;
  walk(data, (v) => { if (Array.isArray(v) && v.length >= 3 && (!best || v.length > best.length)) best = v; });
  return (best || []).map(x => typeof x === 'string' ? x : x && (x.title || x.name || x.keyword || x.query || x.hashtag || x.term || x.topic || JSON.stringify(x).slice(0, 80)));
}
function sparkline(pts) {
  const W = 520, H = 160, vals = pts.map(p => p[1]), max = Math.max(...vals), min = Math.min(...vals), rng = max - min || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (W - 20) + 10, H - 20 - ((p[1] - min) / rng) * (H - 40)]);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="İlgi grafiği">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${xy.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}"/>
    <circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="4" fill="var(--accent)"/>
    <text x="10" y="${H - 4}" fill="var(--muted)" font-size="11">${esc(pts[0][0])}</text>
    <text x="${W - 10}" y="${H - 4}" fill="var(--muted)" font-size="11" text-anchor="end">${esc(pts.at(-1)[0])}</text></svg>`;
}
function showTrend(t) {
  trLast = t; $('#trSave').disabled = false;
  const data = parseJ(t.text);
  $('#trResult').textContent = data ? JSON.stringify(data, null, 2) : (t.text || '(boş sonuç)');
  const title = `<p class="small muted">${esc(t.args.keyword || t.args.type || '')}${t.args.source ? ' · ' + esc(t.args.source) : ''} · ${new Date(t.createdAt).toLocaleString('tr-TR')}</p>`;
  let html = '';
  if (data && t.tool === 'get_growth') {
    const g = growthOf(data);
    if (g.length) html = `<div class="stats">${g.map(([k, v]) => `<div class="stat"><b style="color:${v >= 0 ? 'var(--ok)' : 'var(--err)'}">${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%</b><span class="muted">${esc(k)}</span></div>`).join('')}</div>`;
  }
  if (!html && data && t.tool === 'get_time_series') {
    const s = seriesOf(data);
    if (s && s.pts.length > 2) {
      const first = s.pts[0][1], last = s.pts.at(-1)[1], peak = s.pts.reduce((a, b) => b[1] > a[1] ? b : a);
      html = sparkline(s.pts) + `<div class="stats"><div class="stat"><b>${last}</b><span class="muted">son değer</span></div><div class="stat"><b>${peak[1]}</b><span class="muted">zirve (${esc(peak[0])})</span></div><div class="stat"><b style="color:${last >= first ? 'var(--ok)' : 'var(--err)'}">${first ? (last >= first ? '+' : '') + Math.round((last - first) / first * 100) + '%' : '—'}</b><span class="muted">dönem başına göre</span></div></div>`;
    }
  }
  if (!html && data) {
    const l = listOf(data).filter(Boolean);
    if (l.length) html = `<ol class="stack" style="padding-left:20px;margin:0">${l.slice(0, 25).map(x => `<li>${esc(x)}</li>`).join('')}</ol>`;
  }
  $('#trView').innerHTML = title + (html || `<p class="muted">Sonuç geldi ama otomatik gösterilemedi. "Ham veri"yi aç.</p>`);
}
$('#trSave').onclick = async () => {
  if (!trLast) return;
  const label = trLast.args.keyword ? `${trLast.args.keyword} (${trLast.args.source})` : trLast.args.type || trLast.tool;
  const i = await api('/api/ideas', { method: 'POST', body: { title: `Trend: ${label}`, notes: $('#trView').innerText.slice(0, 600) } });
  state.ideas.unshift(i); renderIdeas(); toast('Fikir bankasına eklendi');
};
const TOOL_TR = { get_growth: 'Büyüme', get_time_series: 'Zaman içinde ilgi', get_top_trends: 'Canlı liste' };
async function loadTrendHistory() {
  const h = await api('/api/trends/history').catch(() => []);
  $('#trHistory').innerHTML = h.length ? h.map(t => `<div class="card" data-id="${t.id}"><b>${esc(t.args.keyword || t.args.type || t.tool)}</b><div class="small muted">${esc(TOOL_TR[t.tool] || t.tool)}${t.args.source ? ' · ' + esc(t.args.source) : ''}</div><div class="small muted">${new Date(t.createdAt).toLocaleString('tr-TR')}</div><div class="actions"><button class="btn sm">Göster</button></div></div>`).join('') : '<div class="empty">Geçmiş yok.</div>';
  $$('#trHistory .card button').forEach(b => b.onclick = () => showTrend(h.find(t => t.id === b.closest('.card').dataset.id)));
}

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
