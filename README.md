# MDReader

A fast, private, one-page Markdown folder reader built with Flask, vanilla JavaScript, and CSS. It supports a secure server-side workspace plus optional browser-only folder selection.

## Features

- Recursive sidebar tree for Markdown files (`.md`, `.markdown`, `.mdown`, `.mkdn`)
- Secure `ROOT_DIR` sandbox with traversal protection and symlink skipping
- Markdown rendering with fenced code, tables, TOC, and Bleach sanitization
- Mermaid diagram rendering for fenced `mermaid` code blocks using a bundled local renderer
- Relative images served through a guarded `/api/asset` endpoint
- Search (`Cmd/Ctrl + K`), active-file highlighting, loading and error states
- Responsive mobile navigation and keyboard-friendly controls
- **Open local folder** uses `webkitdirectory` and renders selected files in-browser without uploading them
- Configurable file size limit via `MAX_FILE_BYTES`

## Run on Linux / macOS

```bash
cd mdreader
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ROOT_DIR=/path/to/your/docs python app.py
```

Open <http://127.0.0.1:5000>. If `ROOT_DIR` is omitted, the included `sample_docs/` folder is used.

## Run on Windows PowerShell

```powershell
cd mdreader
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
$env:ROOT_DIR = "C:\Users\you\Documents\docs"
py app.py
```

## API

- `GET /` — reader UI
- `GET /api/tree` — recursive Markdown tree
- `GET /api/file?path=guides/intro.md` — sanitized rendered HTML
- `GET /api/asset?path=images/diagram.png` — guarded image delivery

## Verification

```bash
pytest -q
```

The tests cover tree listing, traversal rejection, XSS sanitization, image URL rewriting, and file reading.

## Security notes

The server never accepts an arbitrary filesystem path. Every path is resolved beneath `ROOT_DIR`; hidden entries and symlinks are excluded; only Markdown files are readable through the file API; and rendered HTML is sanitized with an allowlist. Run behind a trusted local interface unless you add authentication for shared environments.

# CreatedBy : `CHESyrian` with help `MANUS AI`
