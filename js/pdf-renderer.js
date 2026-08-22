// pdf.js の worker を設定
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

export async function renderPdfPages(buffer) {
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const pageUrls = [];

  // メモリ負荷を減らすため、キャンバスの解像度スケールを1.5に調整
  const scale = 1.5;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    // 画像化してBlob URLを作成
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8)
    );
    if (blob) {
      pageUrls.push(URL.createObjectURL(blob));
    }

    // キャンバスのメモリ解放
    canvas.width = 0;
    canvas.height = 0;
  }

  return pageUrls;
}
