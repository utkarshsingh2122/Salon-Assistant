const list = document.getElementById("list");
const empty = document.getElementById("empty");
const q = document.getElementById("q");
const refreshBtn = document.getElementById("refresh");

let all = [];

async function apiGet(path) {
  const bases = ["", "/api"];
  let lastErr = null;
  for (const base of bases) {
    const url = base + path;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.ok) {
        const json = await r.json();
        console.log("[history] GET OK", url, json);
        return json;
      } else {
        console.warn("[history] GET non-OK", url, r.status);
        lastErr = new Error(`HTTP ${r.status} ${url}`);
      }
    } catch (e) {
      console.warn("[history] GET failed", url, e);
      lastErr = e;
    }
  }
  throw lastErr || new Error("All API bases failed for " + path);
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
const clip = (s, n = 60) =>
  (s || "").length > n ? s.slice(0, n - 1) + "…" : s || "";

function isValidConvId(id) {
  return typeof id === "string" && /^conv_[a-z0-9]+$/i.test(id);
}

async function load() {
  try {
    const data = await apiGet("/conversations");
    all = (data.conversations || []).sort(
      (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)
    );
    render();
  } catch (e) {
    console.error("[history] load failed:", e);
    list.innerHTML = "";
    empty.style.display = "block";
    empty.textContent =
      "Failed to load sessions. Check server routes (/ or /api).";
  }
}

function render() {
  const term = (q.value || "").trim().toLowerCase();
  const items = all.filter(
    (c) =>
      !term ||
      (c.title || "").toLowerCase().includes(term) ||
      (c.id || "").toLowerCase().includes(term)
  );

  list.innerHTML = "";
  if (!items.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  for (const c of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = c.id;

    // Head
    const head = document.createElement("div");
    head.className = "head";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = clip(c.title || "(untitled session)", 48);
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = c.ended_at ? "Ended" : "Active";
    head.appendChild(title);
    head.appendChild(pill);

    // Body
    const body = document.createElement("div");
    body.className = "body";
    const rowId = document.createElement("div");
    rowId.className = "row";
    rowId.innerHTML = `<span class="muted">ID:</span> <code>${c.id}</code>`;
    const rowStart = document.createElement("div");
    rowStart.className = "row";
    rowStart.innerHTML = `<span class="muted">Started:</span> ${fmt(
      c.started_at
    )}`;
    const rowEnd = document.createElement("div");
    rowEnd.className = "row";
    rowEnd.innerHTML = `<span class="muted">Ended:</span> ${fmt(c.ended_at)}`;
    body.appendChild(rowId);
    body.appendChild(rowStart);
    body.appendChild(rowEnd);

    // Foot
    const foot = document.createElement("div");
    foot.className = "foot";
    const openBtn = document.createElement("button");
    openBtn.className = "btn";
    openBtn.type = "button";
    openBtn.textContent = "Open transcript";
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = c.id;
      if (!isValidConvId(id)) {
        alert("This session ID is invalid. Please refresh.");
        return;
      }
      location.href = `/transcript.html?conversationId=${encodeURIComponent(
        id
      )}`;
    });
    foot.appendChild(openBtn);

    // Click card → open too (same validation)
    card.addEventListener("click", () => {
      const id = c.id;
      if (!isValidConvId(id)) {
        alert("This session ID is invalid. Please refresh.");
        return;
      }
      location.href = `/transcript.html?conversationId=${encodeURIComponent(
        id
      )}`;
    });

    // Assemble
    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(foot);
    list.appendChild(card);
  }
}

q.addEventListener("input", () => render());
refreshBtn.addEventListener("click", load);

load();