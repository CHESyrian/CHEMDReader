const state = { nodes: [], files: new Map(), activePath: null, currentRaw: '', localMode: false, localFiles: new Map(), localDrafts: new Map(), index: [], previewTimer: null };
const $ = (selector) => document.querySelector(selector);
const shell = document.querySelector('.app-shell');
const tree = $('#tree');

function setStatus(message) { $('#status-message').textContent = message; }
function setView(view) { ['#welcome-view', '#document-view', '#error-view'].forEach((id) => { $(id).hidden = id !== view; }); }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function countFiles(nodes) { return nodes.reduce((count, node) => count + (node.type === 'file' ? 1 : countFiles(node.children || [])), 0); }
function renderTree(nodes, parent = tree) {
  parent.innerHTML = '';
  nodes.forEach((node, index) => {
    if (node.type === 'directory') {
      const details = document.createElement('details'); details.className = 'tree-directory'; details.open = index < 2;
      const summary = document.createElement('summary'); summary.className = 'tree-item'; summary.innerHTML = `<span class="chevron">›</span><span>▾</span><span>${escapeHtml(node.name)}</span>`;
      const child = document.createElement('div'); child.className = 'tree-children'; details.append(summary, child); parent.append(details); renderTree(node.children, child);
    } else {
      const button = document.createElement('button'); button.className = 'tree-item file-item'; button.dataset.path = node.path;
      button.innerHTML = `<span class="file-icon">▤</span><span>${escapeHtml(node.name.replace(/\.(markdown|mdown|mkdn)$/i, '.md'))}</span>`;
      button.addEventListener('click', () => openFile(node.path)); parent.append(button); state.files.set(node.path, node);
    }
  });
}
async function loadTree() {
  try { const response = await fetch('/api/tree'); if (!response.ok) throw new Error('Unable to load workspace'); const data = await response.json(); state.nodes = data.children; state.files.clear(); renderTree(state.nodes); $('#workspace-name').textContent = data.root; $('#file-count').textContent = countFiles(state.nodes); setStatus(`${countFiles(state.nodes)} documents available`); }
  catch (error) { tree.innerHTML = `<div class="tree-loading">${escapeHtml(error.message)}</div>`; setStatus('Workspace unavailable'); }
}
function updateActive(path) { document.querySelectorAll('.file-item').forEach((item) => item.classList.toggle('active', item.dataset.path === path)); }
function updateBreadcrumb(path) { $('#breadcrumbs').innerHTML = `<span>Workspace</span><span class="crumb-separator">/</span><strong>${escapeHtml(path.split('/').join(' / '))}</strong>`; }
function slugify(value) { return value.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'); }
function formatInline(value) {
  const tokens = [];
  const stash = (type, content) => { const token = `CHEMDREADERTOKEN${tokens.length}X`; tokens.push({ type, content }); return token; };
  let prepared = value.replace(/(`+)([\s\S]*?)\1/g, (_match, delimiter, content) => stash('code', content));
  prepared = prepared.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g, (_match, display, inline) => stash(display !== undefined ? 'display' : 'inline', display ?? inline));
  prepared = prepared.replace(/\[([^\]\n]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_match, label, href, title) => stash('link', { label, href, title }));
  const formatted = escapeHtml(prepared).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return formatted.replace(/CHEMDREADERTOKEN(\d+)X/g, (_match, index) => {
    const token = tokens[Number(index)];
    if (token.type === 'code') return `<code>${escapeHtml(token.content)}</code>`;
    if (token.type === 'link') {
      const href = token.content.href.trim();
      const unsafe = /^(?:javascript|vbscript|data):/i.test(href);
      if (unsafe) return escapeHtml(token.content.label);
      const title = token.content.title ? ` title="${escapeHtml(token.content.title)}"` : '';
      return `<a href="${escapeHtml(href)}"${title}>${escapeHtml(token.content.label)}</a>`;
    }
    const latex = escapeHtml(token.content);
    return token.type === 'display' ? `<span class="math-display">\\[${latex}\\]</span>` : `<span class="math-inline">\\(${latex}\\)</span>`;
  });
}
function localMarkdown(raw) {
  const sourceLines = raw.replace(/\r\n?/g, '\n').split('\n'); const blocks = []; const splitTableCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => formatInline(cell.trim())); const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line); const parseListItem = (line) => { const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/); return match ? { indent: match[1].length, ordered: /^\d/.test(match[2]), content: match[3] } : null; }; const parseBlockquoteLine = (line) => { const match = line.match(/^\s*((?:>\s*)+)(.*)$/); if (!match) return null; return { depth: (match[1].match(/>/g) || []).length, content: match[2].trim() }; }; let paragraph = [];
  const flushParagraph = () => { if (paragraph.length) { blocks.push(`<p>${paragraph.join('<br>')}</p>`); paragraph = []; } };
  const renderBlockquote = (start) => {
    let index = start; let depth = 0; let markup = '';
    while (index < sourceLines.length) {
      const quote = parseBlockquoteLine(sourceLines[index]); if (!quote) break;
      while (depth < quote.depth) { markup += '<blockquote>'; depth += 1; }
      while (depth > quote.depth) { markup += '</blockquote>'; depth -= 1; }
      if (quote.content) markup += `<p>${formatInline(quote.content)}</p>`;
      index += 1;
    }
    while (depth > 0) { markup += '</blockquote>'; depth -= 1; }
    return [markup, index];
  };
  const renderList = (start, baseIndent, ordered) => {
    const tag = ordered ? 'ol' : 'ul'; const items = []; let index = start;
    while (index < sourceLines.length) {
      const item = parseListItem(sourceLines[index]);
      if (!item || item.indent !== baseIndent || item.ordered !== ordered) break;
      let content = `<li>${formatInline(item.content)}`; index += 1;
      while (index < sourceLines.length) {
        const nested = parseListItem(sourceLines[index]);
        if (!nested || nested.indent <= baseIndent) break;
        const [nestedMarkup, nextIndex] = renderList(index, nested.indent, nested.ordered);
        content += nestedMarkup; index = nextIndex;
      }
      items.push(`${content}</li>`);
    }
    return [`<${tag}>${items.join('')}</${tag}>`, index];
  };
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    if (/^```(\w*)\s*$/.test(line)) { flushParagraph(); const language = line.match(/^```(\w*)/)[1]; const code = []; index += 1; while (index < sourceLines.length && !/^```\s*$/.test(sourceLines[index])) { code.push(sourceLines[index]); index += 1; } blocks.push(`<pre><code class="language-${language}">${escapeHtml(code.join('\n'))}</code></pre>`); continue; }
    if (line.includes('|') && index + 1 < sourceLines.length && isTableDivider(sourceLines[index + 1])) { flushParagraph(); const header = splitTableCells(line); const rows = []; index += 2; while (index < sourceLines.length && sourceLines[index].trim() && sourceLines[index].includes('|')) { rows.push(splitTableCells(sourceLines[index])); index += 1; } index -= 1; blocks.push(`<table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue; }
    if (parseBlockquoteLine(line)) { flushParagraph(); const [quoteMarkup, nextIndex] = renderBlockquote(index); blocks.push(quoteMarkup); index = nextIndex - 1; continue; }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { flushParagraph(); blocks.push('<hr>'); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/); if (heading) { flushParagraph(); const title = heading[2]; blocks.push(`<h${heading[1].length} id="${slugify(title)}">${formatInline(title)}</h${heading[1].length}>`); continue; }
    const listItem = parseListItem(line);
    if (listItem) { flushParagraph(); const [listMarkup, nextIndex] = renderList(index, listItem.indent, listItem.ordered); blocks.push(listMarkup); index = nextIndex - 1; continue; }
    if (!line.trim()) { flushParagraph(); continue; } paragraph.push(formatInline(line));
  }
  flushParagraph(); return restoreLocalDisplayMath(blocks.join(''));
}
function restoreLocalDisplayMath(markup) { return markup.replace(/<p>\s*\$\$<br>([\s\S]*?)<br>\$\$\s*<\/p>/g, (_match, latex) => `<p><span class="math-display">\\[${latex.replace(/<br>/g, '\n')}\\]</span></p>`); }
function buildIndexFrom(container) { return [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading, index) => { if (!heading.id) heading.id = `${slugify(heading.textContent)}-${index}`; return { id: heading.id, name: heading.textContent, level: Number(heading.tagName.substring(1)) }; }); }
function buildIndexFromDocument() { return buildIndexFrom($('#document-body')); }
function renderIndex(entries = []) { state.index = entries; const list = $('#toc-list'); list.innerHTML = ''; if (!entries.length) { list.innerHTML = '<div class="toc-empty">No headings in this document.</div>'; return; } entries.forEach((entry) => { const link = document.createElement('button'); link.className = 'toc-link'; link.style.paddingLeft = `${8 + Math.max(0, entry.level - 1) * 12}px`; link.textContent = entry.name; link.title = entry.name; link.addEventListener('click', () => document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); list.append(link); }); }
async function renderMermaidDiagrams(container) { if (!window.mermaid) return; const diagrams = [...container.querySelectorAll('pre > code.language-mermaid, pre > code.lang-mermaid')]; if (!diagrams.length) return; window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: { darkMode: !document.body.classList.contains('light-theme'), background: 'transparent', primaryColor: '#312e81', primaryTextColor: '#eef2ff', primaryBorderColor: '#a78bfa', lineColor: '#5eead4', secondaryColor: '#172554', tertiaryColor: '#111827', fontFamily: 'Inter, system-ui, sans-serif' } }); const nodes = diagrams.map((code, index) => { const diagram = document.createElement('div'); diagram.className = 'mermaid'; diagram.id = `mermaid-diagram-${Date.now()}-${index}`; diagram.textContent = code.textContent; code.parentElement.replaceWith(diagram); return diagram; }); try { await window.mermaid.run({ nodes }); } catch (error) { nodes.forEach((node) => { node.classList.add('diagram-error'); node.textContent = 'Diagram could not be rendered. Check the Mermaid syntax.'; }); } }
async function renderMath(container) { if (!window.MathJax?.typesetPromise || !container) return; try { window.MathJax.typesetClear?.([container]); await window.MathJax.typesetPromise([container]); } catch (error) { console.warn('MathJax could not typeset this document.', error); } }
async function renderServerPreview(raw) { const response = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: raw }) }); if (!response.ok) return localMarkdown(raw); return (await response.json()).html; }
async function updateEditorPreview() { const preview = $('#editor-preview'); preview.innerHTML = state.localMode ? localMarkdown($('#markdown-editor').value) : await renderServerPreview($('#markdown-editor').value); await renderMermaidDiagrams(preview); await renderMath(preview); renderIndex(buildIndexFrom(preview)); $('#preview-status').textContent = 'Live'; $('#save-state').textContent = 'Unsaved changes'; }
function queueEditorPreview() { clearTimeout(state.previewTimer); state.previewTimer = setTimeout(updateEditorPreview, 140); }
function setEditorMode(editing) { $('#edit-layout').hidden = !editing; $('#document-body').hidden = editing; $('#edit-toggle').hidden = editing; $('#save-document').hidden = !editing; $('#download-document').hidden = !editing; if (editing) { $('#markdown-editor').focus(); updateEditorPreview(); } }
async function openFile(path) {
  setStatus('Opening document…'); updateActive(path); updateBreadcrumb(path); $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').classList.remove('open');
  try {
    let data;
    if (state.localMode) { const file = state.localFiles.get(path); const raw = state.localDrafts.get(path) ?? await file.text(); data = { name: file.name, path, raw, html: localMarkdown(raw), bytes: raw.length, index: [] }; }
    else { const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`); if (!response.ok) throw new Error((await response.json()).error || 'Could not read file'); data = await response.json(); }
    state.activePath = path; state.currentRaw = data.raw || ''; $('#document-title').textContent = data.name.replace(/\.(markdown|mdown|mkdn|md)$/i, ''); $('#document-body').innerHTML = data.html; await renderMermaidDiagrams($('#document-body')); await renderMath($('#document-body')); renderIndex(data.index?.length ? data.index : buildIndexFromDocument()); $('#markdown-editor').value = state.currentRaw; $('#document-size').textContent = `${Math.max(1, Math.round(data.bytes / 1024))} KB`; $('#save-state').textContent = 'Saved'; setEditorMode(false); setView('#document-view'); setStatus(`Reading ${data.name}`);
  } catch (error) { $('#error-message').textContent = error.message; setView('#error-view'); setStatus('Unable to open document'); }
}
async function saveDocument() {
  const raw = $('#markdown-editor').value; if (!state.activePath) return; $('#save-document').disabled = true; $('#save-state').textContent = 'Saving…';
  try {
    let data;
    if (state.localMode) { state.localDrafts.set(state.activePath, raw); data = { raw, html: localMarkdown(raw), index: [] }; downloadDocument(raw, false); }
    else { const response = await fetch('/api/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: state.activePath, content: raw }) }); if (!response.ok) throw new Error((await response.json()).error || 'Could not save file'); data = await response.json(); }
    state.currentRaw = raw; $('#document-body').innerHTML = data.html; await renderMermaidDiagrams($('#document-body')); await renderMath($('#document-body')); renderIndex(data.index?.length ? data.index : buildIndexFromDocument()); $('#document-size').textContent = `${Math.max(1, Math.round(raw.length / 1024))} KB`; $('#save-state').textContent = state.localMode ? 'Draft saved · downloaded' : 'Saved'; setStatus(state.localMode ? 'Draft updated and downloaded' : 'Changes saved');
  } catch (error) { $('#save-state').textContent = 'Save failed'; setStatus(error.message); } finally { $('#save-document').disabled = false; }
}
function downloadDocument(raw = $('#markdown-editor').value, announce = true) { const blob = new Blob([raw], { type: 'text/markdown;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = state.activePath?.split('/').pop() || 'document.md'; link.click(); URL.revokeObjectURL(link.href); if (announce) setStatus('Markdown downloaded'); }
function flatten(nodes) { return nodes.flatMap((node) => node.type === 'directory' ? flatten(node.children || []) : [node]); }
function openSearch() { $('#search-panel').hidden = false; $('#search-input').focus(); }
function searchFiles(term) { const results = flatten(state.nodes).filter((file) => file.name.toLowerCase().includes(term.toLowerCase()) || file.path.toLowerCase().includes(term.toLowerCase())); $('#search-results').innerHTML = results.length ? results.map((file) => `<button class="search-result" data-path="${escapeHtml(file.path)}">${escapeHtml(file.path)}</button>`).join('') : '<div class="tree-loading">No matching files</div>'; document.querySelectorAll('.search-result').forEach((button) => button.addEventListener('click', () => { openFile(button.dataset.path); $('#search-panel').hidden = true; })); }
function buildLocalTree(fileList) { const root = []; state.localFiles.clear(); state.localDrafts.clear(); [...fileList].filter((file) => /\.(md|markdown|mdown|mkdn)$/i.test(file.name)).forEach((file) => { const path = file.webkitRelativePath || file.name; const parts = path.split('/'); let level = root; parts.forEach((part, index) => { const isFile = index === parts.length - 1; if (isFile) { level.push({ type: 'file', name: part, path }); state.localFiles.set(path, file); } else { let dir = level.find((node) => node.name === part && node.type === 'directory'); if (!dir) { dir = { type: 'directory', name: part, path: parts.slice(0, index + 1).join('/'), children: [] }; level.push(dir); } level = dir.children; } }); }); state.nodes = root; state.localMode = true; renderTree(root); $('#workspace-status').textContent = 'Browser folder'; $('#workspace-name').textContent = fileList[0]?.webkitRelativePath?.split('/')[0] || 'Local folder'; $('#file-count').textContent = countFiles(root); setStatus(`${countFiles(root)} local documents available`); }
function setTheme(theme) { document.body.classList.toggle('light-theme', theme === 'light'); localStorage.setItem('chemdreader-theme', theme); $('#theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`); }
function resizeSidebar(event) { const width = Math.min(420, Math.max(220, event.clientX)); document.documentElement.style.setProperty('--sidebar-width', `${width}px`); localStorage.setItem('chemdreader-sidebar-width', `${width}px`); }
$('#open-folder').addEventListener('click', () => $('#folder-input').click()); $('#folder-input').addEventListener('change', (event) => buildLocalTree(event.target.files)); $('#search-toggle').addEventListener('click', openSearch); $('#search-input').addEventListener('input', (event) => searchFiles(event.target.value)); $('#search-input').addEventListener('keydown', (event) => { if (event.key === 'Escape') $('#search-panel').hidden = true; }); $('#collapse-sidebar').addEventListener('click', () => shell.classList.toggle('sidebar-collapsed')); $('#collapse-toc').addEventListener('click', () => shell.classList.toggle('toc-collapsed')); $('#sidebar-resizer').addEventListener('pointerdown', (event) => { event.preventDefault(); $('#sidebar-resizer').setPointerCapture(event.pointerId); $('#sidebar-resizer').addEventListener('pointermove', resizeSidebar); $('#sidebar-resizer').addEventListener('pointerup', () => $('#sidebar-resizer').removeEventListener('pointermove', resizeSidebar), { once: true }); }); $('#theme-toggle').addEventListener('click', () => setTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light')); $('#edit-toggle').addEventListener('click', () => setEditorMode(true)); $('#save-document').addEventListener('click', saveDocument); $('#download-document').addEventListener('click', () => downloadDocument()); $('#markdown-editor').addEventListener('input', queueEditorPreview); $('#open-sidebar').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#sidebar-backdrop').classList.add('open'); }); $('#close-sidebar').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').classList.remove('open'); }); $('#sidebar-backdrop').addEventListener('click', () => $('#close-sidebar').click()); $('#retry-button').addEventListener('click', () => state.activePath && openFile(state.activePath));
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !$('#edit-layout').hidden) { event.preventDefault(); saveDocument(); } });
const savedWidth = localStorage.getItem('chemdreader-sidebar-width'); if (savedWidth) document.documentElement.style.setProperty('--sidebar-width', savedWidth); setTheme(localStorage.getItem('chemdreader-theme') || 'dark'); loadTree();
