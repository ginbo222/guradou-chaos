import { isWide } from "./utils.js";

const MODE_KEY = "mcv_view_mode";

export class ComicViewer {
  constructor(opts) {
    this.container = opts.container;
    this.slotLeft = opts.slotLeft;
    this.slotRight = opts.slotRight;
    this.pageInfo = opts.pageInfo;
    this.slider = opts.slider;
    this.onExit = opts.onExit || (() => {});
    this.pages = [];
    this.spreads = [];
    this.currentSpread = 0;
    this.mode = localStorage.getItem(MODE_KEY) === "single" ? "single" : "spread";
    this._boundKey = this._onKey.bind(this);
    this._boundClickLeft = () => this.next();
    this._boundClickRight = () => this.prev();
    this._uiTimer = null;
    this._touchStartX = 0;
    this._touchStartY = 0;
    this._eventsBound = false;
  }

  setPages(pageList) {
    this.pages = pageList.map((p) => ({ ...p, wide: isWide(p.width, p.height) }));
    this._buildSpreads();
    this.currentSpread = 0;
    this._updateSlider();
    this._bindEvents();
    this._updateModeButton();
    this.render();
  }

  appendPages(pageList) {
    const keep = this.currentSpread;
    const mapped = pageList.map((p) => ({ ...p, wide: isWide(p.width, p.height) }));
    this.pages.push(...mapped);
    this._buildSpreads();
    this.currentSpread = Math.min(keep, Math.max(0, this.spreads.length - 1));
    this._updateSlider();
    this._updateInfo();
  }

  toggleMode() {
    this.mode = this.mode === "spread" ? "single" : "spread";
    localStorage.setItem(MODE_KEY, this.mode);
    const keepPage = this._currentPageIndex();
    this._buildSpreads();
    this.currentSpread = this._spreadIndexForPage(keepPage);
    this._updateSlider();
    this._updateModeButton();
    this.render();
    this._showUITemporarily();
  }

  _currentPageIndex() {
    if (!this.spreads.length) return 0;
    const s = this.spreads[this.currentSpread];
    if (s.type === "single") return s.indices[0];
    return Math.min(...s.indices);
  }

  _spreadIndexForPage(pageIndex) {
    for (let i = 0; i < this.spreads.length; i++) {
      if (this.spreads[i].indices.includes(pageIndex)) return i;
    }
    return 0;
  }

  _updateModeButton() {
    const btn = document.getElementById("mode-btn");
    if (!btn) return;
    btn.textContent = this.mode === "spread" ? "見開き" : "1枚";
  }

  _updateSlider() {
    this.slider.min = 0;
    this.slider.max = Math.max(0, this.spreads.length - 1);
    this.slider.value = this.currentSpread;
  }

  _buildSpreads() {
    this.spreads = [];
    let i = 0;
    const n = this.pages.length;

    if (this.mode === "single") {
      for (let p = 0; p < n; p++) {
        this.spreads.push({ type: "single", indices: [p] });
      }
      return;
    }

    while (i < n) {
      const page = this.pages[i];
      if (page.wide) {
        this.spreads.push({ type: "single", indices: [i] });
        i += 1;
      } else if (i + 1 < n && !this.pages[i + 1].wide) {
        this.spreads.push({ type: "spread", indices: [i + 1, i] });
        i += 2;
      } else {
        this.spreads.push({ type: "single", indices: [i] });
        i += 1;
      }
    }
  }

  render() {
    if (this.spreads.length === 0) return;
    const spread = this.spreads[this.currentSpread];
    this.slotLeft.innerHTML = "";
    this.slotRight.innerHTML = "";
    this.slotLeft.classList.remove("single", "empty");
    this.slotRight.classList.remove("single", "empty");
    if (spread.type === "single") {
      this.slotLeft.appendChild(this._createImg(this.pages[spread.indices[0]].url));
      this.slotLeft.classList.add("single");
      this.slotRight.classList.add("empty");
    } else {
      const [leftIdx, rightIdx] = spread.indices;
      this.slotLeft.appendChild(this._createImg(this.pages[leftIdx].url));
      this.slotRight.appendChild(this._createImg(this.pages[rightIdx].url));
    }
    this._updateInfo();
  }

  _createImg(url) {
    const img = document.createElement("img");
    img.src = url;
    img.draggable = false;
    img.alt = "";
    return img;
  }

  _updateInfo() {
    if (!this.spreads.length) {
      this.pageInfo.textContent = "…";
      return;
    }
    const spread = this.spreads[this.currentSpread];
    let label;
    if (spread.type === "single") {
      label = String(spread.indices[0] + 1);
    } else {
      label = `${spread.indices[1] + 1}–${spread.indices[0] + 1}`;
    }
    this.pageInfo.textContent = `${label}  /  ${this.pages.length}p`;
    this.slider.value = this.currentSpread;
  }

  next() {
    if (this.currentSpread < this.spreads.length - 1) {
      this.currentSpread += 1;
      this.render();
      this._showUITemporarily();
    }
  }

  prev() {
    if (this.currentSpread > 0) {
      this.currentSpread -= 1;
      this.render();
      this._showUITemporarily();
    }
  }

  goToSpread(index) {
    this.currentSpread = Math.max(0, Math.min(this.spreads.length - 1, index));
    this.render();
  }

  _onKey(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    switch (e.key) {
      case " ":
      case "ArrowLeft":
        e.preventDefault();
        this.next();
        break;
      case "ArrowRight":
        e.preventDefault();
        this.prev();
        break;
      case "Escape":
        this.onExit();
        break;
      case "f":
      case "F":
        this._toggleFullscreen();
        break;
      case "m":
      case "M":
        this.toggleMode();
        break;
    }
  }

  _onTouchStart(e) {
    if (e.touches.length !== 1) return;
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
  }

  _onTouchEnd(e) {
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - this._touchStartX;
    const dy = e.changedTouches[0].clientY - this._touchStartY;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) this.next();
    else this.prev();
  }

  _bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;
    document.addEventListener("keydown", this._boundKey);
    document.getElementById("click-left").addEventListener("click", this._boundClickLeft);
    document.getElementById("click-right").addEventListener("click", this._boundClickRight);
    this.slider.addEventListener("input", () => this.goToSpread(Number(this.slider.value)));
    const screen = document.getElementById("viewer-screen");
    screen.addEventListener("mousemove", () => this._showUITemporarily());
    screen.addEventListener("touchstart", (e) => {
      this._showUITemporarily();
      this._onTouchStart(e);
    }, { passive: true });
    screen.addEventListener("touchend", (e) => this._onTouchEnd(e), { passive: true });
    document.getElementById("back-btn").onclick = () => this.onExit();
    document.getElementById("fullscreen-btn").onclick = () => this._toggleFullscreen();
    const modeBtn = document.getElementById("mode-btn");
    if (modeBtn) modeBtn.onclick = () => this.toggleMode();
  }

  _showUITemporarily() {
    const overlay = document.getElementById("ui-overlay");
    overlay.classList.add("visible");
    clearTimeout(this._uiTimer);
    this._uiTimer = setTimeout(() => overlay.classList.remove("visible"), 2500);
  }

  _toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  destroy() {
    document.removeEventListener("keydown", this._boundKey);
    clearTimeout(this._uiTimer);
    this._eventsBound = false;
  }
}
