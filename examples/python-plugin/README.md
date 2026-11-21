# Example: a Qualis plugin written in Python

`qualis_python.py` adds Python support to Qualis without any JavaScript. It
implements the [stdio plugin protocol](../../docs/site/plugins.html): the host
starts the script and exchanges newline-delimited JSON-RPC 2.0 messages on
stdin/stdout.

Enable it in `qualis.config.json` next to the bundled plugins:

```json
{
  "plugins": [
    "@qualis/plugin-typescript",
    "@qualis/plugin-csharp",
    { "command": "python3", "args": ["examples/python-plugin/qualis_python.py"] }
  ]
}
```

It needs Python 3.8 or later and only the standard library. It is an example:
it has a single rule (`python:bare-except`) and does not compute cognitive
complexity.
