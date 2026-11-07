// ⑦ 工作台 v2 — simpler canvas. The main unit is a 复刻卡 (replica card): it has its own slots for the scene image,
// the model, up to three reference images and the prompt, so most work is "drag an image into the dashed box, press run".
// Results can be sent on with one click (打光 / 实况 / 再复刻); the follow-up card is placed to the right and linked.
// Wires and the older image / model / prompt nodes from v1 boards still load and still feed values.
// The graph is saved per project (GET/PUT /api/projects/:id/board). Helpers come from app.js via window.studio.
const S = () => window.studio;
const $ = s => document.querySelector(s);
const esc = s => S().esc(s);

// v1 port tables, kept so old boards and wires still work. port: [id, label, type, max]
const TYPES = {
  image: { title: '图片', ins: [], outs: [['img', '图', 'img']] },
  model: { title: '模特', ins: [], outs: [['face', '模特', 'face']] },
  prompt: { title: '提示词', ins: [], outs: [['text', '提示词', 'text']] },
  replica: { title: '复刻卡', ins: [['scene', '场景图', 'img', 1], ['face', '模特', 'face', 1], ['refs', '参考图', 'img', 3], ['text', '提示词', 'text', 9]], outs: [['img', '结果', 'img']] },
  relight: { title: '打光', ins: [['src', '原图', 'img', 1]], outs: [['img', '结果', 'img']] },
  live: { title: '实况', ins: [['src', '原图', 'img', 1]], outs: [] },
};
const CARD_W = { replica: 330, relight: 280, live: 280, image: 220, model: 220, prompt: 240 };
const GAP = 60;

let board = { nodes: [], edges: [], view: { x: 40, y: 40, k: 1 } };
let loadedFor = null, assetSrc = 'outputs', saveTimer = null, pollTimer = null, selected = null;
const uid = p => p + Math.random().toString(36).slice(2, 8);
const canvas = () => $('#bdCanvas'), world = () => $('#bdWorld'), wires = () => $('#bdWires');
const proj = () => S().state.p;
const nodeById = id => board.nodes.find(n => n.id === id);
const fileUrl = rel => S().fileUrl(rel);
const faceOf = id => proj().faces.find(f => f.id === id);

// ---- persistence -------------------------------------------------------------
async function load() {
  board = await S().api('GET', `/api/projects/${proj().id}/board`);
  undoStack.length = 0; redoStack.length = 0; updateUndoButtons();
  board.view ||= { x: 40, y: 40, k: 1 };
  loadedFor = proj().id;
}
function save() {
  clearTimeout(saveTimer);
  $('#bdSaved').textContent = '未保存…';
  saveTimer = setTimeout(async () => {
    const r = await S().api('PUT', `/api/projects/${proj().id}/board`, board);
    $('#bdSaved').textContent = '已保存 ' + r.savedAt.slice(11, 19);
  }, 500);
}

// ---- undo / redo: snapshots of cards and wires (not the view), taken before every change ----
const undoStack = [], redoStack = [];
const snap = () => JSON.stringify({ nodes: board.nodes, edges: board.edges });
function updateUndoButtons() {
  const u = $('#bdBar [data-act=undo]'), r = $('#bdBar [data-act=redo]');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}
function checkpoint() { undoStack.push(snap()); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; updateUndoButtons(); }
function restore(json) {
  const st = JSON.parse(json);
  board.nodes = st.nodes; board.edges = st.edges;
  if (selected && !nodeById(selected)) selected = null;
  render(); save(); updateUndoButtons();
}
function undo() { if (!undoStack.length) return S().toast('没有可以撤销的操作'); redoStack.push(snap()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return S().toast('没有可以重做的操作'); undoStack.push(snap()); restore(redoStack.pop()); }

// ---- values: a card's own slot wins, a wire is the fallback --------------------
const jobOf = n => (n.data.jobId ? proj().jobs.find(j => j.id === n.data.jobId) : null);
// every run of a card is kept: jobIds = all batches (oldest first), jobId = the batch the card is showing
const historyOf = n => { if (!n.data.jobIds) n.data.jobIds = n.data.jobId ? [n.data.jobId] : []; return n.data.jobIds; };
function historyNav(n) {
  const h = historyOf(n);
  if (h.length < 2) return '';
  const i = Math.max(0, h.indexOf(n.data.jobId));
  return `<div class="bd-hist"><button data-act="hist" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="上一批">‹</button><span>第 ${i + 1} / ${h.length} 批</span><button data-act="hist" data-dir="1" ${i === h.length - 1 ? 'disabled' : ''} title="下一批">›</button></div>`;
}
const resultFiles = n => (jobOf(n)?.outputs || []).filter(o => !o.live).map(o => o.file);
function outValue(n) {
  if (!n) return null;
  if (n.type === 'image') return n.data.file;
  if (n.type === 'model') return n.data.faceId;
  if (n.type === 'prompt') return (n.data.text || '').trim();
  if (n.type === 'replica' || n.type === 'relight') return n.data.pick || resultFiles(n)[0] || null;
  return null;
}
const wired = (n, port) => board.edges.filter(e => e.to.node === n.id && e.to.port === port).map(e => outValue(nodeById(e.from.node))).filter(Boolean);
function val(n, slot) {
  const d = n.data;
  if (slot === 'scene') return d.scene || wired(n, 'scene')[0] || null;
  if (slot === 'face') return wired(n, 'face')[0] || d.faceId || null;
  if (slot === 'refs') return [...(d.refs || []).filter(Boolean), ...wired(n, 'refs')].slice(0, 3);
  if (slot === 'text') return [d.text || '', ...wired(n, 'text')].map(t => t.trim()).filter(Boolean).join('\n');
  if (slot === 'src') return d.src || wired(n, 'src')[0] || null;
  return null;
}
function modeOf(n) {
  const scene = val(n, 'scene'), face = val(n, 'face'), text = val(n, 'text');
  if (scene && face) return { k: 'swap', label: '复刻换人', tip: '保留场景图的背景和姿势，换成模特' + (text ? '，加上提示词' : '') };
  if (text) return { k: 'gen', label: '生成', tip: '按提示词出图' + (val(n, 'refs').length || scene ? '，参考图只借风格' : '') };
  return { k: 'none', label: '待填', tip: scene ? '再选一个模特就能复刻换人' : '拖一张场景图进来，再选模特' };
}

// ---- rendering ---------------------------------------------------------------
const slotHtml = (n, slot, file, label, big = false) => file
  ? `<div class="bd-slot filled ${big ? 'big' : ''}" data-slot="${slot}"><img src="${fileUrl(file)}" data-zoom="${esc(file)}"><button class="bd-clear" data-act="clear" data-slot="${slot}" title="移除">×</button></div>`
  : `<div class="bd-slot ${big ? 'big' : ''}" data-slot="${slot}"><span>${label}</span></div>`;
function statusLine(n) {
  const j = jobOf(n);
  if (!j) return '';
  const t = { queued: '排队中', running: '生成中…', done: '完成', partial: '部分完成', failed: '失败' }[j.status] || j.status;
  return `<div class="bd-status ${j.status}">${t}${j.errors?.length ? ' · ' + esc(j.errors[0]).slice(0, 80) : ''}</div>`;
}
function resultsHtml(n, actions) {
  const j = jobOf(n);
  if (!j) return '';
  const outs = j.outputs.filter(o => !o.live);
  const pick = outValue(n);
  const waiting = ['queued', 'running'].includes(j.status) ? j.count - j.outputs.length : 0;
  return `<div class="bd-results">${outs.map(o => `<figure class="${o.file === pick ? 'picked' : ''}">
      <img src="${fileUrl(o.final || o.file)}" draggable="true" data-pick="${esc(o.file)}" data-asset='${esc(JSON.stringify({ kind: 'file', file: o.file }))}' title="单击选中，双击放大，可拖到别的卡片">
      <figcaption>${actions.map(([a, l]) => `<button data-act="${a}" data-file="${esc(o.file)}">${l}</button>`).join('')}</figcaption></figure>`).join('')}
    ${Array.from({ length: waiting }, () => '<div class="bd-wait"></div>').join('')}</div>`;
}
function bodyHtml(n) {
  const p = proj(), d = n.data;
  if (n.type === 'replica') {
    const m = modeOf(n), face = val(n, 'face'), f = faceOf(face), refs = d.refs || [];
    return `
      <div class="bd-mode ${m.k}"><b>${m.label}</b><span>${m.tip}</span></div>
      <div class="bd-row2">
        ${slotHtml(n, 'scene', val(n, 'scene'), '拖入场景图<br><small>要保留的背景和姿势</small>', true)}
        <div class="bd-face">
          <label>模特</label>
          <div class="bd-slot face ${f ? 'filled' : ''}" data-slot="face">${f ? `<img src="${fileUrl(f.file)}">` : '<span>拖入或选择</span>'}</div>
          <select data-field="faceId"><option value="">不换人</option>${p.faces.map(x => `<option value="${x.id}" ${x.id === face ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        </div>
      </div>
      <label>参考图 <small class="muted">只借风格，可不放</small></label>
      <div class="bd-refs">${[0, 1, 2].map(i => slotHtml(n, 'ref' + i, refs[i], '+')).join('')}</div>
      <textarea data-field="text" rows="2" placeholder="补充要求（可不写）：例如 午后窗边侧光，米色针织衫">${esc(d.text || '')}</textarea>
      <div class="bd-ctrl">
        <select data-field="outfit"><option value="keep" ${d.outfit !== 'change' ? 'selected' : ''}>保留原衣服</option><option value="change" ${d.outfit === 'change' ? 'selected' : ''}>换衣服</option></select>
        <select data-field="count">${[1, 2, 3, 4].map(k => `<option value="${k}" ${Number(d.count || 2) === k ? 'selected' : ''}>${k} 张</option>`).join('')}</select>
        <button data-act="run" class="bd-run" ${m.k === 'none' ? 'disabled' : ''}>运行 ▶</button>
      </div>
      ${d.outfit === 'change' ? `<input data-field="outfitText" placeholder="英文描述衣服，例如 a cream knit cardigan" value="${esc(d.outfitText || '')}">` : ''}
      ${statusLine(n)}${historyNav(n)}${resultsHtml(n, [['send-relight', '打光'], ['send-live', '实况'], ['send-replica', '再复刻']])}`;
  }
  if (n.type === 'relight') return `
      ${slotHtml(n, 'src', val(n, 'src'), '拖入要打光的图', true)}
      <div class="bd-ctrl"><select data-field="light">${Object.entries(S().state.meta.lights).map(([k, v]) => `<option value="${k}" ${k === (d.light || 'scene_match') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <button data-act="run" class="bd-run" ${val(n, 'src') ? '' : 'disabled'}>运行 ▶</button></div>
      ${statusLine(n)}${historyNav(n)}${resultsHtml(n, [['send-live', '实况'], ['send-replica', '再复刻']])}`;
  if (n.type === 'live') {
    const outs = (jobOf(n)?.outputs || []).filter(o => o.live);
    return `
      ${slotHtml(n, 'src', val(n, 'src'), '拖入要动起来的图', true)}
      <div class="bd-ctrl"><select data-field="preset">${Object.entries(S().state.meta.livePresets || {}).map(([k, v]) => `<option value="${k}" ${k === (d.preset || 'breeze') ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
        <button data-act="run" class="bd-run" ${val(n, 'src') ? '' : 'disabled'}>运行 ▶</button></div>
      ${statusLine(n)}${historyNav(n)}${outs.map(o => `<video src="${fileUrl(o.file)}" poster="${fileUrl(o.poster || o.file)}" autoplay loop muted playsinline class="bd-video"></video>`).join('')}`;
  }
  // v1 nodes
  if (n.type === 'image') return d.file ? `<img class="bd-thumb" src="${fileUrl(d.file)}" data-zoom="${esc(d.file)}">` : '';
  if (n.type === 'model') return `<select data-field="faceId">${p.faces.map(f => `<option value="${f.id}" ${f.id === d.faceId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
  if (n.type === 'prompt') return `<textarea data-field="text" rows="3">${esc(d.text || '')}</textarea>`;
  return '';
}
function portsHtml(n) {
  const t = TYPES[n.type];
  // in-ports are invisible anchors on the card's left edge (wires from v1 boards still attach there); out-port is a visible dot
  const ins = t.ins.map(([id, , type]) => `<span class="bd-port in anchor" data-node="${n.id}" data-port="${id}" data-type="${type}"></span>`).join('');
  const outs = t.outs.map(([id, label, type]) => `<span class="bd-port out" data-node="${n.id}" data-port="${id}" data-type="${type}" title="拖出连线：${esc(label)}"></span>`).join('');
  return ins + outs;
}
function nodeHtml(n) {
  const num = board.nodes.filter(x => x.type === n.type).indexOf(n) + 1;
  return `<div class="bd-node t-${n.type} ${selected === n.id ? 'sel' : ''}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${CARD_W[n.type]}px">
    ${portsHtml(n)}
    <div class="bd-head"><b>${TYPES[n.type].title}</b><span class="bd-num">${String(num).padStart(2, '0')}</span><span class="grow"></span><button class="bd-x" data-act="dup" title="复制这张卡（Ctrl+D）">⧉</button><button class="bd-x" data-act="del" title="删除（Delete）">×</button></div>
    <div class="bd-body">${bodyHtml(n)}</div></div>`;
}
function applyView() { world().style.transform = `translate(${board.view.x}px, ${board.view.y}px) scale(${board.view.k})`; }
function render() {
  world().querySelectorAll('.bd-node').forEach(el => el.remove());
  world().insertAdjacentHTML('beforeend', board.nodes.map(nodeHtml).join(''));
  applyView();
  emptyState();
  setTimeout(() => drawWires(), 30);
}
function refreshNode(n) {
  const el = world().querySelector(`.bd-node[data-id="${n.id}"] .bd-body`);
  if (el) el.innerHTML = bodyHtml(n);
  setTimeout(() => drawWires(), 30);
}
function refreshDownstream(n) { board.edges.filter(e => e.from.node === n.id).forEach(e => { const t = nodeById(e.to.node); if (t) refreshNode(t); }); }
function emptyState() {
  const el = $('#bdEmpty');
  el.hidden = board.nodes.length > 0;
  if (!el.hidden) el.innerHTML = `<div><b>从一张复刻卡开始</b><p>新建一张卡片，把左边的参考图拖进虚线框，选好模特，点运行。<br>出来的结果可以一键接着打光、做实况，或者再复刻一次。</p><button data-add="replica" class="bd-run">＋ 新建复刻卡</button></div>`;
}
function portCenter(nodeId, port, dir) {
  const el = world().querySelector(`.bd-port.${dir}[data-node="${nodeId}"][data-port="${port}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect(), c = canvas().getBoundingClientRect(), k = board.view.k;
  return { x: (r.left + r.width / 2 - c.left - board.view.x) / k, y: (r.top + r.height / 2 - c.top - board.view.y) / k };
}
const curve = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; };
function drawWires(temp) {
  const paths = board.edges.map(e => {
    const a = portCenter(e.from.node, e.from.port, 'out'), b = portCenter(e.to.node, e.to.port, 'in');
    return a && b ? `<path class="bd-wire" data-edge="${e.id}" d="${curve(a, b)}"/>` : '';
  });
  if (temp && temp.a && temp.b) paths.push(`<path class="bd-wire temp" d="${curve(temp.a, temp.b)}"/>`);
  wires().innerHTML = paths.join('');
}

// ---- assets drawer -------------------------------------------------------------
function renderAssets() {
  const p = proj();
  let items = [];
  if (assetSrc === 'outputs') items = p.jobs.slice().reverse().flatMap(j => j.outputs.filter(o => !o.live).map(o => ({ kind: 'file', file: o.file, thumb: o.final || o.file })));
  if (assetSrc === 'refs') items = p.cases.flatMap(c => c.images.map(f => ({ kind: 'file', file: f, thumb: f })));
  if (assetSrc === 'faces') items = p.faces.map(f => ({ kind: 'face', faceId: f.id, thumb: f.file, name: f.name }));
  $('#bdAssetList').innerHTML = items.slice(0, 160).map(it => `<img draggable="true" src="${fileUrl(it.thumb)}" loading="lazy" data-asset='${esc(JSON.stringify(it))}' title="${esc(it.name || '拖进卡片')}">`).join('') || '<p class="hint">这里还没有图。</p>';
}

// ---- placement ------------------------------------------------------------------
function rectOf(n) {
  const el = world().querySelector(`.bd-node[data-id="${n.id}"]`);
  return { x: n.x, y: n.y, w: el ? el.offsetWidth : CARD_W[n.type], h: el ? el.offsetHeight : 300 };
}
const overlaps = (a, b) => a.x < b.x + b.w + 16 && b.x < a.x + a.w + 16 && a.y < b.y + b.h + 16 && b.y < a.y + a.h + 16;
// nudge a new card down (then to the next column) until it overlaps nothing
function placeFree(n) {
  const others = board.nodes.filter(x => x !== n).map(rectOf);
  const me = rectOf(n);
  for (let i = 0; i < 80 && others.some(o => overlaps(me, o)); i++) {
    me.y += 40;
    if (i % 20 === 19) { me.x += me.w + GAP; me.y = n.y; }
  }
  n.x = Math.round(me.x); n.y = Math.round(me.y);
  const el = world().querySelector(`.bd-node[data-id="${n.id}"]`);
  if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
}
function addNode(type, x, y, data = {}) {
  checkpoint();
  const defaults = { replica: { outfit: 'keep', count: 2, faceId: proj().faces[0]?.id || '', refs: [] }, relight: { light: 'scene_match' }, live: { preset: 'breeze' } };
  const n = { id: uid('n'), type, x: Math.round(x), y: Math.round(y), data: { ...(defaults[type] || {}), ...data } };
  board.nodes.push(n);
  selected = n.id;
  render();
  placeFree(n);
  setTimeout(() => drawWires(), 30);
  save();
  return n;
}
function visibleSpot() {
  const c = canvas().getBoundingClientRect();
  return canvasPoint(c.left + 60, c.top + 40);
}
// columns: v1 inputs | replica cards | follow-ups (each chain kept on its own row band)
function tidy() {
  checkpoint();
  const cols = { 0: [], 1: [], 2: [] };
  const followers = new Set(board.edges.map(e => e.to.node));
  for (const n of board.nodes) {
    if (['image', 'model', 'prompt'].includes(n.type)) cols[0].push(n);
    else if (n.type === 'replica' && !followers.has(n.id)) cols[1].push(n);
    else cols[2].push(n);
  }
  const x = { 0: 0, 1: cols[0].length ? 260 : 0 };
  x[2] = x[1] + 330 + GAP;
  for (const c of [0, 1, 2]) {
    let y = 0;
    for (const n of cols[c].sort((a, b) => a.y - b.y)) { n.x = x[c]; n.y = y; y += rectOf(n).h + 24; }
  }
  render(); save(); setTimeout(fit, 60);
}
function canvasPoint(clientX, clientY) {
  const c = canvas().getBoundingClientRect();
  return { x: (clientX - c.left - board.view.x) / board.view.k, y: (clientY - c.top - board.view.y) / board.view.k };
}
function link(from, toNode, port) {
  board.edges.push({ id: uid('e'), from: { node: from.id, port: 'img' }, to: { node: toNode.id, port } });
}
// one click from a result: new card to the right, already filled and linked
function sendOn(n, file, type) {
  const r = rectOf(n);
  const data = type === 'replica' ? { scene: file } : { src: file };
  const m = addNode(type, r.x + r.w + GAP, r.y, data);
  if (type !== 'replica') { link(n, m, 'src'); }
  n.data.pick = file;
  refreshNode(n); setTimeout(() => drawWires(), 40); save();
  return m;
}

// ---- slots ----------------------------------------------------------------------------
function setSlot(n, slot, asset) {
  checkpoint();
  if (slot === 'face') { if (asset.kind === 'face') n.data.faceId = asset.faceId; else return S().toast('模特框只能放「模特」里的照片', true); }
  else if (asset.kind !== 'file') return S().toast('这里要放图片，不是模特', true);
  else if (slot === 'scene') n.data.scene = asset.file;
  else if (slot === 'src') n.data.src = asset.file;
  else if (slot.startsWith('ref')) { const refs = n.data.refs || []; refs[Number(slot.slice(3))] = asset.file; n.data.refs = refs; }
  refreshNode(n); save();
}
function clearSlot(n, slot) {
  checkpoint();
  if (slot === 'scene') n.data.scene = null;
  else if (slot === 'src') n.data.src = null;
  else if (slot.startsWith('ref')) { const refs = n.data.refs || []; refs[Number(slot.slice(3))] = null; n.data.refs = refs; }
  refreshNode(n); save();
}
async function assetFromDrop(e) {
  const raw = e.dataTransfer.getData('application/x-studio');
  if (raw) return [JSON.parse(raw)];
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  const out = [];
  for (const f of files) {
    const r = await S().api('POST', `/api/projects/${proj().id}/upload`, { dataUrl: await S().readFile(f) });
    out.push({ kind: 'file', file: r.file });
  }
  if (files.length) { S().state.p = await S().api('GET', `/api/projects/${proj().id}`); renderAssets(); }
  return out;
}

// ---- running ---------------------------------------------------------------------------
const genSettings = () => ({ model: $('#model')?.value, post: $('#post')?.value, smartLight: $('#smartLight') ? $('#smartLight').checked : true });
async function run(n) {
  const api = S().api, p = proj();
  let job;
  if (n.type === 'replica') {
    const scene = val(n, 'scene'), face = val(n, 'face'), refs = val(n, 'refs'), text = val(n, 'text'), count = Number(n.data.count || 2);
    if (scene && face) {
      if (n.data.outfit === 'change' && !(n.data.outfitText || '').trim()) return S().toast('选了换衣服就要写衣服', true);
      job = await api('POST', `/api/projects/${p.id}/replica`, { source: scene, faceId: face, outfitMode: n.data.outfit || 'keep', outfit: n.data.outfitText || '', extra: text, count, ...genSettings() });
    } else if (text) {
      job = await api('POST', `/api/projects/${p.id}/generate`, { prompt: text, moodboard: [...(scene ? [scene] : []), ...refs].slice(0, 3), faceId: face || null, count, aspect: '3:4', ...genSettings() });
    } else return S().toast('先拖一张场景图并选模特，或者写提示词', true);
  } else if (n.type === 'relight') {
    job = await api('POST', `/api/projects/${p.id}/relight`, { source: val(n, 'src'), light: n.data.light || 'scene_match', strength: 'normal', count: 1, ...genSettings() });
  } else if (n.type === 'live') {
    job = await api('POST', `/api/projects/${p.id}/live`, { source: val(n, 'src'), preset: n.data.preset || 'breeze', seconds: 3, count: 1, mode: 'video' });
  }
  if (!job) return;
  checkpoint();
  historyOf(n).push(job.id); n.data.jobId = job.id; n.data.pick = null;
  S().state.p = await api('GET', `/api/projects/${p.id}`);
  refreshNode(n); save(); watch();
  S().toast('已提交');
}
function watch() {
  clearTimeout(pollTimer);
  const busy = id => ['queued', 'running'].includes(proj().jobs.find(j => j.id === id)?.status);
  if (!board.nodes.some(n => historyOf(n).some(busy))) return;
  pollTimer = setTimeout(async () => {
    if (!proj()) return;
    S().state.p = await S().api('GET', `/api/projects/${proj().id}`);
    board.nodes.filter(n => n.data.jobId).forEach(refreshNode);
    renderAssets(); watch();
  }, 4000);
}

// ---- interactions ----------------------------------------------------------------------------
let drag = null;
function select(id) {
  selected = id;
  world().querySelectorAll('.bd-node').forEach(el => el.classList.toggle('sel', el.dataset.id === id));
}
function onPointerDown(e) {
  const port = e.target.closest('.bd-port.out');
  if (port) { e.preventDefault(); drag = { kind: 'wire', from: { node: port.dataset.node, port: port.dataset.port }, a: portCenter(port.dataset.node, port.dataset.port, 'out') }; return; }
  const nodeEl = e.target.closest('.bd-node');
  if (nodeEl) select(nodeEl.dataset.id);
  const head = e.target.closest('.bd-head');
  if (head && !e.target.closest('button')) {
    const n = nodeById(head.parentElement.dataset.id);
    drag = { kind: 'node', n, sx: e.clientX, sy: e.clientY, x0: n.x, y0: n.y, before: snap() };
    return;
  }
  if (!nodeEl && (e.target === canvas() || e.target === world() || e.target === wires())) {
    select(null);
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, x0: board.view.x, y0: board.view.y };
    canvas().classList.add('panning');
  }
}
function onPointerMove(e) {
  if (!drag) return;
  if (drag.kind === 'pan') { board.view.x = drag.x0 + e.clientX - drag.sx; board.view.y = drag.y0 + e.clientY - drag.sy; applyView(); }
  if (drag.kind === 'node') {
    drag.n.x = Math.round(drag.x0 + (e.clientX - drag.sx) / board.view.k);
    drag.n.y = Math.round(drag.y0 + (e.clientY - drag.sy) / board.view.k);
    const el = world().querySelector(`.bd-node[data-id="${drag.n.id}"]`);
    el.style.left = drag.n.x + 'px'; el.style.top = drag.n.y + 'px';
    drawWires();
  }
  if (drag.kind === 'wire') drawWires({ a: drag.a, b: canvasPoint(e.clientX, e.clientY) });
}
function onPointerUp(e) {
  if (!drag) return;
  if (drag.kind === 'wire') {
    // drop a wire anywhere on a card: it feeds that card's main image slot
    const nodeEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bd-node');
    const to = nodeEl && nodeById(nodeEl.dataset.id);
    if (to && to.id !== drag.from.node) {
      const port = to.type === 'replica' ? 'scene' : TYPES[to.type].ins[0]?.[0];
      const fromType = TYPES[nodeById(drag.from.node).type].outs.find(o => o[0] === drag.from.port)?.[2];
      const spec = TYPES[to.type].ins.find(i => i[0] === port);
      if (port && spec && spec[2] === fromType) {
        checkpoint();
        board.edges = board.edges.filter(x => !(x.to.node === to.id && x.to.port === port));
        board.edges.push({ id: uid('e'), from: drag.from, to: { node: to.id, port } });
        refreshNode(to); save();
      } else if (port) S().toast('这两张卡接不上', true);
    }
    drawWires();
  }
  if (drag.kind === 'node' && (drag.n.x !== drag.x0 || drag.n.y !== drag.y0)) { undoStack.push(drag.before); redoStack.length = 0; updateUndoButtons(); }
  if (drag.kind === 'node' || drag.kind === 'pan') save();
  canvas().classList.remove('panning');
  drag = null;
}
function onWheel(e) {
  if (e.target.closest('textarea, select')) return;
  e.preventDefault();
  const c = canvas().getBoundingClientRect();
  const k0 = board.view.k, k = Math.min(1.6, Math.max(0.35, k0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  const mx = e.clientX - c.left, my = e.clientY - c.top;
  board.view.x = mx - (mx - board.view.x) * (k / k0);
  board.view.y = my - (my - board.view.y) * (k / k0);
  board.view.k = k;
  applyView(); drawWires(); save();
}
async function onDrop(e) {
  e.preventDefault();
  canvas().querySelectorAll('.bd-slot.over').forEach(s => s.classList.remove('over'));
  const slotEl = e.target.closest('.bd-slot');
  const assets = await assetFromDrop(e);
  if (!assets.length) return;
  if (slotEl) {
    const n = nodeById(slotEl.closest('.bd-node').dataset.id);
    let slot = slotEl.dataset.slot;
    for (const a of assets) { setSlot(n, slot, a); if (slot.startsWith('ref')) slot = 'ref' + Math.min(2, Number(slot.slice(3)) + 1); }
    return;
  }
  // dropped on empty canvas: start a new card with it
  const pt = canvasPoint(e.clientX, e.clientY);
  for (const [i, a] of assets.entries()) addNode('replica', pt.x + i * 24, pt.y + i * 24, a.kind === 'face' ? { faceId: a.faceId } : { scene: a.file });
}
function fit() {
  if (!board.nodes.length) { board.view = { x: 40, y: 40, k: 1 }; applyView(); drawWires(); return; }
  const c = canvas().getBoundingClientRect();
  const rs = board.nodes.map(rectOf);
  const minX = Math.min(...rs.map(r => r.x)), minY = Math.min(...rs.map(r => r.y));
  const maxX = Math.max(...rs.map(r => r.x + r.w)), maxY = Math.max(...rs.map(r => r.y + r.h));
  const k = Math.min(1, Math.max(0.35, Math.min((c.width - 60) / (maxX - minX), (c.height - 60) / (maxY - minY))));
  board.view = { k, x: 30 - minX * k, y: 30 - minY * k };
  applyView(); drawWires(); save();
}
function anyVisible() {
  const c = canvas().getBoundingClientRect();
  return [...world().querySelectorAll('.bd-node')].some(el => { const r = el.getBoundingClientRect(); return r.right > c.left + 40 && r.left < c.right - 40 && r.bottom > c.top + 40 && r.top < c.bottom - 40; });
}
// a fresh copy of a card: same images, model, prompt and settings, no results; incoming wires are copied too
function duplicate(n) {
  checkpoint();
  const data = JSON.parse(JSON.stringify(n.data));
  delete data.jobId; delete data.jobIds; delete data.pick;
  const r = rectOf(n);
  const m = { id: uid('n'), type: n.type, x: r.x + 36, y: r.y + 36, data };
  board.nodes.push(m);
  for (const e of board.edges.filter(x => x.to.node === n.id)) board.edges.push({ id: uid('e'), from: e.from, to: { node: m.id, port: e.to.port } });
  selected = m.id;
  render(); placeFree(m); setTimeout(() => drawWires(), 30); save();
  S().toast('已复制，改一处再运行就能对比');
}
function deleteNode(n) {
  checkpoint();
  board.nodes = board.nodes.filter(x => x !== n);
  board.edges = board.edges.filter(x => x.from.node !== n.id && x.to.node !== n.id);
  if (selected === n.id) selected = null;
  render(); save();
}

function bindOnce() {
  if (bindOnce.done) return;
  bindOnce.done = true;
  const cv = canvas();
  cv.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dragover', e => { e.preventDefault(); const s = e.target.closest('.bd-slot'); cv.querySelectorAll('.bd-slot.over').forEach(x => x !== s && x.classList.remove('over')); if (s) s.classList.add('over'); });
  cv.addEventListener('drop', onDrop);
  const dragAsset = e => { const d = e.target.dataset.asset; if (d) { e.dataTransfer.setData('application/x-studio', d); e.dataTransfer.effectAllowed = 'copy'; } };
  $('#bdAssetList').addEventListener('dragstart', dragAsset);
  cv.addEventListener('dragstart', dragAsset);
  document.querySelector('#bdAssets .bd-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    assetSrc = b.dataset.src;
    document.querySelectorAll('#bdAssets .bd-tabs button').forEach(x => x.classList.toggle('active', x === b));
    renderAssets();
  });
  const onAdd = type => { const pt = visibleSpot(); addNode(type, pt.x, pt.y); };
  $('#bdBar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'fit') return fit();
    if (b.dataset.act === 'tidy') return tidy();
    if (b.dataset.act === 'undo') return undo();
    if (b.dataset.act === 'redo') return redo();
    if (b.dataset.add) onAdd(b.dataset.add);
  });
  $('#bdEmpty').addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) onAdd(b.dataset.add); });
  cv.addEventListener('click', async e => {
    const wire = e.target.closest('.bd-wire');
    if (wire && !wire.classList.contains('temp')) {
      checkpoint();
      const edge = board.edges.find(x => x.id === wire.dataset.edge);
      board.edges = board.edges.filter(x => x !== edge);
      drawWires(); const t = nodeById(edge.to.node); if (t) refreshNode(t); save();
      return;
    }
    const nodeEl = e.target.closest('.bd-node'); if (!nodeEl) return;
    const n = nodeById(nodeEl.dataset.id);
    const act = e.target.dataset.act;
    if (act === 'del') deleteNode(n);
    else if (act === 'dup') duplicate(n);
    else if (act === 'hist') { const h = historyOf(n); const i = h.indexOf(n.data.jobId) + Number(e.target.dataset.dir); if (h[i]) { n.data.jobId = h[i]; refreshNode(n); save(); } }
    else if (act === 'clear') clearSlot(n, e.target.dataset.slot);
    else if (act === 'run') { e.target.disabled = true; try { await run(n); } finally { e.target.disabled = false; } }
    else if (act === 'send-relight') sendOn(n, e.target.dataset.file, 'relight');
    else if (act === 'send-live') sendOn(n, e.target.dataset.file, 'live');
    else if (act === 'send-replica') sendOn(n, e.target.dataset.file, 'replica');
    else if (e.target.dataset.pick) { n.data.pick = e.target.dataset.pick; refreshNode(n); refreshDownstream(n); save(); }
  });
  cv.addEventListener('dblclick', e => {
    const f = e.target.dataset.pick || e.target.dataset.zoom;
    if (f) S().openModal(`<div class="zoom"><img src="${fileUrl(f)}"></div>`);
  });
  let typing = null, typingT = null;
  cv.addEventListener('input', e => {
    const nodeEl = e.target.closest('.bd-node'), field = e.target.dataset.field;
    if (!nodeEl || !field || e.target.tagName === 'SELECT') return;
    const n = nodeById(nodeEl.dataset.id);
    if (typing !== e.target) { checkpoint(); typing = e.target; }
    clearTimeout(typingT); typingT = setTimeout(() => { typing = null; }, 1500);
    n.data[field] = e.target.value;
    if (field === 'text') { const h = nodeEl.querySelector('.bd-mode'); const m = modeOf(n); if (h) { h.className = 'bd-mode ' + m.k; h.innerHTML = `<b>${m.label}</b><span>${m.tip}</span>`; } const r = nodeEl.querySelector('[data-act=run]'); if (r) r.disabled = m.k === 'none'; refreshDownstream(n); }
    save();
  });
  cv.addEventListener('change', e => {
    const nodeEl = e.target.closest('.bd-node'), field = e.target.dataset.field;
    if (!nodeEl || !field) return;
    const n = nodeById(nodeEl.dataset.id);
    if (e.target.tagName === 'SELECT') checkpoint();
    n.data[field] = e.target.value;
    if (['outfit', 'faceId'].includes(field)) refreshNode(n);
    save();
  });
  // shortcuts on the whole window while the workbench tab is open; never while typing
  window.addEventListener('keydown', e => {
    if ($('#tab-board')?.hidden || !$('#modal')?.hidden) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && key === 'd') { e.preventDefault(); const n = nodeById(selected); if (n) duplicate(n); else S().toast('先点一下要复制的卡片'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { const n = nodeById(selected); if (n) deleteNode(n); }
  });
}

window.board = {
  async open() {
    if (!proj()) return;
    bindOnce();
    if (loadedFor !== proj().id) { await load(); selected = null; }
    renderAssets();
    render();
    // never open on an empty-looking canvas when the cards are just off screen
    setTimeout(() => { if (board.nodes.length && !anyVisible()) fit(); }, 80);
    watch();
  },
};
