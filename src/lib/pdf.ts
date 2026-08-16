// Client-side PDF text extraction. Documents never leave the browser.
// pdfjs is loaded on demand so it stays out of the main bundle.

export async function fileToText(file: File): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" "),
      );
    }
    return parts.join("\n");
  }
  return file.text();
}
