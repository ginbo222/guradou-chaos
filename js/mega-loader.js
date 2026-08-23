import { naturalCompare, isSupportedFile, isPdf, getExt } from "./utils.js";

function getMegaFile() {
  if (!window.mega || !window.mega.File) {
    throw new Error("megajs の読み込みに失敗しました。再読み込みしてください。");
  }
  return window.mega.File;
}

async function loadRootFolder(url) {
  const File = getMegaFile();
  const root = File.fromURL(url);
  if (root.api) root.api.userAgent = null;
  let loaded;
  try {
    loaded = await root.loadAttributes();
  } catch (e) {
    console.error(e);
    throw new Error("フォルダの取得に失敗しました。リンクと#以降のキーを確認してください。");
  }
  const folder = loaded && loaded.directory ? loaded : root;
  if (!folder.directory && !folder.children) {
    return { folder, isSingleFile: true };
  }
  return { folder, isSingleFile: false };
}

function walkFiles(node, parentPath, out) {
  if (!node) return;
  if (!node.directory) {
    if (isSupportedFile(node.name || "")) {
      const path = parentPath ? parentPath + "/" + node.name : node.name;
      out.push({
        name: node.name,
        path,
        file: node,
        isPdf: isPdf(node.name),
      });
    }
    return;
  }
  const children = [...(node.children || [])].sort((a, b) =>
    naturalCompare(a.name || "", b.name || "")
  );
  for (const child of children) {
    const childPath = parentPath
      ? parentPath + "/" + (child.name || "")
      : child.name || "";
    if (child.directory) {
      walkFiles(child, childPath, out);
    } else if (isSupportedFile(child.name || "")) {
      out.push({
        name: child.name,
        path: childPath,
        file: child,
        isPdf: isPdf(child.name),
      });
    }
  }
}

/** 親以下の全PDF・画像を一覧（サブフォルダ含む） */
export async function listAllFiles(url, onProgress = () => {}) {
  onProgress("フォルダ情報を取得中...");
  const { folder, isSingleFile } = await loadRootFolder(url);

  if (isSingleFile) {
    const name = folder.name || "file";
    if (!isSupportedFile(name)) throw new Error("未対応のファイルです");
    return [{ name, path: name, isPdf: isPdf(name) }];
  }

  onProgress("ファイルを検索中...");
  const collected = [];
  walkFiles(folder, "", collected);
  collected.sort((a, b) => naturalCompare(a.path, b.path));
  onProgress(collected.length + " 個のファイルを発見");
  return collected.map((c) => ({
    name: c.name,
    path: c.path,
    isPdf: c.isPdf,
  }));
}

/**
 * options.onlyFilePath … そのパスのファイル1つだけ
 * options.onlyChildName … 直下フォルダ名の中だけ（旧）
 */
export async function loadMegaFolder(url, onProgress = () => {}, options = {}) {
  onProgress("フォルダ情報を取得中...");
  const { folder, isSingleFile } = await loadRootFolder(url);

  if (isSingleFile) {
    const name = folder.name || "file";
    if (!isSupportedFile(name)) {
      throw new Error("サポートされていないファイル形式です");
    }
    return [{ name, path: name, file: folder, isPdf: isPdf(name) }];
  }

  onProgress("ファイルを特定中...");
  const collected = [];
  walkFiles(folder, "", collected);

  if (options.onlyFilePath) {
    const hit = collected.find((c) => c.path === options.onlyFilePath);
    if (!hit) {
      throw new Error("ファイルが見つかりません: " + options.onlyFilePath);
    }
    return [hit];
  }

  if (options.onlyChildName) {
    const filtered = collected.filter(
      (c) =>
        c.path === options.onlyChildName ||
        c.path.startsWith(options.onlyChildName + "/")
    );
    if (filtered.length === 0) {
      throw new Error("フォルダ内にファイルがありません: " + options.onlyChildName);
    }
    filtered.sort((a, b) => naturalCompare(a.path, b.path));
    return filtered;
  }

  if (options.onlyFileName) {
    const hit = collected.find((c) => c.name === options.onlyFileName);
    if (!hit) throw new Error("ファイルが見つかりません: " + options.onlyFileName);
    return [hit];
  }

  collected.sort((a, b) => naturalCompare(a.path, b.path));
  if (collected.length === 0) {
    throw new Error("画像またはPDFが見つかりませんでした");
  }
  onProgress("ファイル " + collected.length + " 件を発見");
  return collected;
}

export async function downloadFile(megaFile) {
  if (typeof megaFile.downloadBuffer === "function") {
    return await megaFile.downloadBuffer();
  }
  return new Promise((resolve, reject) => {
    try {
      const stream = megaFile.download();
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const buf = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          buf.set(c, offset);
          offset += c.length;
        }
        resolve(buf.buffer);
      });
      stream.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

export function guessMime(name) {
  const ext = getExt(name);
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    avif: "image/avif",
    pdf: "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}
