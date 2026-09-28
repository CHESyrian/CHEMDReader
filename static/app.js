const state = { nodes: [], files: new Map(), activePath: null, localMode: false, localFiles: new Map() };
const $ = (selector) => document.querySelector(selector);
const tree = $("#tree");

function setStatus(message) { $("#status-message").textContent = message; }
function setView(view) { ["#welcome-view", "#document-view", "#error-view"].forEach((id) => $(id).hidden = id !== view); }
function escapeHtml(value) { return value.replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char])); }
function countFiles(nodes) { return nodes.reduce((count, node) => count + (node.type === "file" ? 1 : countFiles(node.children || [])), 0); }
function renderTree(nodes, parent = tree) {
  parent.innerHTML = "";
  nodes.forEach((node, index) => {
    if (node.type === "directory") {
      const details = document.createElement("details"); details.className = "tree-directory"; details.open = index < 2;
      const summary = document.createElement("summary"); summary.className = "tree-item"; summary.innerHTML = `<span class="chevron">›</span><span>▾</span><span>${escapeHtml(node.name)}</span>`;
      const child = document.createElement("div"); child.className = "tree-children";
      details.append(summary, child); parent.append(details); renderTree(node.children, child);
    } else {
      const button = document.createElement("button"); button.className = "tree-item file-item"; button.dataset.path = node.path; button.innerHTML = `<span class="file-icon">▤</span><span>${escapeHtml(node.name.replace(/\.(markdown|mdown|mkdn)$/i, ".md"))}</span>`;
      button.addEventListener("click", () => openFile(node.path)); parent.append(button); state.files.set(node.path, node);
    }
  });
}
async function loadTree() {
  try { const response = await fetch("/api/tree"); if (!response.ok) throw new Error("Unable to load workspace"); const data = await response.json(); state.nodes = data.children; state.files.clear(); renderTree(state.nodes); $("#workspace-name").textContent = data.root; $("#file-count").textContent = countFiles(state.nodes); setStatus(`${countFiles(state.nodes)} documents available`); }
  catch (error) { tree.innerHTML = `<div class="tree-loading">${escapeHtml(error.message)}</div>`; setStatus("Workspace unavailable"); }
}
function updateActive(path) { document.querySelectorAll(".file-item").forEach((item) => item.classList.toggle("active", item.dataset.path === path)); }
function updateBreadcrumb(path) { const parts = path.split("/"); $("#breadcrumbs").innerHTML = `<span>Workspace</span><span class="crumb-separator">/</span><strong>${escapeHtml(parts.join(" / "))}</strong>`; }
function localMarkdown(raw) {
  const sourceLines = raw.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const formatInline = (value) => escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const splitTableCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => formatInline(cell.trim()));
  const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  let paragraph = [];
  const flushParagraph = () => { if (paragraph.length) { blocks.push(`<p>${paragraph.join("<br>")}</p>`); paragraph = []; } };
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    if (/^```(\w*)\s*$/.test(line)) {
      flushParagraph(); const language = line.match(/^```(\w*)/)[1]; const code = [];
      index += 1; while (index < sourceLines.length && !/^```\s*$/.test(sourceLines[index])) { code.push(sourceLines[index]); index += 1; }
      blocks.push(`<pre><code class="language-${language}">${escapeHtml(code.join("\n"))}</code></pre>`); continue;
    }
    if (line.includes("|") && index + 1 < sourceLines.length && isTableDivider(sourceLines[index + 1])) {
      flushParagraph(); const header = splitTableCells(line); const rows = []; index += 2;
      while (index < sourceLines.length && sourceLines[index].trim() && sourceLines[index].includes("|")) { rows.push(splitTableCells(sourceLines[index])); index += 1; }
      index -= 1;
      blocks.push(`<table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`); continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) { flushParagraph(); blocks.push("<hr>"); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); blocks.push(`<h${heading[1].length}>${formatInline(heading[2])}</h${heading[1].length}>`); continue; }
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(formatInline(line));
  }
  flushParagraph();
  return blocks.join("");
}
async function renderMermaidDiagrams(container) {
  if (!window.mermaid) return;
  const diagrams = [...container.querySelectorAll('pre > code.language-mermaid, pre > code.lang-mermaid')];
  if (!diagrams.length) return;
  window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: { darkMode: true, background: '#0b1020', primaryColor: '#312e81', primaryTextColor: '#eef2ff', primaryBorderColor: '#a78bfa', lineColor: '#5eead4', secondaryColor: '#172554', tertiaryColor: '#111827', fontFamily: 'Inter, system-ui, sans-serif' } });
  const nodes = diagrams.map((code, index) => { const diagram = document.createElement('div'); diagram.className = 'mermaid'; diagram.id = `mermaid-diagram-${Date.now()}-${index}`; diagram.textContent = code.textContent; code.parentElement.replaceWith(diagram); return diagram; });
  try { await window.mermaid.run({ nodes }); } catch (error) { nodes.forEach((node) => { node.classList.add('diagram-error'); node.textContent = 'Diagram could not be rendered. Check the Mermaid syntax.'; }); }
}
async function openFile(path) {
  setStatus("Opening document…"); updateActive(path); updateBreadcrumb(path); $("#sidebar").classList.remove("open"); $("#sidebar-backdrop").classList.remove("open");
  try {
    let data;
    if (state.localMode) { const file = state.localFiles.get(path); data = { name: file.name, path, html: localMarkdown(await file.text()), bytes: file.size }; }
    else { const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`); if (!response.ok) throw new Error((await response.json()).error || "Could not read file"); data = await response.json(); }
    $("#document-title").textContent = data.name.replace(/\.(markdown|mdown|mkdn|md)$/i, ""); $("#document-body").innerHTML = data.html; await renderMermaidDiagrams($("#document-body")); $("#document-size").textContent = `${Math.max(1, Math.round(data.bytes / 1024))} KB`; setView("#document-view"); setStatus(`Reading ${data.name}`); state.activePath = path;
  } catch (error) { $("#error-message").textContent = error.message; setView("#error-view"); setStatus("Unable to open document"); }
}
function flatten(nodes) { return nodes.flatMap((node) => node.type === "directory" ? flatten(node.children || []) : [node]); }
function openSearch() { $("#search-panel").hidden = false; $("#search-input").focus(); }
function searchFiles(term) { const results = flatten(state.nodes).filter((file) => file.name.toLowerCase().includes(term.toLowerCase()) || file.path.toLowerCase().includes(term.toLowerCase())); $("#search-results").innerHTML = results.length ? results.map((file) => `<button class="search-result" data-path="${escapeHtml(file.path)}">${escapeHtml(file.path)}</button>`).join("") : `<div class="tree-loading">No matching files</div>`; document.querySelectorAll(".search-result").forEach((button) => button.addEventListener("click", () => { openFile(button.dataset.path); $("#search-panel").hidden = true; })); }
function buildLocalTree(fileList) { const root = []; state.localFiles.clear(); [...fileList].filter((file) => /\.(md|markdown|mdown|mkdn)$/i.test(file.name)).forEach((file) => { const path = file.webkitRelativePath || file.name; const parts = path.split("/"); let level = root; parts.forEach((part, index) => { const isFile = index === parts.length - 1; if (isFile) { level.push({type:"file", name:part, path,}); state.localFiles.set(path, file); } else { let dir = level.find((node) => node.name === part && node.type === "directory"); if (!dir) { dir = {type:"directory", name:part, path:parts.slice(0,index+1).join("/"), children:[]}; level.push(dir); } level = dir.children; } }); }); state.nodes = root; state.localMode = true; renderTree(root); $("#workspace-status").textContent = "Browser folder"; $("#workspace-name").textContent = fileList[0]?.webkitRelativePath?.split("/")[0] || "Local folder"; $("#file-count").textContent = countFiles(root); setStatus(`${countFiles(root)} local documents available`); }
$("#open-folder").addEventListener("click", () => $("#folder-input").click()); $("#folder-input").addEventListener("change", (event) => buildLocalTree(event.target.files)); $("#search-toggle").addEventListener("click", () => openSearch()); $("#search-input").addEventListener("input", (event) => searchFiles(event.target.value)); $("#search-input").addEventListener("keydown", (event) => { if (event.key === "Escape") $("#search-panel").hidden = true; }); $("#open-sidebar").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#sidebar-backdrop").classList.add("open"); }); $("#close-sidebar").addEventListener("click", () => { $("#sidebar").classList.remove("open"); $("#sidebar-backdrop").classList.remove("open"); }); $("#sidebar-backdrop").addEventListener("click", () => $("#close-sidebar").click()); $("#retry-button").addEventListener("click", () => state.activePath && openFile(state.activePath)); document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); } }); loadTree();
