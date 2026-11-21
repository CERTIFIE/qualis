#!/usr/bin/env python3
"""Example Qualis language plugin for Python, written in Python.

It shows that the plugin contract is language-neutral: the host starts this
script and talks JSON-RPC 2.0 over stdin/stdout, one JSON message per line.
Only the Python standard library is used (ast, tokenize).

Limitations of this example: cognitive complexity is not computed (reported
as 0) and columns are reported as code points.
"""

import ast
import io
import json
import sys
import tokenize

API_VERSION = 1

RULES = [
    {
        "id": "python:bare-except",
        "name": "Bare except clauses should not be used",
        "languages": ["python"],
        "type": "bug",
        "severity": "major",
        "tags": ["error-handling", "cwe-396"],
        "enabledByDefault": True,
        "effortMinutes": 5,
        "description": "Reports `except:` clauses that do not name an exception type.",
        "rationale": (
            "PEP 8 explains that a bare `except:` clause also catches SystemExit and KeyboardInterrupt, "
            "making it harder to interrupt a program with Control-C and hiding other problems; it recommends "
            "naming the exceptions to catch. MITRE lists catching overly broad exceptions as CWE-396."
        ),
        "noncompliantExample": "try:\n    load()\nexcept:\n    pass",
        "compliantExample": "try:\n    load()\nexcept OSError:\n    pass",
        "references": [
            {
                "publisher": "Python Software Foundation",
                "id": "PEP 8",
                "title": "PEP 8 - Style Guide for Python Code: Programming Recommendations",
                "url": "https://peps.python.org/pep-0008/#programming-recommendations",
            },
            {
                "publisher": "MITRE CWE",
                "id": "CWE-396",
                "title": "Declaration of Catch for Generic Exception",
                "url": "https://cwe.mitre.org/data/definitions/396.html",
            },
        ],
    }
]

MANIFEST = {
    "apiVersion": API_VERSION,
    "id": "python",
    "name": "Python (example plugin)",
    "version": "0.1.0",
    "description": "Example out-of-process plugin written in Python.",
    "languages": [{"id": "python", "name": "Python", "extensions": [".py"]}],
    "rules": RULES,
}

SKIPPED_TOKENS = {
    tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT,
    tokenize.DEDENT, tokenize.ENCODING, tokenize.ENDMARKER,
}
DECISIONS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler, ast.comprehension)
NESTING = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith)
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def decisions(node):
    """Decision points of a function body, nested functions excluded."""
    count = 0
    for child in ast.iter_child_nodes(node):
        if isinstance(child, FUNCTIONS):
            continue
        if isinstance(child, DECISIONS):
            count += 1 + (len(child.ifs) if isinstance(child, ast.comprehension) else 0)
        elif isinstance(child, ast.BoolOp):
            count += len(child.values) - 1
        count += decisions(child)
    return count


def nesting(node, depth=0):
    deepest = depth
    for child in ast.iter_child_nodes(node):
        if isinstance(child, FUNCTIONS):
            continue
        next_depth = depth + 1 if isinstance(child, NESTING) else depth
        deepest = max(deepest, next_depth, nesting(child, next_depth))
    return deepest


def analyze_file(params):
    content = params["content"]
    enabled = {rule["id"] for rule in params["rules"]}
    lines = content.splitlines()

    code_lines, comment_lines, cpd_tokens = set(), set(), []
    for tok in tokenize.generate_tokens(io.StringIO(content).readline):
        if tok.type == tokenize.COMMENT:
            if any(ch.isalnum() for ch in tok.string):
                comment_lines.add(tok.start[0])
        elif tok.type not in SKIPPED_TOKENS:
            code_lines.update(range(tok.start[0], tok.end[0] + 1))
            cpd_tokens.append({"image": tok.string, "startLine": tok.start[0], "endLine": tok.end[0]})

    tree = ast.parse(content)
    issues, functions = [], []
    classes = statements = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            classes += 1
        if isinstance(node, ast.stmt):
            statements += 1
        if isinstance(node, ast.ExceptHandler) and node.type is None and "python:bare-except" in enabled:
            issues.append({
                "ruleId": "python:bare-except",
                "message": "Name the exceptions to catch instead of using a bare except.",
                "range": {"startLine": node.lineno, "startColumn": node.col_offset + 1,
                          "endLine": node.lineno, "endColumn": node.col_offset + 7},
            })
        if isinstance(node, FUNCTIONS):
            start, end = node.lineno, getattr(node, "end_lineno", node.lineno)
            args = node.args
            functions.append({
                "name": getattr(node, "name", "<lambda>"),
                "kind": "lambda" if isinstance(node, ast.Lambda) else "function",
                "range": {"startLine": start, "startColumn": node.col_offset + 1,
                          "endLine": end, "endColumn": len(lines[end - 1]) + 1 if end <= len(lines) else 1},
                "ncloc": len([l for l in code_lines if start <= l <= end]),
                "parameters": len(args.posonlyargs) + len(args.args) + len(args.kwonlyargs),
                "complexity": 1 + decisions(node),
                "cognitiveComplexity": 0,
                "maxNestingDepth": nesting(node),
            })

    return {
        "issues": issues,
        "measures": {
            "lines": len(lines),
            "ncloc": len(code_lines),
            "commentLines": len(comment_lines),
            "functions": len(functions),
            "classes": classes,
            "statements": statements,
            "complexity": sum(f["complexity"] for f in functions) + decisions(tree),
            "cognitiveComplexity": 0,
        },
        "functions": functions,
        "codeLines": sorted(code_lines),
        "cpdTokens": cpd_tokens,
    }


def handle(method, params):
    if method == "initialize":
        if params.get("apiVersion") != API_VERSION:
            raise ValueError("unsupported plugin API version")
        return MANIFEST
    if method == "prepare":
        return None
    if method == "analyzeFile":
        return analyze_file(params)
    if method == "shutdown":
        return None
    raise LookupError(method)


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        message = json.loads(line)
        method = message.get("method")
        if method == "exit":
            return
        if "id" not in message:
            continue
        try:
            send({"jsonrpc": "2.0", "id": message["id"], "result": handle(method, message.get("params") or {})})
        except LookupError:
            send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": f"Unknown method {method}"}})
        except Exception as error:  # report any failure to the host
            send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32603, "message": str(error)}})


if __name__ == "__main__":
    main()
