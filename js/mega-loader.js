 import { naturalCompare, isSupportedFile, isPdf, getExt } from "./utils.js";

function getMegaFile() {
  if (!window.mega || !window.mega.File) {
    throw new Error("megajs の読み込みに失敗しました。ネットワークを確認して再読み込みしてください。");
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
    throw new Error("フォルダの取得に失敗しました。リンクと復号キー(#以降)を確認してください。");
  }

  const folder = loaded && loaded.directory ? loaded : root;
  if (!folder.directory && !folder.children) {
    return { folder, isSingleFile: true };
  }
  return { folder, isSingleFile: false };
}

/**
 * 親フォルダ直下の「フォルダだけ」を一覧
 */
export async function listChildFolders(url, onProgress = () => {}) {
  onProgress("親フォルダ情報を取得中...");
  const { folder, isSingleFile } = await loadRootFolder(url);
  if (isSingleFile) {
    throw new Error("これはファイルリンクです。フォルダのリンクを指定してください。");
  }
  if (!folder.children || folder.children.length === 0) {
    return [];
  }

  const dirs = folder.children
    .filter((c) => c.directory)
    .map((c) => ({ name: c.name || "(名前なし)" }))
    .sort((a, b) => naturalCompare(a.name, b.name));

  onProgress(dirs.length + " 個のフォルダを発見");
  return dirs;
}

/**
 * 公開フォルダから画像・PDFを収集
 * options.onlyChildName がある場合、その直下子フォルダの中だけ
 */
export async function loadMegaFolder(url, onProgress = () => {}, options = {}) {
  onProgress("フォルダ情報を取得中...");
  const { folder, isSingleFile } = await loadRootFolder(url);

  if (isSingleFile) {
    const name = folder.name || "file";
    if (isSupportedFile(name)) {
      return [{ name, path: name, file: folder, isPdf: isPdf(name) }];
    }
    throw new Error("サポートされていないファイル形式です（画像・PDFのみ）");
  }

  onProgress("ファイル一覧を収集中...");
  const collected = [];

  if (options.onlyChildName) {
    const child = (folder.children || []).find(
      (c) => c.directory && c.name === options.onlyChildName
    );
    if (!child) {
      throw new Error("子フォルダが見つかりません: " + options.onlyChildName);
    }
    collectFiles(child, child.name || "", collected);
  } else {
    collectFiles(folder, "", collected);
  }

  collected.sort((a, b) => naturalCompare(a.path, b.path));

  if (collected.length === 0) {
    throw new Error("画像またはPDFが見つかりませんでした");
  }

  onProgress("ファイル " + collected.length + " 件を発見");
  return collected;
}

function collectFiles(node, parentPath, out) {
  if (!node.children || node.children.length === 0) {
    if (!node.directory && isSupportedFile(node.name || "")) {
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

  const children = [...node.children].sort((a, b) =>
    naturalCompare(a.name || "", b.name || "")
  );

  for (const child of children) {
    const childPath = parentPath
      ? parentPath + "/" + (child.name || "")
      : child.name || "";

    if (child.directory) {
      collectFiles(child, childPath, out);
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
