/**
 * Standalone renderer page for a Jupyter notebook note: the notebook
 * JSON is embedded verbatim and rendered client-side (markdown cells
 * via marked from a CDN, code cells with execution counts, outputs by
 * mime priority). Always served/embedded under an opaque origin
 * (iframe sandbox attribute or a `Content-Security-Policy: sandbox`
 * header), which also contains any text/html outputs.
 *
 * Pure string builder — shared by the client preview (srcdoc) and the
 * /raw route (worker), so the two renderings can never drift.
 */
export function buildIpynbRunnerHtml(src: string): string {
  // </script> inside the embedded source must not terminate the tag
  const embedded = JSON.stringify(src).replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 84ch;
         margin: 2rem auto; padding: 0 1rem; line-height: 1.6;
         background: #fafaf8; color: #1a1a1a; }
  .cell { margin: 0 0 1.25rem; }
  .code-cell { display: grid; grid-template-columns: auto 1fr; gap: .25rem .75rem; }
  .gutter { font: 12px/1.8 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            color: #888; white-space: nowrap; padding-top: .55em; }
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #ececea; padding: .75em 1em; overflow-x: auto; margin: 0;
        border-radius: 3px; font-size: .85rem; line-height: 1.5; }
  .outputs { grid-column: 2; }
  .output { margin-top: .4rem; }
  .output pre { background: transparent; padding: .25em 0; }
  .output.error pre { color: #b00020; }
  .output img { max-width: 100%; }
  .md :is(h1,h2,h3,h4) { line-height: 1.3; }
  .md code { background: #ececea; padding: .1em .3em; border-radius: 2px; font-size: .9em; }
  .md pre code { background: none; padding: 0; }
  .md blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #555; }
  .md img { max-width: 100%; }
  @media (prefers-color-scheme: dark) {
    body { background: #161615; color: #e8e8e6; }
    pre, .md code { background: #2a2a28; }
    .gutter { color: #777; }
    .md blockquote { border-color: #444; color: #aaa; }
    .output.error pre { color: #ff6b6b; }
  }
</style>
<script src="https://unpkg.com/marked@18/lib/marked.umd.js"></script>
</head>
<body>
<div id="root"></div>
<script>
var SRC = ${embedded};
function fail(e) {
  var pre = document.createElement("pre");
  pre.style.cssText = "padding:16px;white-space:pre-wrap;font:13px/1.5 ui-monospace,monospace;color:#b00020";
  pre.textContent = String((e && e.stack) || e);
  document.body.replaceChildren(pre);
}
window.addEventListener("error", function (ev) { fail(ev.error || ev.message); });
function stripAnsi(s) {
  return String(s).replace(/\\u001b\\[[0-9;]*m/g, "");
}
function joined(v) {
  return Array.isArray(v) ? v.join("") : String(v == null ? "" : v);
}
function el(tag, cls, parent) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.appendChild(node);
  return node;
}
function renderOutput(out, parent) {
  var box = el("div", "output", parent);
  if (out.output_type === "stream") {
    el("pre", "", box).textContent = stripAnsi(joined(out.text));
    return;
  }
  if (out.output_type === "error") {
    box.className = "output error";
    var tb = (out.traceback || []).map(stripAnsi).join("\\n") ||
      (out.ename + ": " + out.evalue);
    el("pre", "", box).textContent = tb;
    return;
  }
  var data = out.data || {};
  if (data["image/png"]) {
    el("img", "", box).src = "data:image/png;base64," + joined(data["image/png"]).replace(/\\n/g, "");
    return;
  }
  if (data["image/jpeg"]) {
    el("img", "", box).src = "data:image/jpeg;base64," + joined(data["image/jpeg"]).replace(/\\n/g, "");
    return;
  }
  if (data["text/html"]) {
    // Contained by the surrounding CSP/iframe sandbox
    box.innerHTML = joined(data["text/html"]);
    return;
  }
  if (data["text/plain"]) {
    el("pre", "", box).textContent = stripAnsi(joined(data["text/plain"]));
  }
}
try {
  var nb = JSON.parse(SRC);
  if (!nb || !Array.isArray(nb.cells)) throw new Error("Not a Jupyter notebook: missing cells");
  var lang = (nb.metadata && nb.metadata.kernelspec && nb.metadata.kernelspec.language) || "python";
  var root = document.getElementById("root");
  nb.cells.forEach(function (cell) {
    var srcText = joined(cell.source);
    if (cell.cell_type === "markdown") {
      var md = el("div", "cell md", root);
      md.innerHTML = marked.parse(srcText);
      return;
    }
    if (cell.cell_type === "code") {
      var wrap = el("div", "cell code-cell", root);
      var n = cell.execution_count;
      el("div", "gutter", wrap).textContent = "In [" + (n == null ? " " : n) + "]:";
      var pre = el("pre", "", wrap);
      var code = el("code", "language-" + lang, pre);
      code.textContent = srcText;
      var outs = el("div", "outputs", wrap);
      (cell.outputs || []).forEach(function (o) { renderOutput(o, outs); });
      return;
    }
    // raw cells and anything unknown: plain text
    el("pre", "cell", root).textContent = srcText;
  });
} catch (e) {
  fail(e);
}
</script>
</body>
</html>`;
}
