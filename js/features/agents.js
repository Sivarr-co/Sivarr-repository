// Sivarr Agents — the agent-template marketplace panel (#panel-agents):
// browse/install templates, agent creator profiles, creator dashboard
// (create/publish/earnings/payouts, template builder), reviews/follows,
// and both payment gateways (Stripe Checkout USD, Paystack NGN) client
// flows. Backend lives in routes/agents.py.
//
// This is NOT the same system as js/features/marketplace.js (installed
// extensions/integrations) — confirmed zero cross-calls between the two
// on any layer. They share the "Marketplace" label in product copy only.
//
// Cross-file dependency going the OTHER way: app.js's Home panel
// (_homeRenderTrending, the "Trending in Marketplace" widget) reads
// AG_CAT_COLORS/AG_CAT_ICONS/AG_CAT_LABELS and calls agFormatPrice()
// directly from this file, and embeds agOpenTemplate(id) in an inline
// onclick. Safe regardless of <script> tag order (every file loads with
// `defer`, calls happen well after all deferred scripts have executed),
// but this file should still load before app.js in templates/index.html
// for readability. See that file for script load order.
//
// Known pre-existing bug, NOT fixed as part of this extraction (moved
// verbatim): every call site below uses a bare `showToast(...)` — that
// function is never defined anywhere in the repo (only `toast()` is the
// real core helper). Silently swallowed by surrounding try/catch, so it
// just eats toasts throughout the install/checkout/apply flow rather than
// throwing visibly. Worth a dedicated follow-up fix.

// ═══════════════════════════════════════════════════════════════
//  AGENTS MARKETPLACE
// ═══════════════════════════════════════════════════════════════

const _ag = {
  view: "marketplace", // current sub-view
  category: "all",
  searchQuery: "",
  filters: [],
  templates: [],
  agents: [],
  myAgent: null,
  viewStack: [], // for back-button navigation
  currency: "usd", // 'usd' | 'ngn'
  nairaRate: 1650,
  paystackKey: "",
  paystackAvailable: false,
  stripeAvailable: false,
  payConfig: null, // cache from /api/config/payment
};

const AG_CAT_COLORS = {
  workspace: "#4f6ef7",
  academic: "#d97706",
  ai_prompts: "#6b7280",
  goals: "#22c55e",
  journal: "#7f77dd",
  study_decks: "#d85a30",
};
const AG_CAT_ICONS = {
  workspace: "ti-layout-dashboard",
  academic: "ti-school",
  ai_prompts: "ti-message-bolt",
  goals: "ti-target",
  journal: "ti-notebook",
  study_decks: "ti-cards",
};
const AG_CAT_LABELS = {
  all: "All",
  workspace: "Workspace",
  academic: "Academic",
  ai_prompts: "AI Prompts",
  goals: "Goals",
  journal: "Journal",
  study_decks: "Study Decks",
};

// ── Init ──────────────────────────────────────────────────────
async function agInit() {
  await Promise.all([agLoadMyAgent(), agLoadPaymentConfig()]);
  agUpdateTopbarBtn();
  if (_ag.templates.length === 0) {
    agRenderLoading();
    await agFetchTemplates();
  }
  agRenderMarketplace();
}

async function agLoadPaymentConfig() {
  if (_ag.payConfig) return;
  try {
    const r = await fetch("/api/config/payment");
    const d = await r.json();
    _ag.paystackKey = d.paystack_public_key || "";
    _ag.paystackAvailable = d.paystack_available || false;
    _ag.stripeAvailable = d.stripe_available || false;
    _ag.nairaRate = d.naira_rate || 1650;
    _ag.payConfig = d;
    // Load Paystack inline JS if available and not already loaded
    if (_ag.paystackAvailable && !window.PaystackPop) {
      agLoadPaystackScript();
    }
  } catch {
    /* no payment config */
  }
}

function agLoadPaystackScript() {
  if (document.getElementById("paystack-js")) return;
  const s = document.createElement("script");
  s.id = "paystack-js";
  s.src = "https://js.paystack.co/v1/inline.js";
  s.async = true;
  document.head.appendChild(s);
}

async function agLoadMyAgent() {
  if (!getToken()) return;
  try {
    const r = await fetch(`/api/agents/me?token=${getToken()}`);
    const d = await r.json();
    _ag.myAgent = d.agent || null;
  } catch {
    _ag.myAgent = null;
  }
}

function agUpdateTopbarBtn() {
  const label = $("ag-btn-label");
  if (label) {
    label.textContent = _ag.myAgent ? "Dashboard" : "Become an Agent";
  }
}

// ── Fetch ─────────────────────────────────────────────────────
async function agFetchTemplates(category = "all", sort = "popular") {
  try {
    const r = await fetch(
      `/api/agents/templates?category=${category}&sort=${sort}&limit=60`,
    );
    const d = await r.json();
    _ag.templates = d.templates || [];
  } catch {
    _ag.templates = [];
  }
}

async function agFetchAgents(sort = "downloads") {
  try {
    const r = await fetch(`/api/agents?sort=${sort}`);
    const d = await r.json();
    _ag.agents = d.agents || [];
  } catch {
    _ag.agents = [];
  }
}

// ── Navigation ────────────────────────────────────────────────
function agNav(view, pushStack = true) {
  if (pushStack && view !== _ag.view) _ag.viewStack.push(_ag.view);
  _ag.view = view;
  const backBtn = $("ag-back-btn");
  if (backBtn) backBtn.style.display = _ag.viewStack.length ? "flex" : "none";
  agUpdateTitle(view);
}

function agBack() {
  if (!_ag.viewStack.length) return;
  const prev = _ag.viewStack.pop();
  _ag.view = prev;
  const backBtn = $("ag-back-btn");
  if (backBtn) backBtn.style.display = _ag.viewStack.length ? "flex" : "none";
  agUpdateTitle(prev);

  if (prev === "marketplace") agRenderMarketplace();
  else if (prev === "directory") agRenderDirectory();
  else if (prev === "apply") agRenderApply();
  else if (prev === "dashboard") agRenderDashboard();
  else agRenderMarketplace();
}

function agUpdateTitle(view) {
  const titles = {
    marketplace: "Sivarr Agents",
    directory: "Browse Agents",
    apply: "Become an Agent",
    dashboard: "Creator Dashboard",
    builder: "New Template",
    detail: "Template",
    profile: "Agent Profile",
  };
  const t = $("ag-topbar-title");
  if (t) t.textContent = titles[view] || "Sivarr Agents";
}

// CSP migration: each pairs agNav (state/title only, doesn't render) with
// the matching render call -- delegate.js dispatches to one named function,
// so each distinct pairing used inline needs its own thin wrapper, same
// shape as the pre-existing agNavDashboardOrApply() just below.
window._agNavDirectory = function () {
  agNav("directory");
  agRenderDirectory();
};
window._agNavApply = function () {
  agNav("apply");
  agRenderApply();
};
window._agNavMarketplace = function () {
  agNav("marketplace", false);
  agRenderMarketplace();
};

function agNavDashboardOrApply() {
  if (_ag.myAgent) {
    agNav("dashboard");
    agRenderDashboard();
  } else {
    agNav("apply");
    agRenderApply();
  }
}

// ── Loading state ─────────────────────────────────────────────
function agRenderLoading() {
  const v = $("ag-view");
  if (v)
    v.innerHTML = `<div class="ag-loading"><div class="ag-spinner"></div><span>Loading…</span></div>`;
}

// ── Currency helpers ──────────────────────────────────────────
function agNgnPrice(t) {
  if (t.price_ngn != null) return t.price_ngn;
  return Math.round(parseFloat(t.price || 0) * _ag.nairaRate);
}

function agFormatPrice(t) {
  if (_ag.currency === "ngn") {
    const ngn = agNgnPrice(t);
    return ngn === 0 ? "Free" : `₦${ngn.toLocaleString()}`;
  }
  const usd = parseFloat(t.price || 0);
  return usd === 0 ? "Free" : `$${usd.toFixed(2)}`;
}

function agIsFree(t) {
  return parseFloat(t.price || 0) === 0;
}

function agSetCurrency(cur) {
  _ag.currency = cur;
  // Re-render grid in-place without full fetch
  const grid = $("ag-grid");
  if (grid) {
    const filtered = agApplyFilters(_ag.templates, _ag.category, _ag.filters);
    grid.innerHTML = filtered.length
      ? filtered.map((t) => agTemplateCardHTML(t)).join("")
      : '<div class="ag-empty"><div class="ag-empty-icon">🔍</div><p>No templates found.</p></div>';
  }
  // Update toggle visual
  document.querySelectorAll(".ag-currency-opt").forEach((b) => {
    b.classList.toggle("active", b.dataset.cur === cur);
  });
}

// ── Marketplace ───────────────────────────────────────────────
async function agRenderMarketplace() {
  agNav("marketplace", false);
  const v = $("ag-view");
  if (!v) return;

  const filtered = agApplyFilters(_ag.templates, _ag.category, _ag.filters);

  v.innerHTML = `
    <div class="ag-market-wrap">

      <!-- Search bar -->
      <div class="ag-search-bar">
        <i class="ti ti-search"></i>
        <input id="ag-search-input" placeholder="Search templates…" autocomplete="off"
          value="${esc(_ag.searchQuery || "")}"
          data-oninput="_agSearchTemplatesFromEl" data-oninput-this>
        ${_ag.searchQuery ? `<button class="ag-search-clear" data-onclick="agSearchTemplates" data-onclick-arg0="">✕</button>` : ""}
      </div>

      <!-- Category tabs + currency toggle row -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div class="ag-cats" style="flex:1;margin-bottom:0">
          ${[
            "all",
            "workspace",
            "academic",
            "ai_prompts",
            "goals",
            "journal",
            "study_decks",
          ]
            .map(
              (c) => `
            <button class="ag-cat${_ag.category === c ? " active" : ""}"
              data-onclick="agSetCategory" data-onclick-arg0="${c}">${AG_CAT_LABELS[c] || c}</button>
          `,
            )
            .join("")}
        </div>
        <div class="ag-currency-toggle">
          <button class="ag-currency-opt usd${_ag.currency === "usd" ? " active" : ""}"
            data-cur="usd" data-onclick="agSetCurrency" data-onclick-arg0="usd">$ USD</button>
          <button class="ag-currency-opt ngn${_ag.currency === "ngn" ? " active" : ""}"
            data-cur="ngn" data-onclick="agSetCurrency" data-onclick-arg0="ngn">₦ NGN</button>
        </div>
      </div>

      <!-- Filter chips -->
      <div class="ag-filters">
        ${[
          { id: "popular", label: "🔥 Most popular" },
          { id: "new", label: "✨ New this week" },
          { id: "free", label: "🆓 Free only" },
          { id: "under5", label: "💸 Under $5" },
          { id: "top_rated", label: "⭐ Top rated" },
        ]
          .map(
            (f) => `
          <button class="ag-chip${_ag.filters.includes(f.id) ? " active" : ""}"
            data-onclick="agToggleFilter" data-onclick-arg0="${f.id}">${f.label}</button>
        `,
          )
          .join("")}
      </div>

      <!-- Featured banner -->
      ${await agFeaturedBannerHTML()}

      <!-- Template grid / launch hero -->
      ${
        filtered.length
          ? `
      <div class="ag-section-hd">
        <div class="ag-section-title">🔥 Trending this week</div>
        <span class="ag-section-link" data-onclick="_agNavDirectory">All agents →</span>
      </div>
      <div class="ag-grid" id="ag-grid">
        ${filtered.map((t) => agTemplateCardHTML(t)).join("")}
      </div>`
          : `
      <div class="ag-launch-hero">
        <div class="ag-launch-icon">🚀</div>
        <div class="ag-launch-title">Marketplace is warming up</div>
        <div class="ag-launch-desc">Be among the first creators to publish templates on Sivarr and get in front of early users.</div>
        <button class="ag-tb-btn ag-tb-btn--primary" style="margin-top:8px" data-onclick="_agNavApply">
          <i class="ti ti-rocket"></i> Become a Creator
        </button>
      </div>`
      }

      <!-- Top agents section -->
      <div class="ag-section-hd" style="margin-top:${filtered.length ? 8 : 32}px">
        <div class="ag-section-title">🌟 Top agents</div>
        <span class="ag-section-link" data-onclick="_agNavDirectory">See all →</span>
      </div>
      <div id="ag-agents-preview">
        <div class="ag-loading" style="height:100px"><div class="ag-spinner"></div></div>
      </div>

    </div>
  `;

  // Load agents in background
  agFetchAgents().then(() => {
    const cont = $("ag-agents-preview");
    if (!cont) return;
    if (!_ag.agents.length) {
      cont.innerHTML = `<div class="ag-empty" style="padding:24px 20px">
        <div class="ag-empty-icon">👋</div>
        <p>No agents yet, <span style="color:var(--accent);cursor:pointer;font-weight:600" data-onclick="_agNavApply">be the first to join</span>.</p>
      </div>`;
      return;
    }
    cont.innerHTML = _ag.agents
      .slice(0, 5)
      .map((a) => agAgentRowHTML(a))
      .join("");
  });
}

async function agFeaturedBannerHTML() {
  try {
    const r = await fetch("/api/agents/featured");
    const d = await r.json();
    const t = d.template;
    if (!t || !t.id) return "";
    const color = t.thumbnail_color || AG_CAT_COLORS[t.category] || "#4f6ef7";
    const icon = AG_CAT_ICONS[t.category] || "ti-template";
    return `
      <div class="ag-featured" style="margin-bottom:24px" data-onclick="agOpenTemplate" data-onclick-arg0="${esc(t.id)}">
        <div class="ag-feat-thumb" style="background:${color}20">
          <i class="ti ${icon}" style="color:${color};font-size:2.5rem"></i>
        </div>
        <div class="ag-feat-body">
          <div class="ag-feat-label">⭐ Featured this week</div>
          <div class="ag-feat-name">${esc(t.name)}</div>
          <div class="ag-feat-desc">${esc(t.short_description || "")}</div>
          <div class="ag-feat-meta">
            <span>by <strong>${esc(t.agent_name || "")}</strong></span>
            <span>📥 ${t.download_count || 0} downloads</span>
            <span>★ ${(t.avg_rating || 0).toFixed(1)}</span>
          </div>
          <div class="ag-feat-actions">
            <button class="ag-get-btn" data-onclick="agOpenTemplate" data-onclick-arg0="${esc(t.id)}">
              Preview template →
            </button>
          </div>
        </div>
      </div>`;
  } catch {
    return "";
  }
}

function agTemplateCardHTML(t) {
  const color = t.thumbnail_color || AG_CAT_COLORS[t.category] || "#4f6ef7";
  const icon = AG_CAT_ICONS[t.category] || "ti-template";
  const isFree = agIsFree(t);
  const priceLabel = agFormatPrice(t);
  const price = parseFloat(t.price || 0);
  const priceNgn = agNgnPrice(t);
  return `
    <div class="ag-card" data-onclick="agOpenTemplate" data-onclick-arg0="${esc(t.id)}">
      <div class="ag-card-thumb" style="background:${color}20">
        <i class="ti ${icon}" style="color:${color};font-size:1.8rem"></i>
      </div>
      <div class="ag-card-body">
        <span class="ag-card-tag">${AG_CAT_LABELS[t.category] || t.category}</span>
        <div class="ag-card-name">${esc(t.name)}</div>
        <div class="ag-card-meta">
          <div class="ag-mini-av">${(t.agent_name || "?")[0].toUpperCase()}</div>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.agent_name || "")}</span>
          <span class="ag-card-rating">★ ${(t.avg_rating || 0).toFixed(1)}</span>
        </div>
        <div class="ag-card-footer">
          <div>
            <span class="ag-price${isFree ? " free" : ""}">${priceLabel}</span>
            ${!isFree && _ag.currency === "usd" ? `<div class="ag-price-ngn">≈ ₦${priceNgn.toLocaleString()}</div>` : ""}
            ${!isFree && _ag.currency === "ngn" ? `<div class="ag-price-ngn">≈ $${price.toFixed(2)}</div>` : ""}
          </div>
          <button class="ag-get-btn"
            data-onclick="agHandleGet" data-onclick-args="${esc(JSON.stringify([t.id, price]))}">
            Get
          </button>
        </div>
      </div>
    </div>`;
}

function agAgentRowHTML(a) {
  return `
    <div class="ag-agent-row" data-onclick="agOpenAgentProfile" data-onclick-arg0="${esc(a.id)}">
      <div class="ag-agent-av">${(a.display_name || "?")[0].toUpperCase()}</div>
      <div class="ag-agent-info">
        <div class="ag-agent-name">
          ${esc(a.display_name || "")}
          ${a.verified ? '<i class="ti ti-rosette-discount-check ag-verified-badge" title="Verified"></i>' : ""}
        </div>
        <div class="ag-agent-stats">${a.total_downloads || 0} downloads · ★ ${(a.avg_rating || 0).toFixed(1)}</div>
      </div>
      <button class="ag-tb-btn" style="font-size:.72rem;padding:4px 10px">View</button>
    </div>`;
}

// ── Filters ───────────────────────────────────────────────────
async function agSetCategory(cat) {
  _ag.category = cat;
  agRenderLoading();
  await agFetchTemplates(cat === "all" ? "all" : cat);
  agRenderMarketplace();
}

function agToggleFilter(id) {
  const idx = _ag.filters.indexOf(id);
  if (idx === -1) _ag.filters.push(id);
  else _ag.filters.splice(idx, 1);
  const v = $("ag-view");
  if (v) {
    // re-render just the chips + grid without full refetch
    const chips = v.querySelectorAll(".ag-chip");
    chips.forEach((c) => {
      const cid = c.getAttribute("onclick").match(/'(\w+)'/)?.[1];
      if (cid) c.classList.toggle("active", _ag.filters.includes(cid));
    });
    const grid = $("ag-grid");
    if (grid) {
      const filtered = agApplyFilters(_ag.templates, _ag.category, _ag.filters);
      grid.innerHTML = filtered.length
        ? filtered.map((t) => agTemplateCardHTML(t)).join("")
        : '<div class="ag-empty"><div class="ag-empty-icon">🔍</div><p>No templates found.</p></div>';
    }
  }
}

function agApplyFilters(templates, category, filters) {
  let list = [...templates];
  if (category && category !== "all")
    list = list.filter((t) => t.category === category);
  if (_ag.searchQuery) {
    const q = _ag.searchQuery.toLowerCase();
    list = list.filter(
      (t) =>
        (t.name || "").toLowerCase().includes(q) ||
        (t.short_description || "").toLowerCase().includes(q) ||
        (t.agent_name || "").toLowerCase().includes(q) ||
        (t.tags || []).some((tag) => tag.toLowerCase().includes(q)),
    );
  }
  if (filters.includes("free"))
    list = list.filter((t) => parseFloat(t.price || 0) === 0);
  if (filters.includes("under5"))
    list = list.filter((t) => parseFloat(t.price || 0) < 5);
  if (filters.includes("top_rated"))
    list = [...list].sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0));
  if (filters.includes("popular"))
    list = [...list].sort(
      (a, b) => (b.download_count || 0) - (a.download_count || 0),
    );
  if (filters.includes("new"))
    list = [...list].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    );
  return list;
}

// CSP migration: delegate.js has no this.value-read grammar; read it here.
window._agSearchTemplatesFromEl = function (el) {
  agSearchTemplates(el.value);
};

function agSearchTemplates(q) {
  _ag.searchQuery = q.trim();
  const filtered = agApplyFilters(_ag.templates, _ag.category, _ag.filters);
  const searchInput = $("ag-search-input");
  if (searchInput) searchInput.value = q;
  const wrap = searchInput?.closest(".ag-search-bar");
  if (wrap) {
    let clearBtn = wrap.querySelector(".ag-search-clear");
    if (_ag.searchQuery && !clearBtn) {
      clearBtn = document.createElement("button");
      clearBtn.className = "ag-search-clear";
      clearBtn.textContent = "✕";
      clearBtn.onclick = () => agSearchTemplates("");
      wrap.appendChild(clearBtn);
    } else if (!_ag.searchQuery && clearBtn) {
      clearBtn.remove();
    }
  }
  const grid = $("ag-grid");
  if (grid) {
    grid.innerHTML = filtered.length
      ? filtered.map((t) => agTemplateCardHTML(t)).join("")
      : `<div class="ag-empty" style="grid-column:1/-1"><div class="ag-empty-icon">🔍</div><p>No results for "<strong>${esc(_ag.searchQuery)}</strong>".</p></div>`;
  } else {
    agRenderMarketplace();
  }
}

// ── Template detail ───────────────────────────────────────────
async function agOpenTemplate(id) {
  agNav("detail");
  agRenderLoading();
  const v = $("ag-view");
  if (!v) return;
  try {
    const r = await fetch(`/api/agents/templates/${id}`);
    const d = await r.json();
    const t = d.template;
    if (!t || !t.id) {
      v.innerHTML =
        '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Template not found.</p></div>';
      return;
    }
    const color = t.thumbnail_color || AG_CAT_COLORS[t.category] || "#4f6ef7";
    const icon = AG_CAT_ICONS[t.category] || "ti-template";
    const price = parseFloat(t.price || 0);
    const isFree = price === 0;
    const priceNgn = agNgnPrice(t);

    // Check ownership
    let owned = false;
    if (getToken()) {
      try {
        const or = await fetch(
          `/api/agents/templates/${id}/owned?token=${getToken()}`,
        );
        const od = await or.json();
        owned = od.owned;
      } catch {}
    }

    const reviewsHTML =
      (t.reviews || [])
        .map(
          (rv) => `
      <div class="ag-review-item">
        <div class="ag-review-header">
          <div class="ag-review-av">${(rv.reviewer_name || "?")[0].toUpperCase()}</div>
          <span class="ag-review-name">${esc(rv.reviewer_name || "")}</span>
          <span class="ag-review-stars">${"★".repeat(rv.rating || 5)}</span>
        </div>
        <div class="ag-review-text">${esc(rv.review_text || "")}</div>
      </div>`,
        )
        .join("") ||
      '<p style="font-size:.8rem;color:var(--muted)">No reviews yet. Be the first!</p>';

    const includedHTML =
      (t.included_items || [])
        .map(
          (item) => `
      <div class="ag-included-item">
        <i class="ti ${item.icon || "ti-check"}"></i>
        <span>${esc(item.description || "")}</span>
      </div>`,
        )
        .join("") || agDefaultIncluded(t.contents || {});

    v.innerHTML = `
      <div class="ag-detail-wrap">
        <div class="ag-detail-grid">
          <!-- Left column -->
          <div>
            <div class="ag-detail-thumb" style="background:${color}20">
              <i class="ti ${icon}" style="color:${color}"></i>
            </div>
            <div class="ag-detail-cat">${AG_CAT_LABELS[t.category] || t.category}</div>
            <div class="ag-detail-name">${esc(t.name)}</div>
            <div class="ag-detail-agent-row">
              <div class="ag-detail-agent-av">${(t.agent_name || "?")[0].toUpperCase()}</div>
              <span data-onclick="agOpenAgentProfile" data-onclick-arg0="${esc(t.agent_id)}" style="cursor:pointer;color:var(--accent)">
                ${esc(t.agent_name || "")}
              </span>
              ${t.agent_verified ? '<i class="ti ti-rosette-discount-check ag-verified-badge"></i>' : ""}
              <span class="ag-detail-stars">${"★".repeat(Math.round(t.avg_rating || 0))}${"☆".repeat(5 - Math.round(t.avg_rating || 0))}</span>
              <span style="color:var(--muted)">(${t.review_count || 0})</span>
            </div>
            <div class="ag-detail-desc">${esc(t.full_description || t.short_description || "")}</div>
            <div class="ag-detail-stats-row">
              <span><strong>${isFree ? "Free" : "$" + price.toFixed(2)}</strong> price</span>
              <span><strong>${t.download_count || 0}</strong> downloads</span>
              <span><strong>${(t.avg_rating || 0).toFixed(1)}</strong> rating</span>
            </div>
            ${
              !isFree && !owned
                ? `
              <div class="ag-pay-methods">
                <div class="ag-pay-method stripe${_ag.currency === "usd" ? " active" : ""}"
                  data-onclick="agSelectPayment" data-onclick-args="${esc(JSON.stringify([id, price, "usd"]))}">
                  <i class="ti ti-credit-card"></i>
                  <div>
                    <div style="font-weight:700">$${price.toFixed(2)} <span style="font-size:.7rem;font-weight:400">USD</span></div>
                    <div style="font-size:.68rem;color:var(--muted)">via Stripe</div>
                  </div>
                </div>
                ${
                  _ag.paystackAvailable
                    ? `
                <div class="ag-pay-method paystack${_ag.currency === "ngn" ? " active" : ""}"
                  data-onclick="agSelectPayment" data-onclick-args="${esc(JSON.stringify([id, price, "ngn"]))}">
                  <i class="ti ti-currency-naira"></i>
                  <div>
                    <div style="font-weight:700">₦${priceNgn.toLocaleString()} <span style="font-size:.7rem;font-weight:400">NGN</span></div>
                    <div style="font-size:.68rem;color:var(--muted)">via Paystack</div>
                  </div>
                </div>`
                    : ""
                }
              </div>`
                : ""
            }
            <button class="ag-detail-cta${owned ? " owned" : ""}"
              ${owned ? "" : `data-onclick="agHandleGet" data-onclick-args="${esc(JSON.stringify([id, price]))}"`}>
              ${
                owned
                  ? "✓ Installed"
                  : isFree
                    ? "Get for free"
                    : _ag.currency === "ngn" && _ag.paystackAvailable
                      ? `Buy for ₦${priceNgn.toLocaleString()}`
                      : `Buy for $${price.toFixed(2)}`
              }
            </button>
            <button class="ag-detail-secondary" data-onclick="agOpenAgentProfile" data-onclick-arg0="${esc(t.agent_id)}">
              View agent profile
            </button>
            <button class="ag-detail-report" data-onclick="agReportTemplate" data-onclick-arg0="${esc(id)}" title="Report this template for review">
              <i class="ti ti-flag"></i> Report
            </button>
          </div>

          <!-- Right column -->
          <div>
            <div class="ag-detail-card">
              <div class="ag-detail-card-title">What's included</div>
              ${includedHTML}
            </div>
            <div class="ag-detail-card">
              <div class="ag-detail-card-title">Reviews</div>
              ${reviewsHTML}
              ${
                owned
                  ? `
                <button style="margin-top:10px;width:100%;padding:7px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--accent);font-size:.78rem;font-weight:700;cursor:pointer"
                  data-onclick="agLeaveReview" data-onclick-arg0="${esc(id)}">
                  + Leave a review
                </button>`
                  : ""
              }
            </div>
          </div>
        </div>
      </div>`;
  } catch {
    v.innerHTML =
      '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Failed to load template.</p></div>';
  }
}

// Stage 9 safety: let a signed-in user report/flag a template for moderation.
async function agReportTemplate(id) {
  if (!getToken()) {
    (typeof showToast === "function" ? showToast : toast)(
      "Sign in to report a template.",
    );
    return;
  }
  const reason =
    typeof siModal !== "undefined" && siModal.input
      ? await siModal.input(
          "Report template",
          "spam / unsafe / stolen / broken…",
          "",
          {
            description:
              "Tell us why you’re reporting this template. Our team will review it.",
            confirmLabel: "Submit report",
          },
        )
      : prompt("Why are you reporting this template?");
  if (!reason || !reason.trim()) return;
  const notify = (m) =>
    (typeof showToast === "function" ? showToast : toast)(m);
  try {
    const r = await fetch(`/api/agents/templates/${id}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken(), reason: reason.trim() }),
    });
    const d = await r.json();
    notify(
      d && d.ok
        ? "Report submitted, thank you. Our team will review it."
        : d.detail || "Could not submit report.",
    );
  } catch {
    notify("Could not submit report.");
  }
}

function agDefaultIncluded(contents) {
  const items = [];
  if ((contents.spaces || []).length)
    items.push({
      icon: "ti-layout-sidebar",
      description: `${contents.spaces.length} Space${contents.spaces.length > 1 ? "s" : ""}`,
    });
  if ((contents.tasks || []).length)
    items.push({
      icon: "ti-checkbox",
      description: `${contents.tasks.length} pre-built tasks`,
    });
  if ((contents.habits || []).length)
    items.push({
      icon: "ti-repeat",
      description: `${contents.habits.length} habit${contents.habits.length > 1 ? "s" : ""}`,
    });
  if ((contents.goals || []).length)
    items.push({
      icon: "ti-target",
      description: `${contents.goals.length} goal template${contents.goals.length > 1 ? "s" : ""}`,
    });
  if ((contents.aiPrompts || []).length)
    items.push({
      icon: "ti-message-bolt",
      description: `${contents.aiPrompts.length} AI prompts`,
    });
  if ((contents.studyDeck || []).length)
    items.push({
      icon: "ti-cards",
      description: `${contents.studyDeck.length} flashcards`,
    });
  if ((contents.journalPrompts || []).length)
    items.push({
      icon: "ti-notebook",
      description: `${contents.journalPrompts.length} journal prompts`,
    });
  if (!items.length)
    return '<p style="font-size:.8rem;color:var(--muted)">Template contents not listed.</p>';
  return items
    .map(
      (i) =>
        `<div class="ag-included-item"><i class="ti ${i.icon}"></i><span>${i.description}</span></div>`,
    )
    .join("");
}

// ── Get / install / purchase ──────────────────────────────────
async function agHandleGet(templateId, price) {
  if (!S.sid) {
    showToast("Sign in to get templates.");
    return;
  }
  if (parseFloat(price) === 0) {
    await agInstallFree(templateId);
  } else if (_ag.currency === "ngn" && _ag.paystackAvailable) {
    await agStartPaystackCheckout(templateId);
  } else {
    await agStartCheckout(templateId);
  }
}

async function agSelectPayment(templateId, price, currency) {
  _ag.currency = currency;
  await agHandleGet(templateId, price);
}

async function agInstallFree(templateId) {
  try {
    const r = await fetch(`/api/agents/templates/${templateId}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken() }),
    });
    const d = await r.json();
    if (d.ok) {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess("Template installed! Check your Spaces.");
      agOpenTemplate(templateId);
    }
  } catch {
    showToast("Install failed. Try again.");
  }
}

async function agStartCheckout(templateId) {
  showToast("Redirecting to checkout…");
  try {
    const r = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken(), template_id: templateId }),
    });
    const d = await r.json();
    if (d.status === "installed") {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess("Template installed!");
      agOpenTemplate(templateId);
    } else if (d.checkout_url) {
      window.location.href = d.checkout_url;
    }
  } catch {
    showToast("Checkout failed. Try again.");
  }
}

async function agStartPaystackCheckout(templateId) {
  if (!window.PaystackPop) {
    showToast("Paystack not ready. Please refresh and try again.");
    return;
  }
  showToast("Preparing payment…");
  try {
    const r = await fetch("/api/payments/paystack/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken(), template_id: templateId }),
    });
    const d = await r.json();
    if (d.status === "installed") {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess("Template installed!");
      agOpenTemplate(templateId);
      return;
    }
    if (!d.access_code) {
      showToast(d.detail || "Payment setup failed.");
      return;
    }
    const handler = window.PaystackPop.setup({
      key: _ag.paystackKey,
      email: S.email || "",
      access_code: d.access_code,
      ref: d.reference,
      onSuccess(transaction) {
        agHandlePaystackSuccess(transaction, templateId);
      },
      onCancel() {
        showToast("Payment cancelled.");
      },
    });
    handler.openIframe();
  } catch {
    showToast("Payment failed. Try again.");
  }
}

async function agHandlePaystackSuccess(transaction, templateId) {
  showToast("Verifying payment…");
  try {
    const r = await fetch(
      `/api/payments/paystack/verify/${transaction.reference}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getToken() }),
      },
    );
    const d = await r.json();
    if (d.ok) {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess("Payment successful! Template installed.");
      agOpenTemplate(templateId);
    } else {
      showToast(d.detail || "Verification failed. Contact support.");
    }
  } catch {
    showToast("Verification failed. Try again.");
  }
}

function agApplyContents(contents) {
  // Spaces
  (contents.spaces || []).forEach((sp) => {
    const spaces = getSpaces();
    const id = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const space = {
      id,
      name: sp.name || "New Space",
      type: sp.type || "personal",
      icon: sp.type === "personal" ? "👤" : "🎓",
    };
    spaces.push(space);
    saveSpaces(spaces);
    syncSpaceMeta(space);
  });
  // Tasks — keyed per-account (`_${S.sid}`) like every panel that reads
  // this store; without the suffix, installed content was written
  // somewhere no panel ever looked, so it silently never appeared.
  (contents.tasks || []).forEach((task) => {
    const tasks = JSON.parse(
      localStorage.getItem(`sivarr_tasks_${S.sid}`) || "[]",
    );
    tasks.push({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...task,
      done: false,
    });
    localStorage.setItem(`sivarr_tasks_${S.sid}`, JSON.stringify(tasks));
  });
  // Goals
  (contents.goals || []).forEach((g) => {
    const goals = JSON.parse(
      localStorage.getItem(`sivarr_goals_${S.sid}`) || "[]",
    );
    goals.push({
      id: `gl_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...g,
      done: false,
    });
    localStorage.setItem(`sivarr_goals_${S.sid}`, JSON.stringify(goals));
  });
  // Habits
  (contents.habits || []).forEach((h) => {
    const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || "[]");
    habits.push({
      id: `hb_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...h,
    });
    localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  });
  // Sidebar re-render
  if (typeof spaceRenderSidebar === "function")
    setTimeout(spaceRenderSidebar, 200);
}

function agShowInstallSuccess(msg) {
  const el = document.createElement("div");
  el.className = "ag-install-success";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Agent profile ─────────────────────────────────────────────
async function agOpenAgentProfile(agentId) {
  agNav("profile");
  agRenderLoading();
  const v = $("ag-view");
  if (!v) return;
  try {
    const r = await fetch(`/api/agents/${agentId}`);
    const d = await r.json();
    const a = d.agent;
    if (!a || !a.id) {
      v.innerHTML =
        '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Agent not found.</p></div>';
      return;
    }
    const templates = a.templates || [];

    // Check follow state
    let isFollowing = false;
    if (getToken()) {
      // Optimistic — no dedicated endpoint, infer from UI state
    }

    v.innerHTML = `
      <div class="ag-profile-wrap">
        <div class="ag-profile-hero">
          <div class="ag-profile-av">${(a.display_name || "?")[0].toUpperCase()}</div>
          <div class="ag-profile-info">
            <div class="ag-profile-name">
              ${esc(a.display_name || "")}
              ${a.verified ? '<i class="ti ti-rosette-discount-check ag-verified-badge" title="Verified Agent"></i>' : ""}
            </div>
            <div class="ag-profile-bio">${esc(a.bio || "")}</div>
            <div class="ag-profile-stats">
              <div><strong>${templates.length}</strong> templates</div>
              <div><strong>${a.total_downloads || 0}</strong> downloads</div>
              <div><strong>${(a.avg_rating || 0).toFixed(1)}</strong> avg rating</div>
              <div><strong>${a.follower_count || 0}</strong> followers</div>
            </div>
          </div>
          <button class="ag-follow-btn${isFollowing ? " following" : ""}" id="ag-follow-btn-${agentId}"
            data-onclick="agToggleFollow" data-onclick-arg0="${esc(agentId)}">
            ${isFollowing ? "Following" : "+ Follow"}
          </button>
        </div>

        <div class="ag-section-hd">
          <div class="ag-section-title">Templates by ${esc(a.display_name || "")}</div>
        </div>
        <div class="ag-grid">
          ${
            templates.length
              ? templates.map((t) => agTemplateCardHTML(t)).join("")
              : '<div class="ag-empty" style="grid-column:1/-1"><div class="ag-empty-icon">📦</div><p>No published templates yet.</p></div>'
          }
        </div>
      </div>`;
  } catch {
    v.innerHTML =
      '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Failed to load agent.</p></div>';
  }
}

async function agToggleFollow(agentId) {
  const btn = $(`ag-follow-btn-${agentId}`);
  if (!btn || !getToken()) return;
  const following = btn.classList.contains("following");
  btn.classList.toggle("following", !following);
  btn.textContent = !following ? "Following" : "+ Follow";
  try {
    await fetch(`/api/agents/${agentId}/follow`, {
      method: following ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken() }),
    });
  } catch {}
}

// ── Agents directory ──────────────────────────────────────────
async function agRenderDirectory() {
  agNav("directory");
  agRenderLoading();
  const v = $("ag-view");
  if (!v) return;
  await agFetchAgents();
  v.innerHTML = `
    <div class="ag-dir-wrap">
      <div class="ag-dir-sort" id="ag-dir-sort">
        ${[
          { id: "downloads", label: "Most downloads" },
          { id: "rating", label: "Highest rated" },
          { id: "newest", label: "Newest" },
        ]
          .map(
            (s) => `
          <button class="ag-dir-sort-btn${s.id === "downloads" ? " active" : ""}"
            data-onclick="agReSortAgents" data-onclick-arg0="${s.id}" data-onclick-this>${s.label}</button>
        `,
          )
          .join("")}
      </div>
      <div id="ag-dir-list">
        ${
          _ag.agents.length
            ? _ag.agents.map((a) => agAgentRowHTML(a)).join("")
            : `<div class="ag-launch-hero" style="margin-top:24px">
              <div class="ag-launch-icon">🌐</div>
              <div class="ag-launch-title">No agents yet</div>
              <div class="ag-launch-desc">Sivarr Agents is in early access. Apply now and get prime visibility as one of the founding creators.</div>
              <button class="ag-tb-btn ag-tb-btn--primary" style="margin-top:8px" data-onclick="_agNavApply">
                <i class="ti ti-user-plus"></i> Apply to become an agent
              </button>
            </div>`
        }
      </div>
    </div>`;
}

async function agReSortAgents(sort, btn) {
  const btns = document.querySelectorAll(".ag-dir-sort-btn");
  btns.forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  await agFetchAgents(sort);
  const list = $("ag-dir-list");
  if (list) list.innerHTML = _ag.agents.map((a) => agAgentRowHTML(a)).join("");
}

// ── Become an agent (3-step form) ─────────────────────────────
const _agApply = { step: 1, data: {} };

function agRenderApply(step) {
  if (!step) step = 1;
  _agApply.step = step;
  agNav("apply");
  const v = $("ag-view");
  if (!v) return;

  const steps = ["Profile", "Payout", "Confirm"];
  const stepsHTML = steps
    .map(
      (s, i) => `
    <div class="ag-apply-step${i + 1 === step ? " active" : i + 1 < step ? " done" : ""}">
      <div class="ag-step-dot">${i + 1 < step ? "✓" : i + 1}</div>
      <span class="ag-step-label">${s}</span>
    </div>`,
    )
    .join("");

  let bodyHTML = "";
  if (step === 1) {
    bodyHTML = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Set up your agent profile</div>
        <div class="ag-apply-sub">This is how you'll appear in the marketplace.</div>
        <div class="ag-field">
          <label>Display name</label>
          <input id="ag-app-name" placeholder="Your creator name" value="${esc(_agApply.data.display_name || S.name || "")}">
        </div>
        <div class="ag-field">
          <label>Bio <span style="color:var(--muted);font-weight:400">(1–2 lines)</span></label>
          <textarea id="ag-app-bio" rows="2" placeholder="Describe what you create…">${esc(_agApply.data.bio || "")}</textarea>
        </div>
        <div class="ag-field">
          <label>Speciality</label>
          <div class="ag-spec-grid">
            ${[
              "Workspace",
              "Academic",
              "AI prompts",
              "Goals",
              "Journal",
              "Study decks",
            ]
              .map((s) => {
                const id = s.toLowerCase().replace(/ /g, "_");
                const sel = (_agApply.data.speciality || []).includes(s);
                return `<button class="ag-spec-chip${sel ? " sel" : ""}" data-onclick="agToggleSpec" data-onclick-arg0="${s}" data-onclick-this>${s}</button>`;
              })
              .join("")}
          </div>
        </div>
      </div>
      <div class="ag-apply-nav">
        <button class="ag-btn-next" data-onclick="agApplyNext" data-onclick-args="[1]">Continue →</button>
      </div>`;
  } else if (step === 2) {
    bodyHTML = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Set up payouts</div>
        <div class="ag-apply-sub">You earn <strong>90%</strong> of every sale. Sivarr takes 10%. Paid monthly via Stripe. Minimum payout $10.</div>
        <div class="ag-earn-card">
          <div style="font-size:.72rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">💰 Revenue split</div>
          <div style="font-size:.84rem;line-height:1.8">
            You keep: <strong style="color:var(--green,#22c55e)">90%</strong> of every sale<br>
            Sivarr fee: <strong>10%</strong><br>
            Paid: <strong>Monthly</strong> (min $10)
          </div>
        </div>
        <div class="ag-field">
          <label>Stripe payout email</label>
          <input id="ag-app-email" type="email" placeholder="your@email.com" value="${esc(_agApply.data.stripe_email || "")}">
        </div>
        <div class="ag-field">
          <label>Country</label>
          <select id="ag-app-country">
            ${[
              "US",
              "GB",
              "CA",
              "AU",
              "NG",
              "GH",
              "KE",
              "ZA",
              "IN",
              "DE",
              "FR",
              "NL",
              "SG",
              "AE",
            ]
              .map(
                (c) =>
                  `<option value="${c}"${(_agApply.data.country || "US") === c ? " selected" : ""}>${c}</option>`,
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="ag-apply-nav">
        <button class="ag-btn-back" data-onclick="agRenderApply" data-onclick-args="[1]">← Back</button>
        <button class="ag-btn-next" data-onclick="agApplyNext" data-onclick-args="[2]">Continue →</button>
      </div>`;
  } else if (step === 3) {
    const d = _agApply.data;
    bodyHTML = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Review your application</div>
        <div class="ag-apply-sub">Check everything looks right before submitting.</div>
        <div style="font-size:.84rem;line-height:2">
          <strong>Name:</strong> ${esc(d.display_name || "")}<br>
          <strong>Bio:</strong> ${esc(d.bio || "")}<br>
          <strong>Speciality:</strong> ${(d.speciality || []).join(", ") || "–"}<br>
          <strong>Payout email:</strong> ${esc(d.stripe_email || "–")}<br>
          <strong>Country:</strong> ${esc(d.country || "–")}
        </div>
      </div>
      <div class="ag-apply-card" style="background:linear-gradient(135deg,#4f6ef710,transparent);border-color:#4f6ef730">
        <div style="font-size:.8rem;color:var(--text2);line-height:1.7">
          ✅ Once submitted, our team will review your application.<br>
          ✅ You'll receive a Stripe onboarding link to complete payout setup.<br>
          ✅ After approval you can start publishing templates immediately.
        </div>
      </div>
      <div class="ag-apply-nav">
        <button class="ag-btn-back" data-onclick="agRenderApply" data-onclick-args="[2]">← Back</button>
        <button class="ag-btn-next" id="ag-submit-btn" data-onclick="agSubmitApplication">Submit application →</button>
      </div>`;
  }

  v.innerHTML = `
    <div class="ag-apply-wrap">
      <div class="ag-apply-steps">${stepsHTML}</div>
      ${bodyHTML}
    </div>`;
}

// CSP migration: param order flipped to (spec, btn) -- delegate.js's
// data-onclick-this always appends the element LAST (js/core/delegate.js's
// collectArgs), never first, so the old (element, arg) order isn't
// expressible without a wrapper. Only call site is the spec chip below.
function agToggleSpec(spec, btn) {
  btn.classList.toggle("sel");
  const specs = _agApply.data.speciality || [];
  const idx = specs.indexOf(spec);
  if (idx === -1) specs.push(spec);
  else specs.splice(idx, 1);
  _agApply.data.speciality = specs;
}

function agApplyNext(fromStep) {
  if (fromStep === 1) {
    _agApply.data.display_name = ($("ag-app-name") || {}).value?.trim();
    _agApply.data.bio = ($("ag-app-bio") || {}).value?.trim();
    if (!_agApply.data.display_name) {
      showToast("Enter a display name.");
      return;
    }
    agRenderApply(2);
  } else if (fromStep === 2) {
    _agApply.data.stripe_email = ($("ag-app-email") || {}).value?.trim();
    _agApply.data.country = ($("ag-app-country") || {}).value;
    agRenderApply(3);
  }
}

async function agSubmitApplication() {
  const btn = $("ag-submit-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Submitting…";
  }
  try {
    const r = await fetch("/api/agents/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken(), ..._agApply.data }),
    });
    const d = await r.json();
    if (d.ok) {
      _ag.myAgent = { id: d.agent_id, status: "applied", ..._agApply.data };
      agUpdateTopbarBtn();
      $("ag-view").innerHTML = `
        <div class="ag-apply-wrap" style="text-align:center">
          <div style="font-size:3rem;margin-bottom:16px">🎉</div>
          <div style="font-family:var(--font);font-size:1.2rem;font-weight:800;margin-bottom:8px">Application submitted!</div>
          <p style="font-size:.84rem;color:var(--muted);margin-bottom:24px">
            ${
              d.onboarding_url
                ? "Check your email for the Stripe onboarding link to complete payout setup."
                : "Our team will review your application and activate your account shortly."
            }
          </p>
          ${d.onboarding_url ? `<a href="${d.onboarding_url}" target="_blank" class="ag-btn-next" style="display:inline-block;text-decoration:none;padding:10px 24px">Complete Stripe setup →</a>` : ""}
          <br><br>
          <button class="ag-btn-back" data-onclick="_agNavMarketplace">Back to marketplace</button>
        </div>`;
    } else {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Submit application →";
      }
      showToast(d.detail || "Submission failed.");
    }
  } catch {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Submit application →";
    }
    showToast("Submission failed. Try again.");
  }
}

// ── Creator dashboard ─────────────────────────────────────────
const _agDash = {
  tab: "overview",
  templates: [],
  earnings: {},
  payouts: [],
  reviews: [],
};

async function agRenderDashboard() {
  if (!_ag.myAgent) {
    agNav("apply");
    agRenderApply();
    return;
  }
  agNav("dashboard");
  const v = $("ag-view");
  if (!v) return;
  v.innerHTML = `
    <div class="ag-dash-wrap">
      <div class="ag-dash-tabs">
        <button class="ag-dash-tab active" id="ag-dt-overview"  data-onclick="agDashTab" data-onclick-arg0="overview" data-onclick-this>Overview</button>
        <button class="ag-dash-tab"        id="ag-dt-templates" data-onclick="agDashTab" data-onclick-arg0="templates" data-onclick-this>My Templates</button>
        <button class="ag-dash-tab"        id="ag-dt-earnings"  data-onclick="agDashTab" data-onclick-arg0="earnings" data-onclick-this>Earnings</button>
        <button class="ag-dash-tab"        id="ag-dt-reviews"   data-onclick="agDashTab" data-onclick-arg0="reviews" data-onclick-this>Reviews</button>
        <button class="ag-dash-tab"        id="ag-dt-settings"  data-onclick="agDashTab" data-onclick-arg0="settings" data-onclick-this>Settings</button>
      </div>
      <div id="ag-dash-content">
        <div class="ag-loading"><div class="ag-spinner"></div></div>
      </div>
    </div>`;
  await agDashLoadOverview();
}

// CSP migration: this one call site passes a DIFFERENT element than the
// one clicked (jumps straight to the Templates tab from elsewhere in the
// dashboard) -- data-onclick-this always passes the clicked element itself,
// so that specific call needs a small wrapper instead.
window._agDashTabTemplates = function () {
  agDashTab("templates", document.getElementById("ag-dt-templates"));
};

async function agDashTab(tab, btn) {
  _agDash.tab = tab;
  document
    .querySelectorAll(".ag-dash-tab")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  if (tab === "overview") await agDashLoadOverview();
  if (tab === "templates") await agDashLoadTemplates();
  if (tab === "earnings") await agDashLoadEarnings();
  if (tab === "reviews") await agDashLoadReviews();
  if (tab === "settings") agDashRenderSettings();
}

async function agDashLoadOverview() {
  const [earningsR, templatesR] = await Promise.all([
    fetch(`/api/agents/me/earnings?token=${getToken()}`)
      .then((r) => r.json())
      .catch(() => ({})),
    fetch(`/api/agents/me/templates?token=${getToken()}`)
      .then((r) => r.json())
      .catch(() => ({ templates: [] })),
  ]);
  const agent = _ag.myAgent || {};
  const earnings = earningsR;
  const templates = templatesR.templates || [];
  const monthly = (earnings.monthly || [])[0] || {};
  const totalEarned = parseFloat(agent.total_earned || 0).toFixed(2);
  const monthNet = parseFloat(monthly.net || 0).toFixed(2);
  const allDL = agent.total_downloads || 0;
  const avgRating = parseFloat(agent.avg_rating || 0).toFixed(1);

  const byTpl = earnings.by_template || [];
  const maxNet = Math.max(...byTpl.map((t) => t.net), 0.01);

  const barRows =
    byTpl
      .map(
        (t) => `
    <div class="ag-bar-row">
      <span class="ag-bar-label" title="${esc(t.name)}">${esc(t.name)}</span>
      <div class="ag-bar-track"><div class="ag-bar-fill" style="width:${((t.net / maxNet) * 100).toFixed(1)}%"></div></div>
      <span class="ag-bar-val">$${t.net.toFixed(2)}</span>
    </div>`,
      )
      .join("") ||
    '<p style="font-size:.8rem;color:var(--muted)">No earnings yet.</p>';

  const feed =
    templates
      .slice(0, 5)
      .map(
        (t) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:.8rem">
      <i class="ti ${AG_CAT_ICONS[t.category] || "ti-template"}" style="color:${AG_CAT_COLORS[t.category] || "var(--accent)"}"></i>
      <span style="flex:1;font-weight:600">${esc(t.name)}</span>
      <span style="color:var(--muted)">${t.download_count || 0} downloads</span>
      <span class="ag-status-badge ${t.status === "published" ? "live" : t.status}">${t.status}</span>
    </div>`,
      )
      .join("") ||
    '<p style="font-size:.8rem;color:var(--muted)">No templates yet.</p>';

  $("ag-dash-content").innerHTML = `
    <div class="ag-stat-row">
      <div class="ag-stat-card" style="--c1:#22c55e">
        <div class="ag-stat-label">Total earned</div>
        <div class="ag-stat-val">$${totalEarned}</div>
      </div>
      <div class="ag-stat-card" style="--c1:#4f6ef7">
        <div class="ag-stat-label">This month</div>
        <div class="ag-stat-val">$${monthNet}</div>
      </div>
      <div class="ag-stat-card" style="--c1:#f59e0b">
        <div class="ag-stat-label">Downloads</div>
        <div class="ag-stat-val">${allDL}</div>
      </div>
      <div class="ag-stat-card" style="--c1:#7f77dd">
        <div class="ag-stat-label">Avg rating</div>
        <div class="ag-stat-val">${avgRating}</div>
      </div>
    </div>

    ${
      parseFloat(agent.pending_earnings || 0) > 0
        ? `
    <div class="ag-payout-card">
      <div>
        <div style="font-size:.72rem;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:.06em">Upcoming payout</div>
        <div style="font-size:1.1rem;font-weight:800;font-family:var(--font)">$${parseFloat(agent.pending_earnings).toFixed(2)}</div>
        <div style="font-size:.78rem;color:var(--muted)">Paid on the 1st of next month via Stripe</div>
      </div>
      <div style="font-size:1.4rem">💸</div>
    </div>`
        : ""
    }

    <div style="margin-bottom:24px">
      <div class="ag-section-title" style="margin-bottom:12px">Revenue by template</div>
      <div class="ag-bar-chart">${barRows}</div>
    </div>

    <div>
      <div class="ag-section-hd">
        <div class="ag-section-title">Recent templates</div>
        <button class="ag-section-link" data-onclick="_agDashTabTemplates">See all</button>
      </div>
      ${feed}
    </div>`;
}

async function agDashLoadTemplates() {
  const r = await fetch(`/api/agents/me/templates?token=${getToken()}`).catch(
    () => ({ ok: false }),
  );
  const d = r.ok !== false ? await r.json() : { templates: [] };
  const templates = d.templates || [];

  $("ag-dash-content").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div class="ag-section-title">My templates (${templates.length})</div>
      <button class="ag-tb-btn ag-tb-btn--primary" data-onclick="agOpenBuilder">
        <i class="ti ti-plus"></i> New template
      </button>
    </div>
    ${
      templates.length
        ? `
    <table class="ag-tpl-table">
      <thead><tr>
        <th></th><th>Name</th><th>Downloads</th><th>Price</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${templates
          .map(
            (t) => `
          <tr>
            <td><i class="ti ${AG_CAT_ICONS[t.category] || "ti-template"}" style="color:${AG_CAT_COLORS[t.category] || "var(--accent)"}"></i></td>
            <td style="font-weight:600">${esc(t.name)}</td>
            <td>${t.download_count || 0}</td>
            <td>${parseFloat(t.price || 0) === 0 ? "Free" : "$" + parseFloat(t.price).toFixed(2)}</td>
            <td><span class="ag-status-badge ${t.status === "published" ? "live" : t.status}">${t.status}</span></td>
            <td style="display:flex;gap:6px">
              <button class="ag-tb-btn" style="font-size:.7rem;padding:3px 9px" data-onclick="agOpenBuilder" data-onclick-arg0="${esc(t.id)}">Edit</button>
              ${t.status === "draft" ? `<button class="ag-tb-btn ag-tb-btn--primary" style="font-size:.7rem;padding:3px 9px" data-onclick="agPublishTemplate" data-onclick-arg0="${esc(t.id)}">Publish</button>` : ""}
              <button class="ag-tb-btn" style="font-size:.7rem;padding:3px 9px;color:var(--red)" data-onclick="agDeleteTemplate" data-onclick-arg0="${esc(t.id)}">Delete</button>
            </td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
        : `
    <div class="ag-empty">
      <div class="ag-empty-icon">📦</div>
      <p>No templates yet.</p>
      <button class="ag-btn-next" style="margin-top:12px" data-onclick="agOpenBuilder">Create your first template</button>
    </div>`
    }`;
}

async function agPublishTemplate(id) {
  if (
    !(await siModal.confirm(
      "Your template will be visible to all users in the marketplace.",
      { title: "Publish Template", confirmLabel: "Publish" },
    ))
  )
    return;
  const r = await fetch(`/api/agents/me/templates/${id}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: getToken() }),
  });
  const d = await r.json();
  if (d.ok) {
    showToast("Template published!");
    agDashLoadTemplates();
  } else showToast(d.detail || "Publish failed.");
}

async function agDeleteTemplate(id) {
  if (
    !(await siModal.confirm(
      "This template will be permanently removed from the marketplace.",
      { title: "Delete Template", confirmLabel: "Delete", danger: true },
    ))
  )
    return;
  const r = await fetch(`/api/agents/me/templates/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: getToken() }),
  });
  const d = await r.json();
  if (d.ok) {
    showToast("Template deleted.");
    agDashLoadTemplates();
  }
}

async function agDashLoadEarnings() {
  const [earningsR, payoutsR] = await Promise.all([
    fetch(`/api/agents/me/earnings?token=${getToken()}`)
      .then((r) => r.json())
      .catch(() => ({})),
    fetch(`/api/agents/me/payouts?token=${getToken()}`)
      .then((r) => r.json())
      .catch(() => ({ payouts: [] })),
  ]);
  const monthly = earningsR.monthly || [];
  const payouts = payoutsR.payouts || [];
  const agent = _ag.myAgent || {};
  const totalGross = monthly.reduce((s, m) => s + m.gross, 0).toFixed(2);
  const totalFee = monthly.reduce((s, m) => s + m.fee, 0).toFixed(2);
  const totalNet = monthly.reduce((s, m) => s + m.net, 0).toFixed(2);

  const monthRows =
    monthly
      .map(
        (m) => `
    <tr>
      <td>${m.month || ""}</td>
      <td>${m.downloads || 0}</td>
      <td>$${m.gross.toFixed(2)}</td>
      <td style="color:var(--muted)">$${m.fee.toFixed(2)}</td>
      <td style="color:var(--green,#22c55e);font-weight:700">$${m.net.toFixed(2)}</td>
      <td><span class="ag-status-badge live">Paid</span></td>
    </tr>`,
      )
      .join("") ||
    `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px">No earnings yet.</td></tr>`;

  $("ag-dash-content").innerHTML = `
    <div class="ag-stat-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:24px">
      <div class="ag-stat-card" style="--c1:#4f6ef7"><div class="ag-stat-label">Total gross</div><div class="ag-stat-val">$${totalGross}</div></div>
      <div class="ag-stat-card" style="--c1:#ef4444"><div class="ag-stat-label">Sivarr fee (10%)</div><div class="ag-stat-val">$${totalFee}</div></div>
      <div class="ag-stat-card" style="--c1:#22c55e"><div class="ag-stat-label">Your net earnings</div><div class="ag-stat-val">$${totalNet}</div></div>
    </div>

    <div class="ag-section-title" style="margin-bottom:12px">Monthly breakdown</div>
    <table class="ag-earnings-table" style="margin-bottom:28px">
      <thead><tr>
        <th>Month</th><th>Downloads</th><th>Gross</th><th>Sivarr (10%)</th><th>Your earnings</th><th>Status</th>
      </tr></thead>
      <tbody>${monthRows}</tbody>
    </table>

    ${
      payouts.length
        ? `
    <div class="ag-section-title" style="margin-bottom:12px">Payout history</div>
    <table class="ag-earnings-table">
      <thead><tr><th>Date</th><th>Amount</th><th>Transfer ID</th><th>Status</th></tr></thead>
      <tbody>
        ${payouts
          .map(
            (p) => `
          <tr>
            <td>${p.paid_at ? String(p.paid_at).slice(0, 10) : p.created_at?.slice(0, 10) || "–"}</td>
            <td style="font-weight:700">$${parseFloat(p.amount).toFixed(2)}</td>
            <td style="font-size:.72rem;color:var(--muted)">${p.stripe_transfer_id || "–"}</td>
            <td><span class="ag-status-badge ${p.status === "paid" ? "live" : "review"}">${p.status}</span></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`
        : ""
    }`;
}

async function agDashLoadReviews() {
  const r = await fetch(`/api/agents/me/reviews?token=${getToken()}`).catch(
    () => ({ ok: false }),
  );
  const d = r.ok !== false ? await r.json() : { reviews: [] };
  const reviews = d.reviews || [];

  $("ag-dash-content").innerHTML = reviews.length
    ? `
    ${reviews
      .map(
        (rv) => `
      <div class="ag-review-item">
        <div class="ag-review-header">
          <div class="ag-review-av">${(rv.reviewer_name || "?")[0].toUpperCase()}</div>
          <span class="ag-review-name">${esc(rv.reviewer_name || "")}</span>
          <span class="ag-review-stars">${"★".repeat(rv.rating || 5)}</span>
          <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">${esc(rv.template_name || "")}</span>
        </div>
        <div class="ag-review-text">${esc(rv.review_text || "")}</div>
      </div>`,
      )
      .join("")}`
    : '<div class="ag-empty"><div class="ag-empty-icon">💬</div><p>No reviews yet.</p></div>';
}

function agDashRenderSettings() {
  const a = _ag.myAgent || {};
  $("ag-dash-content").innerHTML = `
    <div style="max-width:480px">
      <div class="ag-apply-card">
        <div class="ag-apply-title">Agent settings</div>
        <div class="ag-field"><label>Display name</label>
          <input id="ag-set-name" value="${esc(a.display_name || "")}"></div>
        <div class="ag-field"><label>Bio</label>
          <textarea id="ag-set-bio" rows="2">${esc(a.bio || "")}</textarea></div>
        <button class="ag-btn-next" data-onclick="agSaveSettings">Save changes</button>
      </div>
      <div class="ag-apply-card" style="border-color:#ef444430;background:#ef444408">
        <div style="font-size:.84rem;font-weight:700;color:var(--red);margin-bottom:8px">Danger zone</div>
        <p style="font-size:.78rem;color:var(--muted);margin-bottom:12px">Deleting your agent account will remove all templates and forfeit any unpaid earnings.</p>
        <button data-onclick="agDeleteAccount" style="background:none;border:1px solid #ef4444;border-radius:8px;padding:7px 16px;color:var(--red);font-size:.78rem;font-weight:700;cursor:pointer">Delete agent account</button>
      </div>
    </div>`;
}

async function agSaveSettings() {
  const name = ($("ag-set-name") || {}).value?.trim();
  const bio = ($("ag-set-bio") || {}).value?.trim();
  const r = await fetch("/api/agents/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: getToken(), display_name: name, bio }),
  });
  const d = await r.json();
  if (d.ok) {
    _ag.myAgent = { ...(_ag.myAgent || {}), display_name: name, bio };
    showToast("Settings saved.");
  } else showToast(d.detail || "Save failed.");
}

async function agDeleteAccount() {
  if (
    !(await siModal.confirm(
      "Your agent profile and all templates will be permanently removed.",
      {
        title: "Delete Agent Account",
        confirmLabel: "Delete Account",
        danger: true,
      },
    ))
  )
    return;
  showToast("Contact support to delete your agent account.");
}

// ── Template builder (4-step) ─────────────────────────────────
const _agBuilder = {
  step: 1,
  id: null,
  data: {
    name: "",
    short_description: "",
    full_description: "",
    category: "workspace",
    tags: [],
    thumbnail_color: "#4f6ef7",
    price: 0,
    price_ngn: null,
    contents: {},
    included_items: [],
    free: true,
  },
};
const AG_COLORS = [
  "#4f6ef7",
  "#7c3aed",
  "#22c55e",
  "#d97706",
  "#ef4444",
  "#7f77dd",
  "#d85a30",
];
const AG_CONTENTS = [
  {
    id: "spaces",
    icon: "🏠",
    name: "Spaces",
    desc: "Personal or academic spaces",
  },
  { id: "tasks", icon: "✅", name: "Task board", desc: "Pre-built task list" },
  {
    id: "goals",
    icon: "🎯",
    name: "Goals",
    desc: "Pre-configured goal templates",
  },
  {
    id: "habits",
    icon: "🔁",
    name: "Habit stack",
    desc: "Daily and weekly habits",
  },
  { id: "studyDeck", icon: "🃏", name: "Study deck", desc: "Flashcard set" },
  {
    id: "aiPrompts",
    icon: "🤖",
    name: "AI prompt pack",
    desc: "Up to 100 AI prompts",
  },
  {
    id: "journalPrompts",
    icon: "📓",
    name: "Journal prompts",
    desc: "Reflection prompt set",
  },
];

async function agOpenBuilder(templateId) {
  _agBuilder.step = 1;
  _agBuilder.id = templateId || null;
  if (templateId) {
    // Pre-load existing template
    try {
      const r = await fetch(`/api/agents/templates/${templateId}`);
      const d = await r.json();
      if (d.template) {
        const t = d.template;
        _agBuilder.data = {
          name: t.name,
          short_description: t.short_description,
          full_description: t.full_description,
          category: t.category,
          tags: t.tags || [],
          thumbnail_color: t.thumbnail_color || "#4f6ef7",
          price: t.price,
          price_ngn: t.price_ngn || null,
          contents: t.contents || {},
          included_items: t.included_items || [],
          free: parseFloat(t.price || 0) === 0,
        };
      }
    } catch {}
  }
  agNav("builder");
  agRenderBuilder();
}

function agRenderBuilder() {
  const step = _agBuilder.step;
  const d = _agBuilder.data;
  const v = $("ag-view");
  if (!v) return;
  const stepsBar = [1, 2, 3, 4]
    .map(
      (i) =>
        `<div class="ag-builder-step${i < step ? " done" : i === step ? " active" : ""}"></div>`,
    )
    .join("");

  let body = "";
  if (step === 1) {
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 1: Basics</div>
        <div class="ag-field"><label>Template name <span style="color:var(--muted)">(max 60 chars)</span></label>
          <input id="ab-name" maxlength="60" placeholder="My awesome template" value="${esc(d.name)}"></div>
        <div class="ag-field"><label>Short description <span style="color:var(--muted)">(max 120)</span></label>
          <input id="ab-short" maxlength="120" placeholder="One-liner…" value="${esc(d.short_description)}"></div>
        <div class="ag-field"><label>Full description</label>
          <textarea id="ab-full" rows="4" maxlength="800" placeholder="Detailed description…">${esc(d.full_description)}</textarea></div>
        <div class="ag-field"><label>Category</label>
          <select id="ab-cat">
            ${Object.entries(AG_CAT_LABELS)
              .filter(([k]) => k !== "all")
              .map(
                ([k, v]) =>
                  `<option value="${k}"${d.category === k ? " selected" : ""}>${v}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="ag-field"><label>Tags <span style="color:var(--muted)">(comma-separated, up to 5)</span></label>
          <input id="ab-tags" placeholder="productivity, students…" value="${(d.tags || []).join(", ")}"></div>
        <div class="ag-field"><label>Thumbnail colour</label>
          <div class="ag-color-picker">
            ${AG_COLORS.map(
              (c) => `
              <div class="ag-color-swatch${d.thumbnail_color === c ? " sel" : ""}"
                style="background:${c}" data-onclick="agBuilderSetColor" data-onclick-arg0="${c}" data-onclick-this></div>`,
            ).join("")}
          </div>
        </div>
      </div>`;
  } else if (step === 2) {
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 2: Contents</div>
        <div class="ag-apply-sub">Select content types and add the actual items that get installed with this template.</div>
        <div class="ag-contents-list">
          ${AG_CONTENTS.map((c) => {
            const items = (d.contents && d.contents[c.id]) || [];
            const isOpen = items.length > 0;
            const count = items.length;
            return `
              <div class="ag-content-section${isOpen ? " open" : ""}" id="ab-ct-${c.id}">
                <div class="ag-content-header" data-onclick="agBuilderToggleSection" data-onclick-arg0="${c.id}">
                  <input type="checkbox"${isOpen ? " checked" : ""} data-onclick="agBuilderToggleSection" data-onclick-arg0="${c.id}">
                  <span class="ag-content-icon">${c.icon}</span>
                  <div class="ag-content-info">
                    <div class="ag-content-name">${c.name}</div>
                    <div class="ag-content-desc">${c.desc}</div>
                  </div>
                  <span class="ag-content-count">${count > 0 ? `${count} item${count !== 1 ? "s" : ""}` : ""}
                  </span>
                  <i class="ti ti-chevron-right ag-content-chevron"></i>
                </div>
                ${
                  isOpen
                    ? `
                <div class="ag-content-editor" id="ab-ce-${c.id}">
                  <div class="ag-items-list" id="ab-items-${c.id}">
                    ${items.map((item, i) => agBuilderItemRowHTML(c.id, i, item)).join("")}
                  </div>
                  <button class="ag-add-item-btn" data-onclick="agBuilderAddItem" data-onclick-arg0="${c.id}">
                    <i class="ti ti-plus"></i> Add item
                  </button>
                </div>`
                    : ""
                }
              </div>`;
          }).join("")}
        </div>
      </div>`;
  } else if (step === 3) {
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 3: Pricing</div>
        <div class="ag-pricing-toggle">
          <button class="ag-pricing-opt${d.free ? " active" : ""}" data-onclick="agBuilderSetPricing" data-onclick-args="[true]">🆓 Free</button>
          <button class="ag-pricing-opt${!d.free ? " active" : ""}" data-onclick="agBuilderSetPricing" data-onclick-args="[false]">💰 Paid</button>
        </div>
        <div id="ab-price-wrap" style="${d.free ? "display:none" : ""}">
          <div class="ag-field"><label>Price (USD)</label>
            <input id="ab-price" type="number" min="1" max="999" step="0.01" placeholder="4.99"
              value="${d.price > 0 ? d.price : ""}" data-oninput="agBuilderUpdateEarnings">
          </div>
          ${
            _ag.paystackAvailable
              ? `
          <div class="ag-field" style="margin-top:8px">
            <label>Price (NGN) <span style="font-size:.7rem;font-weight:400;color:var(--muted)">(leave blank to auto-calculate ≈ USD × ${_ag.nairaRate})</span></label>
            <input id="ab-price-ngn" type="number" min="100" step="50" placeholder="Auto"
              value="${d.price_ngn || ""}" data-oninput="agBuilderUpdateNgn">
          </div>`
              : ""
          }
          <div class="ag-earn-card" id="ab-earn-preview">
            ${agBuilderEarningsHTML(d.price || 0)}
          </div>
        </div>
      </div>`;
  } else if (step === 4) {
    const color = d.thumbnail_color || "#4f6ef7";
    const icon = AG_CAT_ICONS[d.category] || "ti-template";
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 4: Preview & publish</div>
        <div class="ag-apply-sub">This is how your template will appear in the marketplace.</div>
        <div style="max-width:240px;margin-bottom:20px">
          <div class="ag-card">
            <div class="ag-card-thumb" style="background:${color}20">
              <i class="ti ${icon}" style="color:${color};font-size:1.8rem"></i>
            </div>
            <div class="ag-card-body">
              <span class="ag-card-tag">${AG_CAT_LABELS[d.category] || d.category}</span>
              <div class="ag-card-name">${esc(d.name || "Template name")}</div>
              <div class="ag-card-footer">
                <span class="ag-price${d.free ? " free" : ""}">${d.free ? "Free" : "$" + parseFloat(d.price || 0).toFixed(2)}</span>
                <button class="ag-get-btn">Get</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="ag-btn-back" style="flex:1" data-onclick="agSaveTemplate" data-onclick-arg0="draft">Save as draft</button>
        <button class="ag-btn-next" style="flex:1" data-onclick="agSaveTemplate" data-onclick-arg0="published">Publish template 🚀</button>
      </div>`;
  }

  v.innerHTML = `
    <div class="ag-builder-wrap">
      <div class="ag-builder-steps">${stepsBar}</div>
      ${body}
      ${
        step < 4
          ? `
      <div class="ag-apply-nav">
        ${step > 1 ? `<button class="ag-btn-back" data-onclick="agBuilderStep" data-onclick-args="[${step - 1}]">← Back</button>` : "<span></span>"}
        <button class="ag-btn-next" data-onclick="agBuilderStep" data-onclick-args="[${step + 1}]">Continue →</button>
      </div>`
          : ""
      }
    </div>`;
}

function agBuilderStep(step) {
  const d = _agBuilder.data;
  if (_agBuilder.step === 1) {
    d.name = ($("ab-name") || {}).value?.trim() || "";
    d.short_description = ($("ab-short") || {}).value?.trim() || "";
    d.full_description = ($("ab-full") || {}).value?.trim() || "";
    d.category = ($("ab-cat") || {}).value || "workspace";
    d.tags = (($("ab-tags") || {}).value || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!d.name) {
      showToast("Enter a template name.");
      return;
    }
  }
  if (_agBuilder.step === 2) {
    agBuilderCollectContents();
  }
  _agBuilder.step = step;
  agRenderBuilder();
}

function agBuilderSetColor(color, el) {
  _agBuilder.data.thumbnail_color = color;
  document
    .querySelectorAll(".ag-color-swatch")
    .forEach((s) => s.classList.remove("sel"));
  el.classList.add("sel");
}

function agBuilderToggleSection(id) {
  const section = $(`ab-ct-${id}`);
  if (!section) return;
  const isOpen = section.classList.contains("open");
  const d = _agBuilder.data;
  if (!d.contents) d.contents = {};

  if (isOpen) {
    agBuilderSaveContentItems(id);
    delete d.contents[id];
    section.classList.remove("open");
    const editor = $(`ab-ce-${id}`);
    if (editor) editor.remove();
    const cb = section.querySelector("input[type=checkbox]");
    if (cb) cb.checked = false;
  } else {
    if (!d.contents[id] || !d.contents[id].length) {
      d.contents[id] = [agBuilderDefaultItem(id)];
    }
    section.classList.add("open");
    const cb = section.querySelector("input[type=checkbox]");
    if (cb) cb.checked = true;
    const editorEl = document.createElement("div");
    editorEl.className = "ag-content-editor";
    editorEl.id = `ab-ce-${id}`;
    editorEl.innerHTML = `
      <div class="ag-items-list" id="ab-items-${id}">
        ${(d.contents[id] || []).map((item, i) => agBuilderItemRowHTML(id, i, item)).join("")}
      </div>
      <button class="ag-add-item-btn" data-onclick="agBuilderAddItem" data-onclick-arg0="${id}">
        <i class="ti ti-plus"></i> Add item
      </button>`;
    section.appendChild(editorEl);
    agBuilderUpdateCount(id);
  }
}

function agBuilderDefaultItem(typeId) {
  if (typeId === "studyDeck") return { question: "", answer: "" };
  if (typeId === "aiPrompts" || typeId === "journalPrompts")
    return { text: "" };
  if (typeId === "spaces") return { name: "", type: "personal" };
  if (typeId === "habits") return { name: "", frequency: "daily" };
  if (typeId === "tasks")
    return { name: "", priority: "medium", status: "Not Started" };
  if (typeId === "goals") return { name: "", description: "" };
  return { name: "" };
}

function agBuilderItemRowHTML(typeId, idx, item) {
  const delBtn = `<button class="ag-item-del" data-onclick="agBuilderRemoveItem" data-onclick-args="${esc(JSON.stringify([typeId, idx]))}"><i class="ti ti-x"></i></button>`;
  if (typeId === "studyDeck") {
    return `<div class="ag-item-row" data-idx="${idx}">
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="ab-item-q" placeholder="Question…" value="${esc(item.question || "")}">
        <input class="ab-item-a" placeholder="Answer…" value="${esc(item.answer || "")}">
      </div>${delBtn}</div>`;
  }
  if (typeId === "aiPrompts" || typeId === "journalPrompts") {
    return `<div class="ag-item-row" data-idx="${idx}">
      <input class="ab-item-text" style="flex:1" placeholder="Prompt text…" value="${esc(item.text || "")}">
      ${delBtn}</div>`;
  }
  if (typeId === "spaces") {
    return `<div class="ag-item-row" data-idx="${idx}">
      <input class="ab-item-name" style="flex:1" placeholder="Space name…" value="${esc(item.name || "")}">
      <select class="ab-item-type">
        <option value="personal"${(item.type || "personal") === "personal" ? " selected" : ""}>Personal</option>
        <option value="academic"${item.type === "academic" ? " selected" : ""}>Academic</option>
      </select>${delBtn}</div>`;
  }
  if (typeId === "habits") {
    return `<div class="ag-item-row" data-idx="${idx}">
      <input class="ab-item-name" style="flex:1" placeholder="Habit name…" value="${esc(item.name || "")}">
      <select class="ab-item-freq">
        <option value="daily"${(item.frequency || "daily") === "daily" ? " selected" : ""}>Daily</option>
        <option value="weekdays"${item.frequency === "weekdays" ? " selected" : ""}>Weekdays</option>
        <option value="weekly"${item.frequency === "weekly" ? " selected" : ""}>Weekly</option>
      </select>${delBtn}</div>`;
  }
  if (typeId === "tasks") {
    return `<div class="ag-item-row" data-idx="${idx}">
      <input class="ab-item-name" style="flex:1" placeholder="Task name…" value="${esc(item.name || "")}">
      <select class="ab-item-priority">
        <option value="medium"${(item.priority || "medium") === "medium" ? " selected" : ""}>Medium</option>
        <option value="high"${item.priority === "high" ? " selected" : ""}>High</option>
        <option value="low"${item.priority === "low" ? " selected" : ""}>Low</option>
      </select>${delBtn}</div>`;
  }
  if (typeId === "goals") {
    return `<div class="ag-item-row" data-idx="${idx}">
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        <input class="ab-item-name" placeholder="Goal name…" value="${esc(item.name || "")}">
        <input class="ab-item-desc" placeholder="Description (optional)…" value="${esc(item.description || "")}">
      </div>${delBtn}</div>`;
  }
  return `<div class="ag-item-row" data-idx="${idx}">
    <input class="ab-item-name" style="flex:1" placeholder="Name…" value="${esc(item.name || "")}">
    ${delBtn}</div>`;
}

function agBuilderSaveContentItems(typeId) {
  const list = $(`ab-items-${typeId}`);
  if (!list) return;
  const rows = list.querySelectorAll(".ag-item-row");
  const d = _agBuilder.data;
  if (!d.contents[typeId]) d.contents[typeId] = [];
  const saved = [];
  rows.forEach((row) => {
    if (typeId === "studyDeck") {
      saved.push({
        question: (row.querySelector(".ab-item-q") || {}).value?.trim() || "",
        answer: (row.querySelector(".ab-item-a") || {}).value?.trim() || "",
      });
    } else if (typeId === "aiPrompts" || typeId === "journalPrompts") {
      saved.push({
        text: (row.querySelector(".ab-item-text") || {}).value?.trim() || "",
      });
    } else if (typeId === "spaces") {
      saved.push({
        name: (row.querySelector(".ab-item-name") || {}).value?.trim() || "",
        type: (row.querySelector(".ab-item-type") || {}).value || "personal",
      });
    } else if (typeId === "habits") {
      saved.push({
        name: (row.querySelector(".ab-item-name") || {}).value?.trim() || "",
        frequency: (row.querySelector(".ab-item-freq") || {}).value || "daily",
      });
    } else if (typeId === "tasks") {
      saved.push({
        name: (row.querySelector(".ab-item-name") || {}).value?.trim() || "",
        priority:
          (row.querySelector(".ab-item-priority") || {}).value || "medium",
        status: "Not Started",
      });
    } else if (typeId === "goals") {
      saved.push({
        name: (row.querySelector(".ab-item-name") || {}).value?.trim() || "",
        description:
          (row.querySelector(".ab-item-desc") || {}).value?.trim() || "",
      });
    } else {
      saved.push({
        name: (row.querySelector(".ab-item-name") || {}).value?.trim() || "",
      });
    }
  });
  d.contents[typeId] = saved;
}

function agBuilderAddItem(typeId) {
  agBuilderSaveContentItems(typeId);
  const d = _agBuilder.data;
  if (!d.contents[typeId]) d.contents[typeId] = [];
  const idx = d.contents[typeId].length;
  d.contents[typeId].push(agBuilderDefaultItem(typeId));
  const list = $(`ab-items-${typeId}`);
  if (list) {
    const el = document.createElement("div");
    el.innerHTML = agBuilderItemRowHTML(typeId, idx, d.contents[typeId][idx]);
    list.appendChild(el.firstElementChild);
  }
  agBuilderUpdateCount(typeId);
}

function agBuilderRemoveItem(typeId, idx) {
  agBuilderSaveContentItems(typeId);
  const d = _agBuilder.data;
  if (d.contents[typeId]) d.contents[typeId].splice(idx, 1);
  const list = $(`ab-items-${typeId}`);
  if (list) {
    list.innerHTML = (d.contents[typeId] || [])
      .map((item, i) => agBuilderItemRowHTML(typeId, i, item))
      .join("");
  }
  agBuilderUpdateCount(typeId);
}

function agBuilderUpdateCount(typeId) {
  const section = $(`ab-ct-${typeId}`);
  if (!section) return;
  const countEl = section.querySelector(".ag-content-count");
  const itemsList = $(`ab-items-${typeId}`);
  const count = itemsList
    ? itemsList.querySelectorAll(".ag-item-row").length
    : (_agBuilder.data.contents[typeId] || []).length;
  if (countEl)
    countEl.textContent =
      count > 0 ? `${count} item${count !== 1 ? "s" : ""}` : "";
}

function agBuilderCollectContents() {
  AG_CONTENTS.forEach((c) => {
    if ($(`ab-items-${c.id}`)) agBuilderSaveContentItems(c.id);
  });
  const d = _agBuilder.data;
  Object.keys(d.contents || {}).forEach((typeId) => {
    const items = d.contents[typeId];
    if (!items || !items.length) {
      delete d.contents[typeId];
      return;
    }
    if (typeId === "studyDeck") {
      d.contents[typeId] = items.filter(
        (i) => (i.question || "").trim() || (i.answer || "").trim(),
      );
    } else if (typeId === "aiPrompts" || typeId === "journalPrompts") {
      d.contents[typeId] = items.filter((i) => (i.text || "").trim());
    } else {
      d.contents[typeId] = items.filter((i) => (i.name || "").trim());
    }
    if (!d.contents[typeId].length) delete d.contents[typeId];
  });
}

function agBuilderSetPricing(isFree) {
  _agBuilder.data.free = isFree;
  const wrap = $("ab-price-wrap");
  if (wrap) wrap.style.display = isFree ? "none" : "";
  document
    .querySelectorAll(".ag-pricing-opt")
    .forEach((b, i) =>
      b.classList.toggle("active", i === 0 ? isFree : !isFree),
    );
}

function agBuilderUpdateEarnings() {
  const price = parseFloat(($("ab-price") || {}).value || 0);
  _agBuilder.data.price = price;
  const prev = $("ab-earn-preview");
  if (prev) prev.innerHTML = agBuilderEarningsHTML(price);
}

function agBuilderUpdateNgn() {
  const v = ($("ab-price-ngn") || {}).value;
  _agBuilder.data.price_ngn = v ? parseFloat(v) : null;
}

function agBuilderEarningsHTML(price) {
  const net = (price * 0.9).toFixed(2);
  const fee = (price * 0.1).toFixed(2);
  return `
    <div style="font-size:.78rem;line-height:1.9">
      At <strong>$${parseFloat(price || 0).toFixed(2)}</strong> per download:<br>
      You earn: <strong style="color:var(--green,#22c55e)">$${net}</strong> per sale<br>
      Sivarr fee: <strong>$${fee}</strong> per sale
    </div>`;
}

async function agSaveTemplate(status) {
  const d = _agBuilder.data;
  if ($("ab-price")) d.price = parseFloat(($("ab-price") || {}).value || 0);
  if ($("ab-price-ngn"))
    d.price_ngn = $("ab-price-ngn").value
      ? parseFloat($("ab-price-ngn").value)
      : null;
  const body = {
    token: getToken(),
    name: d.name,
    short_description: d.short_description,
    full_description: d.full_description,
    category: d.category,
    tags: d.tags,
    thumbnail_color: d.thumbnail_color,
    price: d.free ? 0 : d.price,
    price_ngn: d.free ? null : d.price_ngn,
    contents: d.contents,
    included_items: d.included_items,
  };
  try {
    let r;
    if (_agBuilder.id) {
      body.status = status;
      r = await fetch(`/api/agents/me/templates/${_agBuilder.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      r = await fetch("/api/agents/me/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    const result = await r.json();
    if (result.ok || result.template_id) {
      const tid = result.template_id || _agBuilder.id;
      if (status === "published" && tid) {
        await fetch(`/api/agents/me/templates/${tid}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: getToken() }),
        });
      }
      showToast(
        status === "published" ? "Template published!" : "Draft saved.",
      );
      agNav("dashboard");
      agRenderDashboard();
    } else {
      showToast(result.detail || "Save failed.");
    }
  } catch {
    showToast("Save failed. Try again.");
  }
}

// ── Review form ───────────────────────────────────────────────
async function agLeaveReview(templateId) {
  const d = await siModal.form(
    "Leave a Review",
    [
      {
        id: "rating",
        label: "Rating",
        type: "select",
        options: [
          { value: "5", label: "⭐⭐⭐⭐⭐ Excellent" },
          { value: "4", label: "⭐⭐⭐⭐ Good" },
          { value: "3", label: "⭐⭐⭐ Average" },
          { value: "2", label: "⭐⭐ Poor" },
          { value: "1", label: "⭐ Terrible" },
        ],
        default: "5",
      },
      {
        id: "text",
        label: "Review (optional)",
        type: "textarea",
        placeholder: "What did you think?",
      },
    ],
    { confirmLabel: "Submit Review" },
  );
  if (!d) return;
  const rating = parseInt(d.rating || "5");
  fetch(`/api/agents/templates/${templateId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: getToken(), rating, review_text: d.text || "" }),
  })
    .then((r) => r.json())
    .then((r) => {
      if (r.ok) {
        showToast("Review submitted!");
        agOpenTemplate(templateId);
      } else showToast(r.detail || "Review failed.");
    });
}

// ── Check payment success on page load ────────────────────────
function agCheckPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get("payment");
  const templateId = params.get("template");
  const gateway = params.get("gateway");
  const ref = params.get("ref");

  if (gateway === "paystack" && ref) {
    history.replaceState({}, "", window.location.pathname);
    nav("agents");
    agHandlePaystackReturn(ref, templateId);
    return;
  }
  if (payment === "success" && templateId) {
    showToast("Payment successful! Template installed.");
    history.replaceState({}, "", window.location.pathname);
    nav("agents");
    agOpenTemplate(templateId);
  } else if (payment === "cancelled") {
    showToast("Payment cancelled.");
    history.replaceState({}, "", window.location.pathname);
  }
}

async function agHandlePaystackReturn(reference, templateId) {
  showToast("Verifying payment…");
  try {
    const r = await fetch(`/api/payments/paystack/verify/${reference}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken() }),
    });
    const d = await r.json();
    if (d.ok) {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess("Payment successful! Template installed.");
      if (templateId) agOpenTemplate(templateId);
    } else {
      showToast(d.detail || "Verification failed. Contact support.");
    }
  } catch {
    showToast("Verification failed.");
  }
}
