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

## Rich Markdown rendering

Lists, links, equations, and blockquotes render as formatted content rather than source text. Use `>` for a quote and `>>` or `>>>` for compact nested quote levels:

```markdown
> Keep the important idea visible.
>> Add supporting context here.
>>> Add a deeper note here.
```

Standard nested Markdown (`> >`) is supported too. The same rendering behavior is available in server workspaces, local-folder mode, and the live editor preview. Quote markers inside fenced code blocks remain code.

For separate quoted paragraphs, include a blank quote line:

```markdown
> First paragraph.
>
> Second paragraph.
```
