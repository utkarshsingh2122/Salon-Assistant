// Agent Portal (vanilla JS)
const listEl = document.getElementById('list');
const tabs = [...document.querySelectorAll('.tab')];
const searchEl = document.getElementById('search');
const refreshBtn = document.getElementById('refresh');
const countEl = document.getElementById('count');

// Drawer
const drawer = document.getElementById('drawer');
const drawerClose = document.getElementById('drawer-close');
const drawerStatus = document.getElementById('drawer-status');
const drawerTitle = document.getElementById('drawer-title');
const drawerConv = document.getElementById('drawer-conv');
const drawerCreated = document.getElementById('drawer-created');
const drawerUpdated = document.getElementById('drawer-updated');
const drawerQuestion = document.getElementById('drawer-question');
const answerEl = document.getElementById('answer');
const submitBtn = document.getElementById('submit');
const copyQBtn = document.getElementById('copy-q');
const copyABtn = document.getElementById('copy-a');
const unresolvedBtn = document.getElementById('mark-unresolved');

// State
let all = [];
let filter = 'pending';
let timer = null;
let selected = null;

// Utilities
const fmt = (iso) => iso ? new Date(iso).toLocaleString() : '—';
const html = (strings, ...vals) =>
  strings.map((s, i) => s + (vals[i] ?? '')).join('');

function badgeFor(hr){
  if (hr.status === 'resolved') return `<span class="badge">Resolved</span>`;
  if (hr.status === 'pending') return `<span class="badge warn">Pending</span>`;
  return `<span class="badge">Unresolved</span>`;
}

function passFilter(hr){
  if (filter === 'all') return true;
  if (filter === 'pending') return hr.status === 'pending';
  if (filter === 'resolved') return hr.status === 'resolved';
  if (filter === 'unresolved') return hr.status !== 'resolved';
  return true;
}

function matchesSearch(hr, q){
  if (!q) return true;
  const t = q.toLowerCase();
  return (hr.question || '').toLowerCase().includes(t)
      || (hr.conversation_id || '').toLowerCase().includes(t)
      || (hr.id || '').toLowerCase().includes(t);
}

// Fetch
async function load(){
  const res = await fetch('/help-requests');
  const data = await res.json();
  all = (data.help_requests || []).sort((a,b)=> Date.parse(b.created_at) - Date.parse(a.created_at));
  render();
}

function render(){
  const q = (searchEl.value || '').trim();
  const items = all.filter(passFilter).filter(hr => matchesSearch(hr, q));
  countEl.textContent = `${items.length} item${items.length!==1?'s':''}`;

  listEl.innerHTML = items.map(hr => {
    return html`
      <article class="card" data-id="${hr.id}">
        <div class="head">
          ${badgeFor(hr)}
          <div class="meta">
            <span>#${hr.id}</span>
            <span>Conv: ${hr.conversation_id}</span>
          </div>
        </div>
        <div class="body">
          <div class="q">${hr.question || '—'}</div>
          <div class="meta">
            <span>Created: ${fmt(hr.created_at)}</span>
            <span>Updated: ${fmt(hr.updated_at)}</span>
          </div>
        </div>
        <div class="foot">
          <button class="icon-btn open">Open</button>
          ${hr.status === 'pending' ? '<button class="icon-btn quick">Quick Answer</button>' : ''}
          <button class="icon-btn copy">Copy Q</button>
        </div>
      </article>
    `;
  }).join('');

  // bind buttons
  listEl.querySelectorAll('.open').forEach(btn=>{
    btn.onclick = (e) => {
      const id = e.currentTarget.closest('.card').dataset.id;
      openDrawer(id);
    };
  });
  listEl.querySelectorAll('.copy').forEach(btn=>{
    btn.onclick = (e) => {
      const id = e.currentTarget.closest('.card').dataset.id;
      const hr = all.find(x=>x.id===id);
      if (hr) navigator.clipboard.writeText(hr.question || '');
    };
  });
  listEl.querySelectorAll('.quick').forEach(btn=>{
    btn.onclick = async (e) => {
      const id = e.currentTarget.closest('.card').dataset.id;
      const hr = all.find(x=>x.id===id);
      if (!hr) return;
      openDrawer(id);
      answerEl.focus();
    };
  });
}

async function openDrawer(id){
  const res = await fetch(`/help-requests/${id}`);
  const hr = await res.json();
  selected = hr;

  drawerStatus.textContent = hr.status[0].toUpperCase() + hr.status.slice(1);
  drawerTitle.textContent = `#${hr.id}`;
  drawerConv.textContent = `Conversation: ${hr.conversation_id}`;
  drawerCreated.textContent = `Created: ${fmt(hr.created_at)}`;
  drawerUpdated.textContent = `Updated: ${fmt(hr.updated_at)}`;
  drawerQuestion.textContent = hr.question || '—';
  answerEl.value = '';
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer(){
  drawer.setAttribute('aria-hidden', 'true');
  selected = null;
  answerEl.value = '';
}

// Actions
submitBtn.onclick = async () => {
  if (!selected) return;
  const answer = (answerEl.value || '').trim();
  if (!answer) {
    answerEl.focus();
    return;
  }
  // Resolve via API — this both (a) learns to KB and (b) sends final assistant reply to the user
  const res = await fetch(`/help-requests/${selected.id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer })
  });
  if (!res.ok) {
    alert(`Failed: ${res.status}`);
    return;
  }
  // Optimistic local update
  const idx = all.findIndex(x=>x.id===selected.id);
  if (idx > -1) {
    all[idx] = { ...all[idx], status:'resolved', updated_at: new Date().toISOString() };
  }
  closeDrawer();
  render();
};

unresolvedBtn.onclick = () => {
  // purely UI marker; backend already treats non-resolved as unresolved
  closeDrawer();
};

copyQBtn.onclick = () => {
  if (!selected) return;
  navigator.clipboard.writeText(selected.question || '');
};
copyABtn.onclick = () => {
  const a = (answerEl.value || '').trim();
  if (a) navigator.clipboard.writeText(a);
};

// Drawer UX
drawerClose.onclick = closeDrawer;
drawer.onclick = (e) => {
  // click outside panel closes
  if (e.target === drawer) closeDrawer();
};

// Tab filters
tabs.forEach(t => {
  t.onclick = () => {
    tabs.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    filter = t.dataset.filter;
    render();
  };
});

// Search
let searchDebounce = null;
searchEl.oninput = () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => render(), 150);
};

// Manual & auto refresh
refreshBtn.onclick = load;
timer = setInterval(load, 5000); // auto-refresh every 5s

// Initial
load();
