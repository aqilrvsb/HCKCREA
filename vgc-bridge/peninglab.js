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

  // ── Embedded in the Motion tab (Custom Style): the vault sits in the page like the rest of the form ──
  // The frame takes the vault's own height (no box, no inner scrollbar — the page scrolls), the vault's
  // header / hero / "copy the prompt" chrome is hidden (peninglab.css, html.pl-embed), and what the vault
  // pops up (its toast, the style dialog) shows where the client is looking in the page, not at the
  // bottom of a tall frame. The full-screen /vgc page is unchanged.
  let host = null;
  // only when the Motion tab asks for it (data-pl-embed) — an older page keeps the framed vault as it was
  try { host = window.frameElement && window.frameElement.dataset.plEmbed === "1" && window.parent.document ? window.frameElement : null; } catch { host = null; }
  if (host) {
    document.documentElement.classList.add('pl-embed');
    let lastH = 0;
    const fit = () => {
      const h = Math.ceil(document.body ? document.body.getBoundingClientRect().height : 0);
      if (h > 0 && Math.abs(h - lastH) > 1) { lastH = h; host.style.height = h + 'px'; }
    };
    const watch = () => {
      if (!document.body) return;
      new ResizeObserver(fit).observe(document.body);
      fit();
    };
    if (document.body) watch(); else document.addEventListener('DOMContentLoaded', watch);
    window.addEventListener('load', fit);
    // the part of the frame the client can see right now (frame px)
    const view = () => {
      const r = host.getBoundingClientRect();
      const vh = window.parent.innerHeight;
      return { top: Math.max(0, -r.top), height: Math.max(200, Math.min(vh, r.bottom) - Math.max(0, r.top)), vh };
    };
    // the vault's toast → a toast in the page
    window.notify = (message) => {
      const pd = window.parent.document;
      let t = pd.getElementById('pl-vgc-toast');
      if (!t) {
        t = pd.createElement('div');
        t.id = 'pl-vgc-toast';
        t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;max-width:calc(100vw - 32px);'
          + 'padding:11px 18px;border-radius:12px;font:700 13px/1.4 system-ui,sans-serif;color:#fff;'
          + 'background:linear-gradient(135deg,#a855f7,#ec4899);box-shadow:0 10px 40px rgba(0,0,0,.45);transition:opacity .2s;opacity:0;pointer-events:none';
        pd.body.appendChild(t);
      }
      t.textContent = String(message);
      t.style.opacity = '1';
      clearTimeout(t._hide);
      t._hide = setTimeout(() => { t.style.opacity = '0'; }, 3500);
    };
    // PeningLab's colours: the vault's own stylesheets are recoloured in place — its lime / greens become
    // PeningLab purple, its blue-grey darks the dashboard's purple-black (greys, reds, yellows stay). The style
    // previews (concept-demos, .sample-*) keep their real colours. Hues land outside the ranges they come from,
    // so running it again changes nothing.
    const recolor = () => {
      const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
      const parse = (c) => {
        let m = /^#([0-9a-f]{3,8})$/i.exec(c);
        if (m) {
          let h = m[1];
          if (h.length <= 4) h = h.split('').map((x) => x + x).join('');
          if (h.length !== 6 && h.length !== 8) return null;
          return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
        }
        m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(c);
        if (!m) return null;
        const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
        return [Number(m[1]), Number(m[2]), Number(m[3]), a];
      };
      const shift = (c) => {
        const p = parse(c);
        if (!p) return c;
        const [r, g, b, a] = [p[0] / 255, p[1] / 255, p[2] / 255, p[3]];
        const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
        if (d < 0.02) return c;
        let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
        if (s < 0.08) return c;
        if (h >= 65 && h <= 170 && s >= 0.15) { h = 271; if (l > 0.45) s = Math.max(s, 0.85); }
        else if (h > 170 && h <= 260 && (l < 0.3 || s < 0.25)) { h = 268; s = Math.min(s, 0.32); }
        else return c;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s, pp = 2 * l - q;
        const ch = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
        const R = ch(h / 360 + 1 / 3) * 255, G = ch(h / 360) * 255, B = ch(h / 360 - 1 / 3) * 255;
        return a < 1 ? `rgba(${Math.round(R)}, ${Math.round(G)}, ${Math.round(B)}, ${a})` : `#${hex2(R)}${hex2(G)}${hex2(B)}`;
      };
      const fix = (v) => v.replace(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^)]*\)/gi, shift);
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules) walk(rule.cssRules);
          const st = rule.style;
          if (!st || /sample|concept|demo/i.test(rule.selectorText || '')) continue;
          for (let i = 0; i < st.length; i++) {
            const prop = st[i];
            const v = st.getPropertyValue(prop);
            if (!/#|rgb/i.test(v)) continue;
            const nv = fix(v);
            if (nv !== v) st.setProperty(prop, nv, st.getPropertyPriority(prop));
          }
        }
      };
      for (const sh of Array.from(document.styleSheets)) {
        const node = sh.ownerNode;
        const src = (node && node.dataset && node.dataset.src) || sh.href || '';
        if (!/\/vgc\/|\.css$/.test(src) || /concept-demos|peninglab\.css/.test(src)) continue;
        let rules;
        try { rules = sh.cssRules; } catch { continue; }
        walk(rules);
      }
    };
    recolor();
    document.addEventListener('DOMContentLoaded', recolor);
    window.addEventListener('load', recolor);
    // the vault's dialogs (style details) open in the visible part of the frame
    const place = (d) => {
      if (!d.open) return;
      const v = view();
      d.style.position = 'absolute';
      d.style.margin = '0 auto';
      d.style.maxHeight = (v.vh - 32) + 'px';
      d.style.top = (v.top + 16) + 'px';
    };
    new MutationObserver((list) => {
      for (const m of list) if (m.target.tagName === 'DIALOG') place(m.target);
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
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
  // Edit Footage Sendiri: the voice is the footage's own — no AI voice-over there (100% Motion Ad only)
  const footage = () => { try { return ideaSource === 'footage'; } catch { return false; } };
  // Edit Footage Sendiri on Fast Track goes script first, like Default (100% Motion Ad: straight to the video)
  const scriptFirstNow = () => { const c = cur(); return !!c && c.id === 'fast-track' && footage(); };
  const fieldValue = (re) => {
    const f = Array.from(document.querySelectorAll('#fields .field')).find((x) => re.test((x.querySelector('label') || {}).textContent || ''));
    const el = f && f.querySelector('textarea, input, select');
    return el ? String(el.value || '').trim().slice(0, 80) : '';
  };
  const readDur = (file) => new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (d) => { if (done) return; done = true; clearTimeout(t); URL.revokeObjectURL(url); v.remove(); resolve(Number.isFinite(d) && d > 0 ? d : 0); };
    const t = setTimeout(() => finish(v.duration), 12000);
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    v.onloadedmetadata = () => finish(v.duration);
    v.ondurationchange = () => { if (Number.isFinite(v.duration) && v.duration > 0) finish(v.duration); };
    v.onerror = () => finish(0);
    document.body.appendChild(v);
    v.src = url;
    v.load();
  });
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

  // ── 📎 Bahan: an attach picker in the vault's own "Bahan / Folder" field (like Default's product photos) ──
  // The field's text is written from the attached files (./bahan/<name> — the names modal_vgc saves them as),
  // so the prompt the vault builds always lists exactly what was attached.
  let gallery = [];
  let showGallery = false;
  const safeName = (name, i) => (String(name || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || `bahan-${i + 1}`);
  const bahanField = () => Array.from(document.querySelectorAll('#fields .field')).find((f) => /bahan/i.test((f.querySelector('label') || {}).textContent || ''));
  fetch('/api/motion/photos').then((r) => r.json()).then((d) => { gallery = Array.isArray(d && d.photos) ? d.photos : []; renderMaterials(); }).catch(() => {});

  function syncField() {
    const f = bahanField();
    const input = f && f.querySelector('textarea, input');
    if (!input) return;
    const used = new Set();
    const names = mats.filter((m) => m.url).map((m, i) => {
      let n = safeName(m.name, i);
      while (used.has(n)) n = n.replace(/(\.[^.]*)?$/, (ext) => `-${i + 1}${ext || ''}`);
      used.add(n);
      return `./bahan/${n}`;
    });
    const value = names.length ? `Fail dilampirkan (${names.length}): ${names.join(', ')}` : '';
    if (input.value === value) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mountPicker() {
    const f = bahanField();
    if (!f || f.querySelector('.pl-picker')) return;
    const input = f.querySelector('textarea, input');
    if (input) input.style.display = 'none';
    const box = document.createElement('div');
    box.className = 'pl-picker';
    box.innerHTML =
      '<div class="pl-pick-row" id="pl-pick-row"></div>' +
      '<div id="pl-gallery-wrap"></div>' +
      '<p class="pl-pick-help">Gambar produk, logo, footage atau voice-over — AI guna terus fail ini (masuk ke prompt automatik).</p>';
    f.append(box);
    renderMaterials();
  }

  function mount() {
    mountPicker();
    const footer = document.querySelector('.editor-panel .editor-footer');
    if (!footer || document.getElementById('pl-materials')) return;
    const box = document.createElement('div');
    box.id = 'pl-materials';
    box.className = 'pl-materials';
    box.innerHTML =
      '<div class="pl-voice"><div class="pl-mat-head"><strong>🎙️ Voice-over AI</strong><span>Tiada VO sendiri? Pilih suara — AI tulis skrip VO & jana suara terus.</span></div><div class="pl-voice-list" id="pl-voice-list"></div></div>';
    footer.before(box);

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
    const box = document.getElementById('pl-materials');
    if (box) box.hidden = footage();
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
    const row = document.getElementById('pl-pick-row');
    const wrap = document.getElementById('pl-gallery-wrap');
    if (row) {
      row.innerHTML = mats.map((m, i) => {
        const pic = m.url && m.kind === 'Gambar' ? m.url : m.preview;
        const face = pic ? `<img src="${esc(pic)}" alt="">` : `<span class="pl-thumb-ico">${m.kind === 'Video' ? '🎬' : m.kind === 'Audio' ? '🎵' : '📄'}</span><span class="pl-thumb-name">${esc(m.name)}</span>`;
        const busyCover = m.url ? '' : `<span class="pl-thumb-busy">${m.pct || 0}%</span>`;
        return `<div class="pl-thumb" title="${esc(m.name)}">${face}${busyCover}${m.url ? `<button type="button" data-rm="${i}" aria-label="Buang">✕</button>` : ''}</div>`;
      }).join('') +
        '<label class="pl-pick-add"><input type="file" multiple accept="image/*,video/*,audio/*"><span class="pl-pick-ico">⬆</span><b>Bahan</b></label>';
      row.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', () => { mats.splice(Number(btn.dataset.rm), 1); renderMaterials(); }));
      row.querySelector('.pl-pick-add input').addEventListener('change', (e) => {
        for (const f of Array.from(e.target.files || [])) void upload(f);
        e.target.value = '';
      });
    }
    if (wrap) {
      const free = gallery.filter((p) => !mats.some((m) => m.url === p.url));
      wrap.innerHTML = gallery.length
        ? `<button type="button" class="pl-gallery-btn" id="pl-gallery-btn">🖼️ Guna gambar lama (${gallery.length}) ${showGallery ? '▲' : '▼'}</button>` +
          (showGallery ? `<div class="pl-gallery">${free.length ? free.map((p) => `<button type="button" class="pl-gallery-item" data-url="${esc(p.url)}"><img src="${esc(p.url)}" alt=""></button>`).join('') : '<span class="pl-pick-help">Semua gambar lama sudah dipilih.</span>'}</div>` : '')
        : '';
      const gb = document.getElementById('pl-gallery-btn');
      if (gb) gb.addEventListener('click', () => { showGallery = !showGallery; renderMaterials(); });
      wrap.querySelectorAll('[data-url]').forEach((btn) => btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const n = mats.filter((m) => m.kind === 'Gambar').length + 1;
        const ext = (/\.(jpe?g|png|webp)$/i.exec(url) || ['', 'jpg'])[1];
        mats.push({ name: `produk-${n}.${ext}`, kind: 'Gambar', size: 0, url, pct: 100 });
        renderMaterials();
        refreshAction();
      }));
    }
    syncField();
  }

  async function upload(file) {
    const isImg = file.type.startsWith('image/') && file.size <= 12 * 1024 * 1024;
    const m = { name: file.name, kind: kindOf(file), size: file.size, url: '', pct: 0, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '', dur: 0 };
    if (file.type.startsWith('video/')) readDur(file).then((d) => { m.dur = d; });
    mats.push(m);
    uploading++;
    renderMaterials();
    try {
      const r = await fetch('/api/motion/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size, kind: isImg ? 'image' : 'vgc' }) });
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
      // a product photo joins the client's gallery (the same one Default's "Guna gambar lama" shows)
      if (isImg) {
        fetch('/api/motion/photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: m.url }) })
          .then((r) => r.json()).then((d) => { if (d && d.photo) gallery = [d.photo, ...gallery.filter((p) => p.url !== m.url)]; renderMaterials(); }).catch(() => {});
      }
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
    const scriptFirst = scriptFirstNow();
    go.textContent = busy ? 'Menghantar…' : scriptFirst ? '📝 Jana Skrip' : video ? '🎬 Jana Video' : '✨ Jana Jawapan';
    go.disabled = busy || uploading > 0;
    const price = pricing ? (video ? pricing.video : pricing.text) : null;
    const parts = [];
    parts.push(scriptFirst
      ? 'Macam Default: AI potong senyap & tulis skrip dari footage dulu (~1–2 min). Bila kad History bertukar kuning, tekan <b>Semak skrip</b>, betulkan, kemudian <b>Jana Video</b> — barulah AI bina, render & semak video (~20–40 min).'
      : video ? 'AI bina, render & semak (AI pengkritik) preview MP4 terus dalam PeningLab (~20–40 min).' : 'AI jawab langkah ini terus dalam PeningLab — baca jawapan dalam kad History.');
    if (price !== null) parts.push(price > 0 ? `Caj RM${price.toFixed(2)}.` : 'Percuma.');
    const vo = footage() ? null : voices.find((v) => v.key === voice);
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
    const scriptFirst = scriptFirstNow();
    const clip = scriptFirst ? mats.find((m) => m.url && m.kind === 'Video') : null;
    if (scriptFirst && !clip) return say('Tambah footage (video) anda di Bahan / Folder dulu.');
    if (scriptFirst && !(clip.dur > 0.5)) return say('Tak dapat baca tempoh footage — buang dan upload semula video itu.');
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
          voice: (!footage() && voice) || undefined,
          ...(scriptFirst ? { script_first: true, footage: { url: clip.url, name: clip.name, dur: clip.dur }, product: fieldValue(/produk|servis|topik/i) } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) { say(d?.error || `Gagal hantar (HTTP ${r.status})`); return; }
      if (flow && flow !== 'fast') { cards[flow] = { id: d.id, title: card?.title || c.title }; saveCards(); }
      say(d.script
        ? '📝 Dihantar! AI sedang tulis skrip dari footage — bila kad History bertukar kuning, tekan "Semak skrip", kemudian "Jana Video".'
        : d.video ? '🎬 Dihantar! AI sedang bina video — lihat kad dalam History.' : '✨ Dihantar! Jawapan AI akan muncul dalam kad History.');
      refreshParent();
    } catch {
      say('Gagal hantar — semak sambungan internet.');
    } finally {
      busy = false;
      refreshAction();
    }
  }

  // The vault's own text still speaks of copying the prompt into an AI chat — PeningLab runs it from here.
  function relabel() {
    const set = (sel, from, to) => { const el = document.querySelector(sel); if (el && el.textContent.includes(from)) el.textContent = el.textContent.replace(from, to); };
    set('.editor-panel .panel-heading h3', 'Prompt untuk copy', 'Prompt untuk AI');
    set('#asset-note strong', 'Sebelum paste', 'Sebelum jana');
    set('#input-help', 'Attach fail sebenar dalam chat AI.', 'Fail sebenar: tambah di Bahan / Folder di bawah.');
    // PeningLab always runs Claude Code: the prompt is written for it, never for Codex
    const claude = document.querySelector('[data-idea-destination="claude"]');
    if (claude && claude.getAttribute('aria-pressed') !== 'true') claude.click();
  }

  // Re-sync after every vault render (step change, video type, style change). The vault's scripts are
  // deferred and run after this one, so its render() only exists once the document has been parsed —
  // hook it then (hooking it here missed it: the button stayed blank unless the pricing call came late).
  let hooked = false;
  const hook = () => {
    if (hooked || typeof window.render !== 'function') return;
    hooked = true;
    const vaultRender = window.render;
    window.render = function (...args) {
      const out = vaultRender.apply(this, args);
      mount();
      relabel();
      renderVoices();
      refreshAction();
      return out;
    };
  };
  hook();
  const boot = () => {
    hook();
    mount();
    relabel();
    refreshAction();
    // the vault picks its step once content.json has loaded: label the button as soon as it has
    let n = 0;
    const t = setInterval(() => { n++; if (cur() || n > 50) { clearInterval(t); mount(); relabel(); refreshAction(); } }, 200);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('hashchange', () => setTimeout(refreshAction, 0));
})();
