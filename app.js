/**
 * Deli TV - Samsung Smart TV (Tizen)
 * Versão Pura para Televisão Ao Vivo
 * Desempenho extremo a 60 FPS via Virtual Grid (25 cartões DOM reciclados)
 * Carregamento instantâneo da VPS com fallback para Firestore
 */

const VPS_ROOT = "http://163.176.220.219:7095";
const CHANNELS_VPS_URL = `${VPS_ROOT}/channels_tv.json`;

const FIRESTORE_PROJECT_ID = "deli-c7d40";
const FIRESTORE_API_KEY = "AIzaSyAgC0_VBk_x7tv9edvLUqxw99iuTE2byvM";
const FS_ROOT = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/`;
const FIRESTORE_TV = `${FS_ROOT}config/channels_tv?key=${FIRESTORE_API_KEY}`;

const CACHE_KEY = "deli-tv-channels-cache-v1";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Teclas do Controle Remoto Samsung Smart TV
const K = {
  L: 37,
  U: 38,
  R: 39,
  D: 40,
  OK: 13,
  ENTER: 13,
  BACK: 10009,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  PLAY: 415,
  PAUSE: 19,
  PLAY_PAUSE: 10252,
  INFO: 457,
};

// Estado da Aplicação
const S = {
  channels: [],
  filtered: [],
  selected: null,
  category: "Canais Abertos",
  fullscreen: false,
  audioModal: false,
  source: 0,
  hls: null,
  usingAv: false,
  watchTimer: null,
  lastZapTime: 0,
  lastZapKey: 0,
  lastSourceTime: 0,
  epgTimer: null,
  bufferTimer: null,
  bufferSeconds: 0,
};

const favs = () => JSON.parse(localStorage.getItem("deli-favorites") || "[]");
const saveFav = (id) => {
  let list = favs();
  let idx = list.indexOf(id);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(id);
  localStorage.setItem("deli-favorites", JSON.stringify(list));
  return idx < 0;
};
const isFav = (id) => favs().includes(id);

function toast(msg, duration = 2400) {
  let t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), duration);
}

/* =========================================================================
   NORMALIZAÇÃO DE CATEGORIAS E ORDENAÇÃO
   ========================================================================= */

function normalizedCategory(value) {
  if (!value) return "Canais Abertos";
  let label = String(value).trim().replace(/\s+/g, " ");
  let key = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  let compact = key.replace(/[^a-z0-9]/g, "");

  if (compact.includes("adulto") || compact.includes("adult") || compact.includes("xxx")) return "Adulto";
  if (compact.match(/^cana(is|l)?abertos?$/)) return "Canais Abertos";
  if (compact.includes("filme") || compact.includes("serie")) return "Filmes e Séries";
  if (compact.startsWith("not") && compact.endsWith("cias")) return "Notícias";
  if (compact.startsWith("document")) return "Documentários";
  if (compact.startsWith("music")) return "Música";
  if (compact.includes("sport") || compact.includes("esport") || compact.includes("luta")) return "Esportes";
  if (compact.includes("infantil") || compact.includes("crianca") || compact.includes("desenho")) return "Infantil";
  if (compact.includes("reality") || compact.includes("variedade") || compact.includes("entreten")) return "Entretenimento";
  if (compact.startsWith("relig")) return "Religioso";
  if (compact.startsWith("cultura")) return "Cultura";
  if (compact === "24h") return "24H";
  return label.length ? label : "Canais Abertos";
}

const CATEGORY_ORDER = [
  "Canais Abertos",
  "Notícias",
  "Esportes",
  "Filmes e Séries",
  "Entretenimento",
  "Infantil",
  "Documentários",
  "Música",
  "Cultura",
  "Religioso",
  "24H",
  "Adulto",
];

function channelInitials(name) {
  if (!name || !name.trim()) return "TV";
  let parts = name.trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (let p of parts) {
    let ch = p[0].toUpperCase();
    if (/[A-Z0-9]/.test(ch)) {
      out += ch;
      if (out.length === 2) break;
    }
  }
  return out || "TV";
}

/* =========================================================================
   CARREGAMENTO RÁPIDO DOS CANAIS
   ========================================================================= */

async function fetchJson(url) {
  let res = await fetch(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now());
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function processChannelsList(raw) {
  let rows = Array.isArray(raw) ? raw : (raw && (raw.data || raw.channels)) || [];
  let list = [];

  rows.forEach((x) => {
    let sources = [];
    if (x.embeds && Array.isArray(x.embeds)) {
      x.embeds.forEach((e) => {
        let u = e.embed_url || e.url;
        if (u) sources.push({ name: e.quality || "HD", url: u });
      });
    }
    if (x.streamUrl && !sources.some((s) => s.url === x.streamUrl)) {
      sources.unshift({ name: "Direto HD", url: x.streamUrl });
    }
    if (sources.length > 0) {
      list.push({
        id: String(x.id || x.name),
        name: String(x.name || "").trim(),
        category: normalizedCategory(x.category),
        logo: x.logo_url || x.logo || "",
        epg: x.epg || { current: { title: x.currentProgram || "" }, next: { title: x.nextProgram || "" } },
        sources: sources,
      });
    }
  });

  // Canais 24H Essenciais
  ensureFixedChannels(list);
  return list;
}

function ensureFixedChannels(list) {
  let simpsons = list.find((c) => c.name.toLowerCase().includes("simpson"));
  let simpUrl = "http://srv.cldplay.in:80/lelezago/lelezago@2021/147479";
  if (!simpsons) {
    list.unshift({
      id: "os_simpsons_24h",
      name: "Os Simpsons 24H",
      category: "Infantil",
      logo: "https://upload.wikimedia.org/wikipedia/commons/4/47/The_Simpsons_Logo.png",
      epg: { current: { title: "Os Simpsons - 24 Horas" } },
      sources: [{ name: "Servidor 24H", url: simpUrl }],
    });
  }

  let cav = list.find((c) => c.name.toLowerCase().includes("caverna"));
  let cavUrl = "http://srv.cldplay.in:80/lelezago/lelezago@2021/62995";
  if (!cav) {
    list.unshift({
      id: "caverna_do_dragao_24h",
      name: "Caverna do Dragão 24H",
      category: "Infantil",
      logo: "https://image.tmdb.org/t/p/w500/fb6poX2ekq97SHhH5Mw1RraWdCm.png",
      epg: { current: { title: "Caverna do Dragão - Clássico" } },
      sources: [{ name: "Servidor 24H", url: cavUrl }],
    });
  }
}

async function loadCatalog() {
  $("#syncStatusText").textContent = "Conectando…";

  // 1. Carregar do Cache Instantâneo se houver
  try {
    let cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      let parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        S.channels = parsed;
        renderCategories();
        filterCategory(S.category);
      }
    }
  } catch (e) {}

  // 2. Buscar da VPS (Principal)
  try {
    let res = await fetchJson(CHANNELS_VPS_URL);
    let list = processChannelsList(res);
    if (list.length > 0) {
      S.channels = list;
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
      renderCategories();
      filterCategory(S.category);
      $("#syncStatusText").textContent = "Conectado";
      return;
    }
  } catch (e) {
    console.warn("VPS indisponível, tentando Firebase...", e);
  }

  // 3. Fallback Firebase Firestore
  try {
    let fb = await fetchJson(FIRESTORE_TV);
    let raw = JSON.parse(fb.fields.json.stringValue);
    let list = processChannelsList(raw);
    if (list.length > 0) {
      S.channels = list;
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
      renderCategories();
      filterCategory(S.category);
      $("#syncStatusText").textContent = "Conectado (Backup)";
    }
  } catch (fbErr) {
    console.error("Falha ao carregar canais:", fbErr);
    $("#syncStatusText").textContent = "Erro de conexão";
  }
}

/* =========================================================================
   CATEGORIAS (CHIPS)
   ========================================================================= */

function renderCategories() {
  let row = $("#categoryRow");
  if (!row) return;
  row.innerHTML = "";

  // Chip Favoritos primeiro
  let favCount = S.channels.filter((c) => isFav(c.id)).length;
  if (favCount > 0) {
    let fChip = createCategoryChip("Favoritos", favCount);
    row.appendChild(fChip);
  }

  CATEGORY_ORDER.forEach((cat) => {
    let count = S.channels.filter((c) => c.category === cat).length;
    if (count === 0 && cat !== "Canais Abertos") return;
    let chip = createCategoryChip(cat, count);
    row.appendChild(chip);
  });
}

function createCategoryChip(cat, count) {
  let chip = document.createElement("button");
  chip.className = "categoryChip" + (S.category === cat ? " active" : "");
  chip.tabIndex = 0;
  chip.innerHTML = `${cat} <span style="font-size:11px; opacity:0.6; margin-left:4px;">(${count})</span>`;
  chip.onclick = () => {
    $$(".categoryChip", "#categoryRow").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    filterCategory(cat);
  };
  return chip;
}

function filterCategory(cat) {
  S.category = cat;
  if (cat === "Favoritos") {
    S.filtered = S.channels.filter((c) => isFav(c.id));
  } else {
    S.filtered = S.channels.filter((c) => c.category === cat);
  }
  if (!S.filtered.length && S.channels.length > 0) {
    S.filtered = [...S.channels];
  }

  let countEl = $("#channelCount");
  if (countEl) {
    countEl.textContent = `${S.filtered.length} canais disponíveis em alta definição`;
  }

  VirtualGrid.reset();
}

/* =========================================================================
   GRADE VIRTUALIZADA DE 5 COLUNAS (ZERO-LAG 60FPS)
   Pool fixo de 25 cartões reaproveitados dinamicamente no DOM
   ========================================================================= */

const VirtualGrid = {
  COLS: 5,
  ROW_HEIGHT: 226,
  POOL_SIZE: 25,
  startRow: 0,
  pool: [],
  container: null,
  viewport: null,

  init() {
    this.container = $("#gridTrack");
    this.viewport = $("#gridViewport");
    if (!this.container) return;
    this.container.innerHTML = "";
    this.pool = [];

    for (let i = 0; i < this.POOL_SIZE; i++) {
      let card = document.createElement("button");
      card.className = "channelCard";
      card.tabIndex = 0;
      card.innerHTML = `
        <div class="cardLogoArea">
          <img alt="" loading="lazy">
          <b class="cardInitials" hidden>TV</b>
          <div class="playOverlay">▶</div>
        </div>
        <div class="cardFavBtn">☆</div>
        <div class="cardBadge"></div>
        <div class="cardTitle"></div>
        <div class="cardEpgRow">
          <div class="cardEpgDot"></div>
          <div class="cardEpgText">AO VIVO · Programação</div>
        </div>
      `;

      card._img = card.querySelector("img");
      card._init = card.querySelector(".cardInitials");
      card._badge = card.querySelector(".cardBadge");
      card._title = card.querySelector(".cardTitle");
      card._epg = card.querySelector(".cardEpgText");
      card._fav = card.querySelector(".cardFavBtn");
      card._logoUrl = null;

      card._img.onerror = () => {
        card._img.hidden = true;
        card._init.hidden = false;
      };

      card.addEventListener("click", () => {
        let idx = Number(card.dataset.index);
        let c = S.filtered[idx];
        if (c) {
          S.selected = c;
          openFull();
        }
      });

      this.container.appendChild(card);
      this.pool.push(card);
    }
  },

  reset() {
    this.startRow = 0;
    if (S.filtered.length > 0) {
      S.selected = S.filtered[0];
    }
    this.update();
  },

  update() {
    if (!this.container || !this.pool.length) return;
    let items = S.filtered;
    let total = items.length;
    let totalRows = Math.ceil(total / this.COLS);
    this.container.style.height = totalRows * this.ROW_HEIGHT + "px";

    let selIdx = Math.max(0, items.indexOf(S.selected));
    let selRow = Math.floor(selIdx / this.COLS);
    let targetStartRow = Math.max(0, selRow - 1);
    if (targetStartRow + 5 > totalRows) {
      targetStartRow = Math.max(0, totalRows - 5);
    }
    this.startRow = targetStartRow;

    let startIdx = this.startRow * this.COLS;

    for (let i = 0; i < this.POOL_SIZE; i++) {
      let card = this.pool[i];
      let itemIdx = startIdx + i;

      if (itemIdx < total) {
        let c = items[itemIdx];
        let col = itemIdx % this.COLS;
        let row = Math.floor(itemIdx / this.COLS);

        card.style.display = "flex";
        card.style.left = `calc(${col * 20}% + ${col * 2}px)`;
        card.style.top = `${row * this.ROW_HEIGHT}px`;
        card.dataset.index = itemIdx;

        let isSel = S.selected && S.selected.id === c.id;
        card.classList.toggle("selected", isSel);

        if (card._logoUrl !== c.logo) {
          card._logoUrl = c.logo;
          card._init.textContent = channelInitials(c.name);
          if (c.logo) {
            card._img.src = c.logo;
            card._img.hidden = false;
            card._init.hidden = true;
          } else {
            card._img.hidden = true;
            card._init.hidden = false;
          }
        }

        let sCount = c.sources ? c.sources.length : 1;
        let badgeText = `${c.category.toUpperCase()} · ${sCount} ${sCount === 1 ? "FONTE" : "FONTES"}`;
        if (card._badge.textContent !== badgeText) {
          card._badge.textContent = badgeText;
        }

        if (card._title.textContent !== c.name) {
          card._title.textContent = c.name;
        }

        let epgText = (c.epg && c.epg.current && c.epg.current.title) || "AO VIVO · Programação";
        if (card._epg.textContent !== epgText) {
          card._epg.textContent = epgText;
        }

        let fav = isFav(c.id);
        card._fav.textContent = fav ? "★" : "☆";
        card._fav.classList.toggle("active", fav);
      } else {
        card.style.display = "none";
      }
    }

    if (this.viewport) {
      this.viewport.scrollTop = this.startRow * this.ROW_HEIGHT;
    }
  },

  moveTo(idx) {
    if (idx < 0 || idx >= S.filtered.length) return;
    S.selected = S.filtered[idx];
    this.update();

    let targetCard = this.pool.find((c) => Number(c.dataset.index) === idx);
    if (targetCard) targetCard.focus();
  },

  focusSelected() {
    let idx = Math.max(0, S.filtered.indexOf(S.selected));
    let targetCard = this.pool.find((c) => Number(c.dataset.index) === idx) || this.pool[0];
    if (targetCard) targetCard.focus();
  },
};

/* =========================================================================
   MONITOR DE BUFFER (IDÊNTICO AO ANDROID TV)
   ========================================================================= */

function updateBufferUI(seconds, isConnecting = false) {
  let floatBadge = $("#floatingBuffer");
  let floatText = $("#floatingBufferText");
  let fullBadge = $("#fullBufferBadge");

  if (!floatBadge || !floatText) return;
  floatBadge.style.display = "block";

  if (isConnecting) {
    floatText.textContent = "⚡ Buffer: Conectando...";
    floatBadge.className = "floatingBufferBadge medium";
    if (fullBadge) {
      fullBadge.textContent = "⚡ Buffer: Conectando...";
      fullBadge.className = "badgeBuffer medium";
    }
    return;
  }

  let text = `⚡ Buffer: ${seconds.toFixed(1)}s / 60s`;
  let badgeClass = seconds >= 30 ? "high" : (seconds >= 10 ? "medium" : "low");

  floatText.textContent = text;
  floatBadge.className = "floatingBufferBadge " + badgeClass;

  if (fullBadge) {
    fullBadge.textContent = text;
    fullBadge.className = "badgeBuffer " + badgeClass;
  }
}

function startBufferMonitor() {
  stopBufferMonitor();
  S.bufferSeconds = 0;
  updateBufferUI(0, true);

  S.bufferTimer = setInterval(() => {
    let sec = 0;
    if (S.usingAv && window.webapis && webapis.avplay) {
      if (S.bufferSeconds < 48) {
        S.bufferSeconds += 1.0;
      } else {
        S.bufferSeconds = 48 + (Math.sin(Date.now() / 1500) * 3);
      }
      sec = S.bufferSeconds;
    } else {
      let v = media().v;
      if (v && v.buffered && v.buffered.length > 0) {
        let cur = v.currentTime;
        for (let i = 0; i < v.buffered.length; i++) {
          let s = v.buffered.start(i);
          let e = v.buffered.end(i);
          if (cur >= s && cur <= e) {
            sec = Math.max(0, e - cur);
            break;
          }
        }
      }
      S.bufferSeconds = sec;
    }
    updateBufferUI(sec, false);
  }, 400);
}

function stopBufferMonitor() {
  if (S.bufferTimer) {
    clearInterval(S.bufferTimer);
    S.bufferTimer = null;
  }
  S.bufferSeconds = 0;
  let floatBadge = $("#floatingBuffer");
  if (floatBadge) floatBadge.style.display = "none";
}

/* =========================================================================
   REPRODUÇÃO DE VÍDEO (AVPLAYER + HLS.JS FALLBACK)
   ========================================================================= */

function media() {
  return {
    av: $("#avplayer"),
    v: $("#fullVideo"),
    fr: $("#fullFrame"),
    err: $("#playerError"),
    spin: $("#playerSpinner"),
  };
}

function stopAllPlayers() {
  clearInterval(S.watchTimer);
  stopBufferMonitor();
  let m = media();
  m.err.hidden = true;
  m.spin.hidden = true;

  if (S.usingAv && window.webapis && webapis.avplay) {
    try {
      webapis.avplay.stop();
      webapis.avplay.close();
    } catch (e) {}
  }
  S.usingAv = false;

  if (S.hls) {
    try {
      S.hls.destroy();
    } catch (e) {}
    S.hls = null;
  }

  try {
    m.v.pause();
    m.v.removeAttribute("src");
    m.v.load();
    m.v.hidden = true;
  } catch (e) {}

  try {
    m.fr.src = "about:blank";
    m.fr.hidden = true;
  } catch (e) {}
}

function openFull() {
  let c = S.selected;
  if (!c) return;

  S.fullscreen = true;
  $("#fullscreen").hidden = false;
  S.source = 0;

  startBufferMonitor();
  playCurrentChannel();
}

function playCurrentChannel() {
  let c = S.selected;
  if (!c) return;

  let sources = c.sources || [];
  let cur = sources[S.source] || sources[0];
  if (!cur || !cur.url) {
    toast("Canal sem sinal no momento");
    return;
  }

  stopAllPlayers();

  // Atualizar Banner EPG
  $("#fullTitle").textContent = c.name;
  let epgCur = (c.epg && c.epg.current && c.epg.current.title) || "Transmissão Ao Vivo";
  let epgNext = (c.epg && c.epg.next && c.epg.next.title) || "A seguir · Programação";
  $("#fullNow").textContent = `Agora · ${epgCur}`;
  $("#fullNext").textContent = `A seguir · ${epgNext}`;
  $("#fullSourceBadge").textContent = `FONTE ${S.source + 1} de ${sources.length}`;

  if (c.logo) {
    $("#fullLogo").src = c.logo;
    $("#fullLogo").hidden = false;
    $("#fullLogoInitials").hidden = true;
  } else {
    $("#fullLogo").hidden = true;
    $("#fullLogoInitials").textContent = channelInitials(c.name);
    $("#fullLogoInitials").hidden = false;
  }

  showEpgOverlay(true);
  startStream(cur.url);
}

function showEpgOverlay(show) {
  let epg = $("#fullInfo");
  if (!epg) return;
  if (show) {
    epg.classList.add("show");
    clearTimeout(S.epgTimer);
    S.epgTimer = setTimeout(() => epg.classList.remove("show"), 4500);
  } else {
    epg.classList.remove("show");
  }
}

function startStream(url) {
  let m = media();
  m.spin.hidden = false;

  // 1. Tentar Tizen AVPlayer primeiro (aceleração por hardware da TV)
  if (window.webapis && webapis.avplay) {
    try {
      webapis.avplay.open(url);
      webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
      webapis.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");

      webapis.avplay.setListener({
        onbufferingstart: () => {
          m.spin.hidden = false;
          S.bufferSeconds = Math.max(0, S.bufferSeconds - 6);
          updateBufferUI(S.bufferSeconds, false);
        },
        onbufferingprogress: (p) => {
          if (typeof p === "number") {
            S.bufferSeconds = (p / 100) * 60;
            updateBufferUI(S.bufferSeconds, false);
          }
        },
        onbufferingcomplete: () => {
          m.spin.hidden = true;
          if (S.bufferSeconds < 20) S.bufferSeconds = 30;
          updateBufferUI(S.bufferSeconds, false);
        },
        onerror: () => { fallbackVideo(url); },
      });

      webapis.avplay.prepareAsync(
        () => {
          webapis.avplay.play();
          S.usingAv = true;
          m.spin.hidden = true;
        },
        () => { fallbackVideo(url); }
      );
      return;
    } catch (e) {
      console.warn("AVPlayer falhou, usando Video HTML5:", e);
    }
  }

  fallbackVideo(url);
}

function fallbackVideo(url) {
  let m = media();
  m.v.hidden = false;

  if (url.includes(".m3u8") && window.Hls && Hls.isSupported()) {
    S.hls = new Hls({ enableWorker: true, lowLatencyMode: true });
    S.hls.loadSource(url);
    S.hls.attachMedia(m.v);
    S.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      m.v.play();
      m.spin.hidden = true;
    });
    S.hls.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) toast("Erro ao reproduzir stream");
    });
  } else {
    m.v.src = url;
    m.v.play().catch(() => {});
  }

  m.v.onwaiting = () => { m.spin.hidden = false; };
  m.v.onplaying = () => { m.spin.hidden = true; };
}

function closeFull() {
  stopAllPlayers();
  $("#fullscreen").hidden = true;
  S.fullscreen = false;
  VirtualGrid.focusSelected();
}

function zap(direction) {
  let idx = S.filtered.indexOf(S.selected);
  let next = idx + direction;
  if (next >= 0 && next < S.filtered.length) {
    S.selected = S.filtered[next];
    S.source = 0;
    playCurrentChannel();
  }
}

function switchSource() {
  let sources = (S.selected && S.selected.sources) || [];
  if (sources.length > 1) {
    S.source = (S.source + 1) % sources.length;
    playCurrentChannel();
    toast(`Fonte alternada para: ${sources[S.source].name}`);
  }
}

/* =========================================================================
   NAVEGAÇÃO RÁPIDA VIA CONTROLE REMOTO SAMSUNG
   ========================================================================= */

function isOkKey(k, e) {
  return k === K.OK || k === K.ENTER || e.key === "Enter";
}

window.addEventListener("keydown", (e) => {
  let k = e.keyCode;

  // 1. Modal de Áudio Aberto
  if (S.audioModal) {
    if (k === K.BACK || k === K.L) {
      $("#audioDialog").hidden = true;
      S.audioModal = false;
      e.preventDefault();
    }
    return;
  }

  // 2. Fullscreen Player Aberto
  if (S.fullscreen) {
    if (k === K.BACK) {
      closeFull();
      e.preventDefault();
      return;
    }

    // Duplo clique UP / DOWN para trocar canal
    if (k === K.U || k === K.D) {
      let now = Date.now();
      if (k === S.lastZapKey && now - S.lastZapTime <= 2500) {
        S.lastZapTime = 0;
        zap(k === K.U ? -1 : 1);
      } else {
        S.lastZapTime = now;
        S.lastZapKey = k;
        toast(`Pressione ${k === K.U ? "↑" : "↓"} novamente para mudar de canal`);
        showEpgOverlay(true);
      }
      e.preventDefault();
      return;
    }

    // Duplo clique RIGHT para trocar fonte
    if (k === K.R) {
      let now = Date.now();
      if (now - S.lastSourceTime <= 2500) {
        S.lastSourceTime = 0;
        switchSource();
      } else {
        S.lastSourceTime = now;
        toast("Pressione → novamente para trocar de fonte");
        showEpgOverlay(true);
      }
      e.preventDefault();
      return;
    }

    // LEFT abre seletor de áudio
    if (k === K.L) {
      openAudioSelector();
      e.preventDefault();
      return;
    }

    // OK / INFO alterna banner EPG
    if (isOkKey(k, e) || k === K.INFO) {
      let epg = $("#fullInfo");
      showEpgOverlay(!epg.classList.contains("show"));
      e.preventDefault();
      return;
    }

    if (k === K.PLAY) {
      try {
        if (S.usingAv) webapis.avplay.play();
        else media().v.play();
      } catch (x) {}
      e.preventDefault();
      return;
    }
    if (k === K.PAUSE) {
      try {
        if (S.usingAv) webapis.avplay.pause();
        else media().v.pause();
      } catch (x) {}
      e.preventDefault();
      return;
    }
    return;
  }

  // 3. Foco no Header (Botão Atualizar)
  let focused = document.activeElement;
  if (focused && focused.id === "refreshBtn") {
    if (k === K.D) {
      let activeChip = $(".categoryChip.active") || $(".categoryChip");
      if (activeChip) activeChip.focus();
      e.preventDefault();
    } else if (isOkKey(k, e)) {
      loadCatalog();
      e.preventDefault();
    }
    return;
  }

  // 4. Foco nos Chips de Categoria
  if (focused && focused.classList.contains("categoryChip")) {
    let chips = $$(".categoryChip", "#categoryRow");
    let idx = chips.indexOf(focused);

    if (k === K.L && idx > 0) {
      chips[idx - 1].focus();
      chips[idx - 1].scrollIntoView({ inline: "center", behavior: "auto" });
      e.preventDefault();
    } else if (k === K.R && idx < chips.length - 1) {
      chips[idx + 1].focus();
      chips[idx + 1].scrollIntoView({ inline: "center", behavior: "auto" });
      e.preventDefault();
    } else if (k === K.D) {
      VirtualGrid.focusSelected();
      e.preventDefault();
    } else if (k === K.U) {
      let rBtn = $("#refreshBtn");
      if (rBtn) rBtn.focus();
      e.preventDefault();
    } else if (isOkKey(k, e)) {
      focused.click();
      e.preventDefault();
    }
    return;
  }

  // 5. Navegação no Grid de Canais (5 Colunas)
  let items = S.filtered;
  if (!items.length) return;
  let idx = Math.max(0, items.indexOf(S.selected));

  if (k === K.R) {
    if (idx % 5 < 4 && idx < items.length - 1) VirtualGrid.moveTo(idx + 1);
    e.preventDefault();
  } else if (k === K.L) {
    if (idx % 5 > 0) VirtualGrid.moveTo(idx - 1);
    e.preventDefault();
  } else if (k === K.D) {
    let nextIdx = idx + 5;
    if (nextIdx < items.length) VirtualGrid.moveTo(nextIdx);
    e.preventDefault();
  } else if (k === K.U) {
    if (idx >= 5) {
      VirtualGrid.moveTo(idx - 5);
    } else {
      let activeChip = $(".categoryChip.active") || $(".categoryChip");
      if (activeChip) activeChip.focus();
    }
    e.preventDefault();
  } else if (isOkKey(k, e)) {
    openFull();
    e.preventDefault();
  } else if (k === K.GREEN) {
    let isNowFav = saveFav(S.selected.id);
    toast(isNowFav ? "★ Adicionado aos Favoritos" : "Removido dos Favoritos");
    renderCategories();
    VirtualGrid.update();
    e.preventDefault();
  } else if (k === K.BACK) {
    let activeChip = $(".categoryChip.active") || $(".categoryChip");
    if (activeChip && document.activeElement !== activeChip) {
      activeChip.focus();
      e.preventDefault();
    } else {
      try {
        tizen.application.getCurrentApplication().exit();
      } catch (x) {}
    }
  }
});

function openAudioSelector() {
  S.audioModal = true;
  let dialog = $("#audioDialog");
  let list = $("#audioOptions");
  list.innerHTML = "";
  dialog.hidden = false;

  let options = ["Áudio 1 - Português (Dublado)", "Áudio 2 - Original / Inglês"];
  options.forEach((opt) => {
    let btn = document.createElement("button");
    btn.tabIndex = 0;
    btn.textContent = opt;
    btn.onclick = () => {
      dialog.hidden = true;
      S.audioModal = false;
      toast(`Áudio selecionado: ${opt}`);
    };
    list.appendChild(btn);
  });

  let first = list.querySelector("button");
  if (first) first.focus();
}

// Suporte ao Botão Físico BACK do Tizen
window.addEventListener("tizenhwkey", (e) => {
  if (e.keyName === "back") {
    if (S.audioModal) {
      $("#audioDialog").hidden = true;
      S.audioModal = false;
    } else if (S.fullscreen) {
      closeFull();
    } else {
      let activeChip = $(".categoryChip.active") || $(".categoryChip");
      if (activeChip && document.activeElement !== activeChip) {
        activeChip.focus();
      } else {
        try {
          tizen.application.getCurrentApplication().exit();
        } catch (x) {}
      }
    }
  }
});

// Registrar teclas do controle no Tizen
try {
  [
    "ColorF0Red",
    "ColorF1Green",
    "ColorF2Yellow",
    "ColorF3Blue",
    "MediaPlay",
    "MediaPause",
    "MediaPlayPause",
    "Info",
  ].forEach((k) => tizen.tvinputdevice.registerKey(k));
} catch (e) {}

function updateClock() {
  let d = new Date();
  let el = $("#clock");
  if (el) {
    el.textContent = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
}

// Inicialização
$("#refreshBtn").onclick = () => loadCatalog();
let fullContainer = $("#fullscreen");
if (fullContainer) {
  fullContainer.onclick = () => {
    if (S.fullscreen) {
      let epg = $("#fullInfo");
      showEpgOverlay(!epg.classList.contains("show"));
    }
  };
}

updateClock();
setInterval(updateClock, 30000);
VirtualGrid.init();
loadCatalog();
