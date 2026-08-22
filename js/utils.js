export function naturalCompare(a, b) {
  const ax = [];
  const bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, num, str) => {
    ax.push([num || Infinity, str || ""]);
  });
  b.replace(/(\d+)|(\D+)/g, (_, num, str) => {
    bx.push([num || Infinity, str || ""]);
  });
  while (ax.length && bx.length) {
    const an = ax.shift();
    const bn = bx.shift();
    const nn = an[0] - bn[0] || an[1].localeCompare(bn[1]);
    if (nn) return nn;
  }
  return ax.length - bx.length;
}

export const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]);
export const PDF_EXTS = new Set(["pdf"]);

export function getExt(name) {
  const i = name.lastIndexOf(".");
  if (i < 0) return "";
  return name.slice(i + 1).toLowerCase();
}

export function isSupportedFile(name) {
  const ext = getExt(name);
  return IMAGE_EXTS.has(ext) || PDF_EXTS.has(ext);
}

export function isPdf(name) {
  return PDF_EXTS.has(getExt(name));
}

export function bufferToObjectURL(buffer, mime) {
  const blob = new Blob([buffer], { type: mime });
  return URL.createObjectURL(blob);
}

export function loadImageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, url });
    img.onerror = () => reject(new Error("画像の読み込みに失敗"));
    img.src = url;
  });
}

export const WIDE_THRESHOLD = 1.15;

export function isWide(width, height) {
  if (!height) return false;
  return width / height >= WIDE_THRESHOLD;
}
