// Hardened transcript client — validates conversationId, avoids calls with ',' or empty,
// tries both '' and '/api' bases, and falls back between endpoints.

const feed = document.getElementById("feed");
const empty = document.getElementById("empty");
const titleEl = document.getElementById("session-title");
const subEl = document.getElementById("session-sub");

function qs(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}
let conversationId = qs("conversationId");

function isValidConvId(id) {
  return typeof id === "string" && /^conv_[a-z0-9]+$/i.test(id);
}

/* ---------- API helper: try '' then '/api' ---------- */
async function apiGet(path) {
  const bases = ["", "/api"];
  let lastErr = null;
  for (const base of bases) {
    const url = base + path;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.ok) {
        const json = await r.json();
        console.log("[transcript] GET OK", url, json);
        return json;
      } else {
        console.warn("[transcript] GET non-OK", url, r.status);
        lastErr = new Error(`HTTP ${r.status} ${url}`);
      }
    } catch (e) {
      console.warn("[transcript] GET failed", url, e);
      lastErr = e;
    }
  }
  throw lastErr || new Error("All API bases failed for " + path);
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

function bubble(role, text) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.textContent = text || "";
  return div;
}
function meta(t) {
  const m = document.createElement("div");
  m.className = "meta";
  m.textContent = t;
  return m;
}

async function loadConversationMeta() {
  if (!isValidConvId(conversationId)) {
    titleEl.textContent = "(invalid session id)";
    subEl.textContent = `Got "${
      conversationId || "(empty)"
    }" — expected something like conv_123abc`;
    empty.style.display = "block";
    empty.textContent = "No transcript found for this session.";
    return null;
  }
  // Prefer GET /conversations/:id
  try {
    const conv = await apiGet(
      `/conversations/${encodeURIComponent(conversationId)}`
    );
    titleEl.textContent = conv.title || "(untitled session)";
    subEl.textContent = `ID ${conv.id} • Started ${fmt(conv.started_at)} • ${
      conv.ended_at ? `Ended ${fmt(conv.ended_at)}` : "Active"
    }`;
    return conv;
  } catch (e) {
    console.warn("[transcript] /conversations/:id failed, trying list", e);
    try {
      const data = await apiGet("/conversations");
      const conv = (data.conversations || []).find(
        (c) => c.id === conversationId
      );
      if (conv) {
        titleEl.textContent = conv.title || "(untitled session)";
        subEl.textContent = `ID ${conv.id} • Started ${fmt(
          conv.started_at
        )} • ${conv.ended_at ? `Ended ${fmt(conv.ended_at)}` : "Active"}`;
        return conv;
      } else {
        titleEl.textContent = "(session not found)";
        subEl.textContent = `ID ${conversationId}`;
        return null;
      }
    } catch (e2) {
      titleEl.textContent = "(error loading session)";
      subEl.textContent = e2?.message || String(e2);
      return null;
    }
  }
}

async function loadTranscript() {
  if (!isValidConvId(conversationId)) return;

  let msgs = [];
  // Try the dedicated transcripts endpoint first:
  try {
    const data = await apiGet(
      `/transcripts/${encodeURIComponent(conversationId)}`
    );
    msgs = data.messages || [];
  } catch (e) {
    console.warn(
      "[transcript] /transcripts/:id failed, trying /conversations/:id/messages",
      e
    );
  }
  // Fallback: /conversations/:id/messages
  if (!msgs.length) {
    try {
      const data2 = await apiGet(
        `/conversations/${encodeURIComponent(conversationId)}/messages`
      );
      msgs = data2.messages || [];
    } catch (e2) {
      console.error("[transcript] both endpoints failed:", e2);
    }
  }

  feed.innerHTML = "";
  if (!msgs.length) {
    empty.style.display = "block";
    empty.textContent = "No transcript found for this session.";
    return;
  }
  empty.style.display = "none";

  msgs.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  let prevDay = "";
  for (const m of msgs) {
    const day = new Date(m.created_at).toDateString();
    if (day !== prevDay) {
      const d = document.createElement("div");
      d.className = "divider";
      d.textContent = day;
      feed.appendChild(d);
      prevDay = day;
    }
    // Hide supervisor messages from client view (uncomment to show):
    if (m.role === "supervisor") continue;

    feed.appendChild(bubble(m.role, m.content));
    feed.appendChild(meta(`${m.role} • ${fmt(m.created_at)}`));
  }
  feed.scrollTop = feed.scrollHeight;
}

console.log("[transcript] conversationId =", conversationId);
await loadConversationMeta();
await loadTranscript();
