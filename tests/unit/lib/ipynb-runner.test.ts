import { describe, it, expect } from "vitest";
import { buildIpynbRunnerHtml } from "~/lib/ipynb-runner";

describe("buildIpynbRunnerHtml", () => {
  it("embeds the notebook JSON and the marked CDN script", () => {
    const nb = JSON.stringify({ nbformat: 4, cells: [] });
    const html = buildIpynbRunnerHtml(nb);
    expect(html).toContain("marked.umd.js");
    expect(html).toContain(JSON.stringify(nb));
  });

  it("cannot be broken out of by </script> in the source", () => {
    const html = buildIpynbRunnerHtml('{"x":"</script><script>alert(1)"}');
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script><script>alert(1)");
  });

  it("renderer handles markdown, code, image and html outputs", () => {
    // The renderer runs in the browser; here assert the script carries
    // the relevant branches so drift is caught.
    const html = buildIpynbRunnerHtml("{}");
    expect(html).toContain("image/png");
    expect(html).toContain("image/jpeg");
    expect(html).toContain("text/html");
    expect(html).toContain("marked.parse");
    expect(html).toContain('"In ["');
  });
});
