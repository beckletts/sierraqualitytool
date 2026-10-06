import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectPdf } from "../src/diagnostics/pdf.js";
import { classifyResponse, classifyTransportError } from "../src/diagnostics/classify.js";

/**
 * The diagnostic's verdicts are heuristics on observable signals, and they will
 * be tuned as real results come back from networks this build cannot reach.
 * These cases pin the distinctions that are worth not losing in the tuning —
 * above all, whether a refusal came from the site or from the network in
 * between, which is the whole question the diagnostic exists to answer.
 *
 * The PDFs below are hand-built: minimal, but structurally real, and differing
 * only in the way the three real-world cases differ. They test the heuristic,
 * not the PDF format.
 */

const PDF_HEAD = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`;

const NATIVE_TEXT_PDF = `${PDF_HEAD}
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 700 Td (25% extra time) Tj ET
endstream
endobj
%%EOF`;

const IMAGE_ONLY_PDF = `${PDF_HEAD}
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/XObject/Subtype/Image/Width 1700/Height 2200/Filter/DCTDecode/Length 8>>stream
\xff\xd8\xff\xe0JFIF
endstream
endobj
5 0 obj<</Length 30>>stream
q 612 0 0 792 0 0 cm /Im0 Do Q
endstream
endobj
%%EOF`;

const SCAN_WITH_OCR_PDF = `${PDF_HEAD}
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</XObject<</Im0 4 0 R>>/Font<</F1 6 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/XObject/Subtype/Image/Width 1700/Height 2200/Filter/DCTDecode/Length 8>>stream
\xff\xd8\xff\xe0JFIF
endstream
endobj
5 0 obj<</Length 90>>stream
q 612 0 0 792 0 0 cm /Im0 Do Q
BT 3 Tr /F1 12 Tf 72 700 Td (25% extra time) Tj ET
endstream
endobj
6 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
%%EOF`;

const pdf = (source: string) => inspectPdf(Buffer.from(source, "latin1"));

test("a PDF with fonts and text operators reads as native text", () => {
  const shape = pdf(NATIVE_TEXT_PDF);
  assert.equal(shape.textLayer, "text_layer");
  assert.equal(shape.pageCountEstimate, 1);
  assert.ok(shape.textOperators > 0);
});

test("a PDF that is one image per page with no font reads as an un-OCRed scan", () => {
  const shape = pdf(IMAGE_ONLY_PDF);
  assert.equal(shape.textLayer, "scanned_no_text");
  assert.equal(shape.fontRefs, 0);
  assert.equal(shape.imageXObjects, 1);
  assert.match(shape.summary, /OCR/);
});

test("page images plus fonts read as a scan that has already been OCRed", () => {
  assert.equal(pdf(SCAN_WITH_OCR_PDF).textLayer, "scanned_with_ocr");
});

test("an HTML error page served as a PDF is not mistaken for one", () => {
  const shape = pdf('<!DOCTYPE html><html><body>Access Denied. Reference #18.abc</body></html>');
  assert.equal(shape.isPdf, false);
  assert.match(shape.summary, /Not a PDF/);
});

test("a Salesforce Lightning shell is reported as a JS shell, naming the marker", () => {
  const body = `<!DOCTYPE html><html><head><script>window.auraConfig={mode:"PROD"};</script></head><body><div id="auraAppcacheProgress"></div></body></html>`;
  const result = classifyResponse({
    status: 200,
    contentType: "text/html;charset=UTF-8",
    headers: {},
    bodySample: body,
    byteLength: body.length,
    extractedTextLength: 0,
  });
  assert.equal(result.verdict, "js_shell");
  assert.match(result.detail, /auraconfig/);
  // The conclusion matters more than the label: fetching harder will not help.
  assert.match(result.detail, /needs an API/);
});

test("an HTML page with real prose is fine", () => {
  const result = classifyResponse({
    status: 200,
    contentType: "text/html",
    headers: {},
    bodySample: "<html><body><article>...</article></body></html>",
    byteLength: 50_000,
    extractedTextLength: 4200,
  });
  assert.equal(result.verdict, "ok");
});

test("an egress denial is attributed to the network, not the site", () => {
  const result = classifyResponse({
    status: 403,
    contentType: "text/plain",
    headers: { "x-deny-reason": "host_not_allowed" },
    bodySample: "Host not in allowlist: qualifications.pearson.com. Add this host to your network egress settings to allow access.",
    byteLength: 113,
  });
  assert.equal(result.verdict, "blocked_by_proxy");
  assert.match(result.detail, /never left our egress/);
});

test("a site's own 403 is attributed to the site, not the network", () => {
  // The distinction this whole file exists for: the app's README recorded a
  // bare 403 as proof that Pearson blocks crawlers. An Akamai error page is
  // what that proof would actually look like.
  const result = classifyResponse({
    status: 403,
    contentType: "text/html",
    headers: { server: "AkamaiGHost" },
    bodySample:
      "<!DOCTYPE html><html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><p>You don't have permission to access \"/en/support\" on this server.<br>Reference #18.1a2b3c4d</p></body></html>",
    byteLength: 400,
  });
  assert.equal(result.verdict, "http_error");
  assert.match(result.detail, /reached the site/);
});

test("a bodiless 403 leans towards the network but says it is not conclusive", () => {
  const result = classifyResponse({ status: 403, contentType: null, headers: {}, bodySample: "", byteLength: 12 });
  assert.equal(result.verdict, "blocked_by_proxy");
  assert.match(result.detail, /not conclusive/);
});

test("a 404 blames the URL rather than the network", () => {
  const result = classifyResponse({
    status: 404,
    contentType: "text/html",
    headers: {},
    bodySample: "<html><body>Not found</body></html>",
    byteLength: 35,
  });
  assert.equal(result.verdict, "http_error");
  assert.match(result.detail, /URL is wrong/);
});

test("a status that proves reachability for its target counts as reachable", () => {
  const result = classifyResponse({
    status: 401,
    contentType: "application/json",
    headers: {},
    bodySample: '{"error":"authentication_error"}',
    byteLength: 32,
    okStatuses: [401],
  });
  assert.equal(result.verdict, "ok");
});

test("a TLS failure is reported as trust, not as something to switch off", () => {
  const err = new TypeError("fetch failed", { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } });
  const result = classifyTransportError(err);
  assert.equal(result.verdict, "tls_failure");
  assert.match(result.detail, /needs trusting, not the check disabling/);
});

test("a refused tunnel is reported as the network between us and the site", () => {
  const err = new TypeError("fetch failed", {
    cause: new Error("Client network socket disconnected before secure TLS connection was established"),
  });
  assert.equal(classifyTransportError(err).verdict, "blocked_by_proxy");
});

test("a hostname that does not resolve points at the URL, not the firewall", () => {
  const err = new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
  const result = classifyTransportError(err);
  assert.equal(result.verdict, "dns_failure");
  assert.match(result.detail, /Check the URL/);
});
