/**
 * Standalone runner page for a JSX note: React + Babel from a CDN,
 * the source transpiled and executed with a tiny require shim. Always
 * served/embedded under an opaque origin (iframe sandbox attribute or
 * a `Content-Security-Policy: sandbox` header), so CDN loads are fine
 * but nothing can reach mist with the viewer's cookies.
 *
 * Pure string builder — shared by the client preview (srcdoc) and the
 * /raw route (worker), so the two renderings can never drift.
 */
export function buildJsxRunnerHtml(src: string): string {
  // </script> inside the embedded source must not terminate the tag
  const embedded = JSON.stringify(src).replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>html,body,#root{margin:0;padding:0;height:100%}</style>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
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
try {
  var out = Babel.transform(SRC, {
    presets: [["env", { modules: "commonjs" }], ["react", { runtime: "classic" }]],
  }).code;
  var shim = {
    react: React,
    "react-dom": ReactDOM,
    "react-dom/client": ReactDOM,
  };
  var req = function (name) {
    if (name in shim) return shim[name];
    throw new Error("Cannot resolve module: " + name + " (only react and react-dom are available)");
  };
  var mod = { exports: {} };
  // React passed explicitly so classic-runtime JSX works without an import
  new Function("require", "exports", "module", "React", out)(req, mod.exports, mod, React);
  var App = mod.exports.default || mod.exports;
  if (typeof App !== "function") throw new Error("The note must default-export a React component");
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
} catch (e) {
  fail(e);
}
</script>
</body>
</html>`;
}
