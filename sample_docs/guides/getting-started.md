# Getting started

## Choose a workspace

The server starts with the bundled `sample_docs` directory. To point it at another folder, set the `ROOT_DIR` environment variable before starting Flask.

```bash
ROOT_DIR=/Users/me/Documents/notes python app.py
```

## Keep it focused

Use **Cmd/Ctrl + K** to search across the workspace. On a phone, the menu button opens the document tree without taking you away from the article.

- Markdown files are discovered recursively.
- Images are resolved relative to their source document.
- Unsafe HTML is removed before it reaches the browser.
