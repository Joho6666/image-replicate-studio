const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { meta: null, p: null, tab: 'case', selected: new Set(), promptDirty: false };
const FIELDS = ['shot', 'flash', 'framing', 'aspect', 'face', 'hair', 'expression', 'outfit', 'action', 'scene', 'light', 'extra'];
const fileUrl = rel => `/files/${state.p.id}/${rel.split('/').map(encodeURIComponent).join('/')}`;

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ''), bad ? 6000 : 2500);
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { toast(data.error || '请求失败', true); throw new Error(data.error); }
  return data;
}

const readFile = file => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });

// ---- modal ------------------------------------------------------------------

function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; return $('#modalBody'); }
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
const zoom = src => openModal(`<div class="zoom"><img src="${src}"></div>`);

// ---- projects ---------------------------------------------------------------

async function loadProjects() {
  const list = await api('GET', '/api/projects');
  $('#projects').innerHTML = list.map(p => `<li data-id="${p.id}" class="${state.p?.id === p.id ? 'active' : ''}">${p.clientId ? '👥 ' : ''}${esc(p.name)}<small>${p.createdAt.slice(0, 10)} · ${p.jobs} 批</small></li>`).join('');
}

$('#projects').addEventListener('click', e => { const li = e.target.closest('li'); if (li) openProject(li.dataset.id); });
$('#newBtn').addEventListener('click', async () => {
  const p = await api('POST', '/api/projects', { name: $('#newName').value });
  $('#newName').value = '';
  await loadProjects();
  openProject(p.id);
});
$('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#newBtn').click(); });

async function openProject(id) {
  state.p = await api('GET', `/api/projects/${id}`);
  state.selected.clear();
  localStorage.setItem('lastProject', id);
  $('#empty').hidden = true;
  $('#workspace').hidden = false;
  $('#projName').value = state.p.name;
  loadDraft();
  renderAll();
  loadProjects();
}

$('#projName').addEventListener('change', async () => { state.p = await api('PATCH', `/api/projects/${state.p.id}`, { name: $('#projName').value }); loadProjects(); });
$('#openDir').addEventListener('click', () => api('POST', `/api/projects/${state.p.id}/open`, { rel: '.' }));

function setTab(tab) {
  state.tab = tab;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach(s => (s.hidden = s.id !== 'tab-' + tab));
  if (tab === 'gallery') renderGallery();
  if (tab === 'styles') renderStyles();
  if (tab === 'replica') fillReplicaFaces();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });

function renderAll() { renderCases(); renderMoodbars(); renderFaces(); renderJobs(); renderGallery(); }

// ---- ① cases ----------------------------------------------------------------

function renderCases() {
  const p = state.p;
  $('#cases').innerHTML = p.cases.length ? p.cases.map(c => `
    <div class="case">
      <h3>${c.type === 'upload' ? '我上传的参考图' : c.type === 'style' ? `风格卡：${esc(c.author)} · ${c.images.length} 张（含高星成品）` : `${esc(c.author || '抖音作品')} · ${c.type === 'video' ? '视频截帧' : '图文'} · ${c.images.length} 张`}</h3>
      ${c.authorPrompt ? `<div class="author-prompt"><b>识别到作者 prompt</b>（${c.authorPrompt.length} 字）<pre>${esc(c.authorPrompt)}</pre><button data-act="useAuthor" data-case="${esc(c.awemeId)}">用作者 prompt 出图</button> <span class="hint">填进提示词框；中文原文可直接用，也可以对照着改表单</span></div>` : ''}
      ${c.desc && !['upload', 'style'].includes(c.type) ? `<details><summary>作品文案（常含作者 prompt）</summary><pre>${esc(c.desc)}</pre></details>` : ''}
      <div class="thumbs">${c.images.map(img => thumb(img)).join('')}</div>
    </div>`).join('') : '<p class="hint">还没有案例。粘贴一个抖音链接试试。</p>';
}

function thumb(rel) {
  const i = state.p.moodboard.indexOf(rel);
  return `<div class="thumb ${i >= 0 ? 'picked' : ''}" data-rel="${esc(rel)}" title="单击勾选 moodboard，双击放大">
    <img src="${fileUrl(rel)}" loading="lazy">${i >= 0 ? `<span class="badge">参考 ${i + 1}</span>` : ''}</div>`;
}

$('#cases').addEventListener('click', async e => {
  if (e.target.dataset.act === 'useAuthor') {
    const c = state.p.cases.find(x => x.awemeId === e.target.dataset.case);
    $('#promptBox').value = c.authorPrompt;
    state.promptDirty = true;
    updateLen(); saveDraft(); setTab('gen');
    return toast('已填入作者 prompt（出图时会自动加上 moodboard 引导语）');
  }
  const t = e.target.closest('.thumb');
  if (!t) return;
  const rel = t.dataset.rel;
  let mb = [...state.p.moodboard];
  if (mb.includes(rel)) mb = mb.filter(x => x !== rel);
  else { if (mb.length >= 3) return toast('moodboard 最多 3 张，先取消一张', true); mb.push(rel); }
  state.p = await api('PATCH', `/api/projects/${state.p.id}`, { moodboard: mb });
  renderCases(); renderMoodbars();
});
$('#cases').addEventListener('dblclick', e => { const t = e.target.closest('.thumb'); if (t) zoom(fileUrl(t.dataset.rel)); });

$('#caseBtn').addEventListener('click', async () => {
  const btn = $('#caseBtn');
  btn.disabled = true; btn.textContent = '抓取中…（约 10–40 秒）';
  try {
    const c = await api('POST', `/api/projects/${state.p.id}/case`, { url: $('#caseUrl').value });
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    toast(`抓到 ${c.images.length} 张`);
    $('#caseUrl').value = '';
    renderCases();
  } finally { btn.disabled = false; btn.textContent = '抓取案例'; }
});

$('#refUpload').addEventListener('change', async e => {
  for (const f of e.target.files) await api('POST', `/api/projects/${state.p.id}/upload`, { dataUrl: await readFile(f) });
  e.target.value = '';
  state.p = await api('GET', `/api/projects/${state.p.id}`);
  renderCases();
});

function renderMoodbars() {
  const mb = state.p.moodboard;
  const html = mb.length ? `<span class="muted">moodboard：</span>${mb.map(r => `<img src="${fileUrl(r)}">`).join('')}` : '<span class="muted">没选 moodboard（纯文字出图）</span>';
  $('#moodboardBar').innerHTML = html;
  const body = state.p.bodyRefs || [];
  const bodyHtml = body.length ? `<span class="muted">· 客户体型参考 ${body.length} 张（选了模特会自动带上）：</span>${body.map(r => `<img src="${fileUrl(r)}">`).join('')}` : '';
  $('#genRefs').innerHTML = html + bodyHtml;
}

// ---- ② model faces ----------------------------------------------------------

function renderFaces() {
  const p = state.p;
  $('#faces').innerHTML = p.faces.length ? p.faces.map(f => `
    <div class="card" data-id="${f.id}">
      <img src="${fileUrl(f.file)}">
      <div class="body"><b>${esc(f.name)}</b><div class="muted">${esc(f.desc)}</div>
      <div class="actions"><button data-act="del">删除</button></div></div>
    </div>`).join('') : '<p class="hint">还没有模特。上传一张脸部清楚的照片，或者在画廊里把满意的图「设为模特」。</p>';
  const sel = $('#genFace');
  const cur = sel.value;
  sel.innerHTML = '<option value="">不固定（随机新面孔）</option>' + p.faces.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  sel.value = p.faces.some(f => f.id === cur) ? cur : '';
}

$('#faces').addEventListener('click', async e => {
  const card = e.target.closest('.card');
  if (!card) return;
  if (e.target.dataset.act === 'del') {
    if (!confirm('删除这个模特？（图片文件保留）')) return;
    await api('DELETE', `/api/projects/${state.p.id}/faces/${card.dataset.id}`);
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    renderFaces();
  } else if (e.target.tagName === 'IMG') zoom(e.target.src);
});

$('#faceUpload').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) cropDialog({ dataUrl: await readFile(f) });
});

// Draw a rectangle on the image; coordinates are sent in natural pixels.
function cropDialog({ source, dataUrl }) {
  const src = dataUrl || fileUrl(source);
  const body = openModal(`
    <h3 style="margin-top:0">框出脸和头发（不框就用整张）</h3>
    <div class="cropper"><img src="${src}"><div class="sel" hidden></div></div>
    <div class="row wrap">
      <input id="faceName" placeholder="模特名字">
      <input id="faceDesc" class="grow" placeholder="特征备注（英文更好，例如 tiny mole on left cheek, reddish-brown waves）">
      <button id="faceSave" class="primary" style="width:auto">保存模特</button>
    </div>`);
  const img = body.querySelector('img');
  const box = body.querySelector('.sel');
  let start = null, crop = null;
  const pos = e => { const r = img.getBoundingClientRect(); return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height) }; };
  const cropper = body.querySelector('.cropper');
  cropper.addEventListener('mousedown', e => { e.preventDefault(); start = pos(e); });
  window.onmousemove = e => {
    if (!start) return;
    const c = pos(e);
    const x = Math.min(start.x, c.x), y = Math.min(start.y, c.y), w = Math.abs(c.x - start.x), h = Math.abs(c.y - start.y);
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    box.hidden = false;
    const k = img.naturalWidth / img.clientWidth;
    crop = { x: x * k, y: y * k, w: w * k, h: h * k };
  };
  window.onmouseup = () => { start = null; };
  body.querySelector('#faceSave').addEventListener('click', async () => {
    await api('POST', `/api/projects/${state.p.id}/faces`, { source, dataUrl, crop, name: body.querySelector('#faceName').value, desc: body.querySelector('#faceDesc').value });
    window.onmousemove = window.onmouseup = null;
    closeModal();
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    renderFaces();
    toast('已保存模特');
  });
}

// ---- ③ generate -------------------------------------------------------------

function fillSelects() {
  const m = state.meta;
  const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('[name=shot]').innerHTML = opts(m.shots);
  $('[name=flash]').innerHTML = opts(m.flashes);
  $('[name=framing]').innerHTML = opts(m.framings);
  $('[name=aspect]').innerHTML = m.sizes.map(s => `<option>${s}</option>`).join('');
  $('[name=shot]').value = 'friend';
  $('#realism').innerHTML = Object.entries(m.realisms).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#pose').innerHTML = '<option value="">不指定</option>' + Object.entries(m.poses).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#post').innerHTML = Object.entries(m.postPresets).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('') + '<option value="none">不加后期</option>';
  $('#post').value = m.defaultPost;
  $('#model').innerHTML = m.models.map(x => `<option value="${x.id}">${esc(x.label)}</option>`).join('');
  $('#batchList').innerHTML = Object.entries(m.presets).map(([k, v]) => `<label class="check"><input type="checkbox" value="${k}">${esc(v.label)}</label>`).join('');
  $('#preset').innerHTML += Object.entries(m.presets).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
  $('[name=face]').placeholder = m.defaultFace;
}

const formFields = () => Object.fromEntries(FIELDS.map(k => [k, $(`#genForm [name=${k}]`).value]));
function setFields(f) { for (const k of FIELDS) { const el = $(`#genForm [name=${k}]`); if (k in f) el.value = f[k] ?? ''; else if (el.tagName === 'TEXTAREA' && k !== 'face') el.value = ''; } }

async function rebuildPrompt() {
  const { prompt } = await api('POST', '/api/prompt', formFields());
  $('#promptBox').value = prompt;
  state.promptDirty = false;
  updateLen();
  saveDraft();
}
const updateLen = () => ($('#promptLen').textContent = `${$('#promptBox').value.length} 字符${state.promptDirty ? ' · 已手改' : ''}`);

let rebuildTimer;
$('#genForm').addEventListener('input', () => {
  if (state.promptDirty) { saveDraft(); return; }
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuildPrompt, 300);
});
$('#genForm').addEventListener('change', () => { if (!state.promptDirty) rebuildPrompt(); });
$('#promptBox').addEventListener('input', () => { state.promptDirty = true; updateLen(); saveDraft(); });
$('#rebuild').addEventListener('click', () => { if (!state.promptDirty || confirm('会覆盖你手改的提示词，继续？')) rebuildPrompt(); });
$('#preset').addEventListener('change', e => {
  const pr = state.meta.presets[e.target.value];
  if (!pr) return;
  const { label, ...fields } = pr;
  setFields({ ...fields, face: $('[name=face]').value });
  state.promptDirty = false;
  rebuildPrompt();
});

function saveDraft() {
  if (!state.p) return;
  localStorage.setItem('draft:' + state.p.id, JSON.stringify({ fields: formFields(), prompt: $('#promptBox').value, dirty: state.promptDirty, model: $('#model').value, count: $('#count').value, post: $('#post').value }));
}
function loadDraft() {
  const d = JSON.parse(localStorage.getItem('draft:' + state.p.id) || 'null');
  if (!d) { setFields({ shot: 'friend', flash: 'off', framing: 'half', aspect: '3:4' }); rebuildPrompt(); return; }
  setFields(d.fields);
  $('#promptBox').value = d.prompt;
  state.promptDirty = d.dirty;
  if (d.model) $('#model').value = d.model;
  if (d.count) $('#count').value = d.count;
  if (d.post && [...$('#post').options].some(o => o.value === d.post)) $('#post').value = d.post;
  updateLen();
}
$('#model').addEventListener('change', saveDraft);
$('#count').addEventListener('change', saveDraft);
$('#post').addEventListener('change', saveDraft);

$('#genBtn').addEventListener('click', async () => {
  const model = state.meta.models.find(m => m.id === $('#model').value);
  if (!model.refs && (state.p.moodboard.length || $('#genFace').value)) toast('grok 不用参考图，moodboard 和模特会被忽略');
  await api('POST', `/api/projects/${state.p.id}/generate`, {
    prompt: $('#promptBox').value, fields: formFields(), aspect: $('[name=aspect]').value,
    model: model.id, count: $('#count').value, faceId: $('#genFace').value || null, post: $('#post').value,
    smartLight: $('#smartLight').checked, autoLight: $('#autoLight').checked, realism: $('#realism').value, pose: $('#pose').value || null,
  });
  state.p = await api('GET', `/api/projects/${state.p.id}`);
  toast('已提交，出图约 40–60 秒');
  renderJobs(); renderGallery(); poll();
});

function jobHtml(j, { withOutputs = true } = {}) {
  const p = state.p;
  const face = p.faces.find(f => f.id === j.faceId);
  const out = j.outputs.filter(o => !$('#onlyStar').checked || o.star > 0);
  const waiting = ['queued', 'running'].includes(j.status) ? j.count - j.outputs.length : 0;
  const statusText = { queued: '排队', running: '生成中', done: '完成', partial: '部分失败', failed: '失败' }[j.status];
  return `<div class="job" data-id="${j.id}">
    <div class="job-head"><span class="status ${j.status}">${statusText}</span>
      <b>${j.type === 'swap' ? '换脸' : j.type === 'live' ? '实况图（' + j.seconds + ' 秒）' : j.type === 'relight' ? '打光：' + esc(state.meta.lights[j.light] || '') : '出图'}</b> ${esc(j.model)} · ${j.outputs.length}/${j.count} 张 · ${j.createdAt.slice(5, 16).replace('T', ' ')}
      ${face ? `· 模特 ${esc(face.name)}` : ''} ${j.refs.length ? `· 参考图 ${j.refs.length} 张` : ''}
      ${j.source ? `<img src="${fileUrl(j.source)}" style="height:36px;border-radius:4px" title="底图">` : ''}
      ${['done', 'partial', 'failed'].includes(j.status) ? '<button class="rerun" data-act="rerun">再来一批</button>' : ''}
      ${['done', 'partial'].includes(j.status) && j.type !== 'live' && j.outputs.length ? '<button class="rerun" data-act="autoqa" title="用看图模型初筛：像不像本人、截屏残留、手指、衣服、背景、越界">自动质检</button>' : ''}
      ${['partial', 'failed'].includes(j.status) ? `<button class="rerun" data-act="retry" data-count="${j.count - j.outputs.length}">重试失败的 ${j.count - j.outputs.length} 张</button>` : ''}</div>
    ${(j.errors || []).map(e => `<div class="err">⚠ ${esc(e)}</div>`).join('')}
    <details><summary>提示词</summary><pre>${esc(j.finalPrompt)}</pre>${j.type === 'gen' ? '<button data-act="reuse">载入到出图表单</button>' : ''}</details>
    ${withOutputs ? `<div class="cards" style="margin-top:8px">${out.map(o => outputCard(o)).join('')}${Array.from({ length: waiting }, () => '<div class="card"><div class="placeholder">生成中…</div></div>').join('')}</div>` : ''}
  </div>`;
}

function outputCard(o) {
  if (o.live) return liveCard(o);
  const src = fileUrl(!$('#showRaw').checked && o.final ? o.final : o.file);
  return `<div class="card ${state.selected.has(o.file) ? 'selected' : ''}" data-file="${esc(o.file)}">
    ${qaBadge(o)}<img src="${src}" loading="lazy" data-act="zoom">
    <div class="body">
      <div class="row" style="margin:0"><span class="stars">${[1, 2, 3, 4, 5].map(n => `<span data-star="${n}" class="${n <= o.star ? 'on' : ''}">★</span>`).join('')}</span>
      <span class="grow"></span><label class="check"><input type="checkbox" data-act="sel" ${state.selected.has(o.file) ? 'checked' : ''}>选</label></div>
      <div class="actions">
        <button data-act="compare">对比原图</button><button data-act="swap">换脸</button><button data-act="relight">重新打光</button><button data-act="live">做实况图</button><button data-act="face">设为模特</button><button data-act="open">文件夹</button>
        <select data-act="repost" title="换后期（不重新出图）">${repostOptions(o)}</select>
      </div>
    </div></div>`;
}

function qaBadge(o) {
  if (!o.qa) return '';
  const label = { pass: '质检通过', retry: '质检：建议重出', fail: '质检不通过', unsure: '质检：有项目看不清' }[o.qa.verdict] || o.qa.verdict;
  const lines = Object.entries(o.qa.checks || {}).map(([k, c]) => (c.ok === null ? '？ ' : c.ok ? '✓ ' : '✗ ') + (state.meta.qaChecks?.[k] || k) + (c.note ? '：' + c.note : ''));
  if (o.qa.note) lines.push(o.qa.note);
  const tip = lines.join('\n');
  return `<div class="qa-chip ${esc(o.qa.verdict)}" title="${esc(tip)}">${label}</div>`;
}

// 实况图 card: plays the mp4 on loop; webp/gif are the share formats.
function liveCard(o) {
  return `<div class="card ${state.selected.has(o.file) ? 'selected' : ''}" data-file="${esc(o.file)}">
    ${qaBadge(o)}<video src="${fileUrl(o.file)}" poster="${fileUrl(o.poster)}" autoplay loop muted playsinline controls preload="metadata" style="width:100%;display:block"></video>
    <div class="body">
      <div class="row" style="margin:0"><span class="stars">${[1, 2, 3, 4, 5].map(n => `<span data-star="${n}" class="${n <= o.star ? 'on' : ''}">★</span>`).join('')}</span>
      <span class="grow"></span><label class="check"><input type="checkbox" data-act="sel" ${state.selected.has(o.file) ? 'checked' : ''}>选</label></div>
      <div class="actions">
        <a href="${fileUrl(o.webp)}" target="_blank">动图 WebP</a> <a href="${fileUrl(o.gif)}" target="_blank">GIF</a> <a href="${fileUrl(o.file)}" download>mp4</a>
        <button data-act="open">文件夹</button>
      </div>
    </div></div>`;
}

function liveDialog(o) {
  const presets = state.meta.livePresets || {};
  const first = Object.keys(presets)[0];
  const body = openModal(`
    <h3 style="margin-top:0">做实况图（让这张图动起来）</h3>
    <div class="row"><img src="${fileUrl(o.final || o.file)}" style="height:200px;border-radius:6px">
      <div class="grow">
        <label>动作 <select id="lvPreset">${Object.entries(presets).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
        <label>方式 <select id="lvMode"><option value="gif" selected>GPT 动图（从原图出发，推荐）</option><option value="video">视频模型（实验）</option></select></label>
        <label>时长/帧数 <select id="lvSec"><option>2</option><option selected>3</option><option>4</option></select> 秒（视频）　帧数 <select id="lvFrames"><option>4</option><option selected>6</option><option>8</option><option>12</option></select>（动图）</label>
        <label>版本数 <select id="lvCount"><option>1</option><option selected>2</option><option>3</option></select></label>
        <label>动作提示词（英文，可改）<textarea id="lvPrompt" rows="6" style="width:100%">${esc((presets[first] || {}).gifPrompt || '')}</textarea></label>
      </div></div>
    <p class="hint">用未加后期的原图做图生视频，约 1–2 分钟。视频模型对脸的保持比静图差，每次多出几个版本挑。真人照片做会动的版本，需要本人同意。出完后有 mp4、WebP 动图、GIF 三种格式。</p>
    <button id="lvGo" class="primary">开始生成</button>`);
  const refill = () => { const pr = presets[body.querySelector('#lvPreset').value]; body.querySelector('#lvPrompt').value = body.querySelector('#lvMode').value === 'gif' ? pr.gifPrompt : pr.prompt; };
  body.querySelector('#lvPreset').addEventListener('change', refill);
  body.querySelector('#lvMode').addEventListener('change', refill);
  body.querySelector('#lvGo').addEventListener('click', async () => {
    await api('POST', `/api/projects/${state.p.id}/live`, { source: o.file, preset: body.querySelector('#lvPreset').value, prompt: body.querySelector('#lvPrompt').value, mode: body.querySelector('#lvMode').value, frames: body.querySelector('#lvFrames').value, seconds: body.querySelector('#lvSec').value, count: body.querySelector('#lvCount').value });
    closeModal();
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    toast('实况图已提交，约 1–2 分钟');
    renderGallery(); renderJobs(); poll();
  });
}

function repostOptions(o) {
  const cur = o.final ? (o.post || 'soft') : 'none';
  const all = { ...state.meta.postPresets, none: '不加后期' };
  return Object.entries(all).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>后期：${esc(v)}</option>`).join('');
}

function renderJobs() {
  const recent = state.p.jobs.slice(-4).reverse();
  $('#genJobs').innerHTML = recent.length ? '<h4>最近任务</h4>' + recent.map(j => jobHtml(j)).join('') : '';
}

// ---- ④ gallery --------------------------------------------------------------

// column count from the available width: about 220 px per column on desktop, 150 px on narrow screens
function wallColumns() {
  const w = ($('#main').clientWidth || innerWidth) - 28;
  return Math.max(2, Math.floor((w + 16) / ((innerWidth <= 820 ? 150 : 220) + 16)));
}
window.addEventListener('resize', () => { const g = $('.wall'); if (g && Number(g.dataset.n) !== wallColumns() && state.tab === 'gallery') renderGallery(); });

function renderGallery() {
  const jobs = [...state.p.jobs].reverse();
  if (!jobs.length) $('#gallery').innerHTML = '<p class="hint">还没有出图。</p>';
  else if ($('#groupJobs').checked) $('#gallery').innerHTML = jobs.map(j => jobHtml(j)).join('');
  else {
    // wall mode: one continuous masonry of every output, newest first; only unfinished/failed jobs keep a caption strip
    const running = jobs.filter(j => ['queued', 'running'].includes(j.status)).map(j => jobHtml(j, { withOutputs: false })).join('');
    const bad = jobs.filter(j => ['partial', 'failed'].includes(j.status));
    const strip = running + (bad.length ? `<details class="failbox"><summary>${bad.length} 个任务有失败（点开看原因、重试）</summary>${bad.map(j => jobHtml(j, { withOutputs: false })).join('')}</details>` : '');
    const label = j => `${j.type === 'live' ? '实况图' : j.type === 'relight' ? '打光' : j.type === 'swap' ? '换脸' : '出图'} · ${j.model} · ${j.createdAt.slice(5, 16).replace('T', ' ')}`;
    const cards = jobs.flatMap(j => {
      const waiting = ['queued', 'running'].includes(j.status) ? j.count - j.outputs.length : 0;
      return [
        ...j.outputs.filter(o => !$('#onlyStar').checked || o.star > 0).map(o => outputCard(o).replace('class="card ', `title="${esc(label(j))}" class="card `)),
        ...Array.from({ length: waiting }, () => '<div class="card"><div class="placeholder">生成中…</div></div>'),
      ];
    });
    // distribute round-robin into N columns so the newest images form the first row (CSS columns would fill top-to-bottom)
    const n = wallColumns();
    const cols = Array.from({ length: n }, (_, i) => cards.filter((_, k) => k % n === i).join(''));
    $('#gallery').innerHTML = strip + `<div class="wall" data-n="${n}">${cols.map(c => `<div class="wcol">${c}</div>`).join('')}</div>`;
  }
  $('#selCount').textContent = state.selected.size ? `已选 ${state.selected.size} 张` : '';
}
$('#showRaw').addEventListener('change', () => { renderGallery(); renderJobs(); });
$('#onlyStar').addEventListener('change', renderGallery);
$('#groupJobs').addEventListener('change', renderGallery);

async function onOutputClick(e) {
  const card = e.target.closest('.card[data-file]');
  if (card && e.target.dataset.act === 'zoom' && matchMedia('(hover: none)').matches) { card.classList.toggle('tap'); return; }
  const jobEl = e.target.closest('.job');
  if (['rerun', 'retry'].includes(e.target.dataset.act) && jobEl) {
    e.target.disabled = true;
    await api('POST', `/api/projects/${state.p.id}/jobs/${jobEl.dataset.id}/rerun`, e.target.dataset.act === 'retry' ? { count: e.target.dataset.count } : {});
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    toast('已重新提交');
    renderJobs(); renderGallery(); poll();
    return;
  }
  if (e.target.dataset.act === 'autoqa' && jobEl) {
    e.target.disabled = true; e.target.textContent = '质检中…';
    try { const r = await api('POST', `/api/projects/${state.p.id}/jobs/${jobEl.dataset.id}/auto-qa`, {}); toast(`自动质检完成（${r.model}），${r.applied.length} 张`); }
    finally { state.p = await api('GET', `/api/projects/${state.p.id}`); renderJobs(); renderGallery(); }
    return;
  }
  if (e.target.dataset.act === 'reuse' && jobEl) {
    const j = state.p.jobs.find(x => x.id === jobEl.dataset.id);
    if (j.fields) setFields(j.fields);
    $('#promptBox').value = j.prompt;
    state.promptDirty = true;
    $('#model').value = j.model;
    $('#genFace').value = j.faceId || '';
    updateLen(); saveDraft(); setTab('gen');
    return;
  }
  if (!card) return;
  const file = card.dataset.file;
  const o = state.p.jobs.flatMap(j => j.outputs).find(x => x.file === file);
  const act = e.target.dataset.act;
  if (e.target.dataset.star) {
    const n = Number(e.target.dataset.star);
    Object.assign(o, await api('POST', `/api/projects/${state.p.id}/star`, { file, star: o.star === n ? 0 : n }));
    renderGallery(); renderJobs();
  } else if (act === 'sel') {
    e.target.checked ? state.selected.add(file) : state.selected.delete(file);
    card.classList.toggle('selected', e.target.checked);
    $('#selCount').textContent = state.selected.size ? `已选 ${state.selected.size} 张` : '';
  } else if (act === 'zoom') zoom(e.target.src);
  else if (act === 'compare') compareDialog(o);
  else if (act === 'swap') swapDialog(o);
  else if (act === 'relight') relightDialog(o);
  else if (act === 'live') liveDialog(o);
  else if (act === 'face') cropDialog({ source: o.file });
  else if (act === 'open') api('POST', `/api/projects/${state.p.id}/open`, { rel: o.file });
}
$('#gallery').addEventListener('click', onOutputClick);
$('#genJobs').addEventListener('click', onOutputClick);

async function onRepost(e) {
  if (e.target.dataset.act !== 'repost') return;
  const file = e.target.closest('.card[data-file]').dataset.file;
  e.target.disabled = true;
  const o = state.p.jobs.flatMap(j => j.outputs).find(x => x.file === file);
  try {
    Object.assign(o, await api('POST', `/api/projects/${state.p.id}/repost`, { file, preset: e.target.value }));
    toast('后期已更新');
  } finally { renderGallery(); renderJobs(); }
}
$('#gallery').addEventListener('change', onRepost);
$('#genJobs').addEventListener('change', onRepost);

function compareDialog(o) {
  const refs = [...new Set([...state.p.moodboard, ...state.p.cases.flatMap(c => c.images)])];
  if (!refs.length) return toast('还没有案例图可对比', true);
  const mine = fileUrl(o.final || o.file);
  const body = openModal(`
    <div class="row"><label>对比案例图 <select id="cmpSel">${refs.map((r, i) => `<option value="${esc(r)}">${i < state.p.moodboard.length ? '★ ' : ''}${esc(r.split('/').pop())}</option>`).join('')}</select></label></div>
    <div class="compare"><figure><img id="cmpRef" src="${fileUrl(refs[0])}"><figcaption>案例</figcaption></figure><figure><img src="${mine}"><figcaption>我的</figcaption></figure></div>`);
  body.querySelector('#cmpSel').addEventListener('change', e => (body.querySelector('#cmpRef').src = fileUrl(e.target.value)));
}

function relightDialog(o) {
  const body = openModal(`
    <h3 style="margin-top:0">重新打光（只改光，不改人物/姿势/背景）</h3>
    <div class="row"><img src="${fileUrl(o.file)}" style="height:200px;border-radius:6px">
      <div class="grow">
        <label>灯型 <select id="rlLight">${Object.entries(state.meta.lights).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label>强度 <select id="rlStrength">${Object.entries(state.meta.strengths).map(([k, v]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label>张数 <select id="rlCount"><option>1</option><option selected>2</option><option>3</option></select></label>
        <label>补充（英文，可留空）<input id="rlExtra" style="width:100%" placeholder="例如 warm tungsten color, flash from slightly above"></label>
      </div></div>
    <p class="hint">用原图（未加后期）做编辑，出完后按你选的后期处理。提示词已内置「保持皮肤自然、不油光」。灯型思路来自 flash-photo-skill。</p>
    <button id="rlGo" class="primary">开始重新打光</button>`);
  body.querySelector('#rlGo').addEventListener('click', async () => {
    await api('POST', `/api/projects/${state.p.id}/relight`, {
      source: o.file, light: body.querySelector('#rlLight').value, strength: body.querySelector('#rlStrength').value,
      count: body.querySelector('#rlCount').value, extra: body.querySelector('#rlExtra').value, model: $('#model').value, post: $('#post').value,
    });
    closeModal();
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    toast('重新打光已提交');
    renderGallery(); renderJobs(); poll();
  });
}

function swapDialog(o) {
  if (!state.p.faces.length) { toast('先在「② 模特」里加一个模特', true); return setTab('model'); }
  const body = openModal(`
    <h3 style="margin-top:0">换成固定模特</h3>
    <div class="row"><img src="${fileUrl(o.final || o.file)}" style="height:160px;border-radius:6px"> →
      ${state.p.faces.map((f, i) => `<label class="check"><input type="radio" name="sf" value="${f.id}" ${i === 0 ? 'checked' : ''}><img src="${fileUrl(f.file)}" style="height:100px;border-radius:6px">${esc(f.name)}</label>`).join('')}</div>
    <div class="row"><label>张数 <select id="swapCount"><option>1</option><option selected>2</option><option>3</option></select></label>
    <button id="swapGo" class="primary" style="width:auto">开始换脸</button></div>
    <p class="hint">闭眼、侧脸、逆光的底图换完容易认不出，会自动要求睁眼；不满意就多出几张挑。</p>`);
  body.querySelector('#swapGo').addEventListener('click', async () => {
    await api('POST', `/api/projects/${state.p.id}/swap`, { source: o.file, faceId: body.querySelector('[name=sf]:checked').value, count: body.querySelector('#swapCount').value, model: $('#model').value, post: $('#post').value });
    closeModal();
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    toast('换脸已提交');
    renderGallery(); renderJobs(); poll();
  });
}

$('#exportBtn').addEventListener('click', async () => {
  if (!state.selected.size) return toast('先在图片上勾「选」', true);
  const outputs = state.p.jobs.flatMap(j => j.outputs);
  const files = [...state.selected].map(f => { const o = outputs.find(x => x.file === f); return !$('#showRaw').checked && o?.final ? o.final : f; });
  const isClient = !!state.p.clientId;
  const body = openModal(`
    <h3 style="margin-top:0">导出 ${files.length} 张</h3>
    <p class="hint">会复制原图、生成拼图，并放一份「发布前必读.txt」。</p>
    ${isClient ? `<fieldset class="consent"><legend>交付前质检（全部勾上才能导出）</legend>${CHECKLIST.map((t, i) => `<label class="check" style="display:flex"><input type="checkbox" class="qc"> ${esc(t)}</label>`).join('')}</fieldset>` : ''}
    <label class="check"><input id="aiLabel" type="checkbox" checked> 拼图右下角加「AI 生成」标识</label>
    <p class="hint">抖音、小红书都要求主动声明 AI 生成内容：发布时记得勾选平台的「AI 生成」声明。单张原图不会加角标。</p>
    <button id="expGo" class="primary" ${isClient ? 'disabled' : ''}>导出并打开文件夹</button>`);
  if (isClient) body.addEventListener('change', () => { body.querySelector('#expGo').disabled = ![...document.querySelectorAll('.qc')].every(c => c.checked); });
  body.querySelector('#expGo').addEventListener('click', async () => {
    const r = await api('POST', `/api/projects/${state.p.id}/export`, { files, aiLabel: body.querySelector('#aiLabel').checked, checked: isClient ? true : undefined });
    closeModal();
    toast('已导出到 ' + r.dir);
  });
});

// ---- polling ----------------------------------------------------------------

let pollTimer;
function poll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!state.p) return;
    const busy = state.p.jobs.some(j => ['queued', 'running'].includes(j.status));
    if (!busy) return;
    const fresh = await fetch(`/api/projects/${state.p.id}`).then(r => r.json()).catch(() => null);
    if (fresh && fresh.id === state.p.id) {
      const before = JSON.stringify(state.p.jobs);
      state.p = fresh;
      $('#queueInfo').textContent = `中转站：${fresh.queue.active} 个进行中，${fresh.queue.pending} 个排队`;
      if (JSON.stringify(fresh.jobs) !== before) { renderJobs(); if (state.tab === 'gallery') renderGallery(); if (state.tab === 'replica') renderStage(); }
    }
    poll();
  }, 2500);
}

// ---- boot -------------------------------------------------------------------

state.meta = await api('GET', '/api/meta');
renderHealth();
setInterval(renderHealth, 60000);
fillSelects();
await loadProjects();
const last = localStorage.getItem('lastProject');
if (last && $(`#projects li[data-id="${last}"]`)) { await openProject(last); poll(); }

// ---- connection health --------------------------------------------------------

const light = (ok, warn) => `<span class="dot ${ok ? (warn ? 'warn' : 'ok') : 'bad'}"></span>`;

let lastLong = null; // keep the last long-connection result visible across the periodic refresh
async function renderHealth(long = false) {
  const h = await fetch('/api/health' + (long ? '?long=1' : '')).then(r => r.json()).catch(() => null);
  if (!h || !h.relay) { $('#health').innerHTML = light(false) + '本地服务没响应'; return; }
  if (h.long) lastLong = { ...h.long, at: new Date().toTimeString().slice(0, 5) };
  h.long = lastLong;
  const cut = h.gen.cuts > 0;
  const svc = (name, x) => `<div>${light(x.ok)}${name} ${x.ok ? x.ms + 'ms' : '连不上（' + (x.error || x.status) + '）'}</div>`;
  let html = svc('中转站', h.relay) + svc('TikHub', h.tikhub) +
    `<div>${light(true, !h.async)}出图方式 ${h.async ? '异步（不怕代理断线）' : '同步（长连接，代理会断）'}</div>` +
    `<div>${light(!cut, !h.gen.lastOkAt)}出图连接 ${cut ? '最近被掐断 ' + h.gen.cuts + ' 次' : h.gen.lastOkAt ? '正常' : '本次还没出过图'}</div>`;
  if (cut && !h.async) html += '<div class="tip">本机代理在掐断长连接：在 FlClash/Clash 里把 duckdns.org 设为 DIRECT、换节点或关掉 TUN。</div>';
  if (h.long) html += `<div>${light(h.long.ok)}长连接 ${h.long.ok ? '能撑住 15 秒' : h.long.sec + ' 秒就断了（' + (h.long.error || h.long.status) + '）'} <span class="muted">${h.long.at}</span></div>`;
  if (h.long && !h.long.ok) html += '<div class="tip">长连接撑不住，出图（约 40 秒）一定会失败，先修代理。</div>';
  $('#health').innerHTML = html;
}

$('#longTest').addEventListener('click', async e => {
  e.target.disabled = true;
  e.target.textContent = '测试中…（最多 30 秒）';
  try { await renderHealth(true); } finally { e.target.disabled = false; e.target.textContent = '测一下长连接（15 秒）'; }
});

// ---- batch ---------------------------------------------------------------------

$('#batchBtn').addEventListener('click', async () => {
  const presets = $$('#batchList input:checked').map(i => i.value);
  if (!presets.length) return toast('先勾选场景', true);
  const jobs = await api('POST', `/api/projects/${state.p.id}/batch`, {
    presets, model: $('#model').value, count: $('#count').value, faceId: $('#genFace').value || null, post: $('#post').value,
    smartLight: $('#smartLight').checked, autoLight: $('#autoLight').checked, realism: $('#realism').value,
    aspect: $('[name=aspect]').value, face: $('[name=face]').value, extra: $('[name=extra]').value,
  });
  state.p = await api('GET', `/api/projects/${state.p.id}`);
  toast(`已提交 ${jobs.length} 个场景，共 ${jobs.length * Number($('#count').value)} 张，中转站同时跑 3 张`);
  renderJobs(); renderGallery(); poll();
});

// ---- style cards ---------------------------------------------------------------

const styleUrl = (st, sub, name) => `/styles/${st.id}/${sub}/${encodeURIComponent(name)}`;

async function renderStyles() {
  const list = await api('GET', '/api/styles');
  $('#styles').innerHTML = list.length ? list.map(st => `
    <div class="card" data-id="${st.id}">
      <div class="style-thumbs">${[...st.refs.map(n => styleUrl(st, 'refs', n)), ...st.best.map(n => styleUrl(st, 'best', n))].slice(0, 6).map(u => `<img src="${u}" loading="lazy">`).join('')}</div>
      <div class="body"><b>${esc(st.name)}</b>
        <div class="muted">参考图 ${st.refs.length} · 高星成品 ${st.best.length} · ${st.updatedAt.slice(0, 10)}</div>
        ${st.notes ? `<div class="muted">${esc(st.notes)}</div>` : ''}
        <div class="actions"><button data-act="apply">套用到当前项目</button><button data-act="del">删除</button></div>
      </div></div>`).join('') : '<p class="hint">还没有风格卡。在「③ 出图」调好一套满意的设置后，点「把当前设置存为风格卡」。</p>';
}

$('#styles').addEventListener('click', async e => {
  const card = e.target.closest('.card[data-id]');
  if (!card) return;
  if (e.target.dataset.act === 'del') {
    if (!confirm('删除这张风格卡？')) return;
    await api('DELETE', `/api/styles/${card.dataset.id}`);
    renderStyles();
  } else if (e.target.dataset.act === 'apply') {
    const { style } = await api('POST', `/api/projects/${state.p.id}/styles/${card.dataset.id}/apply`);
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    if (style.fields && Object.keys(style.fields).length) setFields(style.fields);
    if (style.model) $('#model').value = style.model;
    if (style.post) $('#post').value = style.post;
    state.promptDirty = false;
    await rebuildPrompt();
    renderCases(); renderMoodbars();
    setTab('gen');
    toast(`已套用「${style.name}」：moodboard 和表单都填好了`);
  }
});

$('#saveStyleBtn').addEventListener('click', async () => {
  const list = await api('GET', '/api/styles');
  const stars = state.p.jobs.flatMap(j => j.outputs).filter(o => o.star >= 4).length;
  const body = openModal(`
    <h3 style="margin-top:0">存为风格卡</h3>
    <p class="hint">会保存：moodboard ${state.p.moodboard.length} 张、本项目 4 星以上的图 ${Math.min(stars, 6)} 张、当前表单、模型和后期。</p>
    <label>名字 <input id="stName" style="width:100%" placeholder="例如 韩女街拍·手机轻闪"></label>
    <label>备注（适合什么场景、踩过的坑）<textarea id="stNotes" rows="3"></textarea></label>
    <label>覆盖已有风格卡 <select id="stUpdate"><option value="">— 新建 —</option>${list.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
    <button id="stSave" class="primary">保存</button>`);
  body.querySelector('#stSave').addEventListener('click', async () => {
    const st = await api('POST', `/api/projects/${state.p.id}/styles`, {
      name: body.querySelector('#stName').value, notes: body.querySelector('#stNotes').value, updateId: body.querySelector('#stUpdate').value || null,
      fields: formFields(), post: $('#post').value, model: $('#model').value,
    });
    closeModal();
    toast(`已保存风格卡「${st.name}」`);
  });
});

// ---- clients (long-term customers and one-off orders) -------------------------

const clientPhoto = (c, rel) => `/cfiles/${c.id}/${rel.split('/').map(encodeURIComponent).join('/')}`;
let clientState = { types: {}, clients: [] };

function showClients() {
  $('#empty').hidden = true;
  $('#workspace').hidden = true;
  $('#clientsView').hidden = false;
  $$('#projects li').forEach(li => li.classList.remove('active'));
  renderClients();
}
function hideClients() { $('#clientsView').hidden = true; }
$('#clientsBtn').addEventListener('click', showClients);
// Opening any project leaves the clients page.
$('#projects').addEventListener('click', hideClients, true);

let dossierId = null;
async function renderClients() {
  clientState = await api('GET', '/api/clients');
  if (dossierId && clientState.clients.some(c => c.id === dossierId)) return renderDossier(dossierId);
  dossierId = null;
  const { clients, types } = clientState;
  const expired = clients.filter(c => c.expired);
  $('#clientsList').innerHTML =
    (expired.length ? `<div class="warnbar"><b>${expired.length} 位客户的资料已过保留期</b>：${expired.map(c => esc(c.name)).join('、')}。
      <button id="purgeExpired">按约定清理这些客户的照片</button></div>` : '') +
    (clients.length ? `<div class="cards">${clients.map(c => `
      <div class="card client" data-id="${c.id}">
        <div class="body">
          <div class="row" style="margin:0"><b class="grow" data-act="dossier" style="cursor:pointer" title="打开客户档案">${esc(c.name)}</b><span class="tag ${c.type}">${esc(types[c.type])}</span></div>
          <div class="muted">${c.consent.given ? `已同意 ${esc(c.consent.date || '')}` : '<span class="bad">未确认同意</span>'} · 脸 ${c.faces.length} 张 · 身材 ${c.bodies.length} 张 · 订单 ${c.orders.length}</div>
          <div class="muted ${c.expired ? 'bad' : ''}">${c.faces.length + c.bodies.length ? (c.expired ? '已过保留期，请清理' : `资料保留到 ${c.expiresAt.slice(0, 10)}（还剩 ${Math.max(c.daysLeft, 0)} 天）`) : '没有存照片'}</div>
          ${c.notes ? `<div class="muted">${esc(c.notes)}</div>` : ''}
          <div class="style-thumbs">${[...c.faces, ...c.bodies].slice(0, 6).map(r => `<img src="${clientPhoto(c, r)}" loading="lazy">`).join('')}</div>
          <div class="actions"><button data-act="dossier">客户档案</button><button data-act="edit">档案 / 照片</button><button data-act="order">新建订单</button><button data-act="delivered">标记已交付</button><button data-act="del">删除客户</button></div>
        </div></div>`).join('')}</div>` : '<p class="hint">还没有客户。点右上角「新建客户」。长期客户的照片会保留到约定期限，散单默认交付后 7 天提醒删除。</p>');
}

$('#newClientBtn').addEventListener('click', () => clientDialog(null));

// 客户档案: client card + headline numbers + order timeline grouped by month (layout idea from a Pinterest patient-dashboard pin)
const projFile = (pid, rel) => `/files/${pid}/${rel.split('/').map(encodeURIComponent).join('/')}`;
async function renderDossier(id) {
  const d = await api('GET', `/api/clients/${id}/dossier`);
  const c = clientState.clients.find(x => x.id === id) || d.client;
  const s = d.stats;
  const types = clientState.types;
  const tile = (n, label, tone = '') => `<div class="dos-tile ${tone}"><b>${n}</b><span>${label}</span></div>`;
  const byMonth = {};
  for (const o of d.orders) (byMonth[o.createdAt.slice(0, 7)] ||= []).push(o);
  const timeline = d.orders.length ? Object.entries(byMonth).map(([m, list]) => `
    <div class="dos-month"><span>${m}</span></div>
    ${list.map(o => `<div class="dos-node"><i class="dos-dot"></i>
      <div class="dos-order panel">
        <div class="row" style="margin:0"><b class="grow">${esc(o.name)}</b><span class="muted">${o.createdAt.slice(5, 10)}</span></div>
        <div class="muted">${o.images} 张成品${o.live ? ` · ${o.live} 个实况` : ''} · ${o.starred} 张 4 星以上 · 质检通过 ${o.qaPass}/${o.images}</div>
        <div class="dos-thumbs">${o.thumbs.map(t => `<img src="${projFile(o.projectId, t)}" loading="lazy">`).join('') || '<span class="muted">还没有成品</span>'}</div>
        <div class="actions"><button data-act="openorder" data-project="${o.projectId}">打开订单</button></div>
      </div></div>`).join('')}`).join('') : '<p class="hint">还没有订单。点上面的「新建订单」。</p>';
  $('#clientsList').innerHTML = `
    <div class="client dos" data-id="${c.id}">
      <button class="ghost" data-act="back">← 全部客户</button>
      <section class="dos-hero panel">
        <div class="dos-faces">${c.faces.slice(0, 3).map(r => `<img src="${clientPhoto(c, r)}">`).join('') || '<div class="dos-noface">无照片</div>'}</div>
        <div class="dos-id">
          <h2>${esc(c.name)} <span class="tag ${c.type}">${esc(types[c.type])}</span></h2>
          <div class="muted">${c.consent.given ? `已同意 ${esc(c.consent.date || '')}${c.consent.scope ? ' · ' + esc(c.consent.scope) : ''}` : '<span class="bad">未确认同意</span>'}</div>
          ${c.notes ? `<div class="muted">${esc(c.notes)}</div>` : ''}
          <div class="actions" style="margin-top:10px"><button class="primary" style="width:auto;margin:0" data-act="order">新建订单</button><button data-act="edit">档案 / 照片</button><button data-act="delivered">标记已交付</button><button class="ghost" data-act="del">删除客户</button></div>
        </div>
        <div class="dos-stats">
          ${tile(s.orders, '订单')}${tile(s.images, '成品图')}${tile(s.starred, '4 星以上')}${tile(s.qaPass, '质检通过')}${tile(s.live, '实况')}
          ${tile(s.photos ? (s.expired ? '已到期' : Math.max(s.daysLeft, 0) + ' 天') : '—', s.photos ? '资料保留剩余' : '没存照片', s.expired ? 'bad' : '')}
        </div>
      </section>
      <section class="dos-timeline">${timeline}</section>
    </div>`;
}

$('#clientsList').addEventListener('click', async e => {
  if (e.target.id === 'purgeExpired') {
    const list = clientState.clients.filter(c => c.expired);
    if (!confirm(`将删除 ${list.map(c => c.name).join('、')} 的脸部/身材照片和客户档案，订单里的成品图保留。继续？`)) return;
    for (const c of list) await api('DELETE', `/api/clients/${c.id}`, { purgeProjects: false });
    toast('已清理到期客户的照片'); renderClients(); loadProjects();
    return;
  }
  if (e.target.dataset.act === 'back') { dossierId = null; renderClients(); return; }
  if (e.target.closest('[data-act=openorder]')) { const el = e.target.closest('[data-act=openorder]'); hideClients(); await openProject(el.dataset.project); setTab('gallery'); return; }
  const card = e.target.closest('.client');
  if (!card) return;
  const c = clientState.clients.find(x => x.id === card.dataset.id);
  const act = e.target.dataset.act;
  if (act === 'dossier') { dossierId = c.id; renderClients(); }
  else if (act === 'edit') clientDialog(c);
  else if (act === 'delivered') { await api('POST', `/api/clients/${c.id}/delivered`); toast(`已标记交付，保留期从今天起算 ${c.consent.retainDays} 天`); renderClients(); }
  else if (act === 'order') {
    if (!c.consent.given) return toast('先在「档案 / 照片」里确认客户已同意', true);
    if (!c.faces.length) return toast('先上传至少 1 张脸部照片', true);
    const p = await api('POST', `/api/clients/${c.id}/orders`, {});
    hideClients();
    await loadProjects();
    await openProject(p.id);
    setTab('gen');
    toast(`已为 ${c.name} 新建订单：脸 ${c.faces.length} 张、体型参考 ${Math.min(c.bodies.length, 2)} 张已带入`);
  } else if (act === 'del') {
    const purge = confirm(`删除「${c.name}」的客户档案和照片。\n\n点「确定」：连同这个客户的所有订单和成品图一起删除。\n点「取消」：下一步可以选择只删照片、保留成品。`);
    if (!purge && !confirm('只删除客户照片和档案，保留订单里的成品图？')) return;
    await api('DELETE', `/api/clients/${c.id}`, { purgeProjects: purge });
    toast('已删除'); renderClients(); loadProjects();
  }
});

function clientDialog(c) {
  const isNew = !c;
  const cur = c || { name: '', type: 'oneoff', contact: '', notes: '', consent: { given: false, scope: '', retainDays: 7, showcase: false }, faces: [], bodies: [] };
  const body = openModal(`
    <h3 style="margin-top:0">${isNew ? '新建客户' : '客户档案：' + esc(cur.name)}</h3>
    <div class="row wrap">
      <label>名称 <input id="cName" value="${esc(cur.name)}" placeholder="昵称或编号即可"></label>
      <label>类型 <select id="cType"><option value="oneoff">散单</option><option value="longterm">长期客户</option></select></label>
      <label>联系方式 <input id="cContact" value="${esc(cur.contact)}" placeholder="微信号（选填）"></label>
    </div>
    <label>备注 <input id="cNotes" style="width:100%" value="${esc(cur.notes)}" placeholder="风格偏好、禁忌、交付要求"></label>
    <fieldset class="consent"><legend>客户同意（没确认前不能上传照片、不能建订单）</legend>
      <label class="check"><input id="cConsent" type="checkbox" ${cur.consent.given ? 'checked' : ''}> 客户已明确同意用其照片生成 AI 写真</label>
      <label>用途和范围 <input id="cScope" style="width:100%" value="${esc(cur.consent.scope)}" placeholder="例如：仅生成个人写真，不对外展示，交付后删除照片"></label>
      <div class="row wrap"><label>资料保留天数 <input id="cRetain" type="number" min="1" max="3650" style="width:90px" value="${cur.consent.retainDays}"></label>
        <label class="check"><input id="cShow" type="checkbox" ${cur.consent.showcase ? 'checked' : ''}> 同意作为案例展示</label></div>
      <p class="hint">散单默认 7 天、长期客户默认 180 天，从交付日（或最近一次下单）起算；到期后会在客户页提醒清理。同意最好留聊天记录。</p>
    </fieldset>
    <div id="cPhotos"></div>
    <button id="cSave" class="primary">${isNew ? '创建客户' : '保存档案'}</button>`);
  body.querySelector('#cType').value = cur.type;
  const typeEl = body.querySelector('#cType'), retainEl = body.querySelector('#cRetain');
  typeEl.addEventListener('change', () => { if (isNew) retainEl.value = typeEl.value === 'longterm' ? 180 : 7; });
  const form = () => ({
    name: body.querySelector('#cName').value, type: typeEl.value, contact: body.querySelector('#cContact').value, notes: body.querySelector('#cNotes').value,
    consent: { given: body.querySelector('#cConsent').checked, scope: body.querySelector('#cScope').value, retainDays: Number(retainEl.value), showcase: body.querySelector('#cShow').checked },
  });
  const drawPhotos = () => {
    const box = body.querySelector('#cPhotos');
    if (isNew) { box.innerHTML = '<p class="hint">先创建客户并确认同意，再上传照片。</p>'; return; }
    const kinds = [['face', '脸部照片（3–5 张：正脸、左右侧脸，不开美颜）', cur.faces, 8], ['body', '身材照片（2–3 张：全身，正面和侧面）', cur.bodies, 6]];
    box.innerHTML = kinds.map(([k, label, list, max]) => `
      <h4>${label} · ${list.length}/${max}</h4>
      <div class="cphotos">${list.map(r => `<div class="cphoto"><img src="${clientPhoto(cur, r)}"><button data-kind="${k}" data-file="${esc(r)}" title="删除">×</button></div>`).join('')}
        ${list.length < max ? `<label class="cadd">＋<input type="file" accept="image/*" multiple hidden data-up="${k}"></label>` : ''}</div>`).join('');
  };
  drawPhotos();
  body.querySelector('#cPhotos').addEventListener('change', async e => {
    const kind = e.target.dataset.up;
    if (!kind) return;
    if (!cur.consent.given) { e.target.value = ''; return toast('先勾选「客户已同意」并保存档案', true); }
    for (const f of e.target.files) { try { Object.assign(cur, await api('POST', `/api/clients/${cur.id}/photos`, { kind, dataUrl: await readFile(f) })); } catch { break; } }
    drawPhotos(); renderClients();
  });
  body.querySelector('#cPhotos').addEventListener('click', async e => {
    const b = e.target.closest('button[data-file]');
    if (!b) return;
    Object.assign(cur, await api('DELETE', `/api/clients/${cur.id}/photos`, { kind: b.dataset.kind, file: b.dataset.file }));
    drawPhotos(); renderClients();
  });
  body.querySelector('#cSave').addEventListener('click', async () => {
    const data = form();
    if (isNew) { const created = await api('POST', '/api/clients', data); closeModal(); toast('已创建，接着上传照片'); await renderClients(); clientDialog(created); }
    else { Object.assign(cur, await api('PATCH', `/api/clients/${cur.id}`, data)); toast('已保存'); drawPhotos(); renderClients(); }
  });
}

// ---- export checklist for customer orders ------------------------------------

const CHECKLIST = [
  '脸像客户本人（放大看过眼睛、鼻子、嘴，不是"像一个人"）',
  '体型和客户身材照一致，没有被瘦身或夸张',
  '手指、脚、饰品、背景文字和品牌 logo 没有异常',
  '没有选用客户不同意的内容（服装、姿势、场景）',
  '已告诉客户这是 AI 生成，发布时按平台要求声明',
];

// 按姿势库出一组: same prompt, model, face and post for each ticked pose (one job per pose).
$('#poseSetBtn').addEventListener('click', () => {
  const poses = Object.entries(state.meta.poses);
  const body = openModal(`
    <h3 style="margin-top:0">按姿势出一组（同一个人、同一套衣服）</h3>
    <p class="hint">用当前出图表单里的提示词、模型、模特、写实包和后期；每个姿势出 1 张，提示词末尾会替换成该姿势。景别和服装不合适的姿势先别勾。</p>
    <div class="row wrap" style="max-height:340px;overflow:auto">${poses.map(([k, v]) => `<label class="check" style="width:46%"><input type="checkbox" value="${k}"> ${esc(v.label)} <span class="muted">(${esc(state.meta.framings[v.framing] || v.framing)})</span></label>`).join('')}</div>
    <button id="psGo" class="primary">开始出图</button>`);
  body.querySelector('#psGo').addEventListener('click', async () => {
    const poseIds = [...body.querySelectorAll('input:checked')].map(i => i.value);
    if (!poseIds.length) return toast('先勾选姿势', true);
    const model = state.meta.models.find(m => m.id === $('#model').value);
    await api('POST', `/api/projects/${state.p.id}/pose-set`, {
      poseIds, prompt: $('#promptBox').value, fields: formFields(), aspect: $('[name=aspect]').value, model: model.id, count: 1,
      faceId: $('#genFace').value || null, post: $('#post').value, smartLight: $('#smartLight').checked, autoLight: $('#autoLight').checked, realism: $('#realism').value,
    });
    closeModal();
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    toast(`已提交 ${poseIds.length} 个姿势`);
    renderJobs(); renderGallery(); poll();
  });
});

// ---- ⑥ 复刻台 -----------------------------------------------------------------
// One screen: paste/drop a reference, pick the person, press the big button, compare results next to the reference.
const rp = { original: null, file: null, faceId: localStorage.getItem('rp:face') || '', outfitMode: localStorage.getItem('rp:outfit') || 'keep', jobId: null };

function fillReplicaFaces() {
  const faces = state.p.faces;
  if (!faces.some(f => f.id === rp.faceId)) rp.faceId = faces[0]?.id || '';
  $('#rpChips').innerHTML = faces.length ? faces.map(f => `<button type="button" class="chip ${f.id === rp.faceId ? 'on' : ''}" data-face="${f.id}"><img src="${fileUrl(f.file)}" alt=""><span>${esc(f.name)}</span></button>`).join('') : '<span class="muted">先在「② 模特」里加模特</span>';
  const face = faces.find(f => f.id === rp.faceId);
  if (face && !$('#rpIdentity').dataset.touched) $('#rpIdentity').value = face.desc || '';
  $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.outfit === rp.outfitMode));
  $('#rpOutfit').hidden = rp.outfitMode !== 'change';
  renderStage();
}

function showReplicaCrop(r) {
  rp.original = r.original; rp.file = r.file;
  rp.top = r.top; rp.bottom = r.bottom;
  const img = $('#rpPreview');
  img.onload = placeCropLines;
  img.src = fileUrl(r.original) + '?t=' + Date.now();
  $('#cropStage').hidden = false;
  $('#dropzone').classList.add('filled');
  $('#rpCrop').hidden = false;
  $('#rpTop').value = (r.top * 100).toFixed(1);
  $('#rpBottom').value = (r.bottom * 100).toFixed(1);
  $('#rpNote').textContent = r.auto ? '已自动识别照片范围，拖两条线可微调' : '没识别出界面，用了默认范围，拖两条线调整';
  fillReplicaFaces();
}

// the two lines are positioned in % of the stage; dragging updates the numbers and, on release, re-crops on the server
function placeCropLines() {
  $('#clTop').style.top = (rp.top * 100) + '%';
  $('#clBot').style.top = (rp.bottom * 100) + '%';
  $('.s-top').style.height = (rp.top * 100) + '%';
  $('.s-bot').style.height = ((1 - rp.bottom) * 100) + '%';
}
let cropTimer;
function bindCropLine(el, which) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const stage = $('#cropStage').getBoundingClientRect();
    const move = ev => {
      const y = Math.min(Math.max((ev.clientY - stage.top) / stage.height, 0), 1);
      if (which === 'top') rp.top = Math.min(y, rp.bottom - 0.1); else rp.bottom = Math.max(y, rp.top + 0.1);
      $('#rpTop').value = (rp.top * 100).toFixed(1); $('#rpBottom').value = (rp.bottom * 100).toFixed(1);
      placeCropLines();
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      clearTimeout(cropTimer);
      cropTimer = setTimeout(async () => {
        const r = await api('POST', `/api/projects/${state.p.id}/replica-recrop`, { original: rp.original, top: rp.top, bottom: rp.bottom });
        rp.file = r.file; $('#rpNote').textContent = '已按新范围裁剪';
      }, 250);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
}
bindCropLine($('#clTop'), 'top'); bindCropLine($('#clBot'), 'bottom');

async function uploadReference(file) {
  if (!file || !file.type.startsWith('image/')) return toast('只支持图片', true);
  const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  $('#rpNote').textContent = '识别中…'; $('#rpCrop').hidden = false;
  showReplicaCrop(await api('POST', `/api/projects/${state.p.id}/replica-ref`, { dataUrl }));
  state.p = await api('GET', `/api/projects/${state.p.id}`);
}

const dz = $('#dropzone');
dz.addEventListener('click', e => { if (!e.target.closest('.crop-bar, #cropStage')) $('#rpUpload').click(); });
dz.addEventListener('keydown', e => { if (e.key === 'Enter') $('#rpUpload').click(); });
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); uploadReference(e.dataTransfer.files[0]); });
$('#rpUpload').addEventListener('change', e => { uploadReference(e.target.files[0]); e.target.value = ''; });
// paste anywhere while this tab is open
document.addEventListener('paste', e => {
  if (state.tab !== 'replica' || !state.p || e.target.matches('input, textarea')) return;
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); uploadReference(item.getAsFile()); }
});

$('#rpRecrop').addEventListener('click', async () => {
  { const r = await api('POST', `/api/projects/${state.p.id}/replica-recrop`, { original: rp.original, top: Number($('#rpTop').value) / 100, bottom: Number($('#rpBottom').value) / 100 }); showReplicaCrop(r); }
});
$('#rpChips').addEventListener('click', e => {
  const b = e.target.closest('[data-face]');
  if (!b) return;
  rp.faceId = b.dataset.face; localStorage.setItem('rp:face', rp.faceId);
  $('#rpIdentity').value = ''; delete $('#rpIdentity').dataset.touched;
  fillReplicaFaces();
});
$('.stage-side .seg').addEventListener('click', e => {
  const b = e.target.closest('[data-outfit]');
  if (!b) return;
  rp.outfitMode = b.dataset.outfit; localStorage.setItem('rp:outfit', rp.outfitMode);
  fillReplicaFaces();
});
$('#rpIdentity').addEventListener('input', e => { e.target.dataset.touched = '1'; });

$('#rpGo').addEventListener('click', async () => {
  if (!rp.file) return toast('先粘贴或拖入参考图', true);
  if (!rp.faceId) return toast('先选一个人', true);
  $('#rpGo').disabled = true;
  try {
    const job = await api('POST', `/api/projects/${state.p.id}/replica`, {
      source: rp.file, faceId: rp.faceId, count: $('#rpCount').value, identity: $('#rpIdentity').value, hair: $('#rpHair').value,
      outfitMode: rp.outfitMode, outfit: $('#rpOutfit').value, removeUi: $('#rpRemoveUi').checked, keepExpression: $('#rpKeepExpr').checked,
      model: $('#model').value, post: $('#post').value, smartLight: $('#smartLight').checked, autoLight: $('#autoLight').checked, realism: $('#realism').value,
    });
    rp.jobId = job.id;
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    toast('已提交，结果会出现在右边，约 1–2 分钟');
    renderStage(); poll();
  } finally { $('#rpGo').disabled = false; }
});

// side-by-side results of the latest replica job: reference first, then each result with quick actions
function renderStage() {
  const box = $('#rpResults');
  if (!box) return;
  const job = state.p?.jobs.find(j => j.id === rp.jobId) || [...(state.p?.jobs || [])].reverse().find(j => j.replica);
  if (!job) { box.innerHTML = ''; return; }
  const waiting = ['queued', 'running'].includes(job.status) ? job.count - job.outputs.length : 0;
  const statusText = { queued: '排队中', running: '生成中', done: '完成', partial: '部分失败', failed: '失败' }[job.status];
  const verdictText = { pass: '质检通过', retry: '建议重出', fail: '不通过', unsure: '有项看不清' };
  box.innerHTML = `<div class="row" style="margin:0"><b>结果</b><span class="status ${job.status}">${statusText}</span><span class="muted">${esc(job.model)} · ${job.outputs.length}/${job.count} 张</span><span class="grow"></span><button class="ghost small" data-rpact="again" data-job="${job.id}">再来一批</button></div>
    ${(job.errors || []).map(e => `<div class="err">⚠ ${esc(e)}</div>`).join('')}
    <div class="cmp">
      <figure><img src="${fileUrl(job.replica.source)}" data-rpact="zoom" alt=""><figcaption>参考图</figcaption></figure>
      ${job.outputs.map(o => `<figure data-file="${esc(o.file)}"><img src="${fileUrl(o.final || o.file)}" data-rpact="zoom" alt="">
        <figcaption>${o.qa ? `<span class="qa-inline ${esc(o.qa.verdict)}">${verdictText[o.qa.verdict] || ''}</span>` : ''}
        <span class="quick"><button data-rpact="compare">对比</button><button data-rpact="light">补光</button><button data-rpact="live">实况</button><button data-rpact="qa" data-job="${job.id}">质检</button><button data-rpact="star">${o.star >= 4 ? '★' : '☆'}</button></span></figcaption></figure>`).join('')}
      ${Array.from({ length: waiting }, () => '<figure><div class="placeholder">生成中…</div></figure>').join('')}
    </div>`;
}

$('#rpResults').addEventListener('click', async e => {
  const b = e.target.closest('[data-rpact]');
  if (!b) return;
  const fig = b.closest('figure');
  const o = fig && state.p.jobs.flatMap(j => j.outputs).find(x => x.file === fig.dataset.file);
  const act = b.dataset.rpact;
  if (act === 'zoom') return viewer(b.src);
  if (act === 'compare') { const j = state.p.jobs.find(x => x.id === rp.jobId) || [...state.p.jobs].reverse().find(x => x.replica); return viewer(fileUrl(o.final || o.file), fileUrl(j.replica.source)); }
  if (act === 'again') {
    await api('POST', `/api/projects/${state.p.id}/jobs/${b.dataset.job}/rerun`, {});
    state.p = await api('GET', `/api/projects/${state.p.id}`);
    renderStage(); poll();
    return toast('已再来一批');
  }
  if (!o) return;
  if (act === 'light') relightDialog(o);
  else if (act === 'live') liveDialog(o);
  else if (act === 'star') { Object.assign(o, await api('POST', `/api/projects/${state.p.id}/star`, { file: o.file, star: o.star >= 4 ? 0 : 4 })); renderStage(); }
  else if (act === 'qa') {
    b.disabled = true; b.textContent = '质检中…';
    try { const r = await api('POST', `/api/projects/${state.p.id}/jobs/${b.dataset.job}/auto-qa`, {}); toast(`自动质检完成（${r.model}）`); }
    finally { state.p = await api('GET', `/api/projects/${state.p.id}`); renderStage(); }
  }
});

// ---- 画布查看器：滚轮缩放、拖动平移、前后对比滑块 ----------------------------------
function viewer(src, refSrc) {
  const body = openModal(`
    <div class="vw" id="vw">
      <div class="vw-stage" id="vwStage"><div class="vw-layer" id="vwLayer">
        <img src="${src}" alt="" draggable="false">
        ${refSrc ? `<img class="vw-ref" id="vwRef" src="${refSrc}" alt="" draggable="false">` : ''}
      </div></div>
      ${refSrc ? '<div class="vw-slider"><span>参考图</span><input id="vwRange" type="range" min="0" max="100" value="50"><span>结果</span></div>' : ''}
      <div class="vw-help">滚轮缩放 · 拖动平移 · 双击复位</div>
    </div>`);
  const stage = body.querySelector('#vwStage'), layer = body.querySelector('#vwLayer');
  let k = 1, x = 0, y = 0;
  const apply = () => { layer.style.transform = `translate(${x}px, ${y}px) scale(${k})`; };
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
    const nk = Math.min(Math.max(k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1), 8);
    x = cx - (cx - x) * (nk / k); y = cy - (cy - y) * (nk / k); k = nk;
    if (k === 1) { x = 0; y = 0; }
    apply();
  }, { passive: false });
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('input')) return;
    stage.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = ev => { x += ev.clientX - lx; y += ev.clientY - ly; lx = ev.clientX; ly = ev.clientY; apply(); };
    const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); };
    stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up);
  });
  stage.addEventListener('dblclick', () => { k = 1; x = 0; y = 0; apply(); });
  const range = body.querySelector('#vwRange'), ref = body.querySelector('#vwRef');
  if (range) {
    const set = () => { ref.style.clipPath = `inset(0 ${100 - range.value}% 0 0)`; };
    range.addEventListener('input', set); set();
  }
}
window.__viewer = viewer; // handy for manual checks in the console
