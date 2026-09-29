"""Secure Markdown folder reader built with Flask."""
from __future__ import annotations

import mimetypes
import os
import re
from pathlib import Path
from urllib.parse import quote, unquote

import bleach
import markdown
from flask import Flask, abort, jsonify, render_template, request, send_file
from markupsafe import Markup

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_ROOT = BASE_DIR / "sample_docs"
ROOT_DIR = Path(os.environ.get("ROOT_DIR", DEFAULT_ROOT)).expanduser().resolve()
ALLOWED_EXTENSIONS = {".md", ".markdown", ".mdown", ".mkdn"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"}
MAX_FILE_BYTES = int(os.environ.get("MAX_FILE_BYTES", str(2 * 1024 * 1024)))

app = Flask(__name__)
app.config.update(JSON_SORT_KEYS=False, MAX_CONTENT_LENGTH=MAX_FILE_BYTES)

ALLOWED_TAGS = {
    # HTML document and text elements.
    "a", "abbr", "address", "article", "aside", "audio", "b", "bdi", "bdo", "blockquote",
    "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup", "data",
    "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "fieldset",
    "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
    "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd", "label",
    "legend", "li", "link", "main", "map", "mark", "menu", "meta", "meter", "nav", "noscript",
    "object", "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q",
    "rp", "rt", "ruby", "s", "samp", "search", "section", "select", "slot", "small",
    "source", "span", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td",
    "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track", "u", "ul",
    "var", "video", "wbr",
    # SVG elements commonly emitted by diagrams and icons.
    "svg", "animate", "circle", "clipPath", "defs", "ellipse", "g", "image", "line", "linearGradient",
    "marker", "mask", "path", "pattern", "polygon", "polyline", "radialGradient", "rect", "stop",
    "text", "tspan", "use", "view",
}


def allow_all_attributes(tag: str, name: str, value: str) -> bool:
    """Preserve authored attributes except executable event handlers and URLs."""
    if name.lower().startswith("on"):
        return False
    if name.lower() in {"href", "src", "action", "formaction", "xlink:href"}:
        return not value.strip().lower().lstrip().startswith(("javascript:", "vbscript:", "data:text/html"))
    return True


ALLOWED_ATTRIBUTES = {"*": allow_all_attributes}


def safe_path(relative_path: str, *, must_exist: bool = True) -> Path:
    """Resolve a user-supplied path without allowing traversal outside ROOT_DIR."""
    decoded = unquote(relative_path or "").replace("\\", "/")
    candidate = (ROOT_DIR / decoded).resolve()
    try:
        candidate.relative_to(ROOT_DIR)
    except ValueError as exc:
        raise ValueError("Path is outside the configured root") from exc
    if must_exist and not candidate.exists():
        raise FileNotFoundError(relative_path)
    return candidate


def tree_for(directory: Path, relative_to: Path) -> list[dict]:
    """Build a deterministic, markdown-focused tree for the sidebar."""
    nodes: list[dict] = []
    try:
        entries = sorted(directory.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except OSError:
        return nodes
    for entry in entries:
        if entry.name.startswith(".") or entry.is_symlink():
            continue
        rel = entry.relative_to(relative_to).as_posix()
        if entry.is_dir():
            children = tree_for(entry, relative_to)
            if children:
                nodes.append({"type": "directory", "name": entry.name, "path": rel, "children": children})
        elif entry.suffix.lower() in ALLOWED_EXTENSIONS:
            nodes.append({"type": "file", "name": entry.name, "path": rel})
    return nodes


def _rewrite_asset_urls(html: str, markdown_path: str) -> str:
    """Replace relative image sources with the guarded asset endpoint."""
    base = Path(markdown_path).parent.as_posix()

    def replace(match: re.Match[str]) -> str:
        prefix, source, suffix = match.group(1), match.group(2), match.group(3)
        if source.startswith(("http://", "https://", "data:", "/")):
            return match.group(0)
        joined = (Path(base) / unquote(source)).as_posix() if base != "." else source
        return f'{prefix}/api/asset?path={quote(joined, safe="")}{suffix}'

    return re.sub(r'(<img\b[^>]*\bsrc=["\'])(.*?)(["\'])', replace, html, flags=re.IGNORECASE)


def render_markdown(raw: str, markdown_path: str = "") -> str:
    parser = markdown.Markdown(extensions=["fenced_code", "tables", "toc", "sane_lists"])
    rendered = parser.convert(raw)
    cleaned = bleach.clean(rendered, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, protocols={"http", "https", "mailto"}, strip=True)
    return _rewrite_asset_urls(cleaned, markdown_path)


def document_index(raw: str) -> list[dict[str, str | int]]:
    """Extract heading titles for the right-side document index."""
    parser = markdown.Markdown(extensions=["toc"])
    parser.convert(raw)
    result: list[dict[str, str | int]] = []

    def visit(items: list[dict]) -> None:
        for item in items:
            result.append({"id": item["id"], "name": item["name"], "level": item["level"]})
            visit(item.get("children", []))

    visit(parser.toc_tokens)
    return result


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self'")
    return response


@app.get("/")
def index():
    return render_template("index.html", root_name=ROOT_DIR.name)


@app.get("/api/tree")
def tree():
    if not ROOT_DIR.is_dir():
        return jsonify({"error": "Configured ROOT_DIR does not exist or is not a directory."}), 500
    return jsonify({"root": ROOT_DIR.name, "children": tree_for(ROOT_DIR, ROOT_DIR)})


@app.get("/api/file")
def file_content():
    relative = request.args.get("path", "")
    try:
        path = safe_path(relative)
        if not path.is_file() or path.suffix.lower() not in ALLOWED_EXTENSIONS:
            abort(404)
        if path.stat().st_size > MAX_FILE_BYTES:
            return jsonify({"error": "This file is larger than the configured limit."}), 413
        raw = path.read_text(encoding="utf-8-sig")
    except (ValueError, FileNotFoundError, UnicodeDecodeError, OSError):
        return jsonify({"error": "Markdown file could not be read."}), 404
    return jsonify({"path": Path(relative).as_posix(), "name": path.name, "raw": raw, "html": render_markdown(raw, relative), "index": document_index(raw), "bytes": len(raw.encode("utf-8"))})


@app.post("/api/file")
def save_file_content():
    """Save edited Markdown beneath ROOT_DIR without permitting path escape."""
    payload = request.get_json(silent=True) or {}
    relative = str(payload.get("path", ""))
    raw = payload.get("content")
    if not isinstance(raw, str):
        return jsonify({"error": "Markdown content must be a string."}), 400
    if len(raw.encode("utf-8")) > MAX_FILE_BYTES:
        return jsonify({"error": "This file is larger than the configured limit."}), 413
    try:
        path = safe_path(relative)
        if not path.is_file() or path.suffix.lower() not in ALLOWED_EXTENSIONS:
            abort(404)
        path.write_text(raw, encoding="utf-8")
    except (ValueError, FileNotFoundError, OSError):
        return jsonify({"error": "Markdown file could not be saved."}), 404
    return jsonify({"path": Path(relative).as_posix(), "name": path.name, "raw": raw, "html": render_markdown(raw, relative), "index": document_index(raw), "bytes": len(raw.encode("utf-8"))})


@app.post("/api/preview")
def preview_markdown():
    """Render unsaved editor content without writing it to disk."""
    payload = request.get_json(silent=True) or {}
    raw = payload.get("content")
    if not isinstance(raw, str):
        return jsonify({"error": "Markdown content must be a string."}), 400
    if len(raw.encode("utf-8")) > MAX_FILE_BYTES:
        return jsonify({"error": "This content is larger than the configured limit."}), 413
    return jsonify({"html": render_markdown(raw), "index": document_index(raw)})


@app.get("/api/asset")
def asset():
    relative = request.args.get("path", "")
    try:
        path = safe_path(relative)
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            abort(404)
        return send_file(path, mimetype=mimetypes.guess_type(path.name)[0] or "application/octet-stream", max_age=300)
    except (ValueError, FileNotFoundError, OSError):
        abort(404)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")), debug=os.environ.get("FLASK_DEBUG") == "1")
