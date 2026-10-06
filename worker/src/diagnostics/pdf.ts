/**
 * Does this PDF have a text layer, or is it a picture of a document?
 *
 * It matters because it decides how much work the PDF side of the corpus is.
 * A PDF with real text is a parse; a scanned one needs OCR, and OCR over
 * thousands of files is a different project with a different budget. The
 * qualifications site's PDF count runs to tens of thousands, so guessing wrong
 * here is expensive in either direction.
 *
 * This is a structural read of the raw bytes, not an extraction — it needs no
 * dependency and answers the only question being asked. A PDF that draws text
 * must embed or reference a font and must issue text-showing operators; a
 * scan has neither, just a full-page image per page. Both signals present
 * usually means a scan with an OCR layer already applied, which is the good
 * case: the text is there to be read.
 *
 * Compressed object streams can hide the operators, so a `/Font` count is the
 * load-bearing signal and the operator count only ever adds confidence.
 */

export type TextLayer = "text_layer" | "scanned_no_text" | "scanned_with_ocr" | "indeterminate";

export interface PdfShape {
  isPdf: boolean;
  textLayer: TextLayer;
  fontRefs: number;
  imageXObjects: number;
  textOperators: number;
  pageCountEstimate: number | null;
  /** Plain-English reading of the above, for the Admin page. */
  summary: string;
}

function countMatches(haystack: string, pattern: RegExp): number {
  return (haystack.match(pattern) ?? []).length;
}

/**
 * `/Count N` on the page tree is the cheap answer but appears once per tree
 * node, so the largest value wins; falling back to counting `/Type /Page`
 * catches the linearised files where the root count is absent.
 */
function estimatePageCount(latin1: string): number | null {
  const counts = Array.from(latin1.matchAll(/\/Count\s+(\d+)/g)).map((m) => Number(m[1]));
  const fromTree = counts.length > 0 ? Math.max(...counts) : 0;
  if (fromTree > 0) return fromTree;
  const pageObjects = countMatches(latin1, /\/Type\s*\/Page[^s]/g);
  return pageObjects > 0 ? pageObjects : null;
}

export function inspectPdf(bytes: Buffer): PdfShape {
  // latin1 maps every byte to one character, so byte offsets survive and
  // binary streams can't throw off the scan the way utf-8 decoding would.
  const latin1 = bytes.toString("latin1");
  const isPdf = latin1.startsWith("%PDF-");

  const fontRefs = countMatches(latin1, /\/Font\b/g);
  const imageXObjects = countMatches(latin1, /\/Subtype\s*\/Image\b/g);
  const textOperators = countMatches(latin1, /\bB?T[\s\S]{0,4000}?\b(Tj|TJ)\b/g);
  const pageCountEstimate = estimatePageCount(latin1);

  if (!isPdf) {
    return {
      isPdf: false,
      textLayer: "indeterminate",
      fontRefs,
      imageXObjects,
      textOperators,
      pageCountEstimate,
      summary: "Not a PDF — the bytes do not start with %PDF-. Check for an HTML error page served with a PDF content type.",
    };
  }

  const pages = pageCountEstimate ?? 0;
  const imageHeavy = pages > 0 && imageXObjects >= pages * 0.8;

  let textLayer: TextLayer;
  let summary: string;

  if (fontRefs === 0 && imageXObjects > 0) {
    textLayer = "scanned_no_text";
    summary = `Scanned with no text layer — ${imageXObjects} embedded image(s), no font references. Needs OCR before any of it can be verified against.`;
  } else if (fontRefs > 0 && imageHeavy) {
    textLayer = "scanned_with_ocr";
    summary = `Scanned but with a text layer over it — ${imageXObjects} page image(s) plus ${fontRefs} font reference(s). Text should extract without OCR; expect table structure to come out poorly.`;
  } else if (fontRefs > 0) {
    textLayer = "text_layer";
    summary = `Native text — ${fontRefs} font reference(s)${textOperators > 0 ? `, ${textOperators} text-drawing run(s)` : ""}. Extracts cleanly.`;
  } else {
    textLayer = "indeterminate";
    summary = "Neither fonts nor page images found in the raw bytes — object streams are probably compressed. Needs opening properly to tell.";
  }

  return { isPdf, textLayer, fontRefs, imageXObjects, textOperators, pageCountEstimate, summary };
}
