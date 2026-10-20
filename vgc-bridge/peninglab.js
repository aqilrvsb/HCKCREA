/* PeningLab bridge — loaded into the VGC Prompt Vault at /vgc (Motion → Custom Style).
   The vault's files (Coach Am) stay exactly as they are; this shows only its Fast
   Track flow and adds what its "copy, paste into Claude Code" step needs to run
   directly in PeningLab:
   - 📎 Bahan: the client's images / logo / footage / voice-over, uploaded here
   - 🎙️ Voice-over AI: one of PeningLab's voices (Mira, Afifah…) — Claude Code
     writes the VO and voices it with `pl-tts` during the run
   - 🎬 Jana Video / ✨ Jana Jawapan: POST /api/vgc/start with the filled prompt
   - Idea Clarity / Reference: later steps continue the same project card
     (same Claude Code session), like staying in one chat. */
(() => {
  'use strict';
  // Fast Track only (the owner's call, 2026-10-20): Custom Style opens straight on
  // Fast Track; every other flow and page of the vault is hidden (peninglab.css)
  // and any navigation to one lands back on Fast Track.
  const ONLY = 'fast-track';
  const lockRoute = () => { if (location.hash.slice(1) !== ONLY) location.replace('#' + ONLY); };
  lockRoute();
  window.addEventListener('hashchange', lockRoute);
  const params = new URLSearchParams(location.search);
  const projectId = params.get('p') || '';
  const CARD_KEY = 'pl-vgc-cards:' + projectId;
  let cards = {};
  try { cards = JSON.parse(sessionStorage.getItem(CARD_KEY) || '{}') || {}; } catch { cards = {}; }
  const saveCards = () => { try { sessionStorage.setItem(CARD_KEY, JSON.stringify(cards)); } catch { /* private mode */ } };
  const mats = []; // { name, url, kind, size }
  let uploading = 0;
  let busy = false;
  let pricing = null;
  let voices = [];
  let voice = '';
  try { voice = localStorage.getItem('pl-vgc-voice') || ''; } catch { /* private mode */ }

  const say = (m) => (typeof notify === 'function' ? notify(m) : alert(m));
  // `current` is app.js's top-level let (same global scope, not a window property)
  const cur = () => { try { return current; } catch { return null; } };
  const flowOf = (id) => (id === 'fast-track' ? 'fast' : /^step-\d$/.test(id) ? 'guided' : /^reference-\d$/.test(id) ? 'reference' : '');
  const rendersVideo = (c) => !!c && (c.id === 'fast-track' || /\b(bina\s*(v1|preview)|improve\s*v2)\b/i.test(c.title || ''));
  const isFirstStep = (c) => !!c && (c.id === 'fast-track' || c.id === 'step-1' || c.id === 'reference-1');
  const kindOf = (f) => (f.type.startsWith('image/') ? 'Gambar' : f.type.startsWith('video/') ? 'Video' : f.type.startsWith('audio/') ? 'Audio' : 'Fail');
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const refreshParent = () => {
    try { window.parent.dispatchEvent(new window.parent.CustomEvent('history:refresh')); } catch { /* not embedded */ }
  };

  fetch('/api/vgc/start').then((r) => r.json()).then((d) => {
    pricing = d?.pricing || null;
    voices = Array.isArray(d?.voices) ? d.voices : [];
    if (voice && !voices.some((v) => v.key === voice)) voice = '';
    renderVoices();
    refreshAction();
  }).catch(() => {});

  // ── 📎 Bahan ──
  function mount() {
    const footer = document.querySelector('.editor-panel .editor-footer');
    if (!footer || document.getElementById('pl-materials')) return;
    const box = document.createElement('div');
    box.id = 'pl-materials';
    box.className = 'pl-materials';
    box.innerHTML =
      '<div class="pl-mat-head"><strong>📎 Bahan untuk AI</strong><span>Gambar produk, logo, footage atau voice-over. AI terus guna fail ini — tak perlu attach di tempat lain.</span></div>' +
      '<div class="pl-mat-list" id="pl-mat-list"></div>' +
      '<label class="pl-mat-add"><input type="file" multiple accept="image/*,video/*,audio/*" id="pl-mat-input">+ Tambah bahan</label>' +
      '<div class="pl-voice"><div class="pl-mat-head"><strong>🎙️ Voice-over AI</strong><span>Tiada VO sendiri? Pilih suara — AI tulis skrip VO & jana suara terus.</span></div><div class="pl-voice-list" id="pl-voice-list"></div></div>';
    footer.before(box);
    box.querySelector('#pl-mat-input').addEventListener('change', (e) => {
      for (const f of Array.from(e.target.files || [])) void upload(f);
      e.target.value = '';
    });

    const actions = footer.querySelector('.editor-actions');
    const copy = document.getElementById('copy');
    if (actions && copy && !document.getElementById('pl-generate')) {
      copy.classList.remove('primary-button');
      copy.classList.add('quiet-button');
      const go = document.createElement('button');
      go.id = 'pl-generate';
      go.className = 'primary-button pl-generate';
      go.type = 'button';
      go.addEventListener('click', () => void generate());
      actions.append(go);
      const line = document.createElement('div');
      line.id = 'pl-run-note';
      line.className = 'pl-run-note';
      footer.after(line);
    }
    renderMaterials();
    renderVoices();
  }

  function renderVoices() {
    const list = document.getElementById('pl-voice-list');
    if (!list) return;
    const opts = [{ key: '', label: 'Tiada', gender: '' }, ...voices];
    list.innerHTML = opts.map((v) => `<button type="button" class="pl-voice-chip${v.key === voice ? ' on' : ''}" data-voice="${esc(v.key)}">${v.gender === 'f' ? '♀ ' : v.gender === 'm' ? '♂ ' : ''}${esc(v.label)}</button>`).join('');
    list.querySelectorAll('[data-voice]').forEach((b) => b.addEventListener('click', () => {
      voice = b.dataset.voice || '';
      try { localStorage.setItem('pl-vgc-voice', voice); } catch { /* private mode */ }
      renderVoices();
      refreshAction();
    }));
  }

  function renderMaterials() {
    const list = document.getElementById('pl-mat-list');
    if (!list) return;
    list.innerHTML = mats.length
      ? mats.map((m, i) => `<span class="pl-chip${m.url ? '' : ' pl-chip-busy'}" title="${esc(m.name)}"><b>${esc(m.kind)}</b> ${esc(m.name)}${m.url ? '' : ` · ${m.pct || 0}%`}${m.url ? `<button type="button" data-rm="${i}" aria-label="Buang">✕</button>` : ''}</span>`).join('')
      : '<span class="pl-mat-empty">Belum ada bahan.</span>';
    list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { mats.splice(Number(b.dataset.rm), 1); renderMaterials(); }));
  }

  async function upload(file) {
    const m = { name: file.name, kind: kindOf(file), size: file.size, url: '', pct: 0 };
    mats.push(m);
    uploading++;
    renderMaterials();
    try {
      const r = await fetch('/api/motion/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size, kind: 'vgc' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.upload_url) throw new Error(d?.error || 'Tak dapat link upload');
      m.url = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', d.upload_url);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { m.pct = Math.round((e.loaded / e.total) * 100); renderMaterials(); } };
        xhr.onload = () => { try { const j = JSON.parse(xhr.responseText || '{}'); if (xhr.status < 300 && j.url) resolve(j.url); else reject(new Error(j.error || 'Upload gagal')); } catch { reject(new Error('Upload gagal')); } };
        xhr.onerror = () => reject(new Error('Upload gagal — semak sambungan internet.'));
        xhr.send(file);
      });
    } catch (e) {
      mats.splice(mats.indexOf(m), 1);
      say(`${file.name}: ${e.message || 'gagal upload'}`);
    } finally {
      uploading--;
      renderMaterials();
      refreshAction();
    }
  }

  // ── 🎬 Jana ──
  function refreshAction() {
    const go = document.getElementById('pl-generate');
    const note = document.getElementById('pl-run-note');
    const c = cur();
    if (!go || !note || !c) return;
    const video = rendersVideo(c);
    const flow = flowOf(c.id);
    const card = flow && flow !== 'fast' && !isFirstStep(c) ? cards[flow] : null;
    go.textContent = busy ? 'Menghantar…' : video ? '🎬 Jana Video' : '✨ Jana Jawapan';
    go.disabled = busy || uploading > 0;
    const price = pricing ? (video ? pricing.video : pricing.text) : null;
    const parts = [];
    parts.push(video ? 'AI bina, render & semak (AI pengkritik) preview MP4 terus dalam PeningLab (~20–40 min).' : 'AI jawab langkah ini terus dalam PeningLab — baca jawapan dalam kad History.');
    if (price !== null) parts.push(price > 0 ? `Caj RM${price.toFixed(2)}.` : 'Percuma.');
    const vo = voices.find((v) => v.key === voice);
    if (vo) parts.push(`Voice-over AI: <b>${esc(vo.label)}</b>.`);
    if (card) parts.push(`Sambung projek: <b>${esc(card.title || 'projek semasa')}</b> · <a href="#" id="pl-new-project">Mula projek baru</a>`);
    else if (flow && flow !== 'fast' && !isFirstStep(c)) parts.push('Projek baru (tiada langkah sebelum ini dalam sesi ini).');
    if (uploading) parts.push('Tunggu upload bahan siap…');
    note.innerHTML = parts.join(' ');
    const reset = document.getElementById('pl-new-project');
    if (reset) reset.addEventListener('click', (e) => { e.preventDefault(); delete cards[flow]; saveCards(); refreshAction(); });
  }

  async function generate() {
    const c = cur();
    const editor = document.getElementById('prompt-editor');
    if (!c || !editor || busy) return;
    if (uploading) return say('Tunggu upload bahan siap dulu.');
    const text = editor.value;
    if (/\[EDIT:/.test(text) && !confirm('Masih ada ruang [EDIT] yang belum diisi. Teruskan juga?')) return;
    const flow = flowOf(c.id);
    const card = flow && flow !== 'fast' && !isFirstStep(c) ? cards[flow] : null;
    busy = true;
    refreshAction();
    try {
      const r = await fetch('/api/vgc/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text, step_id: c.id, title: c.title, project_id: projectId || undefined,
          materials: mats.filter((m) => m.url).map((m) => ({ url: m.url, name: m.name })),
          card_id: card?.id,
          voice: voice || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) { say(d?.error || `Gagal hantar (HTTP ${r.status})`); return; }
      if (flow && flow !== 'fast') { cards[flow] = { id: d.id, title: card?.title || c.title }; saveCards(); }
      say(d.video ? '🎬 Dihantar! AI sedang bina video — lihat kad dalam History.' : '✨ Dihantar! Jawapan AI akan muncul dalam kad History.');
      refreshParent();
    } catch {
      say('Gagal hantar — semak sambungan internet.');
    } finally {
      busy = false;
      refreshAction();
    }
  }

  // re-sync after every vault render (step change, platform switch, style change)
  const vaultRender = window.render;
  if (typeof vaultRender === 'function') {
    window.render = function (...args) {
      const out = vaultRender.apply(this, args);
      mount();
      refreshAction();
      return out;
    };
  }
  const boot = () => { mount(); refreshAction(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('hashchange', () => setTimeout(refreshAction, 0));
})();
