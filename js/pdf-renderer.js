let pdfjsLib = null;

async function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib;
  try {
    pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
    return pdfjsLib;
  } catch (e) {
    console.error(e);
    throw new Error("PDF.js の読み込みに失敗しました。ネットワークを確認してください。");
  }
}

export async function renderPdfPages(buffer, onProgress = () => {}) {
  const pdfjs = await ensurePdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const total = pdf.numPages;
  const urls = [];
  const scale = 2.0;

  for (let i = 1; i <= total; i++) {
    onProgress(i, total);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("PDFページの変換に失敗しました");
    urls.push(URL.createObjectURL(blob));
    try { page.cleanup?.(); } catch (_) {}
  }
  return urls;
}
