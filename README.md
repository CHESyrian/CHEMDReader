# CHEMDReader

CHEMDReader is a fast, private, one-page Markdown folder reader built with Flask, vanilla JavaScript, and CSS. It supports a secure server-side workspace plus optional browser-only folder selection.

## Features

- Recursive sidebar tree for Markdown files (`.md`, `.markdown`, `.mdown`, `.mkdn`)
- Secure `ROOT_DIR` sandbox with traversal protection and symlink skipping
- Markdown rendering with headings, paragraphs, lists, links, tables, blockquotes, fenced code, TOC, and Bleach sanitization
- Nested blockquotes using both standard `> >` syntax and compact `>>` / `>>>` markers
- Inline and display LaTeX math using `$...$` and `$$...$$`, rendered in the browser with MathJax
- Mermaid diagram rendering for fenced `mermaid` code blocks using Mermaid from the jsDelivr CDN
- Relative images served through a guarded `/api/asset` endpoint
- Search (`Cmd/Ctrl + K`), active-file highlighting, loading and error states
- Resizable/collapsible file sidebar, clickable document index, and light/dark theme toggle
- Live Markdown editor with split preview, server-side save, and browser-folder download fallback
- Responsive mobile navigation and keyboard-friendly controls
- **Open local folder** uses `webkitdirectory` and renders selected files in-browser without uploading them
- Configurable file size limit via `MAX_FILE_BYTES`

### LaTeX math

Write standard dollar-delimited math in any Markdown document:

```markdown
The normal distribution uses $\\mu$ and $\\sigma$.

$$
f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}
\\exp\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)
$$
```

Both server-rendered documents and browser-local folders use MathJax. The page loads MathJax from jsDelivr, so an internet connection is required for formula typesetting in the browser. Math inside fenced code blocks and inline code remains code.

### Blockquotes

Use `>` for a single quote level. Nested quotes can use standard Markdown spacing or compact markers:

```markdown
> This is the outer quote.
>> This is a nested quote.
>>> This is a third-level quote.
```

CHEMDReader renders these as semantic nested `<blockquote>` elements in both server and browser-local modes. Each level has its own visual rail and spacing. Quote markers inside fenced code blocks are preserved as code instead of being rendered. For separate paragraphs within a nested quote, place a blank quote line between them:

```markdown
> First quoted paragraph.
>
> Second quoted paragraph.
```

The rendering paths also preserve Markdown links and ordered/unordered list structure, including nested lists, in the live editor preview and local-folder mode.

## Requirements

- Python 3.14 or newer
- A modern browser with JavaScript enabled
- Network access to jsDelivr for Mermaid and MathJax CDN assets

## Installation and usage

### Linux / macOS

```bash
cd CHEMDReader
python3.14 -m venv .venv
source .venv/bin/activate
python3.14 -m pip install -r requirements.txt
ROOT_DIR=/path/to/your/docs python3 app.py
```

Open <http://127.0.0.1:5000>. If `ROOT_DIR` is omitted, the included `sample_docs/` folder is used.

The project metadata also supports editable installation with test dependencies:

```bash
python3.14 -m pip install -e ".[test]"
```

### Launcher script

The executable `bin/mdreader` activates the existing shared `~/PyVenv` environment and starts the server without opening a browser. It does not create environments, install packages, or write setup markers; prepare `~/PyVenv` separately first:

```bash
python3.14 -m venv ~/PyVenv
~/PyVenv/bin/python -m pip install -r requirements.txt
bin/mdreader /path/to/your/docs
bin/mdreader --help
```

### Windows PowerShell

```powershell
cd CHEMDReader
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
$env:ROOT_DIR = "C:\Users\you\Documents\docs"
py app.py
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `ROOT_DIR` | `sample_docs/` | Folder that the server can read and edit |
| `MAX_FILE_BYTES` | `2097152` | Maximum Markdown request/file size |
| `HOST` | `127.0.0.1` | Flask bind host |
| `PORT` | `5000` | Flask bind port |
| `FLASK_DEBUG` | unset | Set to `1` to enable Flask debug mode |

## API

- `GET /` — reader UI
- `GET /api/tree` — recursive Markdown tree
- `GET /api/file?path=guides/intro.md` — raw Markdown, sanitized rendered HTML, and document index
- `POST /api/file` — save edited Markdown content beneath `ROOT_DIR`
- `POST /api/preview` — render unsaved Markdown for live preview without writing it
- `GET /api/asset?path=images/diagram.png` — guarded image delivery

## Project layout

```text
app.py                 Flask application and secure Markdown API
static/                CSS, JavaScript, MathJax config, and brand assets
templates/index.html   Single-page reader shell
sample_docs/           Example Markdown workspace
tests/                 Backend regression tests
bin/mdreader           Optional shared-virtual-environment launcher
pyproject.toml         Project metadata and pytest configuration
requirements.txt       Direct runtime and test dependencies
```

## Verification

Run the test suite from the project root:

```bash
python3 -m pytest -q
python3 -m py_compile app.py tests/test_app.py
node --check static/app.js
node --check static/mathjax-config.js
```

The tests cover tree listing, traversal rejection, XSS sanitization, image URL rewriting, Mermaid fences, tables, horizontal rules, links, nested lists, blockquotes, document indexes, editor preview/save behavior, and inline/display LaTeX rendering.

## Security notes

The server never accepts an arbitrary filesystem path. Every path is resolved beneath `ROOT_DIR`; hidden entries and symlinks are excluded; only Markdown files are readable through the file API; and rendered HTML is sanitized with an allowlist. Run behind a trusted local interface unless you add authentication for shared environments.
