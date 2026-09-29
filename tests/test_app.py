import os
from pathlib import Path

import pytest

os.environ["ROOT_DIR"] = str(Path(__file__).parents[1] / "sample_docs")
from app import app, render_markdown, safe_path  # noqa: E402


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def test_tree_lists_markdown_files(client):
    response = client.get("/api/tree")
    assert response.status_code == 200
    payload = response.get_json()
    paths = []

    def collect(nodes):
        for node in nodes:
            if node["type"] == "file":
                paths.append(node["path"])
            else:
                collect(node["children"])

    collect(payload["children"])
    assert "README.md" in paths
    assert "guides/getting-started.md" in paths


def test_traversal_is_rejected():
    with pytest.raises(ValueError):
        safe_path("../secrets.txt")


def test_file_endpoint_returns_sanitized_html(client):
    response = client.get("/api/file", query_string={"path": "README.md"})
    assert response.status_code == 200
    html = response.get_json()["html"]
    assert "<h1 id=\"welcome-to-chemdreader\">Welcome to CHEMDReader</h1>" in html
    assert "<script" not in html


def test_file_endpoint_returns_document_index(client):
    response = client.get("/api/file", query_string={"path": "guides/getting-started.md"})
    assert response.status_code == 200
    index = response.get_json()["index"]
    assert any(item["name"] == "Getting started" for item in index)


def test_preview_endpoint_renders_without_writing(client):
    response = client.post("/api/preview", json={"content": "# Live\n\n`preview`"})
    assert response.status_code == 200
    payload = response.get_json()
    assert '<h1 id="live">Live</h1>' in payload["html"]
    assert payload["index"][0]["name"] == "Live"


def test_save_endpoint_writes_markdown_inside_root(client):
    target = Path(__file__).parents[1] / "sample_docs" / "_editor-test.md"
    try:
        target.write_text("# Original\n")
        response = client.post("/api/file", json={"path": "_editor-test.md", "content": "# Saved\n"})
        assert response.status_code == 200
        assert target.read_text() == "# Saved\n"
    finally:
        target.unlink(missing_ok=True)


def test_save_endpoint_rejects_traversal(client):
    response = client.post("/api/file", json={"path": "../outside.md", "content": "# Unsafe"})
    assert response.status_code == 404


def test_missing_file_returns_not_found(client):
    response = client.get("/api/file", query_string={"path": "missing.md"})
    assert response.status_code == 404


def test_markdown_html_preserves_all_tags_and_attributes():
    html = render_markdown('<mark data-note="keep-me">Safe</mark>\n\n# Safe')
    assert '<mark data-note="keep-me">Safe</mark>' in html
    assert "<h1 id=\"safe\">Safe</h1>" in html


def test_code_and_unsafe_event_attributes_are_handled():
    html = render_markdown('`quoted string`\n\n<span data-kind="example" onclick="alert(1)">text</span>')
    assert '<code>quoted string</code>' in html
    assert 'data-kind="example"' in html
    assert 'onclick' not in html


def test_relative_image_is_routed_through_asset_endpoint():
    html = render_markdown("![diagram](images/diagram.png)", "guides/readme.md")
    assert "/api/asset?path=guides%2Fimages%2Fdiagram.png" in html


def test_mermaid_fence_is_marked_for_client_rendering():
    html = render_markdown("```mermaid\nflowchart TB\n  A --> B\n```")
    assert 'class="language-mermaid"' in html
    assert "flowchart TB" in html


def test_tables_and_horizontal_rules_render_as_html():
    html = render_markdown("| Name | Status |\n| --- | --- |\n| One | Ready |\n\n---")
    assert "<table>" in html
    assert "<th>Name</th>" in html
    assert "<td>Ready</td>" in html
    assert "<hr>" in html
