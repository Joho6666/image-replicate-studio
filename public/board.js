// ⑦ 工作台: a node canvas on top of the existing APIs. Drag images in, wire them into a 复刻/生成 node together with a
// model and prompt nodes, run it, then wire a result on to 打光 or 实况. The graph is saved per project (PUT /board).
// Vanilla JS, no dependencies; uses the helpers app.js exposes on window.studio.
const S = () => window.studio;
const $ = s => document.querySelector(s);
const esc = s => S().esc(s);

// port: [id, label, type, max inputs]
const TYPES = {
  image: { title: '图片', ins: [], outs: [['img', '图', 'img']] },
  model: { title: '模特', ins: [], outs: [['face', '模特', 'face']] },
  prompt: { title: '提示词', ins: [], outs: [['text', '提示词', 'text']] },
  replica: { title: '复刻 / 生成', ins: [['scene', '场景图', 'img', 1], ['face', '模特', 'face', 1], ['refs', '参考图', 'img', 3], ['text', '提示词', 'text', 9]], outs: [['img', '选中的结果', 'img']] },
  relight: { title: '打光', ins: [['src', '原图', 'img', 1]], outs: [['img', '选中的结果', 'img']] },
  live: { title: '实况', ins: [['src', '原图', 'img', 1]], outs: [] },
};

let board = { nodes: [], edges: [], view: { x: 40, y: 40, k: 1 } };
let loadedFor = null;
let assetSrc = 'outputs';
let saveTimer = null;
let pollTimer = null;
const uid = p => p + Math.random().toString(36).slice(2, 8);

const canvas = () => $('#bdCanvas');
const world = () => $('#bdWorld');
const wires = () => $('#bdWires');
const proj = () => S().state.p;
const nodeById = id => board.nodes.find(n => n.id === id);
const fileUrl = rel => S().fileUrl(rel);

// ---- persistence -------------------------------------------------------------
async function load() {
  const p = proj();
  board = await S().api('GET', `/api/projects/${p.id}/board`);
  board.view ||= { x: 40, y: 40, k: 1 };
  loadedFor = p.id;
}
function save() {
  clearTimeout(saveTimer);
  $('#bdSaved').textContent = '未保存…';
  saveTimer = setTimeout(async () => {
    const r = await S().api('PUT', `/api/projects/${proj().id}/board`, board);
    $('#bdSaved').textContent = '已保存 ' + r.savedAt.slice(11, 19);
  }, 600);
}

// ---- values flowing through wires ---------------------------------------------
function jobOf(n) { return n.data.jobId ? proj().jobs.find(j => j.id === n.data.jobId) : null; }
function resultFiles(n) { return (jobOf(n)?.outputs || []).filter(o => !o.live).map(o => o.file); }
function outValue(n) {
  if (n.type === 'image') return n.data.file;
  if (n.type === 'model') return n.data.faceId;
  if (n.type === 'prompt') return (n.data.text || '').trim();
  if (n.type === 'replica' || n.type === 'relight') return n.data.pick || resultFiles(n)[0] || null;
  return null;
}
function inputs(n, port) {
  return board.edges.filter(e => e.to.node === n.id && e.to.port === port).map(e => outValue(nodeById(e.from.node))).filter(Boolean);
}

// ---- rendering ---------------------------------------------------------------
function portHtml(n, [id, label, type], dir) {
  return `<div class="bd-port-row ${dir}"><span class="bd-port ${dir}" data-node="${n.id}" data-port="${id}" data-type="${type}" title="${esc(label)}"></span><span class="bd-port-label">${esc(label)}</span></div>`;
}
function statusLine(n) {
  const j = jobOf(n);
  if (!j) return '';
  const t = { queued: '排队中', running: '生成中…', done: '完成', partial: '部分完成', failed: '失败' }[j.status] || j.status;
  return `<div class="bd-status ${j.status}">${t}${j.errors?.length ? ' · ' + esc(j.errors[0]).slice(0, 80) : ''}</div>`;
}
function resultsHtml(n) {
  const j = jobOf(n);
  if (!j) return '';
  const outs = j.outputs.filter(o => !o.live);
  const pick = outValue(n);
  return `<div class="bd-results">${outs.map(o => `<img src="${fileUrl(o.final || o.file)}" data-pick="${esc(o.file)}" class="${o.file === pick ? 'picked' : ''}" title="单击选为输出，双击放大">`).join('')}
    ${Array.from({ length: ['queued', 'running'].includes(j.status) ? j.count - j.outputs.length : 0 }, () => '<div class="bd-wait"></div>').join('')}</div>
    ${outs.length ? '<button data-act="extract" class="bd-mini">把选中的结果拉出为图片节点</button>' : ''}`;
}
function bodyHtml(n) {
  const p = proj();
  const d = n.data;
  if (n.type === 'image') return d.file ? `<img class="bd-img" src="${fileUrl(d.file)}" data-zoom="${esc(d.file)}">` : '<div class="hint">没有图片</div>';
  if (n.type === 'model') return `<select data-field="faceId">${p.faces.map(f => `<option value="${f.id}" ${f.id === d.faceId ? 'selected' : ''}>${esc(f.name)}</option>`).join('') || '<option value="">先在「② 模特」里加模特</option>'}</select>
    ${(p.faces.find(f => f.id === d.faceId) || p.faces[0]) ? `<img class="bd-img small" src="${fileUrl((p.faces.find(f => f.id === d.faceId) || p.faces[0]).file)}">` : ''}`;
  if (n.type === 'prompt') return `<textarea data-field="text" rows="4" placeholder="写想要的效果，中英文都可以，例如：她靠在窗边，午后侧光，米色针织衫">${esc(d.text || '')}</textarea>`;
  if (n.type === 'replica') return `
    <div class="row wrap"><label class="check"><input type="radio" name="o_${n.id}" data-field="outfit" value="keep" ${d.outfit !== 'change' ? 'checked' : ''}> 保留原衣服</label>
      <label class="check"><input type="radio" name="o_${n.id}" data-field="outfit" value="change" ${d.outfit === 'change' ? 'checked' : ''}> 换衣服</label></div>
    ${d.outfit === 'change' ? `<input data-field="outfitText" placeholder="英文描述衣服" value="${esc(d.outfitText || '')}">` : ''}
    <div class="row"><label>张数 <select data-field="count">${[1, 2, 3, 4].map(k => `<option ${Number(d.count || 2) === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <button data-act="run" class="bd-run">运行</button></div>
    <div class="hint bd-mode">${modeHint(n)}</div>${statusLine(n)}${resultsHtml(n)}`;
  if (n.type === 'relight') return `<div class="row"><select data-field="light">${Object.entries(S().state.meta.lights).map(([k, v]) => `<option value="${k}" ${k === (d.light || 'scene_match') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <button data-act="run" class="bd-run">运行</button></div>${statusLine(n)}${resultsHtml(n)}`;
  if (n.type === 'live') {
    const j = jobOf(n);
    const outs = (j?.outputs || []).filter(o => o.live);
    return `<div class="row"><select data-field="preset">${Object.entries(S().state.meta.livePresets || {}).map(([k, v]) => `<option value="${k}" ${k === (d.preset || 'breeze') ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      <button data-act="run" class="bd-run">运行</button></div>${statusLine(n)}
      ${outs.map(o => `<video src="${fileUrl(o.file)}" poster="${fileUrl(o.poster)}" autoplay loop muted playsinline class="bd-img"></video>`).join('')}`;
  }
  return '';
}
function modeHint(n) {
  const scene = inputs(n, 'scene').length, face = inputs(n, 'face').length, text = inputs(n, 'text').length, refs = inputs(n, 'refs').length;
  if (scene && face) return `复刻换人：保留场景，换成模特${text ? '，加上提示词' : ''}`;
  if (text) return `生成：提示词${refs || scene ? ` + ${refs + scene} 张参考图` : ''}${face ? ' + 模特' : ''}`;
  return '接上「场景图 + 模特」做复刻，或接「提示词」做生成';
}
function nodeHtml(n) {
  const t = TYPES[n.type];
  return `<div class="bd-node t-${n.type}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px">
    <div class="bd-head"><b>${t.title}</b><span class="grow"></span><button class="bd-x" data-act="del" title="删除节点">×</button></div>
    <div class="bd-ports">
      <div class="bd-ins">${t.ins.map(pt => portHtml(n, pt, 'in')).join('')}</div>
      <div class="bd-outs">${t.outs.map(pt => portHtml(n, pt, 'out')).join('')}</div>
    </div>
    <div class="bd-body">${bodyHtml(n)}</div></div>`;
}
function applyView() { world().style.transform = `translate(${board.view.x}px, ${board.view.y}px) scale(${board.view.k})`; }
function render() {
  world().querySelectorAll('.bd-node').forEach(el => el.remove());
  world().insertAdjacentHTML('beforeend', board.nodes.map(nodeHtml).join(''));
  applyView();
  setTimeout(() => drawWires(), 30);
}
function refreshNode(n) {
  const el = world().querySelector(`.bd-node[data-id="${n.id}"] .bd-body`);
  if (el) el.innerHTML = bodyHtml(n);
  setTimeout(() => drawWires(), 30);
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
  $('#bdAssetList').innerHTML = items.slice(0, 160).map(it => `<img draggable="true" src="${fileUrl(it.thumb)}" loading="lazy" data-asset='${esc(JSON.stringify(it))}' title="${esc(it.name || it.file)}">`).join('') || '<p class="hint">这里还没有图。</p>';
}

// ---- graph edits ---------------------------------------------------------------
function addNode(type, x, y, data = {}) {
  const defaults = { replica: { outfit: 'keep', count: 2 }, relight: { light: 'scene_match' }, live: { preset: 'breeze' }, model: { faceId: proj().faces[0]?.id || '' }, prompt: { text: '' } };
  const n = { id: uid('n'), type, x: Math.round(x), y: Math.round(y), data: { ...(defaults[type] || {}), ...data } };
  board.nodes.push(n);
  render(); save();
  return n;
}
function canvasPoint(clientX, clientY) {
  const c = canvas().getBoundingClientRect();
  return { x: (clientX - c.left - board.view.x) / board.view.k, y: (clientY - c.top - board.view.y) / board.view.k };
}
function connect(from, to) {
  const target = nodeById(to.node);
  const spec = TYPES[target.type].ins.find(i => i[0] === to.port);
  const fromSpec = TYPES[nodeById(from.node).type].outs.find(o => o[0] === from.port);
  if (!spec || !fromSpec) return;
  if (spec[2] !== fromSpec[2]) return S().toast(`「${fromSpec[1]}」不能接到「${spec[1]}」`, true);
  if (from.node === to.node) return;
  if (board.edges.some(e => e.from.node === from.node && e.to.node === to.node && e.to.port === to.port)) return;
  const existing = board.edges.filter(e => e.to.node === to.node && e.to.port === to.port);
  if (existing.length >= spec[3]) board.edges = board.edges.filter(e => e !== existing[0]); // replace the oldest
  board.edges.push({ id: uid('e'), from, to });
  refreshNode(target); save();
}

// ---- running nodes ---------------------------------------------------------------
function genSettings() {
  return { model: $('#model')?.value, post: $('#post')?.value, smartLight: $('#smartLight') ? $('#smartLight').checked : true };
}
async function run(n) {
  const api = S().api, p = proj();
  let job;
  if (n.type === 'replica') {
    const scene = inputs(n, 'scene')[0], face = inputs(n, 'face')[0], refs = inputs(n, 'refs'), text = inputs(n, 'text').join('\n');
    const count = Number(n.data.count || 2);
    if (scene && face) {
      if (n.data.outfit === 'change' && !(n.data.outfitText || '').trim()) return S().toast('选了换衣服就要写衣服', true);
      job = await api('POST', `/api/projects/${p.id}/replica`, { source: scene, faceId: face, outfitMode: n.data.outfit || 'keep', outfit: n.data.outfitText || '', extra: text, count, ...genSettings() });
    } else if (text) {
      job = await api('POST', `/api/projects/${p.id}/generate`, { prompt: text, moodboard: [...(scene ? [scene] : []), ...refs].slice(0, 3), faceId: face || null, count, aspect: '3:4', ...genSettings() });
    } else return S().toast('先接上「场景图 + 模特」，或者接一个「提示词」', true);
  } else if (n.type === 'relight') {
    const src = inputs(n, 'src')[0];
    if (!src) return S().toast('先把一张图接到「原图」', true);
    job = await api('POST', `/api/projects/${p.id}/relight`, { source: src, light: n.data.light || 'scene_match', strength: 'normal', count: 1, ...genSettings() });
  } else if (n.type === 'live') {
    const src = inputs(n, 'src')[0];
    if (!src) return S().toast('先把一张图接到「原图」', true);
    job = await api('POST', `/api/projects/${p.id}/live`, { source: src, preset: n.data.preset || 'breeze', seconds: 3, count: 1 });
  }
  if (!job) return;
  n.data.jobId = job.id; n.data.pick = null;
  S().state.p = await api('GET', `/api/projects/${p.id}`);
  refreshNode(n); save(); watch();
  S().toast('已提交');
}
function watch() {
  clearTimeout(pollTimer);
  const busy = () => board.nodes.some(n => ['queued', 'running'].includes(jobOf(n)?.status));
  if (!busy()) return;
  pollTimer = setTimeout(async () => {
    if (!proj()) return;
    S().state.p = await S().api('GET', `/api/projects/${proj().id}`);
    board.nodes.filter(n => n.data.jobId).forEach(refreshNode);
    renderAssets();
    watch();
  }, 4000);
}

// ---- interactions ----------------------------------------------------------------
let drag = null;
function onPointerDown(e) {
  const port = e.target.closest('.bd-port.out');
  if (port) {
    e.preventDefault();
    drag = { kind: 'wire', from: { node: port.dataset.node, port: port.dataset.port }, a: portCenter(port.dataset.node, port.dataset.port, 'out') };
    return;
  }
  const head = e.target.closest('.bd-head');
  if (head && !e.target.closest('button')) {
    const n = nodeById(head.parentElement.dataset.id);
    drag = { kind: 'node', n, sx: e.clientX, sy: e.clientY, x0: n.x, y0: n.y };
    return;
  }
  if (e.target === canvas() || e.target === world() || e.target === wires()) {
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
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bd-port.in');
    if (target) connect(drag.from, { node: target.dataset.node, port: target.dataset.port });
    drawWires();
  }
  if (drag.kind === 'node' || drag.kind === 'pan') save();
  canvas().classList.remove('panning');
  drag = null;
}
function onWheel(e) {
  e.preventDefault();
  const c = canvas().getBoundingClientRect();
  const k0 = board.view.k, k = Math.min(1.8, Math.max(0.35, k0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  const mx = e.clientX - c.left, my = e.clientY - c.top;
  board.view.x = mx - (mx - board.view.x) * (k / k0);
  board.view.y = my - (my - board.view.y) * (k / k0);
  board.view.k = k;
  applyView(); drawWires(); save();
}
async function onDrop(e) {
  e.preventDefault();
  const pt = canvasPoint(e.clientX, e.clientY);
  const raw = e.dataTransfer.getData('application/x-studio');
  if (raw) {
    const it = JSON.parse(raw);
    if (it.kind === 'face') addNode('model', pt.x, pt.y, { faceId: it.faceId });
    else addNode('image', pt.x, pt.y, { file: it.file });
    return;
  }
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  for (const [i, f] of files.entries()) {
    const r = await S().api('POST', `/api/projects/${proj().id}/upload`, { dataUrl: await S().readFile(f) });
    addNode('image', pt.x + i * 30, pt.y + i * 30, { file: r.file });
  }
  if (files.length) { S().state.p = await S().api('GET', `/api/projects/${proj().id}`); renderAssets(); }
}
function fit() {
  if (!board.nodes.length) { board.view = { x: 40, y: 40, k: 1 }; applyView(); drawWires(); return; }
  const c = canvas().getBoundingClientRect();
  const xs = board.nodes.map(n => n.x), ys = board.nodes.map(n => n.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs) + 280, maxY = Math.max(...ys) + 360;
  const k = Math.min(1.2, Math.max(0.35, Math.min(c.width / (maxX - minX + 80), c.height / (maxY - minY + 80))));
  board.view = { k, x: 40 - minX * k, y: 40 - minY * k };
  applyView(); drawWires(); save();
}

function bindOnce() {
  if (bindOnce.done) return;
  bindOnce.done = true;
  const cv = canvas();
  cv.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dragover', e => e.preventDefault());
  cv.addEventListener('drop', onDrop);
  $('#bdAssetList').addEventListener('dragstart', e => { const d = e.target.dataset.asset; if (d) e.dataTransfer.setData('application/x-studio', d); });
  document.querySelector('#bdAssets .bd-tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    assetSrc = b.dataset.src;
    document.querySelectorAll('#bdAssets .bd-tabs button').forEach(x => x.classList.toggle('active', x === b));
    renderAssets();
  });
  $('#bdBar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'fit') return fit();
    const c = cv.getBoundingClientRect();
    const pt = canvasPoint(c.left + c.width / 2 - 120, c.top + 60 + (board.nodes.length % 6) * 24);
    if (b.dataset.add) addNode(b.dataset.add, pt.x, pt.y);
  });
  cv.addEventListener('click', async e => {
    const wire = e.target.closest('.bd-wire');
    if (wire && !wire.classList.contains('temp')) {
      const edge = board.edges.find(x => x.id === wire.dataset.edge);
      board.edges = board.edges.filter(x => x !== edge);
      drawWires(); refreshNode(nodeById(edge.to.node)); save();
      return;
    }
    const nodeEl = e.target.closest('.bd-node'); if (!nodeEl) return;
    const n = nodeById(nodeEl.dataset.id);
    const act = e.target.dataset.act;
    if (act === 'del') {
      board.nodes = board.nodes.filter(x => x !== n);
      board.edges = board.edges.filter(x => x.from.node !== n.id && x.to.node !== n.id);
      render(); save();
    } else if (act === 'run') { e.target.disabled = true; try { await run(n); } finally { e.target.disabled = false; } }
    else if (act === 'extract') { const f = outValue(n); if (f) addNode('image', n.x + (n.type === 'replica' ? 340 : 300), n.y, { file: f }); }
    else if (e.target.dataset.pick) { n.data.pick = e.target.dataset.pick; refreshNode(n); board.edges.filter(x => x.from.node === n.id).forEach(x => refreshNode(nodeById(x.to.node))); save(); }
  });
  cv.addEventListener('dblclick', e => {
    const f = e.target.dataset.pick || e.target.dataset.zoom;
    if (f) S().openModal(`<div class="zoom"><img src="${fileUrl(f)}"></div>`);
  });
  cv.addEventListener('input', e => {
    const nodeEl = e.target.closest('.bd-node'); const field = e.target.dataset.field;
    if (!nodeEl || !field) return;
    const n = nodeById(nodeEl.dataset.id);
    n.data[field] = e.target.value;
    if (field === 'text') board.edges.filter(x => x.from.node === n.id).forEach(x => { const t = nodeById(x.to.node); const h = world().querySelector(`.bd-node[data-id="${t.id}"] .bd-mode`); if (h) h.textContent = modeHint(t); });
    save();
  });
  cv.addEventListener('change', e => {
    const nodeEl = e.target.closest('.bd-node'); const field = e.target.dataset.field;
    if (!nodeEl || !field) return;
    const n = nodeById(nodeEl.dataset.id);
    n.data[field] = e.target.value;
    if (field === 'outfit' || field === 'faceId') refreshNode(n);
    save();
  });
}

window.board = {
  async open() {
    if (!proj()) return;
    bindOnce();
    if (loadedFor !== proj().id) await load();
    renderAssets();
    render();
    watch();
  },
};
