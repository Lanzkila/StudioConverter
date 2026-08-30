(function () {
    'use strict';
    if (window.pdfjsLib)
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const $ = id => document.getElementById(id);
    const qsa = s => Array.from(document.querySelectorAll(s));
    const fileInput = $('file-input'), dropArea = $('drop-area'), statusText = $('status-text'), progressFill = $('progress-fill'), percentageText = $('percentage');
    const allMainBtns = qsa('.btn-exec');
    let queue = [], cancelled = false, wakeLock = null, uid = 1, workspacePages = [], workspaceDocs = [], workspaceLoaded = false, workspaceDirty = false, workspaceInputBytes = 0, coverPageId = null, dragPageId = null, observer = null, duplicateIds = new Set(), lastFormat = 'cbz';
    function naturalCompare(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
    function sleepFrame() { return new Promise(r => requestAnimationFrame(r)); }
    function safeBaseName(name) { return (name || 'Manga').replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Manga'; }
    function formatBytes(bytes) { if (!bytes)
        return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1); return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i]; }
    function typeOfFile(f) { const n = f.name.toLowerCase(); if (n.endsWith('.pdf'))
        return 'PDF'; if (n.endsWith('.cbz'))
        return 'CBZ'; if (n.endsWith('.zip'))
        return 'ZIP'; if (f.type && f.type.startsWith('image/'))
        return 'IMG'; return 'OTHER'; }
    function extOf(name) { const m = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }
    function pad(n, total) { return String(n).padStart(Math.max(3, String(total || 0).length), '0'); }
    function escapeXml(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
    function updateProgress(current, total, msg) { const p = total ? Math.max(0, Math.min(100, Math.round(current / total * 100))) : 0; progressFill.style.width = p + '%'; percentageText.textContent = p + '%'; statusText.textContent = msg + (total ? ' · ' + current + '/' + total : ''); }
    function resetProgress(msg) { progressFill.style.width = '0%'; percentageText.textContent = '0%'; statusText.textContent = msg || 'READY'; }
    function assertNotCancelled() { if (cancelled)
        throw new Error('__CANCELLED__'); }
    function disableMain(state) { allMainBtns.forEach(b => b.disabled = state); $('cancel-btn').style.display = state ? 'block' : 'none'; qsa('.tool-btn').forEach(b => { if (b.id !== 'cancel-btn')
        b.disabled = state; }); }
    async function requestWakeLock() { if (!$('wake-toggle').checked || !('wakeLock' in navigator))
        return; try {
        wakeLock = await navigator.wakeLock.request('screen');
    }
    catch (e) { } }
    async function releaseWakeLock() { try {
        if (wakeLock)
            await wakeLock.release();
    }
    catch (e) { } wakeLock = null; }
    function inputBytes(items) { return (items || queue).reduce((a, x) => a + (x.file ? x.file.size : x.size || 0), 0); }
    function queueFiles(items) { return (items || queue).map(x => x.file || x); }
    function itemById(id) { return queue.find(x => x.id === id); }
    function setItemStatus(item, status, detail) { if (!item)
        return; item.status = status; item.detail = detail || ''; renderQueue(); }
    function renderQueue() {
        $('queue-wrap').style.display = queue.length ? 'block' : 'none';
        $('file-name').textContent = queue.length ? (queue.length === 1 ? queue[0].file.name : queue.length + ' files selected') : 'Drop or choose manga files';
        $('sum-files').textContent = queue.length;
        $('sum-size').textContent = formatBytes(inputBytes());
        const types = [...new Set(queue.map(x => typeOfFile(x.file)))];
        $('sum-type').textContent = types.length ? (types.length === 1 ? types[0] : 'MIXED') : '—';
        const box = $('file-list');
        box.innerHTML = '';
        queue.forEach((it, i) => {
            const row = document.createElement('div');
            row.className = 'file-row';
            const meta = document.createElement('div');
            meta.className = 'file-meta';
            const title = document.createElement('div');
            title.className = 'file-title';
            title.textContent = it.file.name;
            const sub = document.createElement('div');
            sub.className = 'file-sub';
            sub.append(document.createTextNode(typeOfFile(it.file) + ' · ' + formatBytes(it.file.size) + ' '));
            const chip = document.createElement('span');
            chip.className = 'status-chip ' + it.status;
            chip.textContent = it.status || 'waiting';
            sub.appendChild(chip);
            if (it.detail) {
                const d = document.createElement('span');
                d.textContent = it.detail;
                sub.appendChild(d);
            }
            meta.append(title, sub);
            const actions = document.createElement('div');
            actions.className = 'file-actions';
            const up = mkMini('↑', 'Move up', () => moveFile(i, -1));
            up.disabled = i === 0;
            const dn = mkMini('↓', 'Move down', () => moveFile(i, 1));
            dn.disabled = i === queue.length - 1;
            actions.append(up, dn);
            if (it.status === 'failed' || it.status === 'cancelled') {
                actions.appendChild(mkMini('↻', 'Retry', () => retryItem(it)));
            }
            const rm = mkMini('×', 'Remove', () => { queue.splice(i, 1); workspaceLoaded = false; renderQueue(); updateNamePreview(); });
            rm.classList.add('remove');
            actions.appendChild(rm);
            row.append(meta, actions);
            box.appendChild(row);
        });
        updateNamePreview();
    }
    function mkMini(t, title, fn) { const b = document.createElement('button'); b.className = 'mini-btn'; b.textContent = t; b.title = title; b.onclick = e => { e.stopPropagation(); fn(); }; return b; }
    function moveFile(i, d) { const j = i + d; if (j < 0 || j >= queue.length)
        return; [queue[i], queue[j]] = [queue[j], queue[i]]; workspaceLoaded = false; renderQueue(); }
    function addFiles(list) { const incoming = Array.from(list || []).filter(f => ['PDF', 'CBZ', 'ZIP', 'IMG'].includes(typeOfFile(f))); incoming.forEach(f => queue.push({ id: 'q' + uid++, file: f, status: 'waiting', detail: '', lastFormat: null })); workspaceLoaded = false; renderQueue(); resetProgress(queue.length ? 'READY TO CONVERT' : 'READY'); }
    fileInput.addEventListener('change', e => { addFiles(e.target.files); fileInput.value = ''; });
    dropArea.onclick = () => fileInput.click();
    dropArea.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
    } };
    ['dragenter', 'dragover'].forEach(x => dropArea.addEventListener(x, e => { e.preventDefault(); dropArea.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(x => dropArea.addEventListener(x, e => { e.preventDefault(); dropArea.classList.remove('dragging'); }));
    dropArea.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    $('clear-btn').onclick = () => { queue = []; clearWorkspace(); renderQueue(); resetProgress(); };
    $('clear-done').onclick = () => { queue = queue.filter(x => x.status !== 'done'); renderQueue(); };
    $('cancel-btn').onclick = () => { cancelled = true; statusText.textContent = 'CANCELLING…'; };
    function sortNames(names) { const m = $('sort-select').value, a = [...names]; if (m === 'reverse')
        return a.sort(naturalCompare).reverse(); if (m === 'name')
        return a.sort((x, y) => x.localeCompare(y)); return a.sort(naturalCompare); }
    function imageNamesFromZip(zip) { return sortNames(Object.keys(zip.files).filter(n => !zip.files[n].dir && /\.(jpg|jpeg|png|webp)$/i.test(n) && !n.includes('__MACOSX'))); }
    function metadata() { return { title: $('meta-title').value.trim(), series: $('meta-series').value.trim(), chapter: $('meta-chapter').value.trim(), volume: $('meta-volume').value.trim(), writer: $('meta-writer').value.trim(), artist: $('meta-artist').value.trim(), publisher: $('meta-publisher').value.trim(), year: $('meta-year').value.trim(), genre: $('meta-genre').value.trim(), country: $('meta-country').value.trim(), type: $('meta-type').value, direction: $('meta-direction').value, summary: $('meta-summary').value.trim() }; }
    function comicInfoXml() { const m = metadata(); const manga = m.type === 'Manga' ? (m.direction === 'RightToLeft' ? 'YesAndRightToLeft' : 'Yes') : 'No'; return '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' + (m.title ? '<Title>' + escapeXml(m.title) + '</Title>\n' : '') + (m.series ? '<Series>' + escapeXml(m.series) + '</Series>\n' : '') + (m.chapter ? '<Number>' + escapeXml(m.chapter) + '</Number>\n' : '') + (m.volume ? '<Volume>' + escapeXml(m.volume) + '</Volume>\n' : '') + (m.writer ? '<Writer>' + escapeXml(m.writer) + '</Writer>\n' : '') + (m.artist ? '<Penciller>' + escapeXml(m.artist) + '</Penciller>\n' : '') + (m.publisher ? '<Publisher>' + escapeXml(m.publisher) + '</Publisher>\n' : '') + (m.year ? '<Year>' + escapeXml(m.year) + '</Year>\n' : '') + (m.genre ? '<Genre>' + escapeXml(m.genre) + '</Genre>\n' : '') + (m.summary ? '<Summary>' + escapeXml(m.summary) + '</Summary>\n' : '') + (m.country ? '<LanguageISO>' + escapeXml(m.country) + '</LanguageISO>\n' : '') + '<Manga>' + manga + '</Manga>\n<Notes>Created with Manga Studio Pro</Notes>\n</ComicInfo>'; }
    function renderTemplate(file, index) { const fixed = $('output-name').value.trim(); if (fixed)
        return safeBaseName(fixed) + (index ? '-' + pad(index, queue.length) : ''); const m = metadata(), name = safeBaseName(file ? file.name : (queue[0] ? queue[0].file.name : 'Manga')); let s = $('name-template').value.trim() || '{name}'; const vars = { series: m.series, volume: m.volume, chapter: m.chapter, title: m.title, name: name, index: index || 1 }; Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k] || ''); }); s = s.replace(/\[\s*\]/g, '').replace(/\bVol\.\s*(?=Ch\.|-|$)/g, '').replace(/\bCh\.\s*(?=-|$)/g, '').replace(/\s+-\s+-\s+/g, ' - ').replace(/\s{2,}/g, ' ').replace(/^[-_.\s]+|[-_.\s]+$/g, ''); return safeBaseName(s || name); }
    function updateNamePreview() { $('name-preview').textContent = renderTemplate(queue[0] && queue[0].file, 0).slice(0, 34).toUpperCase(); }
    qsa('.meta-watch').forEach(x => x.addEventListener('input', updateNamePreview));
    $('output-name').oninput = updateNamePreview;
    $('name-template').oninput = updateNamePreview;
    const presets = { reader: { width: '1600', q: 82, fmt: 'jpeg', crop: false, gray: false }, archive: { width: '2400', q: 94, fmt: 'jpeg', crop: false, gray: false }, mobile: { width: '1200', q: 76, fmt: 'jpeg', crop: false, gray: false }, small: { width: '800', q: 64, fmt: 'jpeg', crop: true, gray: false }, original: { width: 'original', q: 100, fmt: 'png', crop: false, gray: false }, webtoon: { width: '1080', q: 82, fmt: 'jpeg', crop: true, gray: false } };
    function applyPreset(k) { const p = presets[k]; if (!p)
        return; $('width-select').value = p.width; $('quality-range').value = p.q; $('q-val').textContent = p.q; $('image-format').value = p.fmt; $('crop-toggle').checked = p.crop; $('gray-toggle').checked = p.gray; $('reso-val').textContent = $('width-select').options[$('width-select').selectedIndex].text; $('preset-hint').textContent = k.toUpperCase(); }
    $('preset-select').onchange = e => applyPreset(e.target.value);
    $('width-select').onchange = function () { $('reso-val').textContent = this.options[this.selectedIndex].text; };
    $('quality-range').oninput = function () { $('q-val').textContent = this.value; };
    function clearWorkspace() { workspacePages = []; workspaceDocs.forEach(d => { try {
        d.destroy && d.destroy();
    }
    catch (e) { } }); workspaceDocs = []; workspaceLoaded = false; workspaceDirty = false; workspaceInputBytes = 0; coverPageId = null; duplicateIds.clear(); $('sum-pages').textContent = '—'; renderPageGrid(); }
    async function buildPageSet(files, persistent) {
        const pages = [], docs = [];
        let pageId = 1;
        for (let fi = 0; fi < files.length; fi++) {
            assertNotCancelled();
            const f = files[fi], kind = typeOfFile(f);
            statusText.textContent = 'READING ' + f.name;
            if (kind === 'IMG') {
                pages.push({ id: 'p' + uid++ + '-' + pageId++, source: 'blob', blob: f, name: f.name, sourceName: f.name, rotation: 0, selected: false, width: null, height: null });
            }
            else if (kind === 'CBZ' || kind === 'ZIP') {
                const zip = await JSZip.loadAsync(f);
                const names = imageNamesFromZip(zip);
                for (const n of names)
                    pages.push({ id: 'p' + uid++ + '-' + pageId++, source: 'zip', zip: zip, zipName: n, name: n.split('/').pop(), sourceName: f.name, rotation: 0, selected: false, width: null, height: null });
            }
            else if (kind === 'PDF') {
                const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
                docs.push(doc);
                for (let p = 1; p <= doc.numPages; p++)
                    pages.push({ id: 'p' + uid++ + '-' + pageId++, source: 'pdf', pdfDoc: doc, pdfPage: p, name: safeBaseName(f.name) + '_' + pad(p, doc.numPages) + '.pdfpage', sourceName: f.name, rotation: 0, selected: false, width: null, height: null });
            }
            if (fi % 2 === 0)
                await sleepFrame();
        }
        return { pages: pages, docs: docs, persistent: !!persistent };
    }
    async function loadWorkspace() { if (!queue.length)
        return alert('Pilih fail dulu!'); cancelled = false; disableMain(true); await requestWakeLock(); try {
        clearWorkspace();
        updateProgress(0, 1, 'LOADING WORKSPACE');
        const set = await buildPageSet(queueFiles(), true);
        workspacePages = set.pages;
        workspaceDocs = set.docs;
        workspaceLoaded = true;
        workspaceDirty = false;
        workspaceInputBytes = inputBytes();
        coverPageId = workspacePages[0] ? workspacePages[0].id : null;
        $('sum-pages').textContent = workspacePages.length;
        renderPageGrid();
        updateProgress(1, 1, 'WORKSPACE READY');
        switchTab('pages');
    }
    catch (e) {
        handleError(e);
    }
    finally {
        await releaseWakeLock();
        disableMain(false);
    } }
    $('load-workspace').onclick = loadWorkspace;
    $('load-pages-top').onclick = loadWorkspace;
    async function getSourceBlob(page) { if (page.source === 'blob')
        return page.blob; if (page.source === 'zip')
        return await page.zip.files[page.zipName].async('blob'); return null; }
    function loadImageFromBlob(blob) { return new Promise((res, rej) => { const url = URL.createObjectURL(blob), im = new Image(); im.onload = () => { URL.revokeObjectURL(url); res(im); }; im.onerror = e => { URL.revokeObjectURL(url); rej(e); }; im.src = url; }); }
    async function rawCanvas(page, maxWidth) { if (page.source === 'pdf') {
        const pg = await page.pdfDoc.getPage(page.pdfPage), vp1 = pg.getViewport({ scale: 1 });
        let scale = maxWidth ? Math.min(2.5, maxWidth / vp1.width) : 1.5;
        if (!maxWidth) {
            const tw = $('width-select').value;
            scale = tw === 'original' ? 1.8 : Math.min(3, Math.max(.4, Number(tw) / vp1.width));
        }
        const vp = pg.getViewport({ scale: scale });
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(vp.width));
        c.height = Math.max(1, Math.ceil(vp.height));
        const ctx = c.getContext('2d', { alpha: false });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        page.width = vp1.width;
        page.height = vp1.height;
        pg.cleanup();
        return c;
    } const blob = await getSourceBlob(page); const im = await loadImageFromBlob(blob); page.width = im.naturalWidth; page.height = im.naturalHeight; let w = im.naturalWidth, h = im.naturalHeight; let renderMax = maxWidth; if (!renderMax) {
        const tw = $('width-select').value;
        if (tw !== 'original')
            renderMax = Number(tw);
    } if (renderMax && w > renderMax) {
        h = Math.round(h * renderMax / w);
        w = renderMax;
    } const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0, w, h); return c; }
    function findWhiteCrop(canvas) { const max = 700, scale = Math.min(1, max / Math.max(canvas.width, canvas.height)), w = Math.max(1, Math.round(canvas.width * scale)), h = Math.max(1, Math.round(canvas.height * scale)), c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(canvas, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; let minX = w, minY = h, maxX = -1, maxY = -1; for (let yy = 0; yy < h; yy += 2) {
        for (let xx = 0; xx < w; xx += 2) {
            const i = (yy * w + xx) * 4, r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
            if (a > 15 && (r < 247 || g < 247 || b < 247)) {
                if (xx < minX)
                    minX = xx;
                if (xx > maxX)
                    maxX = xx;
                if (yy < minY)
                    minY = yy;
                if (yy > maxY)
                    maxY = yy;
            }
        }
    } if (maxX < 0)
        return { x: 0, y: 0, w: canvas.width, h: canvas.height }; const pad = 4; minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad); return { x: Math.floor(minX / scale), y: Math.floor(minY / scale), w: Math.ceil((maxX - minX + 1) / scale), h: Math.ceil((maxY - minY + 1) / scale) }; }
    async function processedCanvas(page, opt) { opt = opt || {}; let c = await rawCanvas(page, opt.previewWidth || null), crop = { x: 0, y: 0, w: c.width, h: c.height }; if (!opt.preview && $('crop-toggle').checked)
        crop = findWhiteCrop(c); let sw = crop.w, sh = crop.h, target = $('width-select').value, tw = sw; if (opt.forceWidth)
        tw = Number(opt.forceWidth);
    else if (target !== 'original')
        tw = Number(target); if ($('no-upscale-toggle').checked)
        tw = Math.min(tw, sw); if (!tw || target === 'original' && !opt.forceWidth)
        tw = sw; let th = Math.max(1, Math.round(sh * tw / sw)), rot = ((page.rotation || 0) % 360 + 360) % 360, out = document.createElement('canvas'); out.width = (rot === 90 || rot === 270) ? th : tw; out.height = (rot === 90 || rot === 270) ? tw : th; const ctx = out.getContext('2d', { alpha: true }); if (($('image-format').value === 'jpeg' && !opt.keepAlpha) || opt.forceWhite) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, out.width, out.height);
    } ctx.save(); if (rot === 90) {
        ctx.translate(out.width, 0);
        ctx.rotate(Math.PI / 2);
    }
    else if (rot === 180) {
        ctx.translate(out.width, out.height);
        ctx.rotate(Math.PI);
    }
    else if (rot === 270) {
        ctx.translate(0, out.height);
        ctx.rotate(-Math.PI / 2);
    } ctx.drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, tw, th); ctx.restore(); if (!opt.preview && $('gray-toggle').checked) {
        const id = ctx.getImageData(0, 0, out.width, out.height), d = id.data;
        for (let i = 0; i < d.length; i += 4) {
            const y = Math.round(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]);
            d[i] = d[i + 1] = d[i + 2] = y;
        }
        ctx.putImageData(id, 0, 0);
    } return out; }
    function canvasBlob(c, mime, q) { return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Canvas export failed')), mime, q)); }
    function renderPageGrid() {
        const box = $('page-grid');
        box.innerHTML = '';
        $('page-stats').textContent = workspacePages.length + ' pages · ' + workspacePages.filter(p => p.selected).length + ' selected';
        $('sum-pages').textContent = workspaceLoaded ? workspacePages.length : '—';
        if (!workspacePages.length) {
            box.innerHTML = '<div class="empty-workspace">Load the queue into Page Workspace to preview and edit manga pages.</div>';
            return;
        }
        if (observer)
            observer.disconnect();
        observer = new IntersectionObserver(entries => entries.forEach(en => { if (en.isIntersecting) {
            const img = en.target.querySelector('img[data-page-id]');
            if (img && !img.dataset.loaded)
                renderThumb(img.dataset.pageId, img);
            observer.unobserve(en.target);
        } }), { root: box, rootMargin: '160px' });
        workspacePages.forEach((p, i) => { const card = document.createElement('div'); card.className = 'page-card' + (p.selected ? ' selected' : '') + (duplicateIds.has(p.id) ? ' duplicate' : '') + (p.id === coverPageId ? ' cover' : ''); card.draggable = true; card.dataset.id = p.id; const tw = document.createElement('div'); tw.className = 'thumb-wrap'; const img = document.createElement('img'); img.alt = 'Page ' + (i + 1); img.dataset.pageId = p.id; const ph = document.createElement('span'); ph.className = 'thumb-placeholder'; ph.textContent = 'Loading…'; tw.append(img, ph); const info = document.createElement('div'); info.className = 'page-info'; const b = document.createElement('b'); b.textContent = (i + 1) + '. ' + p.name; const s = document.createElement('span'); s.textContent = (p.rotation || 0) + '° · ' + p.sourceName; info.append(b, s); const tools = document.createElement('div'); tools.className = 'page-tools'; const view = document.createElement('button'); view.textContent = '⤢'; view.title = 'Preview'; view.onclick = e => { e.stopPropagation(); openPreview(p.id); }; tools.appendChild(view); card.append(tw, info, tools); card.onclick = e => { if (e.target.tagName === 'BUTTON')
            return; p.selected = !p.selected; renderPageGrid(); }; card.ondragstart = () => { dragPageId = p.id; }; card.ondragover = e => e.preventDefault(); card.ondrop = e => { e.preventDefault(); reorderPage(dragPageId, p.id); }; box.appendChild(card); observer.observe(card); });
    }
    async function renderThumb(id, img) { const p = workspacePages.find(x => x.id === id); if (!p)
        return; try {
        const c = await processedCanvas(p, { preview: true, previewWidth: 220 }), data = c.toDataURL('image/jpeg', .68);
        img.src = data;
        img.dataset.loaded = '1';
        const ph = img.parentNode.querySelector('.thumb-placeholder');
        if (ph)
            ph.remove();
    }
    catch (e) {
        img.dataset.loaded = '1';
        const ph = img.parentNode.querySelector('.thumb-placeholder');
        if (ph)
            ph.textContent = 'Unreadable';
    } }
    function reorderPage(a, b) { const i = workspacePages.findIndex(p => p.id === a), j = workspacePages.findIndex(p => p.id === b); if (i < 0 || j < 0 || i === j)
        return; const [p] = workspacePages.splice(i, 1); workspacePages.splice(j, 0, p); workspaceDirty = true; renderPageGrid(); }
    function selectedPages() { const s = workspacePages.filter(p => p.selected); return s.length ? s : workspacePages; }
    $('select-all-pages').onclick = () => { workspacePages.forEach(p => p.selected = true); renderPageGrid(); };
    $('clear-page-select').onclick = () => { workspacePages.forEach(p => p.selected = false); renderPageGrid(); };
    function rotateSelected(d) { const s = workspacePages.filter(p => p.selected); (s.length ? s : []).forEach(p => p.rotation = (p.rotation + d + 360) % 360); if (s.length) {
        workspaceDirty = true;
        renderPageGrid();
    }
    else
        alert('Pilih page dulu.'); }
    $('rotate-left').onclick = () => rotateSelected(-90);
    $('rotate-right').onclick = () => rotateSelected(90);
    $('delete-pages').onclick = () => { const n = workspacePages.filter(p => p.selected).length; if (!n)
        return alert('Pilih page yang mahu dibuang.'); workspacePages = workspacePages.filter(p => !p.selected); if (!workspacePages.some(p => p.id === coverPageId))
        coverPageId = workspacePages[0] ? workspacePages[0].id : null; workspaceDirty = true; renderPageGrid(); };
    async function openPreview(id) { const p = workspacePages.find(x => x.id === id); if (!p)
        return; $('preview-modal').classList.add('open'); $('modal-title').textContent = p.name; $('modal-img').removeAttribute('src'); updateProgress(0, 1, 'RENDERING PREVIEW'); try {
        const c = await processedCanvas(p, { preview: true, previewWidth: 1500 });
        $('modal-img').src = c.toDataURL('image/jpeg', .9);
        resetProgress('READY');
    }
    catch (e) {
        handleError(e);
    } }
    $('modal-close').onclick = () => $('preview-modal').classList.remove('open');
    $('preview-modal').onclick = e => { if (e.target === $('preview-modal'))
        $('preview-modal').classList.remove('open'); };
    function orderedForOutput(pages) { let arr = [...pages]; if ($('cover-first-toggle').checked && coverPageId) {
        const i = arr.findIndex(p => p.id === coverPageId);
        if (i > 0) {
            const [c] = arr.splice(i, 1);
            arr.unshift(c);
        }
    } return arr; }
    async function pageOutputBlob(page, format, isCover) { const fmt = format || $('image-format').value; if (isCover && $('cover-original-toggle').checked && page.rotation === 0 && !$('crop-toggle').checked && !$('gray-toggle').checked && page.source !== 'pdf') {
        const b = await getSourceBlob(page);
        if (b)
            return { blob: b, ext: extOf(page.name) || 'jpg' };
    } const c = await processedCanvas(page, { forceWhite: fmt === 'jpeg' }), mime = fmt === 'png' ? 'image/png' : 'image/jpeg', ext = fmt === 'png' ? 'png' : 'jpg', q = Number($('quality-range').value) / 100; return { blob: await canvasBlob(c, mime, q), ext: ext }; }
    async function makeArchiveBlob(pages, ext, labelProgress) { const zip = new JSZip(), arr = orderedForOutput(pages), seq = $('sequential-toggle').checked, total = arr.length; for (let i = 0; i < arr.length; i++) {
        assertNotCancelled();
        if (labelProgress)
            updateProgress(i + 1, total, 'PACKING ' + ext.toUpperCase());
        const p = arr[i], out = await pageOutputBlob(p, $('image-format').value, p.id === coverPageId), name = seq ? pad(i + 1, total) + '.' + out.ext : safeBaseName(p.name) + '.' + out.ext;
        zip.file(name, await out.blob.arrayBuffer());
        if (i % 5 === 0)
            await sleepFrame();
    } if (ext === 'cbz')
        zip.file('ComicInfo.xml', comicInfoXml()); const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 5 } }, m => { if (labelProgress && m.percent)
        percentageText.textContent = Math.min(99, Math.round(m.percent)) + '%'; }); return blob; }
    async function makePdfBlob(pages, labelProgress) { const { jsPDF } = window.jspdf, arr = orderedForOutput(pages); let pdf = null; for (let i = 0; i < arr.length; i++) {
        assertNotCancelled();
        if (labelProgress)
            updateProgress(i + 1, arr.length, 'RENDERING PDF');
        const c = await processedCanvas(arr[i], { forceWhite: true }), fmt = $('image-format').value === 'png' ? 'PNG' : 'JPEG', data = c.toDataURL(fmt === 'PNG' ? 'image/png' : 'image/jpeg', Number($('quality-range').value) / 100), w = c.width, h = c.height;
        if (!pdf)
            pdf = new jsPDF({ unit: 'px', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true });
        else
            pdf.addPage([w, h], w > h ? 'landscape' : 'portrait');
        pdf.addImage(data, fmt, 0, 0, w, h, undefined, 'FAST');
        if (i % 3 === 0)
            await sleepFrame();
    } if (!pdf)
        throw new Error('Tiada halaman.'); return pdf.output('blob'); }
    async function optimizedMergePdf(files) { const merged = await PDFLib.PDFDocument.create(); let total = 0; for (let i = 0; i < files.length; i++) {
        assertNotCancelled();
        updateProgress(i + 1, files.length, 'MERGING PDF');
        const d = await PDFLib.PDFDocument.load(await files[i].arrayBuffer()), pages = await merged.copyPages(d, d.getPageIndices());
        pages.forEach(p => merged.addPage(p));
        total += pages.length;
    } return { blob: new Blob([await merged.save()], { type: 'application/pdf' }), pages: total }; }
    function downloadBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    function updateCompare(inp, out) { $('cmp-input').textContent = formatBytes(inp); $('cmp-output').textContent = formatBytes(out); const diff = inp - out, pct = inp ? Math.round(Math.abs(diff) / inp * 100) : 0; $('cmp-saved').textContent = diff >= 0 ? formatBytes(diff) : '+' + formatBytes(-diff); $('cmp-ratio').textContent = (inp ? Math.round(out / inp * 100) : 0) + '%'; $('cmp-saved').parentElement.className = 'compare-card ' + (diff >= 0 ? 'good' : 'bad'); }
    function getHistory() {
        try {
            return JSON.parse(localStorage.getItem('mangaStudioHistoryPro') || '[]');
        }
        catch (error) {
            return [];
        }
    }
    function saveHistory(history) {
        const limited = history.slice(0, 10);
        try {
            localStorage.setItem('mangaStudioHistoryPro', JSON.stringify(limited));
        }
        catch (error) {
            const withoutThumbnails = limited.map(item => ({
                ...item,
                thumb: ''
            }));
            try {
                localStorage.setItem('mangaStudioHistoryPro', JSON.stringify(withoutThumbnails));
            }
            catch (storageError) {
                console.warn('Unable to save recent conversion history.', storageError);
            }
        }
    }
    async function createRecentThumbnail(file) {
        if (!file) {
            return '';
        }
        const maxWidth = 220;
        const maxHeight = 280;
        let sourceCanvas = null;
        const kind = typeOfFile(file);
        try {
            if (kind === 'PDF') {
                const documentTask = pdfjsLib.getDocument({
                    data: await file.arrayBuffer()
                });
                const pdfDocument = await documentTask.promise;
                const page = await pdfDocument.getPage(1);
                const baseViewport = page.getViewport({ scale: 1 });
                const scale = Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height, 1);
                const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });
                sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = Math.max(1, Math.round(viewport.width));
                sourceCanvas.height = Math.max(1, Math.round(viewport.height));
                await page.render({
                    canvasContext: sourceCanvas.getContext('2d'),
                    viewport: viewport
                }).promise;
                try {
                    await pdfDocument.destroy();
                }
                catch (error) {
                    console.warn('PDF thumbnail cleanup failed.', error);
                }
            }
            else if (kind === 'CBZ' || kind === 'ZIP') {
                const zip = await JSZip.loadAsync(file);
                const firstImageName = Object.keys(zip.files)
                    .filter(name => /\.(jpg|jpeg|png|webp)$/i.test(name) && !name.includes('__MACOSX'))
                    .sort(naturalCompare)[0];
                if (!firstImageName) {
                    return '';
                }
                const imageBlob = await zip.files[firstImageName].async('blob');
                const image = await loadImageFromBlob(imageBlob);
                sourceCanvas = imageToRecentCanvas(image, maxWidth, maxHeight);
            }
            else if (kind === 'IMG') {
                const image = await loadImageFromBlob(file);
                sourceCanvas = imageToRecentCanvas(image, maxWidth, maxHeight);
            }
            if (!sourceCanvas) {
                return '';
            }
            return sourceCanvas.toDataURL('image/jpeg', 0.62);
        }
        catch (error) {
            console.warn('Recent thumbnail generation skipped.', error);
            return '';
        }
    }
    function imageToRecentCanvas(image, maxWidth, maxHeight) {
        const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
    }
    function addHistory(type, name, detail, sourceFileOverride) {
        const sourceFile = sourceFileOverride || (queue[0] && queue[0].file ? queue[0].file : null);
        const now = new Date();
        const outputBytes = dashboardParseBytes(detail);
        const historyType = String(type || '').toUpperCase();
        const canMeasureSavings = ['PDF', 'PDF MERGE', 'CBZ', 'ZIP'].includes(historyType);
        const inputSize = canMeasureSavings
            ? sourceFileOverride && Number.isFinite(Number(sourceFileOverride.size))
                ? Number(sourceFileOverride.size)
                : inputBytes()
            : 0;
        const entry = {
            id: 'history-' + Date.now() + '-' + uid++,
            type: type,
            name: name,
            detail: detail,
            time: now.toLocaleString(),
            createdAt: now.getTime(),
            thumb: ''
        };

        /* Keep the original converter history exactly as before: max 10 items. */
        const history = getHistory();
        history.unshift(entry);
        saveHistory(history);
        renderHistory();

        /* Dashboard 3.0 keeps its own longer history and extra UI-only metadata. */
        const dashboardEntry = normalizeDashboardHistoryItem({
            ...entry,
            inputBytes: inputSize,
            outputBytes: outputBytes,
            pinned: false,
            favorite: false
        });
        const dashboardHistory = getDashboardHistory();
        dashboardHistory.unshift(dashboardEntry);
        saveDashboardHistory(dashboardHistory);
        renderDashboardRecent();

        if (sourceFile) {
            createRecentThumbnail(sourceFile).then(thumbnail => {
                if (!thumbnail) {
                    return;
                }

                const latestHistory = getHistory();
                const converterTarget = latestHistory.find(item => item.id === entry.id);
                if (converterTarget) {
                    converterTarget.thumb = thumbnail;
                    saveHistory(latestHistory);
                    renderHistory();
                }

                const latestDashboardHistory = getDashboardHistory();
                const dashboardTarget = latestDashboardHistory.find(item => item.id === entry.id);
                if (dashboardTarget) {
                    dashboardTarget.thumb = thumbnail;
                    saveDashboardHistory(latestDashboardHistory);
                    renderDashboardRecent();
                }
            });
        }
    }
    function renderHistory() {
        const history = getHistory();
        const box = $('history-list');
        box.innerHTML = '';
        if (!history.length) {
            box.innerHTML = '<div class="history-empty">No recent outputs yet.</div>';
            return;
        }
        history.forEach(item => {
            const row = document.createElement('div');
            const left = document.createElement('div');
            const title = document.createElement('b');
            const detail = document.createElement('span');
            const time = document.createElement('span');
            row.className = 'history-item';
            title.textContent = item.type + ' · ' + item.name;
            detail.textContent = item.detail;
            time.textContent = item.time;
            left.append(title, detail);
            row.append(left, time);
            box.appendChild(row);
        });
    }
    const DASHBOARD_HISTORY_KEY = 'mangaStudioDashboardHistoryV3';
    const DASHBOARD_MIGRATION_KEY = 'mangaStudioDashboardHistoryV3Initialized';
    const DASHBOARD_HISTORY_LIMIT = 120;
    const DASHBOARD_VIEW_KEY = 'mangaStudioDashboardViewModeV3';
    const DASHBOARD_WHATS_NEW_KEY = 'mangaStudioDashboardWhatsNew3Dismissed';

    const dashboardRecentState = {
        query: '',
        format: 'all',
        special: 'all',
        sort: 'newest',
        view: localStorage.getItem(DASHBOARD_VIEW_KEY) === 'list' ? 'list' : 'grid',
        page: 1
    };

    let dashboardSelectedHistoryId = '';
    let dashboardToastTimer = 0;

    function dashboardFormatGroup(type) {
        const value = String(type || '').toUpperCase();
        if (value.includes('PDF')) {
            return 'PDF';
        }
        if (value.includes('CBZ')) {
            return 'CBZ';
        }
        if (value.includes('ZIP') || value.includes('SPLIT') || value.includes('EXTRACT') || value.includes('WEBTOON')) {
            return 'ZIP';
        }
        return value || 'OTHER';
    }

    function dashboardHistoryTimestamp(item) {
        if (Number.isFinite(Number(item.createdAt))) {
            return Number(item.createdAt);
        }
        const parsed = Date.parse(item.time || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function dashboardParsePages(detail) {
        const match = String(detail || '').match(/([0-9,]+)\s*(?:pages?|images?)/i);
        if (!match) {
            return 0;
        }
        return Number(match[1].replace(/,/g, '')) || 0;
    }

    function dashboardParseBytes(detail) {
        const matches = Array.from(String(detail || '').matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB)/gi));
        if (!matches.length) {
            return 0;
        }
        const match = matches[matches.length - 1];
        const value = Number(match[1]);
        const unit = String(match[2]).toUpperCase();
        const multipliers = {
            B: 1,
            KB: 1024,
            MB: 1024 * 1024,
            GB: 1024 * 1024 * 1024
        };
        return value * (multipliers[unit] || 1);
    }

    function normalizeDashboardHistoryItem(item, index) {
        const createdAt = Number.isFinite(Number(item && item.createdAt))
            ? Number(item.createdAt)
            : dashboardHistoryTimestamp(item || {}) || (Date.now() - Number(index || 0));
        const outputBytes = Number.isFinite(Number(item && item.outputBytes))
            ? Math.max(0, Number(item.outputBytes))
            : dashboardParseBytes(item && item.detail);
        const inputBytes = Number.isFinite(Number(item && item.inputBytes))
            ? Math.max(0, Number(item.inputBytes))
            : 0;
        const safeThumb = typeof (item && item.thumb) === 'string' && item.thumb.startsWith('data:image/') && item.thumb.length < 900000
            ? item.thumb
            : '';

        return {
            id: String((item && item.id) || ('dashboard-' + createdAt + '-' + Number(index || 0))),
            type: String((item && item.type) || 'OTHER').slice(0, 80),
            name: String((item && item.name) || 'Recent conversion').slice(0, 260),
            detail: String((item && item.detail) || 'Completed').slice(0, 500),
            time: String((item && item.time) || new Date(createdAt).toLocaleString()).slice(0, 120),
            createdAt: createdAt,
            thumb: safeThumb,
            pinned: Boolean(item && item.pinned),
            favorite: Boolean(item && item.favorite),
            inputBytes: inputBytes,
            outputBytes: outputBytes
        };
    }

    function getDashboardHistory() {
        try {
            const raw = localStorage.getItem(DASHBOARD_HISTORY_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.map(normalizeDashboardHistoryItem).slice(0, DASHBOARD_HISTORY_LIMIT);
                }
            }
        }
        catch (error) {
            console.warn('Unable to read Dashboard 3.0 history.', error);
        }

        /* First-run migration from the existing 10-item converter history. */
        if (localStorage.getItem(DASHBOARD_MIGRATION_KEY) !== '1') {
            const migrated = getHistory().map(normalizeDashboardHistoryItem);
            localStorage.setItem(DASHBOARD_MIGRATION_KEY, '1');
            if (migrated.length) {
                saveDashboardHistory(migrated);
            }
            return migrated;
        }
        return [];
    }

    function saveDashboardHistory(history) {
        const normalized = history
            .map(normalizeDashboardHistoryItem)
            .slice(0, DASHBOARD_HISTORY_LIMIT);
        try {
            localStorage.setItem(DASHBOARD_MIGRATION_KEY, '1');
            localStorage.setItem(DASHBOARD_HISTORY_KEY, JSON.stringify(normalized));
        }
        catch (error) {
            const withoutThumbnails = normalized.map(item => ({
                ...item,
                thumb: ''
            }));
            try {
                localStorage.setItem(DASHBOARD_MIGRATION_KEY, '1');
                localStorage.setItem(DASHBOARD_HISTORY_KEY, JSON.stringify(withoutThumbnails));
                dashboardToast('History saved without thumbnails because browser storage is full.');
            }
            catch (storageError) {
                console.warn('Unable to save Dashboard 3.0 history.', storageError);
            }
        }
    }

    function dashboardDisplayPages(item) {
        const pages = dashboardParsePages(item.detail);
        return pages ? pages.toLocaleString() + ' pages' : '—';
    }

    function dashboardOutputBytes(item) {
        return Number(item.outputBytes) || dashboardParseBytes(item.detail) || 0;
    }

    function dashboardDisplayOutputSize(item) {
        const bytes = dashboardOutputBytes(item);
        return bytes ? formatBytes(bytes) : '—';
    }

    function dashboardSpaceSaved(item) {
        const input = Number(item.inputBytes) || 0;
        const output = dashboardOutputBytes(item);
        if (!input || !output) {
            return null;
        }
        return input - output;
    }

    function dashboardMeasuredSaved(history) {
        const measured = history
            .map(dashboardSpaceSaved)
            .filter(value => value !== null);
        return {
            count: measured.length,
            bytes: measured.reduce((sum, value) => sum + Math.max(0, value), 0)
        };
    }

    function dashboardFilteredHistory() {
        const query = dashboardRecentState.query.trim().toLowerCase();
        const format = dashboardRecentState.format;
        const special = dashboardRecentState.special;
        const items = getDashboardHistory().filter(item => {
            const itemFormat = dashboardFormatGroup(item.type);
            const matchesFormat = format === 'all' || itemFormat === format;
            const matchesSpecial = special === 'all'
                || (special === 'pinned' && item.pinned)
                || (special === 'favorite' && item.favorite);
            const haystack = [item.name, item.type, item.detail].join(' ').toLowerCase();
            const matchesQuery = !query || haystack.includes(query);
            return matchesFormat && matchesSpecial && matchesQuery;
        });

        items.sort((a, b) => {
            if (Boolean(a.pinned) !== Boolean(b.pinned)) {
                return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
            }
            if (dashboardRecentState.sort === 'oldest') {
                return dashboardHistoryTimestamp(a) - dashboardHistoryTimestamp(b);
            }
            if (dashboardRecentState.sort === 'largest') {
                return dashboardOutputBytes(b) - dashboardOutputBytes(a);
            }
            if (dashboardRecentState.sort === 'name') {
                return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                    numeric: true,
                    sensitivity: 'base'
                });
            }
            return dashboardHistoryTimestamp(b) - dashboardHistoryTimestamp(a);
        });

        return items;
    }

    function dashboardMostUsedFormat(history) {
        if (!history.length) {
            return {
                name: '—',
                count: 0
            };
        }
        const counts = {};
        history.forEach(item => {
            const format = dashboardFormatGroup(item.type);
            counts[format] = (counts[format] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return {
            name: sorted[0][0],
            count: sorted[0][1]
        };
    }

    function dashboardMonthItems(history) {
        const now = new Date();
        return history.filter(item => {
            const timestamp = dashboardHistoryTimestamp(item);
            if (!timestamp) {
                return false;
            }
            const date = new Date(timestamp);
            return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
        });
    }

    function renderDashboardOverview(history) {
        const totalPages = history.reduce((sum, item) => sum + dashboardParsePages(item.detail), 0);
        const monthItems = dashboardMonthItems(history);
        const mostUsed = dashboardMostUsedFormat(history);
        const last = history.slice().sort((a, b) => dashboardHistoryTimestamp(b) - dashboardHistoryTimestamp(a))[0];
        const favourites = history.filter(item => item.favorite).length;
        const pinned = history.filter(item => item.pinned).length;
        const saved = dashboardMeasuredSaved(history);

        $('dashboard-job-count').textContent = history.length.toLocaleString();
        $('dashboard-total-pages').textContent = totalPages.toLocaleString();
        $('dashboard-month-count').textContent = monthItems.length.toLocaleString();
        $('dashboard-favorite-count').textContent = favourites.toLocaleString();
        $('dashboard-pinned-copy').textContent = pinned + (pinned === 1 ? ' pinned' : ' pinned');
        $('dashboard-most-used').textContent = mostUsed.name;
        $('dashboard-most-used-copy').textContent = mostUsed.count
            ? mostUsed.count + (mostUsed.count === 1 ? ' recorded job' : ' recorded jobs')
            : 'No format data yet';

        if (saved.count) {
            $('dashboard-space-saved').textContent = formatBytes(saved.bytes);
            $('dashboard-space-saved-copy').textContent = saved.count + (saved.count === 1 ? ' measured job' : ' measured jobs');
        }
        else {
            $('dashboard-space-saved').textContent = '—';
            $('dashboard-space-saved-copy').textContent = 'Measured on new jobs';
        }

        if (last) {
            $('dashboard-last-output-name').textContent = last.name || 'Recent conversion';
            $('dashboard-last-output-meta').textContent = [
                dashboardFormatGroup(last.type),
                dashboardDisplayPages(last),
                dashboardDisplayOutputSize(last)
            ].filter(value => value && value !== '—').join(' · ') || (last.detail || 'Completed');
        }
        else {
            $('dashboard-last-output-name').textContent = 'No conversion yet';
            $('dashboard-last-output-meta').textContent = 'Complete a converter job and it will appear here.';
        }
    }

    function renderDashboardStorage(history) {
        const raw = localStorage.getItem(DASHBOARD_HISTORY_KEY) || '';
        const bytes = new Blob([raw]).size;
        const thumbnailCount = history.filter(item => Boolean(item.thumb)).length;
        $('dashboard-storage-size').textContent = formatBytes(bytes);
        $('dashboard-thumb-count').textContent = thumbnailCount.toLocaleString();
        $('dashboard-record-count').textContent = history.length + ' / ' + DASHBOARD_HISTORY_LIMIT;
    }

    function renderDashboardMonthlySummary(history) {
        const monthItems = dashboardMonthItems(history);
        const pages = monthItems.reduce((sum, item) => sum + dashboardParsePages(item.detail), 0);
        const output = monthItems.reduce((sum, item) => sum + dashboardOutputBytes(item), 0);
        const saved = dashboardMeasuredSaved(monthItems);
        const now = new Date();

        $('dashboard-month-label').textContent = now.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric'
        });
        $('dashboard-month-jobs').textContent = monthItems.length.toLocaleString();
        $('dashboard-month-pages').textContent = pages.toLocaleString();
        $('dashboard-month-output').textContent = output ? formatBytes(output) : '0 B';
        $('dashboard-month-saved').textContent = saved.count ? formatBytes(saved.bytes) : '—';
    }

    function renderDashboardSystemStatus() {
        const target = $('dashboard-system-status');
        if (!target) {
            return;
        }

        const checks = [
            {
                label: 'Local Storage',
                ok: (() => {
                    try {
                        const key = '__manga_studio_check__';
                        localStorage.setItem(key, '1');
                        localStorage.removeItem(key);
                        return true;
                    }
                    catch (error) {
                        return false;
                    }
                })()
            },
            {
                label: 'IndexedDB',
                ok: 'indexedDB' in window
            },
            {
                label: 'Web Worker',
                ok: 'Worker' in window
            },
            {
                label: 'Wake Lock',
                ok: 'wakeLock' in navigator
            }
        ];

        target.innerHTML = '';
        checks.forEach(check => {
            const row = document.createElement('div');
            const left = document.createElement('span');
            const dot = document.createElement('span');
            const value = document.createElement('span');

            row.className = 'system-status-item' + (check.ok ? ' ok' : '');
            left.className = 'system-status-label';
            dot.className = 'system-dot';
            value.className = 'system-status-value';

            left.append(dot, document.createTextNode(check.label));
            value.textContent = check.ok ? 'READY' : 'UNAVAILABLE';
            row.append(left, value);
            target.appendChild(row);
        });

        const readyCount = checks.filter(check => check.ok).length;
        const summary = $('dashboard-system-summary');
        summary.textContent = readyCount === checks.length ? 'SYSTEM READY' : readyCount + '/' + checks.length + ' READY';
        summary.style.color = readyCount === checks.length ? 'var(--good)' : 'var(--warn)';
    }

    function renderDashboardActivity(history) {
        const target = $('dashboard-activity-list');
        if (!target) {
            return;
        }
        target.innerHTML = '';

        if (!history.length) {
            const empty = document.createElement('div');
            empty.className = 'dashboard-activity-empty';
            empty.textContent = 'No activity yet. Completed converter jobs will appear here.';
            target.appendChild(empty);
            return;
        }

        history
            .slice()
            .sort((a, b) => dashboardHistoryTimestamp(b) - dashboardHistoryTimestamp(a))
            .slice(0, 6)
            .forEach(item => {
                const row = document.createElement('div');
                const marker = document.createElement('span');
                const copy = document.createElement('div');
                const title = document.createElement('b');
                const detail = document.createElement('span');
                const time = document.createElement('span');

                row.className = 'activity-item';
                marker.className = 'activity-marker';
                copy.className = 'activity-copy';
                time.className = 'activity-time';

                title.textContent = 'Completed ' + dashboardFormatGroup(item.type) + ' · ' + (item.name || 'Output');
                detail.textContent = item.detail || 'Conversion completed';
                time.textContent = item.time || '';

                copy.append(title, detail);
                row.append(marker, copy, time);
                target.appendChild(row);
            });
    }

    function renderDashboardWhatsNew() {
        const card = $('dashboard-whats-new');
        const grid = $('dashboard-lower-grid');
        if (!card || !grid) {
            return;
        }
        const dismissed = localStorage.getItem(DASHBOARD_WHATS_NEW_KEY) === '1';
        card.hidden = dismissed;
        grid.classList.toggle('single', dismissed);
    }

    function dashboardToast(message) {
        const toast = $('dashboard-toast');
        if (!toast) {
            return;
        }
        window.clearTimeout(dashboardToastTimer);
        toast.textContent = String(message || 'Done');
        toast.classList.add('show');
        dashboardToastTimer = window.setTimeout(() => {
            toast.classList.remove('show');
        }, 2600);
    }

    function updateDashboardHistoryItem(id, changes) {
        const history = getDashboardHistory();
        const target = history.find(item => item.id === id);
        if (!target) {
            return null;
        }
        Object.assign(target, changes || {});
        saveDashboardHistory(history);
        return target;
    }

    function removeDashboardHistoryItem(id) {
        const history = getDashboardHistory().filter(item => item.id !== id);
        saveDashboardHistory(history);
        if (dashboardSelectedHistoryId === id) {
            closeDashboardDetails();
        }
        renderDashboardRecent();
        dashboardToast('History item removed.');
    }

    function toggleDashboardPinned(id) {
        const history = getDashboardHistory();
        const target = history.find(item => item.id === id);
        if (!target) {
            return;
        }
        target.pinned = !target.pinned;
        saveDashboardHistory(history);
        renderDashboardRecent();
        if (dashboardSelectedHistoryId === id) {
            populateDashboardDetails(target);
        }
    }

    function toggleDashboardFavorite(id) {
        const history = getDashboardHistory();
        const target = history.find(item => item.id === id);
        if (!target) {
            return;
        }
        target.favorite = !target.favorite;
        saveDashboardHistory(history);
        renderDashboardRecent();
        if (dashboardSelectedHistoryId === id) {
            populateDashboardDetails(target);
        }
    }

    function dashboardPageSize() {
        return dashboardRecentState.view === 'list' ? 8 : 6;
    }

    function renderDashboardPagination(totalItems) {
        const box = $('dashboard-pagination');
        if (!box) {
            return;
        }
        const pageSize = dashboardPageSize();
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        dashboardRecentState.page = Math.min(Math.max(1, dashboardRecentState.page), totalPages);
        box.innerHTML = '';

        if (totalPages <= 1) {
            return;
        }

        function makeButton(label, page, active, disabled) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dashboard-page-btn' + (active ? ' active' : '');
            button.textContent = label;
            button.disabled = Boolean(disabled);
            if (!disabled) {
                button.addEventListener('click', () => {
                    dashboardRecentState.page = page;
                    renderDashboardRecent();
                    const section = document.querySelector('.dashboard-recent-section');
                    if (section) {
                        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            }
            return button;
        }

        box.appendChild(makeButton('‹', dashboardRecentState.page - 1, false, dashboardRecentState.page === 1));

        const pages = [];
        for (let page = 1; page <= totalPages; page++) {
            if (page === 1 || page === totalPages || Math.abs(page - dashboardRecentState.page) <= 1) {
                pages.push(page);
            }
        }

        let previous = 0;
        pages.forEach(page => {
            if (previous && page - previous > 1) {
                const gap = document.createElement('span');
                gap.textContent = '…';
                gap.style.color = 'var(--muted)';
                gap.style.fontSize = '9px';
                box.appendChild(gap);
            }
            box.appendChild(makeButton(String(page), page, page === dashboardRecentState.page, false));
            previous = page;
        });

        box.appendChild(makeButton('›', dashboardRecentState.page + 1, false, dashboardRecentState.page === totalPages));
    }

    function renderDashboardViewButtons() {
        const gridButton = $('dashboard-grid-view');
        const listButton = $('dashboard-list-view');
        const grid = $('dashboard-recent-grid');
        const isList = dashboardRecentState.view === 'list';
        gridButton.classList.toggle('active', !isList);
        listButton.classList.toggle('active', isList);
        grid.classList.toggle('list-view', isList);
    }

    function createDashboardRecentCard(item) {
        const card = document.createElement('article');
        const thumb = document.createElement('div');
        const badge = document.createElement('span');
        const status = document.createElement('span');
        const flags = document.createElement('div');
        const favoriteButton = document.createElement('button');
        const pinButton = document.createElement('button');
        const body = document.createElement('div');
        const title = document.createElement('b');
        const meta = document.createElement('span');
        const detailGrid = document.createElement('div');
        const pagesDetail = document.createElement('div');
        const pagesLabel = document.createElement('span');
        const pagesValue = document.createElement('b');
        const sizeDetail = document.createElement('div');
        const sizeLabel = document.createElement('span');
        const sizeValue = document.createElement('b');
        const foot = document.createElement('div');
        const time = document.createElement('span');
        const actions = document.createElement('div');
        const detailsButton = document.createElement('button');
        const removeButton = document.createElement('button');

        card.className = 'recent-conversion-card';
        thumb.className = 'recent-thumb';
        badge.className = 'recent-format-badge';
        status.className = 'recent-card-status';
        flags.className = 'recent-card-flags';
        favoriteButton.className = 'recent-flag-btn' + (item.favorite ? ' active' : '');
        pinButton.className = 'recent-flag-btn' + (item.pinned ? ' active' : '');
        body.className = 'recent-card-body';
        meta.className = 'recent-card-meta';
        detailGrid.className = 'recent-card-detail-grid';
        pagesDetail.className = 'recent-mini-detail';
        sizeDetail.className = 'recent-mini-detail';
        foot.className = 'recent-card-foot';
        time.className = 'recent-card-time';
        actions.className = 'recent-card-actions';
        detailsButton.className = 'recent-details-btn';
        removeButton.className = 'recent-remove-btn';

        favoriteButton.type = 'button';
        pinButton.type = 'button';
        detailsButton.type = 'button';
        removeButton.type = 'button';

        favoriteButton.title = item.favorite ? 'Remove favourite' : 'Add favourite';
        pinButton.title = item.pinned ? 'Unpin conversion' : 'Pin conversion';
        removeButton.title = 'Remove this dashboard history item';
        removeButton.setAttribute('aria-label', 'Remove ' + (item.name || 'history item'));

        favoriteButton.textContent = item.favorite ? '★' : '☆';
        pinButton.textContent = item.pinned ? 'PINNED' : 'PIN';
        badge.textContent = dashboardFormatGroup(item.type);
        status.textContent = 'COMPLETED';
        title.textContent = item.name || 'Recent conversion';
        meta.textContent = item.detail || 'Completed';
        pagesLabel.textContent = 'Pages';
        pagesValue.textContent = dashboardDisplayPages(item);
        sizeLabel.textContent = 'Output';
        sizeValue.textContent = dashboardDisplayOutputSize(item);
        time.textContent = item.time || '';
        detailsButton.textContent = 'DETAILS';
        removeButton.textContent = '×';

        favoriteButton.addEventListener('click', () => toggleDashboardFavorite(item.id));
        pinButton.addEventListener('click', () => toggleDashboardPinned(item.id));
        detailsButton.addEventListener('click', () => openDashboardDetails(item.id));
        removeButton.addEventListener('click', () => removeDashboardHistoryItem(item.id));

        if (item.thumb) {
            const image = document.createElement('img');
            image.src = item.thumb;
            image.alt = 'Thumbnail for ' + (item.name || 'recent conversion');
            thumb.appendChild(image);
        }
        else {
            const fallback = document.createElement('div');
            fallback.className = 'recent-thumb-fallback';
            fallback.textContent = dashboardFormatGroup(item.type);
            thumb.appendChild(fallback);
        }

        flags.append(favoriteButton, pinButton);
        thumb.append(badge, status, flags);
        pagesDetail.append(pagesLabel, pagesValue);
        sizeDetail.append(sizeLabel, sizeValue);
        detailGrid.append(pagesDetail, sizeDetail);
        actions.append(detailsButton, removeButton);
        foot.append(time, actions);
        body.append(title, meta, detailGrid, foot);
        card.append(thumb, body);

        return card;
    }

    function renderDashboardRecent() {
        const history = getDashboardHistory();
        const filtered = dashboardFilteredHistory();
        const grid = $('dashboard-recent-grid');

        if (!grid) {
            return;
        }

        renderDashboardOverview(history);
        renderDashboardStorage(history);
        renderDashboardMonthlySummary(history);
        renderDashboardSystemStatus();
        renderDashboardActivity(history);
        renderDashboardWhatsNew();
        renderDashboardViewButtons();

        const pageSize = dashboardPageSize();
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        dashboardRecentState.page = Math.min(Math.max(1, dashboardRecentState.page), totalPages);
        const start = (dashboardRecentState.page - 1) * pageSize;
        const pageItems = filtered.slice(start, start + pageSize);

        $('dashboard-result-count').textContent = filtered.length
            + (filtered.length === 1 ? ' ITEM' : ' ITEMS')
            + (filtered.length ? ' · PAGE ' + dashboardRecentState.page + '/' + totalPages : '');
        grid.innerHTML = '';

        if (!filtered.length) {
            const empty = document.createElement('div');
            const title = document.createElement('b');
            const copy = document.createElement('span');
            empty.className = 'dashboard-empty';

            if (history.length) {
                title.textContent = 'No matching conversions';
                copy.textContent = 'Try another search, format, pinned/favourite filter or sorting option.';
            }
            else {
                title.textContent = 'No recent conversions yet';
                copy.textContent = 'Open Converter and finish a job. Its thumbnail will appear here.';
            }

            empty.append(title, copy);
            grid.appendChild(empty);
            renderDashboardPagination(0);
            return;
        }

        pageItems.forEach(item => {
            grid.appendChild(createDashboardRecentCard(item));
        });
        renderDashboardPagination(filtered.length);
    }

    function populateDashboardDetails(item) {
        if (!item) {
            return;
        }
        const cover = $('dashboard-detail-cover');
        cover.innerHTML = '';
        if (item.thumb) {
            const image = document.createElement('img');
            image.src = item.thumb;
            image.alt = 'Thumbnail for ' + (item.name || 'conversion');
            cover.appendChild(image);
        }
        else {
            const fallback = document.createElement('div');
            fallback.className = 'dashboard-detail-fallback';
            fallback.textContent = dashboardFormatGroup(item.type);
            cover.appendChild(fallback);
        }

        const saved = dashboardSpaceSaved(item);
        $('dashboard-detail-title').textContent = item.name || 'Recent conversion';
        $('dashboard-detail-sub').textContent = item.detail || 'Completed conversion';
        $('dashboard-detail-format').textContent = dashboardFormatGroup(item.type);
        $('dashboard-detail-pages').textContent = dashboardDisplayPages(item);
        $('dashboard-detail-input').textContent = item.inputBytes ? formatBytes(item.inputBytes) : 'Not recorded';
        $('dashboard-detail-output').textContent = dashboardDisplayOutputSize(item);
        $('dashboard-detail-saved').textContent = saved === null
            ? 'Not measured'
            : saved >= 0
                ? formatBytes(saved)
                : '+' + formatBytes(Math.abs(saved));
        $('dashboard-detail-date').textContent = item.time || new Date(dashboardHistoryTimestamp(item)).toLocaleString();
        $('dashboard-detail-favorite').textContent = item.favorite ? '★ FAVOURITED' : '☆ FAVOURITE';
        $('dashboard-detail-pin').textContent = item.pinned ? 'UNPIN' : 'PIN';
    }

    function openDashboardDetails(id) {
        const item = getDashboardHistory().find(entry => entry.id === id);
        if (!item) {
            return;
        }
        dashboardSelectedHistoryId = id;
        populateDashboardDetails(item);
        $('dashboard-detail-backdrop').classList.add('open');
        $('dashboard-detail-drawer').classList.add('open');
        $('dashboard-detail-drawer').setAttribute('aria-hidden', 'false');
    }

    function closeDashboardDetails() {
        dashboardSelectedHistoryId = '';
        $('dashboard-detail-backdrop').classList.remove('open');
        $('dashboard-detail-drawer').classList.remove('open');
        $('dashboard-detail-drawer').setAttribute('aria-hidden', 'true');
    }

    function openDashboardModal(id) {
        closeDashboardModal();
        const modal = $(id);
        if (!modal) {
            return;
        }
        $('dashboard-modal-backdrop').classList.add('open');
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeDashboardModal() {
        $('dashboard-modal-backdrop').classList.remove('open');
        ['dashboard-about-modal', 'dashboard-changelog-modal'].forEach(id => {
            const modal = $(id);
            if (modal) {
                modal.classList.remove('open');
                modal.setAttribute('aria-hidden', 'true');
            }
        });
    }

    function exportDashboardHistory() {
        const history = getDashboardHistory();
        const payload = {
            app: 'Manga Studio Pro',
            dashboardVersion: '3.0',
            exportedAt: new Date().toISOString(),
            history: history
        };
        const blob = new Blob([
            JSON.stringify(payload, null, 2)
        ], {
            type: 'application/json'
        });
        const date = new Date().toISOString().slice(0, 10);
        downloadBlob(blob, 'manga-studio-dashboard-history-' + date + '.json');
        dashboardToast('Dashboard history exported.');
    }

    async function importDashboardHistoryFile(file) {
        if (!file) {
            return;
        }
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const imported = Array.isArray(parsed)
                ? parsed
                : Array.isArray(parsed.history)
                    ? parsed.history
                    : [];
            if (!imported.length) {
                throw new Error('No history records found in this JSON file.');
            }

            const current = getDashboardHistory();
            const merged = [];
            const seen = new Set();
            [...imported, ...current].forEach((item, index) => {
                const normalized = normalizeDashboardHistoryItem(item, index);
                const key = normalized.id || [normalized.name, normalized.createdAt].join('|');
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(normalized);
                }
            });
            merged.sort((a, b) => dashboardHistoryTimestamp(b) - dashboardHistoryTimestamp(a));
            saveDashboardHistory(merged);
            dashboardRecentState.page = 1;
            renderDashboardRecent();
            dashboardToast(Math.min(imported.length, DASHBOARD_HISTORY_LIMIT) + ' history record(s) imported.');
        }
        catch (error) {
            console.error(error);
            dashboardToast('Import failed: ' + (error && error.message ? error.message : 'invalid JSON'));
        }
    }

    function setDashboardView(mode) {
        dashboardRecentState.view = mode === 'list' ? 'list' : 'grid';
        dashboardRecentState.page = 1;
        localStorage.setItem(DASHBOARD_VIEW_KEY, dashboardRecentState.view);
        renderDashboardRecent();
    }

    $('dashboard-clear-history').onclick = () => {
        saveDashboardHistory([]);
        dashboardRecentState.page = 1;
        closeDashboardDetails();
        renderDashboardRecent();
        dashboardToast('Dashboard history cleared. Converter history was not changed.');
    };

    $('dashboard-clear-thumbnails').onclick = () => {
        const history = getDashboardHistory().map(item => ({
            ...item,
            thumb: ''
        }));
        saveDashboardHistory(history);
        renderDashboardRecent();
        dashboardToast('Dashboard thumbnails cleared.');
    };

    $('dashboard-export-history').onclick = exportDashboardHistory;
    $('dashboard-footer-backup').onclick = exportDashboardHistory;
    $('dashboard-import-history').onclick = () => $('dashboard-import-file').click();
    $('dashboard-import-file').addEventListener('change', async event => {
        const file = event.target.files && event.target.files[0];
        await importDashboardHistoryFile(file);
        event.target.value = '';
    });

    $('dashboard-history-search').addEventListener('input', event => {
        dashboardRecentState.query = event.target.value || '';
        dashboardRecentState.page = 1;
        renderDashboardRecent();
    });

    $('dashboard-format-filter').addEventListener('change', event => {
        dashboardRecentState.format = event.target.value || 'all';
        dashboardRecentState.page = 1;
        renderDashboardRecent();
    });

    $('dashboard-special-filter').addEventListener('change', event => {
        dashboardRecentState.special = event.target.value || 'all';
        dashboardRecentState.page = 1;
        renderDashboardRecent();
    });

    $('dashboard-sort-select').addEventListener('change', event => {
        dashboardRecentState.sort = event.target.value || 'newest';
        dashboardRecentState.page = 1;
        renderDashboardRecent();
    });

    $('dashboard-grid-view').onclick = () => setDashboardView('grid');
    $('dashboard-list-view').onclick = () => setDashboardView('list');

    $('dashboard-whats-new-dismiss').onclick = () => {
        localStorage.setItem(DASHBOARD_WHATS_NEW_KEY, '1');
        renderDashboardWhatsNew();
    };

    $('dashboard-detail-close').onclick = closeDashboardDetails;
    $('dashboard-detail-backdrop').onclick = closeDashboardDetails;
    $('dashboard-detail-open').onclick = () => {
        closeDashboardDetails();
        showConverterView();
    };
    $('dashboard-detail-pin').onclick = () => {
        if (dashboardSelectedHistoryId) {
            toggleDashboardPinned(dashboardSelectedHistoryId);
        }
    };
    $('dashboard-detail-favorite').onclick = () => {
        if (dashboardSelectedHistoryId) {
            toggleDashboardFavorite(dashboardSelectedHistoryId);
        }
    };
    $('dashboard-detail-remove').onclick = () => {
        if (dashboardSelectedHistoryId) {
            removeDashboardHistoryItem(dashboardSelectedHistoryId);
        }
    };

    $('dashboard-about-btn').onclick = () => openDashboardModal('dashboard-about-modal');
    $('dashboard-footer-about').onclick = () => openDashboardModal('dashboard-about-modal');
    $('dashboard-changelog-btn').onclick = () => openDashboardModal('dashboard-changelog-modal');
    $('dashboard-footer-changelog').onclick = () => openDashboardModal('dashboard-changelog-modal');
    $('dashboard-modal-backdrop').onclick = closeDashboardModal;
    qsa('.dashboard-modal-close').forEach(button => {
        button.addEventListener('click', closeDashboardModal);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeDashboardDetails();
            closeDashboardModal();
        }
    });
    async function exportFromPages(pages, format, name, inp) { let blob; if (format === 'pdf')
        blob = await makePdfBlob(pages, true);
    else
        blob = await makeArchiveBlob(pages, format, true); assertNotCancelled(); downloadBlob(blob, name + '.' + format); updateCompare(inp, blob.size); addHistory(format.toUpperCase(), name + '.' + format, pages.length + ' pages · ' + formatBytes(blob.size)); updateProgress(1, 1, format.toUpperCase() + ' COMPLETED'); return blob; }
    async function runSingleItem(it, format, index) { setItemStatus(it, 'processing', format.toUpperCase()); it.lastFormat = format; lastFormat = format; const f = it.file, name = renderTemplate(f, index), kind = typeOfFile(f); try {
        let blob, pages = 0;
        if (format === 'pdf' && kind === 'PDF') {
            const m = await optimizedMergePdf([f]);
            blob = m.blob;
            pages = m.pages;
            downloadBlob(blob, name + '.pdf');
            updateCompare(f.size, blob.size);
            addHistory('PDF', name + '.pdf', pages + ' pages · ' + formatBytes(blob.size), f);
        }
        else {
            const set = await buildPageSet([f], false);
            pages = set.pages.length;
            blob = format === 'pdf' ? await makePdfBlob(set.pages, true) : await makeArchiveBlob(set.pages, format, true);
            downloadBlob(blob, name + '.' + format);
            updateCompare(f.size, blob.size);
            addHistory(format.toUpperCase(), name + '.' + format, pages + ' pages · ' + formatBytes(blob.size), f);
            for (const d of set.docs) {
                try {
                    await d.destroy();
                }
                catch (e) { }
            }
        }
        setItemStatus(it, 'done', pages + ' pages');
        return blob;
    }
    catch (e) {
        if (e.message === '__CANCELLED__') {
            setItemStatus(it, 'cancelled', 'stopped');
            throw e;
        }
        setItemStatus(it, 'failed', e.message || 'error');
        throw e;
    } }
    async function runPrimary(format) { if (!queue.length)
        return alert('Pilih fail dulu!'); cancelled = false; disableMain(true); await requestWakeLock(); lastFormat = format; try {
        if ($('batch-toggle').checked && queue.length > 1) {
            for (let i = 0; i < queue.length; i++) {
                assertNotCancelled();
                try {
                    await runSingleItem(queue[i], format, i + 1);
                }
                catch (e) {
                    if (e.message === '__CANCELLED__')
                        throw e;
                    console.error(e);
                    continue;
                }
            }
            updateProgress(1, 1, 'BATCH COMPLETED');
        }
        else if (workspaceLoaded && workspacePages.length) {
            const name = renderTemplate(queue[0] && queue[0].file, 0);
            await exportFromPages(workspacePages, format, name, workspaceInputBytes || inputBytes());
            queue.forEach(it => setItemStatus(it, 'done', workspacePages.length + ' pages'));
        }
        else if (format === 'pdf' && queue.every(x => typeOfFile(x.file) === 'PDF')) {
            const m = await optimizedMergePdf(queueFiles()), name = renderTemplate(queue[0].file, 0);
            downloadBlob(m.blob, name + '.pdf');
            updateCompare(inputBytes(), m.blob.size);
            addHistory('PDF MERGE', name + '.pdf', m.pages + ' pages · ' + formatBytes(m.blob.size));
            queue.forEach(it => setItemStatus(it, 'done', 'merged'));
            updateProgress(1, 1, 'PDF COMPLETED');
        }
        else {
            const set = await buildPageSet(queueFiles(), false), name = renderTemplate(queue[0].file, 0), blob = format === 'pdf' ? await makePdfBlob(set.pages, true) : await makeArchiveBlob(set.pages, format, true);
            downloadBlob(blob, name + '.' + format);
            updateCompare(inputBytes(), blob.size);
            addHistory(format.toUpperCase(), name + '.' + format, set.pages.length + ' pages · ' + formatBytes(blob.size));
            queue.forEach(it => setItemStatus(it, 'done', set.pages.length + ' pages'));
            for (const d of set.docs) {
                try {
                    await d.destroy();
                }
                catch (e) { }
            }
            updateProgress(1, 1, format.toUpperCase() + ' COMPLETED');
        }
    }
    catch (e) {
        handleError(e);
    }
    finally {
        await releaseWakeLock();
        disableMain(false);
        cancelled = false;
    } }
    $('pdf-btn').onclick = () => runPrimary('pdf');
    $('cbz-btn').onclick = () => runPrimary('cbz');
    $('zip-btn').onclick = () => runPrimary('zip');
    async function retryItem(it) { if (!it.lastFormat)
        return; cancelled = false; disableMain(true); await requestWakeLock(); try {
        await runSingleItem(it, it.lastFormat, queue.indexOf(it) + 1);
    }
    catch (e) {
        handleError(e);
    }
    finally {
        await releaseWakeLock();
        disableMain(false);
    } }
    function parseRanges(v, total) { const out = []; for (const part0 of String(v || '').split(',')) {
        const part = part0.trim();
        if (!part)
            continue;
        let a, b;
        if (part.includes('-')) {
            const z = part.split('-');
            a = parseInt(z[0], 10);
            b = z[1].trim().toLowerCase() === 'end' ? total : parseInt(z[1], 10);
        }
        else
            a = b = parseInt(part, 10);
        if (!a || !b || a < 1 || b < a || a > total)
            throw new Error('Range tidak sah: ' + part);
        b = Math.min(total, b);
        out.push({ a: a, b: b, pages: workspacePages.slice(a - 1, b) });
    } if (!out.length)
        throw new Error('Masukkan page range.'); return out; }
    async function requireWorkspace() { if (!workspaceLoaded || !workspacePages.length) {
        await loadWorkspace();
        if (!workspacePages.length)
            throw new Error('Workspace kosong.');
    } }
    async function runTool(fn) { cancelled = false; disableMain(true); await requestWakeLock(); try {
        await fn();
    }
    catch (e) {
        handleError(e);
    }
    finally {
        await releaseWakeLock();
        disableMain(false);
        cancelled = false;
    } }
    $('split-btn').onclick = () => runTool(async () => { await requireWorkspace(); const parts = parseRanges($('split-ranges').value, workspacePages.length), fmt = $('split-format').value, bundle = new JSZip(), base = renderTemplate(queue[0] && queue[0].file, 0); for (let i = 0; i < parts.length; i++) {
        assertNotCancelled();
        updateProgress(i + 1, parts.length, 'BUILDING SPLIT ' + (i + 1));
        const blob = fmt === 'pdf' ? await makePdfBlob(parts[i].pages, false) : await makeArchiveBlob(parts[i].pages, fmt, false);
        bundle.file(base + '_p' + parts[i].a + '-' + parts[i].b + '.' + fmt, await blob.arrayBuffer());
    } const out = await bundle.generateAsync({ type: 'blob', compression: 'DEFLATE' }); downloadBlob(out, base + '_split.zip'); updateCompare(workspaceInputBytes, out.size); addHistory('SPLIT', base + '_split.zip', parts.length + ' parts'); $('tools-result').className = 'result-box'; $('tools-result').textContent = 'Split complete: ' + parts.map(x => x.a + '-' + x.b).join(', '); updateProgress(1, 1, 'SPLIT COMPLETED'); });
    $('extract-btn').onclick = () => runTool(async () => { await requireWorkspace(); const pages = selectedPages(), zip = new JSZip(); for (let i = 0; i < pages.length; i++) {
        updateProgress(i + 1, pages.length, 'EXTRACTING IMAGES');
        const o = await pageOutputBlob(pages[i], $('image-format').value, pages[i].id === coverPageId);
        zip.file(pad(i + 1, pages.length) + '.' + o.ext, await o.blob.arrayBuffer());
    } const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), name = renderTemplate(queue[0] && queue[0].file, 0) + '_images.zip'; downloadBlob(out, name); updateCompare(workspaceInputBytes, out.size); addHistory('EXTRACT', name, pages.length + ' images'); updateProgress(1, 1, 'EXTRACT COMPLETED'); });
    $('webtoon-btn').onclick = () => runTool(async () => { await requireWorkspace(); const pages = selectedPages(), width = Number($('webtoon-width').value), maxH = Number($('webtoon-height').value), zip = new JSZip(); let chunkCanvas = null, ctx = null, used = 0, chunk = 1; async function flush() { if (!chunkCanvas || used === 0)
        return; const out = document.createElement('canvas'); out.width = width; out.height = used; out.getContext('2d').drawImage(chunkCanvas, 0, 0, width, used, 0, 0, width, used); const b = await canvasBlob(out, 'image/jpeg', Number($('quality-range').value) / 100); zip.file('webtoon_' + pad(chunk, 99) + '.jpg', await b.arrayBuffer()); chunk++; chunkCanvas = null; ctx = null; used = 0; } for (let i = 0; i < pages.length; i++) {
        assertNotCancelled();
        updateProgress(i + 1, pages.length, 'STITCHING WEBTOON');
        const c = await processedCanvas(pages[i], { forceWidth: width, forceWhite: true }), h = c.height;
        if (h > maxH) {
            await flush();
            let y = 0;
            while (y < h) {
                const hh = Math.min(maxH, h - y), part = document.createElement('canvas');
                part.width = width;
                part.height = hh;
                part.getContext('2d').drawImage(c, 0, y, width, hh, 0, 0, width, hh);
                const b = await canvasBlob(part, 'image/jpeg', Number($('quality-range').value) / 100);
                zip.file('webtoon_' + pad(chunk++, 99) + '.jpg', await b.arrayBuffer());
                y += hh;
            }
            continue;
        }
        if (!chunkCanvas || used + h > maxH) {
            await flush();
            chunkCanvas = document.createElement('canvas');
            chunkCanvas.width = width;
            chunkCanvas.height = maxH;
            ctx = chunkCanvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, width, maxH);
        }
        ctx.drawImage(c, 0, used);
        used += h;
    } await flush(); const out = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), name = renderTemplate(queue[0] && queue[0].file, 0) + '_webtoon.zip'; downloadBlob(out, name); updateCompare(workspaceInputBytes, out.size); addHistory('WEBTOON', name, (chunk - 1) + ' strips'); $('tools-result').className = 'result-box'; $('tools-result').textContent = 'Webtoon built into ' + (chunk - 1) + ' safe vertical strip(s).'; updateProgress(1, 1, 'WEBTOON COMPLETED'); });
    async function dHash(page) { const c = await processedCanvas(page, { preview: true, previewWidth: 90 }), s = document.createElement('canvas'); s.width = 9; s.height = 8; const x = s.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, 9, 8); const d = x.getImageData(0, 0, 9, 8).data; let bits = ''; for (let y = 0; y < 8; y++)
        for (let xx = 0; xx < 8; xx++) {
            const a = (y * 9 + xx) * 4, b = (y * 9 + xx + 1) * 4, ga = d[a] + d[a + 1] + d[a + 2], gb = d[b] + d[b + 1] + d[b + 2];
            bits += ga > gb ? '1' : '0';
        } return bits; }
    function hamming(a, b) { let n = 0; for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            n++; return n; }
    $('duplicate-btn').onclick = () => runTool(async () => { await requireWorkspace(); duplicateIds.clear(); const hashes = [], pairs = []; for (let i = 0; i < workspacePages.length; i++) {
        assertNotCancelled();
        updateProgress(i + 1, workspacePages.length, 'HASHING PAGES');
        const h = await dHash(workspacePages[i]);
        for (let j = 0; j < hashes.length; j++) {
            const dist = hamming(h, hashes[j].hash);
            if (dist <= 4) {
                duplicateIds.add(workspacePages[i].id);
                pairs.push((j + 1) + ' ↔ ' + (i + 1) + ' (distance ' + dist + ')');
                break;
            }
        }
        hashes.push({ hash: h });
        if (i % 4 === 0)
            await sleepFrame();
    } renderPageGrid(); $('tools-result').className = 'result-box'; $('tools-result').textContent = pairs.length ? 'Possible duplicate pages:\n' + pairs.join('\n') : 'No near-duplicate pages detected.'; updateProgress(1, 1, 'DUPLICATE SCAN DONE'); });
    $('select-duplicates').onclick = () => { workspacePages.forEach(p => p.selected = duplicateIds.has(p.id)); renderPageGrid(); };
    function loadScript(url) { return new Promise((res, rej) => { if (window.Tesseract)
        return res(); const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
    $('ocr-btn').onclick = () => runTool(async () => { await requireWorkspace(); statusText.textContent = 'LOADING OCR ENGINE…'; await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'); const selected = workspacePages.filter(p => p.selected), pages = (selected.length ? selected : workspacePages.slice(0, 10)).slice(0, 12), lang = $('ocr-lang').value, worker = await Tesseract.createWorker(lang), hits = []; try {
        for (let i = 0; i < pages.length; i++) {
            assertNotCancelled();
            updateProgress(i + 1, pages.length, 'OCR PAGE ' + (workspacePages.indexOf(pages[i]) + 1));
            const c = await processedCanvas(pages[i], { preview: true, previewWidth: 1200 }), r = await worker.recognize(c), txt = (r.data.text || '').replace(/\s+/g, ' ').trim(), m = txt.match(/\b(?:chapter|chap(?:ter)?|ch\.?|episode|ep\.?|bab)\s*[#.:~-]?\s*([0-9]+(?:\.[0-9]+)?)/i) || txt.match(/第\s*[0-9０-９一二三四五六七八九十百]+\s*[話章]/);
            if (m)
                hits.push('Page ' + (workspacePages.indexOf(pages[i]) + 1) + ': ' + m[0] + '\n' + txt.slice(0, 180));
        }
    }
    finally {
        await worker.terminate();
    } $('tools-result').className = 'result-box'; $('tools-result').textContent = hits.length ? 'OCR chapter candidates:\n\n' + hits.join('\n\n') : 'No obvious chapter marker found in scanned pages.'; updateProgress(1, 1, 'OCR SCAN DONE'); });
    $('check-cbz').onclick = () => runTool(async () => { if (!queue.length)
        throw new Error('Pilih CBZ/ZIP dulu.'); const it = queue.find(x => ['CBZ', 'ZIP'].includes(typeOfFile(x.file))); if (!it)
        throw new Error('Tiada CBZ/ZIP dalam queue.'); const zip = await JSZip.loadAsync(it.file), names = Object.keys(zip.files), imgs = names.filter(n => /\.(jpg|jpeg|png|webp)$/i.test(n) && !zip.files[n].dir), junk = names.filter(n => n.includes('__MACOSX') || /(^|\/)\.DS_Store$/i.test(n)), nested = imgs.filter(n => n.includes('/')), comic = names.some(n => n.toLowerCase().endsWith('comicinfo.xml')), baseNames = imgs.map(n => n.split('/').pop().toLowerCase()), dupNames = [...new Set(baseNames.filter((n, i, a) => a.indexOf(n) !== i))]; $('tools-result').className = 'result-box'; $('tools-result').textContent = 'Archive: ' + it.file.name + '\nImages: ' + imgs.length + '\nComicInfo.xml: ' + (comic ? 'Yes' : 'No') + '\nNested image paths: ' + nested.length + '\nJunk entries: ' + junk.length + '\nDuplicate basenames: ' + dupNames.length + (junk.length ? '\nJunk: ' + junk.slice(0, 8).join(', ') : '') + (dupNames.length ? '\nDuplicate names: ' + dupNames.slice(0, 8).join(', ') : ''); updateProgress(1, 1, 'ARCHIVE CHECK DONE'); });
    $('repair-cbz').onclick = () => runTool(async () => { if (!workspaceLoaded)
        await requireWorkspace(); const blob = await makeArchiveBlob(workspacePages, 'cbz', true), name = renderTemplate(queue[0] && queue[0].file, 0) + '_repaired.cbz'; downloadBlob(blob, name); updateCompare(workspaceInputBytes || inputBytes(), blob.size); addHistory('CBZ REPAIR', name, workspacePages.length + ' normalized pages'); $('tools-result').className = 'result-box'; $('tools-result').textContent = 'Repaired CBZ created with clean sequential image names, junk excluded, current page order, cover rules and ComicInfo.xml.'; updateProgress(1, 1, 'CBZ REPAIR DONE'); });
    $('set-cover').onclick = () => { const s = workspacePages.filter(p => p.selected); if (s.length !== 1)
        return alert('Pilih tepat satu page sebagai cover.'); coverPageId = s[0].id; workspaceDirty = true; renderPageGrid(); };
    $('auto-cover').onclick = () => { if (!workspacePages.length)
        return alert('Load workspace dulu.'); coverPageId = workspacePages[0].id; renderPageGrid(); };
    $('replace-cover').onclick = () => $('cover-input').click();
    $('cover-input').onchange = e => { const f = e.target.files && e.target.files[0]; if (!f)
        return; const p = { id: 'p' + uid++, source: 'blob', blob: f, name: f.name, sourceName: 'Replacement Cover', rotation: 0, selected: false, width: null, height: null }; const idx = workspacePages.findIndex(x => x.id === coverPageId); if (idx >= 0)
        workspacePages[idx] = p;
    else
        workspacePages.unshift(p); coverPageId = p.id; workspaceDirty = true; renderPageGrid(); e.target.value = ''; };
    $('extract-cover').onclick = () => runTool(async () => { await requireWorkspace(); const p = workspacePages.find(x => x.id === coverPageId) || workspacePages[0], o = await pageOutputBlob(p, $('image-format').value, true), name = renderTemplate(queue[0] && queue[0].file, 0) + '_cover.' + o.ext; downloadBlob(o.blob, name); addHistory('COVER', name, formatBytes(o.blob.size)); updateProgress(1, 1, 'COVER EXTRACTED'); });
    async function inspectWorkspace() { await requireWorkspace(); let corrupt = [], minW = Infinity, minH = Infinity, maxW = 0, maxH = 0, portrait = 0, landscape = 0, formats = {}, names = new Set(), duplicateNames = 0, weirdNames = 0, totalPixels = 0; for (let i = 0; i < workspacePages.length; i++) {
        assertNotCancelled();
        updateProgress(i + 1, workspacePages.length, 'INSPECTING PAGES');
        const p = workspacePages[i], ext = p.source === 'pdf' ? 'pdf-page' : (extOf(p.name) || 'unknown');
        formats[ext] = (formats[ext] || 0) + 1;
        const key = p.name.toLowerCase();
        if (names.has(key))
            duplicateNames++;
        names.add(key);
        if (!p.name || p.name.length > 140 || /^\.|%[0-9a-f]{2}/i.test(p.name) || /\s{3,}/.test(p.name))
            weirdNames++;
        try {
            if (!p.width || !p.height) {
                const c = await rawCanvas(p, 120);
                if (!p.width || !p.height) {
                    p.width = c.width;
                    p.height = c.height;
                }
            }
            const w = p.width, h = p.height;
            minW = Math.min(minW, w);
            minH = Math.min(minH, h);
            maxW = Math.max(maxW, w);
            maxH = Math.max(maxH, h);
            totalPixels += w * h;
            if (w > h)
                landscape++;
            else
                portrait++;
        }
        catch (e) {
            corrupt.push(i + 1);
        }
        if (i % 5 === 0)
            await sleepFrame();
    } const avgPixels = workspacePages.length ? totalPixels / workspacePages.length : 0, q = Number($('quality-range').value) / 100, target = $('width-select').value, avgW = Math.sqrt(avgPixels * .7) || 1600, scale = target === 'original' ? 1 : Math.min(1, Number(target) / avgW), est = Math.round((workspaceInputBytes || inputBytes()) * Math.max(.18, Math.min(1.35, q * q * scale * scale + ($('image-format').value === 'png' ? .35 : .08)))); $('inspect-result').className = 'result-box'; $('inspect-result').textContent = 'Pages: ' + workspacePages.length + '\nInput files: ' + queue.length + '\nInput size: ' + formatBytes(workspaceInputBytes || inputBytes()) + '\nFormats: ' + Object.entries(formats).map(x => x[0] + ': ' + x[1]).join(', ') + '\nResolution range: ' + (isFinite(minW) ? Math.round(minW) + '×' + Math.round(minH) + ' → ' + Math.round(maxW) + '×' + Math.round(maxH) : 'unknown') + '\nPortrait: ' + portrait + ' · Landscape: ' + landscape + '\nUnreadable/corrupt pages: ' + corrupt.length + (corrupt.length ? ' (' + corrupt.slice(0, 20).join(', ') + ')' : '') + '\nDuplicate filenames: ' + duplicateNames + '\nSuspicious filenames: ' + weirdNames + '\nVisual duplicates flagged: ' + duplicateIds.size + '\nWorkspace modified: ' + (workspaceDirty ? 'Yes' : 'No') + '\nCover page: ' + (workspacePages.findIndex(p => p.id === coverPageId) + 1 || 'none'); $('estimate-result').className = 'result-box'; $('estimate-result').textContent = 'Estimated output: about ' + formatBytes(est) + '\nThis estimate is intentionally approximate; actual size depends on image content, selected format, crop, grayscale and compression.'; updateProgress(1, 1, 'INSPECTION DONE'); }
    $('inspect-btn').onclick = () => runTool(inspectWorkspace);
    function switchTab(name) { qsa('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name)); qsa('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name)); }
    qsa('.tab-btn').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    function handleError(e) { console.error(e); if (e && e.message === '__CANCELLED__') {
        resetProgress('CANCELLED');
        queue.filter(x => x.status === 'processing').forEach(x => setItemStatus(x, 'cancelled', 'stopped'));
    }
    else {
        resetProgress('ERROR');
        alert('Ralat: ' + (e && e.message ? e.message : 'process failed'));
    } }
    function setTheme(dark) {
        document.body.classList.toggle('dark', dark);
        localStorage.setItem('mangaStudioThemePro', dark ? 'dark' : 'light');
    }
    function showConverterView() {
        $('dashboard-view').classList.add('is-hidden');
        $('converter-vault').classList.remove('is-hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function showDashboardView() {
        $('converter-vault').classList.add('is-hidden');
        $('dashboard-view').classList.remove('is-hidden');
        renderDashboardRecent();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    $('theme-btn').onclick = () => {
        setTheme(!document.body.classList.contains('dark'));
    };
    $('dashboard-theme-btn').onclick = () => {
        setTheme(!document.body.classList.contains('dark'));
    };
    function initializeDashboardChrome() {
        const now = new Date();
        const hour = now.getHours();
        const greeting = hour < 12
            ? 'Good morning'
            : hour < 18
                ? 'Good afternoon'
                : 'Good evening';
        const startYear = 2026;
        const currentYear = now.getFullYear();
        $('dashboard-greeting').textContent = greeting;
        $('dashboard-year').textContent = currentYear > startYear
            ? startYear + '–' + currentYear
            : String(startYear);
    }

    $('dashboard-open-converter').onclick = showConverterView;
    $('dashboard-hero-open').onclick = showConverterView;
    $('back-dashboard').onclick = showDashboardView;
    const saved = localStorage.getItem('mangaStudioThemePro');
    setTheme(saved
        ? saved === 'dark'
        : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    initializeDashboardChrome();
    applyPreset('reader');
    renderQueue();
    renderHistory();
    renderDashboardRecent();
    renderPageGrid();
    resetProgress();
    updateNamePreview();
})();
