// ═══════════════════════════ STATE ═══════════════════════════
const S = {
  sid: null, name: '', email: '', diff: 'medium',
  topics: [], weak: [], quizActive: false,
  quizQ: 0, quizScore: 0, curQ: null, wrongAnswers: [],
  stats: { questions: 0, quizzes: 0, sessions: 1, wrong: 0 },
};

const API = async (url, body) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = r.statusText;
    try { const j = await r.json(); detail = j.detail || detail; } catch { try { detail = await r.text() || detail; } catch {} }
    const err = new Error(detail);
    err.status = r.status;
    throw err;
  }
  return r.json();
};

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escHtml = esc;
const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL DIALOG MODAL  (siModal)
// Async promise-based replacement for all browser prompt/confirm/alert calls.
// Usage:
//   const name = await siModal.input('Add Habit', 'Habit name…');
//   if (!await siModal.confirm('Delete?', {danger:true})) return;
//   await siModal.alert('Something went wrong.');
//   const data = await siModal.form('New Event', [{id:'title',label:'Title',…}]);
// ═══════════════════════════════════════════════════════════════
const siModal = (() => {
  let _res = null;

  function _show(html) {
    return new Promise(resolve => {
      _res = resolve;
      const overlay = $('si-modal-overlay');
      const box     = $('si-modal-box');
      if (!overlay || !box) { resolve(null); return; }
      box.innerHTML = html;
      overlay.classList.add('open');
      const first = box.querySelector('input,textarea,select');
      if (first) setTimeout(() => first.focus(), 60);
    });
  }

  function _done(val) {
    const o = $('si-modal-overlay');
    if (o) o.classList.remove('open');
    if (_res) { _res(val); _res = null; }
  }

  function _bgClose(e) {
    if (e.target === $('si-modal-overlay')) _done(null);
  }

  document.addEventListener('keydown', e => {
    const o = $('si-modal-overlay');
    if (!o || !o.classList.contains('open')) return;
    if (e.key === 'Escape') { _done(null); return; }
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
      const btn = o.querySelector('.si-modal-btn-primary');
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  // ── input ──────────────────────────────────────────────────
  function input(title, placeholder = '', defaultVal = '', opts = {}) {
    const { description = '', confirmLabel = 'Confirm', type = 'text' } = opts;
    return _show(`
      <div class="si-modal-hd">
        <span class="si-modal-title">${title}</span>
        <button class="si-modal-x" onclick="siModal._done(null)"><i class="ti ti-x"></i></button>
      </div>
      ${description ? `<div class="si-modal-desc">${description}</div>` : ''}
      <div class="si-modal-body">
        <input id="si-m-inp" class="si-modal-input" type="${type}"
          placeholder="${placeholder}" value="${esc(defaultVal)}" autocomplete="off">
      </div>
      <div class="si-modal-ft">
        <button class="si-modal-btn si-modal-btn-cancel" onclick="siModal._done(null)">Cancel</button>
        <button class="si-modal-btn si-modal-btn-primary" onclick="siModal._subInput()">${confirmLabel}</button>
      </div>`);
  }
  function _subInput() {
    const v = ($('si-m-inp') || {}).value?.trim() || '';
    _done(v || null);
  }

  // ── confirm ────────────────────────────────────────────────
  function confirm(message, opts = {}) {
    const { title = 'Confirm', confirmLabel = 'Confirm', danger = false } = opts;
    return _show(`
      <div class="si-modal-hd">
        <span class="si-modal-title">${title}</span>
        <button class="si-modal-x" onclick="siModal._done(false)"><i class="ti ti-x"></i></button>
      </div>
      <div class="si-modal-confirm-body">
        <p class="si-modal-confirm-msg">${message}</p>
      </div>
      <div class="si-modal-ft">
        <button class="si-modal-btn si-modal-btn-cancel" onclick="siModal._done(false)">Cancel</button>
        <button class="si-modal-btn si-modal-btn-primary${danger ? ' danger' : ''}"
          onclick="siModal._done(true)">${confirmLabel}</button>
      </div>`);
  }

  // ── alert ──────────────────────────────────────────────────
  function alert(message, opts = {}) {
    const { title = 'Notice' } = opts;
    return _show(`
      <div class="si-modal-hd">
        <span class="si-modal-title">${title}</span>
      </div>
      <div class="si-modal-confirm-body">
        <p class="si-modal-confirm-msg">${message}</p>
      </div>
      <div class="si-modal-ft">
        <button class="si-modal-btn si-modal-btn-primary" onclick="siModal._done(true)">OK</button>
      </div>`);
  }

  // ── form ───────────────────────────────────────────────────
  // fields: [{id, label, type ('text'|'textarea'|'select'|'emoji'|'date'|'number'),
  //           placeholder, default, options (for select/emoji), required}]
  function form(title, fields, opts = {}) {
    const { confirmLabel = 'Save', description = '' } = opts;
    const fHTML = fields.map(f => {
      if (f.type === 'emoji') return `
        <div class="si-modal-field">
          <label class="si-modal-label">${f.label}</label>
          <div class="si-modal-emoji-grid" id="smg-${f.id}">
            ${(f.options || []).map(e => `
              <button type="button" class="si-modal-emoji-btn${(f.default||'')=== e?' sel':''}"
                onclick="siModal._pickEmoji('smg-${f.id}','si-mf-${f.id}',this)">${e}</button>`).join('')}
          </div>
          <input type="hidden" id="si-mf-${f.id}" value="${esc(f.default||'')}">
        </div>`;
      if (f.type === 'select') return `
        <div class="si-modal-field">
          <label class="si-modal-label">${f.label}</label>
          <select id="si-mf-${f.id}" class="si-modal-input">
            ${(f.options || []).map(o =>
              `<option value="${o.value}"${o.value===(f.default||'')?' selected':''}>${o.label}</option>`
            ).join('')}
          </select>
        </div>`;
      if (f.type === 'textarea') return `
        <div class="si-modal-field">
          <label class="si-modal-label">${f.label}</label>
          <textarea id="si-mf-${f.id}" class="si-modal-input si-modal-textarea"
            placeholder="${f.placeholder||''}" rows="3">${esc(f.default||'')}</textarea>
        </div>`;
      return `
        <div class="si-modal-field">
          <label class="si-modal-label">${f.label}${f.required?'<span style="color:var(--red3)"> *</span>':''}</label>
          <input id="si-mf-${f.id}" class="si-modal-input" type="${f.type||'text'}"
            placeholder="${f.placeholder||''}" value="${esc(f.default||'')}">
        </div>`;
    }).join('');
    const ids = JSON.stringify(fields.map(f => f.id));
    return _show(`
      <div class="si-modal-hd">
        <span class="si-modal-title">${title}</span>
        <button class="si-modal-x" onclick="siModal._done(null)"><i class="ti ti-x"></i></button>
      </div>
      ${description ? `<div class="si-modal-desc">${description}</div>` : ''}
      <div class="si-modal-form-body">${fHTML}</div>
      <div class="si-modal-ft">
        <button class="si-modal-btn si-modal-btn-cancel" onclick="siModal._done(null)">Cancel</button>
        <button class="si-modal-btn si-modal-btn-primary"
          onclick="siModal._subForm(${ids.replace(/"/g,"'")})">
          ${confirmLabel}
        </button>
      </div>`);
  }
  function _subForm(ids) {
    const result = {};
    for (const id of ids) {
      const el = $(`si-mf-${id}`);
      result[id] = el ? el.value.trim() : '';
    }
    _done(result);
  }
  function _pickEmoji(gridId, hidId, btn) {
    const grid = $(gridId);
    if (grid) grid.querySelectorAll('.si-modal-emoji-btn').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
    const hid = $(hidId);
    if (hid) hid.value = btn.textContent;
  }

  return { input, confirm, alert, form, _done, _bgClose, _subInput, _subForm, _pickEmoji };
})();

// ═══════════════════════════ PROFILE PICTURE ════════════════════

const PFP_KEY = () => `sivarr_pfp_${S.sid || 'guest'}`;

function uploadProfilePic(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Image too large — max 2MB.'); input.value = ''; return; }

  const reader = new FileReader();
  reader.onload = e => {
    // Resize to 200x200 via canvas before saving
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      // Crop to square from center
      const size = Math.min(img.width, img.height);
      const sx   = (img.width  - size) / 2;
      const sy   = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      localStorage.setItem(PFP_KEY(), dataUrl);
      applyProfilePic(dataUrl);
      toast('Profile photo updated ✓');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function applyProfilePic(dataUrl) {
  // All avatar elements to update
  const avatarIds = ['tb-av', 'tb-av-big', 'snav-av'];
  avatarIds.forEach(id => {
    const el = $(id);
    if (!el) return;
    if (dataUrl) {
      el.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      el.style.background = 'none';
      el.style.padding    = '0';
    } else {
      el.innerHTML = S.name?.[0]?.toUpperCase() || '?';
      el.style.background = 'linear-gradient(135deg,var(--accent),var(--accent2))';
    }
  });
}

function loadProfilePic() {
  const saved = localStorage.getItem(PFP_KEY());
  if (saved) applyProfilePic(saved);
}


let CURRENT_ROLE = 'student';
let AUTH_TAB     = 'login';

function setRole(role) {
  CURRENT_ROLE = role;
  const isLec = role === 'lecturer';

  $('role-student').style.cssText  = `padding:10px;border-radius:10px;font-family:var(--font);font-weight:700;font-size:.88rem;cursor:pointer;transition:all .2s;border:${!isLec?'2px solid var(--accent)':'1px solid var(--border)'};background:${!isLec?'#4f6ef715':'none'};color:${!isLec?'var(--accent)':'var(--muted)'}`;
  $('role-lecturer').style.cssText = `padding:10px;border-radius:10px;font-family:var(--font);font-weight:700;font-size:.88rem;cursor:pointer;transition:all .2s;border:${isLec?'2px solid var(--accent)':'1px solid var(--border)'};background:${isLec?'#4f6ef715':'none'};color:${isLec?'var(--accent)':'var(--muted)'}`;
  $('student-fields').style.display  = isLec ? 'none'  : 'block';
  $('lecturer-fields').style.display = isLec ? 'block' : 'none';
  $('auth-tabs').style.display       = isLec ? 'none'  : 'grid';
  $('login-heading').textContent     = isLec ? 'Lecturer Login' : (AUTH_TAB === 'register' ? 'Create Account' : 'Welcome back');
  $('login-btn').textContent         = isLec ? 'Access Dashboard' : (AUTH_TAB === 'register' ? 'Create Account' : 'Sign In');
  $('login-err').textContent         = '';
}

function setAuthTab(tab) {
  AUTH_TAB    = tab;
  const isReg = tab === 'register';
  const loginTab = $('auth-tab-login');
  const regTab   = $('auth-tab-register');
  if (loginTab) loginTab.classList.toggle('active', !isReg);
  if (regTab)   regTab.classList.toggle('active',  isReg);

  // Show name + register-only fields only when registering
  const nf = $('name-field');       if (nf) nf.style.display       = isReg ? 'block' : 'none';
  const rf = $('register-fields');  if (rf) rf.style.display        = isReg ? 'block' : 'none';
  const fl = $('forgot-pw-link');   if (fl) fl.style.display        = isReg ? 'none'  : 'block';

  // Update password placeholder
  const pw = $('l-pw'); if (pw) pw.placeholder = isReg ? 'Min. 8 characters' : 'Your password';

  const h = $('login-heading'); if (h) h.textContent = isReg ? 'Create account' : 'Welcome back';
  const s = $('login-sub');     if (s) s.textContent = isReg ? 'Join the SIVARR workspace.' : 'Sign in to your workspace.';
  const b = $('login-btn');     if (b) b.textContent = isReg ? 'Create account' : 'Sign in';
  const e = $('login-err');     if (e) e.textContent = '';

  // Focus the first visible field
  if (isReg) { setTimeout(() => $('ln')?.focus(), 50); }
  else        { setTimeout(() => $('lm')?.focus(), 50); }
}

function togglePwVis(inputId, btnId) {
  const inp  = $(inputId);
  const btn  = $(btnId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  const icon = btn?.querySelector('i');
  if (icon) icon.className = inp.type === 'password' ? 'ti ti-eye' : 'ti ti-eye-off';
}

async function doLogin(prefillEmail) {
  const err = $('login-err');
  const btn = $('login-btn');
  if (err) err.textContent = '';

  // ── Lecturer path ─────────────────────────────────────────
  if (CURRENT_ROLE === 'lecturer') {
    const name = $('lec-name-login')?.value.trim();
    const pw   = $('lec-pw-login')?.value.trim();
    if (!name || !pw) { if (err) err.textContent = 'Enter your name and password.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    try {
      const r = await fetch('/api/lecturer/login', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, password: pw })
      });
      if (!r.ok) throw new Error('Invalid password');
      const d = await r.json();
      localStorage.setItem('sivarr_lec_token', d.token);
      localStorage.setItem('sivarr_lec_name',  name);
      window.location.href = '/lecturer';
    } catch(e) {
      if (err) err.textContent = 'Incorrect password. Try again.';
      if (btn) { btn.disabled = false; btn.textContent = 'Access Dashboard'; }
    }
    return;
  }

  // ── Student path ──────────────────────────────────────────
  const isReg = AUTH_TAB === 'register';
  const email = (prefillEmail || $('lm')?.value || '').trim();
  const pw    = $('l-pw')?.value || '';

  // Client-side validation
  if (!email) { if (err) err.textContent = 'Email address is required.'; $('lm')?.focus(); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (err) err.textContent = 'Enter a valid email address.'; $('lm')?.focus(); return; }
  if (!pw)    { if (err) err.textContent = 'Password is required.'; $('l-pw')?.focus(); return; }

  let body = { email, password: pw, action: AUTH_TAB };

  if (isReg) {
    const name  = ($('ln')?.value || '').trim();
    const cpw   = $('l-cpw')?.value || '';
    const phone = ($('l-phone')?.value || '').trim();

    if (!name || name.length < 2) { if (err) err.textContent = 'Full name is required (min 2 characters).'; $('ln')?.focus(); return; }
    if (pw.length < 8)            { if (err) err.textContent = 'Password must be at least 8 characters.'; $('l-pw')?.focus(); return; }
    if (cpw && cpw !== pw)        { if (err) err.textContent = 'Passwords do not match.'; $('l-cpw')?.focus(); return; }
    if (!cpw)                     { if (err) err.textContent = 'Please confirm your password.'; $('l-cpw')?.focus(); return; }

    body = { ...body, name, confirm_password: cpw, phone };
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }

  try {
    const r = await API('/api/login', body);
    saveSession(r.name, r.email, r.token);
    _applyLoginData(r);

    try {
      const ann = await fetch('/api/lecturer/announcements');
      const ad  = await ann.json();
      if (ad.announcements?.length) {
        const latest = ad.announcements[0];
        addMsg('sivarr', `📢 Announcement from your lecturer:\n\n"${latest.message}"\n\n— ${latest.author}, ${latest.date}`);
      }
    } catch(_) {}

  } catch(e) {
    const status = e.status || 0;
    const detail = e.message || '';
    const text = status === 409 ? detail :
                 status === 401 ? detail :
                 status === 400 ? detail :
                 status === 422 ? 'Check your details and try again.' :
                 status === 429 ? 'Too many attempts — please wait a moment.' :
                 detail || 'Something went wrong — check your connection and try again.';
    if (err) err.textContent = text;
    if (btn) { btn.disabled = false; btn.textContent = isReg ? 'Create account' : 'Sign in'; }
    clearSession();
    return;
  }
  if (btn) { btn.disabled = false; btn.textContent = isReg ? 'Create account' : 'Sign in'; }
}

// ═══════════════════════════ ANNOUNCEMENTS ══════════════════════
async function loadAnnouncements() {
  try {
    const r = await fetch('/api/announcements/active');
    const d = await r.json();
    const anns = d.announcements || [];
    if (!anns.length) return;

    // Don't show announcements the student has already dismissed
    const dismissed = JSON.parse(localStorage.getItem('sivarr_dismissed_anns') || '[]');
    const unseen = anns.filter(a => !dismissed.includes(a.date + a.text.slice(0,20)));
    if (!unseen.length) return;

    const TYPE_COLORS = {
      info:     { bg: '#4f6ef715', border: '#4f6ef740', color: '#4f6ef7',  icon: '📘' },
      warning:  { bg: '#f59e0b15', border: '#f59e0b40', color: '#f59e0b',  icon: '⚠️' },
      deadline: { bg: '#ef444415', border: '#ef444440', color: '#ef4444',  icon: '⏰' },
      exam:     { bg: '#7c3aed15', border: '#7c3aed40', color: '#7c3aed',  icon: '📝' },
    };

    // Remove existing popup if any
    const existing = document.getElementById('ann-popup');
    if (existing) existing.remove();

    const latest = unseen[unseen.length - 1];
    const style  = TYPE_COLORS[latest.type] || TYPE_COLORS.info;
    const key    = latest.date + latest.text.slice(0,20);

    // Create popup
    const popup = document.createElement('div');
    popup.id = 'ann-popup';
    popup.innerHTML = `
      <div id="ann-popup-inner">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <span style="font-size:1.3rem;flex-shrink:0">${style.icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.72rem;font-weight:700;color:${style.color};text-transform:uppercase;
              letter-spacing:.05em;margin-bottom:3px">
              From your lecturer
              ${unseen.length > 1 ? `<span style="background:${style.color};color:#fff;border-radius:20px;
                padding:1px 7px;font-size:.65rem;margin-left:6px">${unseen.length} new</span>` : ''}
            </div>
            <div style="font-size:.88rem;line-height:1.5;color:var(--text)">${esc(latest.text)}</div>
            <div style="font-size:.72rem;color:var(--muted);margin-top:4px">${latest.date}</div>
          </div>
          <button onclick="dismissAnnouncement('${key}')"
            style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;
              flex-shrink:0;padding:2px 4px;line-height:1;transition:color .15s"
            onmouseover="this.style.color='var(--text)'"
            onmouseout="this.style.color='var(--muted)'">✕</button>
        </div>
        ${unseen.length > 1 ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid ${style.border}">
          <button onclick="showAllAnnouncements()" style="background:none;border:none;
            color:${style.color};font-size:.78rem;font-weight:600;cursor:pointer;font-family:var(--font)">
            View all ${unseen.length} announcements →
          </button>
        </div>` : ''}
      </div>`;

    // Styles for the popup
    popup.style.cssText = `
      position: fixed;
      top: 0;
      left: 50%;
      transform: translateX(-50%) translateY(-100%);
      width: min(460px, calc(100vw - 2rem));
      background: var(--card);
      border: 1px solid ${style.border};
      border-top: none;
      border-radius: 0 0 16px 16px;
      padding: 1rem 1.1rem;
      z-index: 300;
      box-shadow: 0 8px 32px rgba(0,0,0,.4);
      transition: transform .4s cubic-bezier(0.34, 1.56, 0.64, 1);
    `;

    document.body.appendChild(popup);

    // Animate drop down
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        popup.style.transform = 'translateX(-50%) translateY(0)';
      });
    });

    // Auto dismiss after 8 seconds
    setTimeout(() => dismissAnnouncement(key), 8000);

  } catch {}
}

function dismissAnnouncement(key) {
  const popup = document.getElementById('ann-popup');
  if (!popup) return;
  popup.style.transform = 'translateX(-50%) translateY(-110%)';
  setTimeout(() => popup.remove(), 400);
  // Remember dismissed
  const dismissed = JSON.parse(localStorage.getItem('sivarr_dismissed_anns') || '[]');
  if (!dismissed.includes(key)) dismissed.push(key);
  // Keep only last 50
  localStorage.setItem('sivarr_dismissed_anns', JSON.stringify(dismissed.slice(-50)));
}

function showAllAnnouncements() {
  dismissAnnouncement('');
  fetch('/api/announcements/active')
    .then(r => r.json())
    .then(d => {
      const anns = d.announcements || [];
      const TYPE_ICONS = {info:'📘', warning:'⚠️', deadline:'⏰', exam:'📝'};
      addMsg('sivarr', '📢 Announcements from your lecturer:\n\n' +
        anns.map((a,i) => `${TYPE_ICONS[a.type]||'📘'} ${a.text}\n— ${a.date}`).join('\n\n'));
    }).catch(() => {});
}

// ═══════════════════════════ SESSION PERSISTENCE ══════════════
// Save login to localStorage so user stays logged in on return

function saveSession(name, email, token) {
  localStorage.setItem('sivarr_name',  name);
  localStorage.setItem('sivarr_email', email);
  localStorage.setItem('sivarr_ts',    Date.now());
  if (token) localStorage.setItem('sivarr_token', token);
}

function clearSession() {
  localStorage.removeItem('sivarr_name');
  localStorage.removeItem('sivarr_email');
  localStorage.removeItem('sivarr_matric'); // clear legacy key
  localStorage.removeItem('sivarr_ts');
  const token = localStorage.getItem('sivarr_token');
  localStorage.removeItem('sivarr_token');
  // Tell backend to invalidate the token
  if (token) {
    fetch('/api/logout', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token }) }).catch(() => {});
  }
}

function getSavedSession() {
  const name  = localStorage.getItem('sivarr_name');
  const email = localStorage.getItem('sivarr_email');
  const ts    = localStorage.getItem('sivarr_ts');
  const token = localStorage.getItem('sivarr_token');
  if (!name || !email || !ts) return null;
  if (Date.now() - parseInt(ts) > 30 * 24 * 60 * 60 * 1000) {
    clearSession(); return null;
  }
  return { name, email, token };
}

// ═══════════════════════════ LOGIN ════════════════════════════
function logout() {
  if (window.Sentry) Sentry.setUser(null);
  clearSession();
  document.body.classList.remove('dashboard-active');
  location.reload();
}

function _applyLoginData(r) {
  S.sid   = r.sid;  S.name  = r.name;  S.email = r.email;
  S.diff  = r.difficulty; S.topics = r.topics; S.weak = r.weak;
  S.stats = { questions: r.questions, quizzes: r.quizzes, sessions: r.sessions, wrong: r.wrong_count };
  S.uploadedFiles = r.uploaded_files || [];
  S.plan  = r.plan || 'free';

  const tbAv = $('tb-av'); if (tbAv) tbAv.textContent = r.name[0].toUpperCase();
  const tbNm = $('tb-name'); if (tbNm) tbNm.textContent = r.name;
  const snavAv   = $('snav-av');     if (snavAv)   snavAv.textContent   = r.name[0].toUpperCase();
  const snavName = $('snav-name');   if (snavName) snavName.textContent = r.name;
  const pdName   = $('pd-name');     if (pdName)   pdName.textContent   = r.name;
  const pdMatric = $('pd-matric');   if (pdMatric) pdMatric.textContent = r.email;
  const tbAvBig  = $('tb-av-big');   if (tbAvBig)  tbAvBig.textContent  = r.name[0].toUpperCase();
  const mobAv    = $('mob-snav-av'); if (mobAv)    mobAv.textContent    = r.name[0].toUpperCase();
  const mobName  = $('mob-snav-name'); if (mobName) mobName.textContent = r.name;
  loadProfilePic();
  snavToggle('ai', $('snav-sec-ai'));
  updateDiff(r.difficulty);
  updateSBStats();
  renderTopics(r.topics, r.weak);
  renderFileList();
  loadWrong();

  $('login-screen').style.display = 'none';
  $('dashboard').style.display    = 'block';
  nav('home', null);
  document.body.classList.add('dashboard-active');

  const greet = $('welcome-greeting');
  if (greet) {
    const hr  = new Date().getHours();
    const tod = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    greet.textContent = `${tod}, ${r.name.split(' ')[0]}`;
  }
  // Show/hide email verification banner
  const vb = $('verify-banner');
  if (vb) vb.style.display = r.email_verified === false ? 'flex' : 'none';

  // Tag Sentry errors with the logged-in user (no PII beyond id/email)
  if (window.Sentry) {
    Sentry.setUser({ id: r.sid, email: r.email });
  }

  chatCounterInit();
  _contextSent = false; // fresh context for each login session
  loadAnnouncements();
  setTimeout(() => briefCheck(), 800);

  // Seed localStorage from server spaces (server wins on login/restore)
  if (r.spaces && r.spaces.length) {
    seedSpacesFromServer(r.spaces);
  }
  setTimeout(() => spaceRenderSidebar(), 100);
  // Handle Stripe payment return
  setTimeout(() => agCheckPaymentReturn(), 500);
  // Show onboarding for new users
  if (!r.returning) setTimeout(() => siObMaybeStart(), 600);
}

async function restoreSession(token) {
  try {
    const r = await API('/api/session/restore', { token });
    saveSession(r.name, r.email, r.token || token);
    _applyLoginData(r);
    return true;
  } catch(e) {
    localStorage.removeItem('sivarr_token');
    return false;
  }
}

// ── Auth sub-flow helpers ──────────────────────────────────────────

let _resetToken = null; // token from ?reset= URL param

function showLoginView() {
  const panels = ['forgot-pw-form','forgot-sent-view','reset-pw-form'];
  panels.forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  const mainEls = ['student-fields','login-err','login-btn','login-note','auth-tabs','forgot-pw-link'];
  mainEls.forEach(id => { const el = $(id); if (el) el.style.display = ''; });
  // Restore correct heading/sub
  const h = $('login-heading'); if (h) h.textContent = 'Welcome back';
  const s = $('login-sub');     if (s) s.textContent = 'Sign in to your workspace.';
}

function showForgotPassword() {
  const mainEls = ['student-fields','login-err','login-btn','login-note','auth-tabs','forgot-pw-link'];
  mainEls.forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  const fp = $('forgot-pw-form'); if (fp) fp.style.display = 'block';
  const h  = $('login-heading');  if (h)  h.style.display  = 'none';
  const sub= $('login-sub');      if (sub) sub.style.display = 'none';
  setTimeout(() => $('fp-email')?.focus(), 50);
}

async function submitForgotPassword() {
  const email = ($('fp-email')?.value || '').trim();
  const err   = $('forgot-err');
  const btn   = $('fp-btn');
  if (err) err.textContent = '';
  if (!email) { if (err) err.textContent = 'Please enter your email.'; return; }
  if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
  try {
    await API('/api/auth/forgot-password', { email });
  } catch(e) { /* always proceed to sent view */ }
  if (btn) { btn.textContent = 'Send reset link'; btn.disabled = false; }
  const fp  = $('forgot-pw-form');   if (fp)  fp.style.display  = 'none';
  const sv  = $('forgot-sent-view'); if (sv)  sv.style.display  = 'block';
}

function showResetPasswordForm(token) {
  _resetToken = token;
  const mainEls = ['student-fields','login-err','login-btn','login-note','auth-tabs','forgot-pw-link'];
  mainEls.forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  const h   = $('login-heading');  if (h)   h.style.display   = 'none';
  const sub = $('login-sub');      if (sub) sub.style.display = 'none';
  const rp  = $('reset-pw-form'); if (rp)  rp.style.display  = 'block';
  setTimeout(() => $('rp-pw')?.focus(), 50);
}

async function submitResetPassword() {
  const pw   = $('rp-pw')?.value  || '';
  const cpw  = $('rp-cpw')?.value || '';
  const err  = $('reset-err');
  const btn  = $('rp-btn');
  if (err) err.textContent = '';
  if (!pw)          { if (err) err.textContent = 'Enter a new password.'; return; }
  if (pw.length < 6){ if (err) err.textContent = 'Password must be at least 6 characters.'; return; }
  if (pw !== cpw)   { if (err) err.textContent = 'Passwords do not match.'; return; }
  if (btn) { btn.textContent = 'Updating...'; btn.disabled = true; }
  try {
    await API('/api/auth/reset-password', { token: _resetToken, password: pw });
    // Clear URL params then show success
    history.replaceState(null, '', '/');
    showLoginView();
    const h   = $('login-heading'); if (h)  { h.style.display = ''; h.textContent = 'Welcome back'; }
    const sub = $('login-sub');     if (sub){ sub.style.display = ''; }
    toast('Password updated! Please sign in with your new password.');
  } catch(e) {
    if (err) err.textContent = e.message || 'Reset link is invalid or expired.';
  } finally {
    if (btn) { btn.textContent = 'Update password'; btn.disabled = false; }
  }
}

function checkAuthParams() {
  const params = new URLSearchParams(window.location.search);
  const reset    = params.get('reset');
  const verify   = params.get('verify');
  const verified = params.get('verified');

  if (reset) {
    history.replaceState(null, '', '/');
    showResetPasswordForm(reset);
    return;
  }
  if (verify) {
    // Browser will hit the GET endpoint which redirects back with ?verified=1
    history.replaceState(null, '', '/');
    return;
  }
  if (verified === '1') {
    history.replaceState(null, '', '/');
    toast('Email verified! You can now sign in.');
  } else if (verified === 'error') {
    history.replaceState(null, '', '/');
    toast('Verification link is invalid or expired. Please request a new one.');
  }
}

async function resendVerificationEmail() {
  const token = getSavedSession()?.token;
  if (!token) return;
  try {
    await API('/api/auth/resend-verification', { token });
    toast('Verification email resent. Check your inbox.');
  } catch(e) {
    toast('Could not resend — please try again shortly.');
  }
}

// Auto-restore on page load — try token first, fall back to re-login
window.addEventListener('DOMContentLoaded', async () => {
  localStorage.removeItem('sivarr_lecturer_token');
  localStorage.removeItem('sivarr_lecturer_name');

  // Handle ?reset= / ?verify= / ?verified= URL params before anything else
  checkAuthParams();

  const saved = getSavedSession();
  if (!saved) return;

  const btn = $('login-btn');
  if (btn) { btn.textContent = 'Resuming session...'; btn.disabled = true; }

  // Token restore — no password required
  if (saved.token) {
    const ok = await restoreSession(saved.token);
    if (ok) return;
    // Session was stored but is now expired/invalid — tell the user
    toast('Your session expired — please sign in again.');
  }

  // Fallback: pre-fill email and show login form for expired/invalid tokens
  if (saved.email && $('lm')) $('lm').value = saved.email;
  if (btn) { btn.textContent = 'Sign in'; btn.disabled = false; }
});

['ln','lm'].forEach((id,i) => {
  const el = $(id);
  if (el) el.addEventListener('keydown', e => {
    if (e.key === 'Enter') i === 0 ? $('lm').focus() : doLogin();
  });
});

// ═══════════════════════════ ATTACHMENTS ════════════════════════

let ATTACHMENTS = []; // { name, type, content (base64 or text) }

function toggleAttachMenu() {
  const menu = $('attach-menu');
  const btn  = $('attach-btn');
  if (!menu) return;
  const open = menu.style.display === 'block';
  menu.style.display = open ? 'none' : 'block';
  btn.style.borderColor = open ? 'var(--border)' : 'var(--accent)';
  btn.style.color       = open ? 'var(--muted)'  : 'var(--accent)';
}

function triggerAttach(type) {
  $('attach-menu').style.display = 'none';
  $('attach-btn').style.borderColor = 'var(--border)';
  $('attach-btn').style.color       = 'var(--muted)';
  const inputMap = { image:'attach-image-input', pdf:'attach-pdf-input', file:'attach-file-input', doc:'attach-doc-input' };
  $(inputMap[type])?.click();
}

function handleAttach(input, type) {
  const file = input.files[0];
  if (!file) return;

  const MAX = 5 * 1024 * 1024;
  if (file.size > MAX) { toast('File too large — max 5MB.'); input.value = ''; return; }

  const reader = new FileReader();

  if (type === 'image') {
    reader.onload = e => {
      ATTACHMENTS.push({ name: file.name, type: 'image', content: e.target.result });
      renderAttachPreview();
      toast(`Image attached: ${file.name}`);
    };
    reader.readAsDataURL(file);
  } else {
    reader.onload = e => {
      ATTACHMENTS.push({ name: file.name, type, content: e.target.result });
      renderAttachPreview();
      toast(`Attached: ${file.name}`);
    };
    reader.readAsText(file);
  }
  input.value = '';
}

function renderAttachPreview() {
  const strip = $('attach-preview');
  if (!strip) return;
  if (!ATTACHMENTS.length) { strip.style.display = 'none'; return; }
  strip.style.display = 'flex';
  strip.innerHTML = ATTACHMENTS.map((a, i) => `
    <div class="attach-chip">
      <span>${a.type === 'image' ? '🖼️' : a.type === 'pdf' ? '📄' : '📎'}</span>
      ${esc(a.name)}
      <button onclick="removeAttach(${i})">✕</button>
    </div>`).join('');
}

function removeAttach(idx) {
  ATTACHMENTS.splice(idx, 1);
  renderAttachPreview();
}

// Close attach menu when clicking outside
document.addEventListener('click', e => {
  const menu = $('attach-menu');
  const btn  = $('attach-btn');
  if (menu && btn && !menu.contains(e.target) && e.target !== btn) {
    menu.style.display = 'none';
    btn.style.borderColor = 'var(--border)';
    btn.style.color       = 'var(--muted)';
  }
});


/* ══════════════════════════════════════════════════════════════
   SIVARR CONTEXT ENGINE
   Reads all local data stores and builds a rich snapshot that
   gets injected into the first message of each chat session,
   giving SIVARR genuine awareness of the user's world.
   ══════════════════════════════════════════════════════════════ */

let _contextSent = false; // reset to false on each login

function buildSivarrContext() {
  if (!S.sid) return '';
  const sid = S.sid;
  const today = new Date().toDateString();
  const lines = [`SIVARR CONTEXT SNAPSHOT for ${S.name} — ${today}`];

  // ── Tasks ─────────────────────────────────────────────────
  try {
    const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${sid}`) || '[]');
    const open  = tasks.filter(t => !t.done);
    const done  = tasks.filter(t => t.done);
    if (open.length) {
      lines.push(`Open tasks (${open.length}): ${open.slice(0,6).map(t => t.title || t.text || '').filter(Boolean).join(' | ')}`);
    }
    if (done.length) lines.push(`Tasks completed so far: ${done.length}`);
  } catch(_) {}

  // ── Goals ─────────────────────────────────────────────────
  try {
    const goals  = JSON.parse(localStorage.getItem(`sivarr_goals_${sid}`) || '[]');
    const active = goals.filter(g => !g.done);
    if (active.length) {
      lines.push(`Active goals (${active.length}): ${active.slice(0,4).map(g => {
        const pct = g.progress !== undefined ? ` — ${g.progress}%` : '';
        const due = g.deadline ? ` (due ${g.deadline})` : '';
        return (g.title || '') + pct + due;
      }).filter(Boolean).join(' | ')}`);
    }
    const completedGoals = goals.filter(g => g.done);
    if (completedGoals.length) lines.push(`Goals achieved: ${completedGoals.length}`);
  } catch(_) {}

  // ── Habits ────────────────────────────────────────────────
  try {
    const habits = JSON.parse(localStorage.getItem(`sivarr_habits_${sid}`) || '[]');
    if (habits.length) {
      lines.push(`Tracked habits: ${habits.slice(0,5).map(h => {
        const streak = h.streak ? ` (${h.streak}-day streak)` : '';
        return (h.name || h.title || '') + streak;
      }).filter(Boolean).join(' | ')}`);
    }
  } catch(_) {}

  // ── Journal ───────────────────────────────────────────────
  try {
    const journal = JSON.parse(localStorage.getItem(`sivarr_journal_${sid}`) || '[]');
    if (journal.length) {
      const recent = journal[journal.length - 1];
      const text   = (recent.text || recent.content || recent.entry || '').trim().slice(0, 200);
      const date   = recent.date || recent.created || '';
      if (text) lines.push(`Latest journal entry${date ? ` (${date})` : ''}: "${text}${text.length === 200 ? '…' : ''}"`);
      lines.push(`Total journal entries: ${journal.length}`);
    }
  } catch(_) {}

  // ── Focus sessions ────────────────────────────────────────
  try {
    const focusLog = JSON.parse(localStorage.getItem(`sivarr_focus_log_${sid}`) || '[]');
    if (focusLog.length) {
      const totalMins = focusLog.reduce((s, f) => s + (f.duration || 0), 0);
      const lastTask  = focusLog[focusLog.length - 1]?.task || '';
      lines.push(`Focus sessions: ${focusLog.length} sessions, ${totalMins} total minutes`);
      if (lastTask) lines.push(`Last focus task: "${lastTask}"`);
    }
  } catch(_) {}

  // ── Calendar events ───────────────────────────────────────
  try {
    const events  = JSON.parse(localStorage.getItem(`sivarr_events_${sid}`) || '[]');
    const nowMs   = Date.now();
    const upcoming = events
      .filter(e => e.date && new Date(e.date).getTime() >= nowMs)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3);
    if (upcoming.length) {
      lines.push(`Upcoming events: ${upcoming.map(e => `${e.title || ''} on ${e.date}`).join(' | ')}`);
    }
  } catch(_) {}

  // ── Profile ───────────────────────────────────────────────
  try {
    const prof = JSON.parse(localStorage.getItem(`sivarr_profile_${sid}`) || '{}');
    if (prof.bio)    lines.push(`User bio: "${prof.bio}"`);
    if (prof.skills?.length) lines.push(`Skills: ${prof.skills.join(', ')}`);
  } catch(_) {}

  // ── Courses / Topics ──────────────────────────────────────
  try {
    if (S.topics?.length) lines.push(`Study topics: ${S.topics.slice(0,6).join(', ')}`);
  } catch(_) {}

  if (lines.length <= 1) return ''; // only the header, no data yet
  return lines.join('\n');
}

let _lastFailedMsg = null; // stored for retryChat()

async function send(retryText = null) {
  const ci  = $('ci');
  const msg = retryText || ci?.value.trim() || '';
  if (!msg && !ATTACHMENTS.length) return;
  if (!S.sid) return;

  // Build full message with attachment context
  let fullMsg = msg;
  if (ATTACHMENTS.length) {
    const attachContext = ATTACHMENTS.map(a =>
      a.type === 'image'
        ? `[Image attached: ${a.name}]`
        : `[File attached: ${a.name}]\n\nContent:\n${a.content.slice(0, 3000)}`
    ).join('\n\n');
    fullMsg = msg ? `${msg}\n\n${attachContext}` : attachContext;
  }

  // Show user bubble only on original send, not retry
  if (!retryText) {
    const displayMsg = msg || `📎 ${ATTACHMENTS.map(a => a.name).join(', ')}`;
    addMsg('user', displayMsg);
    if (ATTACHMENTS.length) { ATTACHMENTS = []; renderAttachPreview(); }
    if (ci) { ci.value = ''; ci.style.height = 'auto'; }
  }

  const t   = addTyping();
  const btn = $('sb'); if (btn) btn.disabled = true;

  // "Taking a bit longer…" nudge after 8 s
  const slowTimer = setTimeout(() => {
    const inner = t.querySelector('.typing');
    if (inner) inner.innerHTML =
      '<span style="font-size:.8rem;color:var(--muted);padding:4px 0">Taking a bit longer…</span>';
  }, 8000);

  // First message of session — attach context snapshot
  let context = '';
  if (!_contextSent && !retryText) {
    context = buildSivarrContext();
    _contextSent = true;
  }

  let r = null, lastErr = null, attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      r = await Promise.race([
        API('/api/chat', { sid: S.sid, message: fullMsg, context }),
        new Promise((_, rej) => setTimeout(
          () => rej(Object.assign(new Error('Request timed out'), { name: 'AbortError' })),
          20000
        )),
      ]);
      break; // success
    } catch(e) {
      lastErr = e;
      // Only auto-retry on network failure — not on timeout or server errors
      if (e.name === 'AbortError' || (e.status && e.status < 500) || attempts >= 2) break;
      await new Promise(res => setTimeout(res, 1500));
    }
  }

  clearTimeout(slowTimer);
  t.remove();

  if (r) {
    addMsg('sivarr', r.reply, r.uncertain, r.error);
    if (!r.error) {
      _lastFailedMsg = null;
      S.stats.questions++;
      updateSBStats();
      refreshTopics();
      chatCounterDecrement(); // only counts real successful answers
    } else {
      _lastFailedMsg = fullMsg; // AI returned an error string — allow retry
    }
  } else {
    const isTimeout = lastErr?.name === 'AbortError';
    const errText = isTimeout
      ? 'Request timed out — SIVARR may be busy. Tap "Try again" below.'
      : 'Could not reach SIVARR — check your connection and tap "Try again".';
    addMsg('sivarr', errText, false, true);
    _lastFailedMsg = fullMsg;
  }

  if (btn) btn.disabled = false;
  scrollMsgs();
}

function retryChat() {
  if (!_lastFailedMsg) return;
  // Remove the last error bubble so it doesn't stack up
  const msgs = $('msgs');
  if (msgs) {
    const errBubs = msgs.querySelectorAll('.msg-error');
    if (errBubs.length) errBubs[errBubs.length - 1].closest('.msg')?.remove();
  }
  const txt = _lastFailedMsg;
  _lastFailedMsg = null;
  send(txt);
}

/* Daily message counter — resets at midnight */
const CHAT_LIMIT = 20;
function chatCounterKey() { return `sivarr_chat_count_${new Date().toDateString()}_${S.sid}`; }
function chatCounterGet()  { return parseInt(localStorage.getItem(chatCounterKey()) || '0', 10); }
function chatCounterDecrement() {
  const used = chatCounterGet() + 1;
  localStorage.setItem(chatCounterKey(), used);
  chatCounterRender(used);
}
function chatCounterRender(used) {
  const el  = $('chat-msg-counter');
  if (!el) return;
  const left = Math.max(0, CHAT_LIMIT - used);
  el.textContent = `${left} msg${left !== 1 ? 's' : ''} left today`;
  el.style.color = left <= 5 ? 'var(--coral)' : 'var(--text4)';
}
function chatCounterInit() { chatCounterRender(chatCounterGet()); }

function quickPrompt(text) {
  // Hide welcome screen, set input, and send
  const welcome = $('chat-welcome');
  if (welcome) welcome.style.display = 'none';
  const ci = $('ci');
  if (ci) { ci.value = text; ci.style.height = 'auto'; }
  send();
}

function addMsg(role, text, uncertain = false, isError = false) {
  const welcome = $('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  const w = $('msgs'), d = document.createElement('div');
  d.className = `msg ${role}`;
  const av       = role === 'sivarr' ? 'Sr' : S.name[0]?.toUpperCase() || 'U';
  const rendered = role === 'sivarr' ? renderMarkdown(text) : esc(text);
  const errClass = isError ? ' msg-error' : '';
  d.innerHTML = `
    <div class="msg-av">${av}</div>
    <div style="min-width:0;flex:1">
      <div class="msg-bub md-body${errClass}">${rendered}</div>
      ${uncertain ? `<div class="uncertain">⚠️ Verify this with your lecturer</div>` : ''}
      ${isError  ? `<button class="chat-retry-btn" onclick="retryChat()">↻ Try again</button>` : ''}
      ${role === 'sivarr' && !isError ? `<button class="action-btn" style="margin-top:5px;font-size:.68rem" onclick="downloadText(this.closest('.msg').querySelector('.msg-bub').innerText)">⬇ Download</button>` : ''}
    </div>`;
  w.appendChild(d);
  scrollMsgs();
  return d;
}

function addTyping() {
  const w = $('msgs'), d = document.createElement('div');
  d.className = 'msg sivarr';
  d.innerHTML = `<div class="msg-av">Sr</div>
    <div class="typing"><span></span><span></span><span></span></div>`;
  w.appendChild(d);
  scrollMsgs();
  return d;
}

function scrollMsgs() {
  const m = $('msgs'); m.scrollTop = m.scrollHeight;
}

function ckd(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
}

// ═══════════════════════════ QUIZ ═════════════════════════════
function startQuiz() {
  const typed = $('quiz-topic-input') ? $('quiz-topic-input').value.trim() : '';

  // If no studied topics AND no typed topic, show helpful message
  if (!S.topics.length && !typed) {
    toast('Type a topic above or ask me questions in Chat first!');
    return;
  }

  // Store custom topic for this quiz session
  S.quizCustomTopic = typed || '';
  S.quizActive = true;
  S.quizQ      = 0;
  S.quizScore  = 0;
  loadQ();
}

async function loadQ() {
  const qw = $('qw');
  if (!qw) return;

  let topic = S.quizCustomTopic || '';
  if (!topic && S.topics.length) topic = S.topics[Math.floor(Math.random() * S.topics.length)];
  if (!topic) topic = 'general knowledge';

  qw.innerHTML = `
    <div style="padding:3rem 1rem;text-align:center">
      <div style="font-size:1.8rem;margin-bottom:.75rem">⏳</div>
      <div style="color:var(--muted);font-size:.9rem">Generating question ${S.quizQ+1} of 5...</div>
      <div style="font-size:.78rem;color:var(--muted2);margin-top:.3rem">${esc(topic)}</div>
    </div>`;

  try {
    const r = await fetch(`/api/quiz/question?sid=${encodeURIComponent(S.sid)}&topic=${encodeURIComponent(topic)}&difficulty=${encodeURIComponent(S.diff)}`);
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    const q = await r.json();
    if (q.error) { toast(q.error); resetQuiz(); return; }
    S.curQ = q;
    renderQ(q);
  } catch(e) {
    qw.innerHTML = `
      <div style="padding:2rem;text-align:center">
        <div style="font-size:1.5rem;margin-bottom:.5rem">⚠️</div>
        <div style="color:var(--muted);font-size:.88rem;margin-bottom:1rem">Couldn't generate question — AI may be busy.</div>
        <button class="btn-start" style="padding:8px 20px;font-size:.82rem" onclick="loadQ()">Try Again</button>
        <button style="margin-left:8px;background:none;border:1px solid var(--border);border-radius:8px;padding:8px 16px;color:var(--muted);font-size:.82rem;cursor:pointer" onclick="resetQuiz()">Cancel</button>
      </div>`;
  }
}

function renderQ(q) {
  const pct = S.quizQ/5*100;
  $('qw').innerHTML = `
    <div class="q-header">
      <h3>Question ${S.quizQ+1} <span style="color:var(--muted);font-weight:400">of 5</span></h3>
      <span style="font-size:.75rem;color:var(--muted)">[${S.diff.toUpperCase()}]</span>
    </div>
    <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
    <div class="q-card">
      <h4>${esc(q.question)}</h4>
      <div class="opts">
        ${['A','B','C','D'].map(l=>`
          <button class="opt-btn" onclick="answer('${l}')" data-l="${l}">
            <span class="opt-letter">${l}</span>${esc(q.options[l])}
          </button>`).join('')}
      </div>
      <div class="expl" id="expl"></div>
    </div>`;
}

async function answer(letter) {
  const q = S.curQ, correct = letter === q.answer;
  document.querySelectorAll('.opt-btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.l === q.answer) b.classList.add('correct');
    if (b.dataset.l === letter && !correct) b.classList.add('wrong');
  });
  const ex = $('expl');
  ex.textContent = (correct ? '✅ ' : '❌ ') + q.explanation;
  ex.style.display = 'block';
  if (correct) S.quizScore++;
  await API('/api/quiz/submit', {
    sid: S.sid, topic: q.topic || S.topics[0],
    difficulty: S.diff, answer: letter,
    question: q.question, correct: q.answer, explanation: q.explanation,
  });
  S.quizQ++;
  setTimeout(() => S.quizQ >= 5 ? showResult() : loadQ(), 1800);
}

async function showResult() {
  const pct = Math.round(S.quizScore/5*100);
  const emoji = pct===100?'🏆':pct>=80?'🌟':pct>=60?'👍':'💪';
  const msg = pct===100?'Perfect score! Outstanding!':pct>=80?'Great job!':pct>=60?'Good effort — keep going!':'Keep practising!';
  await API('/api/quiz/complete', { sid: S.sid, score: S.quizScore, topic: S.topics[0]||'general', difficulty: S.diff });
  $('qw').innerHTML = `
    <div class="score-card">
      <div style="font-size:2.5rem;margin-bottom:.5rem">${emoji}</div>
      <div class="score-num">${S.quizScore}/5</div>
      <div style="color:var(--muted);margin:.4rem 0">${pct}% · ${S.diff.toUpperCase()}</div>
      <div style="font-weight:500;margin-bottom:1.5rem">${msg}</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:1rem">
        <button class="action-btn" onclick="shareResult(${S.quizScore},'${S.topics[0]||'general'}')">🔗 Share Result</button>
      </div>
      <button class="btn-start" onclick="startQuiz()">Take Another Quiz</button>
    </div>`;
  S.stats.quizzes++; updateSBStats(); loadWrong(); S.quizActive = false;
}

function resetQuiz() {
  S.quizActive = false;
  S.quizCustomTopic = '';
  $('qw').innerHTML = `
    <div class="quiz-start-card">
      <div style="font-size:2.5rem">📝</div>
      <h2>Test your knowledge</h2>
      <p style="margin-bottom:1rem">Difficulty: <strong style="color:var(--accent)">${S.diff.charAt(0).toUpperCase()+S.diff.slice(1)}</strong></p>
      <div style="margin-bottom:1rem;text-align:left">
        <label style="font-size:.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Topic (optional)</label>
        <input id="quiz-topic-input" type="text"
          placeholder="e.g. Photosynthesis, Newton's laws..."
          style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 13px;color:var(--text);font-family:var(--font-body);font-size:.88rem;outline:none"
          onkeydown="if(event.key==='Enter') startQuiz()">
        <p style="font-size:.72rem;color:var(--muted);margin-top:5px">Leave blank to quiz from your studied topics</p>
      </div>
      <button class="btn-start" onclick="startQuiz()">Start Quiz</button>
    </div>`;
}

// ═══════════════════════════ SUGGESTIONS ═══════════════════════
async function getSuggestions() {
  const _st = $('sug-txt'); if (_st) _st.textContent = 'Thinking...';
  try {
    const r = await fetch(`/api/suggest?sid=${S.sid}`);
    const d = await r.json();
    if (_st) _st.textContent = d.suggestion;
  } catch { const _stc = $('sug-txt'); if (_stc) _stc.textContent = 'Couldn\'t load suggestions — try again.'; }
}

// ═══════════════════════════ WRONG ANSWERS ══════════════════════
async function loadWrong() {
  try {
    const r = await fetch(`/api/wrong?sid=${S.sid}`);
    const d = await r.json();
    S.wrongAnswers = d.wrong;
    const wc   = $('wc');   if (wc)   wc.textContent   = d.wrong.length;
    const wcm  = $('wc-m'); if (wcm)  wcm.textContent  = d.wrong.length;
    const sqw  = $('sq-w'); if (sqw)  sqw.textContent  = d.wrong.length;
    const list = $('wrong-list');
    const listm = $('wrong-list-m');
    const html = !d.wrong.length
      ? `<span style="color:var(--muted);font-size:.78rem">No wrong answers yet — keep quizzing!</span>`
      : d.wrong.map((w,i) => `
          <div class="wrong-item">
            <div class="wrong-q">${esc(w.question)}</div>
            <div class="wrong-ans">You: ${w.your_answer} · Correct: <span>${w.correct}</span></div>
            <div style="color:var(--muted);font-size:.7rem;margin-top:2px">${esc(w.explanation)}</div>
            <button class="btn-clear" onclick="clearWrong(${i})">✓ Got it</button>
          </div>`).join('');
    if (list)  list.innerHTML  = html;
    if (listm) listm.innerHTML = html;
  } catch(e) { console.error('loadWrong error:', e); }
}

async function clearWrong(idx) {
  await API('/api/wrong/clear', { sid: S.sid, index: idx });
  loadWrong(); toast('Removed from revision ✓');
}

// ═══════════════════════════ STATS ══════════════════════════════
async function loadStats() {
  const r = await fetch(`/api/progress?sid=${S.sid}`);
  const d = await r.json();

  // Build sparkline SVG
  const hist = d.quiz_history || [];
  let sparkSVG = '';
  if (hist.length > 1) {
    const W = 300, H = 48, pad = 6;
    const max = Math.max(...hist.map(q => q.pct), 1);
    const pts = hist.map((q, i) => {
      const x = pad + (i / (hist.length - 1)) * (W - pad * 2);
      const y = H - pad - (q.pct / max) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const area = `${W - pad},${H} ${pad},${H}`;
    sparkSVG = `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:48px;margin-top:8px">
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4f6ef7" stop-opacity=".3"/>
            <stop offset="100%" stop-color="#4f6ef7" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${pts.join(' ')} ${area}" fill="url(#sg)"/>
        <polyline points="${pts.join(' ')}" fill="none" stroke="#4f6ef7"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${pts[pts.length-1].split(',')[0]}"
                cy="${pts[pts.length-1].split(',')[1]}"
                r="3.5" fill="#7c3aed"/>
      </svg>`;
  }

  // Topic mastery bars
  const mastery = d.topic_mastery || {};
  const masteryHTML = Object.entries(mastery).length
    ? Object.entries(mastery).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([t, pct]) => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:.75rem;color:var(--muted);width:90px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t)}</span>
          <div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px;transition:width .6s ease"></div>
          </div>
          <span style="font-size:.7rem;color:var(--muted);width:28px;text-align:right">${pct}%</span>
        </div>`).join('')
    : '<span style="font-size:.78rem;color:var(--muted)">Ask questions to build topic mastery.</span>';

  // Badges
  const badges  = d.badges || [];
  const badgesHTML = badges.length
    ? badges.map(b => `<span style="background:#4f6ef718;border:1px solid #4f6ef730;border-radius:20px;padding:3px 10px;font-size:.7rem;font-weight:700;color:var(--accent);font-family:var(--font);margin:2px;display:inline-block">🏅 ${esc(b)}</span>`).join('')
    : '<span style="font-size:.78rem;color:var(--muted)">Complete quizzes to earn badges.</span>';

  // Streak colour
  const sc = (d.streak || 0) >= 7 ? '#f59e0b' : (d.streak || 0) >= 3 ? '#fb923c' : 'var(--muted)';
  const xp  = d.xp || 0;
  const lvl = d.level || 1;

  $('sw').innerHTML = `

    <!-- Hero -->
    <div style="background:linear-gradient(135deg,#4f6ef718,#7c3aed12);border:1px solid #4f6ef730;border-radius:16px;padding:1.1rem;margin-bottom:.875rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
        <div>
          <div style="font-family:var(--font);font-size:.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Level ${lvl}</div>
          <div style="font-family:var(--font);font-size:1.2rem;font-weight:800;letter-spacing:-.02em">${esc(d.name?.split(' ')[0] || 'Student')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:1.3rem">🔥</div>
          <div style="font-family:var(--font);font-size:.82rem;font-weight:800;color:${sc}">${d.streak || 0} day streak</div>
        </div>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${xp % 100}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px;transition:width .8s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted);margin-top:3px">
        <span>${xp} XP</span><span>${100 - (xp % 100)} XP to Level ${lvl + 1}</span>
      </div>
    </div>

    <!-- Stats grid -->
    <div class="stats-grid" style="margin-bottom:.875rem">
      <div class="stat-card" style="--sc:#4f6ef7"><div class="sc-label">Questions</div><div class="sc-val" style="color:#4f6ef7">${d.questions}</div></div>
      <div class="stat-card" style="--sc:#7c3aed"><div class="sc-label">Quizzes</div><div class="sc-val" style="color:#7c3aed">${d.quizzes_taken}</div></div>
      <div class="stat-card" style="--sc:#22c55e"><div class="sc-label">Avg Score</div><div class="sc-val" style="color:#22c55e">${d.avg_score}%</div></div>
      <div class="stat-card" style="--sc:#f59e0b"><div class="sc-label">This Week</div><div class="sc-val" style="color:#f59e0b">${d.sessions_week || 0}</div></div>
    </div>

    <!-- Quiz trend -->
    ${hist.length > 1 ? `
    <div class="r-card" style="margin-bottom:.875rem">
      <div class="r-title">📈 Quiz Score Trend <span style="color:var(--muted);font-weight:400;font-size:.72rem">(last ${hist.length})</span></div>
      ${sparkSVG}
      <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted);margin-top:4px">
        <span>Earliest</span><span>Latest: ${hist[hist.length-1]?.pct || 0}%</span>
      </div>
    </div>` : ''}

    <!-- Topic mastery -->
    <div class="r-card" style="margin-bottom:.875rem">
      <div class="r-title">📚 Topic Mastery</div>
      <div style="margin-top:.5rem">${masteryHTML}</div>
    </div>

    <!-- Weak areas -->
    ${d.weak?.length ? `
    <div style="background:linear-gradient(135deg,#ef444410,transparent);border:1px solid #ef444430;border-radius:12px;padding:.875rem;margin-bottom:.875rem" id="weak-section">
      <div style="font-size:.72rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">⚠️ Needs Work</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:.625rem">
        ${d.weak.map(t => `<span style="background:#ef444415;border:1px solid #ef444430;border-radius:20px;padding:3px 10px;font-size:.72rem;color:var(--red);font-weight:600">${esc(t)}</span>`).join('')}
      </div>
      <button onclick="nav('chat',null);setTimeout(()=>{const ci=$('ci');if(ci){ci.value='Help me improve my understanding of ${esc(d.weak[0]||'')}';ci.focus();}},300)"
        style="width:100%;background:none;border:1px solid #ef444440;border-radius:8px;padding:7px;color:var(--red);font-family:var(--font);font-size:.75rem;font-weight:700;cursor:pointer">
        Study weak topics with AI →
      </button>
    </div>` : ''}

    <!-- Badges -->
    <div class="r-card" style="margin-bottom:.875rem">
      <div class="r-title">🏅 Badges</div>
      <div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:3px">${badgesHTML}</div>
    </div>

    <!-- Best topic -->
    ${d.best_topic ? `
    <div style="background:linear-gradient(135deg,#22c55e10,transparent);border:1px solid #22c55e30;border-radius:12px;padding:.875rem;display:flex;align-items:center;gap:10px">
      <div style="font-size:1.4rem">⭐</div>
      <div>
        <div style="font-family:var(--font);font-size:.8rem;font-weight:700;color:var(--green)">Strongest Topic</div>
        <div style="font-size:.78rem;color:var(--text);margin-top:1px">${esc(d.best_topic)}</div>
      </div>
    </div>` : ''}
  `;
  }

async function loadProgress() {
  const r = await fetch(`/api/progress?sid=${S.sid}`);
  const d = await r.json();
  const pw = $('pw'); if (!pw) return;

  // Sparkline
  const hist   = d.quiz_history || [];
  const W = 280, H = 44, pad = 4;
  let sparkSVG = '';
  if (hist.length > 1) {
    const max = Math.max(...hist.map(q=>q.pct), 1);
    const pts = hist.map((q,i) => {
      const x = pad + (i/(hist.length-1))*(W-pad*2);
      const y = H - pad - (q.pct/max)*(H-pad*2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const areaClose = `${W-pad},${H} ${pad},${H}`;
    sparkSVG = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:44px;margin-top:6px">
      <defs><linearGradient id="pr-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4f6ef7" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#4f6ef7" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${pts.join(' ')} ${areaClose}" fill="url(#pr-grad)"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="#4f6ef7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.map((p,i) => i===pts.length-1 ? `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.5" fill="#7c3aed"/>` : '').join('')}
    </svg>`;
  }

  // XP level
  const xp    = d.xp    || 0;
  const level = d.level || 1;
  const xpPct = (xp % 100);

  // Topic mastery rows
  const mastery = d.topic_mastery || {};
  const masteryHTML = Object.entries(mastery).length
    ? Object.entries(mastery).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([t,pct])=>`
        <div class="pr-topic-row">
          <span style="font-size:.78rem;color:var(--muted);width:100px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t)}</span>
          <div class="pr-topic-bar-wrap"><div class="pr-topic-bar-fill" style="width:${pct}%"></div></div>
          <span style="font-size:.72rem;color:var(--muted);width:30px;text-align:right">${pct}%</span>
        </div>`).join('')
    : '<span style="font-size:.78rem;color:var(--muted)">Chat and quiz to build topic mastery.</span>';

  // Badges
  const badges = d.badges || [];
  const badgesHTML = badges.length
    ? badges.map(b=>`<span class="pr-badge">🏅 ${esc(b)}</span>`).join('')
    : '<span style="font-size:.78rem;color:var(--muted)">Complete quizzes to earn badges.</span>';

  // Streak fire
  const streakColor = d.streak >= 7 ? '#f59e0b' : d.streak >= 3 ? '#fb923c' : 'var(--muted)';

  pw.innerHTML = `
    <!-- Hero: Level + Streak -->
    <div class="pr-hero">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
        <div>
          <div style="font-family:var(--font);font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Level ${level}</div>
          <div style="font-family:var(--font);font-size:1.3rem;font-weight:800;letter-spacing:-.02em">${d.name?.split(' ')[0] || 'Student'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:1.4rem">🔥</div>
          <div style="font-family:var(--font);font-size:.85rem;font-weight:800;color:${streakColor}">${d.streak || 0} day streak</div>
        </div>
      </div>
      <div class="pr-level-bar"><div class="pr-level-fill" style="width:${xpPct}%"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted)">
        <span>${xp} XP</span>
        <span>${100 - xpPct} XP to Level ${level+1}</span>
      </div>
    </div>

    <!-- Stats grid -->
    <div class="pr-stat-row">
      <div class="pr-stat" style="--pr-color:#4f6ef7">
        <div class="pr-stat-val">${d.questions}</div>
        <div class="pr-stat-lbl">Questions asked</div>
      </div>
      <div class="pr-stat" style="--pr-color:#7c3aed">
        <div class="pr-stat-val">${d.quizzes_taken}</div>
        <div class="pr-stat-lbl">Quizzes taken</div>
      </div>
      <div class="pr-stat" style="--pr-color:#22c55e">
        <div class="pr-stat-val">${d.avg_score}%</div>
        <div class="pr-stat-lbl">Average score</div>
      </div>
      <div class="pr-stat" style="--pr-color:#f59e0b">
        <div class="pr-stat-val">${d.sessions_week || 0}</div>
        <div class="pr-stat-lbl">Sessions this week</div>
      </div>
    </div>

    <!-- Quiz trend sparkline -->
    ${hist.length > 1 ? `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.875rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">📈 Quiz Score Trend</div>
        <div style="font-size:.72rem;color:var(--accent)">${hist.length} quizzes</div>
      </div>
      ${sparkSVG}
    </div>` : ''}

    <!-- Topic mastery -->
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.875rem">
      <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem">📚 Topic Mastery</div>
      ${masteryHTML}
    </div>

    <!-- Weak areas -->
    ${d.weak?.length ? `
    <div style="background:linear-gradient(135deg,#ef444410,transparent);border:1px solid #ef444430;border-radius:12px;padding:1rem;margin-bottom:.875rem" id="weak-section">
      <div style="font-size:.75rem;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.625rem">⚠️ Needs Work</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${d.weak.map(t=>`<span style="background:#ef444415;border:1px solid #ef444430;border-radius:20px;padding:3px 10px;font-size:.72rem;color:var(--red);font-weight:600">${esc(t)}</span>`).join('')}
      </div>
      <button onclick="nav('chat',null);setTimeout(()=>{const ci=$('ci');if(ci){ci.value='Help me improve at '+${JSON.stringify(d.weak[0])};ci.focus();}},300)" style="width:100%;margin-top:.75rem;background:none;border:1px solid #ef444440;border-radius:8px;padding:7px;color:var(--red);font-family:var(--font);font-size:.75rem;font-weight:700;cursor:pointer;transition:all .15s">
        Study weak topics with AI →
      </button>
    </div>` : ''}

    <!-- Badges -->
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.875rem">
      <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.625rem">🏅 Badges</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${badgesHTML}</div>
    </div>

    <!-- Best topic -->
    ${d.best_topic ? `
    <div style="background:linear-gradient(135deg,#22c55e10,transparent);border:1px solid #22c55e30;border-radius:12px;padding:.875rem;margin-bottom:.875rem;display:flex;align-items:center;gap:12px">
      <div style="font-size:1.5rem">⭐</div>
      <div>
        <div style="font-family:var(--font);font-size:.82rem;font-weight:700;color:var(--green)">Strongest Topic</div>
        <div style="font-size:.78rem;color:var(--text);margin-top:1px">${esc(d.best_topic)}</div>
      </div>
    </div>` : ''}
  `;
}

// ═══════════════════════ GOALS ═════════════════════════════

let GL_GOALS = [];

async function glLoad() {
  try {
    const r = await fetch(`/api/goals?sid=${S.sid}`);
    const d = await r.json();
    GL_GOALS = d.goals || [];
    glRender();
  } catch(e) { GL_GOALS = []; glRender(); }
}

function glRender() {
  const list = $('gl-list'); if (!list) return;
  if (!GL_GOALS.length) {
    list.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:.5rem">🎯</div>
      <div style="font-size:.85rem">No goals yet — set your first target!</div>
    </div>`; return;
  }

  const today = new Date();
  list.innerHTML = GL_GOALS.map(g => {
    const daysLeft = g.deadline
      ? Math.ceil((new Date(g.deadline) - today) / 86400000) : null;
    const urgency  = daysLeft !== null && daysLeft <= 3 ? 'var(--red)' :
                     daysLeft !== null && daysLeft <= 7 ? 'var(--yellow)' : 'var(--muted)';
    const pct = g.progress || 0;
    return `
      <div class="gl-card ${g.completed ? 'done' : ''}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="flex:1">
            <div class="gl-title">${g.completed ? '✅ ' : ''}${esc(g.title)}</div>
            <div class="gl-meta">
              ${g.subject ? `📚 ${esc(g.subject)} · ` : ''}
              🎯 Target: ${g.target_score}%
              ${daysLeft !== null ? ` · <span style="color:${urgency}">${daysLeft > 0 ? daysLeft+' days left' : daysLeft === 0 ? 'Today!' : 'Overdue'}</span>` : ''}
            </div>
          </div>
          <div style="font-family:var(--font);font-size:.85rem;font-weight:800;color:var(--accent)">${pct}%</div>
        </div>
        <div class="gl-prog-wrap">
          <div class="gl-prog-fill ${g.completed?'done':''}" style="width:${pct}%"></div>
        </div>
        <div style="font-size:.68rem;color:var(--muted)">${pct}% of target reached</div>
        <div class="gl-actions">
          <button class="gl-action-btn" onclick="glUpdateProgress('${g.id}',${pct})">📈 Update</button>
          <button class="gl-action-btn done-btn" onclick="glMarkDone('${g.id}')">${g.completed ? '↩ Reopen' : '✓ Done'}</button>
          <button class="gl-action-btn del-btn" onclick="glDelete('${g.id}')">🗑</button>
        </div>
      </div>`;
  }).join('');
}

function glToggleForm() {
  $('gl-add-form').classList.toggle('open');
  if ($('gl-add-form').classList.contains('open')) {
    $('gl-title')?.focus();
    $('gl-deadline').min = new Date().toISOString().split('T')[0];
  }
}

async function glSaveGoal() {
  const title   = $('gl-title')?.value.trim();
  const subject = $('gl-subject')?.value.trim();
  const target  = parseInt($('gl-target')?.value) || 70;
  const deadline = $('gl-deadline')?.value;
  if (!title) { toast('Enter a goal title.'); return; }
  try {
    const r = await API('/api/goals/add', {sid:S.sid, title, subject, target_score:target, deadline});
    GL_GOALS.push(r.goal);
    glRender();
    $('gl-add-form').classList.remove('open');
    $('gl-title').value = ''; $('gl-subject').value = '';
    $('gl-target').value = '70'; $('gl-deadline').value = '';
    toast('Goal added! 🎯');
  } catch(e) { toast('Could not save goal.'); }
}

async function glUpdateProgress(id, current) {
  const val = await siModal.input('Update Progress', '0 – 100', String(current), { type:'number', confirmLabel:'Update', description:`Currently at ${current}%` });
  if (val === null) return;
  const pct = Math.min(Math.max(parseInt(val)||0, 0), 100);
  try {
    await API('/api/goals/update', {sid:S.sid, id, progress:pct, completed: pct>=100});
    const g = GL_GOALS.find(x=>x.id===id);
    if (g) { g.progress = pct; g.completed = pct>=100; }
    glRender();
    if (pct >= 100) toast('Goal completed! 🎉');
    else toast(`Progress updated to ${pct}% ✓`);
  } catch(e) { toast('Update failed.'); }
}

async function glMarkDone(id) {
  const g = GL_GOALS.find(x=>x.id===id);
  if (!g) return;
  const completed = !g.completed;
  try {
    await API('/api/goals/update', {sid:S.sid, id, progress: completed?100:g.progress, completed});
    g.completed = completed;
    if (completed) g.progress = 100;
    glRender();
    toast(completed ? 'Goal completed! 🎉' : 'Goal reopened');
  } catch(e) { toast('Update failed.'); }
}

async function glDelete(id) {
  if (!await siModal.confirm('This goal will be permanently deleted.', { title:'Delete Goal', confirmLabel:'Delete', danger:true })) return;
  try {
    await API('/api/goals/delete', {sid:S.sid, id});
    GL_GOALS = GL_GOALS.filter(x=>x.id!==id);
    glRender();
    toast('Goal deleted');
  } catch(e) { toast('Delete failed.'); }
}

// ═══════════════════════ DOCUMENT HUB ══════════════════════

const DH_KEY    = () => `sivarr_docs_${S.sid || 'guest'}`;
let   DH_ACTIVE = null;
let   DH_SAVE_TIMER = null;

function dhLoadDocs() {
  try { return JSON.parse(localStorage.getItem(DH_KEY()) || '[]'); }
  catch { return []; }
}
function dhSaveDocs(docs) { localStorage.setItem(DH_KEY(), JSON.stringify(docs)); }

function dhInit() {
  dhBackToList();
  dhRenderList();
}

function dhRenderList() {
  const docs = dhLoadDocs();
  const el   = $('dh-docs-list'); if (!el) return;
  if (!docs.length) {
    el.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:.5rem">📄</div>
      <div style="font-size:.85rem">No documents yet.<br>Create your first rich note.</div>
    </div>`; return;
  }
  el.innerHTML = docs.sort((a,b)=>b.updated-a.updated).map(d=>`
    <div class="dh-doc-item" onclick="dhOpenDoc('${d.id}')">
      <div style="font-size:1.1rem">📄</div>
      <div style="flex:1;overflow:hidden">
        <div class="dh-doc-title">${esc(d.title||'Untitled')}</div>
        <div class="dh-doc-date">${new Date(d.updated).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
      </div>
      <button onclick="event.stopPropagation();dhDeleteDoc('${d.id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;padding:4px;transition:color .15s" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--muted)'">🗑</button>
    </div>`).join('');
}

function dhNewDoc() {
  DH_ACTIVE = {id: Date.now().toString(36), title:'', content:'', updated: Date.now()};
  dhShowEditor();
  $('dh-doc-title-input').value = '';
  $('dh-editor').innerHTML = '';
  $('dh-doc-title-input').focus();
}

function dhOpenDoc(id) {
  const docs = dhLoadDocs();
  DH_ACTIVE  = docs.find(d=>d.id===id);
  if (!DH_ACTIVE) return;
  dhShowEditor();
  $('dh-doc-title-input').value = DH_ACTIVE.title || '';
  $('dh-editor').innerHTML      = DH_ACTIVE.content || '';
  dhUpdateWordCount();
}

function dhShowEditor() {
  $('dh-list-view').style.display   = 'none';
  $('dh-editor-view').style.display = 'flex';
  $('dh-save-status').textContent   = 'Saved';
  $('dh-save-status').style.color   = 'var(--green)';
}

function dhBackToList() {
  if (DH_ACTIVE) dhSaveDoc(true);
  $('dh-editor-view').style.display = 'none';
  $('dh-list-view').style.display   = 'block';
  DH_ACTIVE = null;
  dhRenderList();
}

function dhSaveDoc(silent = false) {
  if (!DH_ACTIVE) return;
  DH_ACTIVE.title   = $('dh-doc-title-input')?.value.trim() || 'Untitled';
  DH_ACTIVE.content = $('dh-editor')?.innerHTML || '';
  DH_ACTIVE.updated = Date.now();
  const docs  = dhLoadDocs();
  const idx   = docs.findIndex(d=>d.id===DH_ACTIVE.id);
  if (idx >= 0) docs[idx] = DH_ACTIVE;
  else docs.push(DH_ACTIVE);
  dhSaveDocs(docs);
  if (!silent) {
    toast('Document saved ✓');
    const st = $('dh-save-status');
    if (st) { st.textContent = 'Saved'; st.style.color = 'var(--green)'; }
  }
}

function dhAutoSave() {
  const st = $('dh-save-status');
  if (st) { st.textContent = 'Unsaved changes'; st.style.color = 'var(--yellow)'; }
  dhUpdateWordCount();
  clearTimeout(DH_SAVE_TIMER);
  DH_SAVE_TIMER = setTimeout(() => dhSaveDoc(true), 2000);
}

function dhUpdateWordCount() {
  const el = $('dh-editor'); if (!el) return;
  const words = el.innerText.trim().split(/\s+/).filter(Boolean).length;
  const wc    = $('dh-word-count'); if (wc) wc.textContent = `${words} word${words!==1?'s':''}`;
}

function dhFormat(cmd) { document.execCommand(cmd, false, null); $('dh-editor').focus(); }

function dhBlock(tag) {
  const editor = $('dh-editor'); if (!editor) return;
  const sel    = window.getSelection();
  if (!sel.rangeCount) return;
  const text   = sel.toString() || 'Heading';
  const el     = document.createElement(tag === 'blockquote' ? 'blockquote' : tag);
  el.textContent = text;
  const range  = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(el);
  editor.focus();
  dhAutoSave();
}

function dhInsertCode() {
  const sel  = window.getSelection();
  const text = sel?.toString() || 'code';
  document.execCommand('insertHTML', false, `<code>${text}</code>`);
  $('dh-editor').focus();
  dhAutoSave();
}

async function dhAISuggest() {
  const content = $('dh-editor')?.innerText.trim();
  if (!content || content.length < 20) { toast('Write some content first for AI to suggest.'); return; }
  toast('AI is reading your doc... ✨');
  try {
    const r = await API('/api/chat', {
      sid: S.sid,
      message: `I'm writing a document. Here's what I have so far:\n\n"${content.slice(0,800)}"\n\nSuggest 2-3 improvements or additions I should make. Be specific and brief.`
    });
    const suggestion = document.createElement('blockquote');
    suggestion.style.cssText = 'border-left:3px solid var(--accent2);padding:.5rem .75rem;background:#7c3aed08;border-radius:0 6px 6px 0;margin:.5rem 0;font-size:.85rem;color:var(--muted)';
    suggestion.innerHTML = `<strong style="color:var(--accent2)">✨ AI Suggestion:</strong><br>${r.reply}`;
    $('dh-editor').appendChild(suggestion);
    dhAutoSave();
  } catch(e) { toast('AI suggestion failed — try again.'); }
}

async function dhDeleteDoc(id) {
  if (!await siModal.confirm('This document will be permanently deleted.', { title:'Delete Document', confirmLabel:'Delete', danger:true })) return;
  const docs = dhLoadDocs().filter(d=>d.id!==id);
  dhSaveDocs(docs);
  dhRenderList();
  toast('Document deleted');
}
  // ═══════════════════════ STUDY PLAN ═════════════════════════

  function spLoadSaved() {
  const saved = localStorage.getItem(`sivarr_sp_${S.sid}`);
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    if (!data?.plan?.length) return;
    // Restore subject + date fields
    const subj = $('sp-subject'); if (subj) subj.value = data.subject || '';
    const dt   = $('sp-date');   if (dt)   dt.value   = data.exam_date || '';
    // Show countdown
    const countdown = $('sp-countdown');
    if (countdown && data.exam_date) {
      const daysLeft = Math.ceil((new Date(data.exam_date) - new Date()) / 86400000);
      if (daysLeft > 0) {
        countdown.style.display = 'flex';
        const dt2 = $('sp-days-text'); if (dt2) dt2.textContent = `${daysLeft} day${daysLeft!==1?'s':''} until your exam`;
        const el  = $('sp-exam-label'); if (el) el.textContent = `${data.subject} · ${new Date(data.exam_date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}`;
      }
    }
    renderStudyPlan(data);
    const btn = $('sp-btn'); if (btn) btn.textContent = '✨ Regenerate Plan';
  } catch(e) {}
  }

let SP_HOURS = 1;

function setSPHours(h, btn) {
  SP_HOURS = h;
  document.querySelectorAll('.sp-hrs-btn').forEach(b => b.classList.remove('sp-hrs-active'));
  if (btn) btn.classList.add('sp-hrs-active');
}

async function generateStudyPlan() {
  const subject = $('sp-subject')?.value.trim();
  const date    = $('sp-date')?.value;
  const err     = $('sp-err');
  const btn     = $('sp-btn');
  const result  = $('sp-result');
  const countdown = $('sp-countdown');

  err.textContent = '';

  if (!subject) { err.textContent = 'Please enter a subject or course.'; return; }
  if (!date)    { err.textContent = 'Please pick your exam date.'; return; }

  const today   = new Date(); today.setHours(0,0,0,0);
  const examDay = new Date(date);
  const daysLeft = Math.round((examDay - today) / 86400000);

  if (daysLeft < 1) { err.textContent = 'Exam date must be in the future.'; return; }

  // Show countdown
  countdown.style.display = 'flex';
  $('sp-days-text').textContent = `${daysLeft} day${daysLeft !== 1 ? 's' : ''} until your exam`;
  $('sp-exam-label').textContent = `${subject} · ${examDay.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}`;

  btn.disabled = true;
  btn.textContent = '⏳ Generating your plan...';
  result.style.display = 'none';

  try {
    const res = await fetch('/api/studyplan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: S.sid, subject, exam_date: date, hours_per_day: SP_HOURS })
    });

    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.detail || 'Failed to generate plan.');
    }

    const data = await res.json();
    localStorage.setItem(`sivarr_sp_${S.sid}`, JSON.stringify(data));
    renderStudyPlan(data);

  } catch(e) {
    err.textContent = e.message || 'Something went wrong. Try again.';
    countdown.style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Regenerate Plan';
  }
}

function renderStudyPlan(data) {
  const result = $('sp-result');
  const plan   = data.plan || [];

  if (!plan.length) {
    result.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Could not generate plan. Try again.</p>';
    result.style.display = 'block';
    return;
  }

  const saved = JSON.parse(localStorage.getItem(`sp_checks_${S.sid}`) || '{}');

  result.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
      <div style="font-family:var(--font);font-size:.85rem;font-weight:700;color:var(--text)">
        📅 ${plan.length}-Day Plan · ${data.subject}
      </div>
      <button onclick="downloadStudyPlan()" style="background:none;border:1px solid var(--border);border-radius:8px;padding:5px 12px;color:var(--muted);font-size:.72rem;cursor:pointer;font-family:var(--font);font-weight:700;transition:all .15s"
        onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">
        ⬇ Export
      </button>
    </div>

    ${plan.map((day, di) => `
      <div class="sp-day-card" id="sp-day-${di}">
        <div class="sp-day-header">
          <span class="sp-day-num">Day ${day.day} · ${esc(day.date || '')}</span>
          <span class="sp-hours-badge">⏱ ${day.hours || SP_HOURS}h</span>
        </div>
        <div class="sp-day-focus">📖 ${esc(day.focus || '')}</div>
        <div>
          ${(day.tasks || []).map((task, ti) => {
            const key = `${di}_${ti}`;
            const done = saved[key] ? 'done' : '';
            return `
              <div class="sp-task">
                <div class="sp-task-check ${done}" onclick="toggleSPTask('${di}','${ti}',this)">
                  ${done ? '✓' : ''}
                </div>
                <span style="${done ? 'text-decoration:line-through;opacity:.5' : ''}" id="sp-task-text-${di}-${ti}">${esc(task)}</span>
              </div>`;
          }).join('')}
        </div>
      </div>
    `).join('')}

    <div style="background:linear-gradient(135deg,#22c55e10,transparent);border:1px solid #22c55e30;border-radius:12px;padding:.875rem;margin-top:.5rem;text-align:center">
      <div style="font-size:1.2rem;margin-bottom:4px">💪</div>
      <div style="font-family:var(--font);font-size:.82rem;font-weight:700;color:#22c55e">You've got this, ${S.name.split(' ')[0]}!</div>
      <div style="font-size:.72rem;color:var(--muted);margin-top:2px">Tick off tasks as you go. Sivarr's got your back 24/7.</div>
    </div>
  `;

  result.style.display = 'block';
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleSPTask(di, ti, el) {
  const key   = `${di}_${ti}`;
  const saved = JSON.parse(localStorage.getItem(`sp_checks_${S.sid}`) || '{}');
  const done  = !saved[key];
  saved[key]  = done;
  localStorage.setItem(`sp_checks_${S.sid}`, JSON.stringify(saved));
  el.classList.toggle('done', done);
  el.textContent = done ? '✓' : '';
  const txt = $(`sp-task-text-${di}-${ti}`);
  if (txt) txt.style.cssText = done ? 'text-decoration:line-through;opacity:.5' : '';
}

function downloadStudyPlan() {
  const subject  = $('sp-subject')?.value.trim() || 'Study Plan';
  const cards    = document.querySelectorAll('.sp-day-card');
  let text = `SIVARR STUDY PLAN — ${subject.toUpperCase()}\n`;
  text += `Generated: ${new Date().toLocaleDateString()}\n`;
  text += '='.repeat(40) + '\n\n';
  cards.forEach(card => {
    const num   = card.querySelector('.sp-day-num')?.textContent || '';
    const focus = card.querySelector('.sp-day-focus')?.textContent || '';
    const tasks = [...card.querySelectorAll('.sp-task span')].map(t => `  • ${t.textContent.trim()}`).join('\n');
    text += `${num}\n${focus}\n${tasks}\n\n`;
  });
  const blob = new Blob([text], { type: 'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `sivarr-studyplan-${subject.replace(/\s+/g,'-').toLowerCase()}.txt`;
  a.click();
}

  // ═══════════════════════ CONTENT HUB ════════════════════════

const CH_KEY = () => `sivarr_ch_${S.sid || 'guest'}`;
let CH_ACTIVE_PLATFORM = null;
let CH_PERIOD = 7;

const CH_PLATFORMS = {
  instagram: { name: 'Instagram', icon: '📸', color: '#e1306c' },
  tiktok:    { name: 'TikTok',    icon: '🎵', color: '#69c9d0' },
  youtube:   { name: 'YouTube',   icon: '▶️', color: '#ff0000' },
  twitter:   { name: 'X/Twitter', icon: '𝕏',  color: '#1da1f2' },
  linkedin:  { name: 'LinkedIn',  icon: '💼', color: '#0077b5' },
};

const CH_METRICS_DEF = [
  { key:'followers',     label:'Followers',       color:'#4f6ef7', icon:'👥' },
  { key:'followers_new', label:'New Followers',   color:'#22c55e', icon:'📈' },
  { key:'followers_lost',label:'Lost Followers',  color:'#ef4444', icon:'📉' },
  { key:'views',         label:'Views',           color:'#a78bfa', icon:'👁' },
  { key:'reach',         label:'Reach',           color:'#f59e0b', icon:'📡' },
  { key:'likes',         label:'Likes',           color:'#f472b6', icon:'❤️' },
  { key:'comments',      label:'Comments',        color:'#34d399', icon:'💬' },
  { key:'shares',        label:'Shares',          color:'#60a5fa', icon:'🔁' },
  { key:'saves',         label:'Saves',           color:'#fb923c', icon:'🔖' },
];

function chLoadData() {
  try { return JSON.parse(localStorage.getItem(CH_KEY()) || '{}'); }
  catch { return {}; }
}
function chSaveData(d) { localStorage.setItem(CH_KEY(), JSON.stringify(d)); }

function chInit() {
  const data = chLoadData();
  const connected = Object.keys(data.platforms || {});
  if (connected.length === 0) {
    $('ch-connect-screen').style.display = 'block';
    $('ch-dashboard').style.display = 'none';
  } else {
    $('ch-connect-screen').style.display = 'none';
    $('ch-dashboard').style.display = 'block';
    CH_ACTIVE_PLATFORM = CH_ACTIVE_PLATFORM || connected[0];
    chRenderTabs(connected);
    chRenderDashboard();
  }
  // Sync badge states
  connected.forEach(p => {
    const badge = $(`ch-badge-${p}`);
    if (badge) { badge.textContent = 'Connected ✓'; badge.closest('button')?.classList.add('connected'); }
  });
}

function chShowConnect() {
  $('ch-connect-screen').style.display = 'block';
  $('ch-dashboard').style.display = 'none';
}

function chConnect(platform) {
  const data = chLoadData();
  data.platforms = data.platforms || {};

  // Generate realistic mock data for demo
  const base = { instagram:12400, tiktok:8200, youtube:3100, twitter:5600, linkedin:2800 };
  const b = base[platform] || 5000;
  const days = 30;
  const mkSeries = (base, variance) => Array.from({length:days}, (_,i) =>
    Math.max(0, Math.round(base + (Math.random()-0.48) * variance + i * (Math.random()*2-0.5)))
  );

  data.platforms[platform] = {
    connected_at: new Date().toISOString(),
    metrics: {
      followers:      mkSeries(b, b*0.02),
      followers_new:  mkSeries(Math.round(b*0.003), 20),
      followers_lost: mkSeries(Math.round(b*0.001), 8),
      views:          mkSeries(b*4, b*0.8),
      reach:          mkSeries(b*2.5, b*0.5),
      likes:          mkSeries(b*0.08, b*0.02),
      comments:       mkSeries(Math.round(b*0.012), 15),
      shares:         mkSeries(Math.round(b*0.008), 10),
      saves:          mkSeries(Math.round(b*0.015), 12),
    }
  };
  chSaveData(data);

  const badge = $(`ch-badge-${platform}`);
  if (badge) { badge.textContent = 'Connected ✓'; badge.closest('button')?.classList.add('connected'); }
  toast(`${CH_PLATFORMS[platform]?.name} connected! 🎉`);

  CH_ACTIVE_PLATFORM = platform;
  setTimeout(() => chInit(), 400);
}

function chDisconnect() {
  if (!CH_ACTIVE_PLATFORM) return;
  const data = chLoadData();
  delete (data.platforms || {})[CH_ACTIVE_PLATFORM];
  chSaveData(data);
  const badge = $(`ch-badge-${CH_ACTIVE_PLATFORM}`);
  if (badge) { badge.textContent = 'Connect'; badge.closest('button')?.classList.remove('connected'); }
  toast(`Disconnected.`);
  CH_ACTIVE_PLATFORM = null;
  chInit();
}

function chSetPeriod(days, btn) {
  CH_PERIOD = days;
  document.querySelectorAll('#ch-period-tabs .ch-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  chRenderDashboard();
}

function chRenderTabs(connected) {
  const tabs = $('ch-platform-tabs');
  if (!tabs) return;
  tabs.innerHTML = connected.map(p => {
    const pl = CH_PLATFORMS[p] || { name: p, icon: '📊' };
    return `<button class="ch-tab ${p === CH_ACTIVE_PLATFORM ? 'active' : ''}"
      onclick="chSwitchPlatform('${p}',this)">${pl.icon} ${pl.name}</button>`;
  }).join('');
}

function chSwitchPlatform(p, btn) {
  CH_ACTIVE_PLATFORM = p;
  document.querySelectorAll('#ch-platform-tabs .ch-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  chRenderDashboard();
}

function chRenderDashboard() {
  const data = chLoadData();
  const pdata = data.platforms?.[CH_ACTIVE_PLATFORM];
  if (!pdata) return;

  const metrics = pdata.metrics;
  const period  = CH_PERIOD;
  const grid    = $('ch-metrics-grid');
  if (!grid) return;

  // Slice to period
  const slice = obj => Object.fromEntries(
    Object.entries(obj).map(([k,v]) => [k, v.slice(-period)])
  );
  const m = slice(metrics);

  // Compute stats: current = last value, prev = value period ago
  const stat = (arr) => {
    const cur  = arr[arr.length - 1] || 0;
    const prev = arr[0] || 0;
    const delta = cur - prev;
    const pct   = prev ? ((delta / prev) * 100).toFixed(1) : '0.0';
    return { cur, delta, pct };
  };

  const fmt = n => n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'K' : n;

  // Render metric cards
  grid.innerHTML = CH_METRICS_DEF.map(def => {
    const s    = stat(m[def.key] || [0]);
    const up   = s.delta >= 0;
    const arrow = up ? '▲' : '▼';
    const cls   = s.delta === 0 ? 'flat' : up ? 'up' : 'down';
    return `
      <div class="ch-metric-card" style="--ch-color:${def.color}">
        <div class="ch-metric-label">${def.icon} ${def.label}</div>
        <div class="ch-metric-val">${fmt(s.cur)}</div>
        <div class="ch-metric-delta ${cls}">${arrow} ${fmt(Math.abs(s.delta))} (${s.pct}%)</div>
      </div>`;
  }).join('');

  // Engagement rate
  const totalFollowers = (m.followers || [0]).at(-1) || 1;
  const totalInteractions = ((m.likes||[0]).at(-1)||0) + ((m.comments||[0]).at(-1)||0) + ((m.shares||[0]).at(-1)||0);
  const engRate = ((totalInteractions / totalFollowers) * 100).toFixed(2);
  const engEl = $('ch-eng-val'); if (engEl) engEl.textContent = engRate + '%';
  const engFill = $('ch-eng-fill'); if (engFill) engFill.style.width = Math.min(parseFloat(engRate)*10, 100) + '%';

  // Sparkline for views
  chDrawSparkline(m.views || [], '#4f6ef7');
  const lbl = $('ch-chart-label'); if (lbl) lbl.textContent = '👁 Views — Last ' + period + ' days';

  // AI Insight
  chGenerateInsight(m, engRate, CH_ACTIVE_PLATFORM);
}

function chDrawSparkline(data, color) {
  const svg = $('ch-chart-svg');
  if (!svg || !data.length) return;
  const W = 300, H = 60, pad = 4;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad*2);
    const y = H - pad - ((v - min) / range) * (H - pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaClose = `${W-pad},${H} ${pad},${H}`;
  svg.innerHTML = `
    <defs>
      <linearGradient id="ch-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${pts.join(' ')} ${areaClose}" fill="url(#ch-grad)"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map((p, i) => i === pts.length-1 ?
      `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="${color}"/>` : ''
    ).join('')}`;
}

function chGenerateInsight(m, engRate, platform) {
  const insight = $('ch-insight');
  const txt     = $('ch-insight-text');
  if (!insight || !txt) return;

  const pName    = CH_PLATFORMS[platform]?.name || platform;
  const eng      = parseFloat(engRate);
  const views    = (m.views || [0]).at(-1) || 0;
  const newFolls = (m.followers_new || [0]).reduce((a,b) => a+b, 0);
  const comments = (m.comments || [0]).reduce((a,b) => a+b, 0);

  let msg = '';
  if (eng > 5)       msg = `🔥 Your ${pName} engagement rate of ${engRate}% is above average — your audience is highly active. Keep posting consistently to maintain momentum.`;
  else if (eng > 3)  msg = `✅ Solid engagement at ${engRate}% on ${pName}. Focus on replies and saves to push past 5% — that's when the algorithm rewards you most.`;
  else if (eng < 1)  msg = `📉 Your engagement on ${pName} is below 1%. Try shorter content, stronger CTAs, and posting at peak hours (6–9pm local time).`;
  else               msg = `📊 Your ${pName} stats look steady. You gained ${newFolls.toLocaleString()} new followers this period. ${comments > 50 ? 'Great comment engagement!' : 'Try ending posts with a question to boost comments.'}`;

  txt.textContent = msg;
  insight.style.display = 'block';
}

// ═══════════════════════ CREATE NEW ═════════════════════════

function cnOpen() {
  cnTab('create');
  $('cn-modal-bg').classList.add('open');
}
function cnClose(e) {
  if (e.target === $('cn-modal-bg')) $('cn-modal-bg').classList.remove('open');
}
function cnAction(type) {
  $('cn-modal-bg').classList.remove('open');
  setTimeout(() => {
    if (type === 'note') {
      nav('notes', null);
      setTimeout(() => {
        const ta = $('new-note-text'); if (ta) { ta.focus(); ta.scrollIntoView({behavior:'smooth'}); }
      }, 300);
    } else if (type === 'task') {
      nav('flux', null);
      setTimeout(() => {
        const btn = document.querySelector('.sh-add-btn, [onclick*="showAddTask"], [onclick*="openTaskModal"]');
        if (btn) btn.click();
      }, 300);
    } else if (type === 'studyplan') {
      snavSelect('studyplan', 'planner', null);
      setTimeout(() => {
        const el = $('sp-subject'); if (el) el.focus();
      }, 350);
    } else if (type === 'quiz') {
      nav('quiz', null);
      setTimeout(() => {
        const ti = $('quiz-topic-input'); if (ti) ti.focus();
      }, 300);
    } else if (type === 'studydeck') {
      nav('lab', null);
      setTimeout(() => {
        const el = $('lab-file-input-p'); if (el) el.click();
      }, 350);
    } else if (type === 'ask') {
      nav('chat', null);
      setTimeout(() => {
        const ci = $('ci'); if (ci) ci.focus();
      }, 300);
    }
  }, 250);
}

// ═══════════════════════ SETTINGS ═════════════════════════

const ST_KEY = () => `sivarr_st_${S.sid || 'guest'}`;

function stLoad() {
  return JSON.parse(localStorage.getItem(ST_KEY()) || '{}');
}
function stSave(data) {
  localStorage.setItem(ST_KEY(), JSON.stringify(data));
}

const ST_SECTIONS = ['profile','appearance','notifications','security','plan','data'];

function stToggleSection(id) {
  const target = $(`st-sec-${id}`);
  if (!target) return;
  const isOpen = target.classList.contains('open');
  // Close all
  ST_SECTIONS.forEach(s => {
    const el = $(`st-sec-${s}`);
    if (el) el.classList.remove('open');
  });
  // Toggle clicked — open if it was closed
  if (!isOpen) target.classList.add('open');
}

function stInit() {
  // Populate profile fields
  const st = stLoad();
  const nameEl   = $('st-name-input');
  const emailEl  = $('st-email-input');
  const phoneEl  = $('st-phone-input');
  const avatarL  = $('st-avatar-letter');
  const nameDisp = $('st-name-display');
  const matDisp  = $('st-matric-display');

  if (nameEl)   nameEl.value   = S.name || '';
  if (emailEl)  emailEl.value  = st.email || '';
  if (phoneEl)  phoneEl.value  = st.phone || '';
  if (avatarL)  avatarL.textContent = S.name ? S.name[0].toUpperCase() : '?';
  if (nameDisp) nameDisp.textContent = S.name || '';
  if (matDisp)  matDisp.textContent  = S.email || '';

  // Load profile pic into settings avatar
  const saved = localStorage.getItem(`sivarr_pfp_${S.sid}`);
  if (saved) {
    const av = $('st-avatar');
    if (av) { av.style.backgroundImage = `url(${saved})`; av.style.backgroundSize = 'cover'; $('st-avatar-letter').style.display = 'none'; }
  }

  // Theme toggle
  const themeToggle = $('st-theme-toggle');
  if (themeToggle) {
    const isDark = !document.body.classList.contains('light');
    if (isDark) themeToggle.classList.add('on');
    else themeToggle.classList.remove('on');
  }

  // Notification toggles
  ['ann','streak','quiz'].forEach(key => {
    const el = $(`st-notif-${key}`);
    if (el) {
      const val = localStorage.getItem(`sivarr_notif_${key}`);
      if (val === 'off') el.classList.remove('on');
      else el.classList.add('on');
    }
  });

  // Accent colour — restore saved
  const savedAccent = localStorage.getItem('sivarr_accent');
  if (savedAccent) {
    document.querySelectorAll('.st-accent-dot').forEach(d => {
      d.classList.toggle('sel', d.style.background === savedAccent);
    });
  }

  // Usage bars
  stUpdateUsage();
}

function stUpdateUsage() {
  const today = new Date().toISOString().split('T')[0];
  const hist  = JSON.parse(localStorage.getItem(`sivarr_usage_${today}`) || '{"chat":0,"quiz":0}');
  const chatUsed = hist.chat || 0;
  const quizUsed = hist.quiz || 0;
  const chatMax  = S.plan === 'pro' ? 999 : 20;
  const quizMax  = S.plan === 'pro' ? 999 : 5;

  const cu = $('st-usage-chat');    if (cu) cu.textContent = `${chatUsed} / ${chatMax}`;
  const cb = $('st-usage-chat-bar');if (cb) cb.style.width = Math.min((chatUsed/chatMax)*100,100) + '%';
  const qu = $('st-usage-quiz');    if (qu) qu.textContent = `${quizUsed} / ${quizMax}`;
  const qb = $('st-usage-quiz-bar');if (qb) qb.style.width = Math.min((quizUsed/quizMax)*100,100) + '%';

  const badge = $('st-plan-badge');
  if (badge) {
    badge.textContent = S.plan === 'pro' ? '⚡ Pro' : '✦ Free';
    badge.className   = `st-plan-badge ${S.plan === 'pro' ? 'st-plan-pro' : 'st-plan-free'}`;
  }
}

function stSaveProfile() {
  const name  = $('st-name-input')?.value.trim();
  const email = $('st-email-input')?.value.trim();
  const phone = $('st-phone-input')?.value.trim();

  if (!name || name.length < 2) { toast('Name must be at least 2 characters.'); return; }

  const st = stLoad();
  st.email = email;
  st.phone = phone;
  stSave(st);

  S.name = name;
  const nameDisp = $('st-name-display'); if (nameDisp) nameDisp.textContent = name;
  const avatarL  = $('st-avatar-letter'); if (avatarL) avatarL.textContent = name[0].toUpperCase();
  const tbAv   = $('tb-av');   if (tbAv)   tbAv.textContent   = name[0].toUpperCase();
  const tbName = $('tb-name'); if (tbName) tbName.textContent = name;

  toast('Profile saved ✓');
}

function stToggleTheme(btn) {
  btn.classList.toggle('on');
  toggleThemeFromMenu();
}

function stToggleNotif(btn, key) {
  btn.classList.toggle('on');
  localStorage.setItem(`sivarr_notif_${key}`, btn.classList.contains('on') ? 'on' : 'off');
  toast(`${btn.classList.contains('on') ? 'Enabled' : 'Disabled'} notifications`);
}

function stSetAccent(color, color2, el) {
  document.querySelectorAll('.st-accent-dot').forEach(d => d.classList.remove('sel'));
  el.classList.add('sel');
  document.documentElement.style.setProperty('--accent',  color);
  document.documentElement.style.setProperty('--accent2', color2);
  localStorage.setItem('sivarr_accent',  color);
  localStorage.setItem('sivarr_accent2', color2);
  toast('Accent colour updated ✓');
}

function stChangePassword() {
  const pw  = $('st-pw-input')?.value;
  const pw2 = $('st-pw2-input')?.value;
  if (!pw || pw.length < 6) { toast('Password must be at least 6 characters.'); return; }
  if (pw !== pw2)            { toast('Passwords do not match.'); return; }
  toast('Password update coming soon — backend integration needed. 🔧');
}

async function stLogoutAll() {
  if (!await siModal.confirm('You will be signed out on all devices.', { title:'Sign Out Everywhere', confirmLabel:'Sign Out', danger:true })) return;
  clearSession();
  location.reload();
}

function stExportData() {
  const data = {
    name:    S.name,
    email:   S.email,
    stats:   S.stats,
    topics:  S.topics,
    exported: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `sivarr-data-${S.name?.split(' ')[0]?.toLowerCase() || 'export'}.json`;
  a.click();
  toast('Data exported ✓');
}

async function stClearChat() {
  if (!await siModal.confirm('All chat history will be permanently deleted.', { title:'Clear Chat History', confirmLabel:'Clear', danger:true })) return;
  try {
    await fetch('/api/clear-history', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({sid: S.sid})
    });
  } catch(e) {}
  _contextSent = false; // re-inject context on next message after a clear
  toast('Chat history cleared ✓');
}

async function stClearWrong() {
  if (!await siModal.confirm('Your revision list will be cleared.', { title:'Clear Revision List', confirmLabel:'Clear', danger:true })) return;
  try { await API('/api/wrong/clear', {sid: S.sid, idx: 'all'}); } catch(e) {}
  toast('Revision list cleared ✓');
}

async function stResetProgress() {
  if (!await siModal.confirm('This will permanently delete all stats, topics, and quiz history. This cannot be undone.', { title:'⚠️ Reset All Progress', confirmLabel:'Reset Everything', danger:true })) return;
  try {
    await fetch('/api/reset-progress', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({sid: S.sid})
    });
    toast('Progress reset. Reloading...');
    setTimeout(() => { clearSession(); location.reload(); }, 1500);
  } catch(e) { toast('Reset failed — try again.'); }
}

// Restore accent on load
(function() {
  const a  = localStorage.getItem('sivarr_accent');
  const a2 = localStorage.getItem('sivarr_accent2');
  if (a)  document.documentElement.style.setProperty('--accent',  a);
  if (a2) document.documentElement.style.setProperty('--accent2', a2);
})();

  // ═══════════════════ LEARNING HUB ══════════════════════════

const LH_COURSES = [
  // STEM
  { id:'lh01', title:'Calculus Fundamentals', author:'Dr. Adebayo', emoji:'📐', color:'#4f6ef7', cat:'stem', level:'Beginner', rating:4.8, students:3241, lessons:24, desc:'Master differentiation, integration and applications.' },
  { id:'lh02', title:'Statistics & Probability', author:'Prof. Okonkwo', emoji:'📊', color:'#7c3aed', cat:'stem', level:'Intermediate', rating:4.7, students:2180, lessons:20, desc:'Data analysis and probability from first principles.' },
  { id:'lh03', title:'Physics: Mechanics', author:'Dr. Emeka', emoji:'⚙️', color:'#06b6d4', cat:'stem', level:'Intermediate', rating:4.6, students:1890, lessons:18, desc:'Forces, motion, energy and waves.' },
  { id:'lh04', title:'Organic Chemistry', author:'Dr. Nwosu', emoji:'🧪', color:'#22c55e', cat:'stem', level:'Advanced', rating:4.5, students:1420, lessons:22, desc:'Reactions, mechanisms and lab techniques.' },
  // Tech
  { id:'lh05', title:'Python for Beginners', author:'Chinedu Dev', emoji:'🐍', color:'#f59e0b', cat:'tech', level:'Beginner', rating:4.9, students:5210, lessons:30, desc:'Learn programming from zero with Python.' },
  { id:'lh06', title:'Web Development Bootcamp', author:'Sarah Afolabi', emoji:'💻', color:'#ef4444', cat:'tech', level:'Beginner', rating:4.8, students:4320, lessons:36, desc:'HTML, CSS, JavaScript and React fundamentals.' },
  { id:'lh07', title:'Data Science Essentials', author:'Dr. Mensah', emoji:'🤖', color:'#8b5cf6', cat:'tech', level:'Intermediate', rating:4.7, students:2890, lessons:28, desc:'Data wrangling, ML and visualization.' },
  { id:'lh08', title:'Cybersecurity Basics', author:'Tobi Secure', emoji:'🔐', color:'#64748b', cat:'tech', level:'Beginner', rating:4.6, students:1760, lessons:16, desc:'Stay safe online and understand threats.' },
  // Business
  { id:'lh09', title:'Entrepreneurship 101', author:'Amara Chukwu', emoji:'🚀', color:'#f472b6', cat:'business', level:'Beginner', rating:4.8, students:3890, lessons:20, desc:'From idea to product to paying customers.' },
  { id:'lh10', title:'Financial Accounting', author:'Prof. Adeleke', emoji:'💰', color:'#22c55e', cat:'business', level:'Intermediate', rating:4.6, students:2340, lessons:24, desc:'Balance sheets, P&L and financial statements.' },
  { id:'lh11', title:'Marketing Strategy', author:'Ngozi Brands', emoji:'📣', color:'#f59e0b', cat:'business', level:'Beginner', rating:4.7, students:2890, lessons:18, desc:'Digital, content and growth marketing.' },
  // Design
  { id:'lh12', title:'UI/UX Design Fundamentals', author:'Temi Creates', emoji:'🎨', color:'#ec4899', cat:'design', level:'Beginner', rating:4.9, students:4120, lessons:22, desc:'Figma, wireframing, user research and prototyping.' },
  { id:'lh13', title:'Graphic Design Masterclass', author:'Kofi Art', emoji:'✏️', color:'#a78bfa', cat:'design', level:'Beginner', rating:4.7, students:3210, lessons:26, desc:'Typography, colour theory and branding.' },
  // Languages
  { id:'lh14', title:'French for Beginners', emoji:'🇫🇷', color:'#3b82f6', cat:'languages', author:'Marie Dupont', level:'Beginner', rating:4.6, students:1980, lessons:30, desc:'Speak French confidently in 30 lessons.' },
  { id:'lh15', title:'Yoruba Language & Culture', emoji:'🌍', color:'#22c55e', cat:'languages', author:'Baba Akin', level:'Beginner', rating:4.8, students:1240, lessons:20, desc:'Greetings, grammar and everyday conversation.' },
  // Arts
  { id:'lh16', title:'Creative Writing Workshop', emoji:'📝', color:'#f97316', cat:'arts', author:'Chinua Jr.', level:'Beginner', rating:4.7, students:2100, lessons:16, desc:'Fiction, essays and finding your voice.' },
];

let LH_CAT      = 'all';
let LH_ENROLLED = [];

async function lhInit() {
  try {
    const r = await fetch(`/api/learning-hub/enrolled?sid=${S.sid}`);
    const d = await r.json();
    LH_ENROLLED = d.enrolled || [];
  } catch(e) { LH_ENROLLED = JSON.parse(localStorage.getItem(`lh_enrolled_${S.sid}`) || '[]'); }
  lhRender();
}

function lhSetCat(cat, btn) {
  LH_CAT = cat;
  document.querySelectorAll('.lh-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  lhRender();
}

function lhFilter() {
  lhRender($('lh-search')?.value.trim().toLowerCase());
}

function lhRender(search = '') {
  const grid    = $('lh-grid'); if (!grid) return;
  const contSec = $('lh-continue-section');
  const contList= $('lh-continue-list');
  const label   = $('lh-section-label');
  const count   = $('lh-count');

  let courses = LH_CAT === 'all' ? LH_COURSES : LH_COURSES.filter(c => c.cat === LH_CAT);
  if (search) courses = courses.filter(c =>
    c.title.toLowerCase().includes(search) || c.author.toLowerCase().includes(search) || c.cat.includes(search)
  );

  // Continue learning — enrolled courses
  const enrolled = courses.filter(c => LH_ENROLLED.includes(c.id));
  if (enrolled.length && !search) {
    contSec.style.display = 'block';
    contList.innerHTML = enrolled.slice(0,2).map(c => {
      const prog = parseInt(localStorage.getItem(`lh_prog_${S.sid}_${c.id}`) || '0');
      return `
        <div class="lh-continue-card" onclick="lhOpenCourse('${c.id}')">
          <div class="lh-continue-icon" style="background:${c.color}22">${c.emoji}</div>
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font);font-size:.85rem;font-weight:700;margin-bottom:2px">${esc(c.title)}</div>
            <div style="font-size:.7rem;color:var(--muted);margin-bottom:5px">by ${esc(c.author)} · ${c.lessons} lessons</div>
            <div class="lh-continue-prog"><div class="lh-continue-fill" style="width:${prog}%"></div></div>
            <div style="font-size:.68rem;color:var(--muted);margin-top:3px">${prog}% complete</div>
          </div>
        </div>`;
    }).join('');
  } else { contSec.style.display = 'none'; }

  // Grid
  const notEnrolled = courses.filter(c => !LH_ENROLLED.includes(c.id));
  const display     = search ? courses : notEnrolled;
  if (label) label.textContent = search ? `Results for "${search}"` : LH_CAT === 'all' ? 'Recommended for You' : LH_CAT.charAt(0).toUpperCase()+LH_CAT.slice(1);
  if (count) count.textContent = `${display.length} course${display.length!==1?'s':''}`;

  if (!display.length) {
    grid.innerHTML = `<div style="grid-column:span 2;text-align:center;padding:2rem;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:.5rem">🔍</div>
      <div style="font-size:.85rem">No courses found.</div>
    </div>`; return;
  }

  const badgeCls = { Beginner:'lh-badge-beginner', Intermediate:'lh-badge-intermediate', Advanced:'lh-badge-advanced' };
  grid.innerHTML = display.map(c => `
    <div class="lh-course-card" onclick="lhOpenCourse('${c.id}')">
      <div class="lh-course-thumb" style="background:${c.color}18">
        ${c.emoji ? `<span style="font-size:2.5rem">${c.emoji}</span>` : ''}
        <span class="lh-course-badge ${badgeCls[c.level]||''}">${c.level}</span>
      </div>
      <div class="lh-course-body">
        <div class="lh-course-title">${esc(c.title)}</div>
        <div class="lh-course-author">by ${esc(c.author)}</div>
        <div class="lh-course-meta">
          <span class="lh-rating">★ ${c.rating} · ${(c.students/1000).toFixed(1)}k</span>
          ${LH_ENROLLED.includes(c.id) ? '<span class="lh-enrolled-badge">✓ Enrolled</span>' : `<span style="font-size:.7rem;color:var(--muted)">${c.lessons} lessons</span>`}
        </div>
      </div>
    </div>`).join('');
}

function lhOpenCourse(id) {
  const c = LH_COURSES.find(x=>x.id===id); if (!c) return;
  const enrolled = LH_ENROLLED.includes(id);
  const prog     = parseInt(localStorage.getItem(`lh_prog_${S.sid}_${id}`) || '0');

  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(6px);animation:fadeUp .2s ease';
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:20px 20px 0 0;width:100%;max-width:520px;padding:1.5rem 1.25rem 2.5rem;max-height:85vh;overflow-y:auto">
      <div style="width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 1.25rem"></div>
      <div style="display:flex;gap:14px;align-items:flex-start;margin-bottom:1rem">
        <div style="width:56px;height:56px;border-radius:12px;background:${c.color}22;display:flex;align-items:center;justify-content:center;font-size:1.75rem;flex-shrink:0">${c.emoji}</div>
        <div>
          <div style="font-family:var(--font);font-size:1rem;font-weight:800;letter-spacing:-.02em">${esc(c.title)}</div>
          <div style="font-size:.75rem;color:var(--muted);margin-top:2px">by ${esc(c.author)}</div>
          <div style="display:flex;gap:8px;margin-top:5px;flex-wrap:wrap">
            <span style="font-size:.68rem;color:var(--yellow);font-weight:700">★ ${c.rating}</span>
            <span style="font-size:.68rem;color:var(--muted)">${c.lessons} lessons</span>
            <span style="font-size:.68rem;color:var(--muted)">${c.students.toLocaleString()} students</span>
          </div>
        </div>
      </div>
      <p style="font-size:.82rem;color:var(--muted);line-height:1.6;margin-bottom:1rem">${esc(c.desc)}</p>
      ${enrolled ? `
        <div style="margin-bottom:1rem">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:.75rem;color:var(--muted)">Your progress</span>
            <span style="font-size:.75rem;font-weight:700;color:var(--accent)">${prog}%</span>
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${prog}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px"></div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="lhUpdateProgress('${id}');this.closest('[style*=fixed]').remove()" style="flex:1;padding:11px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;font-family:var(--font);font-size:.85rem;font-weight:700;cursor:pointer">
            📈 Update Progress
          </button>
          <button onclick="lhUnenroll('${id}');this.closest('[style*=fixed]').remove()" style="padding:11px 14px;border-radius:10px;background:none;border:1px solid var(--border);color:var(--muted);font-family:var(--font);font-size:.82rem;font-weight:700;cursor:pointer">
            Leave
          </button>
        </div>` : `
        <button onclick="lhEnroll('${id}');this.closest('[style*=fixed]').remove()" style="width:100%;padding:12px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;font-family:var(--font);font-size:.88rem;font-weight:700;cursor:pointer">
          ✦ Enroll — Free
        </button>`}
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}

async function lhEnroll(id) {
  LH_ENROLLED.push(id);
  localStorage.setItem(`lh_enrolled_${S.sid}`, JSON.stringify(LH_ENROLLED));
  try { await API('/api/learning-hub/enroll', {sid:S.sid, course_id:id}); } catch(e) {}
  lhRender();
  toast('Enrolled! 🎉 Start learning');
}

function lhUnenroll(id) {
  LH_ENROLLED = LH_ENROLLED.filter(x=>x!==id);
  localStorage.setItem(`lh_enrolled_${S.sid}`, JSON.stringify(LH_ENROLLED));
  lhRender();
  toast('Unenrolled');
}

async function lhUpdateProgress(id) {
  const cur = localStorage.getItem(`lh_prog_${S.sid}_${id}`) || '0';
  const val = await siModal.input('Update Progress', '0 – 100', cur, { type:'number', confirmLabel:'Update' });
  if (val === null) return;
  const pct = Math.min(Math.max(parseInt(val)||0, 0), 100);
  localStorage.setItem(`lh_prog_${S.sid}_${id}`, pct);
  lhRender();
  if (pct >= 100) toast('Course completed! 🏆');
  else toast(`Progress updated to ${pct}% ✓`);
}

// ═══════════════════════ VOICE INPUT ════════════════════════

let VOICE_ACTIVE = false;
let VOICE_REC    = null;

function voiceInit() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { toast('Voice input not supported on this browser.'); return null; }
  const rec        = new SpeechRecognition();
  rec.continuous   = false;
  rec.interimResults= true;
  rec.lang         = 'en-NG';
  return rec;
}

function toggleVoice() {
  if (VOICE_ACTIVE) {
    VOICE_REC?.stop();
    VOICE_ACTIVE = false;
    updateVoiceBtn(false);
    return;
  }
  VOICE_REC = voiceInit();
  if (!VOICE_REC) return;
  VOICE_ACTIVE = true;
  updateVoiceBtn(true);
  toast('Listening... 🎤');

  VOICE_REC.onresult = (e) => {
    const transcript = Array.from(e.results).map(r=>r[0].transcript).join('');
    const ci = $('ci'); if (ci) ci.value = transcript;
  };
  VOICE_REC.onend = () => {
    VOICE_ACTIVE = false;
    updateVoiceBtn(false);
    const ci = $('ci');
    if (ci && ci.value.trim()) {
      toast('Got it — sending... ✓');
      setTimeout(() => send(), 500);
    }
  };
  VOICE_REC.onerror = (e) => {
    VOICE_ACTIVE = false;
    updateVoiceBtn(false);
    toast(e.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice error — try again.');
  };
  VOICE_REC.start();
}

function updateVoiceBtn(active) {
  const btn = $('voice-btn');
  if (!btn) return;
  btn.textContent = active ? '🔴' : '🎤';
  btn.style.color  = active ? 'var(--red)' : 'var(--muted)';
  btn.style.borderColor = active ? 'var(--red)' : 'var(--border)';
  if (active) btn.style.animation = 'pulse 1s infinite';
  else btn.style.animation = '';
}

// ═════════════════════ STUDY GROUPS ════════════════════════

let SG_ACTIVE   = null;
let SG_INTERVAL = null;

async function sgInit() {
  await sgLoadRooms();
}

async function sgLoadRooms() {
  try {
    const r = await fetch(`/api/group/list?sid=${S.sid}`);
    const d = await r.json();
    sgRenderRooms(d.groups || []);
  } catch(e) { sgRenderRooms([]); }
}

function sgRenderRooms(groups) {
  const el = $('sg-rooms-list'); if (!el) return;
  if (!groups.length) {
    el.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:.5rem">👥</div>
      <div style="font-size:.85rem">No groups yet.<br>Create or join one to start studying together.</div>
    </div>`; return;
  }
  el.innerHTML = groups.map(g => `
    <div class="sg-room" onclick="sgOpenChat('${g.id}','${esc(g.name)}')">
      <div class="sg-room-av">${g.name[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div class="sg-room-name">${esc(g.name)}</div>
        <div class="sg-room-meta">${g.members?.length||1} member${(g.members?.length||1)!==1?'s':''} · Tap to open</div>
      </div>
      <div style="font-size:.7rem;color:var(--muted)">→</div>
    </div>`).join('');
}

function sgShowCreate() {
  $('sg-create-form').style.display = $('sg-create-form').style.display==='none' ? 'block' : 'none';
  $('sg-join-form').style.display   = 'none';
  $('sg-name-input')?.focus();
}
function sgShowJoin() {
  $('sg-join-form').style.display   = $('sg-join-form').style.display==='none' ? 'block' : 'none';
  $('sg-create-form').style.display = 'none';
  $('sg-join-input')?.focus();
}

async function sgCreate() {
  const name = $('sg-name-input')?.value.trim();
  if (!name) { toast('Enter a group name.'); return; }
  try {
    await API('/api/group/create', {sid:S.sid, name});
    $('sg-create-form').style.display = 'none';
    $('sg-name-input').value = '';
    toast(`Group "${name}" created! Share your ID with friends.`);
    sgLoadRooms();
  } catch(e) { toast('Could not create group.'); }
}

async function sgJoin() {
  const gid = $('sg-join-input')?.value.trim();
  if (!gid) { toast('Paste a group ID.'); return; }
  try {
    await API('/api/group/join', {sid:S.sid, group_id:gid});
    $('sg-join-form').style.display = 'none';
    $('sg-join-input').value = '';
    toast('Joined group! 🎉');
    sgLoadRooms();
  } catch(e) { toast('Invalid group ID or already a member.'); }
}

function sgOpenChat(gid, gname) {
  SG_ACTIVE = {id:gid, name:gname};
  $('sg-list-view').style.display = 'none';
  $('sg-chat-view').style.display = 'flex';
  const av = $('sg-chat-av'); if (av) av.textContent = gname[0].toUpperCase();
  const nm = $('sg-chat-name'); if (nm) nm.textContent = gname;
  const id = $('sg-chat-id'); if (id) id.textContent = `ID: ${gid}`;
  sgLoadMessages();
  clearInterval(SG_INTERVAL);
  SG_INTERVAL = setInterval(sgLoadMessages, 4000);
}

function sgBackToList() {
  clearInterval(SG_INTERVAL);
  SG_ACTIVE = null;
  $('sg-chat-view').style.display = 'none';
  $('sg-list-view').style.display = 'block';
  sgLoadRooms();
}

function sgCopyId() {
  if (!SG_ACTIVE) return;
  navigator.clipboard.writeText(SG_ACTIVE.id).then(()=>toast('Group ID copied ✓'));
}

async function sgLoadMessages() {
  if (!SG_ACTIVE) return;
  try {
    const r = await fetch(`/api/group/messages?group_id=${SG_ACTIVE.id}&sid=${S.sid}`);
    const d = await r.json();
    sgRenderMessages(d.messages || []);
  } catch(e) {}
}

function sgRenderMessages(msgs) {
  const el = $('sg-messages'); if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 60;
  el.innerHTML = msgs.length
    ? msgs.map(m => {
        const mine = m.sender === S.sid || m.sender_name === S.name;
        return `
          <div class="sg-msg ${mine?'mine':'theirs'}">
            ${!mine ? `<div class="sg-sender">${esc(m.sender_name||'Student')}</div>` : ''}
            <div class="sg-bubble">${esc(m.text||'')}</div>
          </div>`;
      }).join('')
    : `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.82rem">No messages yet. Say hello! 👋</div>`;
  if (atBottom) el.scrollTop = el.scrollHeight;
}

async function sgSend() {
  if (!SG_ACTIVE) return;
  const input = $('sg-msg-input');
  const text  = input?.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await API('/api/group/message', {group_id:SG_ACTIVE.id, sid:S.sid, text, sender_name:S.name});
    sgLoadMessages();
  } catch(e) { toast('Send failed — try again.'); }
}

// ═══════════════════════ POMODORO ══════════════════════════

const POM_MODES = { focus:{label:'Focus',mins:25}, short:{label:'Short Break',mins:5}, long:{label:'Long Break',mins:15} };
const POM_KEY   = () => `sivarr_pom_${S.sid||'guest'}`;
let POM_MODE    = 'focus';
let POM_SECS    = 25*60;
let POM_TOTAL   = 25*60;
let POM_RUNNING = false;
let POM_INTERVAL= null;
let POM_SESSION = 0;

function pomStats() {
  try { return JSON.parse(localStorage.getItem(POM_KEY()) || '{"today":0,"total":0,"mins":0,"date":""}'); }
  catch { return {today:0,total:0,mins:0,date:''}; }
}
function pomSaveStats(s) { localStorage.setItem(POM_KEY(), JSON.stringify(s)); }

function pomSetMode(mode, btn) {
  POM_MODE    = mode;
  POM_RUNNING = false;
  clearInterval(POM_INTERVAL);
  POM_SECS  = POM_MODES[mode].mins * 60;
  POM_TOTAL = POM_SECS;
  pomRender();
  document.querySelectorAll('.pom-mode-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const sl = $('pom-sublabel'); if (sl) sl.textContent = POM_MODES[mode].label;
  const sb = $('pom-start-btn'); if (sb) sb.textContent = '▶ Start';
}

function pomToggle() {
  if (POM_RUNNING) {
    POM_RUNNING = false;
    clearInterval(POM_INTERVAL);
    const sb = $('pom-start-btn'); if (sb) sb.textContent = '▶ Resume';
  } else {
    POM_RUNNING = true;
    const sb = $('pom-start-btn'); if (sb) sb.textContent = '⏸ Pause';
    POM_INTERVAL = setInterval(() => {
      POM_SECS--;
      pomRender();
      if (POM_SECS <= 0) {
        clearInterval(POM_INTERVAL);
        POM_RUNNING = false;
        pomComplete();
      }
    }, 1000);
  }
}

function pomComplete() {
  const sb = $('pom-start-btn'); if (sb) sb.textContent = '▶ Start';
  if (POM_MODE === 'focus') {
    POM_SESSION++;
    for (let i=0;i<4;i++) {
      const dot = $(`pd${i}`);
      if (dot) dot.classList.toggle('done', i < POM_SESSION % 4);
    }
    const st  = pomStats();
    const today = new Date().toISOString().split('T')[0];
    if (st.date !== today) { st.today = 0; st.date = today; }
    st.today++;
    st.total++;
    st.mins += POM_MODES.focus.mins;
    pomSaveStats(st);
    pomUpdateStatDisplay();
    toast(`Focus session complete! 🎉 ${POM_SESSION % 4 === 0 ? 'Time for a long break.' : 'Great work!'}`);
    if (POM_SESSION % 4 === 0) pomSetMode('long', null);
    else pomSetMode('short', null);
  } else {
    toast('Break over — time to focus! 💪');
    pomSetMode('focus', null);
    document.querySelectorAll('.pom-mode-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  }
}

function pomReset() {
  POM_RUNNING = false;
  clearInterval(POM_INTERVAL);
  POM_SECS  = POM_TOTAL;
  pomRender();
  const sb = $('pom-start-btn'); if (sb) sb.textContent = '▶ Start';
}

function pomSkip() {
  clearInterval(POM_INTERVAL);
  POM_RUNNING = false;
  pomComplete();
}

function pomRender() {
  const mins = Math.floor(POM_SECS/60).toString().padStart(2,'0');
  const secs = (POM_SECS%60).toString().padStart(2,'0');
  const tm   = $('pom-time'); if (tm) tm.textContent = `${mins}:${secs}`;
  const circ = $('pom-ring-fill');
  if (circ) {
    const pct    = POM_SECS / POM_TOTAL;
    const circum = 2 * Math.PI * 88;
    circ.style.strokeDashoffset = circum * (1 - pct);
    circ.style.strokeDasharray  = circum;
    circ.style.stroke = POM_MODE === 'focus' ? 'url(#pomGrad)' : POM_MODE === 'short' ? '#22c55e' : '#f59e0b';
  }
}

function pomUpdateStatDisplay() {
  const st = pomStats();
  const today = new Date().toISOString().split('T')[0];
  const sd = $('pom-stat-today'); if (sd) sd.textContent = st.date===today ? st.today : 0;
  const st2= $('pom-stat-total'); if (st2) st2.textContent = st.total;
  const sm = $('pom-stat-mins');  if (sm) sm.textContent = st.mins;
}

function pomInit() {
  pomSetMode('focus', null);
  document.querySelectorAll('.pom-mode-btn').forEach((b,i)=>b.classList.toggle('active',i===0));
  pomUpdateStatDisplay();
  }
  
// ═══════════════════════════ DIFFICULTY ═════════════════════════

// ═══════════════ CREATE NEW TAB SWITCHER ════════════════════

function cnTab(name) {
  ['create','space','framework'].forEach(t => {
    const pane = $('cnpane-' + t);
    const btn  = $('cntab-' + t);
    if (pane) pane.style.display = t === name ? 'block' : 'none';
    if (btn) {
      btn.style.background = t === name
        ? 'linear-gradient(135deg,var(--accent),var(--accent2))'
        : 'none';
      btn.style.color = t === name ? '#fff' : 'var(--muted)';
    }
  });
  if (name === 'space') spReset();
}

// ═══════════════ SPACES SYSTEM ══════════════════════════════

const SPACES_KEY = () => `sivarr_spaces_${S.sid || 'guest'}`;
let _spType = null;

const SP_PERSONAL_TABS = [
  { key:'task-tracker', icon:'✅', label:'Task Tracker', route:'flux'        },
  { key:'document-hub', icon:'📄', label:'Document Hub', route:'documenthub' },
  { key:'meetings',     icon:'📅', label:'Meetings',      route:'studygroups' },
  { key:'content-hub',  icon:'🧠', label:'Content Hub',  route:'contenthub'  },
];
const SP_ORG_TABS = [
  { key:'goals',       icon:'🎯', label:'Goals',     route:'goals'       },
  { key:'team',        icon:'👥', label:'Team',       route:'studygroups' },
  { key:'knowledge',   icon:'📚', label:'Knowledge',  route:'notes'       },
  { key:'org-insights',icon:'📊', label:'Insights',   route:'progress'    },
];

function spGetAll() {
  try { return JSON.parse(localStorage.getItem(SPACES_KEY()) || '[]'); }
  catch { return []; }
}
function spSaveAll(spaces) {
  localStorage.setItem(SPACES_KEY(), JSON.stringify(spaces));
}

function spPickType(type) {
  _spType = type;
  $('sp-type-personal')?.classList.toggle('sel', type === 'personal');
  $('sp-type-org')?.classList.toggle('sel', type === 'org');
}

function spNext() {
  if (!_spType) { toast('Please choose a space type.'); return; }
  $('sp-s1').style.display = 'none';
  $('sp-s2').style.display = 'block';
  const label = $('sp-s2-label');
  if (label) label.textContent = _spType === 'personal' ? 'Personal space name:' : 'Organization space name:';
  const mw = $('sp-members-wrap');
  if (mw) mw.style.display = _spType === 'org' ? 'block' : 'none';
  const ni = $('sp-name'); if (ni) { ni.value = ''; ni.focus(); }
  const ei = $('sp-err');  if (ei) ei.textContent = '';
}

function spBack() {
  $('sp-s2').style.display = 'none';
  $('sp-s1').style.display = 'block';
}

function spReset() {
  _spType = null;
  $('sp-type-personal')?.classList.remove('sel');
  $('sp-type-org')?.classList.remove('sel');
  const s1 = $('sp-s1'); if (s1) s1.style.display = 'block';
  const s2 = $('sp-s2'); if (s2) s2.style.display = 'none';
  const ni = $('sp-name'); if (ni) ni.value = '';
  const mi = $('sp-members'); if (mi) mi.value = '';
  const ei = $('sp-err'); if (ei) ei.textContent = '';
}

function spCreate() {
  const name = $('sp-name')?.value.trim();
  if (!name) {
    const e = $('sp-err'); if (e) e.textContent = 'Please enter a space name.';
    return;
  }
  const members = _spType === 'org'
    ? ($('sp-members')?.value.trim().split(',').map(m => m.trim()).filter(Boolean) || [])
    : [];

  const spaces = spGetAll();
  spaces.push({
    id:      Date.now().toString(36),
    type:    _spType,
    name,
    members,
    created: new Date().toISOString(),
  });
  spSaveAll(spaces);

  $('cn-modal-bg').classList.remove('open');
  spReset();
  spRender();
  toast(`"${name}" created! 🎉`);
}

function spRender() {
  const c = $('dyn-spaces-container');
  if (!c) return;
  const spaces = spGetAll();

  if (!spaces.length) {
    c.innerHTML = '<div style="font-size:.72rem;color:var(--muted);padding:4px 8px;opacity:.6">No spaces yet</div>';
    return;
  }

  c.innerHTML = spaces.map(sp => {
    const tabs = sp.type === 'personal' ? SP_PERSONAL_TABS : SP_ORG_TABS;
    const icon = sp.type === 'personal' ? '👤' : '🏢';
    return `<div class="dsp-section" data-spid="${sp.id}">
      <div class="dsp-header" onclick="spToggle('${sp.id}')">
        <span class="dsp-icon">${icon}</span>
        <span class="dsp-name">${esc(sp.name)}</span>
        <button class="dsp-ellipsis" onclick="event.stopPropagation();spMenu('${sp.id}')" title="Options">···</button>
        <div class="dsp-menu" id="dspm-${sp.id}">
          <button class="dsp-menu-item" onclick="spRename('${sp.id}')">✏️ Rename</button>
          ${sp.type === 'org' ? `<button class="dsp-menu-item" onclick="spAddMember('${sp.id}')">👥 Add Member</button>` : ''}
          <button class="dsp-menu-item danger" onclick="spDelete('${sp.id}')">🗑 Delete</button>
        </div>
      </div>
      <div class="dsp-items open" id="dspi-${sp.id}">
        ${tabs.map(t => `<button class="snav-item" onclick="snavSelect('${t.key}','spaces',this)">
          <span class="snav-item-icon">${t.icon}</span> ${t.label}
        </button>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function spToggle(id) {
  const items = $('dspi-' + id);
  if (!items) return;
  items.classList.toggle('open');
}

function spMenu(id) {
  document.querySelectorAll('.dsp-menu').forEach(m => {
    if (m.id !== 'dspm-' + id) m.classList.remove('open');
  });
  $('dspm-' + id)?.classList.toggle('open');
}

async function spRename(id) {
  const spaces = spGetAll();
  const sp = spaces.find(s => s.id === id);
  if (!sp) return;
  const n = await siModal.input('Rename Space', sp.name, sp.name, { confirmLabel:'Rename' });
  if (!n?.trim()) return;
  sp.name = n.trim();
  spSaveAll(spaces);
  spRender();
  document.querySelectorAll('.dsp-menu').forEach(m => m.classList.remove('open'));
}

async function spAddMember(id) {
  const spaces = spGetAll();
  const sp = spaces.find(s => s.id === id);
  if (!sp) return;
  const m = await siModal.input('Add Member', 'Name or matric number', '', { confirmLabel:'Add' });
  if (!m?.trim()) return;
  sp.members = sp.members || [];
  sp.members.push(m.trim());
  spSaveAll(spaces);
  toast(`Added ${m.trim()} to "${sp.name}"`);
  document.querySelectorAll('.dsp-menu').forEach(m => m.classList.remove('open'));
}

async function spDelete(id) {
  if (!await siModal.confirm('This space and all its data will be permanently deleted.', { title:'Delete Space', confirmLabel:'Delete', danger:true })) return;
  spSaveAll(spGetAll().filter(s => s.id !== id));
  spRender();
  toast('Space deleted.');
}

// Close space menus on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.dsp-ellipsis') && !e.target.closest('.dsp-menu'))
    document.querySelectorAll('.dsp-menu').forEach(m => m.classList.remove('open'));
});

// ═══════════════════════ COMMAND PALETTE ════════════════════

const CMD_ITEMS = [
  // Panels
  { icon:'💬', label:'Chat',          tag:'AI',        action:() => nav('chat',null) },
  { icon:'📝', label:'Quiz',          tag:'AI',        action:() => nav('quiz',null) },
  { icon:'🧪', label:'Study Deck',    tag:'AI',        action:() => nav('lab',null) },
  { icon:'📚', label:'Courses',       tag:'Academics', action:() => { nav('courses',null); loadClasses(); } },
  { icon:'🎓', label:'Learning Hub',  tag:'Academics', action:() => nav('learninghub',null) },
  { icon:'📢', label:'Announcements', tag:'Academics', action:() => nav('announcements',null) },
  { icon:'✅', label:'Tasks',         tag:'Planner',   action:() => nav('flux',null) },
  { icon:'📓', label:'Notes',         tag:'Planner',   action:() => nav('notes',null) },
  { icon:'🗺️', label:'Study Plan',   tag:'Planner',   action:() => nav('studyplan',null) },
  { icon:'⏱', label:'Study Timer',   tag:'Planner',   action:() => nav('pomodoro',null) },
  { icon:'👥', label:'Study Groups',  tag:'Planner',   action:() => nav('studygroups',null) },
  { icon:'📝', label:'Quizzes',       tag:'Assessments',action:() => nav('quiz',null) },
  { icon:'📊', label:'Progress',      tag:'Insights',  action:() => nav('progress',null) },
  { icon:'🎯', label:'Goals',         tag:'Spaces',    action:() => nav('goals',null) },
  { icon:'📄', label:'Document Hub',  tag:'Spaces',    action:() => nav('documenthub',null) },
  { icon:'🧠', label:'Content Hub',   tag:'Spaces',    action:() => nav('contenthub',null) },
  { icon:'⚙️', label:'Settings',      tag:'',          action:() => nav('settings',null) },
  { icon:'➕', label:'Create New',    tag:'',          action:() => cnOpen() },
  // Org panels
  { icon:'👥', label:'Team',          tag:'Org',       action:() => nav('team',null) },
  { icon:'💬', label:'Team Chat',     tag:'Org',       action:() => nav('orgchat',null) },
  { icon:'🗂', label:'Projects',      tag:'Org',       action:() => nav('projects',null) },
  { icon:'🪪', label:'People & HR',   tag:'Org',       action:() => nav('hr',null) },
  { icon:'⚡', label:'Automations',   tag:'Org',       action:() => nav('automations',null) },
  { icon:'🎯', label:'Opportunities', tag:'Connect',   action:() => nav('opportunities',null) },
  { icon:'🧑', label:'My Profile',    tag:'',          action:() => nav('profile',null) },
  // Actions
  { icon:'🎤', label:'Voice Input',   tag:'Action',    action:() => { nav('chat',null); setTimeout(toggleVoice, 300); } },
  { icon:'🌙', label:'Toggle Theme',  tag:'Action',    action:() => toggleThemeFromMenu() },
  { icon:'🚪', label:'Sign Out',      tag:'Action',    action:() => logout() },
];

let CMD_OPEN    = false;
let CMD_IDX     = -1;
let CMD_VISIBLE = [];

function cmdOpen() {
  if (!S.sid) return;
  CMD_OPEN = true;
  $('cmd-bg').classList.add('open');
  const inp = $('cmd-input');
  if (inp) { inp.value = ''; inp.focus(); }
  cmdSearch();
}

function cmdClose(e) {
  if (e && e.target !== $('cmd-bg')) return;
  cmdDismiss();
}

function cmdDismiss() {
  CMD_OPEN = false;
  $('cmd-bg').classList.remove('open');
}

function cmdSearch() {
  const q   = ($('cmd-input')?.value || '').toLowerCase().trim();
  const res = $('cmd-results');
  if (!res) return;
  CMD_IDX = -1;

  // Show / hide quick-capture row
  const capRow = $('cmd-capture-row');
  if (capRow) capRow.style.display = q.length > 1 ? 'flex' : 'none';

  // Search docs (new editor)
  const docs = JSON.parse(localStorage.getItem(`sivarr_docs_${S.sid}`) || '[]');
  // Search old notes for backward compat
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');

  // Filter panels / actions
  let items = CMD_ITEMS.filter(item =>
    !q ||
    item.label.toLowerCase().includes(q) ||
    (item.tag || '').toLowerCase().includes(q)
  );

  // Match docs
  const matchedDocs = q
    ? docs.filter(d =>
        (d.title || '').toLowerCase().includes(q) ||
        (d.content || '').replace(/<[^>]+>/g,'').toLowerCase().includes(q)
      ).slice(0, 4)
    : docs.slice(0, 3);

  // Match old notes
  const matchedNotes = q
    ? notes.filter(n =>
        (n.text || '').toLowerCase().includes(q) ||
        (n.tag  || '').toLowerCase().includes(q)
      ).slice(0, 3)
    : [];

  CMD_VISIBLE = [
    ...items.map(i => ({ ...i, type: 'panel' })),
    ...matchedDocs.map(d => ({
      icon: '📄',
      label: (d.title || 'Untitled').slice(0, 50),
      tag: 'Doc',
      type: 'doc',
      action: () => { nav('notes', null); setTimeout(() => docOpen(d.id), 150); }
    })),
    ...matchedNotes.map(n => ({
      icon: '📓',
      label: (n.text || '').split('\n')[0].slice(0, 50) || 'Note',
      tag: 'Note',
      type: 'note',
      action: () => nav('notes', null),
    })),
  ];

  if (!CMD_VISIBLE.length) {
    res.innerHTML = q
      ? `<div class="cmd-empty">No results for "<strong>${esc(q)}</strong>" — capture it below ↓</div>`
      : `<div class="cmd-empty">Type to search panels, docs, or actions…</div>`;
    return;
  }

  // Group by tag
  const groups = {};
  CMD_VISIBLE.forEach((item, idx) => {
    const g = item.type === 'doc'  ? 'Docs'
            : item.type === 'note' ? 'Notes'
            : (item.tag || 'Actions');
    if (!groups[g]) groups[g] = [];
    groups[g].push({ ...item, _idx: idx });
  });

  res.innerHTML = Object.entries(groups).map(([group, groupItems]) => `
    <div class="cmd-section-label">${group}</div>
    ${groupItems.map(item => `
      <button class="cmd-item" data-idx="${item._idx}" onclick="cmdRun(${item._idx})">
        <div class="cmd-item-icon">${item.icon}</div>
        <span class="cmd-item-label">${esc(item.label)}</span>
        ${item.tag ? `<span class="cmd-item-tag">${esc(item.tag)}</span>` : ''}
      </button>`).join('')}
  `).join('');
}

function cmdRun(idx) {
  const item = CMD_VISIBLE[idx];
  if (!item) return;
  cmdDismiss();
  setTimeout(() => item.action(), 50);
}

function cmdKey(e) {
  const items = $('cmd-results')?.querySelectorAll('.cmd-item');
  if (!items?.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    CMD_IDX = Math.min(CMD_IDX + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    CMD_IDX = Math.max(CMD_IDX - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (CMD_IDX >= 0) cmdRun(parseInt(items[CMD_IDX].dataset.idx));
    else if (CMD_VISIBLE.length) cmdRun(0);
    return;
  } else if (e.key === 'Escape') {
    cmdDismiss(); return;
  } else { return; }

  items.forEach((el, i) => el.classList.toggle('active', i === CMD_IDX));
  items[CMD_IDX]?.scrollIntoView({ block: 'nearest' });
}

// Global keyboard shortcut — Cmd+K or Ctrl+K
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    CMD_OPEN ? cmdDismiss() : cmdOpen();
  }
  if (e.key === 'Escape' && CMD_OPEN) cmdDismiss();
});


// ═══════════════════════ HOME PANEL ═════════════════════════

async function loadHome() {
  const hr  = new Date().getHours();
  const tod = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = S.name.split(' ')[0] || 'there';

  const greet = $('home-greeting');
  if (greet) greet.textContent = `${tod}, ${firstName} 👋`;
  const sub = $('home-sub');
  if (sub) {
    const day = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
    sub.textContent = day;
  }

  // SIVA briefing message
  const briefMsg = $('home-brief-msg');
  if (briefMsg) {
    const msgs = [
      `Ready to make today count, ${firstName}? Your study streak is building momentum.`,
      `${firstName}, you've asked ${S.stats?.questions || 0} questions so far. Keep the curiosity going!`,
      `Good energy, ${firstName}! Check your tasks and make progress on your goals today.`,
    ];
    briefMsg.textContent = msgs[Math.floor(Math.random() * msgs.length)];
  }

  // Stats
  const hq  = $('home-questions'); if (hq)  hq.textContent  = S.stats?.questions || 0;
  const hqz = $('home-quizzes');   if (hqz) hqz.textContent = S.stats?.quizzes   || 0;
  const hs  = $('home-sessions');  if (hs)  hs.textContent  = S.stats?.sessions  || 1;

  // Goals count stat card
  try {
    const goals = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]')
      .filter(g => !g.completed);
    const gc = $('home-goals-count'); if (gc) gc.textContent = goals.length;

    const gs = $('home-goals-section');
    const gl = $('home-goals-list');
    if (goals.length && gs && gl) {
      gs.style.display = 'block';
      gl.innerHTML = goals.slice(0, 3).map(g => {
        const pct = g.progress || 0;
        const daysLeft = g.deadline
          ? Math.ceil((new Date(g.deadline) - new Date()) / 86400000) : null;
        return `<div class="priority-item">
          <div class="pr-dot" style="background:var(--teal)"></div>
          <div class="pr-text">${esc(g.title)}</div>
          ${daysLeft !== null ? `<span class="pr-tag" style="background:var(--${daysLeft<=3?'red':'teal'}2);color:var(--${daysLeft<=3?'red':'teal'}4)">${daysLeft}d</span>` : ''}
        </div>`;
      }).join('');
    }
  } catch(e) {}

  // Today's priorities from tasks
  try {
    const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]')
      .filter(t => !t.done).slice(0, 4);
    const pl = $('home-priorities-list');
    if (pl && tasks.length) {
      const colors = { high:'var(--red3)', medium:'var(--amber3)', low:'var(--green3)' };
      pl.innerHTML = tasks.map(t => `
        <div class="priority-item">
          <div class="pr-dot" style="background:${colors[t.priority]||'var(--text4)'}"></div>
          <div class="pr-text">${esc(t.title)}</div>
          <span class="pr-tag" style="background:var(--bg3);color:var(--text3)">${t.priority||'task'}</span>
        </div>`).join('');
    }
  } catch(e) {}

  // Recent notes
  try {
    const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]').slice(0, 3);
    const ns = $('home-notes-section');
    const nl = $('home-notes-list');
    if (notes.length && ns && nl) {
      ns.style.display = 'block';
      nl.innerHTML = notes.map(n => `
        <div class="priority-item" onclick="nav('notes',null)" style="cursor:pointer">
          <div class="pr-dot" style="background:var(--purple)"></div>
          <div class="pr-text">${esc(n.text.split('\n')[0].slice(0,60))}</div>
          <span style="font-size:.7rem;color:var(--text4)">${n.date||''}</span>
        </div>`).join('');
    }
  } catch(e) {}

  // Featured templates
  const htl = $('home-templates-list');
  if (htl && typeof TPL_BUILTIN !== 'undefined') {
    htl.innerHTML = TPL_BUILTIN.slice(0, 3).map(t => `
      <div class="priority-item" onclick="nav('templates',null)" style="cursor:pointer">
        <div style="font-size:1.1rem">${t.icon}</div>
        <div class="pr-text" style="font-weight:500">${esc(t.name)}</div>
        <span style="color:var(--text3);font-size:12px">→</span>
      </div>`).join('');
  }
}

// ════════════ CALENDAR ════════════
let CAL_YEAR = new Date().getFullYear();
let CAL_MONTH = new Date().getMonth();
let CAL_EVENTS_KEY = () => `sivarr_cal_${S.sid||'guest'}`;

function calInit() {
  calRender();
}

function calNav(dir) {
  CAL_MONTH += dir;
  if (CAL_MONTH > 11) { CAL_MONTH = 0; CAL_YEAR++; }
  if (CAL_MONTH < 0)  { CAL_MONTH = 11; CAL_YEAR--; }
  calRender();
}

function calRender() {
  const lbl = $('cal-month-label');
  if (lbl) lbl.textContent = new Date(CAL_YEAR, CAL_MONTH, 1)
    .toLocaleDateString('en-GB', { month:'long', year:'numeric' });

  const grid = $('cal-grid');
  if (!grid) return;

  const headers = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    .map(d => `<div class="cal-dh">${d}</div>`).join('');

  const firstDay = new Date(CAL_YEAR, CAL_MONTH, 1).getDay();
  const daysInMonth = new Date(CAL_YEAR, CAL_MONTH + 1, 0).getDate();
  const today = new Date();
  const events = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');

  let cells = '';
  for (let i = 0; i < firstDay; i++) {
    const prevD = new Date(CAL_YEAR, CAL_MONTH, -firstDay + i + 1).getDate();
    cells += `<div class="cal-cell other-month"><div class="cal-num">${prevD}</div></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && CAL_MONTH === today.getMonth() && CAL_YEAR === today.getFullYear();
    const dateStr = `${CAL_YEAR}-${String(CAL_MONTH+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasEv = events.some(e => e.date === dateStr);
    cells += `<div class="cal-cell${isToday?' today':''}" onclick="calSelectDay('${dateStr}',${d})">
      <div class="cal-num">${d}</div>
      ${hasEv ? '<div class="cal-ev"></div>' : ''}
    </div>`;
  }
  grid.innerHTML = headers + cells;
}

function calSelectDay(dateStr, d) {
  const lbl = $('cal-day-label');
  if (lbl) lbl.textContent = new Date(dateStr+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

  const events = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]')
    .filter(e => e.date === dateStr);
  const list = $('cal-events-list');
  if (!list) return;

  if (!events.length) {
    list.innerHTML = `<div class="ev-row"><div class="ev-time">—</div><div class="ev-dot" style="background:var(--text4)"></div><div class="ev-info"><div class="ev-name">No events</div><div class="ev-sub">Click + Event to add one</div></div></div>`;
    return;
  }
  list.innerHTML = events.map(e => `
    <div class="ev-row">
      <div class="ev-time">${esc(e.time||'All day')}</div>
      <div class="ev-dot" style="background:${e.color||'var(--teal)'}"></div>
      <div class="ev-info">
        <div class="ev-name">${esc(e.title)}</div>
        ${e.desc ? `<div class="ev-sub">${esc(e.desc)}</div>` : ''}
      </div>
      <button onclick="calDeleteEvent('${e.id}')" style="background:none;border:none;color:var(--text4);cursor:pointer;font-size:13px;padding:2px 6px" title="Delete">×</button>
    </div>`).join('');
}

async function calAddEvent() {
  const today = new Date().toISOString().split('T')[0];
  const d = await siModal.form('Add Event', [
    { id:'date',  label:'Date',              type:'date',  default:today, required:true },
    { id:'title', label:'Event title',       placeholder:'e.g. Exam, Study session', required:true },
    { id:'time',  label:'Time (leave blank for all day)', type:'text', placeholder:'e.g. 09:00' },
  ], { confirmLabel:'Add Event' });
  if (!d || !d.title) return;
  const colors = ['var(--teal)','var(--purple)','var(--coral)','var(--amber3)','var(--blue)'];
  const ev = { id: Date.now().toString(), date: d.date || today, title: d.title, time: d.time||'', color: colors[Math.floor(Math.random()*colors.length)] };
  const evs = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');
  evs.push(ev);
  localStorage.setItem(CAL_EVENTS_KEY(), JSON.stringify(evs));
  calRender();
  calSelectDay(ev.date);
  toast('Event added ✓');
}

function calDeleteEvent(id) {
  const evs = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]').filter(e => e.id !== id);
  localStorage.setItem(CAL_EVENTS_KEY(), JSON.stringify(evs));
  calRender();
  toast('Event removed');
}

// ════════════ HABITS ════════════
const HAB_KEY = () => `sivarr_habits_${S.sid||'guest'}`;

function habitInit() {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  const tot = $('hab-total'); if (tot) tot.textContent = habits.length;
  const today = new Date().toISOString().split('T')[0];
  const doneToday = habits.filter(h => (h.completions||[]).includes(today)).length;
  const dt = $('hab-today'); if (dt) dt.textContent = doneToday;
  const maxStreak = habits.reduce((m, h) => Math.max(m, h.streak||0), 0);
  const hs = $('hab-streak'); if (hs) hs.textContent = maxStreak;

  const list = $('habits-list');
  if (!list) return;
  if (!habits.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text4);font-size:.83rem">No habits yet. Add your first habit!</div>`;
    return;
  }
  list.innerHTML = habits.map((h,i) => {
    const week = [];
    for (let d = 6; d >= 0; d--) {
      const dt2 = new Date(); dt2.setDate(dt2.getDate()-d);
      week.push((h.completions||[]).includes(dt2.toISOString().split('T')[0]));
    }
    const isToday2 = (h.completions||[]).includes(today);
    const pct = Math.round(week.filter(Boolean).length / 7 * 100);
    return `<div class="habit-card" onclick="habitToggle(${i})">
      <div class="habit-emoji">${h.emoji||'📌'}</div>
      <div class="habit-info">
        <div class="habit-title">${esc(h.title)}</div>
        <div class="habit-sub2">Every day · ${h.freq||'daily'}</div>
        <div class="hdots">${week.map(f=>`<div class="hdot ${f?'f':'e'}"></div>`).join('')}</div>
      </div>
      <div style="text-align:right">
        <div class="habit-pct">${pct}%</div>
        <div style="font-size:.7rem;color:${isToday2?'var(--teal)':'var(--text4)'}">
          ${isToday2 ? '✓ done' : 'pending'}
        </div>
      </div>
    </div>`;
  }).join('');
}

function habitToggle(idx) {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  if (!habits[idx]) return;
  const today = new Date().toISOString().split('T')[0];
  habits[idx].completions = habits[idx].completions || [];
  if (habits[idx].completions.includes(today)) {
    habits[idx].completions = habits[idx].completions.filter(d => d !== today);
    habits[idx].streak = Math.max(0, (habits[idx].streak||0) - 1);
  } else {
    habits[idx].completions.push(today);
    habits[idx].streak = (habits[idx].streak||0) + 1;
  }
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  habitInit();
}

async function habitAdd() {
  const emojis = ['📚','🧘','🏃','💧','🥗','✍️','🎯','🛌','🔔','💡'];
  const d = await siModal.form('Add Habit', [
    { id:'title', label:'Habit name', placeholder:'e.g. Morning Study', required:true },
    { id:'emoji', label:'Pick an emoji', type:'emoji',
      options: emojis, default: emojis[Math.floor(Math.random()*emojis.length)] },
  ], { confirmLabel:'Add Habit' });
  if (!d || !d.title) return;
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  habits.push({ id: Date.now().toString(), title: d.title, emoji: d.emoji || '📌', completions: [], streak: 0 });
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  habitInit();
  toast('Habit added ✓');
}

// ════════════ JOURNAL ════════════
const JNL_KEY = () => `sivarr_journal_${S.sid||'guest'}`;

const JNL_PROMPTS = [
  'What\'s one thing you learned today that surprised you? How can you apply it?',
  'What\'s your biggest challenge right now, and what\'s one step you can take toward solving it?',
  'What are you most grateful for today?',
  'What would make tomorrow even better than today?',
  'What habit would most transform your life if you built it this month?',
];

function journalInit() {
  const lbl = $('journal-date-label');
  if (lbl) lbl.textContent = new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

  // Load today's draft
  const todayKey = `jnl_draft_${new Date().toISOString().split('T')[0]}`;
  const draft = localStorage.getItem(`${JNL_KEY()}_${todayKey}`) || '';
  const ta = $('journal-text'); if (ta) ta.value = draft;

  // Random prompt
  const prompt2 = document.querySelector('.journal-prompt');
  if (prompt2) prompt2.innerHTML = `<strong>Today's prompt:</strong> ${JNL_PROMPTS[new Date().getDay() % JNL_PROMPTS.length]}`;

  journalRenderEntries();
}

function journalSave() {
  const ta = $('journal-text');
  const mood = $('journal-mood');
  if (!ta?.value?.trim()) { toast('Write something first!'); return; }
  const entries = JSON.parse(localStorage.getItem(JNL_KEY()) || '[]');
  const today = new Date().toISOString().split('T')[0];
  const existing = entries.findIndex(e => e.date === today);
  const entry = { date: today, text: ta.value.trim(), mood: mood?.value || '😊', ts: Date.now() };
  if (existing >= 0) entries[existing] = entry;
  else entries.unshift(entry);
  localStorage.setItem(JNL_KEY(), JSON.stringify(entries));
  localStorage.setItem(`${JNL_KEY()}_jnl_draft_${today}`, ta.value.trim());
  journalRenderEntries();
  toast('Journal entry saved ✓');
}

function journalRenderEntries() {
  const list = $('journal-entries-list');
  if (!list) return;
  const entries = JSON.parse(localStorage.getItem(JNL_KEY()) || '[]');
  if (!entries.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text4);font-size:.83rem">No journal entries yet. Start writing above!</div>`;
    return;
  }
  list.innerHTML = entries.map(e => `
    <div class="journal-entry">
      <div class="je-date">${e.mood} ${new Date(e.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</div>
      <div class="je-text">${esc(e.text)}</div>
    </div>`).join('');
}

// ════════════ COMMUNITY ════════════
async function communityPost() {
  const body = await siModal.input('Share with Community', 'What\'s on your mind?', '', { confirmLabel:'Post' });
  if (!body?.trim()) return;
  const feed = $('community-feed');
  if (!feed) return;
  const card = document.createElement('div');
  card.className = 'feed-card';
  card.innerHTML = `
    <div class="feed-hd">
      <div class="feed-av">${(S.name[0]||'U').toUpperCase()}</div>
      <div style="flex:1"><div class="feed-name">${esc(S.name||'You')}</div><div class="feed-time">Just now</div></div>
    </div>
    <div class="feed-body">${esc(body.trim())}</div>
    <div class="feed-actions">
      <button class="feed-action-btn" onclick="this.querySelector('span').textContent=Number(this.querySelector('span').textContent)+1"><i class="ti ti-heart"></i> <span>0</span></button>
      <button class="feed-action-btn"><i class="ti ti-message"></i> Reply</button>
    </div>`;
  feed.insertBefore(card, feed.firstChild);
  toast('Post shared ✓');
}

function commFilter(cat, btn) {
  document.querySelectorAll('[id^="comm-tab-"]').forEach(b => b.classList.remove('sp-add'));
  if (btn) btn.classList.add('sp-add');
}

// ════════════ LIBRARY ════════════
function libFilter(cat, btn) {
  document.querySelectorAll('[id^="lib-tab-"]').forEach(b => b.classList.remove('sp-add'));
  if (btn) btn.classList.add('sp-add');
}

function libSearch(q) {
  const cards = document.querySelectorAll('#lib-grid .lib-card');
  cards.forEach(c => {
    const text = c.textContent.toLowerCase();
    c.style.display = text.includes(q.toLowerCase()) ? '' : 'none';
  });
}

// ═══════════════════════ TEMPLATES SYSTEM ════════════════════

const TPL_KEY = () => `sivarr_tpl_${S.sid || 'guest'}`;
let TPL_CAT = 'all';

const TPL_BUILTIN = [
  {
    id: "tpl-study-routine",
    name: "Daily Study Routine",
    icon: "📅",
    color: "#f59e0b",
    category: "study",
    author: "Sivarr",
    desc: "A structured daily study schedule to build consistent habits.",
    steps: ["Set 3 study goals for today","Review yesterdays notes (15 min)","Deep study session (45 min)","Take a 10-min break","Quiz yourself on todays topics","Update your progress"],
    builtin: true,
  },
  {
    id: "tpl-exam-prep",
    name: "Exam Preparation",
    icon: "🎯",
    color: "#4f6ef7",
    category: "study",
    author: "Sivarr",
    desc: "2-week exam countdown with daily focus areas.",
    steps: ["Generate a study plan (2 weeks out)","Identify weak areas","Create flashcards for weak topics","Do practice quizzes daily","Review wrong answers","Final revision day before exam"],
    builtin: true,
  },
  {
    id: "tpl-project-pipeline",
    name: "Project Pipeline",
    icon: "📊",
    color: "#7c3aed",
    category: "project",
    author: "Sivarr",
    desc: "Track a project from ideation to delivery.",
    steps: ["Define project scope","Break into tasks in Flux","Assign deadlines","Weekly progress check","Review and adjust","Final delivery"],
    builtin: true,
  },
  {
    id: "tpl-weekly-review",
    name: "Weekly Review",
    icon: "🔄",
    color: "#34d399",
    category: "productivity",
    author: "Sivarr",
    desc: "A weekly reflection and planning template.",
    steps: ["Review what you accomplished this week","Note what did not get done and why","Set 3 priorities for next week","Update your goals progress","Plan study sessions for the week"],
    builtin: true,
  },
  {
    id: "tpl-team-sprint",
    name: "Team Sprint",
    icon: "⚡",
    color: "#f472b6",
    category: "team",
    author: "Sivarr",
    desc: "A week-long team sprint for collaborative projects.",
    steps: ["Sprint planning: set team goals","Assign tasks to members","Daily 5-min standup","Mid-sprint check-in","Sprint review and retrospective"],
    builtin: true,
  },
  {
    id: "tpl-reading-list",
    name: "Reading and Research",
    icon: "📖",
    color: "#06b6d4",
    category: "personal",
    author: "Sivarr",
    desc: "Organise your reading list and capture key insights.",
    steps: ["List books or papers to read this month","Allocate 30 min per day for reading","Take notes in Document Hub","Summarise key insights","Share or apply what you learned"],
    builtin: true,
  },
];

function tplGetCustom() {
  try { return JSON.parse(localStorage.getItem(TPL_KEY()) || '[]'); }
  catch { return []; }
}
function tplSaveCustom(list) { localStorage.setItem(TPL_KEY(), JSON.stringify(list)); }

function tplSetCat(cat, btn) {
  TPL_CAT = cat;
  document.querySelectorAll('.tpl-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  tplRender();
}

function tplToggleForm() {
  const form = $('tpl-form');
  if (!form) return;
  form.classList.toggle('open');
  if (form.classList.contains('open')) $('tpl-name')?.focus();
}

function tplCreate() {
  const name  = $('tpl-name')?.value.trim();
  const cat   = $('tpl-category')?.value || 'study';
  const desc  = $('tpl-desc-input')?.value.trim();
  const steps = $('tpl-steps')?.value.trim().split(',').map(s=>s.trim()).filter(Boolean);

  if (!name) { toast('Please enter a template name.'); return; }
  if (!desc) { toast('Please add a description.'); return; }

  const custom = tplGetCustom();
  custom.push({
    id:       'custom-' + Date.now().toString(36),
    name,
    icon:     '⭐',
    color:    '#4f6ef7',
    category: cat,
    author:   S.name || 'You',
    desc,
    steps:    steps.length ? steps : ['Step 1','Step 2','Step 3'],
    builtin:  false,
    created:  new Date().toISOString(),
  });
  tplSaveCustom(custom);

  // Reset form
  ['tpl-name','tpl-desc-input','tpl-steps'].forEach(id => { const el=$(id); if(el) el.value=''; });
  $('tpl-form')?.classList.remove('open');
  tplRender();
  toast('Template created! ⚡');
}

async function tplDelete(id) {
  if (!await siModal.confirm('This template will be permanently deleted.', { title:'Delete Template', confirmLabel:'Delete', danger:true })) return;
  tplSaveCustom(tplGetCustom().filter(t => t.id !== id));
  tplRender();
  toast('Template deleted.');
}

function tplUse(id) {
  const all = [...TPL_BUILTIN, ...tplGetCustom()];
  const t   = all.find(x => x.id === id);
  if (!t) return;

  // Show a toast and open chat with template as prompt
  const prompt = `I want to follow the "${t.name}" template. Here are the steps:\n${t.steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}\n\nHelp me get started on step 1.`;
  nav('chat', null);
  setTimeout(() => {
    const ci = $('ci');
    if (ci) { ci.value = prompt; ci.focus(); }
  }, 300);
  toast(`"${t.name}" template loaded in chat ✓`);
}

function tplRender() {
  const list = $('tpl-list');
  if (!list) return;

  const custom  = tplGetCustom();
  const all     = [...TPL_BUILTIN, ...custom];
  const display = TPL_CAT === 'all' ? all : all.filter(t => t.category === TPL_CAT);

  if (!display.length) {
    list.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:.5rem">⚡</div>
      <div style="font-size:.85rem">No templates in this category yet.</div>
      <button onclick="tplToggleForm()" style="margin-top:.75rem;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:9px;padding:8px 18px;color:#fff;font-family:var(--font);font-size:.8rem;font-weight:700;cursor:pointer">
        + Create one
      </button>
    </div>`;
    return;
  }

  const catIcons = { study:'📚', productivity:'⚡', project:'📊', team:'👥', personal:'👤' };
  const catColors = { study:'#4f6ef7', productivity:'#f59e0b', project:'#7c3aed', team:'#34d399', personal:'#f472b6' };

  list.innerHTML = display.map(t => {
    const tagColor = catColors[t.category] || '#4f6ef7';
    const tagIcon  = catIcons[t.category] || '📋';
    return `
      <div class="tpl-card ${t.builtin ? '' : 'custom'}">
        <div class="tpl-card-header">
          <div class="tpl-icon" style="background:${t.color}20">${t.icon}</div>
          <div style="flex:1">
            <div class="tpl-name">${esc(t.name)}</div>
            <div class="tpl-author">by ${esc(t.author)}</div>
          </div>
        </div>
        <div class="tpl-desc">${esc(t.desc)}</div>
        ${t.steps?.length ? `
          <div style="margin-top:.625rem;display:flex;flex-direction:column;gap:3px">
            ${t.steps.slice(0,3).map((s,i)=>`
              <div style="display:flex;align-items:center;gap:6px;font-size:.75rem;color:var(--muted)">
                <span style="width:16px;height:16px;border-radius:50%;background:${t.color}20;color:${t.color};display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:800;flex-shrink:0">${i+1}</span>
                ${esc(s)}
              </div>`).join('')}
            ${t.steps.length > 3 ? `<div style="font-size:.7rem;color:var(--muted);padding-left:22px">+${t.steps.length-3} more steps</div>` : ''}
          </div>` : ''}
        <span class="tpl-tag" style="background:${tagColor}18;color:${tagColor};border:1px solid ${tagColor}30">${tagIcon} ${t.category}</span>
        ${t.builtin
          ? `<button class="tpl-use-btn" onclick="tplUse('${t.id}')">Use Template</button>`
          : `<button class="tpl-delete-btn" onclick="tplDelete('${t.id}')">🗑 Delete</button>`
        }
      </div>`;
  }).join('');
}

function tplInit() {
  tplRender();
}
function openDiff() { $('diff-modal').classList.add('open'); }
function closeDiff(e) { if (e.target === $('diff-modal')) $('diff-modal').classList.remove('open'); }

async function setDiff(level) {
  await API('/api/difficulty', { sid: S.sid, level });
  S.diff = level;
  updateDiff(level);
  $('diff-modal').classList.remove('open');
  const qd = $('qd-label'); if (qd) qd.textContent = level.charAt(0).toUpperCase()+level.slice(1);
  toast(`Difficulty: ${level.charAt(0).toUpperCase()+level.slice(1)} 🎯`);
  document.querySelectorAll('.diff-opt').forEach(el => {
    el.classList.toggle('sel', el.querySelector('.dl').textContent.toLowerCase() === level);
  });
}

function updateDiff(level) {
  // Difficulty pill now only lives in quiz section
  const btn = $('diff-btn');
  if (btn) {
    btn.className   = `diff-pill diff-${level}`;
    btn.textContent = level.charAt(0).toUpperCase()+level.slice(1);
  }
  // Update quiz start label too
  const qd = $('qd-label');
  if (qd) qd.textContent = level.charAt(0).toUpperCase()+level.slice(1);
}

// ═══════════════════════════ SNAV (New Sidebar) ═════════════════

const SNAV_SECTION_HEIGHTS = {
  ai: 4, academics: 3, planner: 6, assessments: 3, insights: 3,
  templates: 3, spaces: 2
};

// ═══════════════════════════ MOBILE SIDEBAR ══════════════════

const MOB_SNAV_HEIGHTS = {
  ai: 4, academics: 2, planner: 4,
  assessments: 3, insights: 3, spaces: 2
};

function toggleMobileSidebar() {
  const sidebar = $('sidebar');
  if (!sidebar) return;
  sidebar.classList.contains('mobile-open') ? closeMobileSidebar() : openMobileSidebar();
}

function openMobileSidebar() {
  const sidebar  = $('sidebar');
  const overlay  = $('overlay');
  if (sidebar)  sidebar.classList.add('mobile-open');
  if (overlay)  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeMobileSidebar() {
  const sidebar  = $('sidebar');
  const overlay  = $('overlay');
  if (sidebar)  sidebar.classList.remove('mobile-open');
  if (overlay)  overlay.classList.remove('show');
  document.body.style.overflow = '';
  // Legacy compat
  const panel    = $('mob-sidebar-panel');
  const mOverlay = $('mob-sidebar-overlay');
  const fab      = $('mob-fab');
  if (panel)    panel.classList.remove('open');
  if (mOverlay) mOverlay.classList.remove('visible');
  if (fab)      fab.classList.remove('open');
}

function mobSnavToggle(sectionId, btn) {
  const items  = $(`mob-items-${sectionId}`);
  const secBtn = $(`mob-sec-${sectionId}`) || btn;
  if (!items) return;
  const isOpen = items.classList.contains('open');
  if (isOpen) {
    items.style.maxHeight = '0px';
    items.classList.remove('open');
    if (secBtn) secBtn.classList.remove('open');
  } else {
    const count = MOB_SNAV_HEIGHTS[sectionId] || 5;
    items.style.maxHeight = (count * 34) + 'px';
    items.classList.add('open');
    if (secBtn) secBtn.classList.add('open');
  }
}

// Navigate and close sidebar
function navMob(panelName) {
  nav(panelName, null);
  closeMobileSidebar();
}

// Navigate to AI chat with a prefilled prompt
function navMobAI(feature) {
  nav('chat', null);
  closeMobileSidebar();
  const prompts = {
    'ask-notes':       () => { setTimeout(() => $('attach-btn')?.click(), 300); },
    'study-help':      () => { setTimeout(() => { const ci = $('ci'); if (ci) { ci.value = 'Help me plan and structure my study tasks'; ci.focus(); }}, 300); },
    'study-plan':      () => { setTimeout(() => { const ci = $('ci'); if (ci) { ci.value = 'Create a personalised weekly study plan for me'; ci.focus(); }}, 300); },
    'weak-areas':      () => { setTimeout(() => getSuggestions && getSuggestions(), 400); },
    'recommendations': () => { setTimeout(() => getSuggestions && getSuggestions(), 400); },
  };
  if (prompts[feature]) prompts[feature]();
}

// Navigate to courses and open exam entry tab
function navMobExamEntry() {
  nav('courses', null);
  closeMobileSidebar();
  setTimeout(() => {
    const examTab = document.querySelector('.ctab[onclick*="exam-entry"]');
    if (examTab) examTab.click();
  }, 350);
}

// Swipe left to close sidebar


// Auto-open AI section on first load
document.addEventListener('DOMContentLoaded', () => {
  const aiItems  = $('mob-items-ai');
  const aiBtn    = $('mob-sec-ai');
  const count    = MOB_SNAV_HEIGHTS['ai'] || 4;
  if (aiItems) { aiItems.style.maxHeight = (count * 34) + 'px'; aiItems.classList.add('open'); }
  if (aiBtn)   aiBtn.classList.add('open');
});

// ═══════════════════════════ SNAV TOGGLE ═════════════════════
function snavToggle(sectionId, btn) {
  const items = $(`snav-items-${sectionId}`);
  const secBtn = $(`snav-sec-${sectionId}`) || btn;
  if (!items) return;
  const isOpen = items.classList.contains('open');
  if (isOpen) {
    items.style.maxHeight = '0px';
    items.classList.remove('open');
    if (secBtn) secBtn.classList.remove('open');
  } else {
    const count = SNAV_SECTION_HEIGHTS[sectionId] || 5;
    items.style.maxHeight = (count * 34) + 'px';
    items.classList.add('open');
    if (secBtn) secBtn.classList.add('open');
    // Update icon background
    const icon = secBtn ? secBtn.querySelector('.snav-section-icon') : null;
    if (icon) icon.style.background = getSectionColor(sectionId, true);
  }
}

function getSectionColor(sectionId, bg) {
  const map = {
    ai: '#818cf8', academics: '#34d399', planner: '#fb923c',
    assessments: '#f472b6', insights: '#60a5fa'
  };
  const c = map[sectionId] || '#818cf8';
  return bg ? `${c}22` : c;
}

// Route map: snav item id → { panel, trigger }
const SNAV_ROUTE = {
  // AI
  'chat':            () => nav('chat', null),
  'ask-notes':       () => { nav('chat', null); setTimeout(() => $('attach-btn')?.click(), 300); },
  'generate-quiz':   () => nav('quiz', null),
  'study-help-ai':   () => { nav('chat', null); setTimeout(() => { const ci=$('ci'); if(ci){ci.value='Help me build a study plan';ci.focus();} }, 300); },
  // Academics
  'courses':         () => { nav('courses', null); setTimeout(() => loadClasses(), 200); },
  'materials':       () => nav('learninghub', null),
  'announcements':   () => nav('announcements', null),
  // Planner
  'tasks':           () => nav('flux', null),
  'notes':           () => nav('notes', null),
  'study-deck':      () => nav('lab', null),
  'study-plan':      () => nav('studyplan', null),
  'studyplan':       () => nav('studyplan', null),
  'pomodoro':        () => nav('pomodoro', null),
  'study-timer':     () => nav('pomodoro', null),
  'study-groups':    () => nav('studygroups', null),
  // Assessments
  'quizzes':         () => nav('quiz', null),
  'exams':           () => { nav('courses', null); setTimeout(() => { const b=document.querySelector('.ctab[onclick*="exam-entry"]'); if(b)b.click(); }, 350); },
  'results':         () => nav('stats', null),
  // Insights
  'progress':        () => nav('progress', null),
  'weak-areas':      () => { nav('progress', null); setTimeout(() => { const wa=$('weak-section'); if(wa)wa.scrollIntoView({behavior:'smooth'}); }, 400); },
  'recommendations': () => { nav('chat', null); setTimeout(() => getSuggestions(), 400); },
  // Spaces - Personal
  'task-tracker':    () => nav('flux', null),
  'document-hub':    () => nav('documenthub', null),
  'meetings':        () => nav('studygroups', null),
  'content-hub':     () => nav('contenthub', null),
  // Spaces - Org
  'goals':           () => nav('goals', null),
  'team':            () => nav('studygroups', null),
  'knowledge':       () => nav('notes', null),
  'org-insights':    () => nav('progress', null),
  // Global
  'create-new':      () => { cnOpen(); },
  'settings':        () => nav('settings', null),
  'templates':       () => nav('templates', null),
  'my-templates':    () => { nav('templates', null); setTimeout(() => tplSetCat('personal', document.querySelector('.tpl-filter[onclick*="personal"]')), 200); },
  'new-template':    () => { nav('templates', null); setTimeout(() => tplToggleForm(), 200); },
};

let SNAV_ACTIVE = 'chat';

function snavSelect(itemId, sectionId, btnEl) {
  // Clear all active states
  document.querySelectorAll('.snav-item').forEach(b => b.classList.remove('active'));
  const dash = $('snav-dash'); if (dash) dash.classList.remove('active');

  // Set active
  const el = $(`snav-${itemId}`) || btnEl;
  if (el) el.classList.add('active');
  SNAV_ACTIVE = itemId;

  // Open the section if not already
  const items = $(`snav-items-${sectionId}`);
  if (items && !items.classList.contains('open')) snavToggle(sectionId, null);

  // Update sidebar footer name (mirror from topbar)
  const snavName = $('snav-name'); const tbName = $('tb-name');
  if (snavName && tbName) snavName.textContent = tbName.textContent;
  const snavAv = $('snav-av'); const tbAv = $('tb-av');
  if (snavAv && tbAv) snavAv.textContent = tbAv.textContent;

  // Execute route
  const route = SNAV_ROUTE[itemId];
  if (route) route();
}

// Sync sidebar active state with new .si[data-panel] system
function syncSnavFromPanel(name) {
  document.querySelectorAll('.si').forEach(b => b.classList.remove('on'));
  const el = document.querySelector(`.si[data-panel="${name}"]`);
  if (el) el.classList.add('on');
}

// ── Sidebar section collapse ─────────────────────────────────
const SB_SECTIONS = ['core','work','academic','grow','connect','org','spaces'];

// Map panel name → sidebar section id
const PANEL_SECTION_MAP = {
  chat:'core', home:'core', announcements:'core',
  flux:'work', notes:'work', calendar:'work', templates:'work',
  courses:'academic', quiz:'academic', lab:'academic',
  studyplan:'academic', pomodoro:'academic', contenthub:'academic',
  goals:'grow', habits:'grow', stats:'grow', journal:'grow',
  community:'connect', library:'connect', opportunities:'connect', agents:'connect',
  team:'org', projects:'org', hr:'org', automations:'org', orgchat:'org', org:'org',
  personal:'spaces', academic:'spaces',
};

function sbEnsureExpanded(panelName) {
  const section = PANEL_SECTION_MAP[panelName];
  if (!section) return;
  const items = $('sgi-' + section);
  if (items && items.classList.contains('collapsed')) sbToggleSection(section);
}

function sbToggleSection(id) {
  const items = $('sgi-' + id);
  if (!items) return;
  const hd = items.previousElementSibling;
  const willCollapse = !items.classList.contains('collapsed');
  items.classList.toggle('collapsed', willCollapse);
  if (hd) hd.classList.toggle('collapsed', willCollapse);
  willCollapse
    ? localStorage.setItem('sivarr_sb_' + id, '1')
    : localStorage.removeItem('sivarr_sb_' + id);
}

function sbRestoreCollapse() {
  SB_SECTIONS.forEach(id => {
    if (localStorage.getItem('sivarr_sb_' + id)) {
      const items = $('sgi-' + id);
      const hd = items?.previousElementSibling;
      if (items) { items.classList.add('collapsed'); hd?.classList.add('collapsed'); }
    }
  });
}

// New sidebar nav handler
function sidebarNav(btn) {
  const panel = btn.dataset.panel;
  if (!panel) return;
  sbEnsureExpanded(panel);
  nav(panel, null);
}

// ═══════════════════════════ NAV ════════════════════════════════
function nav(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .mn-btn').forEach(b => b.classList.remove('active'));
  const p = document.getElementById(`panel-${name}`);
  if (p) p.classList.add('active');
  if (btn) btn.classList.add('active');
  const mob = document.getElementById(`mn-${name}`); if (mob) mob.classList.add('active');
  syncSnavFromPanel(name);

  if (name === 'chat')      { chatCounterInit(); return; }
  if (name === 'home')      { loadHome(); return; }
  if (name === 'notes')     { docInit(); return; }
  if (name === 'templates') { tplInit(); return; }
  if (name === 'calendar')  { calInit(); return; }
  if (name === 'habits')    { habitInit(); return; }
  if (name === 'journal')   { journalInit(); return; }
  if (name === 'community') return;
  if (name === 'library')   return;
  if (name === 'stats')         loadStats();
  if (name === 'more')          syncMore();
  if (name === 'leaderboard')   loadLeaderboard();
  if (name === 'flux')          loadStudyHelp();
  if (name === 'courses')       loadClasses();
  if (name === 'announcements') loadAllAnnouncements();
  if (name === 'studyplan') {
    $('sp-date') && ($('sp-date').min = new Date().toISOString().split('T')[0]);
    setTimeout(spLoadSaved, 100);
  }
  if (name === 'contenthub') chInit();
  if (name === 'settings')   stInit();
  if (name === 'progress')    loadProgress();
  if (name === 'goals')       glLoad();
  if (name === 'documenthub') dhInit();
  if (name === 'learninghub') lhInit();
  if (name === 'studygroups') sgInit();
  if (name === 'pomodoro')    pomInit();
  if (name === 'quiz' && !S.quizActive) {
    const qd = $('qd-label'); if (qd) qd.textContent = S.diff.charAt(0).toUpperCase()+S.diff.slice(1);
  }
  if (name === 'team')          teamInit();
  if (name === 'orgchat')       orgChatInit();
  if (name === 'projects')      projectsInit();
  if (name === 'hr')            hrInit();
  if (name === 'automations')   autoInit();
  if (name === 'org')           orgInit();
  if (name === 'opportunities') oppInit();
  if (name === 'profile')       profileInit();
  if (name === 'personal')      psRenderOverview();
  if (name === 'academic')      acRenderOverview();
  if (name === 'agents')        agInit();
}

// Mobile tab bar navigation with smooth pill scroll
function navTab(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`panel-${name}`);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const desktopBtn = document.querySelector(`.nav-btn[onclick*="'${name}'"]`);
  if (desktopBtn) desktopBtn.classList.add('active');

  if (name === 'stats')         loadStats();
  if (name === 'more')          syncMore();
  if (name === 'leaderboard')   loadLeaderboard();
  if (name === 'notes')         docInit();
  if (name === 'flux')          loadStudyHelp();
  if (name === 'courses')       loadClasses();
  if (name === 'announcements') loadAllAnnouncements();
  if (name === 'studyplan') { const d = new Date(); d.setDate(d.getDate()+14); $('sp-date') && ($('sp-date').min = new Date().toISOString().split('T')[0]); }
  if (name === 'contenthub') chInit();
  if (name === 'settings')   stInit();
  if (name === 'progress')    loadProgress();
  if (name === 'goals')       glLoad();
  if (name === 'documenthub') dhInit();
  if (name === 'learninghub') lhInit();
  if (name === 'studygroups') sgInit();
  if (name === 'pomodoro')    pomInit();
  if (name === 'quiz' && !S.quizActive) {
    const qd = $('qd-label'); if (qd) qd.textContent = S.diff.charAt(0).toUpperCase()+S.diff.slice(1);
  }
  if (name === 'team')          teamInit();
  if (name === 'orgchat')       orgChatInit();
  if (name === 'projects')      projectsInit();
  if (name === 'hr')            hrInit();
  if (name === 'automations')   autoInit();
  if (name === 'org')           orgInit();
  if (name === 'opportunities') oppInit();
  if (name === 'profile')       profileInit();
}

async function getSuggestionsMobile() {
  $('sug-txt-m').textContent = 'Thinking...';
  try {
    const r = await fetch(`/api/suggest?sid=${S.sid}`);
    const d = await r.json();
    $('sug-txt-m').textContent = d.suggestion;
  } catch { $('sug-txt-m').textContent = 'Couldn\'t load — try again.'; }
}

function syncMore() {
  // Sync topics
  const tl = $('topics-list-m');
  if (tl) tl.innerHTML = $('topics-list').innerHTML;
  // Sync wrong answers
  const wl = $('wrong-list-m');
  if (wl) wl.innerHTML = $('wrong-list').innerHTML;
  const wc = $('wc-m');
  if (wc) wc.textContent = $('wc').textContent;
}

// ═══════════════════════════ HELPERS ════════════════════════════
function updateSBStats() {
  const sqq  = $('sq-q');  if (sqq)  sqq.textContent  = S.stats.questions;
  const sqqz = $('sq-qz'); if (sqqz) sqqz.textContent = S.stats.quizzes;
  const sqs  = $('sq-s');  if (sqs)  sqs.textContent  = S.stats.sessions;
  const sqw  = $('sq-w');  if (sqw)  sqw.textContent  = S.stats.wrong || 0;
}

function renderTopics(topics, weak) {
  const html = !topics.length
    ? `<span style="color:var(--muted);font-size:.78rem">Ask questions to build your topic list</span>`
    : topics.map(t => `<span class="topic-tag ${weak.includes(t)?'weak':''}">${esc(t)}</span>`).join('');
  const el  = $('topics-list');   if (el)  el.innerHTML  = html;
  const elm = $('topics-list-m'); if (elm) elm.innerHTML = html;
}

async function refreshTopics() {
  const r = await fetch(`/api/progress?sid=${S.sid}`);
  const d = await r.json();
  S.topics = Object.keys(d.topics); S.weak = d.weak;
  renderTopics(S.topics, S.weak);
}

// ═══════════════════════ SWIPE GESTURES ════════════════════════

(function initSwipe() {
  let startX = 0, startY = 0, startTime = 0;
  const PANELS = ['chat','quiz','stats','courses','lab','flux','announcements','notes','studyplan'];
  let currentIdx = 0;

  function getCurrentIdx() {
    const active = document.querySelector('.panel.active');
    if (!active) return 0;
    const id = active.id.replace('panel-','');
    const i  = PANELS.indexOf(id);
    return i >= 0 ? i : currentIdx;
  }

  document.addEventListener('touchstart', e => {
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const dx   = e.changedTouches[0].clientX - startX;
    const dy   = e.changedTouches[0].clientY - startY;
    const dt   = Date.now() - startTime;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);

    // Must be fast, horizontal, and significant
    if (dt > 350 || absDx < 60 || absDy > absDx * 0.8) return;

    // Don't swipe if inside a scrollable area scrolled horizontally
    const target = e.target.closest('.chat-msgs,.quiz-wrap,.stats-wrap,.tab-bar,.lh-filter-bar,.sg-msg-wrap');
    if (target) return;

    currentIdx = getCurrentIdx();

    if (dx < 0 && currentIdx < PANELS.length - 1) {
      // Swipe left = next panel
      nav(PANELS[currentIdx + 1], null);
      currentIdx++;
    } else if (dx > 0 && currentIdx > 0) {
      // Swipe right = previous panel
      nav(PANELS[currentIdx - 1], null);
      currentIdx--;
    }
  }, { passive: true });
})();
  
function toast(msg, ms=2500) {
  const el = $('toast'); el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

async function runStudyHavenP(input) {
  const file = input.files[0];
  if (!file || !S.sid) return;
  await _processLabFile(file, 'panel');
  input.value = '';
}

function handleLabDropP(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) _processLabFile(file, 'panel');
}

function switchLabTabP(tab, btn) {
  ['summary','notes','questions'].forEach(t => {
    const el = $(`lab-${t}-p`); if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('[onclick*="switchLabTabP"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function saveLabAsNoteP()  { _saveLabNote(); }
function downloadLabResultP() { _downloadLab(); }

// toggleSHSidebar kept as no-op — superseded by snavToggle
function toggleSHSidebar(btn) { snavSelect('tasks','planner',null); }

// Init sidebar section heights on load so CSS transitions work
document.addEventListener('DOMContentLoaded', () => {
  Object.entries(SNAV_SECTION_HEIGHTS).forEach(([id, count]) => {
    const el = $(`snav-items-${id}`);
    if (el && el.classList.contains('open')) {
      el.style.maxHeight = (count * 34) + 'px';
    }
  });
});



const SH_KEY  = () => `sivarr_sh_${S.sid || 'guest'}`;
let SH_DRAG   = null;
let SH_VIEW   = 'board';
let SH_ADD_COL = 'todo';

const SH_COLS = {
  todo:       { label: 'Not Started', color: '#94a3b8' },
  inprogress: { label: 'In Progress', color: '#f59e0b' },
  done:       { label: 'Done',        color: '#22c55e' },
};

function getSHData() {
  try { return JSON.parse(localStorage.getItem(SH_KEY()) || '{"tasks":[]}'); }
  catch { return { tasks: [] }; }
}

function saveSHData(data) {
  localStorage.setItem(SH_KEY(), JSON.stringify(data));
}

function loadStudyHelp() {
  // Default to overview on first load
  const overviewBtn = $('sh-view-overview');
  setSHView('overview', overviewBtn);
  renderSHBoard();
}

function setSHView(view, btn) {
  SH_VIEW = view;
  document.querySelectorAll('.sh-view-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $('sh-overview-view').style.display = view === 'overview' ? 'flex'  : 'none';
  $('sh-board-view').style.display    = view === 'board'    ? 'flex'  : 'none';
  $('sh-list-view').style.display     = view === 'list'     ? 'block' : 'none';
  if (view === 'overview') renderSHOverview();
  if (view === 'list')     renderSHListView();
}

function renderSHOverview() {
  const data   = getSHData();
  const tasks  = data.tasks || [];
  const tbody  = $('sh-overview-rows');
  if (!tbody) return;

  const STATUS = {
    todo:       { label:'Not started', color:'#94a3b8', bg:'#94a3b815' },
    inprogress: { label:'In progress', color:'#4f6ef7', bg:'#4f6ef715' },
    done:       { label:'Done',        color:'#22c55e', bg:'#22c55e15' },
  };
  const PRIORITY = {
    high:   { label:'🔴 High',   color:'#ef4444' },
    medium: { label:'🟡 Medium', color:'#f59e0b' },
    low:    { label:'🟢 Low',    color:'#22c55e' },
    normal: { label:'—',         color:'var(--muted)' },
  };
  const TYPE_ICONS = {
    assignment:'📋', exam:'📝', reading:'📖', project:'🗂', revision:'🔄', other:'⚙️'
  };

  if (!tasks.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="padding:2rem;text-align:center;color:var(--muted);font-size:.84rem">
      No tasks yet — click "+ New task" below to add your first task.</td></tr>`;
    return;
  }

  tbody.innerHTML = tasks.map((t, idx) => {
    const st  = STATUS[t.status]   || STATUS.todo;
    const pr  = PRIORITY[t.priority] || PRIORITY.normal;
    const ico = TYPE_ICONS[t.type] || '⚙️';
    const due = t.date ? (t.time ? `${t.date} ${t.time}` : t.date) : '—';
    const updated = t.updated || t.created || '—';
    const isDone = t.status === 'done';

    return `<tr style="transition:background .1s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <td><div class="sh-cell" style="display:flex;align-items:center;gap:6px">
            <div class="editable sh-cell-title" style="flex:1;${isDone ? 'text-decoration:line-through;opacity:.6' : ''}"
                onclick="inlineEdit(${t.id},'title',this)">${esc(t.title)}</div>
            <button class="task-focus-btn" onclick="focusStart(${JSON.stringify(t.title)},25)" title="Focus on this task"><i class="ti ti-player-play" style="font-size:10px"></i></button>
          </div></td>
      <td><div class="sh-cell" onclick="inlineEditSelect(${t.id},'status',this)">
            <span class="sh-status-pill" style="background:${st.bg};color:${st.color}">
              <span style="width:7px;height:7px;border-radius:50%;background:${st.color};flex-shrink:0"></span>
              ${st.label}
            </span></div></td>
      <td><div class="sh-cell editable" onclick="inlineEditSelect(${t.id},'type',this)">${ico} ${esc(t.type || 'other')}</div></td>
      <td><div class="sh-cell editable" style="font-size:.75rem;color:var(--muted)"
            onclick="inlineEdit(${t.id},'desc',this)">${esc(t.desc || '—')}</div></td>
      <td><div class="sh-cell editable" onclick="inlineEdit(${t.id},'assignee',this)">${esc(t.assignee || '—')}</div></td>
      <td><div class="sh-cell editable" style="color:${t.date && !isDone ? 'var(--accent)' : 'var(--muted)'};font-size:.78rem"
            onclick="inlineEditDate(${t.id},this)">${due}</div></td>
      <td><div class="sh-cell" onclick="inlineEditSelect(${t.id},'priority',this)"
            style="color:${pr.color};font-weight:600;font-size:.78rem">${pr.label}</div></td>
      <td><div class="sh-cell" style="justify-content:center">
            ${t.attachName
              ? `<span style="font-size:.7rem;color:var(--accent)">📎 ${esc(t.attachName)}</span>`
              : `<button onclick="triggerSHAttach(${t.id})"
                  style="background:none;border:1px solid var(--border);border-radius:6px;
                         padding:2px 8px;color:var(--muted);font-size:.7rem;cursor:pointer">+ Attach</button>`}
          </div></td>
      <td><div class="sh-cell" style="font-size:.72rem;color:var(--muted)">${esc(updated)}</div></td>
      <td><div class="sh-cell editable" style="font-size:.75rem;color:var(--muted)"
            onclick="inlineEdit(${t.id},'summary',this)">${esc(t.summary || '—')}</div></td>
      <td style="text-align:center">
        <div class="sh-cell" style="justify-content:center">
          <button onclick="moveSHTask(${t.id}, '${isDone ? 'todo' : 'done'}')"
            style="width:22px;height:22px;border-radius:5px;cursor:pointer;font-size:.75rem;
                   background:${isDone ? '#22c55e' : 'none'};
                   border:2px solid ${isDone ? '#22c55e' : 'var(--border)'};
                   color:${isDone ? '#fff' : 'transparent'}">${isDone ? '✓' : ''}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Inline editing ────────────────────────────────────────────────────────

function inlineEdit(id, field, cell) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (!task) return;

  const cur = task[field] || '';
  const isMultiline = field === 'desc' || field === 'summary';

  if (isMultiline) {
    cell.innerHTML = `<textarea style="width:100%;background:var(--card);border:1px solid var(--accent);
      border-radius:5px;padding:4px 7px;color:var(--text);font-family:var(--font-body);font-size:.82rem;
      resize:none;outline:none;min-height:52px" onblur="saveInline(${id},'${field}',this.value)"
      onkeydown="if(event.key==='Escape')renderSHOverview()">${esc(cur)}</textarea>`;
    cell.querySelector('textarea').focus();
  } else {
    cell.innerHTML = `<input value="${esc(cur)}" style="width:100%;background:var(--card);border:1px solid var(--accent);
      border-radius:5px;padding:4px 7px;color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none"
      onblur="saveInline(${id},'${field}',this.value)"
      onkeydown="if(event.key==='Enter'||event.key==='Escape')this.blur()">`;
    cell.querySelector('input').focus();
    cell.querySelector('input').select();
  }
}

function inlineEditSelect(id, field, cell) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (!task) return;

  const options = {
    status:   [['todo','Not started'],['inprogress','In progress'],['done','Done']],
    priority: [['normal','— Normal'],['high','🔴 High'],['medium','🟡 Medium'],['low','🟢 Low']],
    type:     [['assignment','📋 Assignment'],['exam','📝 Exam prep'],['reading','📖 Reading'],
               ['project','🗂 Project'],['revision','🔄 Revision'],['other','⚙️ Other']],
  };
  const opts = options[field] || [];

  cell.innerHTML = `<select style="width:100%;background:var(--card);border:1px solid var(--accent);
    border-radius:5px;padding:4px 7px;color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none"
    onblur="saveInline(${id},'${field}',this.value)"
    onchange="saveInline(${id},'${field}',this.value)">
    ${opts.map(([v,l]) => `<option value="${v}" ${task[field]===v?'selected':''}>${l}</option>`).join('')}
  </select>`;
  cell.querySelector('select').focus();
}

function inlineEditDate(id, cell) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (!task) return;
  cell.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:3px;padding:4px">
      <input type="date" value="${task.date||''}" style="background:var(--card);border:1px solid var(--accent);
        border-radius:5px;padding:3px 6px;color:var(--text);font-size:.78rem;outline:none"
        onblur="saveDateInline(${id},'date',this.value)"
        onchange="saveDateInline(${id},'date',this.value)">
      <input type="time" value="${task.time||''}" style="background:var(--card);border:1px solid var(--accent);
        border-radius:5px;padding:3px 6px;color:var(--text);font-size:.78rem;outline:none"
        onblur="saveDateInline(${id},'time',this.value)"
        onchange="saveDateInline(${id},'time',this.value)">
    </div>`;
  cell.querySelector('input').focus();
}

function saveInline(id, field, value) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (!task) return;
  task[field]  = value.trim();
  task.updated = new Date().toLocaleDateString();
  saveSHData(data);
  renderSHOverview();
  renderSHBoard();
}

function saveDateInline(id, field, value) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (!task) return;
  task[field]  = value;
  task.updated = new Date().toLocaleDateString();
  saveSHData(data);
  // Don't re-render yet — user may still editing time field
}

function triggerSHAttach(id) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.style.display = 'none';
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    const data = getSHData();
    const task = (data.tasks||[]).find(t=>t.id===id);
    if (task) { task.attachName = file.name; task.updated = new Date().toLocaleDateString(); }
    saveSHData(data);
    renderSHOverview();
    toast(`Attached: ${file.name}`);
  };
  document.body.appendChild(inp);
  inp.click();
  document.body.removeChild(inp);
}

function handleSHAttach(input) {
  const file = input.files[0];
  if (!file) return;
  const fn = $('sh-modal-file-name');
  if (fn) fn.textContent = file.name;
  input._filename = file.name;
}


function openEditTask(id) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (!task) return;
  const modal = $('sh-modal-bg');
  modal._editId = id;
  const h = $('sh-modal-heading'); if (h) h.textContent = 'Edit Task';
  $('sh-modal-title').value    = task.title       || '';
  $('sh-modal-status').value   = task.status      || 'todo';
  $('sh-modal-type').value     = task.type        || 'other';
  $('sh-modal-desc').value     = task.desc        || '';
  $('sh-modal-assignee').value = task.assignee    || '';
  $('sh-modal-date').value     = task.date        || '';
  $('sh-modal-time').value     = task.time        || '';
  $('sh-modal-priority').value = task.priority    || 'normal';
  $('sh-modal-summary').value  = task.summary     || '';
  const fn = $('sh-modal-file-name');
  if (fn) fn.textContent = task.attachName || 'No file chosen';
  modal.style.display = 'flex';
  setTimeout(() => $('sh-modal-title')?.focus(), 100);
}

function openAddTask(col) {
  SH_ADD_COL = col || 'todo';
  const modal = $('sh-modal-bg');
  if (!modal) return;
  modal._editId = null;
  const h = $('sh-modal-heading'); if (h) h.textContent = 'New Task';
  $('sh-modal-title').value    = '';
  $('sh-modal-status').value   = SH_ADD_COL;
  $('sh-modal-type').value     = 'other';
  $('sh-modal-desc').value     = '';
  $('sh-modal-assignee').value = '';
  $('sh-modal-date').value     = '';
  $('sh-modal-time').value     = '';
  $('sh-modal-priority').value = 'normal';
  $('sh-modal-summary').value  = '';
  const fn = $('sh-modal-file-name'); if (fn) fn.textContent = 'No file chosen';
  const fi = $('sh-modal-file');      if (fi) { fi.value = ''; fi._filename = ''; }
  modal.style.display = 'flex';
  setTimeout(() => $('sh-modal-title')?.focus(), 100);
}

function closeSHModal() {
  const modal = $('sh-modal-bg');
  if (modal) modal.style.display = 'none';
}

function saveSHModal() {
  const title = $('sh-modal-title')?.value.trim();
  if (!title) { toast('Enter a task name.'); return; }

  const now  = new Date().toLocaleDateString();
  const data = getSHData();
  data.tasks = data.tasks || [];
  const editId = $('sh-modal-bg')._editId;

  const fields = {
    title,
    status:   $('sh-modal-status')?.value   || 'todo',
    type:     $('sh-modal-type')?.value      || 'other',
    desc:     $('sh-modal-desc')?.value.trim()     || '',
    assignee: $('sh-modal-assignee')?.value.trim() || '',
    date:     $('sh-modal-date')?.value      || '',
    time:     $('sh-modal-time')?.value      || '',
    priority: $('sh-modal-priority')?.value  || 'normal',
    summary:  $('sh-modal-summary')?.value.trim()  || '',
    attachName: $('sh-modal-file')?._filename || '',
    updated:  now,
  };

  if (editId) {
    const task = data.tasks.find(t => t.id === editId);
    if (task) Object.assign(task, fields);
    $('sh-modal-bg')._editId = null;
    toast('Task updated ✓');
  } else {
    data.tasks.push({ id: Date.now(), created: now, ...fields });
    toast('Task added ✓');
  }

  saveSHData(data);
  closeSHModal();
  renderSHBoard();
}

function deleteSHTask(id) {
  const data   = getSHData();
  data.tasks   = (data.tasks || []).filter(t => t.id !== id);
  saveSHData(data);
  renderSHBoard();
  if (SH_VIEW === 'list') renderSHListView();
}

function moveSHTask(id, newStatus) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (task) { task.status = newStatus; saveSHData(data); }
  renderSHBoard();
  if (SH_VIEW === 'list') renderSHListView();
}

// Drag and drop
function shDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function shDrop(e, col) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (SH_DRAG !== null) { moveSHTask(SH_DRAG, col); SH_DRAG = null; }
}

function renderSHBoard() {
  const data  = getSHData();
  const tasks = data.tasks || [];
  const done  = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const pct   = total ? Math.round((done / total) * 100) : 0;

  const tc = $('sh-total-count'); if (tc) tc.textContent = total;
  const dc = $('sh-done-count');  if (dc) dc.textContent = done;
  const pb = $('sh-progress-bar'); if (pb) pb.style.width = pct + '%';
  const pp = $('sh-pct');          if (pp) pp.textContent = pct + '%';

  Object.keys(SH_COLS).forEach(col => {
    const colTasks = tasks.filter(t => t.status === col);
    const body     = $(`sh-col-${col}`);
    const count    = $(`sh-col-count-${col}`);
    if (!body) return;
    if (count) count.textContent = colTasks.length;

    body.innerHTML = colTasks.length ? colTasks.map(t => `
      <div class="sh-card" draggable="true"
        ondragstart="SH_DRAG=${t.id}"
        ondragend="document.querySelectorAll('.sh-col-body').forEach(b=>b.classList.remove('drag-over'))">
        <div class="sh-card-title">${esc(t.title)}</div>
        ${t.notes ? `<div class="sh-card-notes">${esc(t.notes)}</div>` : ''}
        <div class="sh-card-footer">
          ${t.date ? `<span class="sh-card-date">📅 ${t.date}</span>` : ''}
          <span class="sh-priority ${t.priority}">${
            t.priority === 'high' ? '🔴 High' :
            t.priority === 'medium' ? '🟡 Med' :
            t.priority === 'low' ? '🟢 Low' : ''
          }</span>
          <div style="margin-left:auto;display:flex;gap:4px">
            ${col !== 'done' ? `<button onclick="moveSHTask(${t.id},'done')"
              style="background:#22c55e20;border:1px solid #22c55e40;border-radius:5px;
                     color:#22c55e;font-size:.65rem;padding:1px 6px;cursor:pointer">✓</button>` : ''}
            <button onclick="deleteSHTask(${t.id})" class="sh-card-del"
              style="opacity:1;background:none;border:none;color:var(--muted);cursor:pointer;font-size:.75rem">✕</button>
          </div>
        </div>
      </div>`).join('')
      : `<div style="font-size:.75rem;color:var(--muted);padding:8px 4px;text-align:center">No tasks</div>`;
  });

  // Refresh overview if visible
  if (SH_VIEW === 'overview') renderSHOverview();
  if (SH_VIEW === 'list') renderSHListView();
}

function renderSHListView() {
  const data    = getSHData();
  const tasks   = data.tasks || [];
  const container = $('sh-list-container');
  if (!container) return;

  if (!tasks.length) {
    container.innerHTML = '<div style="text-align:center;color:var(--muted);padding:2rem;font-size:.84rem">No tasks yet — click "+ New Task" to get started.</div>';
    return;
  }

  container.innerHTML = `
    <div style="font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;
                letter-spacing:.06em;padding:6px 12px;display:grid;
                grid-template-columns:12px 1fr 80px 80px 70px 40px;gap:8px;
                border-bottom:1px solid var(--border)">
      <span></span><span>Task</span><span>Status</span><span>Priority</span><span>Due</span><span></span>
    </div>
    ${tasks.map(t => `
    <div class="sh-list-item" style="display:grid;grid-template-columns:12px 1fr 80px 80px 70px 40px;gap:8px;align-items:center">
      <div class="sh-list-status" style="background:${SH_COLS[t.status]?.color || '#94a3b8'}"></div>
      <div>
        <div style="font-weight:600;font-size:.84rem">${esc(t.title)}</div>
        ${t.notes ? `<div style="font-size:.72rem;color:var(--muted)">${esc(t.notes)}</div>` : ''}
      </div>
      <div style="font-size:.72rem;color:${SH_COLS[t.status]?.color || 'var(--muted)'};font-weight:600">${SH_COLS[t.status]?.label || ''}</div>
      <div><span class="sh-priority ${t.priority}">${
        t.priority === 'high' ? '🔴 High' :
        t.priority === 'medium' ? '🟡 Med' :
        t.priority === 'low' ? '🟢 Low' : '—'
      }</span></div>
      <div style="font-size:.72rem;color:var(--accent)">${t.date || '—'}</div>
      <button onclick="deleteSHTask(${t.id})"
        style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem">✕</button>
    </div>`).join('')}`;
}

async function generateTaskStructure() {
  const inp = $('sh-structure-input');
  const res = $('sh-structure-result');
  const btn = document.querySelector('[onclick="generateTaskStructure()"]');
  const text = inp?.value.trim();
  if (!text) { toast('Describe your task first.'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Thinking...'; }
  if (res) res.style.display = 'none';
  try {
    const r = await API('/api/chat', {
      sid: S.sid,
      message: `Break down this task into clear numbered steps a student can follow. Be concise. Task: "${text}"`
    });
    if (res) {
      res.innerHTML = renderMarkdown(r.response || r.reply || r.message || '');
      res.style.display = 'block';
    }
  } catch { toast('Could not generate — try again.'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Generate Steps'; }
}

function createStudyPDF() {
  const title = $('sh-pdf-title')?.value.trim() || 'Study Plan';
  const body  = $('sh-pdf-content')?.value.trim();
  if (!body) { toast('Add some content first.'); return; }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;color:#1a1a2e;line-height:1.7}
h1{font-size:1.6rem;color:#4f6ef7;border-bottom:2px solid #4f6ef7;padding-bottom:8px}
pre{white-space:pre-wrap;font-family:inherit;font-size:.95rem}
.meta{font-size:.8rem;color:#888;margin-bottom:2rem}</style></head>
<body><h1>${title}</h1><div class="meta">Generated by Sivarr AI · ${new Date().toLocaleDateString()}</div>
<pre>${body}</pre></body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 300);
}

// Close modal on background click
document.addEventListener('click', e => {
  const modal = $('sh-modal-bg');
  if (modal && e.target === modal) closeSHModal();
});

// ═══════════════════════════ LECTURE LAB ════════════════════════

let LAB_RESULT_TEXT = '';

function parseLabResult(raw) {
  const summaryMatch = raw.match(/##\s*📋\s*SUMMARY([\s\S]*?)(?=##\s*📚|$)/i);
  const notesMatch   = raw.match(/##\s*📚\s*STRUCTURED NOTES([\s\S]*?)(?=##\s*❓|$)/i);
  const questMatch   = raw.match(/##\s*❓\s*PRACTICE QUESTIONS([\s\S]*?)$/i);
  return {
    summary:   summaryMatch ? summaryMatch[1].trim() : raw,
    notes:     notesMatch   ? notesMatch[1].trim()   : '',
    questions: questMatch   ? questMatch[1].trim()   : '',
  };
}

function renderMarkdown(text) {
  if (!text) return '';
  let h = text
    // Code blocks first (before escaping)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre style="background:var(--border);border-radius:8px;padding:.75rem;overflow-x:auto;margin:.4rem 0;font-size:.82rem"><code>${esc(code.trim())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:var(--border);border-radius:4px;padding:1px 6px;font-size:.85em">$1</code>')
    // Escape remaining HTML
    .replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;')
    .replace(/<(?!pre|\/pre|code|\/code)/g, '&lt;')
    // Headings
    .replace(/^### (.+)$/gm, '<div style="font-family:var(--font);font-size:.9rem;font-weight:700;margin:.6rem 0 .2rem;color:var(--accent)">$1</div>')
    .replace(/^## (.+)$/gm,  '<div style="font-family:var(--font);font-size:1rem;font-weight:800;margin:.7rem 0 .3rem">$1</div>')
    .replace(/^# (.+)$/gm,   '<div style="font-family:var(--font);font-size:1.1rem;font-weight:800;margin:.75rem 0 .3rem">$1</div>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    // Bullet lists
    .replace(/^[\-\*] (.+)$/gm, '<li style="margin:.15rem 0;padding-left:.25rem">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm,'<li style="margin:.15rem 0;padding-left:.25rem">$2</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li[^>]*>.*?<\/li>\n?)+/g, m =>
      `<ul style="padding-left:1.25rem;margin:.35rem 0;list-style:disc">${m}</ul>`)
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:.5rem 0">')
    // Line breaks
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>');
  return h;
  }

async function runStudyHaven(input) {
  const file = input.files[0];
  if (!file || !S.sid) return;
  await _processLabFile(file, 'mobile');
  input.value = '';
}

async function runStudyHavenD(input) {
  const file = input.files[0];
  if (!file || !S.sid) return;
  await _processLabFile(file, 'desktop');
  input.value = '';
}

function handleLabDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) _processLabFile(file, 'mobile');
}

function handleLabDropD(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) _processLabFile(file, 'desktop');
}

async function _processLabFile(file, target) {
  const isMobile  = target === 'mobile';
  const isPanel   = target === 'panel';
  const sfxMap    = { mobile: '', desktop: '-d', panel: '-p' };
  const sfx       = sfxMap[target] || '';
  const dropZone  = isMobile ? $('lab-drop-zone') : (isPanel ? $('lab-drop-zone-p') : null);
  const resultDiv = $(`lab-result${sfx}`);
  const fnameEl   = $(`lab-filename${sfx}`);

  if (dropZone) dropZone.innerHTML = `
    <div style="font-size:1.5rem;margin-bottom:.4rem">⏳</div>
    <div style="font-size:.82rem;color:var(--muted)">Processing "${esc(file.name)}"...</div>
    <div style="font-size:.72rem;color:var(--muted2);margin-top:3px">Takes 10-20 seconds</div>`;
  if (resultDiv) resultDiv.style.display = 'none';

  try {
    const fd = new FormData();
    fd.append('sid', S.sid);
    fd.append('file', file);
    const r = await fetch('/api/study-deck', { method: 'POST', body: fd });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Processing failed'); }
    const d = await r.json();

    LAB_RESULT_TEXT  = d.result;
    const sections   = parseLabResult(d.result);
    const sfx        = isMobile ? '' : '-d';

    const sum = $(`lab-summary${sfx}`);
    const nts = $(`lab-notes${sfx}`);
    const qst = $(`lab-questions${sfx}`);

    if (sum) sum.innerHTML = renderMarkdown(sections.summary);
    if (nts) nts.innerHTML = renderMarkdown(sections.notes);
    if (qst) qst.innerHTML = renderMarkdown(sections.questions);
    if (fnameEl) fnameEl.textContent = `📄 ${file.name}`;
    if (resultDiv) resultDiv.style.display = 'block';

    if (dropZone) dropZone.innerHTML = `
      <div style="font-size:1.75rem;margin-bottom:.4rem">✅</div>
      <div style="font-size:.82rem;color:var(--muted)">Done! Upload another file</div>
      <div style="font-size:.72rem;color:var(--muted2);margin-top:3px">.txt · .pdf · .md</div>`;

    // Activate first tab for correct context
    if (isPanel) switchLabTabP('summary', document.querySelector('[onclick*="switchLabTabP"]'));
    else if (isMobile) switchLabTab('summary', document.querySelector('.lab-tab'));
    else switchLabTabD('summary', document.querySelector('[onclick*="switchLabTabD"]'));

    toast(`Study pack ready! ✓`);
  } catch(e) {
    toast('Study Deck: ' + e.message);
    if (dropZone) dropZone.innerHTML = `
      <div style="font-size:1.75rem;margin-bottom:.4rem">📄</div>
      <div style="font-size:.82rem;color:var(--muted)">Drop file or tap to upload</div>
      <div style="font-size:.72rem;color:var(--muted2);margin-top:3px">.txt · .pdf · .md</div>`;
  }
}

function switchLabTab(tab, btn) {
  ['summary','notes','questions'].forEach(t => {
    const el = $(`lab-${t}`); if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('.lab-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function switchLabTabD(tab, btn) {
  ['summary','notes','questions'].forEach(t => {
    const el = $(`lab-${t}-d`); if (el) el.style.display = t === tab ? 'block' : 'none';
  });
  document.querySelectorAll('[onclick*="switchLabTabD"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function saveLabAsNote()  { _saveLabNote(); }
function saveLabAsNoteD() { _saveLabNote(); }
function _saveLabNote() {
  if (!LAB_RESULT_TEXT || !S.sid) { toast('No study pack to save.'); return; }
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');
  notes.unshift({ text: LAB_RESULT_TEXT, date: new Date().toLocaleString() + ' (Study Deck)' });
  localStorage.setItem(`sivarr_notes_${S.sid}`, JSON.stringify(notes.slice(0,50)));
  toast('Saved to My Notes ✓');
}

function downloadLabResult()  { _downloadLab(); }
function downloadLabResultD() { _downloadLab(); }
function _downloadLab() {
  if (!LAB_RESULT_TEXT) { toast('No study pack yet.'); return; }
  const blob = new Blob([`SIVARR AI — LECTURE LAB\n${'─'.repeat(40)}\n\n${LAB_RESULT_TEXT}`], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sivarr_study_pack_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════ STUDENT EXAM SYSTEM ════════════════

let EXAM_STATE = {
  examId: null, code: null, questions: [], answers: {},
  timerInterval: null, timeLeft: 0, tabSwitches: 0, title: ''
};

async function startStudentExam(examId, code) {
  launchExamMode(examId, code);
}

function selectExamAnswer(qIdx, letter) {
  EXAM_STATE.answers[qIdx] = letter;

  // Update UI — use new exam-option class
  const q = EXAM_STATE.questions[qIdx];
  Object.keys(q.options || {}).forEach(l => {
    const btn = $(`eq-${qIdx}-${l}`);
    if (btn) {
      btn.classList.toggle('exam-option', true);
      btn.classList.toggle('chosen', l === letter);
      // legacy class for old renderExamUI compatibility
      btn.classList.toggle('selected', l === letter);
    }
  });

  // Update progress strip and counter
  const answered = Object.keys(EXAM_STATE.answers).length;
  const total    = EXAM_STATE.questions.length;
  const pct      = (answered / total) * 100;
  const prog1 = $('exam-prog-fill'); if (prog1) prog1.style.width = pct + '%';
  const prog2 = $('exam-prog');      if (prog2) prog2.style.width = pct + '%';
  const ans1  = $('exam-answered-count'); if (ans1) ans1.textContent = answered;
  const ans2  = $('exam-answered');       if (ans2) ans2.textContent = answered;
}

function startExamTimer() {
  const update = () => {
    const t  = EXAM_STATE.timeLeft;
    const m  = Math.floor(t / 60);
    const s  = t % 60;
    const el = $('exam-timer');
    if (el) {
      el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      if (t <= 300) {
        el.style.color      = '#ef4444';
        el.style.background = '#ef444415';
        el.style.borderColor = '#ef444430';
      } else if (t <= 600) {
        el.style.color      = '#f59e0b';
        el.style.background = '#f59e0b15';
        el.style.borderColor = '#f59e0b30';
      } else {
        el.style.color      = '#818cf8';
        el.style.background = '#4f6ef715';
        el.style.borderColor = '#4f6ef730';
      }
    }
    if (t <= 0) {
      clearInterval(EXAM_STATE.timerInterval);
      toast('⏰ Time is up! Auto-submitting...');
      submitExam();
      return;
    }
    if (t === 300) toast('⚠️ 5 minutes remaining!');
    if (t === 600) toast('⏰ 10 minutes remaining!');
    EXAM_STATE.timeLeft--;
  };
  update();
  EXAM_STATE.timerInterval = setInterval(update, 1000);
}

function setupAntiCheat() {
  document.removeEventListener('visibilitychange', handleTabSwitch);
  document.addEventListener('visibilitychange', handleTabSwitch);
}

function handleTabSwitch() {
  if (document.hidden && EXAM_STATE.examId) {
    EXAM_STATE.tabSwitches++;
    // New fullscreen IDs
    const warn1 = $('exam-tab-warn');  if (warn1) warn1.style.display = 'flex';
    const cnt1  = $('exam-tab-count'); if (cnt1)  cnt1.textContent    = EXAM_STATE.tabSwitches;
    // Legacy IDs
    const warn2 = $('exam-cheat-warn'); if (warn2) warn2.style.display = 'block';
    const cnt2  = $('cheat-count');     if (cnt2)  cnt2.textContent    = EXAM_STATE.tabSwitches;
  }
}

async function confirmSubmitExam() {
  const answered   = Object.keys(EXAM_STATE.answers).length;
  const total      = EXAM_STATE.questions.length;
  const unanswered = total - answered;
  if (unanswered > 0) {
    const ok = await siModal.confirm(`You have ${unanswered} unanswered question${unanswered>1?'s':''}. Submit anyway?`, { title:'Submit Exam', confirmLabel:'Submit' });
    if (!ok) return;
  }
  submitExam();
}

async function submitExam() {
  clearInterval(EXAM_STATE.timerInterval);
  document.removeEventListener('visibilitychange', handleTabSwitch);

  const overlay = $('exam-fullscreen-overlay');
  if (overlay) overlay.innerHTML = `<div class="exam-body" style="text-align:center;padding-top:3rem">
    <div style="font-size:1.5rem;margin-bottom:.5rem">⏳</div>
    <div style="color:#9ca3af;font-size:.88rem">Submitting your exam...</div>
  </div>`;

  try {
    const r = await fetch('/api/exam/submit', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        sid: S.sid, exam_id: EXAM_STATE.examId,
        answers: EXAM_STATE.answers, tab_switches: EXAM_STATE.tabSwitches
      })
    });
    if (!r.ok) throw new Error((await r.json()).detail || 'Submit failed');
    const d = await r.json();
    renderExamResults(d, overlay);
  } catch(e) {
    if (overlay) overlay.innerHTML = `<div class="exam-body" style="text-align:center;padding-top:3rem">
      <div style="font-size:2rem;margin-bottom:.5rem">⚠️</div>
      <div style="color:#9ca3af;margin-bottom:1.5rem;font-size:.88rem">Submission failed: ${esc(e.message)}</div>
      <button onclick="closeExamMode()" class="btn-start" style="padding:10px 28px">← Back</button>
    </div>`;
  }
  EXAM_STATE.examId = null;
}

function renderExamResults(d, container) {
  const wrap = container || $('exam-fullscreen-overlay');
  if (!wrap) return;
  wrap.style.display = 'flex';

  const grade  = d.grade || 'F';
  const score  = d.score || 0;
  const emoji  = score >= 70 ? '🏆' : score >= 50 ? '👍' : '📚';
  const msg    = score >= 70 ? 'Excellent work!' : score >= 50 ? 'Good effort!' : 'Keep practising!';
  const gColor = grade==='A'?'#22c55e':grade==='B'?'#4f6ef7':grade==='C'?'#f59e0b':'#ef4444';

  wrap.innerHTML = `
    <div class="exam-results-wrap">
      <div style="width:100%;max-width:600px">

        <!-- Score card -->
        <div style="background:#13151c;border:1px solid rgba(255,255,255,0.08);border-radius:20px;
                    padding:2rem;text-align:center;margin-bottom:1.25rem">
          <div style="font-size:3rem;margin-bottom:.5rem">${emoji}</div>
          <div style="font-family:var(--font);font-size:3.5rem;font-weight:800;line-height:1;
                      background:linear-gradient(135deg,var(--accent),var(--accent2));
                      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">
            ${score}%
          </div>
          <div style="font-size:1.3rem;font-weight:800;margin:.4rem 0;color:${gColor}">Grade ${grade}</div>
          <div style="color:#9ca3af;font-size:.88rem;margin-bottom:1rem">${msg}</div>
          <div style="display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap">
            <div style="text-align:center">
              <div style="font-family:var(--font);font-size:1.4rem;font-weight:800;color:#e5e7eb">${d.correct||0}/${d.total||0}</div>
              <div style="font-size:.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Correct</div>
            </div>
            ${d.time_taken ? `<div style="text-align:center">
              <div style="font-family:var(--font);font-size:1.4rem;font-weight:800;color:#e5e7eb">${d.time_taken}</div>
              <div style="font-size:.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Time</div>
            </div>` : ''}
            ${(d.tab_switches||EXAM_STATE?.tabSwitches||0) > 0 ? `<div style="text-align:center">
              <div style="font-family:var(--font);font-size:1.4rem;font-weight:800;color:#ef4444">${d.tab_switches||EXAM_STATE?.tabSwitches||0}</div>
              <div style="font-size:.7rem;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Tab switches</div>
            </div>` : ''}
          </div>
        </div>

        <!-- Question breakdown -->
        <div style="font-family:var(--font);font-weight:700;font-size:.9rem;color:#e5e7eb;margin-bottom:.75rem">
          Question Breakdown
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:1.5rem">
          ${(d.breakdown||[]).map((b, i) => `
            <div style="background:${b.is_correct?'#22c55e0d':'#ef44440d'};
                        border:1px solid ${b.is_correct?'#22c55e25':'#ef444425'};
                        border-radius:12px;padding:12px 14px">
              <div style="display:flex;align-items:flex-start;gap:8px">
                <span style="font-size:.9rem;flex-shrink:0">${b.is_correct?'✅':'❌'}</span>
                <div style="flex:1">
                  <div style="font-size:.84rem;font-weight:600;color:#e5e7eb;margin-bottom:4px">
                    Q${i+1}: ${esc(b.question)}
                  </div>
                  ${!b.is_correct ? `
                    <div style="font-size:.75rem;color:#9ca3af">
                      Your answer: <span style="color:#ef4444;font-weight:600">${b.your_answer||'Not answered'}</span>
                      &nbsp;·&nbsp; Correct: <span style="color:#22c55e;font-weight:600">${b.correct}</span>
                    </div>
                    ${b.explanation ? `<div style="font-size:.75rem;color:#6b7280;margin-top:4px;font-style:italic">💡 ${esc(b.explanation)}</div>` : ''}
                  ` : ''}
                </div>
              </div>
            </div>`).join('')}
        </div>

        <button onclick="closeExamMode()"
          style="width:100%;padding:13px;background:var(--accent);color:#fff;border:none;
                 border-radius:10px;font-family:var(--font);font-weight:700;font-size:.9rem;cursor:pointer">
          ← Back to Courses
        </button>
      </div>
    </div>`;
}

async function viewMyExamResult(examId) {
  // Show results in the fullscreen overlay
  let overlay = $('exam-fullscreen-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'exam-fullscreen-overlay';
    overlay.className = 'exam-fullscreen';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="exam-body" style="text-align:center;padding-top:3rem">
    <div style="font-size:1.5rem;margin-bottom:.5rem">⏳</div>
    <div style="color:#9ca3af;font-size:.88rem">Loading results...</div>
  </div>`;
  overlay.style.display = 'flex';

  try {
    const r = await fetch(`/api/exam/student-results?sid=${encodeURIComponent(S.sid)}`);
    const d = await r.json();
    const result = (d.results || []).find(res => res.exam_id === examId);
    if (!result) {
      overlay.innerHTML = `<div class="exam-body" style="text-align:center;padding-top:3rem">
        <div style="font-size:2rem;margin-bottom:.5rem">📝</div>
        <div style="color:#9ca3af;margin-bottom:1.5rem">No submission found for this exam.</div>
        <button onclick="closeExamMode()" class="btn-start" style="padding:10px 28px">← Back</button>
      </div>`;
      return;
    }
    renderExamResults(result, overlay);
  } catch {
    overlay.innerHTML = `<div class="exam-body" style="text-align:center;padding-top:3rem">
      <div style="font-size:2rem;margin-bottom:.5rem">⚠️</div>
      <div style="color:#9ca3af;margin-bottom:1.5rem">Could not load results.</div>
      <button onclick="closeExamMode()" class="btn-start" style="padding:10px 28px">← Back</button>
    </div>`;
  }
}

async function enterExamById() {
  const inp = $('exam-id-input');
  const err = $('exam-entry-err');
  const btn = $('exam-entry-btn');
  const id  = inp?.value.trim();

  if (!id) { if (err) err.textContent = 'Enter an Exam ID.'; return; }
  if (err) err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  try {
    await launchExamMode(id, CURRENT_CLASS?.code || '');
  } catch(e) {
    if (err) err.textContent = e.message || 'Could not start exam.';
  }
  if (btn) { btn.disabled = false; btn.textContent = '▶ Start Exam'; }
}

function renderExamResults(d) {
  const takeView = $('exam-take-view');
  if (!takeView) return;

  const grade   = d.grade;
  const emoji   = d.score >= 70 ? '🏆' : d.score >= 50 ? '👍' : '📚';
  const msg     = d.score >= 70 ? 'Excellent work!' : d.score >= 50 ? 'Good effort!' : 'Keep practising!';
  const gColor  = grade==='A'?'#22c55e':grade==='B'?'#4f6ef7':grade==='C'?'#f59e0b':'#ef4444';

  takeView.innerHTML = `
    <div style="padding:1.5rem">
      <!-- Score card -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;
                  padding:1.5rem;text-align:center;margin-bottom:1rem">
        <div style="font-size:2.5rem;margin-bottom:.5rem">${emoji}</div>
        <div style="font-family:var(--font);font-size:3rem;font-weight:800;
                    background:linear-gradient(135deg,var(--accent),var(--accent2));
                    -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">
          ${d.score}%
        </div>
        <div style="font-size:1.1rem;font-weight:700;margin:.25rem 0;color:${gColor}">Grade ${grade}</div>
        <div style="color:var(--muted);font-size:.85rem;margin-bottom:.75rem">${msg}</div>
        <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap">
          <span style="font-size:.82rem;color:var(--muted)">✅ ${d.correct}/${d.total} correct</span>
          ${d.time_taken ? `<span style="font-size:.82rem;color:var(--muted)">⏱ ${d.time_taken}</span>` : ''}
        </div>
      </div>

      <!-- Question breakdown -->
      <div style="font-family:var(--font);font-weight:700;font-size:.9rem;margin-bottom:.75rem">Question Breakdown</div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto">
        ${d.breakdown.map((b, i) => `
          <div style="background:${b.is_correct ? '#22c55e10' : '#ef444410'};
                      border:1px solid ${b.is_correct ? '#22c55e30' : '#ef444430'};
                      border-radius:10px;padding:10px 12px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="font-size:.85rem">${b.is_correct ? '✅' : '❌'}</span>
              <span style="font-size:.82rem;font-weight:600">Q${i+1}: ${esc(b.question)}</span>
            </div>
            ${!b.is_correct ? `
              <div style="font-size:.75rem;color:var(--muted)">
                Your answer: <span style="color:#ef4444;font-weight:600">${b.your_answer || 'Not answered'}</span> ·
                Correct: <span style="color:#22c55e;font-weight:600">${b.correct}</span>
              </div>
              ${b.explanation ? `<div style="font-size:.75rem;color:var(--muted);margin-top:3px;font-style:italic">${esc(b.explanation)}</div>` : ''}
            ` : ''}
          </div>`).join('')}
      </div>

      <button class="btn-start" style="width:100%;margin-top:1rem;padding:11px"
        onclick="$('exam-take-view').style.display='none';$('exam-list-view').style.display='block'">
        ← Back to Exams
      </button>
    </div>`;
}

async function viewMyExamResult(examId) {
  const takeView = $('exam-take-view');
  const listView = $('exam-list-view');
  if (!takeView) return;
  listView.style.display = 'none';
  takeView.style.display = 'block';
  takeView.innerHTML = `<div class="empty-state"><div class="es-icon">⏳</div><div class="es-text">Loading results...</div></div>`;

  try {
    const r = await fetch(`/api/exam/student-results?sid=${encodeURIComponent(S.sid)}`);
    const d = await r.json();
    const result = (d.results || []).find(r => r.exam_id === examId);
    if (!result) {
      takeView.innerHTML = `<div class="empty-state"><div class="es-icon">📝</div><div class="es-text">No submission found for this exam.</div>
        <button class="btn-start" style="margin-top:1rem;padding:8px 20px" onclick="$('exam-take-view').style.display='none';$('exam-list-view').style.display='block'">← Back</button></div>`;
      return;
    }
    renderExamResults(result);
  } catch(e) {
    takeView.innerHTML = `<div class="empty-state"><div class="es-icon">⚠️</div><div class="es-text">Could not load results.</div></div>`;
  }
}

async function enterExamById() {
  const inp  = $('exam-id-input');
  const err  = $('exam-entry-err');
  const btn  = $('exam-entry-btn');
  const view = $('exam-entry-view');
  const id   = inp?.value.trim();

  if (!id) { if (err) err.textContent = 'Enter an Exam ID.'; return; }
  if (err) err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  try {
    const r = await fetch('/api/exam/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sid: S.sid, exam_id: id, code: CURRENT_CLASS?.code || '' })
    });

    if (r.status === 409) {
      if (err) err.textContent = 'You have already submitted this exam.';
      if (btn) { btn.disabled = false; btn.textContent = '▶ Start Exam'; }
      return;
    }
    if (!r.ok) {
      const e = await r.json();
      if (err) err.textContent = e.detail || 'Exam not found. Check the ID.';
      if (btn) { btn.disabled = false; btn.textContent = '▶ Start Exam'; }
      return;
    }

    const d = await r.json();
    EXAM_STATE = {
      examId: id, code: CURRENT_CLASS?.code || '',
      questions: d.questions, answers: {},
      timerInterval: null, timeLeft: d.duration * 60,
      tabSwitches: 0, title: d.title
    };

    // Hide the entry form, render exam in view div
    inp.closest('div.r-card, div[style]').style.display = 'none';
    if (!view) return;
    view.style.display = 'block';
    renderExamUI(view);
    startExamTimer();
    setupAntiCheat();
  } catch(e) {
    if (err) err.textContent = 'Connection error — try again.';
    if (btn) { btn.disabled = false; btn.textContent = '▶ Start Exam'; }
  }
}

// ═══════════════════════════ CLASSES ════════════════════════════
let CURRENT_CLASS = null;

async function loadClasses() {
  clearInterval(DISCUSS_INTERVAL);

  const panel = $('panel-courses');
  if (!panel) return;

  // Always rebuild — safe no matter what was showing before
  panel.innerHTML = `
    <div style="padding:1.25rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <div>
          <h2 style="font-family:var(--font);font-size:1.2rem;font-weight:800;letter-spacing:-.02em">🏫 Courses</h2>
          <p style="font-size:.78rem;color:var(--muted);margin-top:2px" id="classes-subtitle">Loading...</p>
        </div>
        <button class="btn-start" style="padding:8px 16px;font-size:.8rem" onclick="showJoinClass()">+ Join Class</button>
      </div>
      <div id="classes-list-area">
        <div class="empty-state"><div class="es-icon">⏳</div><div class="es-text">Loading classes...</div></div>
      </div>
    </div>`;

  const area     = $('classes-list-area');
  const subtitle = $('classes-subtitle');

  if (!S.sid) {
    area.innerHTML = '<div class="empty-state"><div class="es-icon">⚠️</div><div class="es-text">Please log in first.</div></div>';
    return;
  }

  try {
    const r = await fetch(`/api/class/student?sid=${encodeURIComponent(S.sid)}`);
    if (!r.ok) throw new Error(`${r.status}`);
    const d       = await r.json();
    const classes = d.classes || [];

    if (subtitle) subtitle.textContent = `${classes.length} class${classes.length !== 1 ? 'es' : ''} joined`;

    area.innerHTML = classes.length
      ? classes.map(cls => `
          <div class="class-card" onclick="openClass('${esc(cls.code)}')">
            <div class="class-icon">📚</div>
            <div class="class-info">
              <div class="class-name">${esc(cls.name)}</div>
              <div class="class-meta">${esc(cls.subject || '')} · ${esc(cls.lecturer || '')}</div>
            </div>
            <span style="color:var(--muted);font-size:1.1rem">›</span>
          </div>`).join('')
      : `<div class="empty-state">
           <div class="es-icon">🏫</div>
           <div class="es-text">No classes yet — tap "+ Join Class" and enter your lecturer's code!</div>
         </div>`;

  } catch(e) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">⚠️</div>
        <div class="es-text" style="margin-bottom:1rem">Couldn't load classes.</div>
        <button class="btn-start" style="padding:8px 20px;font-size:.82rem" onclick="loadClasses()">↻ Try Again</button>
      </div>`;
  }
}

function renderClassesList(classes) {
  const root = $('classes-root');
  if (!root) return;
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
      <div>
        <h2 style="font-family:var(--font);font-size:1.2rem;font-weight:800;letter-spacing:-.02em">🏫 Courses</h2>
        <p style="font-size:.78rem;color:var(--muted);margin-top:2px">${classes.length} class${classes.length !== 1 ? 'es' : ''} joined</p>
      </div>
      <button class="btn-start" style="padding:8px 16px;font-size:.8rem" onclick="showJoinClass()">+ Join Class</button>
    </div>
    ${classes.length ? classes.map(cls => `
      <div class="class-card" onclick="openClass('${esc(cls.code)}')">
        <div class="class-icon">📚</div>
        <div class="class-info">
          <div class="class-name">${esc(cls.name)}</div>
          <div class="class-meta">${esc(cls.subject || '')} · ${esc(cls.lecturer || '')}</div>
        </div>
        <span style="color:var(--muted);font-size:1.1rem">›</span>
      </div>`).join('') : `
      <div class="empty-state" style="margin-top:1rem">
        <div class="es-icon">🏫</div>
        <div class="es-text">No classes yet — tap "+ Join Class" and enter your lecturer's code!</div>
      </div>`}`;
}

function showJoinClass() {
  const panel = $('panel-courses');
  if (!panel) return;
  panel.innerHTML = `
    <div style="flex:1;overflow-y:auto;padding:1.25rem">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:1.25rem">
        <button onclick="loadClasses()"
          style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;padding:2px 6px">←</button>
        <h2 style="font-family:var(--font);font-size:1.1rem;font-weight:800">Join a Class</h2>
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:.75rem">🔑</div>
        <p style="color:var(--muted);font-size:.85rem;margin-bottom:1.25rem">Enter the class code from your lecturer</p>
        <input
          type="text"
          id="join-code-inp"
          maxlength="8"
          placeholder="e.g. 4AFN9P"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="characters"
          spellcheck="false"
          style="width:100%;background:var(--surface);border:2px solid var(--border);border-radius:12px;
                 padding:14px;color:var(--text);font-family:var(--font);font-size:1.4rem;font-weight:800;
                 letter-spacing:.25em;text-align:center;text-transform:uppercase;outline:none;
                 margin-bottom:8px;box-sizing:border-box;transition:border-color .2s"
          onfocus="this.style.borderColor='var(--accent)'"
          onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter') submitJoinClass()">
        <div id="join-err-msg" style="color:var(--red);font-size:.8rem;min-height:18px;margin-bottom:8px"></div>
        <button id="join-submit-btn" class="btn-start" style="width:100%;padding:12px"
          onclick="submitJoinClass()">Join Class</button>
      </div>
    </div>`;

  setTimeout(() => {
    const inp = $('join-code-inp');
    if (!inp) return;
    inp.focus();
    inp.addEventListener('input', function() {
      const pos = this.selectionStart;
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
      this.setSelectionRange(pos, pos);
    });
  }, 100);
}

async function submitJoinClass() {
  const inp  = $('join-code-inp');
  const btn  = $('join-submit-btn');
  const err  = $('join-err-msg');
  const code = (inp?.value || '').trim().toUpperCase();

  if (code.length < 4) {
    if (err) err.textContent = 'Enter a valid class code.';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Joining...'; }
  if (err) err.textContent = '';

  try {
    const r = await fetch('/api/class/join', {
      method:  'POST',
      headers: {'Content-Type':'application/json'},
      body:    JSON.stringify({ sid: S.sid, code }),
    });
    const d = await r.json();
    if (!r.ok) {
      if (err) err.textContent = d.detail || 'Class not found. Check the code.';
      if (btn) { btn.disabled = false; btn.textContent = 'Join Class'; }
      return;
    }
    toast(`Joined "${d.name}" ✓ 🎉`);
    // Open the class directly — loadClasses() will run when we go back
    setTimeout(() => openClass(code), 500);
  } catch {
    if (err) err.textContent = 'Connection error — try again.';
    if (btn) { btn.disabled = false; btn.textContent = 'Join Class'; }
  }
}

async function openClass(code) {
  const panel = $('panel-courses');
  if (!panel) return;

  // Show loading directly in the panel
  panel.innerHTML = `
    <div style="padding:1.25rem">
      <div class="empty-state"><div class="es-icon">⏳</div><div class="es-text">Loading class...</div></div>
    </div>`;

  try {
    const r = await fetch(`/api/class/detail?code=${encodeURIComponent(code)}&sid=${encodeURIComponent(S.sid)}`);
    if (!r.ok) {
      toast('Could not load class — try again.');
      loadClasses();
      return;
    }
    CURRENT_CLASS      = await r.json();
    CURRENT_CLASS.code = code;
    renderClassDetail(CURRENT_CLASS);
  } catch(e) {
    toast('Connection error — try again.');
    loadClasses();
  }
}

function renderClassDetail(cls) {
  const panel = $('panel-courses');
  if (!panel) return;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:.875rem 1.25rem;
                background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0">
      <button onclick="clearInterval(DISCUSS_INTERVAL);loadClasses()"
        style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;
               flex-shrink:0;padding:2px 6px;border-radius:6px">←</button>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font);font-weight:700;font-size:.95rem;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cls.name)}</div>
        <div style="font-size:.72rem;color:var(--muted)">${esc(cls.subject || '')} · ${esc(cls.lecturer || '')}</div>
      </div>
      <button onclick="confirmLeaveClass('${cls.code}')"
        style="background:none;border:1px solid var(--border);border-radius:7px;padding:3px 9px;
               color:var(--muted);font-size:.7rem;cursor:pointer;flex-shrink:0">Leave</button>
    </div>

    <div class="class-tabs" id="class-tabs" style="flex-shrink:0">
      <button class="ctab active" onclick="switchClassTab('materials',this)">📁 Materials</button>
      <button class="ctab" onclick="switchClassTab('announcements',this)">📢 Notices</button>
      <button class="ctab" onclick="switchClassTab('live',this)">🔴 Live</button>
      <button class="ctab" onclick="switchClassTab('exams',this)">📝 Exams</button>
      <button class="ctab" onclick="switchClassTab('exam-entry',this)">🎯 Enter Exam</button>
      <button class="ctab" onclick="switchClassTab('assignments',this)">📋 Tasks</button>
      <button class="ctab" onclick="switchClassTab('discuss',this)">💬 Chat</button>
    </div>

    <div id="class-tab-content" style="flex:1;overflow:hidden;padding:1rem;min-height:0;display:block"></div>`;

  switchClassTab('materials');
}

function switchClassTab(tab, btn) {
  CURRENT_CLASS_TAB = tab;
  clearInterval(DISCUSS_INTERVAL);
  clearInterval(GROUP_INTERVAL);

  // Reset active buttons
  document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    document.querySelectorAll('.ctab').forEach(b => {
      if (b.textContent.toLowerCase().includes(tab.slice(0, 4))) b.classList.add('active');
    });
  }

  // Reset content div styles so chat's padding:0 doesn't bleed into other tabs
  const content = $('class-tab-content');
  if (content) {
    content.style.padding      = tab === 'discuss' || tab === 'group-chat' ? '0' : '1rem';
    content.style.display      = tab === 'discuss' ? 'flex' : 'block';
    content.style.flexDirection = tab === 'discuss' ? 'column' : '';
    content.style.overflow     = 'auto';
  }

  // For tabs that show live data, refetch fresh class detail first
  if (['materials','announcements','exams'].includes(tab) && CURRENT_CLASS?.code) {
    fetch(`/api/class/detail?code=${encodeURIComponent(CURRENT_CLASS.code)}&sid=${encodeURIComponent(S.sid)}`)
      .then(r => r.json())
      .then(fresh => {
        CURRENT_CLASS = { ...fresh, code: CURRENT_CLASS.code };
        renderClassTab(tab);
      })
      .catch(() => renderClassTab(tab));
  } else {
    renderClassTab(tab);
  }
}

function renderClassTab(tab) {
  const content = $('class-tab-content');
  if (!content || !CURRENT_CLASS) return;
  const cls = CURRENT_CLASS;

  // ── Materials ──────────────────────────────────────────────
  if (tab === 'materials') {
    const mats = cls.materials || [];
    const ICONS = { link:'🔗', note:'📝', file:'📄' };
    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.875rem">
        <div style="font-family:var(--font);font-weight:700;font-size:.9rem">📁 Materials <span style="color:var(--muted);font-weight:400;font-size:.78rem">${mats.length} item${mats.length !== 1 ? 's' : ''}</span></div>
        <button onclick="openClass('${cls.code}')" style="background:none;border:none;color:var(--accent);font-size:.75rem;cursor:pointer">↻ Refresh</button>
      </div>
      ${mats.length ? mats.slice().reverse().map(m => `
        <div class="material-item" onclick="openMaterial('${m.type}','${encodeURIComponent(m.url || m.content || '')}','${encodeURIComponent(m.title || '')}')">
          <span style="font-size:1.2rem">${ICONS[m.type]||'📄'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.title)}</div>
            <div style="font-size:.7rem;color:var(--muted);margin-top:2px">
              ${m.type.toUpperCase()} · ${m.date || ''}
              ${m.url ? `<span style="color:var(--accent)"> · ${esc(m.url.slice(0,40))}${m.url.length>40?'...':''}</span>` : ''}
            </div>
          </div>
          <span style="color:var(--muted);font-size:1rem;flex-shrink:0">›</span>
        </div>`).join('')
      : '<div class="empty-state"><div class="es-icon">📁</div><div class="es-text">No materials uploaded yet.<br><span style="font-size:.8rem;opacity:.7">Your lecturer will post notes, links and files here.</span></div></div>'}`;
  }

  // ── Announcements ──────────────────────────────────────────
  else if (tab === 'announcements') {
    const anns   = cls.announcements || [];
    const COLORS = { info: '#4f6ef7', warning: '#f59e0b', deadline: '#ef4444', exam: '#7c3aed' };
    const ICONS  = { info: '📘', warning: '⚠️', deadline: '⏰', exam: '📝' };
    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.875rem">
        <div style="font-family:var(--font);font-weight:700;font-size:.9rem">📢 Announcements</div>
        <button onclick="openClass('${cls.code}')" style="background:none;border:none;color:var(--accent);font-size:.75rem;cursor:pointer">↻ Refresh</button>
      </div>
      ${anns.length ? anns.slice().reverse().map(a => {
        const c = COLORS[a.type] || COLORS.info;
        return `
        <div style="background:${c}10;border:1px solid ${c}30;border-radius:12px;padding:12px 14px;margin-bottom:8px">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <span style="font-size:1.1rem;flex-shrink:0">${ICONS[a.type]||'📘'}</span>
            <div style="flex:1">
              <div style="font-size:.88rem;line-height:1.55;color:var(--text)">${esc(a.text)}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:5px">
                <span style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${c}">${a.type||'info'}</span>
                <span style="font-size:.65rem;color:var(--muted)">·</span>
                <span style="font-size:.68rem;color:var(--muted)">📅 ${a.date}</span>
                ${a.author ? `<span style="font-size:.65rem;color:var(--muted)">· ${esc(a.author)}</span>` : ''}
              </div>
            </div>
          </div>
        </div>`}).join('')
      : '<div class="empty-state"><div class="es-icon">📢</div><div class="es-text">No announcements yet.</div></div>'}`;
  }

  // ── Live ───────────────────────────────────────────────────
  else if (tab === 'live') {
    const live = cls.live_class;
    content.innerHTML = live
      ? `<div class="live-class-banner" onclick="window.open('${esc(live.link)}','_blank')">
           <span style="font-size:1.5rem">🔴</span>
           <div>
             <div style="font-weight:700;color:var(--green)">${esc(live.title)}</div>
             <div style="font-size:.75rem;color:var(--muted)">Set ${live.date} · Tap to join</div>
           </div>
           <span style="color:var(--green);margin-left:auto;font-weight:700">Join →</span>
         </div>
         <p style="font-size:.78rem;color:var(--muted)">Check with your lecturer for the session schedule.</p>`
      : '<div class="empty-state"><div class="es-icon">🔴</div><div class="es-text">No live class link set yet.</div></div>';
  }

  // ── Exams ──────────────────────────────────────────────────
  else if (tab === 'exams') {
    const exams = cls.exams || [];
    if (!exams.length) {
      content.innerHTML = '<div class="empty-state"><div class="es-icon">📝</div><div class="es-text">No exams assigned yet.</div></div>';
      return;
    }
    content.innerHTML = exams.map(e => `
      <div class="assign-item">
        <div class="assign-title">📝 ${esc(e.title)}</div>
        <div style="font-size:.75rem;color:var(--muted);margin-bottom:8px">⏱ ${e.duration||60} mins · ${e.questions_per_student||30} questions · Assigned ${e.date||''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-start" style="padding:8px 16px;font-size:.8rem"
            onclick="launchExamMode('${e.id}','${cls.code}')">▶ Take Exam</button>
          <button class="btn-outline" style="padding:8px 16px;font-size:.8rem"
            onclick="viewMyExamResult('${e.id}')">📊 My Results</button>
        </div>
      </div>`).join('');
  }

  // ── Enter Exam by ID ───────────────────────────────────────
  else if (tab === 'exam-entry') {
    content.innerHTML = `
      <div style="max-width:400px">
        <div style="font-family:var(--font);font-weight:700;font-size:.95rem;margin-bottom:.3rem">🎯 Enter Exam by ID</div>
        <p style="font-size:.78rem;color:var(--muted);margin-bottom:1rem">Paste the Exam ID given by your lecturer.</p>
        <input id="exam-id-input" type="text" placeholder="e.g. ab5f5573-b"
          autocomplete="off" spellcheck="false"
          style="width:100%;background:var(--surface);border:2px solid var(--border);border-radius:10px;
                 padding:12px 14px;color:var(--text);font-family:var(--font);font-size:.92rem;outline:none;
                 transition:border-color .2s;box-sizing:border-box;margin-bottom:6px"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
          onkeydown="if(event.key==='Enter') enterExamById()">
        <div id="exam-entry-err" style="color:var(--red);font-size:.78rem;min-height:16px;margin-bottom:8px"></div>
        <button id="exam-entry-btn" class="btn-start" style="width:100%;padding:11px" onclick="enterExamById()">
          ▶ Start Exam
        </button>
        <div id="exam-entry-view" style="margin-top:1rem"></div>
      </div>`;
  }

  // ── Assignments / Tasks ────────────────────────────────────
  else if (tab === 'assignments') {
    const assigns = cls.assignments || [];
    content.innerHTML = assigns.length
      ? assigns.map(a => `
          <div class="assign-item">
            <div class="assign-title">${esc(a.title)}</div>
            <div class="assign-desc">${esc(a.description)}</div>
            <div class="assign-due">⏰ Due: ${esc(a.due_date)}</div>
            <div style="margin-top:10px">
              <textarea id="sub-${a.id}" class="notes-area" style="min-height:80px;margin-bottom:6px"
                placeholder="Type your submission here..."></textarea>
              <button class="btn-start" style="padding:8px 16px;font-size:.8rem"
                onclick="submitAssignment('${cls.code}','${a.id}')">Submit</button>
            </div>
          </div>`).join('')
      : '<div class="empty-state"><div class="es-icon">📋</div><div class="es-text">No assignments yet.</div></div>';
  }

  // ── Class Chat (WhatsApp-style) ────────────────────────────
  else if (tab === 'discuss') {
    content.innerHTML = `
      <div class="wa-chat-wrap" style="height:100%">
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                    background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));
                      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;color:#fff">
            ${esc((cls.name||'?')[0].toUpperCase())}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.9rem">${esc(cls.name)}</div>
            <div style="font-size:.7rem;color:var(--muted)">Class chat</div>
          </div>
          <button onclick="switchClassTab('group-chat',null)"
            style="background:rgba(79,110,247,0.12);border:1px solid rgba(79,110,247,0.25);
                   border-radius:8px;padding:5px 10px;color:var(--accent);font-size:.72rem;
                   cursor:pointer;font-family:var(--font);font-weight:600;flex-shrink:0">
            👥 Groups
          </button>
        </div>
        <div class="wa-messages" id="discuss-msgs" style="flex:1;overflow-y:auto;min-height:0"></div>
        <div class="wa-input-bar" style="flex-shrink:0">
          <textarea id="discuss-input" class="wa-input" rows="1" placeholder="Type a message..."
            oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendDiscussion()}"></textarea>
          <button class="wa-send-btn" onclick="sendDiscussion()">➤</button>
        </div>
      </div>`;
    loadDiscussion(cls.code);
    DISCUSS_INTERVAL = setInterval(() => loadDiscussion(cls.code), 4000);
  }

  // ── Group Chat ─────────────────────────────────────────────
  else if (tab === 'group-chat') {
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="font-family:var(--font);font-weight:700;font-size:.9rem">👥 Group Chats</div>
          <button onclick="showCreateGroup()"
            style="background:var(--accent);color:#fff;border:none;border-radius:8px;
                   padding:5px 12px;font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font)">
            + New Group
          </button>
        </div>
        <div id="group-list-area" style="flex:1;overflow-y:auto;padding:8px"></div>
      </div>`;
    loadGroupList();
  }
}
function openMaterial(type, encodedContent, encodedTitle) {
  const content = decodeURIComponent(encodedContent || '');
  const title   = decodeURIComponent(encodedTitle   || 'Material');
  if (type === 'link') {
    const url = content.startsWith('http') ? content : 'https://' + content;
    window.open(url, '_blank');
  } else {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:300;display:flex;align-items:center;justify-content:center;padding:1.5rem;backdrop-filter:blur(6px)';
    div.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;
                  padding:1.5rem;max-width:540px;width:100%;max-height:78vh;overflow-y:auto;
                  box-shadow:0 24px 60px #00000060">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <span style="font-weight:700;font-family:var(--font);font-size:.95rem">📝 ${esc(title)}</span>
          <button onclick="this.closest('div[style*=position]').remove()"
            style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;
                   padding:2px 6px;border-radius:6px;transition:color .15s"
            onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--muted)'">✕</button>
        </div>
        <div style="white-space:pre-wrap;font-size:.88rem;line-height:1.7;color:var(--text)">${esc(content)}</div>
      </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', e => { if (e.target === div) div.remove(); });
  }
}

async function loadDiscussion(code) {
  const msgs = $('discuss-msgs');
  if (!msgs) return;
  try {
    const r = await fetch(`/api/class/discuss?code=${encodeURIComponent(code)}`);
    const d = await r.json();
    const messages = d.messages || [];
    if (!messages.length) {
      msgs.innerHTML = `<div style="text-align:center;padding:2rem">
        <div style="font-size:2rem;margin-bottom:.5rem">💬</div>
        <div style="font-size:.84rem;color:var(--muted)">No messages yet — say hello!</div>
      </div>`;
      return;
    }
    const atBottom = msgs.scrollHeight - msgs.scrollTop <= msgs.clientHeight + 60;
    let lastDate = '';
    msgs.innerHTML = messages.map(m => {
      const mine    = m.sid === S.sid;
      const msgDate = m.date ? m.date.split(' ')[0] : '';
      let divider   = '';
      if (msgDate !== lastDate) {
        lastDate  = msgDate;
        const today     = new Date().toISOString().slice(0,10);
        const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
        const label = msgDate === today ? 'Today' : msgDate === yesterday ? 'Yesterday' : msgDate;
        divider = `<div class="wa-date-divider"><span>${label}</span></div>`;
      }
      const time = m.date ? m.date.split(' ')[1] || '' : '';
      return `${divider}
      <div class="wa-msg-row ${mine ? 'mine' : ''}">
        <div class="wa-av ${mine ? 'mine' : ''}">${(m.name||'?')[0].toUpperCase()}</div>
        <div class="wa-bubble ${mine ? 'mine' : 'theirs'}">
          ${!mine ? `<div class="wa-sender">${esc(m.name)}</div>` : ''}
          <div>${esc(m.message)}</div>
          <div class="wa-time">${time}</div>
        </div>
      </div>`;
    }).join('');
    if (atBottom) msgs.scrollTop = msgs.scrollHeight;
  } catch {}
}

async function sendDiscussion() {
  const input = $('discuss-input');
  const msg   = input?.value.trim();
  if (!msg || !CURRENT_CLASS) return;
  input.value = '';
  input.style.height = 'auto';
  // Optimistic UI — show immediately
  const msgs = $('discuss-msgs');
  if (msgs) {
    const now  = new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
    const div  = document.createElement('div');
    div.className = 'wa-msg-row mine';
    div.innerHTML = `
      <div class="wa-av mine">${S.name?.[0]?.toUpperCase()||'U'}</div>
      <div class="wa-bubble mine">
        <div>${esc(msg)}</div>
        <div class="wa-time">${now}</div>
      </div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }
  try {
    await fetch('/api/class/discuss', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sid: S.sid, code: CURRENT_CLASS.code, message: msg, name: S.name })
    });
  } catch { toast('Could not send message.'); }
}

// ── Group Chat JS ──────────────────────────────────────────────

let CURRENT_GROUP = null;
let GROUP_INTERVAL = null;

async function loadGroupList() {
  const area = $('group-list-area');
  if (!area) return;
  try {
    const r = await fetch(`/api/group/list?sid=${encodeURIComponent(S.sid)}`);
    const d = await r.json();
    const groups = d.groups || [];
    if (!groups.length) {
      area.innerHTML = `
        <div class="empty-state" style="margin-top:1.5rem">
          <div class="es-icon">👥</div>
          <div class="es-text">No groups yet.<br><span style="font-size:.78rem;opacity:.7">Create one or ask a classmate to share their group ID.</span></div>
        </div>
        <div style="margin-top:1rem;text-align:center">
          <input id="join-group-inp" class="sh-input" placeholder="Enter Group ID to join..."
            style="max-width:260px;margin-bottom:8px">
          <button class="btn-start" style="padding:7px 16px;font-size:.8rem;display:block;margin:0 auto"
            onclick="joinGroupById()">Join Group</button>
        </div>`;
      return;
    }
    area.innerHTML = `
      ${groups.map(g => `
        <div class="group-item" onclick="openGroupChat('${g.id}','${esc(g.name)}')">
          <div class="group-av">${g.name[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.88rem">${esc(g.name)}</div>
            <div style="font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(g.last_msg || 'No messages yet')}
            </div>
          </div>
          <div style="font-size:.65rem;color:var(--muted);flex-shrink:0;margin-left:8px">
            👥 ${g.member_count}
          </div>
        </div>`).join('')}
      <div style="margin-top:.75rem;padding:.875rem;background:var(--surface);border:1px solid var(--border);border-radius:10px">
        <div style="font-size:.75rem;font-weight:600;color:var(--muted);margin-bottom:6px">Join another group</div>
        <div style="display:flex;gap:8px">
          <input id="join-group-inp" class="sh-input" placeholder="Group ID..." style="flex:1;font-size:.82rem">
          <button class="sh-add-btn" onclick="joinGroupById()">Join</button>
        </div>
      </div>`;
  } catch { if (area) area.innerHTML = '<div style="color:var(--muted);padding:1rem;font-size:.84rem">Could not load groups.</div>'; }
}

function showCreateGroup() {
  const area = $('group-list-area');
  if (!area) return;
  area.innerHTML = `
    <div style="padding:.5rem 0">
      <div style="font-family:var(--font);font-weight:700;font-size:.9rem;margin-bottom:.75rem">Create Group Chat</div>
      <input id="new-group-name" class="sh-input" placeholder="Group name e.g. Study Squad, BIO 201..."
        style="margin-bottom:8px" onkeydown="if(event.key==='Enter') createGroup()">
      <button class="btn-start" style="width:100%;padding:10px" onclick="createGroup()">Create Group</button>
      <button onclick="loadGroupList()" style="width:100%;margin-top:6px;background:none;border:1px solid var(--border);
        border-radius:8px;padding:9px;color:var(--muted);cursor:pointer;font-family:var(--font-body);font-size:.84rem">Cancel</button>
      <p style="font-size:.72rem;color:var(--muted);margin-top:.75rem;line-height:1.5">
        💡 Share your Group ID with classmates so they can join. Full username-based invites coming soon.
      </p>
    </div>`;
  $('new-group-name').focus();
}

async function createGroup() {
  const name = $('new-group-name')?.value.trim();
  if (!name) { toast('Enter a group name.'); return; }
  try {
    const r = await fetch('/api/group/create', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sid: S.sid, name })
    });
    const d = await r.json();
    toast(`Group "${name}" created ✓ ID: ${d.group_id}`);
    // Show the ID so they can share it
    const area = $('group-list-area');
    if (area) {
      area.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.25rem;text-align:center">
          <div style="font-size:1.5rem;margin-bottom:.5rem">🎉</div>
          <div style="font-family:var(--font);font-weight:700;margin-bottom:.5rem">Group Created!</div>
          <div style="font-size:.78rem;color:var(--muted);margin-bottom:.75rem">Share this ID with classmates:</div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
                      padding:10px;font-family:monospace;font-size:.9rem;letter-spacing:.05em;margin-bottom:.75rem">${d.group_id}</div>
          <button onclick="navigator.clipboard.writeText('${d.group_id}').then(()=>toast('ID copied ✓'))"
            class="btn-start" style="padding:8px 20px;font-size:.8rem;margin-bottom:8px">📋 Copy ID</button>
          <br>
          <button onclick="openGroupChat('${d.group_id}','${esc(name)}')"
            class="btn-start" style="padding:8px 20px;font-size:.8rem;background:#22c55e">Open Chat →</button>
        </div>`;
    }
  } catch { toast('Could not create group.'); }
}

async function joinGroupById() {
  const gid = $('join-group-inp')?.value.trim();
  if (!gid) { toast('Enter a Group ID.'); return; }
  try {
    const r = await fetch('/api/group/join', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sid: S.sid, group_id: gid })
    });
    if (!r.ok) { const e = await r.json(); toast(e.detail || 'Group not found.'); return; }
    const d = await r.json();
    toast(`Joined "${d.name}" ✓`);
    loadGroupList();
  } catch { toast('Could not join group.'); }
}

function openGroupChat(gid, gname) {
  CURRENT_GROUP = { id: gid, name: gname };
  clearInterval(GROUP_INTERVAL);
  const content = $('class-tab-content');
  if (!content) return;
  content.style.padding       = '0';
  content.style.display       = 'flex';
  content.style.flexDirection = 'column';
  content.style.overflow      = 'hidden';
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0">
      <button onclick="clearInterval(GROUP_INTERVAL);switchClassTab('group-chat',null)"
        style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;padding:2px 6px">←</button>
      <div class="group-av" style="width:32px;height:32px;font-size:.75rem;flex-shrink:0">${gname[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.9rem">${esc(gname)}</div>
        <div style="font-size:.68rem;color:var(--muted)">
          ID: ${gid}
          <button onclick="navigator.clipboard.writeText('${gid}').then(()=>toast('ID copied ✓'))"
            style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:.68rem;padding:0 3px">copy</button>
        </div>
      </div>
    </div>
    <div class="wa-messages" id="group-msgs" style="flex:1;overflow-y:auto;min-height:0"></div>
    <div class="wa-input-bar" style="flex-shrink:0">
      <textarea id="group-input" class="wa-input" rows="1" placeholder="Message..."
        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendGroupMessage()}"></textarea>
      <button class="wa-send-btn" onclick="sendGroupMessage()">➤</button>
    </div>`;
  loadGroupMessages();
  GROUP_INTERVAL = setInterval(loadGroupMessages, 4000);
}

async function loadGroupMessages() {
  const msgs = $('group-msgs');
  if (!msgs || !CURRENT_GROUP) return;
  try {
    const r = await fetch(`/api/group/messages?group_id=${CURRENT_GROUP.id}&sid=${encodeURIComponent(S.sid)}`);
    const d = await r.json();
    const messages = d.messages || [];
    const atBottom = msgs.scrollHeight - msgs.scrollTop <= msgs.clientHeight + 60;
    if (!messages.length) {
      msgs.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--muted);font-size:.84rem">No messages yet — say hello! 👋</div>`;
      return;
    }
    let lastDate = '';
    msgs.innerHTML = messages.map(m => {
      const mine    = m.sid === S.sid;
      const msgDate = m.date ? m.date.split(' ')[0] : '';
      let divider   = '';
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const today = new Date().toISOString().slice(0,10);
        const label = msgDate === today ? 'Today' : msgDate;
        divider = `<div class="wa-date-divider"><span>${label}</span></div>`;
      }
      const time = m.date ? m.date.split(' ')[1] || '' : '';
      return `${divider}
      <div class="wa-msg-row ${mine ? 'mine' : ''}">
        <div class="wa-av ${mine ? 'mine' : ''}">${(m.name||'?')[0].toUpperCase()}</div>
        <div class="wa-bubble ${mine ? 'mine' : 'theirs'}">
          ${!mine ? `<div class="wa-sender">${esc(m.name)}</div>` : ''}
          <div>${esc(m.message)}</div>
          <div class="wa-time">${time}</div>
        </div>
      </div>`;
    }).join('');
    if (atBottom) msgs.scrollTop = msgs.scrollHeight;
  } catch {}
}

async function sendGroupMessage() {
  const input = $('group-input');
  const msg   = input?.value.trim();
  if (!msg || !CURRENT_GROUP) return;
  input.value = '';
  input.style.height = 'auto';
  const msgs = $('group-msgs');
  if (msgs) {
    const now = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const div = document.createElement('div');
    div.className = 'wa-msg-row mine';
    div.innerHTML = `
      <div class="wa-av mine">${S.name?.[0]?.toUpperCase()||'U'}</div>
      <div class="wa-bubble mine"><div>${esc(msg)}</div><div class="wa-time">${now}</div></div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }
  try {
    await fetch('/api/group/message', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sid: S.sid, group_id: CURRENT_GROUP.id, message: msg, name: S.name })
    });
  } catch { toast('Could not send.'); }
}

// ── Exam.net-style full-screen exam mode ───────────────────────

async function launchExamMode(examId, code) {
  // Show a full-screen overlay
  let overlay = $('exam-fullscreen-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'exam-fullscreen-overlay';
    overlay.className = 'exam-fullscreen';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="exam-body" style="padding-top:2rem;text-align:center">
    <div style="font-size:1.5rem;margin-bottom:.5rem">⏳</div>
    <div style="color:var(--muted);font-size:.88rem">Loading exam...</div>
  </div>`;
  overlay.style.display = 'flex';

  try {
    const r = await fetch('/api/exam/start', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sid: S.sid, exam_id: examId, code })
    });
    if (r.status === 409) {
      overlay.innerHTML = `<div class="exam-body" style="text-align:center;padding-top:3rem">
        <div style="font-size:2.5rem;margin-bottom:.75rem">✅</div>
        <div style="font-family:var(--font);font-weight:700;font-size:1.1rem;margin-bottom:.5rem">Already Submitted</div>
        <div style="color:var(--muted);font-size:.84rem;margin-bottom:1.5rem">You have already completed this exam.</div>
        <button onclick="closeExamMode()" class="btn-start" style="padding:10px 28px">← Back</button>
      </div>`; return;
    }
    if (!r.ok) throw new Error((await r.json()).detail || 'Failed to load exam');
    const d = await r.json();
    EXAM_STATE = { examId, code, questions: d.questions, answers: {}, timerInterval: null,
                   timeLeft: d.duration * 60, tabSwitches: 0, title: d.title };
    renderExamModeUI(overlay);
    startExamTimer();
    setupAntiCheat();
  } catch(e) {
    overlay.innerHTML = `<div class="exam-body" style="text-align:center;padding-top:3rem">
      <div style="font-size:2rem;margin-bottom:.5rem">⚠️</div>
      <div style="color:var(--muted);font-size:.84rem;margin-bottom:1.5rem">${esc(e.message)}</div>
      <button onclick="closeExamMode()" class="btn-start" style="padding:10px 28px">← Back</button>
    </div>`;
  }
}

function closeExamMode() {
  clearInterval(EXAM_STATE?.timerInterval);
  document.removeEventListener('visibilitychange', handleTabSwitch);
  const overlay = $('exam-fullscreen-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; }
}

function renderExamModeUI(overlay) {
  const q   = EXAM_STATE.questions;
  const tot = q.length;
  overlay.innerHTML = `
    <!-- Progress strip -->
    <div class="exam-progress-strip"><div id="exam-prog-fill" class="exam-progress-fill" style="width:0%"></div></div>

    <!-- Top bar -->
    <div class="exam-topbar">
      <div>
        <div style="font-family:var(--font);font-weight:700;font-size:.9rem;color:#e5e7eb;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">
          ${esc(EXAM_STATE.title)}
        </div>
        <div style="font-size:.7rem;color:#6b7280;margin-top:1px">
          <span id="exam-answered-count">0</span>/${tot} answered
        </div>
      </div>
      <!-- Tab switch warning -->
      <div id="exam-tab-warn" style="display:none;background:#ef444415;border:1px solid #ef444430;
           border-radius:8px;padding:4px 10px;font-size:.72rem;color:#ef4444">
        ⚠️ Tab switch: <span id="exam-tab-count">0</span>x
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div id="exam-timer" class="exam-timer-pill"
          style="background:#4f6ef715;color:#818cf8;border:1px solid #4f6ef730">--:--</div>
        <button onclick="confirmSubmitExam()"
          style="background:#22c55e;color:#fff;border:none;border-radius:8px;
                 padding:7px 14px;font-family:var(--font);font-weight:700;font-size:.82rem;cursor:pointer">
          Submit
        </button>
      </div>
    </div>

    <!-- Questions body -->
    <div class="exam-body" id="exam-questions-body">
      ${q.map((question, i) => `
        <div class="exam-q-block" id="eq-${i}">
          <div class="exam-q-label">Question ${i+1} of ${tot}</div>
          <div class="exam-q-text">${esc(question.question)}</div>
          <div>
            ${Object.entries(question.options || {}).map(([letter, text]) => `
              <button class="exam-option" id="eq-${i}-${letter}"
                onclick="selectExamAnswer(${i},'${letter}')">
                <span class="exam-opt-key">${letter}</span>
                <span>${esc(text)}</span>
              </button>`).join('')}
          </div>
        </div>`).join('')}
      <div style="text-align:center;padding:1.5rem 0 3rem">
        <button onclick="confirmSubmitExam()"
          style="background:var(--accent);color:#fff;border:none;border-radius:10px;
                 padding:13px 40px;font-family:var(--font);font-weight:700;font-size:.9rem;cursor:pointer">
          Submit Exam
        </button>
      </div>
    </div>`;
}



async function submitAssignment(code, assignId) {
  const ta      = $(`sub-${assignId}`);
  const content = ta?.value.trim();
  if (!content) { toast('Write your submission first.'); return; }
  try {
    const r = await fetch('/api/class/submit', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sid: S.sid, code, assignment_id: assignId, content })
    });
    if (!r.ok) throw new Error();
    toast('Assignment submitted ✓');
    if (ta) ta.value = '';
  } catch { toast('Submission failed — try again.'); }
}

async function confirmLeaveClass(code) {
  if (!await siModal.confirm('You will lose access to class materials and discussions.', { title:'Leave Class', confirmLabel:'Leave', danger:true })) return;
  await fetch('/api/class/leave', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ sid: S.sid, code })
  });
  toast('Left class ✓');
  clearInterval(DISCUSS_INTERVAL);
  loadClasses();
}


async function loadLeaderboard() {
  const list = $('leaderboard-list');
  if (!S.sid) return;

  list.innerHTML = '<div class="empty-state"><div class="es-icon">⏳</div><div class="es-text">Loading...</div></div>';

  try {
    const r = await fetch('/api/leaderboard');
    const d = await r.json();
    const students = d.leaderboard || [];

    if (!students.length) {
      list.innerHTML = '<div class="empty-state"><div class="es-icon">🏆</div><div class="es-text">No rankings yet — take a quiz to appear here!</div></div>';
      return;
    }

    const medals = ['🥇','🥈','🥉'];
    list.innerHTML = students.map((s, i) => {
      const isMe = s.sid === S.sid;
      const rank = i + 1;
      return `
        <div class="lb-item ${isMe ? 'me' : ''}">
          <div class="lb-rank">${rank <= 3 ? medals[rank-1] : rank}</div>
          <div class="lb-avatar">${s.name[0].toUpperCase()}</div>
          <div class="lb-info">
            <div class="lb-name">${esc(s.name)} ${isMe ? '<span style="color:var(--accent);font-size:.7rem">(you)</span>' : ''}</div>
            <div class="lb-meta">${s.quizzes} quiz${s.quizzes !== 1 ? 'zes' : ''} · ${s.questions} questions</div>
          </div>
          <div class="lb-score">${s.avg_score}%</div>
        </div>`;
    }).join('');

    // Show my rank card
    const myRank = students.findIndex(s => s.sid === S.sid);
    if (myRank !== -1) {
      const me = students[myRank];
      $('my-rank-card').style.display = 'block';
      { const _e = $('my-rank-num'); if (_e) _e.textContent = `#${myRank + 1}`; }
      { const _e = $('my-rank-name'); if (_e) _e.textContent = me.name; }
      { const _e = $('my-rank-score'); if (_e) _e.textContent = `${me.avg_score}% avg · ${me.quizzes} quizzes`; }
    }

  } catch(e) {
    list.innerHTML = '<div class="empty-state"><div class="es-icon">⚠️</div><div class="es-text">Couldn\'t load leaderboard — try again.</div></div>';
  }
}

// ═══════════════════════════ NOTES ══════════════════════════════
function loadNotes() {
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');
  renderNotes(notes);
  noteRenderTagBar(notes);
}

function renderNotes(notes, filter = '') {
  const list = $('notes-list'); if (!list) return;
  let display = notes;
  if (filter === '__search__') {
    const q = $('note-search')?.value.trim().toLowerCase();
    display  = q ? notes.filter(n => n.text.toLowerCase().includes(q) || (n.tag||'').toLowerCase().includes(q)) : notes;
  } else if (filter) {
    display = notes.filter(n => (n.tag||'').toLowerCase() === filter.toLowerCase());
  }
  if (!display.length) {
    list.innerHTML = `<div class="empty-state"><div class="es-icon">📓</div><div class="es-text">${filter ? 'No notes with this tag.' : 'No notes yet — tap New Note!'}</div></div>`;
    return;
  }
  list.innerHTML = display.map((n, i) => {
    const realIdx = notes.indexOf(n);
    const lines   = n.text.split('\n');
    const title   = lines[0].slice(0, 55) + (lines[0].length > 55 || lines.length > 1 ? '...' : '');
    const words   = n.text.trim().split(/\s+/).length;
    return `
      <div class="note-accordion" id="note-acc-${i}">
        <div class="note-acc-header" onclick="toggleNote(${i})">
          <div style="flex:1;min-width:0">
            <div class="note-acc-title">${esc(title)}</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
              ${n.tag ? `<span style="background:#4f6ef715;border:1px solid #4f6ef730;border-radius:10px;padding:1px 7px;font-size:.65rem;color:var(--accent);font-weight:700">${esc(n.tag)}</span>` : ''}
              <span class="note-acc-date">📅 ${n.date}</span>
              <span style="font-size:.65rem;color:var(--muted)">${words} words</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
            <button onclick="event.stopPropagation();noteEdit(${realIdx})"
              style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--muted);font-size:.7rem;cursor:pointer;transition:all .15s"
              onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
              onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">Edit</button>
            <button onclick="event.stopPropagation();deleteNote(${realIdx})"
              style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--muted);font-size:.7rem;cursor:pointer;transition:all .15s"
              onmouseover="this.style.borderColor='var(--red)';this.style.color='var(--red)'"
              onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">Delete</button>
            <span class="note-acc-arrow" id="note-arrow-${i}">▼</span>
          </div>
        </div>
        <div class="note-acc-body" id="note-body-${i}" style="display:none">
          <div style="white-space:pre-wrap;font-size:.86rem;line-height:1.7;padding:.75rem 0;color:var(--text)">${esc(n.text)}</div>
        </div>
      </div>`;
  }).join('');
}

  function noteToggleForm() {
  const form = $('note-write-form');
  const open = form.style.display === 'none' || !form.style.display;
  form.style.display = open ? 'block' : 'none';
  if (open) {
    $('new-note-text').focus();
    delete $('new-note-text').dataset.editIdx;
    if ($('note-tag-input')) $('note-tag-input').value = '';
    if ($('new-note-text')) $('new-note-text').value = '';
    noteCharCount();
  }
}

function noteCharCount() {
  const ta  = $('new-note-text'); if (!ta) return;
  const wc  = ta.value.trim().split(/\s+/).filter(Boolean).length;
  const el  = $('note-char-count'); if (el) el.textContent = `${wc} word${wc!==1?'s':''}`;
}

function noteSearch() {
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');
  renderNotes(notes, '__search__');
}

function noteRenderTagBar(notes) {
  const bar = $('note-tag-bar'); if (!bar) return;
  const tags = [...new Set(notes.map(n => n.tag).filter(Boolean))];
  if (!tags.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = [`<button onclick="noteFilterTag('',this)" style="padding:4px 12px;border-radius:20px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-family:var(--font);font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s" class="note-tag-filter active">All</button>`,
    ...tags.map(t => `<button onclick="noteFilterTag('${esc(t)}',this)" style="padding:4px 12px;border-radius:20px;border:1px solid var(--border);background:var(--card);color:var(--muted);font-family:var(--font);font-size:.72rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s" class="note-tag-filter">${esc(t)}</button>`)
  ].join('');
}

function noteFilterTag(tag, btn) {
  document.querySelectorAll('.note-tag-filter').forEach(b => {
    b.style.background = 'var(--card)'; b.style.color = 'var(--muted)'; b.style.borderColor = 'var(--border)';
  });
  btn.style.background = 'linear-gradient(135deg,var(--accent),var(--accent2))';
  btn.style.color = '#fff'; btn.style.borderColor = 'transparent';
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');
  renderNotes(notes, tag);
}

function noteEdit(idx) {
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');
  const note  = notes[idx]; if (!note) return;
  const ta    = $('new-note-text');
  const form  = $('note-write-form');
  if (ta) { ta.value = note.text; ta.dataset.editIdx = idx; }
  if ($('note-tag-input')) $('note-tag-input').value = note.tag || '';
  if (form) form.style.display = 'block';
  noteCharCount();
  ta?.focus();
  form?.scrollIntoView({ behavior: 'smooth' });
}
  
function toggleNote(idx) {
  const body  = $(`note-body-${idx}`);
  const arrow = $(`note-arrow-${idx}`);
  if (!body) return;
  const open = body.style.display === 'block';
  body.style.display  = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▼' : '▲';
}

function saveNote() {
  const ta   = $('new-note-text');
  const text = ta?.value.trim();
  const tag  = $('note-tag-input')?.value.trim() || '';
  if (!text) { toast('Write something first!'); return; }

  const raw     = localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]';
  const notes   = JSON.parse(raw);
  const editIdx = (ta.dataset.editIdx !== undefined && ta.dataset.editIdx !== '')
    ? parseInt(ta.dataset.editIdx) : -1;

  if (editIdx >= 0 && editIdx < notes.length) {
    notes[editIdx].text = text;
    notes[editIdx].tag  = tag;
    notes[editIdx].date = new Date().toLocaleString() + ' (edited)';
    delete ta.dataset.editIdx;
    toast('Note updated ✓');
  } else {
    notes.unshift({ text, tag, date: new Date().toLocaleString() });
    toast('Note saved ✓');
  }

  const trimmed = notes.slice(0, 100);
  localStorage.setItem(`sivarr_notes_${S.sid}`, JSON.stringify(trimmed));
  ta.value = '';
  if ($('note-tag-input')) $('note-tag-input').value = '';
  noteCharCount();
  $('note-write-form').style.display = 'none';
  renderNotes(trimmed);
  noteRenderTagBar(trimmed);
}

function deleteNote(idx) {
  const raw   = localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]';
  const notes = JSON.parse(raw);
  notes.splice(idx, 1);
  localStorage.setItem(`sivarr_notes_${S.sid}`, JSON.stringify(notes));
  renderNotes(notes);
  toast('Note deleted');
}

// Character counter for notes
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('new-note-text');
  if (ta) {
    ta.addEventListener('input', () => {
      const len = ta.value.length;
      const counter = $('note-char-count');
      if (counter) {
        counter.textContent = `${len} / 1000`;
        counter.style.color = len > 900 ? 'var(--yellow)' : len > 999 ? 'var(--red)' : 'var(--muted)';
      }
    });
  }
});


// ═══════════════════════════ PROFILE DROPDOWN ═══════════════════
function toggleProfile() {
  const trigger  = $('profile-trigger');
  const dropdown = $('profile-dropdown');
  if (!trigger || !dropdown) return;
  const isOpen = dropdown.classList.contains('open');
  if (isOpen) { closeProfile(); }
  else { trigger.classList.add('open'); dropdown.classList.add('open'); }
}

function closeProfile() {
  const t = $('profile-trigger'); if (t) t.classList.remove('open');
  const d = $('profile-dropdown'); if (d) d.classList.remove('open');
}

document.addEventListener('click', e => {
  const menu = $('profile-menu');
  if (menu && !menu.contains(e.target)) closeProfile();
});

function toggleThemeFromMenu() {
  const html    = document.documentElement;
  const isDark  = html.getAttribute('data-theme') === 'dark';
  if (isDark) html.removeAttribute('data-theme');
  else        html.setAttribute('data-theme', 'dark');
  const nowDark = !isDark;

  const sw        = $('pd-toggle-sw');
  const icon      = $('pd-theme-icon');
  const label     = $('pd-theme-label');
  const themeIcon = $('theme-icon');

  if (sw)        sw.classList.toggle('on', nowDark);
  if (icon)      icon.className = nowDark ? 'ti ti-moon pd-icon'  : 'ti ti-sun pd-icon';
  if (label)     label.textContent = nowDark ? 'Dark Mode' : 'Light Mode';
  if (themeIcon) themeIcon.className = nowDark ? 'ti ti-moon' : 'ti ti-sun';

  localStorage.setItem('sivarr_theme', nowDark ? 'dark' : 'light');
}

function toggleTheme() { toggleThemeFromMenu(); }

// Apply saved theme on load
window.addEventListener('DOMContentLoaded', () => {
  sbRestoreCollapse();
  if (localStorage.getItem('sivarr_theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const sw        = $('pd-toggle-sw');    if (sw)        sw.classList.add('on');
    const icon      = $('pd-theme-icon');   if (icon)      icon.className = 'ti ti-moon pd-icon';
    const label     = $('pd-theme-label');  if (label)     label.textContent = 'Dark Mode';
    const themeIcon = $('theme-icon');      if (themeIcon) themeIcon.className = 'ti ti-moon';
  }
});

// ═══════════════════════════ FILE UPLOAD ════════════════════════
async function uploadFile(input) {
  const file = input.files[0];
  if (!file || !S.sid) return;
  const zone = $('upload-zone');
  zone.innerHTML = `<div class="uz-icon">⏳</div><div class="uz-text">Uploading ${file.name}...</div>`;

  const formData = new FormData();
  formData.append('sid', S.sid);
  formData.append('file', file);

  try {
    const r = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Upload failed'); }
    const d = await r.json();

    // Reset zone
    zone.innerHTML = `<div class="uz-icon">📄</div><div class="uz-text">Drop a file or tap to upload</div><div class="uz-sub">.txt · .pdf · .md supported</div>`;

    // Show summary in chat
    addMsg('sivarr', `📎 File uploaded: ${d.filename}\n\n${d.summary}`);

    // Update file list
    S.uploadedFiles = S.uploadedFiles || [];
    S.uploadedFiles.push({ id: d.file_id, name: d.filename });
    renderFileList();

    toast(`${file.name} uploaded ✓`);
  } catch(e) {
    zone.innerHTML = `<div class="uz-icon">📄</div><div class="uz-text">Drop a file or tap to upload</div><div class="uz-sub">.txt · .pdf · .md supported</div>`;
    toast('Upload failed: ' + e.message);
  }
  input.value = '';
}

function handleDrop(e) {
  e.preventDefault();
  $('upload-zone').classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  $('file-input').files = dt.files;
  uploadFile($('file-input'));
}

function renderFileList() {
  const list = $('file-list');
  if (!list || !S.uploadedFiles || !S.uploadedFiles.length) return;
  list.innerHTML = S.uploadedFiles.map(f => `
    <div class="file-item">
      <div>
        <div class="fi-name">📄 ${esc(f.name)}</div>
      </div>
      <button class="btn-file-quiz" onclick="quizFromFile('${f.id}')">Quiz me</button>
    </div>`).join('');
}

function quizFromFile(fileId) {
  S.quizFileId = fileId;
  nav('quiz', $('mn-quiz') || document.querySelector('.nav-btn[onclick*="quiz"]'));
  startQuizFromFile(fileId);
}

async function startQuizFromFile(fileId) {
  S.quizActive = true; S.quizQ = 0; S.quizScore = 0; S.quizFileId = fileId;
  const qw = $('qw');
  qw.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--muted)">Generating question 1/5 from your document...</div>`;
  const r = await fetch(`/api/quiz/question?sid=${S.sid}&difficulty=${S.diff}&file_id=${fileId}`);
  const q = await r.json();
  if (q.error) { toast(q.error); resetQuiz(); return; }
  S.curQ = q;
  renderQ(q);
}

// ═══════════════════════════ DOWNLOAD ═══════════════════════════
function downloadText(text) {
  const clean = text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
  const blob = new Blob([`Sivarr AI Response\n${'─'.repeat(40)}\n\n${clean}\n\nDownloaded from Sivarr AI`], {type:'text/plain'});
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `sivarr_answer_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════ SHARE ══════════════════════════════
async function shareResult(score, topic) {
  try {
    const r = await API('/api/share', {
      name: S.name, score: score, topic: topic,
      difficulty: S.diff, type: 'quiz',
    });
    const url = window.location.origin + r.url;
    // Copy to clipboard
    await navigator.clipboard.writeText(url);
    toast('Share link copied to clipboard! 🔗');
  } catch(e) {
    toast('Could not create share link — try again.');
  }
      }

//      MOBILE BUTTON 
(function () {
  const fab = document.getElementById('mob-fab');
  let dragging = false, startX, startY, initLeft, initBottom;

  function getPos() {
    const r = fab.getBoundingClientRect();
    return {
      left: r.left,
      bottom: window.innerHeight - r.bottom
    };
  }

  fab.addEventListener('pointerdown', e => {
    dragging = false;
    const pos = getPos();
    startX  = e.clientX;
    startY  = e.clientY;
    initLeft   = pos.left;
    initBottom = pos.bottom;
    fab.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  fab.addEventListener('pointermove', e => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 6) dragging = true;
    if (!dragging) return;

    // Clamp within viewport
    const size = 46;
    const margin = 10;
    let newLeft   = Math.min(Math.max(initLeft   + dx, margin), window.innerWidth  - size - margin);
    let newBottom = Math.min(Math.max(initBottom - dy, margin), window.innerHeight - size - margin);

    fab.style.left   = newLeft   + 'px';
    fab.style.bottom = newBottom + 'px';
    fab.style.right  = 'auto';
    fab.style.top    = 'auto';
  });

  fab.addEventListener('pointerup', () => {
    if (!dragging) toggleMobileSidebar(); // treat as tap if no drag
    dragging = false;
  });
})();

// ═══════════════════════════════════════════════════════════════
// FEATURE 1 — QUICK CAPTURE (cmd palette extension)
// ═══════════════════════════════════════════════════════════════

function qcCapture(type) {
  if (!S.sid) return;
  const text = ($('cmd-input')?.value || '').trim();
  if (!text) { cmdDismiss(); return; }

  const ts   = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  const sid  = S.sid;

  if (type === 'task') {
    const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${sid}`) || '[]');
    tasks.unshift({ id: Date.now(), title: text, done: false, priority: 'medium', created: Date.now() });
    localStorage.setItem(`sivarr_tasks_${sid}`, JSON.stringify(tasks));
    toast(`📋 Task captured: "${text.slice(0,40)}"`);
  } else if (type === 'event') {
    const events = JSON.parse(localStorage.getItem(`sivarr_cal_${sid}`) || '[]');
    events.push({ id: Date.now(), title: text, date: new Date().toISOString().split('T')[0], time: '' });
    localStorage.setItem(`sivarr_cal_${sid}`, JSON.stringify(events));
    toast(`📅 Event captured: "${text.slice(0,40)}"`);
  } else if (type === 'journal') {
    const entries = JSON.parse(localStorage.getItem(`sivarr_journal_${sid}`) || '[]');
    entries.unshift({ id: Date.now(), text, date: ts, prompt: '' });
    localStorage.setItem(`sivarr_journal_${sid}`, JSON.stringify(entries));
    toast(`📓 Journal entry saved`);
  } else if (type === 'goal') {
    const goals = JSON.parse(localStorage.getItem(`sivarr_goals_${sid}`) || '[]');
    goals.unshift({ id: Date.now(), title: text, progress: 0, completed: false, created: Date.now() });
    localStorage.setItem(`sivarr_goals_${sid}`, JSON.stringify(goals));
    toast(`🎯 Goal captured: "${text.slice(0,40)}"`);
  } else if (type === 'note') {
    docCaptureNote(text);
    toast(`💡 Note saved to Docs`);
  }

  cmdDismiss();
}

// ═══════════════════════════════════════════════════════════════
// FEATURE 2 — DAILY SIVA BRIEF
// ═══════════════════════════════════════════════════════════════

function briefCheck() {
  if (!S.sid) return;
  const today = new Date().toDateString();
  const seen  = localStorage.getItem(`sivarr_brief_${S.sid}`);
  if (seen === today) return;
  briefBuild();
  $('brief-overlay').classList.add('open');
}

function briefDismiss() {
  if (!S.sid) return;
  localStorage.setItem(`sivarr_brief_${S.sid}`, new Date().toDateString());
  $('brief-overlay')?.classList.remove('open');
}

function briefBuild() {
  const hr        = new Date().getHours();
  const tod       = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (S.name || 'there').split(' ')[0];
  const day       = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });

  const greetEl = $('brief-greeting');
  if (greetEl) greetEl.textContent = `${tod}, ${firstName} 👋`;
  const dateEl = $('brief-date-line');
  if (dateEl) dateEl.textContent = day;

  // Build SIVA message
  let msg = `Here's your day at a glance, ${firstName}. `;
  const tasks      = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]').filter(t => !t.done);
  const habits     = JSON.parse(localStorage.getItem(`sivarr_habits_${S.sid}`) || '[]');
  const goals      = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]').filter(g => !g.completed);
  const journalLen = JSON.parse(localStorage.getItem(`sivarr_journal_${S.sid}`) || '[]').length;

  if (tasks.length)   msg += `You have ${tasks.length} task${tasks.length > 1 ? 's' : ''} pending. `;
  if (goals.length)   msg += `${goals.length} active goal${goals.length > 1 ? 's' : ''} in progress. `;
  if (journalLen > 0) msg += `Keep your journaling streak alive — write something today. `;
  if (!tasks.length && !goals.length) msg += `Looks like a clean slate — great time to set a goal or plan your day.`;

  const msgEl = $('brief-msg');
  if (msgEl) msgEl.textContent = msg;

  // Build chips
  const chips   = [];
  const urgentT = tasks.filter(t => t.priority === 'high').slice(0, 2);
  urgentT.forEach(t => chips.push({ icon:'🔴', label: t.title.slice(0, 28), cls:'urgent' }));

  const streakH = habits.find(h => (h.streak || 0) > 1);
  if (streakH) chips.push({ icon:'🔥', label:`${streakH.streak} day streak`, cls:'streak' });

  const nextGoal = goals[0];
  if (nextGoal) chips.push({ icon:'🎯', label: nextGoal.title.slice(0, 28), cls:'goal' });

  if (!chips.length && tasks.length) chips.push({ icon:'📋', label:`${tasks.length} tasks today`, cls:'' });

  const chipsEl = $('brief-chips');
  if (chipsEl) {
    chipsEl.innerHTML = chips.slice(0, 4).map(c =>
      `<div class="brief-chip ${c.cls}">${c.icon} ${esc(c.label)}</div>`
    ).join('');
  }
}


// ═══════════════════════════════════════════════════════════════
// FEATURE 3 — FOCUS MODE
// ═══════════════════════════════════════════════════════════════

const FOCUS = {
  task: '', duration: 25 * 60, remaining: 25 * 60,
  running: false, interval: null,
  session: 1, maxSessions: 4,
  totalCirc: 540,
};

function focusStart(taskName, minutes) {
  if (!S.sid) return;
  FOCUS.task      = taskName || 'Focus Session';
  FOCUS.duration  = (minutes || 25) * 60;
  FOCUS.remaining = FOCUS.duration;
  FOCUS.running   = false;
  FOCUS.session   = 1;
  clearInterval(FOCUS.interval);

  const overlay = $('focus-overlay');
  if (!overlay) return;
  overlay.classList.add('open');

  const screen = $('focus-screen');
  const done   = $('focus-done-screen');
  if (screen) screen.style.display = 'flex';
  if (done)   done.style.display   = 'none';

  focusRenderState();
  focusUpdateDots();

  const icon = $('focus-play-icon');
  if (icon) icon.className = 'ti ti-player-play';
}

function focusToggle() {
  if (FOCUS.running) {
    FOCUS.running = false;
    clearInterval(FOCUS.interval);
    const icon = $('focus-play-icon');
    if (icon) icon.className = 'ti ti-player-play';
  } else {
    FOCUS.running = true;
    FOCUS.interval = setInterval(focusTick, 1000);
    const icon = $('focus-play-icon');
    if (icon) icon.className = 'ti ti-player-pause';
  }
}

function focusTick() {
  FOCUS.remaining--;
  focusRenderState();
  if (FOCUS.remaining <= 0) {
    clearInterval(FOCUS.interval);
    FOCUS.running = false;
    focusSessionComplete();
  }
}

function focusRenderState() {
  const mins = String(Math.floor(FOCUS.remaining / 60)).padStart(2, '0');
  const secs = String(FOCUS.remaining % 60).padStart(2, '0');
  const timeEl = $('focus-time');
  if (timeEl) timeEl.textContent = `${mins}:${secs}`;

  const pct    = 1 - FOCUS.remaining / FOCUS.duration;
  const offset = FOCUS.totalCirc * (1 - pct);
  const ring   = $('focus-ring');
  if (ring) ring.style.strokeDashoffset = offset;
}

function focusReset() {
  clearInterval(FOCUS.interval);
  FOCUS.running   = false;
  FOCUS.remaining = FOCUS.duration;
  focusRenderState();
  const icon = $('focus-play-icon');
  if (icon) icon.className = 'ti ti-player-play';
}

function focusEnd() {
  clearInterval(FOCUS.interval);
  FOCUS.running = false;
  $('focus-overlay')?.classList.remove('open');
}

function focusSessionComplete() {
  // Log session
  const log = JSON.parse(localStorage.getItem(`sivarr_focus_log_${S.sid}`) || '[]');
  log.push({ task: FOCUS.task, mins: Math.round(FOCUS.duration / 60), ts: Date.now() });
  localStorage.setItem(`sivarr_focus_log_${S.sid}`, JSON.stringify(log));

  // Show post-session screen
  const screen = $('focus-screen');
  const done   = $('focus-done-screen');
  if (screen) screen.style.display = 'none';
  if (done)   done.style.display   = 'flex';

  const sub = $('focus-done-sub');
  if (sub) sub.textContent = `You focused on "${FOCUS.task}" for ${Math.round(FOCUS.duration/60)} min. Great work!`;

  const inp = $('focus-done-input');
  if (inp) inp.value = '';

  // Dot
  FOCUS.session = Math.min(FOCUS.session + 1, FOCUS.maxSessions);
  focusUpdateDots();
}

function focusUpdateDots() {
  const dots = document.querySelectorAll('#focus-session-dots .fsd');
  dots.forEach((d, i) => {
    d.className = 'fsd';
    if (i < FOCUS.session - 1) d.classList.add('fsd-done');
    else if (i === FOCUS.session - 1) d.classList.add('fsd-active');
  });
}

function focusContinue() {
  FOCUS.remaining = FOCUS.duration;
  FOCUS.running   = false;
  clearInterval(FOCUS.interval);

  const screen = $('focus-screen');
  const done   = $('focus-done-screen');
  if (screen) screen.style.display = 'flex';
  if (done)   done.style.display   = 'none';

  focusRenderState();
  const icon = $('focus-play-icon');
  if (icon) icon.className = 'ti ti-player-play';
}

function focusFinish() {
  const note = $('focus-done-input')?.value?.trim();
  if (note) {
    const entries = JSON.parse(localStorage.getItem(`sivarr_journal_${S.sid}`) || '[]');
    const ts = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    entries.unshift({ id: Date.now(), text: `[Focus] ${FOCUS.task}: ${note}`, date: ts });
    localStorage.setItem(`sivarr_journal_${S.sid}`, JSON.stringify(entries));
  }
  focusEnd();
  toast('Focus session logged ✓');
}


// ═══════════════════════════════════════════════════════════════
// FEATURE 4 — DOC EDITOR (Docs & Notes)
// ═══════════════════════════════════════════════════════════════

const DOC_KEY    = () => `sivarr_docs_${S.sid || 'guest'}`;
const DOC_AUTOSAVE_MS = 1500;
let   _docId     = null;   // currently open doc id
let   _docTimer  = null;   // autosave debounce

function docGetAll() {
  try { return JSON.parse(localStorage.getItem(DOC_KEY()) || '[]'); }
  catch { return []; }
}
function docSaveAll(list) {
  localStorage.setItem(DOC_KEY(), JSON.stringify(list));
}

function docNew() {
  const doc = {
    id:      Date.now(),
    title:   '',
    content: '',
    created: Date.now(),
    updated: Date.now(),
  };
  const list = docGetAll();
  list.unshift(doc);
  docSaveAll(list);
  _docId = doc.id;
  docRenderList();
  docOpenEditor(doc);
}

function docCaptureNote(text) {
  const doc = {
    id:      Date.now(),
    title:   text.split('\n')[0].slice(0, 60) || 'Quick Note',
    content: `<p>${esc(text)}</p>`,
    created: Date.now(),
    updated: Date.now(),
  };
  const list = docGetAll();
  list.unshift(doc);
  docSaveAll(list);
}

function docOpen(id) {
  const doc = docGetAll().find(d => d.id === id);
  if (!doc) return;
  _docId = id;
  docOpenEditor(doc);
  docRenderList();
}

function docOpenEditor(doc) {
  const emptyState = $('doc-empty-state');
  const wrap       = $('doc-editor-wrap');
  if (emptyState) emptyState.style.display = 'none';
  if (wrap)       wrap.style.display       = 'flex';

  const titleEl = $('doc-title');
  if (titleEl) titleEl.value = doc.title || '';

  const contentEl = $('doc-content');
  if (contentEl) {
    contentEl.innerHTML = doc.content || '';
    contentEl.focus();
  }
  docUpdateWordCount();
  const statusEl = $('doc-save-status');
  if (statusEl) {
    const rel = doc.updated ? _relTime(doc.updated) : '';
    statusEl.textContent = rel ? `Saved ${rel}` : 'All changes saved';
  }
}

function _relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

function docDelete(id, e) {
  e?.stopPropagation();
  const list = docGetAll().filter(d => d.id !== id);
  docSaveAll(list);
  if (_docId === id) {
    _docId = null;
    const emptyState = $('doc-empty-state');
    const wrap       = $('doc-editor-wrap');
    if (emptyState) emptyState.style.display = 'flex';
    if (wrap)       wrap.style.display       = 'none';
  }
  docRenderList();
}

function docRenderList(filter) {
  const list  = $('doc-list');
  if (!list) return;
  let   docs  = docGetAll();
  const q     = filter ?? ($('doc-search')?.value?.toLowerCase() || '');
  if (q) docs = docs.filter(d =>
    (d.title || '').toLowerCase().includes(q) ||
    (d.content || '').toLowerCase().includes(q)
  );

  if (!docs.length) {
    list.innerHTML = `<div class="doc-list-empty">${q ? 'No docs match' : 'No docs yet'}</div>`;
    return;
  }
  list.innerHTML = docs.map(d => {
    const title   = d.title || 'Untitled';
    const preview = d.content ? d.content.replace(/<[^>]+>/g,'').slice(0, 48) : '';
    const rel     = _relTime(d.updated);
    return `<div class="doc-item${_docId === d.id ? ' active' : ''}" onclick="docOpen(${d.id})">
      <div class="doc-item-row">
        <div class="doc-item-title">${esc(title)}</div>
        <button class="doc-delete-btn" onmousedown="event.stopPropagation()" onclick="docDelete(${d.id},event)" title="Delete">✕</button>
      </div>
      <div class="doc-item-meta">${preview ? esc(preview) : rel}</div>
    </div>`;
  }).join('');
}

function docSearchFilter() {
  docRenderList($('doc-search')?.value?.toLowerCase() || '');
}

function docTitleChange() {
  docScheduleSave();
}

function docContentChange() {
  docUpdateWordCount();
  docScheduleSave();
  const statusEl = $('doc-save-status');
  if (statusEl) statusEl.textContent = 'Unsaved…';
}

function docScheduleSave() {
  clearTimeout(_docTimer);
  _docTimer = setTimeout(docSave, DOC_AUTOSAVE_MS);
}

function docSave() {
  if (!_docId) return;
  const list    = docGetAll();
  const idx     = list.findIndex(d => d.id === _docId);
  if (idx < 0) return;
  list[idx].title   = $('doc-title')?.value?.trim() || 'Untitled';
  list[idx].content = $('doc-content')?.innerHTML || '';
  list[idx].updated = Date.now();
  docSaveAll(list);
  docRenderList();
  const statusEl = $('doc-save-status');
  if (statusEl) statusEl.textContent = 'All changes saved';
}

function docUpdateWordCount() {
  const text = $('doc-content')?.innerText || '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wc = $('doc-word-count');
  if (wc) wc.textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

function docFormat(cmd) {
  document.execCommand(cmd, false, null);
  $('doc-content')?.focus();
  docScheduleSave();
}

function docFormatBlock(tag) {
  document.execCommand('formatBlock', false, tag);
  $('doc-content')?.focus();
  docScheduleSave();
}

function docKeyDown(e) {
  // Tab → indent
  if (e.key === 'Tab') {
    e.preventDefault();
    document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
  }
  // Enter in pre → insert newline without creating new block
  if (e.key === 'Enter' && !e.shiftKey) {
    const sel = window.getSelection();
    if (sel?.anchorNode) {
      let node = sel.anchorNode;
      while (node && node !== $('doc-content')) {
        if (node.nodeName === 'PRE') {
          e.preventDefault();
          document.execCommand('insertHTML', false, '\n');
          return;
        }
        node = node.parentNode;
      }
    }
  }
}

function docAskSiva() {
  if (!S.sid) return;
  const content = $('doc-content')?.innerText?.trim() || '';
  const title   = $('doc-title')?.value?.trim() || '';
  const sel     = window.getSelection()?.toString()?.trim() || '';
  const text    = sel || content.slice(0, 600);
  if (!text) { toast('Write something first, then ask SIVARR to assist.'); return; }
  const prompt  = sel
    ? `Help me improve or continue this selection from my doc "${title}":\n\n${text}`
    : `I'm writing a doc titled "${title}". Here's what I have so far:\n\n${text}\n\nPlease continue or improve it.`;
  nav('chat', null);
  setTimeout(() => {
    const inp = $('chat-input') || $('msg-input');
    if (inp) { inp.value = prompt; inp.focus(); }
  }, 200);
}

function docInit() {
  docRenderList();
  if (!_docId) {
    const docs = docGetAll();
    if (docs.length) docOpen(docs[0].id);
    else {
      const emptyState = $('doc-empty-state');
      const wrap       = $('doc-editor-wrap');
      if (emptyState) emptyState.style.display = 'flex';
      if (wrap)       wrap.style.display       = 'none';
    }
  } else {
    const doc = docGetAll().find(d => d.id === _docId);
    if (doc) docOpenEditor(doc);
  }
}

/* ══════════════════════════════════════════════════
   PHASE 5 — SPACE SWITCHER
   ══════════════════════════════════════════════════ */

let _currentSpace = 'personal';

function switchSpace(space) {
  _currentSpace = space;
  ['personal','academic','org'].forEach(s => {
    const btn = $('ss-' + s);
    if (btn) btn.classList.toggle('active', s === space);
  });
  // Only the Org section is conditionally hidden — personal/academic sections are always visible
  document.querySelectorAll('.sg-space-org').forEach(el => {
    el.style.display = space === 'org' ? '' : 'none';
  });
  // Default panel per space
  const defaults = { personal:'home', academic:'courses', org:'org' };
  nav(defaults[space], null);
}

/* ══════════════════════════════════════════════════
   ORG SPACE — Work Hub
   ══════════════════════════════════════════════════ */

const ORG_KEY      = () => `sivarr_org_${S.sid}`;
const ORG_KANBAN_COLS = ['To Do','In Progress','Review','Done'];

function orgGetData() {
  return JSON.parse(localStorage.getItem(ORG_KEY()) || JSON.stringify({
    name: (S.name ? S.name + "'s" : 'Your') + ' Work Hub',
    members: [], tasks: [], projects: [], docs: [], activity: [], chatMsgs: []
  }));
}

function orgSaveData(d) { localStorage.setItem(ORG_KEY(), JSON.stringify(d)); }

function orgInit() {
  const d = orgGetData();

  // Ensure owner is always in members
  if (!d.members.find(m => m.email === S.email || m.name === S.name)) {
    d.members.unshift({ name: S.name || 'You', role: 'Admin', email: S.email || '' });
    orgSaveData(d);
  }

  // Hero
  const nameEl = $('os-space-name'); if (nameEl) nameEl.textContent = d.name;
  const mcEl   = $('os-member-count'); if (mcEl) mcEl.textContent = d.members.length;
  const ocEl   = $('os-online-count'); if (ocEl) ocEl.textContent = 1;

  orgRenderOverview(d);
  orgRenderKanban(d);
  orgRenderProjects(d);
  orgRenderDocs(d);
  orgRenderMembers(d);
  orgRenderInsights(d);
  orgChatRender();
}

function orgTab(tab, btn) {
  document.querySelectorAll('.os-tab').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.os-pane').forEach(p => p.classList.remove('on'));
  const pane = $('os-pane-' + tab);
  if (pane) pane.classList.add('on');
  if (btn) { btn.classList.add('on'); }
  else {
    const b = $('os-tab-' + tab); if (b) b.classList.add('on');
  }
  if (tab === 'chat') orgChatRender();
}

function orgRenderOverview(d) {
  const open     = d.tasks.filter(t => t.col !== 'Done').length;
  const done     = d.tasks.filter(t => t.col === 'Done').length;
  const overdue  = d.tasks.filter(t => t.col !== 'Done' && t.due && t.due < new Date().toISOString().slice(0,10)).length;

  const setVal = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setVal('os-open-tasks', open);
  setVal('os-done-tasks', done);
  setVal('os-proj-count', d.projects.length);
  setVal('os-mem-count',  d.members.length);
  const ovEl = $('os-overdue-lbl');
  if (ovEl) ovEl.textContent = overdue ? `${overdue} overdue` : '';
  if (ovEl) ovEl.style.color = overdue ? 'var(--coral)' : 'var(--muted)';
  const invEl = $('os-invite-lbl');
  if (invEl) invEl.textContent = d.members.length === 1 ? 'Just you — invite your team' : '';

  // Priority tasks
  const pt = $('os-priority-tasks');
  if (pt) {
    const pri = d.tasks.filter(t => t.col !== 'Done' && t.priority === 'high').slice(0,5);
    pt.innerHTML = pri.length
      ? pri.map(t => `<div class="os-task-card"><div class="os-task-title">${escHtml(t.title)}</div><div class="os-task-meta"><span>${escHtml(t.col)}</span>${t.due ? `<span>${t.due}</span>` : ''}</div></div>`).join('')
      : '<div class="os-empty">No high-priority tasks.</div>';
  }

  // Projects mini
  const pp = $('os-proj-progress');
  if (pp) {
    pp.innerHTML = d.projects.length
      ? d.projects.slice(0,4).map(p => `<div class="os-task-card"><div class="os-task-tag">${escHtml(p.status||'active')}</div><div class="os-task-title">${escHtml(p.name)}</div></div>`).join('')
      : '<div class="os-empty">No projects yet.</div>';
  }

  // Team mini
  const tm = $('os-team-mini');
  if (tm) {
    tm.innerHTML = d.members.slice(0,5).map(m => `
      <div class="os-member-row">
        <div class="os-member-av">${(m.name||'?')[0].toUpperCase()}</div>
        <div class="os-member-info">
          <div class="os-member-name">${escHtml(m.name)}</div>
          <div class="os-member-role">${escHtml(m.role||'Member')}</div>
        </div>
      </div>`).join('') || '<div class="os-empty">No members yet.</div>';
  }

  // Activity feed
  const af = $('os-activity-feed');
  if (af) {
    af.innerHTML = d.activity.length
      ? d.activity.slice(-6).reverse().map(a => `<div class="os-empty" style="padding:4px 0">· ${escHtml(a)}</div>`).join('')
      : '<div class="os-empty">No activity yet.</div>';
  }
}

function orgRenderKanban(d) {
  const board = $('os-kanban');
  if (!board) return;
  board.innerHTML = ORG_KANBAN_COLS.map(col => {
    const tasks = d.tasks.filter(t => t.col === col);
    return `
    <div class="os-col">
      <div class="os-col-head">
        <span class="os-col-title">${col}</span>
        <span class="os-col-count">${tasks.length}</span>
      </div>
      ${tasks.map(t => `
        <div class="os-task-card">
          ${t.priority === 'high' ? '<div class="os-task-tag">High</div>' : ''}
          <div class="os-task-title">${escHtml(t.title)}</div>
          <div class="os-task-meta">
            ${t.assignee ? `<span>${escHtml(t.assignee)}</span>` : ''}
            ${t.due ? `<span>${t.due}</span>` : ''}
          </div>
        </div>`).join('')}
      <button class="os-add-card-btn" onclick="orgAddTaskToCol('${col}')">+ Add task</button>
    </div>`;
  }).join('');
}

function orgRenderProjects(d) {
  const grid = $('os-proj-grid');
  if (!grid) return;
  const COLORS = ['#0d9488','#7c3aed','#d97706','#dc2626','#2563eb','#059669'];
  if (!d.projects.length) {
    grid.innerHTML = '<div class="os-empty" style="padding:20px 0">No projects yet — create your first one.</div>';
    return;
  }
  grid.innerHTML = d.projects.map((p, i) => `
    <div class="os-proj-card">
      <div class="os-proj-stripe" style="background:${COLORS[i % COLORS.length]}"></div>
      <div class="os-proj-name">${escHtml(p.name)}</div>
      ${p.desc ? `<div class="os-proj-desc">${escHtml(p.desc)}</div>` : ''}
      <div class="os-proj-meta">
        <span class="os-proj-badge">${escHtml(p.status||'active')}</span>
        <span class="os-proj-tasks-count">${p.tasks||0} tasks</span>
      </div>
    </div>`).join('');
}

function orgRenderDocs(d) {
  const grid = $('os-docs-grid');
  if (!grid) return;
  if (!d.docs.length) {
    grid.innerHTML = '<div class="os-empty" style="padding:20px 0">No docs yet — create one to share with your team.</div>';
    return;
  }
  grid.innerHTML = d.docs.map(doc => `
    <div class="os-doc-card">
      <div class="os-doc-icon"><i class="ti ti-file-text"></i></div>
      <div class="os-doc-name">${escHtml(doc.title)}</div>
      <div class="os-doc-meta">${doc.updated || 'Just now'}</div>
    </div>`).join('');
}

function orgRenderMembers(d) {
  const list = $('os-members-list');
  if (!list) return;
  const lbl = $('os-member-label');
  if (lbl) lbl.textContent = `${d.members.length} member${d.members.length !== 1 ? 's' : ''}`;
  if (!d.members.length) { list.innerHTML = '<div class="os-empty" style="padding:16px 0">No members yet.</div>'; return; }
  list.innerHTML = d.members.map(m => `
    <div class="os-member-row">
      <div class="os-member-av">${(m.name||'?')[0].toUpperCase()}</div>
      <div class="os-member-info">
        <div class="os-member-name">${escHtml(m.name)}</div>
        <div class="os-member-role">${escHtml(m.email || '')}</div>
      </div>
      <span class="os-member-badge">${escHtml(m.role||'Member')}</span>
    </div>`).join('');
}

function orgRenderInsights(d) {
  const vel = $('os-velocity');
  const otr = $('os-ontime');
  const fhr = $('os-focus-hrs');
  const gac = $('os-goals-active');
  const done = d.tasks.filter(t => t.col === 'Done').length;
  if (vel) vel.textContent = done > 0 ? (done / Math.max(1, Math.ceil(done / 5))).toFixed(1) : '—';
  if (otr) otr.textContent = done > 0 ? Math.round((done / Math.max(1, d.tasks.length)) * 100) + '%' : '—';
  if (fhr) fhr.textContent = '0';
  if (gac) gac.textContent = '0';

  const chart = $('os-bar-chart');
  if (chart) {
    const weeks = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const vals  = weeks.map(() => Math.floor(Math.random() * done + 0.5));
    const max   = Math.max(...vals, 1);
    chart.innerHTML = weeks.map((w, i) => `
      <div class="os-bar-col">
        <div class="os-bar-fill" style="height:${Math.round((vals[i]/max)*60)+4}px"></div>
        <div class="os-bar-lbl">${w}</div>
      </div>`).join('');
  }

  const tbm = $('os-tasks-by-member');
  if (tbm) {
    tbm.innerHTML = d.members.length
      ? d.members.map(m => {
          const count = d.tasks.filter(t => t.assignee === m.name).length;
          return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:.82rem">
            <div class="os-member-av" style="width:24px;height:24px;font-size:.7rem">${(m.name||'?')[0].toUpperCase()}</div>
            <span style="flex:1;color:var(--fg)">${escHtml(m.name)}</span>
            <span style="color:var(--muted)">${count}</span>
          </div>`;
        }).join('')
      : '<div class="os-empty">No members yet.</div>';
  }

  const ai = $('os-ai-insights');
  if (ai) {
    if (!done && !d.tasks.length) {
      ai.innerHTML = '<div class="os-empty">Start adding tasks to unlock AI insights.</div>';
    } else {
      const rate = d.tasks.length ? Math.round((done / d.tasks.length) * 100) : 0;
      ai.innerHTML = `<div style="font-size:.84rem;color:var(--fg);line-height:1.6;padding:4px 0">
        Your team has completed <strong>${done}</strong> tasks (${rate}% completion rate).
        ${rate >= 70 ? ' Great momentum — keep it up!' : rate >= 40 ? ' Solid progress. Focus on clearing the backlog.' : ' Consider breaking tasks into smaller steps to build momentum.'}
      </div>`;
    }
  }
}

async function orgNewTask() {
  const title = await siModal.input('New Task', 'Task title', '', { confirmLabel:'Create Task' });
  if (!title) return;
  const d = orgGetData();
  d.tasks.push({ id: Date.now(), title, col: 'To Do', priority: 'normal', created: new Date().toISOString().slice(0,10) });
  d.activity.push(`Task "${title}" was created.`);
  orgSaveData(d);
  orgInit();
  toast('Task created');
}

async function orgAddTaskToCol(col) {
  const title = await siModal.input(`Add to "${col}"`, 'Task title', '', { confirmLabel:'Add Task' });
  if (!title) return;
  const d = orgGetData();
  d.tasks.push({ id: Date.now(), title, col, priority: 'normal', created: new Date().toISOString().slice(0,10) });
  d.activity.push(`Task "${title}" added to ${col}.`);
  orgSaveData(d);
  orgInit();
  orgTab('tasks', null);
  toast('Task added');
}

async function orgNewDoc() {
  const title = await siModal.input('New Document', 'Document title', '', { confirmLabel:'Create' });
  if (!title) return;
  const d = orgGetData();
  d.docs.push({ id: Date.now(), title, updated: new Date().toLocaleDateString() });
  d.activity.push(`Doc "${title}" was created.`);
  orgSaveData(d);
  orgRenderDocs(d);
  toast('Doc created');
}

function orgSendInvite() {
  const email = $('os-invite-email')?.value.trim();
  if (!email || !email.includes('@')) { toast('Enter a valid email address.'); return; }
  const name = email.split('@')[0];
  const d = orgGetData();
  if (d.members.find(m => m.email === email)) { toast('Already a member.'); return; }
  d.members.push({ name, role: 'Member', email });
  d.activity.push(`${name} was invited to the team.`);
  orgSaveData(d);
  if ($('os-invite-email')) $('os-invite-email').value = '';
  orgInit();
  toast(`Invite sent to ${email}`);
}

async function orgMoreMenu() {
  const name = await siModal.input('Rename Space', 'Space name', orgGetData().name, { confirmLabel:'Rename' });
  if (!name) return;
  const d = orgGetData();
  d.name = name;
  orgSaveData(d);
  orgInit();
}

/* ══════════════════════════════════════════════════
   PHASE 5 — TEAM DASHBOARD
   ══════════════════════════════════════════════════ */

function teamInit() {
  const key = `sivarr_team_${S.sid}`;
  const data = JSON.parse(localStorage.getItem(key) || '{"members":[],"activity":[]}');

  // Ensure owner is always member #1
  if (S.name && !data.members.find(m => m.you)) {
    data.members.unshift({ name: S.name, role:'Admin', you:true });
    localStorage.setItem(key, JSON.stringify(data));
  }

  // Update stats
  const tasks   = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]');
  const openTasks = tasks.filter(t => !t.done).length;
  const projects = JSON.parse(localStorage.getItem(`sivarr_projects_${S.sid}`) || '[]');

  if ($('team-member-count')) $('team-member-count').textContent = data.members.length;
  if ($('team-project-count')) $('team-project-count').textContent = projects.length;
  if ($('team-task-count'))   $('team-task-count').textContent   = openTasks;

  // Render members
  const list = $('team-member-list');
  if (list) {
    list.innerHTML = data.members.map(m => `
      <div class="team-member-card">
        <div class="tm-av">${(m.name||'?').charAt(0).toUpperCase()}</div>
        <div class="tm-info">
          <div class="tm-name">${escHtml(m.name)}${m.you ? ' (you)' : ''}</div>
          <div class="tm-role">${escHtml(m.role||'Member')}</div>
        </div>
        <span class="tm-badge">${escHtml(m.role||'Member')}</span>
      </div>`).join('') || '<div class="hr-empty">No members yet.</div>';
  }

  // Render activity
  const act = $('team-activity');
  if (act && data.activity.length) {
    act.innerHTML = data.activity.slice(-5).reverse().map(a =>
      `<div class="ta-item"><span class="ta-dot" style="background:var(--teal)"></span><span class="ta-text">${escHtml(a)}</span></div>`
    ).join('');
  }
}

async function teamInvite() {
  const d = await siModal.form('Invite Team Member', [
    { id:'email', label:'Email address', type:'text', placeholder:'colleague@example.com', required:true },
    { id:'name',  label:'Display name',  placeholder:'Their name (optional)' },
  ], { confirmLabel:'Send Invite' });
  if (!d || !d.email || !d.email.includes('@')) return;
  const email = d.email;
  const name  = d.name || email.split('@')[0];
  const key  = `sivarr_team_${S.sid}`;
  const data = JSON.parse(localStorage.getItem(key) || '{"members":[],"activity":[]}');
  data.members.push({ name, role:'Member', email });
  data.activity.push(`${name} was invited to the team.`);
  localStorage.setItem(key, JSON.stringify(data));
  orgInit();
  toast(`Invite sent to ${email}`);
}

/* ══════════════════════════════════════════════════
   PHASE 5 — TEAM CHAT
   ══════════════════════════════════════════════════ */

function orgChatSend() {
  const inp = $('os-chat-input');
  const msg = inp ? inp.value.trim() : '';
  if (!msg) return;
  inp.value = '';

  const key  = `sivarr_orgchat_${S.sid}`;
  const msgs = JSON.parse(localStorage.getItem(key) || '[]');
  msgs.push({ text: msg, author: S.name || 'You', ts: Date.now(), me: true });
  localStorage.setItem(key, JSON.stringify(msgs));
  orgChatRender();
}

function orgChatRender() {
  const key  = `sivarr_orgchat_${S.sid}`;
  const msgs = JSON.parse(localStorage.getItem(key) || '[]');
  const box  = $('os-chat-messages');
  if (!box) return;

  if (!msgs.length) {
    box.innerHTML = '<div class="os-chat-empty">No messages yet. Start the conversation 👋</div>';
    return;
  }

  box.innerHTML = msgs.map(m => `
    <div class="os-chat-msg${m.me ? ' me' : ''}">
      <div class="os-chat-av">${(m.author||'?').charAt(0).toUpperCase()}</div>
      <div>
        <div class="os-chat-meta">${escHtml(m.author)} · ${new Date(m.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="os-chat-bubble">${escHtml(m.text)}</div>
      </div>
    </div>`).join('');
  box.scrollTop = box.scrollHeight;
}

function orgChatInit() { orgChatRender(); }

/* ══════════════════════════════════════════════════
   PHASE 5 — PROJECTS
   ══════════════════════════════════════════════════ */

const PROJ_COLORS = ['#0d9488','#7c3aed','#d97706','#dc2626','#2563eb','#059669'];

async function projectNew() {
  const d = await siModal.form('New Project', [
    { id:'name', label:'Project name',             placeholder:'e.g. Website Redesign', required:true },
    { id:'desc', label:'Description (optional)',   placeholder:'What is this project about?' },
  ], { confirmLabel:'Create Project' });
  if (!d || !d.name) return;
  const name = d.name; const desc = d.desc||'';
  const org = orgGetData();
  org.projects.push({ id: Date.now(), name, desc, tasks: 0, status: 'active' });
  org.activity.push(`Project "${name}" was created.`);
  orgSaveData(org);
  orgRenderProjects(org);
  toast('Project created');
}

function projectsRender() {
  const key  = `sivarr_projects_${S.sid}`;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  const grid = $('projects-grid');
  if (!grid) return;
  if (!list.length) { grid.innerHTML = '<div class="projects-empty">No projects yet — create your first one.</div>'; return; }
  grid.innerHTML = list.map(p => `
    <div class="project-card">
      <div class="proj-color" style="background:${p.color}"></div>
      <div class="proj-name">${escHtml(p.name)}</div>
      ${p.desc ? `<div class="proj-desc">${escHtml(p.desc)}</div>` : ''}
      <div class="proj-meta">
        <span class="proj-badge">${escHtml(p.status)}</span>
        <span class="proj-tasks">${p.tasks} tasks</span>
      </div>
    </div>`).join('');
}

function projectsInit() { projectsRender(); }

/* ══════════════════════════════════════════════════
   PHASE 5 — HR / PEOPLE
   ══════════════════════════════════════════════════ */

function hrTab(tab, btn) {
  ['directory','leaves','roles'].forEach(t => {
    const el = $('hr-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.hr-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

async function hrAddMember() {
  const d = await siModal.form('Add Team Member', [
    { id:'name',  label:'Full name',             placeholder:'e.g. Amaka Johnson', required:true },
    { id:'role',  label:'Role',                  placeholder:'e.g. Developer, Designer', default:'Member' },
    { id:'email', label:'Email (optional)',       placeholder:'member@example.com' },
  ], { confirmLabel:'Add Member' });
  if (!d || !d.name) return;
  const name = d.name; const role = d.role||'Member'; const email = d.email||'';
  const key   = `sivarr_team_${S.sid}`;
  const data  = JSON.parse(localStorage.getItem(key) || '{"members":[],"activity":[]}');
  data.members.push({ name, role, email });
  data.activity.push(`${name} was added to the team.`);
  localStorage.setItem(key, JSON.stringify(data));
  hrRenderDirectory();
  toast(`${name} added`);
}

function hrRenderDirectory() {
  const key  = `sivarr_team_${S.sid}`;
  const data = JSON.parse(localStorage.getItem(key) || '{"members":[]}');
  const list = $('hr-dir-list');
  if (!list) return;
  if (!data.members.length) { list.innerHTML = '<div class="hr-empty">No people added yet.</div>'; return; }
  list.innerHTML = data.members.map(m => `
    <div class="hr-member-row">
      <div class="tm-av">${(m.name||'?').charAt(0).toUpperCase()}</div>
      <div class="tm-info">
        <div class="tm-name">${escHtml(m.name)}</div>
        <div class="tm-role">${escHtml(m.email||m.role||'')}</div>
      </div>
      <span class="tm-badge">${escHtml(m.role||'Member')}</span>
    </div>`).join('');
}

function hrInit() { hrRenderDirectory(); }

/* ══════════════════════════════════════════════════
   PHASE 8 — AUTOMATIONS
   ══════════════════════════════════════════════════ */

let _autoBuilderOpen = false;

function autoNew() {
  _autoBuilderOpen = !_autoBuilderOpen;
  const builder = $('auto-builder');
  if (builder) builder.style.display = _autoBuilderOpen ? 'flex' : 'none';
}

function autoBuilderClose() {
  _autoBuilderOpen = false;
  const builder = $('auto-builder');
  if (builder) builder.style.display = 'none';
}

function autoSave() {
  const trigger = $('auto-trigger')?.value;
  const action  = $('auto-action')?.value;
  const name    = $('auto-rule-name')?.value.trim();
  if (!name) { toast('Give your rule a name first.'); return; }

  const key  = `sivarr_automations_${S.sid}`;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list.push({ id: Date.now(), name, trigger, action, enabled: true });
  localStorage.setItem(key, JSON.stringify(list));

  // Reset form
  if ($('auto-rule-name')) $('auto-rule-name').value = '';
  _autoBuilderOpen = false;
  if ($('auto-builder')) $('auto-builder').style.display = 'none';

  autoRenderList();
  toast('Automation rule saved');
}

function autoToggle(id) {
  const key  = `sivarr_automations_${S.sid}`;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  const rule = list.find(r => r.id === id);
  if (rule) rule.enabled = !rule.enabled;
  localStorage.setItem(key, JSON.stringify(list));
  autoRenderList();
}

function autoDelete(id) {
  const key  = `sivarr_automations_${S.sid}`;
  let   list = JSON.parse(localStorage.getItem(key) || '[]');
  list = list.filter(r => r.id !== id);
  localStorage.setItem(key, JSON.stringify(list));
  autoRenderList();
  toast('Rule deleted');
}

const AUTO_TRIGGER_LABELS = {
  task_done:'A task is marked done', goal_progress:'Goal reaches 100%',
  habit_streak:'Habit streak hits a milestone', daily_open:'I open SIVARR each day',
  focus_complete:'A Focus session completes',
};
const AUTO_ACTION_LABELS = {
  journal_prompt:'Add a journal prompt', notify_toast:'Show a notification',
  log_activity:'Log to activity feed', celebrate:'Show a celebration 🎉',
  create_task:'Create a follow-up task',
};

function autoRenderList() {
  const key  = `sivarr_automations_${S.sid}`;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  const el   = $('auto-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="auto-empty">No rules yet. Create your first automation above.</div>'; return; }
  el.innerHTML = list.map(r => `
    <div class="auto-rule-card">
      <div class="auto-rule-icon">⚡</div>
      <div class="auto-rule-info">
        <div class="auto-rule-name">${escHtml(r.name)}</div>
        <div class="auto-rule-desc">
          When: ${AUTO_TRIGGER_LABELS[r.trigger]||r.trigger} → Then: ${AUTO_ACTION_LABELS[r.action]||r.action}
        </div>
      </div>
      <button class="auto-rule-toggle${r.enabled ? '' : ' off'}" onclick="autoToggle(${r.id})" title="Toggle rule"></button>
      <button onclick="autoDelete(${r.id})" style="background:none;border:none;color:var(--text4);cursor:pointer;font-size:.9rem;padding:4px" title="Delete">✕</button>
    </div>`).join('');
}

function autoInit() { autoRenderList(); }

/* ══════════════════════════════════════════════════
   PHASE 7 — OPPORTUNITIES BOARD
   ══════════════════════════════════════════════════ */

let _oppCat = 'all';

const DEMO_OPPS = [
  { id:1, type:'job', title:'Frontend Developer Intern', org:'TechStart Lagos', desc:'React, TypeScript, 3-month paid internship.', deadline:'2026-06-15', url:'#' },
  { id:2, type:'scholarship', title:'African Excellence Scholarship', org:'DAAD', desc:'Full scholarship for masters studies in Germany.', deadline:'2026-05-31', url:'#' },
  { id:3, type:'grant', title:'Youth Innovation Grant', org:'Tony Elumelu Foundation', desc:'$5,000 seed funding for young African entrepreneurs.', deadline:'2026-07-01', url:'#' },
  { id:4, type:'gig', title:'Brand Identity Designer', org:'Freelance', desc:'Logo, colours, and brand guide for fintech startup.', deadline:'Open', url:'#' },
  { id:5, type:'internship', title:'Product Design Intern', org:'Flutterwave', desc:'6-month internship for final-year design students.', deadline:'2026-06-30', url:'#' },
];

function oppSetCat(cat, btn) {
  _oppCat = cat;
  document.querySelectorAll('.opp-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  oppRender();
}

function oppRender() {
  const key     = `sivarr_opps_${S.sid}`;
  const custom  = JSON.parse(localStorage.getItem(key) || '[]');
  const all     = [...DEMO_OPPS, ...custom];
  const visible = _oppCat === 'all' ? all : all.filter(o => o.type === _oppCat);
  const grid    = $('opp-grid');
  if (!grid) return;

  if (!visible.length) { grid.innerHTML = '<div class="opp-empty">No opportunities in this category yet.</div>'; return; }

  grid.innerHTML = visible.map(o => `
    <div class="opp-card">
      <div class="opp-card-type">${o.type}</div>
      <div class="opp-card-title">${escHtml(o.title)}</div>
      <div class="opp-card-org">${escHtml(o.org)}</div>
      <div class="opp-card-desc">${escHtml(o.desc)}</div>
      <div class="opp-card-meta">
        <span class="opp-deadline">Deadline: ${escHtml(o.deadline)}</span>
      </div>
      <button class="opp-apply-btn" onclick="window.open(${JSON.stringify(o.url)},'_blank')">Apply →</button>
    </div>`).join('');
}

async function oppPost() {
  const d = await siModal.form('Post Opportunity', [
    { id:'title',    label:'Title',            placeholder:'e.g. Frontend Developer Intern', required:true },
    { id:'org',      label:'Organisation',     placeholder:'Company or institution name' },
    { id:'desc',     label:'Short description',type:'textarea', placeholder:'What is this opportunity about?' },
    { id:'type',     label:'Type',             type:'select',
      options:[{value:'job',label:'Job'},{value:'internship',label:'Internship'},{value:'scholarship',label:'Scholarship'},{value:'grant',label:'Grant'},{value:'gig',label:'Gig'}],
      default:'job' },
    { id:'deadline', label:'Deadline',         placeholder:'e.g. 2026-06-30 or Open', default:'Open' },
  ], { confirmLabel:'Post Opportunity' });
  if (!d || !d.title) return;
  const key  = `sivarr_opps_${S.sid}`;
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list.push({ id: Date.now(), title: d.title, org: d.org, desc: d.desc, type: d.type||'job', deadline: d.deadline||'Open', url:'#' });
  localStorage.setItem(key, JSON.stringify(list));
  oppRender();
  toast('Opportunity posted');
}

function oppInit() { oppRender(); }

/* ══════════════════════════════════════════════════
   PHASE 7 — USER PROFILE
   ══════════════════════════════════════════════════ */

function profileInit() {
  if (!S.sid) return;
  const key  = `sivarr_profile_${S.sid}`;
  const prof = JSON.parse(localStorage.getItem(key) || '{}');

  // Avatar initials
  const av = $('profile-av-lg');
  if (av) av.textContent = (S.name || '?').charAt(0).toUpperCase();

  // Name
  const nameEl = $('profile-name-disp');
  if (nameEl) nameEl.textContent = S.name || 'Your Name';

  // Bio
  const bioEl = $('profile-bio-disp');
  if (bioEl) bioEl.textContent = prof.bio || 'Click to add a bio…';

  // Stats from data stores
  const goals    = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`)   || '[]');
  const tasks    = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`)   || '[]');
  const focusLog = JSON.parse(localStorage.getItem(`sivarr_focus_log_${S.sid}`) || '[]');
  const journal  = JSON.parse(localStorage.getItem(`sivarr_journal_${S.sid}`) || '[]');

  const focusHrs = focusLog.reduce((s, f) => s + (f.duration || 0), 0) / 60;
  if ($('ps-goals'))   $('ps-goals').textContent   = goals.length;
  if ($('ps-tasks'))   $('ps-tasks').textContent   = tasks.filter(t => t.done).length;
  if ($('ps-focus'))   $('ps-focus').textContent   = focusHrs.toFixed(1);
  if ($('ps-journal')) $('ps-journal').textContent = journal.length;

  // Achievements
  profileRenderAchievements(goals, tasks, focusLog, journal);

  // Skills
  profileRenderSkills(prof.skills || []);

  // Tags
  const tags = $('profile-tags');
  if (tags && prof.tags && prof.tags.length) {
    tags.innerHTML = prof.tags.map(t => `<span class="profile-tag">${escHtml(t)}</span>`).join('');
  }
}

function profileRenderAchievements(goals, tasks, focusLog, journal) {
  const grid = $('achievements-grid');
  if (!grid) return;
  const badges = [];
  if (tasks.filter(t => t.done).length >= 1)  badges.push({ icon:'✅', label:'First Task Done' });
  if (tasks.filter(t => t.done).length >= 10) badges.push({ icon:'🏆', label:'10 Tasks Crushed' });
  if (goals.length >= 1)  badges.push({ icon:'🎯', label:'Goal Setter' });
  if (journal.length >= 1) badges.push({ icon:'📓', label:'First Journal Entry' });
  if (focusLog.length >= 1) badges.push({ icon:'⏱', label:'Focus Starter' });
  if (focusLog.reduce((s,f)=>s+(f.duration||0),0) >= 60) badges.push({ icon:'🔥', label:'1hr Focus' });

  if (!badges.length) { grid.innerHTML = '<div class="achieve-empty">Complete tasks, goals, and focus sessions to earn badges.</div>'; return; }
  grid.innerHTML = badges.map(b =>
    `<div class="achieve-badge"><span class="a-icon">${b.icon}</span>${escHtml(b.label)}</div>`
  ).join('');
}

function profileRenderSkills(skills) {
  const wrap = $('skills-wrap');
  if (!wrap) return;
  wrap.innerHTML = skills.map((s, i) =>
    `<span class="skill-tag">${escHtml(s)}<button onclick="profileRemoveSkill(${i})">✕</button></span>`
  ).join('') + `<button class="skill-add-btn" onclick="profileAddSkill()">+ Add skill</button>`;
}

async function profileEditBio() {
  const key  = `sivarr_profile_${S.sid}`;
  const prof = JSON.parse(localStorage.getItem(key) || '{}');
  const bio  = await siModal.input('Edit Bio', 'Tell people about yourself…', prof.bio || '', { confirmLabel:'Save Bio' });
  if (bio === null) return;
  prof.bio = bio;
  localStorage.setItem(key, JSON.stringify(prof));
  const bioEl = $('profile-bio-disp');
  if (bioEl) bioEl.textContent = bio || 'Click to add a bio…';
}

async function profileAddSkill() {
  const skill = await siModal.input('Add Skill', 'e.g. Python, Design, Leadership', '', { confirmLabel:'Add' });
  if (!skill) return;
  const key  = `sivarr_profile_${S.sid}`;
  const prof = JSON.parse(localStorage.getItem(key) || '{}');
  prof.skills = prof.skills || [];
  prof.skills.push(skill.trim());
  localStorage.setItem(key, JSON.stringify(prof));
  profileRenderSkills(prof.skills);
}

function profileRemoveSkill(idx) {
  const key  = `sivarr_profile_${S.sid}`;
  const prof = JSON.parse(localStorage.getItem(key) || '{}');
  prof.skills = (prof.skills || []).filter((_, i) => i !== idx);
  localStorage.setItem(key, JSON.stringify(prof));
  profileRenderSkills(prof.skills);
}

/* ════════════════════════════════════════════════════════════
   SPACES — server sync layer
════════════════════════════════════════════════════════════ */

function _spToken() { return localStorage.getItem('sivarr_token') || ''; }

async function _spFetch(url, body) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: _spToken(), ...body }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Seed localStorage from server data (called on login/restore)
function seedSpacesFromServer(serverSpaces) {
  // Build the spaces list from server, merging with any local-only entries
  const existing = JSON.parse(localStorage.getItem(spacesKey()) || '[]');
  const serverIds = new Set(serverSpaces.map(s => s.id));

  // Keep local spaces that the server doesn't know about yet (just created, pending sync)
  const localOnly = existing.filter(s => !serverIds.has(s.id));

  const merged = [
    ...serverSpaces.map(s => ({ id: s.id, name: s.name, type: s.type, icon: s.icon })),
    ...localOnly,
  ];
  localStorage.setItem(spacesKey(), JSON.stringify(merged));

  // Seed each space's data blob
  serverSpaces.forEach(s => {
    if (s.data && Object.keys(s.data).length) {
      const key = spaceDataKey(s.id);
      // Only overwrite if server has data; don't clobber a richer local cache
      const local = JSON.parse(localStorage.getItem(key) || '{}');
      const serverTs  = s.data._updatedAt || 0;
      const localTs   = local._updatedAt  || 0;
      if (serverTs >= localTs) {
        localStorage.setItem(key, JSON.stringify(s.data));
      }
    }
  });
}

// Sync space metadata to server (fire-and-forget)
function syncSpaceMeta(space) {
  _spFetch('/api/spaces/sync', { space });
}

// Debounced space data save to server
const _spDataTimers = {};
function syncSpaceData(id, data) {
  clearTimeout(_spDataTimers[id]);
  _spDataTimers[id] = setTimeout(() => {
    _spFetch('/api/spaces/data/save', { space_id: id, data });
  }, 1500);
}

/* ════════════════════════════════════════════════════════════
   SPACES — management layer
════════════════════════════════════════════════════════════ */

// ── Storage helpers ──────────────────────────────────────────
function spacesKey()   { return `sivarr_spaces_${S.sid}`; }
function spaceDataKey(id) { return `sivarr_sp_${S.sid}_${id}`; }

function getSpaces() {
  return JSON.parse(localStorage.getItem(spacesKey()) || '[]');
}
function saveSpaces(list) {
  localStorage.setItem(spacesKey(), JSON.stringify(list));
}
function getSpaceData(id) {
  return JSON.parse(localStorage.getItem(spaceDataKey(id)) || '{}');
}
function setSpaceData(id, data) {
  // Tag with timestamp so server/client can resolve conflicts
  data._updatedAt = Date.now();
  localStorage.setItem(spaceDataKey(id), JSON.stringify(data));
  syncSpaceData(id, data);
}

// ── Sidebar render ───────────────────────────────────────────
function spaceRenderSidebar() {
  const list = $('sb-spaces-list');
  if (!list) return;
  const spaces = getSpaces();

  // Ensure the Org hub entry exists
  if (!spaces.find(s => s.id === 'org')) {
    spaces.unshift({ id:'org', name:'Organisation Hub', type:'org', icon:'🏢' });
    saveSpaces(spaces);
  }

  // Dot colour per type
  const dotColor = { personal:'#185FA5', academic:'#EF9F27', org:'var(--teal)', default:'var(--purple)' };

  list.innerHTML = spaces.map(sp => {
    const col = dotColor[sp.type] || dotColor.default;
    return `<button class="si sp-si" id="sb-space-row-${sp.id}" onclick="openSpace('${sp.id}')">
      <span class="si-ic sp-si-dot" style="color:${col};font-size:10px">●</span>
      <span class="si-lb">${sp.name}</span>
      <span class="sb-space-more" onclick="event.stopPropagation();spMoreMenu('${sp.id}',this)" title="Options">
        <i class="ti ti-dots-vertical" style="font-size:12px;color:var(--text4)"></i>
      </span>
    </button>`;
  }).join('');
}

// ── Open a space ─────────────────────────────────────────────
function openSpace(id) {
  const spaces = getSpaces();
  const sp = spaces.find(s => s.id === id);
  if (!sp) return;

  // Highlight active row (reuse .si.on style)
  document.querySelectorAll('.sp-si').forEach(el => el.classList.remove('on'));
  const row = $(`sb-space-row-${id}`);
  if (row) row.classList.add('on');

  if (sp.type === 'org') {
    nav('org'); return;
  }
  if (sp.type === 'personal') {
    // Set name in panel
    const nameEl = $('ps-space-name');
    if (nameEl) nameEl.textContent = sp.name;
    nav('personal'); psInit(id); return;
  }
  if (sp.type === 'academic') {
    const nameEl = $('ac-space-name');
    if (nameEl) nameEl.textContent = sp.name;
    nav('academic'); acInit(id); return;
  }
}

// ── Tab switching ─────────────────────────────────────────────
function spTab(prefix, pane, btn) {
  const panel = document.getElementById(`panel-${prefix === 'ps' ? 'personal' : 'academic'}`);
  if (!panel) return;
  panel.querySelectorAll('.sp-pane').forEach(p => p.classList.remove('on'));
  panel.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('on'));
  const target = panel.querySelector(`#${prefix}-pane-${pane}`);
  if (target) target.classList.add('on');
  if (btn) btn.classList.add('on');
}

// ── Rename wrappers (HTML panels use type names, not space IDs) ──
function spRenameByType(type) {
  const sp = getSpaces().find(s => s.type === type);
  if (sp) spRename(sp.id);
}

// ── Rename space ──────────────────────────────────────────────
async function spRename(id) {
  const spaces = getSpaces();
  const sp = spaces.find(s => s.id === id);
  if (!sp) return;
  const name = await siModal.input('Rename Space', sp.name, sp.name, { confirmLabel:'Rename' });
  if (!name || !name.trim()) return;
  sp.name = name.trim();
  saveSpaces(spaces);
  if (id !== 'org') syncSpaceMeta(sp);
  spaceRenderSidebar();
  // Update panel name display
  const nameEl = id === 'org'
    ? $('os-space-name')
    : $(`${sp.type === 'personal' ? 'ps' : 'ac'}-space-name`);
  if (nameEl) nameEl.textContent = sp.name;
}

// ── More-menu ─────────────────────────────────────────────────
function spMoreMenu(id, btn) {
  const spaces = getSpaces();
  const sp = spaces.find(s => s.id === id);
  if (!sp) return;
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.cssText = 'position:fixed;z-index:9999;';
  const r = btn.getBoundingClientRect();
  menu.style.top  = r.bottom + 4 + 'px';
  menu.style.left = r.left + 'px';
  menu.innerHTML = `
    <div class="ctx-item" onclick="spRename('${id}')"><i class="ti ti-pencil"></i> Rename</div>
    ${sp.id !== 'org' ? `<div class="ctx-item ctx-danger" onclick="spDelete('${id}')"><i class="ti ti-trash"></i> Delete</div>` : ''}
  `;
  document.body.appendChild(menu);
  const remove = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click',remove); } };
  setTimeout(() => document.addEventListener('click', remove), 0);
}

async function spDelete(id) {
  const spaces = getSpaces();
  const sp = spaces.find(s => s.id === id);
  if (!sp || sp.id === 'org') return;
  if (!await siModal.confirm(`"${sp.name}" and all its data will be permanently deleted.`, { title:'Delete Space', confirmLabel:'Delete', danger:true })) return;
  saveSpaces(spaces.filter(s => s.id !== id));
  localStorage.removeItem(spaceDataKey(id));
  _spFetch('/api/spaces/delete', { space_id: id });
  spaceRenderSidebar();
  nav('home');
}

// ── Create Space modal ────────────────────────────────────────
let _cspType = 'personal';

function openCreateSpaceModal() {
  _cspType = '';
  const modal = $('create-space-modal');
  if (!modal) return;
  modal.querySelectorAll('.csp-type').forEach(el => el.classList.remove('selected'));
  const inp = $('csp-name-input');
  if (inp) inp.value = '';
  const nameRow = $('csp-name-row');
  const footer  = $('csp-footer');
  if (nameRow) nameRow.style.display = 'none';
  if (footer)  footer.style.display  = 'none';
  modal.style.display = 'flex';
}
function closeCreateSpaceModal() {
  const modal = $('create-space-modal');
  if (modal) modal.style.display = 'none';
}
function cspSelectType(type, el) {
  _cspType = type;
  document.querySelectorAll('.csp-type').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const nameRow = $('csp-name-row');
  const footer  = $('csp-footer');
  if (nameRow) { nameRow.style.display = 'block'; $('csp-name-input')?.focus(); }
  if (footer)  footer.style.display  = 'flex';
}
function cspCreate() {
  const inp  = $('csp-name-input');
  const name = inp ? inp.value.trim() : '';
  if (!_cspType) { toast('Please select a space type.'); return; }
  if (!name) { inp && inp.focus(); return; }
  const type = _cspType;
  if (type === 'org') {
    closeCreateSpaceModal();
    nav('org');
    return;
  }
  const icon  = type === 'personal' ? '👤' : '🎓';
  const id    = `sp_${Date.now()}`;
  const space = { id, name, type, icon };
  const spaces = getSpaces();
  spaces.push(space);
  saveSpaces(spaces);
  syncSpaceMeta(space);
  spaceRenderSidebar();
  closeCreateSpaceModal();
  openSpace(id);
}

/* ════════════════════════════════════════════════════════════
   PERSONAL SPACE (ps-*)
════════════════════════════════════════════════════════════ */
let _psId = null;

function psInit(id) {
  _psId = id;
  // Show first pane
  spTab('ps', 'overview', document.querySelector('#panel-personal .sp-tab'));
  psRenderOverview();
}

function psData() { return getSpaceData(_psId || 'personal'); }
function psSave(d) { setSpaceData(_psId || 'personal', d); }

function psRenderOverview() {
  const d = psData();
  const done    = (d.tasks   || []).filter(t => t.done).length;
  const goals   = (d.goals   || []).length;
  const bestStreak = (d.habits || []).reduce((mx, h) => Math.max(mx, h.streak||0), 0);
  const now     = new Date();
  const entries = (d.journal || []).filter(e => {
    const d2 = new Date(e.id); return d2.getMonth() === now.getMonth() && d2.getFullYear() === now.getFullYear();
  }).length;

  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('ps-done-today',    done);
  set('ps-active-goals',  goals);
  set('ps-habit-streak',  bestStreak + '🔥');
  set('ps-journal-month', entries);
  set('ps-streak',        d.streak || 0);
}

// Tasks / Kanban
async function psNewTask() {
  const title = await siModal.input('New Task', 'What needs to be done?', '', { confirmLabel:'Add Task' });
  if (!title) return;
  const d = psData();
  d.tasks = d.tasks || [];
  d.tasks.push({ id: Date.now(), title, status:'todo', done:false, created: Date.now() });
  psSave(d);
  psRenderKanban();
}

function psRenderKanban() {
  const kanban = $('ps-kanban');
  if (!kanban) return;
  const d = psData();
  const tasks = d.tasks || [];
  const cols = [
    { key:'todo',       label:'To Do' },
    { key:'inprogress', label:'In Progress' },
    { key:'done',       label:'Done' },
  ];
  kanban.innerHTML = cols.map(col => {
    const items = tasks.filter(t => t.status === col.key);
    return `<div class="os-col" style="min-width:200px;max-width:260px;flex:1">
      <div class="os-col-hd">
        <span class="os-col-title">${col.label}</span>
        <span class="os-col-count">${items.length}</span>
      </div>
      <div class="os-col-body">
        ${items.map(t => `<div class="os-task-card" onclick="psMoveTask(${t.id})">
          <span class="os-task-title">${t.title}</span>
        </div>`).join('')}
        <button class="os-add-task-btn" onclick="psNewTask()"><i class="ti ti-plus"></i> Add task</button>
      </div>
    </div>`;
  }).join('');
}

function psMoveTask(id) {
  const d = psData();
  const t = (d.tasks || []).find(t => t.id === id);
  if (!t) return;
  const order = ['todo','inprogress','done'];
  const next = order[(order.indexOf(t.status) + 1) % order.length];
  t.status = next; t.done = next === 'done';
  psSave(d); psRenderKanban();
}

// Goals
async function psNewGoal() {
  const title = await siModal.input('New Goal', 'e.g. Read 12 books this year', '', { confirmLabel:'Add Goal' });
  if (!title) return;
  const d = psData();
  d.goals = d.goals || [];
  d.goals.push({ id: Date.now(), title, progress: 0, target: 100 });
  psSave(d); psRenderGoals();
}

function psRenderGoals() {
  const grid = $('ps-goals-grid');
  if (!grid) return;
  const goals = psData().goals || [];
  if (!goals.length) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:.84rem">No goals yet.</p>'; return;
  }
  grid.innerHTML = goals.map(g => {
    const pct = Math.min(100, Math.round((g.progress / (g.target || 100)) * 100));
    return `<div class="sp-goal-card">
      <div class="sp-goal-title">${g.title}</div>
      <div class="sp-goal-bar-bg"><div class="sp-goal-bar-fill" style="width:${pct}%"></div></div>
      <div class="sp-goal-meta"><span>${pct}%</span><span onclick="psUpdateGoal(${g.id})" style="cursor:pointer;color:var(--blue)">Update</span></div>
    </div>`;
  }).join('');
}

async function psUpdateGoal(id) {
  const d = psData();
  const g = (d.goals || []).find(g => g.id === id);
  if (!g) return;
  const v = await siModal.input(`Update: ${g.title}`, `0 – ${g.target}`, String(g.progress), { type:'number', confirmLabel:'Update' });
  if (v === null) return;
  g.progress = Math.max(0, Math.min(g.target, parseInt(v) || 0));
  psSave(d); psRenderGoals();
}

// Habits
async function psNewHabit() {
  const name = await siModal.input('New Habit', 'e.g. Read 30 mins, Morning walk', '', { confirmLabel:'Add Habit' });
  if (!name) return;
  const d = psData();
  d.habits = d.habits || [];
  d.habits.push({ id: Date.now(), name, streak: 0, doneToday: false });
  psSave(d); psRenderHabits();
}

function psRenderHabits() {
  const list = $('ps-habits-list');
  if (!list) return;
  const habits = psData().habits || [];
  if (!habits.length) {
    list.innerHTML = '<p style="color:var(--muted);font-size:.84rem">No habits yet.</p>'; return;
  }
  list.innerHTML = habits.map(h => `
    <div class="sp-habit-row">
      <div class="sp-habit-check ${h.doneToday ? 'done' : ''}" onclick="psToggleHabit(${h.id})">
        ${h.doneToday ? '<i class="ti ti-check"></i>' : ''}
      </div>
      <span class="sp-habit-name">${h.name}</span>
      <span class="sp-habit-streak">🔥 ${h.streak}</span>
    </div>`).join('');
}

function psToggleHabit(id) {
  const d = psData();
  const h = (d.habits || []).find(h => h.id === id);
  if (!h) return;
  h.doneToday = !h.doneToday;
  h.streak = h.doneToday ? (h.streak || 0) + 1 : Math.max(0, (h.streak || 0) - 1);
  psSave(d); psRenderHabits();
}

// Journal
function psSaveJournal() {
  const textarea = $('ps-journal-text');
  if (!textarea || !textarea.value.trim()) return;
  const d = psData();
  d.journal = d.journal || [];
  d.journal.unshift({ id: Date.now(), text: textarea.value.trim(), date: new Date().toLocaleString() });
  textarea.value = '';
  psSave(d); psRenderJournal();
}

function psMood(mood, btn) {
  const d = psData();
  d.lastMood = mood;
  psSave(d);
  document.querySelectorAll('.sp-mood-btn').forEach(b => b.style.opacity = '.4');
  if (btn) btn.style.opacity = '1';
}

function psRenderJournal() {
  const entries = $('ps-journal-entries');
  if (!entries) return;
  const journal = psData().journal || [];
  entries.innerHTML = journal.map(e => `
    <div class="sp-journal-entry">
      <div class="sp-journal-entry-date">${e.date}</div>
      <div class="sp-journal-entry-text">${e.text}</div>
    </div>`).join('') || '<p style="color:var(--muted);font-size:.84rem">No entries yet.</p>';
}

// Notes
async function psNewNote() {
  const title = await siModal.input('New Note', 'Note title', '', { confirmLabel:'Create Note' });
  if (!title) return;
  const d = psData();
  d.notes = d.notes || [];
  d.notes.unshift({ id: Date.now(), title, body: '', date: new Date().toLocaleDateString() });
  psSave(d); psRenderNotes();
}

function psRenderNotes() {
  const grid = $('ps-notes-grid');
  if (!grid) return;
  const notes = psData().notes || [];
  if (!notes.length) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:.84rem">No notes yet.</p>'; return;
  }
  grid.innerHTML = notes.map(n => `
    <div class="sp-note-card" onclick="psEditNote(${n.id})">
      <div class="sp-note-title">${n.title}</div>
      <div class="sp-note-preview">${n.body || 'Empty note…'}</div>
      <div class="sp-note-date">${n.date}</div>
    </div>`).join('');
}

async function psEditNote(id) {
  const d = psData();
  const n = (d.notes || []).find(n => n.id === id);
  if (!n) return;
  const body = await siModal.input(`Edit: ${n.title}`, 'Note content…', n.body, { confirmLabel:'Save', type:'text' });
  if (body === null) return;
  n.body = body;
  psSave(d); psRenderNotes();
}

/* ════════════════════════════════════════════════════════════
   ACADEMIC SPACE (ac-*)
════════════════════════════════════════════════════════════ */
let _acId = null;
let _acTimer = null;
let _acTimerRunning = false;
let _acTimerSeconds = 25 * 60;
let _acTimerMode = 'focus';
const _acTimerModes = { focus: 25*60, short: 5*60, long: 15*60 };
let _acCards = [];
let _acCardIdx = 0;
let _acQuizQ = 0;
let _acQuizScore = 0;
let _acQuizItems = [];

function acInit(id) {
  _acId = id;
  spTab('ac', 'overview', document.querySelector('#panel-academic .sp-tab'));
  acRenderOverview();
}

function acData() { return getSpaceData(_acId || 'academic'); }
function acSave(d) { setSpaceData(_acId || 'academic', d); }

function acRenderOverview() {
  const d = acData();
  const courses  = (d.courses || []).length;
  const sessions = d.pomodoroSessions || 0;
  const ratings  = d.cardRatings || {};
  const goodCount = Object.values(ratings).filter(r => r === 'good' || r === 'easy').length;
  const total     = Object.keys(ratings).length || 1;
  const acc = total > 1 ? Math.round(goodCount / total * 100) + '%' : '—';

  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('ac-course-count',  courses);
  set('ac-cards-today',   sessions > 0 ? Object.keys(ratings).length : 0);
  set('ac-quiz-acc',      acc);
  set('ac-study-streak',  (d.studyStreak || 0) + '🔥');
  set('ac-exam-countdown','—');
}

// ── Courses ──────────────────────────────────────────────────
async function acAddCourse() {
  const d2 = await siModal.form('Add Course', [
    { id:'name', label:'Course name',            placeholder:'e.g. Data Structures', required:true },
    { id:'code', label:'Course code (optional)', placeholder:'e.g. CSC 301' },
  ], { confirmLabel:'Add Course' });
  if (!d2 || !d2.name) return;
  const d = acData();
  d.courses = d.courses || [];
  d.courses.push({ id: Date.now(), name: d2.name, code: d2.code||'', progress: 0 });
  acSave(d); acRenderCourses();
}

function acRenderCourses() {
  const grid = $('ac-courses-grid');
  if (!grid) return;
  const courses = acData().courses || [];
  if (!courses.length) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:.84rem">No courses yet.</p>'; return;
  }
  grid.innerHTML = courses.map(c => `
    <div class="sp-course-card" onclick="acUpdateCourse(${c.id})">
      <div class="sp-course-banner"></div>
      <div class="sp-course-body">
        <div class="sp-course-title">${c.name}</div>
        <div class="sp-course-code">${c.code}</div>
        <div class="sp-course-prog">
          <div class="sp-course-bar"><div class="sp-course-bar-fill" style="width:${c.progress}%"></div></div>
          <span class="sp-course-pct">${c.progress}%</span>
        </div>
      </div>
    </div>`).join('');
}

async function acUpdateCourse(id) {
  const d = acData();
  const c = (d.courses || []).find(c => c.id === id);
  if (!c) return;
  const v = await siModal.input(`${c.name} Progress`, '0 – 100', String(c.progress), { type:'number', confirmLabel:'Update' });
  if (v === null) return;
  c.progress = Math.max(0, Math.min(100, parseInt(v) || 0));
  acSave(d); acRenderCourses();
}

// ── Flashcards ───────────────────────────────────────────────
function acLoadCards() {
  _acCards = acData().cards || [];
  _acCardIdx = 0;
  acShowCard();
}

function acShowCard() {
  const inner = $('ac-flashcard-inner');
  const qEl   = $('ac-fc-question');
  const aEl   = $('ac-fc-answer');
  const nav   = $('ac-fc-counter');
  const rateRow = $('ac-rate-row');
  if (!inner) return;
  if (!_acCards.length) {
    if (qEl) qEl.textContent = 'No cards yet — add one below.';
    if (aEl) aEl.textContent = '';
    if (nav) nav.textContent = 'Card 0 of 0';
    if (rateRow) rateRow.style.display = 'none';
    return;
  }
  const card = _acCards[_acCardIdx];
  inner.classList.remove('flipped');
  if (qEl) qEl.textContent = card.q;
  if (aEl) aEl.textContent = card.a;
  if (nav) nav.textContent = `Card ${_acCardIdx + 1} of ${_acCards.length}`;
  if (rateRow) rateRow.style.display = 'flex';
}

function acFlipCard() {
  const inner = $('ac-flashcard-inner');
  if (inner) inner.classList.toggle('flipped');
}

function acRateCard(rating) {
  if (!_acCards.length) return;
  const d = acData();
  d.cardRatings = d.cardRatings || {};
  d.cardRatings[_acCards[_acCardIdx].id] = rating;
  acSave(d);
  _acCardIdx = (_acCardIdx + 1) % _acCards.length;
  acShowCard();
}

function acPrevCard() {
  if (!_acCards.length) return;
  _acCardIdx = (_acCardIdx - 1 + _acCards.length) % _acCards.length;
  acShowCard();
}

function acNextCard() {
  if (!_acCards.length) return;
  _acCardIdx = (_acCardIdx + 1) % _acCards.length;
  acShowCard();
}

async function acAddCard() {
  const qEl = $('ac-card-q');
  const aEl = $('ac-card-a');
  let q = qEl ? qEl.value.trim() : null;
  let a = aEl ? aEl.value.trim() : null;
  if (!q || !a) {
    const d2 = await siModal.form('Add Flashcard', [
      { id:'q', label:'Question', placeholder:'Front of card', required:true },
      { id:'a', label:'Answer',   placeholder:'Back of card',  required:true },
    ], { confirmLabel:'Add Card' });
    if (!d2 || !d2.q || !d2.a) return;
    q = d2.q; a = d2.a;
  }
  if (!q || !a) return;
  const d = acData();
  d.cards = d.cards || [];
  d.cards.push({ id: Date.now(), q, a });
  acSave(d);
  if (qEl) qEl.value = '';
  if (aEl) aEl.value = '';
  _acCards = d.cards;
  _acCardIdx = d.cards.length - 1;
  acShowCard();
}

// ── Pomodoro Timer ────────────────────────────────────────────
function acSetMode(mode, btn) {
  _acTimerMode = mode;
  _acTimerSeconds = _acTimerModes[mode] || 25*60;
  acTimerStop();
  acRenderTimer();
  document.querySelectorAll('.sp-tmode-btn').forEach(b => b.classList.remove('sp-tmode-active'));
  if (btn) btn.classList.add('sp-tmode-active');
  const lbl = $('ac-timer-label');
  if (lbl) lbl.textContent = mode === 'focus' ? 'Focus session' : mode === 'short' ? 'Short break' : 'Long break';
}

function acTimerToggle() {
  if (_acTimerRunning) acTimerStop();
  else acTimerStart();
}

function acTimerStart() {
  if (_acTimerRunning) return;
  _acTimerRunning = true;
  const btn = $('ac-timer-start');
  if (btn) btn.innerHTML = '<i class="ti ti-player-pause"></i> Pause';
  const startBtn = $('ac-timer-start');
  if (startBtn) startBtn.textContent = 'Pause';
  _acTimer = setInterval(() => {
    if (_acTimerSeconds <= 0) {
      acTimerStop();
      if (_acTimerMode === 'focus') {
        const d = acData();
        d.pomodoroSessions = (d.pomodoroSessions || 0) + 1;
        d.studyStreak = (d.studyStreak || 0) + 1;
        acSave(d);
        const el = $('ac-t-today');
        if (el) el.textContent = d.pomodoroSessions;
      }
      _acTimerSeconds = _acTimerModes[_acTimerMode] || 25*60;
    } else {
      _acTimerSeconds--;
    }
    acRenderTimer();
  }, 1000);
}

function acTimerStop() {
  _acTimerRunning = false;
  if (_acTimer) { clearInterval(_acTimer); _acTimer = null; }
  const btn = $('ac-timer-start');
  if (btn) btn.textContent = 'Start';
}

function acTimerReset() {
  acTimerStop();
  _acTimerSeconds = _acTimerModes[_acTimerMode] || 25*60;
  acRenderTimer();
}

function acRenderTimer() {
  const m = Math.floor(_acTimerSeconds / 60).toString().padStart(2,'0');
  const s = (_acTimerSeconds % 60).toString().padStart(2,'0');
  const el = $('ac-timer-display');
  if (el) el.textContent = `${m}:${s}`;
}

// ── Quiz ──────────────────────────────────────────────────────
function acStartQuiz() {
  const cards = acData().cards || [];
  if (cards.length < 2) { toast('Add at least 2 flashcards to start a quiz.'); return; }
  _acQuizItems = [...cards].sort(() => Math.random() - .5).slice(0, Math.min(10, cards.length));
  _acQuizQ = 0; _acQuizScore = 0;
  const cfg = $('ac-quiz-config');
  const active = $('ac-quiz-active');
  if (cfg) cfg.style.display = 'none';
  if (active) active.style.display = 'flex';
  acRenderQuizQ();
}

function acRenderQuizQ() {
  const active = $('ac-quiz-active');
  if (!active) return;
  if (_acQuizQ >= _acQuizItems.length) {
    active.innerHTML = `<div class="sp-quiz-result">
      <div style="font-size:2rem">🎉</div>
      <div style="font-size:1.1rem;font-weight:700;margin:8px 0">Quiz Complete!</div>
      <div>Score: ${_acQuizScore} / ${_acQuizItems.length}</div>
      <button class="sp-timer-btn sp-timer-start" style="margin-top:16px" onclick="acResetQuiz()">Try Again</button>
    </div>`;
    return;
  }
  const q = _acQuizItems[_acQuizQ];
  const others = (acData().cards || []).filter(c => c.id !== q.id);
  const wrongs = others.sort(() => Math.random() - .5).slice(0, 3).map(c => c.a);
  const opts = [...wrongs, q.a].sort(() => Math.random() - .5);
  active.innerHTML = `
    <div style="font-size:.72rem;color:var(--muted)">${_acQuizQ+1} / ${_acQuizItems.length}</div>
    <div class="sp-quiz-q">${q.q}</div>
    <div class="sp-quiz-opts">
      ${opts.map(o => `<button class="sp-quiz-opt" onclick="acAnswerQuiz(this,'${o.replace(/'/g,"\\'")}','${q.a.replace(/'/g,"\\'")}')">
        ${o}
      </button>`).join('')}
    </div>`;
}

function acAnswerQuiz(btn, chosen, correct) {
  document.querySelectorAll('.sp-quiz-opt').forEach(b => b.disabled = true);
  if (chosen === correct) {
    btn.classList.add('correct'); _acQuizScore++;
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.sp-quiz-opt').forEach(b => {
      if (b.textContent.trim() === correct) b.classList.add('correct');
    });
  }
  setTimeout(() => { _acQuizQ++; acRenderQuizQ(); }, 1200);
}

function acResetQuiz() {
  const cfg = $('ac-quiz-config');
  const active = $('ac-quiz-active');
  if (cfg) cfg.style.display = 'flex';
  if (active) active.style.display = 'none';
}

// ── Study Groups ──────────────────────────────────────────────
async function acNewGroup() {
  const d2 = await siModal.form('New Study Group', [
    { id:'name',    label:'Group name', placeholder:'e.g. CSC 401 Study Team', required:true },
    { id:'subject', label:'Subject',    placeholder:'e.g. Operating Systems' },
  ], { confirmLabel:'Create Group' });
  if (!d2 || !d2.name) return;
  const d = acData();
  d.groups = d.groups || [];
  d.groups.push({ id: Date.now(), name: d2.name, subject: d2.subject||'', members: 1 });
  acSave(d); acRenderGroups();
}

function acJoinGroup(id) {
  const d = acData();
  const g = (d.groups || []).find(g => g.id === id);
  if (!g) return;
  g.members = (g.members || 1) + 1;
  acSave(d); acRenderGroups();
}

function acRenderGroups() {
  const grid = $('ac-groups-grid');
  if (!grid) return;
  const groups = acData().groups || [];
  if (!groups.length) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:.84rem">No groups yet.</p>'; return;
  }
  grid.innerHTML = groups.map(g => `
    <div class="sp-group-card">
      <div class="sp-group-name">${g.name}</div>
      <div class="sp-group-sub">${g.subject}</div>
      <div class="sp-group-badge"><i class="ti ti-users"></i> ${g.members} member${g.members !== 1 ? 's' : ''}</div>
      <button class="sp-timer-btn" style="margin-top:8px;background:var(--amber3);color:#fff;padding:6px 14px;font-size:.76rem" onclick="acJoinGroup(${g.id})">Join</button>
    </div>`).join('');
}

// ── Quiz helpers ──────────────────────────────────────────────
function acSetDiff(diff, btn) {
  document.querySelectorAll('.sp-diff-btn').forEach(b => b.classList.remove('sp-diff-active'));
  if (btn) btn.classList.add('sp-diff-active');
}
function acQuizSkip() { _acQuizQ++; acRenderQuizQ(); }
function acQuizNext() { _acQuizQ++; acRenderQuizQ(); }

// ── Course filter ─────────────────────────────────────────────
function acFilterCourses(filter, btn) {
  document.querySelectorAll('.sp-tool-btn').forEach(b => b.classList.remove('sp-tool-amber-active'));
  if (btn) btn.classList.add('sp-tool-amber-active');
  const d = acData();
  let courses = d.courses || [];
  if (filter === 'active') courses = courses.filter(c => c.progress < 100);
  if (filter === 'done')   courses = courses.filter(c => c.progress >= 100);
  const grid = $('ac-courses-grid');
  if (!grid) return;
  if (!courses.length) { grid.innerHTML = '<p style="color:var(--muted);font-size:.84rem">No courses.</p>'; return; }
  grid.innerHTML = courses.map(c => `
    <div class="sp-course-card" onclick="acUpdateCourse(${c.id})">
      <div class="sp-course-banner"></div>
      <div class="sp-course-body">
        <div class="sp-course-title">${c.name}</div>
        <div class="sp-course-code">${c.code}</div>
        <div class="sp-course-prog">
          <div class="sp-course-bar"><div class="sp-course-bar-fill" style="width:${c.progress}%"></div></div>
          <span class="sp-course-pct">${c.progress}%</span>
        </div>
      </div>
    </div>`).join('');
}

// ── Planner plan generator ────────────────────────────────────
function acGenPlan() {
  const subject = $('ac-plan-subject')?.value.trim();
  const date    = $('ac-plan-date')?.value;
  const hrs     = parseInt($('ac-plan-hrs')?.value || '2');
  if (!subject) { alert('Enter a subject or exam title.'); return; }
  const d = acData();
  d.plan = d.plan || [];
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const items = days.slice(0,5).map(day => ({
    id: Date.now() + Math.random(), title: `${subject} — ${hrs}h review`, due: day
  }));
  d.plan = [...items, ...d.plan];
  acSave(d); acRenderPlan();
}

// ── Planner ───────────────────────────────────────────────────
async function acCreatePlan() {
  const d2 = await siModal.form('New Plan Item', [
    { id:'title', label:'Title',    placeholder:'Assignment or study plan', required:true },
    { id:'due',   label:'Due date', placeholder:'e.g. Mon, May 13', default:'TBD' },
  ], { confirmLabel:'Add to Plan' });
  if (!d2 || !d2.title) return;
  const d = acData();
  d.plan = d.plan || [];
  d.plan.unshift({ id: Date.now(), title: d2.title, due: d2.due||'TBD' });
  acSave(d); acRenderPlan();
}

function acRenderPlan() {
  const cont = $('ac-plan-content');
  if (!cont) return;
  const items = acData().plan || [];
  if (!items.length) {
    cont.innerHTML = '<p style="color:var(--muted);font-size:.84rem">No plan items yet.</p>'; return;
  }
  cont.innerHTML = `<div class="sp-plan-week">
    <div class="sp-plan-week-hd">Upcoming</div>
    ${items.map(it => `
      <div class="sp-plan-item">
        <div class="sp-plan-dot"></div>
        <span class="sp-plan-text">${it.title}</span>
        <span class="sp-plan-due">${it.due}</span>
      </div>`).join('')}
  </div>`;
}


// ═══════════════════════════════════════════════════════════════
//  AGENTS MARKETPLACE
// ═══════════════════════════════════════════════════════════════

const _ag = {
  view:       'marketplace', // current sub-view
  category:   'all',
  filters:    [],
  templates:  [],
  agents:     [],
  myAgent:    null,
  viewStack:  [], // for back-button navigation
  currency:   'usd', // 'usd' | 'ngn'
  nairaRate:  1650,
  paystackKey: '',
  paystackAvailable: false,
  stripeAvailable:   false,
  payConfig:  null,    // cache from /api/config/payment
};

const AG_CAT_COLORS = {
  workspace:  '#4f6ef7',
  academic:   '#d97706',
  ai_prompts: '#6b7280',
  goals:      '#22c55e',
  journal:    '#7f77dd',
  study_decks:'#d85a30',
};
const AG_CAT_ICONS = {
  workspace:  'ti-layout-dashboard',
  academic:   'ti-school',
  ai_prompts: 'ti-message-bolt',
  goals:      'ti-target',
  journal:    'ti-notebook',
  study_decks:'ti-cards',
};
const AG_CAT_LABELS = {
  all:        'All',
  workspace:  'Workspace',
  academic:   'Academic',
  ai_prompts: 'AI Prompts',
  goals:      'Goals',
  journal:    'Journal',
  study_decks:'Study Decks',
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
    const r = await fetch('/api/config/payment');
    const d = await r.json();
    _ag.paystackKey       = d.paystack_public_key || '';
    _ag.paystackAvailable = d.paystack_available  || false;
    _ag.stripeAvailable   = d.stripe_available    || false;
    _ag.nairaRate         = d.naira_rate          || 1650;
    _ag.payConfig = d;
    // Load Paystack inline JS if available and not already loaded
    if (_ag.paystackAvailable && !window.PaystackPop) {
      agLoadPaystackScript();
    }
  } catch { /* no payment config */ }
}

function agLoadPaystackScript() {
  if (document.getElementById('paystack-js')) return;
  const s = document.createElement('script');
  s.id  = 'paystack-js';
  s.src = 'https://js.paystack.co/v1/inline.js';
  s.async = true;
  document.head.appendChild(s);
}

async function agLoadMyAgent() {
  if (!S.token) return;
  try {
    const r = await fetch(`/api/agents/me?token=${S.token}`);
    const d = await r.json();
    _ag.myAgent = d.agent || null;
  } catch { _ag.myAgent = null; }
}

function agUpdateTopbarBtn() {
  const label = $('ag-btn-label');
  if (label) {
    label.textContent = _ag.myAgent ? 'Dashboard' : 'Become an Agent';
  }
}

// ── Fetch ─────────────────────────────────────────────────────
async function agFetchTemplates(category = 'all', sort = 'popular') {
  try {
    const r = await fetch(`/api/agents/templates?category=${category}&sort=${sort}&limit=60`);
    const d = await r.json();
    _ag.templates = d.templates || [];
  } catch { _ag.templates = []; }
}

async function agFetchAgents(sort = 'downloads') {
  try {
    const r = await fetch(`/api/agents?sort=${sort}`);
    const d = await r.json();
    _ag.agents = d.agents || [];
  } catch { _ag.agents = []; }
}

// ── Navigation ────────────────────────────────────────────────
function agNav(view, pushStack = true) {
  if (pushStack && view !== _ag.view) _ag.viewStack.push(_ag.view);
  _ag.view = view;
  const backBtn = $('ag-back-btn');
  if (backBtn) backBtn.style.display = _ag.viewStack.length ? 'flex' : 'none';
  agUpdateTitle(view);
}

function agBack() {
  if (!_ag.viewStack.length) return;
  const prev = _ag.viewStack.pop();
  _ag.view = prev;
  const backBtn = $('ag-back-btn');
  if (backBtn) backBtn.style.display = _ag.viewStack.length ? 'flex' : 'none';
  agUpdateTitle(prev);

  if (prev === 'marketplace') agRenderMarketplace();
  else if (prev === 'directory') agRenderDirectory();
  else if (prev === 'apply')   agRenderApply();
  else if (prev === 'dashboard') agRenderDashboard();
  else agRenderMarketplace();
}

function agUpdateTitle(view) {
  const titles = {
    marketplace: 'Sivarr Agents',
    directory:   'Browse Agents',
    apply:       'Become an Agent',
    dashboard:   'Creator Dashboard',
    builder:     'New Template',
    detail:      'Template',
    profile:     'Agent Profile',
  };
  const t = $('ag-topbar-title');
  if (t) t.textContent = titles[view] || 'Sivarr Agents';
}

function agNavDashboardOrApply() {
  if (_ag.myAgent) {
    agNav('dashboard');
    agRenderDashboard();
  } else {
    agNav('apply');
    agRenderApply();
  }
}

// ── Loading state ─────────────────────────────────────────────
function agRenderLoading() {
  const v = $('ag-view');
  if (v) v.innerHTML = `<div class="ag-loading"><div class="ag-spinner"></div><span>Loading…</span></div>`;
}

// ── Currency helpers ──────────────────────────────────────────
function agNgnPrice(t) {
  if (t.price_ngn != null) return t.price_ngn;
  return Math.round(parseFloat(t.price || 0) * _ag.nairaRate);
}

function agFormatPrice(t) {
  if (_ag.currency === 'ngn') {
    const ngn = agNgnPrice(t);
    return ngn === 0 ? 'Free' : `₦${ngn.toLocaleString()}`;
  }
  const usd = parseFloat(t.price || 0);
  return usd === 0 ? 'Free' : `$${usd.toFixed(2)}`;
}

function agIsFree(t) {
  return parseFloat(t.price || 0) === 0;
}

function agSetCurrency(cur) {
  _ag.currency = cur;
  // Re-render grid in-place without full fetch
  const grid = $('ag-grid');
  if (grid) {
    const filtered = agApplyFilters(_ag.templates, _ag.category, _ag.filters);
    grid.innerHTML = filtered.length
      ? filtered.map(t => agTemplateCardHTML(t)).join('')
      : '<div class="ag-empty"><div class="ag-empty-icon">🔍</div><p>No templates found.</p></div>';
  }
  // Update toggle visual
  document.querySelectorAll('.ag-currency-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.cur === cur);
  });
}

// ── Marketplace ───────────────────────────────────────────────
async function agRenderMarketplace() {
  agNav('marketplace', false);
  const v = $('ag-view');
  if (!v) return;

  const filtered = agApplyFilters(_ag.templates, _ag.category, _ag.filters);

  v.innerHTML = `
    <div class="ag-market-wrap">

      <!-- Category tabs + currency toggle row -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <div class="ag-cats" style="flex:1;margin-bottom:0">
          ${['all','workspace','academic','ai_prompts','goals','journal','study_decks'].map(c => `
            <button class="ag-cat${_ag.category===c?' active':''}"
              onclick="agSetCategory('${c}')">${AG_CAT_LABELS[c]||c}</button>
          `).join('')}
        </div>
        <div class="ag-currency-toggle">
          <button class="ag-currency-opt usd${_ag.currency==='usd'?' active':''}"
            data-cur="usd" onclick="agSetCurrency('usd')">$ USD</button>
          <button class="ag-currency-opt ngn${_ag.currency==='ngn'?' active':''}"
            data-cur="ngn" onclick="agSetCurrency('ngn')">₦ NGN</button>
        </div>
      </div>

      <!-- Filter chips -->
      <div class="ag-filters">
        ${[
          {id:'popular',   label:'🔥 Most popular'},
          {id:'new',       label:'✨ New this week'},
          {id:'free',      label:'🆓 Free only'},
          {id:'under5',    label:'💸 Under $5'},
          {id:'top_rated', label:'⭐ Top rated'},
        ].map(f => `
          <button class="ag-chip${_ag.filters.includes(f.id)?' active':''}"
            onclick="agToggleFilter('${f.id}')">${f.label}</button>
        `).join('')}
      </div>

      <!-- Featured banner -->
      ${await agFeaturedBannerHTML()}

      <!-- Template grid -->
      <div class="ag-section-hd">
        <div class="ag-section-title">🔥 Trending this week</div>
        <span class="ag-section-link" onclick="agNav('directory');agRenderDirectory()">
          All agents →
        </span>
      </div>
      <div class="ag-grid" id="ag-grid">
        ${filtered.length
          ? filtered.map(t => agTemplateCardHTML(t)).join('')
          : '<div class="ag-empty"><div class="ag-empty-icon">🔍</div><p>No templates found.</p></div>'}
      </div>

      <!-- Top agents section -->
      <div class="ag-section-hd" style="margin-top:8px">
        <div class="ag-section-title">🌟 Top agents</div>
        <span class="ag-section-link" onclick="agNav('directory');agRenderDirectory()">See all →</span>
      </div>
      <div id="ag-agents-preview">
        <div class="ag-loading" style="height:100px"><div class="ag-spinner"></div></div>
      </div>

    </div>
  `;

  // Load agents in background
  agFetchAgents().then(() => {
    const cont = $('ag-agents-preview');
    if (!cont) return;
    if (!_ag.agents.length) {
      cont.innerHTML = '<p style="font-size:.8rem;color:var(--muted);padding:12px 0">No agents yet — be the first to apply!</p>';
      return;
    }
    cont.innerHTML = _ag.agents.slice(0,5).map(a => agAgentRowHTML(a)).join('');
  });
}

async function agFeaturedBannerHTML() {
  try {
    const r = await fetch('/api/agents/featured');
    const d = await r.json();
    const t = d.template;
    if (!t || !t.id) return '';
    const color = t.thumbnail_color || AG_CAT_COLORS[t.category] || '#4f6ef7';
    const icon  = AG_CAT_ICONS[t.category] || 'ti-template';
    return `
      <div class="ag-featured" style="margin-bottom:24px" onclick="agOpenTemplate('${t.id}')">
        <div class="ag-feat-thumb" style="background:${color}20">
          <i class="ti ${icon}" style="color:${color};font-size:2.5rem"></i>
        </div>
        <div class="ag-feat-body">
          <div class="ag-feat-label">⭐ Featured this week</div>
          <div class="ag-feat-name">${esc(t.name)}</div>
          <div class="ag-feat-desc">${esc(t.short_description||'')}</div>
          <div class="ag-feat-meta">
            <span>by <strong>${esc(t.agent_name||'')}</strong></span>
            <span>📥 ${t.download_count||0} downloads</span>
            <span>★ ${(t.avg_rating||0).toFixed(1)}</span>
          </div>
          <div class="ag-feat-actions">
            <button class="ag-get-btn" onclick="event.stopPropagation();agOpenTemplate('${t.id}')">
              Preview template →
            </button>
          </div>
        </div>
      </div>`;
  } catch { return ''; }
}

function agTemplateCardHTML(t) {
  const color      = t.thumbnail_color || AG_CAT_COLORS[t.category] || '#4f6ef7';
  const icon       = AG_CAT_ICONS[t.category] || 'ti-template';
  const isFree     = agIsFree(t);
  const priceLabel = agFormatPrice(t);
  const price      = parseFloat(t.price||0);
  const priceNgn   = agNgnPrice(t);
  return `
    <div class="ag-card" onclick="agOpenTemplate('${t.id}')">
      <div class="ag-card-thumb" style="background:${color}20">
        <i class="ti ${icon}" style="color:${color};font-size:1.8rem"></i>
      </div>
      <div class="ag-card-body">
        <span class="ag-card-tag">${AG_CAT_LABELS[t.category]||t.category}</span>
        <div class="ag-card-name">${esc(t.name)}</div>
        <div class="ag-card-meta">
          <div class="ag-mini-av">${(t.agent_name||'?')[0].toUpperCase()}</div>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.agent_name||'')}</span>
          <span class="ag-card-rating">★ ${(t.avg_rating||0).toFixed(1)}</span>
        </div>
        <div class="ag-card-footer">
          <div>
            <span class="ag-price${isFree?' free':''}">${priceLabel}</span>
            ${!isFree && _ag.currency === 'usd' ? `<div class="ag-price-ngn">≈ ₦${priceNgn.toLocaleString()}</div>` : ''}
            ${!isFree && _ag.currency === 'ngn' ? `<div class="ag-price-ngn">≈ $${price.toFixed(2)}</div>` : ''}
          </div>
          <button class="ag-get-btn"
            onclick="event.stopPropagation();agHandleGet('${t.id}',${price})">
            Get
          </button>
        </div>
      </div>
    </div>`;
}

function agAgentRowHTML(a) {
  return `
    <div class="ag-agent-row" onclick="agOpenAgentProfile('${a.id}')">
      <div class="ag-agent-av">${(a.display_name||'?')[0].toUpperCase()}</div>
      <div class="ag-agent-info">
        <div class="ag-agent-name">
          ${esc(a.display_name||'')}
          ${a.verified ? '<i class="ti ti-rosette-discount-check ag-verified-badge" title="Verified"></i>' : ''}
        </div>
        <div class="ag-agent-stats">${a.total_downloads||0} downloads · ★ ${(a.avg_rating||0).toFixed(1)}</div>
      </div>
      <button class="ag-tb-btn" style="font-size:.72rem;padding:4px 10px">View</button>
    </div>`;
}

// ── Filters ───────────────────────────────────────────────────
async function agSetCategory(cat) {
  _ag.category = cat;
  agRenderLoading();
  await agFetchTemplates(cat === 'all' ? 'all' : cat);
  agRenderMarketplace();
}

function agToggleFilter(id) {
  const idx = _ag.filters.indexOf(id);
  if (idx === -1) _ag.filters.push(id);
  else _ag.filters.splice(idx, 1);
  const v = $('ag-view');
  if (v) {
    // re-render just the chips + grid without full refetch
    const chips = v.querySelectorAll('.ag-chip');
    chips.forEach(c => {
      const cid = c.getAttribute('onclick').match(/'(\w+)'/)?.[1];
      if (cid) c.classList.toggle('active', _ag.filters.includes(cid));
    });
    const grid = $('ag-grid');
    if (grid) {
      const filtered = agApplyFilters(_ag.templates, _ag.category, _ag.filters);
      grid.innerHTML = filtered.length
        ? filtered.map(t => agTemplateCardHTML(t)).join('')
        : '<div class="ag-empty"><div class="ag-empty-icon">🔍</div><p>No templates found.</p></div>';
    }
  }
}

function agApplyFilters(templates, category, filters) {
  let list = [...templates];
  if (category && category !== 'all') list = list.filter(t => t.category === category);
  if (filters.includes('free'))     list = list.filter(t => parseFloat(t.price||0) === 0);
  if (filters.includes('under5'))   list = list.filter(t => parseFloat(t.price||0) < 5);
  if (filters.includes('top_rated'))list = [...list].sort((a,b) => (b.avg_rating||0) - (a.avg_rating||0));
  if (filters.includes('popular'))  list = [...list].sort((a,b) => (b.download_count||0) - (a.download_count||0));
  if (filters.includes('new'))      list = [...list].sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
  return list;
}

// ── Template detail ───────────────────────────────────────────
async function agOpenTemplate(id) {
  agNav('detail');
  agRenderLoading();
  const v = $('ag-view');
  if (!v) return;
  try {
    const r = await fetch(`/api/agents/templates/${id}`);
    const d = await r.json();
    const t = d.template;
    if (!t || !t.id) { v.innerHTML = '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Template not found.</p></div>'; return; }
    const color    = t.thumbnail_color || AG_CAT_COLORS[t.category] || '#4f6ef7';
    const icon     = AG_CAT_ICONS[t.category] || 'ti-template';
    const price    = parseFloat(t.price||0);
    const isFree   = price === 0;
    const priceNgn = agNgnPrice(t);

    // Check ownership
    let owned = false;
    if (S.token) {
      try {
        const or = await fetch(`/api/agents/templates/${id}/owned?token=${S.token}`);
        const od = await or.json();
        owned = od.owned;
      } catch {}
    }

    const reviewsHTML = (t.reviews||[]).map(rv => `
      <div class="ag-review-item">
        <div class="ag-review-header">
          <div class="ag-review-av">${(rv.reviewer_name||'?')[0].toUpperCase()}</div>
          <span class="ag-review-name">${esc(rv.reviewer_name||'')}</span>
          <span class="ag-review-stars">${'★'.repeat(rv.rating||5)}</span>
        </div>
        <div class="ag-review-text">${esc(rv.review_text||'')}</div>
      </div>`).join('') || '<p style="font-size:.8rem;color:var(--muted)">No reviews yet. Be the first!</p>';

    const includedHTML = (t.included_items||[]).map(item => `
      <div class="ag-included-item">
        <i class="ti ${item.icon||'ti-check'}"></i>
        <span>${esc(item.description||'')}</span>
      </div>`).join('') || agDefaultIncluded(t.contents || {});

    v.innerHTML = `
      <div class="ag-detail-wrap">
        <div class="ag-detail-grid">
          <!-- Left column -->
          <div>
            <div class="ag-detail-thumb" style="background:${color}20">
              <i class="ti ${icon}" style="color:${color}"></i>
            </div>
            <div class="ag-detail-cat">${AG_CAT_LABELS[t.category]||t.category}</div>
            <div class="ag-detail-name">${esc(t.name)}</div>
            <div class="ag-detail-agent-row">
              <div class="ag-detail-agent-av">${(t.agent_name||'?')[0].toUpperCase()}</div>
              <span onclick="agOpenAgentProfile('${t.agent_id}')" style="cursor:pointer;color:var(--accent)">
                ${esc(t.agent_name||'')}
              </span>
              ${t.agent_verified ? '<i class="ti ti-rosette-discount-check ag-verified-badge"></i>' : ''}
              <span class="ag-detail-stars">${'★'.repeat(Math.round(t.avg_rating||0))}${'☆'.repeat(5-Math.round(t.avg_rating||0))}</span>
              <span style="color:var(--muted)">(${t.review_count||0})</span>
            </div>
            <div class="ag-detail-desc">${esc(t.full_description||t.short_description||'')}</div>
            <div class="ag-detail-stats-row">
              <span><strong>${isFree ? 'Free' : '$'+price.toFixed(2)}</strong> price</span>
              <span><strong>${t.download_count||0}</strong> downloads</span>
              <span><strong>${(t.avg_rating||0).toFixed(1)}</strong> rating</span>
            </div>
            ${!isFree && !owned ? `
              <div class="ag-pay-methods">
                <div class="ag-pay-method stripe${_ag.currency==='usd'?' active':''}"
                  onclick="agSelectPayment('${id}',${price},'usd')">
                  <i class="ti ti-credit-card"></i>
                  <div>
                    <div style="font-weight:700">$${price.toFixed(2)} <span style="font-size:.7rem;font-weight:400">USD</span></div>
                    <div style="font-size:.68rem;color:var(--muted)">via Stripe</div>
                  </div>
                </div>
                ${_ag.paystackAvailable ? `
                <div class="ag-pay-method paystack${_ag.currency==='ngn'?' active':''}"
                  onclick="agSelectPayment('${id}',${price},'ngn')">
                  <i class="ti ti-currency-naira"></i>
                  <div>
                    <div style="font-weight:700">₦${priceNgn.toLocaleString()} <span style="font-size:.7rem;font-weight:400">NGN</span></div>
                    <div style="font-size:.68rem;color:var(--muted)">via Paystack</div>
                  </div>
                </div>` : ''}
              </div>` : ''}
            <button class="ag-detail-cta${owned?' owned':''}"
              onclick="${owned ? '' : `agHandleGet('${id}',${price})`}">
              ${owned ? '✓ Installed' : isFree ? 'Get for free'
                : _ag.currency === 'ngn' && _ag.paystackAvailable
                  ? `Buy for ₦${priceNgn.toLocaleString()}`
                  : `Buy for $${price.toFixed(2)}`}
            </button>
            <button class="ag-detail-secondary" onclick="agOpenAgentProfile('${t.agent_id}')">
              View agent profile
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
              ${owned ? `
                <button style="margin-top:10px;width:100%;padding:7px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--accent);font-size:.78rem;font-weight:700;cursor:pointer"
                  onclick="agLeaveReview('${id}')">
                  + Leave a review
                </button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  } catch {
    v.innerHTML = '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Failed to load template.</p></div>';
  }
}

function agDefaultIncluded(contents) {
  const items = [];
  if ((contents.spaces||[]).length)      items.push({icon:'ti-layout-sidebar',description:`${contents.spaces.length} Space${contents.spaces.length>1?'s':''}`});
  if ((contents.tasks||[]).length)       items.push({icon:'ti-checkbox',description:`${contents.tasks.length} pre-built tasks`});
  if ((contents.habits||[]).length)      items.push({icon:'ti-repeat',description:`${contents.habits.length} habit${contents.habits.length>1?'s':''}`});
  if ((contents.goals||[]).length)       items.push({icon:'ti-target',description:`${contents.goals.length} goal template${contents.goals.length>1?'s':''}`});
  if ((contents.aiPrompts||[]).length)   items.push({icon:'ti-message-bolt',description:`${contents.aiPrompts.length} AI prompts`});
  if ((contents.studyDeck||[]).length)   items.push({icon:'ti-cards',description:`${contents.studyDeck.length} flashcards`});
  if ((contents.journalPrompts||[]).length) items.push({icon:'ti-notebook',description:`${contents.journalPrompts.length} journal prompts`});
  if (!items.length) return '<p style="font-size:.8rem;color:var(--muted)">Template contents not listed.</p>';
  return items.map(i => `<div class="ag-included-item"><i class="ti ${i.icon}"></i><span>${i.description}</span></div>`).join('');
}

// ── Get / install / purchase ──────────────────────────────────
async function agHandleGet(templateId, price) {
  if (!S.sid) { showToast('Sign in to get templates.'); return; }
  if (parseFloat(price) === 0) {
    await agInstallFree(templateId);
  } else if (_ag.currency === 'ngn' && _ag.paystackAvailable) {
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
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({token: S.token}),
    });
    const d = await r.json();
    if (d.ok) {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess('Template installed! Check your Spaces.');
      agOpenTemplate(templateId);
    }
  } catch { showToast('Install failed. Try again.'); }
}

async function agStartCheckout(templateId) {
  showToast('Redirecting to checkout…');
  try {
    const r = await fetch('/api/payments/checkout', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({token: S.token, template_id: templateId}),
    });
    const d = await r.json();
    if (d.status === 'installed') {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess('Template installed!');
      agOpenTemplate(templateId);
    } else if (d.checkout_url) {
      window.location.href = d.checkout_url;
    }
  } catch { showToast('Checkout failed. Try again.'); }
}

async function agStartPaystackCheckout(templateId) {
  if (!window.PaystackPop) {
    showToast('Paystack not ready. Please refresh and try again.');
    return;
  }
  showToast('Preparing payment…');
  try {
    const r = await fetch('/api/payments/paystack/initialize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: S.token, template_id: templateId }),
    });
    const d = await r.json();
    if (d.status === 'installed') {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess('Template installed!');
      agOpenTemplate(templateId);
      return;
    }
    if (!d.access_code) { showToast(d.detail || 'Payment setup failed.'); return; }
    const handler = window.PaystackPop.setup({
      key:         _ag.paystackKey,
      email:       S.email || '',
      access_code: d.access_code,
      ref:         d.reference,
      onSuccess(transaction) { agHandlePaystackSuccess(transaction, templateId); },
      onCancel()             { showToast('Payment cancelled.'); },
    });
    handler.openIframe();
  } catch { showToast('Payment failed. Try again.'); }
}

async function agHandlePaystackSuccess(transaction, templateId) {
  showToast('Verifying payment…');
  try {
    const r = await fetch(`/api/payments/paystack/verify/${transaction.reference}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: S.token }),
    });
    const d = await r.json();
    if (d.ok) {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess('Payment successful! Template installed.');
      agOpenTemplate(templateId);
    } else {
      showToast(d.detail || 'Verification failed. Contact support.');
    }
  } catch { showToast('Verification failed. Try again.'); }
}

function agApplyContents(contents) {
  // Spaces
  (contents.spaces || []).forEach(sp => {
    const spaces = getSpaces();
    const id = `sp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const space = {id, name:sp.name||'New Space', type:sp.type||'personal', icon:sp.type==='personal'?'👤':'🎓'};
    spaces.push(space);
    saveSpaces(spaces);
    syncSpaceMeta(space);
  });
  // Tasks
  (contents.tasks || []).forEach(task => {
    const tasks = JSON.parse(localStorage.getItem('sivarr_tasks')||'[]');
    tasks.push({id:`task_${Date.now()}_${Math.random().toString(36).slice(2)}`, ...task, done:false});
    localStorage.setItem('sivarr_tasks', JSON.stringify(tasks));
  });
  // Goals
  (contents.goals || []).forEach(g => {
    const goals = JSON.parse(localStorage.getItem('sivarr_goals')||'[]');
    goals.push({id:`gl_${Date.now()}_${Math.random().toString(36).slice(2)}`, ...g, done:false});
    localStorage.setItem('sivarr_goals', JSON.stringify(goals));
  });
  // Habits
  (contents.habits || []).forEach(h => {
    const habits = JSON.parse(localStorage.getItem('sivarr_habits')||'[]');
    habits.push({id:`hb_${Date.now()}_${Math.random().toString(36).slice(2)}`, ...h});
    localStorage.setItem('sivarr_habits', JSON.stringify(habits));
  });
  // Sidebar re-render
  if (typeof spaceRenderSidebar === 'function') setTimeout(spaceRenderSidebar, 200);
}

function agShowInstallSuccess(msg) {
  const el = document.createElement('div');
  el.className = 'ag-install-success';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Agent profile ─────────────────────────────────────────────
async function agOpenAgentProfile(agentId) {
  agNav('profile');
  agRenderLoading();
  const v = $('ag-view');
  if (!v) return;
  try {
    const r = await fetch(`/api/agents/${agentId}`);
    const d = await r.json();
    const a = d.agent;
    if (!a || !a.id) { v.innerHTML = '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Agent not found.</p></div>'; return; }
    const templates = a.templates || [];

    // Check follow state
    let isFollowing = false;
    if (S.token) {
      // Optimistic — no dedicated endpoint, infer from UI state
    }

    v.innerHTML = `
      <div class="ag-profile-wrap">
        <div class="ag-profile-hero">
          <div class="ag-profile-av">${(a.display_name||'?')[0].toUpperCase()}</div>
          <div class="ag-profile-info">
            <div class="ag-profile-name">
              ${esc(a.display_name||'')}
              ${a.verified ? '<i class="ti ti-rosette-discount-check ag-verified-badge" title="Verified Agent"></i>' : ''}
            </div>
            <div class="ag-profile-bio">${esc(a.bio||'')}</div>
            <div class="ag-profile-stats">
              <div><strong>${templates.length}</strong> templates</div>
              <div><strong>${a.total_downloads||0}</strong> downloads</div>
              <div><strong>${(a.avg_rating||0).toFixed(1)}</strong> avg rating</div>
              <div><strong>${a.follower_count||0}</strong> followers</div>
            </div>
          </div>
          <button class="ag-follow-btn${isFollowing?' following':''}" id="ag-follow-btn-${agentId}"
            onclick="agToggleFollow('${agentId}')">
            ${isFollowing ? 'Following' : '+ Follow'}
          </button>
        </div>

        <div class="ag-section-hd">
          <div class="ag-section-title">Templates by ${esc(a.display_name||'')}</div>
        </div>
        <div class="ag-grid">
          ${templates.length
            ? templates.map(t => agTemplateCardHTML(t)).join('')
            : '<div class="ag-empty" style="grid-column:1/-1"><div class="ag-empty-icon">📦</div><p>No published templates yet.</p></div>'}
        </div>
      </div>`;
  } catch {
    v.innerHTML = '<div class="ag-empty"><div class="ag-empty-icon">😕</div><p>Failed to load agent.</p></div>';
  }
}

async function agToggleFollow(agentId) {
  const btn = $(`ag-follow-btn-${agentId}`);
  if (!btn || !S.token) return;
  const following = btn.classList.contains('following');
  btn.classList.toggle('following', !following);
  btn.textContent = !following ? 'Following' : '+ Follow';
  try {
    await fetch(`/api/agents/${agentId}/follow`, {
      method: following ? 'DELETE' : 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({token: S.token}),
    });
  } catch {}
}

// ── Agents directory ──────────────────────────────────────────
async function agRenderDirectory() {
  agNav('directory');
  agRenderLoading();
  const v = $('ag-view');
  if (!v) return;
  await agFetchAgents();
  v.innerHTML = `
    <div class="ag-dir-wrap">
      <div class="ag-dir-sort" id="ag-dir-sort">
        ${[
          {id:'downloads',label:'Most downloads'},
          {id:'rating',   label:'Highest rated'},
          {id:'newest',   label:'Newest'},
        ].map(s => `
          <button class="ag-dir-sort-btn${s.id==='downloads'?' active':''}"
            onclick="agReSortAgents('${s.id}',this)">${s.label}</button>
        `).join('')}
      </div>
      <div id="ag-dir-list">
        ${_ag.agents.length
          ? _ag.agents.map(a => agAgentRowHTML(a)).join('')
          : '<div class="ag-empty"><div class="ag-empty-icon">🌐</div><p>No agents yet.<br>Be the first — <span style="color:var(--accent);cursor:pointer" onclick="agNav(\'apply\');agRenderApply()">apply here</span>.</p></div>'}
      </div>
    </div>`;
}

async function agReSortAgents(sort, btn) {
  const btns = document.querySelectorAll('.ag-dir-sort-btn');
  btns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  await agFetchAgents(sort);
  const list = $('ag-dir-list');
  if (list) list.innerHTML = _ag.agents.map(a => agAgentRowHTML(a)).join('');
}

// ── Become an agent (3-step form) ─────────────────────────────
const _agApply = { step:1, data:{} };

function agRenderApply(step) {
  if (!step) step = 1;
  _agApply.step = step;
  agNav('apply');
  const v = $('ag-view');
  if (!v) return;

  const steps = ['Profile', 'Payout', 'Confirm'];
  const stepsHTML = steps.map((s,i) => `
    <div class="ag-apply-step${i+1===step?' active':i+1<step?' done':''}">
      <div class="ag-step-dot">${i+1<step?'✓':i+1}</div>
      <span class="ag-step-label">${s}</span>
    </div>`).join('');

  let bodyHTML = '';
  if (step === 1) {
    bodyHTML = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Set up your agent profile</div>
        <div class="ag-apply-sub">This is how you'll appear in the marketplace.</div>
        <div class="ag-field">
          <label>Display name</label>
          <input id="ag-app-name" placeholder="Your creator name" value="${esc(_agApply.data.display_name||S.name||'')}">
        </div>
        <div class="ag-field">
          <label>Bio <span style="color:var(--muted);font-weight:400">(1–2 lines)</span></label>
          <textarea id="ag-app-bio" rows="2" placeholder="Describe what you create…">${esc(_agApply.data.bio||'')}</textarea>
        </div>
        <div class="ag-field">
          <label>Speciality</label>
          <div class="ag-spec-grid">
            ${['Workspace','Academic','AI prompts','Goals','Journal','Study decks'].map(s => {
              const id = s.toLowerCase().replace(/ /g,'_');
              const sel = (_agApply.data.speciality||[]).includes(s);
              return `<button class="ag-spec-chip${sel?' sel':''}" onclick="agToggleSpec(this,'${s}')">${s}</button>`;
            }).join('')}
          </div>
        </div>
      </div>
      <div class="ag-apply-nav">
        <button class="ag-btn-next" onclick="agApplyNext(1)">Continue →</button>
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
          <input id="ag-app-email" type="email" placeholder="your@email.com" value="${esc(_agApply.data.stripe_email||'')}">
        </div>
        <div class="ag-field">
          <label>Country</label>
          <select id="ag-app-country">
            ${['US','GB','CA','AU','NG','GH','KE','ZA','IN','DE','FR','NL','SG','AE'].map(c =>
              `<option value="${c}"${(_agApply.data.country||'US')===c?' selected':''}>${c}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="ag-apply-nav">
        <button class="ag-btn-back" onclick="agRenderApply(1)">← Back</button>
        <button class="ag-btn-next" onclick="agApplyNext(2)">Continue →</button>
      </div>`;
  } else if (step === 3) {
    const d = _agApply.data;
    bodyHTML = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Review your application</div>
        <div class="ag-apply-sub">Check everything looks right before submitting.</div>
        <div style="font-size:.84rem;line-height:2">
          <strong>Name:</strong> ${esc(d.display_name||'')}<br>
          <strong>Bio:</strong> ${esc(d.bio||'')}<br>
          <strong>Speciality:</strong> ${(d.speciality||[]).join(', ')||'—'}<br>
          <strong>Payout email:</strong> ${esc(d.stripe_email||'—')}<br>
          <strong>Country:</strong> ${esc(d.country||'—')}
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
        <button class="ag-btn-back" onclick="agRenderApply(2)">← Back</button>
        <button class="ag-btn-next" id="ag-submit-btn" onclick="agSubmitApplication()">Submit application →</button>
      </div>`;
  }

  v.innerHTML = `
    <div class="ag-apply-wrap">
      <div class="ag-apply-steps">${stepsHTML}</div>
      ${bodyHTML}
    </div>`;
}

function agToggleSpec(btn, spec) {
  btn.classList.toggle('sel');
  const specs = _agApply.data.speciality || [];
  const idx = specs.indexOf(spec);
  if (idx === -1) specs.push(spec);
  else specs.splice(idx, 1);
  _agApply.data.speciality = specs;
}

function agApplyNext(fromStep) {
  if (fromStep === 1) {
    _agApply.data.display_name = ($('ag-app-name')||{}).value?.trim();
    _agApply.data.bio          = ($('ag-app-bio')||{}).value?.trim();
    if (!_agApply.data.display_name) { showToast('Enter a display name.'); return; }
    agRenderApply(2);
  } else if (fromStep === 2) {
    _agApply.data.stripe_email = ($('ag-app-email')||{}).value?.trim();
    _agApply.data.country      = ($('ag-app-country')||{}).value;
    agRenderApply(3);
  }
}

async function agSubmitApplication() {
  const btn = $('ag-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    const r = await fetch('/api/agents/apply', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({token: S.token, ..._agApply.data}),
    });
    const d = await r.json();
    if (d.ok) {
      _ag.myAgent = {id: d.agent_id, status:'applied', ..._agApply.data};
      agUpdateTopbarBtn();
      $('ag-view').innerHTML = `
        <div class="ag-apply-wrap" style="text-align:center">
          <div style="font-size:3rem;margin-bottom:16px">🎉</div>
          <div style="font-family:var(--font);font-size:1.2rem;font-weight:800;margin-bottom:8px">Application submitted!</div>
          <p style="font-size:.84rem;color:var(--muted);margin-bottom:24px">
            ${d.onboarding_url
              ? 'Check your email for the Stripe onboarding link to complete payout setup.'
              : "Our team will review your application and activate your account shortly."}
          </p>
          ${d.onboarding_url ? `<a href="${d.onboarding_url}" target="_blank" class="ag-btn-next" style="display:inline-block;text-decoration:none;padding:10px 24px">Complete Stripe setup →</a>` : ''}
          <br><br>
          <button class="ag-btn-back" onclick="agNav('marketplace',false);agRenderMarketplace()">Back to marketplace</button>
        </div>`;
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit application →'; }
      showToast(d.detail || 'Submission failed.');
    }
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit application →'; }
    showToast('Submission failed. Try again.');
  }
}

// ── Creator dashboard ─────────────────────────────────────────
const _agDash = { tab:'overview', templates:[], earnings:{}, payouts:[], reviews:[] };

async function agRenderDashboard() {
  if (!_ag.myAgent) { agNav('apply'); agRenderApply(); return; }
  agNav('dashboard');
  const v = $('ag-view');
  if (!v) return;
  v.innerHTML = `
    <div class="ag-dash-wrap">
      <div class="ag-dash-tabs">
        <button class="ag-dash-tab active" id="ag-dt-overview"  onclick="agDashTab('overview',this)">Overview</button>
        <button class="ag-dash-tab"        id="ag-dt-templates" onclick="agDashTab('templates',this)">My Templates</button>
        <button class="ag-dash-tab"        id="ag-dt-earnings"  onclick="agDashTab('earnings',this)">Earnings</button>
        <button class="ag-dash-tab"        id="ag-dt-reviews"   onclick="agDashTab('reviews',this)">Reviews</button>
        <button class="ag-dash-tab"        id="ag-dt-settings"  onclick="agDashTab('settings',this)">Settings</button>
      </div>
      <div id="ag-dash-content">
        <div class="ag-loading"><div class="ag-spinner"></div></div>
      </div>
    </div>`;
  await agDashLoadOverview();
}

async function agDashTab(tab, btn) {
  _agDash.tab = tab;
  document.querySelectorAll('.ag-dash-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'overview')   await agDashLoadOverview();
  if (tab === 'templates')  await agDashLoadTemplates();
  if (tab === 'earnings')   await agDashLoadEarnings();
  if (tab === 'reviews')    await agDashLoadReviews();
  if (tab === 'settings')   agDashRenderSettings();
}

async function agDashLoadOverview() {
  const [earningsR, templatesR] = await Promise.all([
    fetch(`/api/agents/me/earnings?token=${S.token}`).then(r=>r.json()).catch(()=>({})),
    fetch(`/api/agents/me/templates?token=${S.token}`).then(r=>r.json()).catch(()=>({templates:[]})),
  ]);
  const agent = _ag.myAgent || {};
  const earnings = earningsR;
  const templates = templatesR.templates || [];
  const monthly = (earnings.monthly||[])[0] || {};
  const totalEarned = parseFloat(agent.total_earned||0).toFixed(2);
  const monthNet    = parseFloat(monthly.net||0).toFixed(2);
  const allDL       = agent.total_downloads || 0;
  const avgRating   = parseFloat(agent.avg_rating||0).toFixed(1);

  const byTpl = earnings.by_template || [];
  const maxNet = Math.max(...byTpl.map(t=>t.net), 0.01);

  const barRows = byTpl.map(t => `
    <div class="ag-bar-row">
      <span class="ag-bar-label" title="${esc(t.name)}">${esc(t.name)}</span>
      <div class="ag-bar-track"><div class="ag-bar-fill" style="width:${((t.net/maxNet)*100).toFixed(1)}%"></div></div>
      <span class="ag-bar-val">$${t.net.toFixed(2)}</span>
    </div>`).join('') || '<p style="font-size:.8rem;color:var(--muted)">No earnings yet.</p>';

  const feed = templates.slice(0,5).map(t => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:.8rem">
      <i class="ti ${AG_CAT_ICONS[t.category]||'ti-template'}" style="color:${AG_CAT_COLORS[t.category]||'var(--accent)'}"></i>
      <span style="flex:1;font-weight:600">${esc(t.name)}</span>
      <span style="color:var(--muted)">${t.download_count||0} downloads</span>
      <span class="ag-status-badge ${t.status==='published'?'live':t.status}">${t.status}</span>
    </div>`).join('') || '<p style="font-size:.8rem;color:var(--muted)">No templates yet.</p>';

  $('ag-dash-content').innerHTML = `
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

    ${parseFloat(agent.pending_earnings||0) > 0 ? `
    <div class="ag-payout-card">
      <div>
        <div style="font-size:.72rem;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:.06em">Upcoming payout</div>
        <div style="font-size:1.1rem;font-weight:800;font-family:var(--font)">$${parseFloat(agent.pending_earnings).toFixed(2)}</div>
        <div style="font-size:.78rem;color:var(--muted)">Paid on the 1st of next month via Stripe</div>
      </div>
      <div style="font-size:1.4rem">💸</div>
    </div>` : ''}

    <div style="margin-bottom:24px">
      <div class="ag-section-title" style="margin-bottom:12px">Revenue by template</div>
      <div class="ag-bar-chart">${barRows}</div>
    </div>

    <div>
      <div class="ag-section-hd">
        <div class="ag-section-title">Recent templates</div>
        <button class="ag-section-link" onclick="agDashTab('templates',document.getElementById('ag-dt-templates'))">See all</button>
      </div>
      ${feed}
    </div>`;
}

async function agDashLoadTemplates() {
  const r = await fetch(`/api/agents/me/templates?token=${S.token}`).catch(()=>({ok:false}));
  const d = r.ok !== false ? await r.json() : {templates:[]};
  const templates = d.templates || [];

  $('ag-dash-content').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div class="ag-section-title">My templates (${templates.length})</div>
      <button class="ag-tb-btn ag-tb-btn--primary" onclick="agOpenBuilder()">
        <i class="ti ti-plus"></i> New template
      </button>
    </div>
    ${templates.length ? `
    <table class="ag-tpl-table">
      <thead><tr>
        <th></th><th>Name</th><th>Downloads</th><th>Price</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${templates.map(t => `
          <tr>
            <td><i class="ti ${AG_CAT_ICONS[t.category]||'ti-template'}" style="color:${AG_CAT_COLORS[t.category]||'var(--accent)'}"></i></td>
            <td style="font-weight:600">${esc(t.name)}</td>
            <td>${t.download_count||0}</td>
            <td>${parseFloat(t.price||0)===0?'Free':'$'+parseFloat(t.price).toFixed(2)}</td>
            <td><span class="ag-status-badge ${t.status==='published'?'live':t.status}">${t.status}</span></td>
            <td style="display:flex;gap:6px">
              <button class="ag-tb-btn" style="font-size:.7rem;padding:3px 9px" onclick="agOpenBuilder('${t.id}')">Edit</button>
              ${t.status==='draft'?`<button class="ag-tb-btn ag-tb-btn--primary" style="font-size:.7rem;padding:3px 9px" onclick="agPublishTemplate('${t.id}')">Publish</button>`:''}
              <button class="ag-tb-btn" style="font-size:.7rem;padding:3px 9px;color:var(--red)" onclick="agDeleteTemplate('${t.id}')">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>` : `
    <div class="ag-empty">
      <div class="ag-empty-icon">📦</div>
      <p>No templates yet.</p>
      <button class="ag-btn-next" style="margin-top:12px" onclick="agOpenBuilder()">Create your first template</button>
    </div>`}`;
}

async function agPublishTemplate(id) {
  if (!await siModal.confirm('Your template will be visible to all users in the marketplace.', { title:'Publish Template', confirmLabel:'Publish' })) return;
  const r = await fetch(`/api/agents/me/templates/${id}/publish`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({token: S.token}),
  });
  const d = await r.json();
  if (d.ok) { showToast('Template published!'); agDashLoadTemplates(); }
  else showToast(d.detail || 'Publish failed.');
}

async function agDeleteTemplate(id) {
  if (!await siModal.confirm('This template will be permanently removed from the marketplace.', { title:'Delete Template', confirmLabel:'Delete', danger:true })) return;
  const r = await fetch(`/api/agents/me/templates/${id}`, {
    method:'DELETE', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({token: S.token}),
  });
  const d = await r.json();
  if (d.ok) { showToast('Template deleted.'); agDashLoadTemplates(); }
}

async function agDashLoadEarnings() {
  const [earningsR, payoutsR] = await Promise.all([
    fetch(`/api/agents/me/earnings?token=${S.token}`).then(r=>r.json()).catch(()=>({})),
    fetch(`/api/agents/me/payouts?token=${S.token}`).then(r=>r.json()).catch(()=>({payouts:[]})),
  ]);
  const monthly = earningsR.monthly || [];
  const payouts = payoutsR.payouts || [];
  const agent   = _ag.myAgent || {};
  const totalGross = monthly.reduce((s,m)=>s+m.gross,0).toFixed(2);
  const totalFee   = monthly.reduce((s,m)=>s+m.fee,0).toFixed(2);
  const totalNet   = monthly.reduce((s,m)=>s+m.net,0).toFixed(2);

  const monthRows = monthly.map(m => `
    <tr>
      <td>${m.month||''}</td>
      <td>${m.downloads||0}</td>
      <td>$${m.gross.toFixed(2)}</td>
      <td style="color:var(--muted)">$${m.fee.toFixed(2)}</td>
      <td style="color:var(--green,#22c55e);font-weight:700">$${m.net.toFixed(2)}</td>
      <td><span class="ag-status-badge live">Paid</span></td>
    </tr>`).join('') || `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px">No earnings yet.</td></tr>`;

  $('ag-dash-content').innerHTML = `
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

    ${payouts.length ? `
    <div class="ag-section-title" style="margin-bottom:12px">Payout history</div>
    <table class="ag-earnings-table">
      <thead><tr><th>Date</th><th>Amount</th><th>Transfer ID</th><th>Status</th></tr></thead>
      <tbody>
        ${payouts.map(p => `
          <tr>
            <td>${p.paid_at ? str(p.paid_at).slice(0,10) : p.created_at?.slice(0,10)||'—'}</td>
            <td style="font-weight:700">$${parseFloat(p.amount).toFixed(2)}</td>
            <td style="font-size:.72rem;color:var(--muted)">${p.stripe_transfer_id||'—'}</td>
            <td><span class="ag-status-badge ${p.status==='paid'?'live':'review'}">${p.status}</span></td>
          </tr>`).join('')}
      </tbody>
    </table>` : ''}`;
}

async function agDashLoadReviews() {
  const r = await fetch(`/api/agents/me/reviews?token=${S.token}`).catch(()=>({ok:false}));
  const d = r.ok !== false ? await r.json() : {reviews:[]};
  const reviews = d.reviews || [];

  $('ag-dash-content').innerHTML = reviews.length ? `
    ${reviews.map(rv => `
      <div class="ag-review-item">
        <div class="ag-review-header">
          <div class="ag-review-av">${(rv.reviewer_name||'?')[0].toUpperCase()}</div>
          <span class="ag-review-name">${esc(rv.reviewer_name||'')}</span>
          <span class="ag-review-stars">${'★'.repeat(rv.rating||5)}</span>
          <span style="margin-left:auto;font-size:.72rem;color:var(--muted)">${esc(rv.template_name||'')}</span>
        </div>
        <div class="ag-review-text">${esc(rv.review_text||'')}</div>
      </div>`).join('')}` :
    '<div class="ag-empty"><div class="ag-empty-icon">💬</div><p>No reviews yet.</p></div>';
}

function agDashRenderSettings() {
  const a = _ag.myAgent || {};
  $('ag-dash-content').innerHTML = `
    <div style="max-width:480px">
      <div class="ag-apply-card">
        <div class="ag-apply-title">Agent settings</div>
        <div class="ag-field"><label>Display name</label>
          <input id="ag-set-name" value="${esc(a.display_name||'')}"></div>
        <div class="ag-field"><label>Bio</label>
          <textarea id="ag-set-bio" rows="2">${esc(a.bio||'')}</textarea></div>
        <button class="ag-btn-next" onclick="agSaveSettings()">Save changes</button>
      </div>
      <div class="ag-apply-card" style="border-color:#ef444430;background:#ef444408">
        <div style="font-size:.84rem;font-weight:700;color:var(--red);margin-bottom:8px">Danger zone</div>
        <p style="font-size:.78rem;color:var(--muted);margin-bottom:12px">Deleting your agent account will remove all templates and forfeit any unpaid earnings.</p>
        <button onclick="agDeleteAccount()" style="background:none;border:1px solid #ef4444;border-radius:8px;padding:7px 16px;color:var(--red);font-size:.78rem;font-weight:700;cursor:pointer">Delete agent account</button>
      </div>
    </div>`;
}

async function agSaveSettings() {
  const name = ($('ag-set-name')||{}).value?.trim();
  const bio  = ($('ag-set-bio')||{}).value?.trim();
  const r = await fetch('/api/agents/me', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({token: S.token, display_name:name, bio}),
  });
  const d = await r.json();
  if (d.ok) { _ag.myAgent = {...(_ag.myAgent||{}), display_name:name, bio}; showToast('Settings saved.'); }
  else showToast(d.detail||'Save failed.');
}

async function agDeleteAccount() {
  if (!await siModal.confirm('Your agent profile and all templates will be permanently removed.', { title:'Delete Agent Account', confirmLabel:'Delete Account', danger:true })) return;
  showToast('Contact support to delete your agent account.');
}

// ── Template builder (4-step) ─────────────────────────────────
const _agBuilder = {
  step:1, id:null,
  data:{ name:'', short_description:'', full_description:'', category:'workspace',
         tags:[], thumbnail_color:'#4f6ef7', price:0, price_ngn:null, contents:{}, included_items:[], free:true }
};
const AG_COLORS = ['#4f6ef7','#7c3aed','#22c55e','#d97706','#ef4444','#7f77dd','#d85a30'];
const AG_CONTENTS = [
  {id:'spaces',       icon:'🏠', name:'Spaces',         desc:'Personal or academic spaces'},
  {id:'tasks',        icon:'✅', name:'Task board',      desc:'Pre-built task list'},
  {id:'goals',        icon:'🎯', name:'Goals',           desc:'Pre-configured goal templates'},
  {id:'habits',       icon:'🔁', name:'Habit stack',     desc:'Daily and weekly habits'},
  {id:'studyDeck',    icon:'🃏', name:'Study deck',      desc:'Flashcard set'},
  {id:'aiPrompts',    icon:'🤖', name:'AI prompt pack',  desc:'Up to 100 AI prompts'},
  {id:'journalPrompts',icon:'📓',name:'Journal prompts', desc:'Reflection prompt set'},
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
          name: t.name, short_description: t.short_description,
          full_description: t.full_description, category: t.category,
          tags: t.tags||[], thumbnail_color: t.thumbnail_color||'#4f6ef7',
          price: t.price, price_ngn: t.price_ngn||null, contents: t.contents||{},
          included_items: t.included_items||[],
          free: parseFloat(t.price||0)===0,
        };
      }
    } catch {}
  }
  agNav('builder');
  agRenderBuilder();
}

function agRenderBuilder() {
  const step = _agBuilder.step;
  const d = _agBuilder.data;
  const v = $('ag-view');
  if (!v) return;
  const stepsBar = [1,2,3,4].map(i =>
    `<div class="ag-builder-step${i<step?' done':i===step?' active':''}"></div>`).join('');

  let body = '';
  if (step === 1) {
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 1 — Basics</div>
        <div class="ag-field"><label>Template name <span style="color:var(--muted)">(max 60 chars)</span></label>
          <input id="ab-name" maxlength="60" placeholder="My awesome template" value="${esc(d.name)}"></div>
        <div class="ag-field"><label>Short description <span style="color:var(--muted)">(max 120)</span></label>
          <input id="ab-short" maxlength="120" placeholder="One-liner…" value="${esc(d.short_description)}"></div>
        <div class="ag-field"><label>Full description</label>
          <textarea id="ab-full" rows="4" maxlength="800" placeholder="Detailed description…">${esc(d.full_description)}</textarea></div>
        <div class="ag-field"><label>Category</label>
          <select id="ab-cat">
            ${Object.entries(AG_CAT_LABELS).filter(([k])=>k!=='all').map(([k,v]) =>
              `<option value="${k}"${d.category===k?' selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div class="ag-field"><label>Tags <span style="color:var(--muted)">(comma-separated, up to 5)</span></label>
          <input id="ab-tags" placeholder="productivity, students…" value="${(d.tags||[]).join(', ')}"></div>
        <div class="ag-field"><label>Thumbnail colour</label>
          <div class="ag-color-picker">
            ${AG_COLORS.map(c => `
              <div class="ag-color-swatch${d.thumbnail_color===c?' sel':''}"
                style="background:${c}" onclick="agBuilderSetColor('${c}',this)"></div>`).join('')}
          </div>
        </div>
      </div>`;
  } else if (step === 2) {
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 2 — Contents</div>
        <div class="ag-apply-sub">Select what gets installed when a user gets this template.</div>
        <div class="ag-contents-check">
          ${AG_CONTENTS.map(c => {
            const hasSel = d.contents && (d.contents[c.id]||[]).length > 0;
            return `
              <div class="ag-content-row${hasSel?' sel':''}" onclick="agBuilderToggleContent('${c.id}',this)">
                <input type="checkbox"${hasSel?' checked':''} onclick="event.stopPropagation();agBuilderToggleContent('${c.id}',this.closest('.ag-content-row'))">
                <span class="ag-content-icon">${c.icon}</span>
                <div class="ag-content-info">
                  <div class="ag-content-name">${c.name}</div>
                  <div class="ag-content-desc">${c.desc}</div>
                </div>
              </div>`;}).join('')}
        </div>
      </div>`;
  } else if (step === 3) {
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 3 — Pricing</div>
        <div class="ag-pricing-toggle">
          <button class="ag-pricing-opt${d.free?' active':''}" onclick="agBuilderSetPricing(true)">🆓 Free</button>
          <button class="ag-pricing-opt${!d.free?' active':''}" onclick="agBuilderSetPricing(false)">💰 Paid</button>
        </div>
        <div id="ab-price-wrap" style="${d.free?'display:none':''}">
          <div class="ag-field"><label>Price (USD)</label>
            <input id="ab-price" type="number" min="1" max="999" step="0.01" placeholder="4.99"
              value="${d.price>0?d.price:''}" oninput="agBuilderUpdateEarnings()">
          </div>
          ${_ag.paystackAvailable ? `
          <div class="ag-field" style="margin-top:8px">
            <label>Price (NGN) <span style="font-size:.7rem;font-weight:400;color:var(--muted)">— leave blank to auto-calculate (≈ USD × ${_ag.nairaRate})</span></label>
            <input id="ab-price-ngn" type="number" min="100" step="50" placeholder="Auto"
              value="${d.price_ngn||''}" oninput="agBuilderUpdateNgn()">
          </div>` : ''}
          <div class="ag-earn-card" id="ab-earn-preview">
            ${agBuilderEarningsHTML(d.price||0)}
          </div>
        </div>
      </div>`;
  } else if (step === 4) {
    const color = d.thumbnail_color || '#4f6ef7';
    const icon  = AG_CAT_ICONS[d.category] || 'ti-template';
    body = `
      <div class="ag-apply-card">
        <div class="ag-apply-title">Step 4 — Preview & publish</div>
        <div class="ag-apply-sub">This is how your template will appear in the marketplace.</div>
        <div style="max-width:240px;margin-bottom:20px">
          <div class="ag-card">
            <div class="ag-card-thumb" style="background:${color}20">
              <i class="ti ${icon}" style="color:${color};font-size:1.8rem"></i>
            </div>
            <div class="ag-card-body">
              <span class="ag-card-tag">${AG_CAT_LABELS[d.category]||d.category}</span>
              <div class="ag-card-name">${esc(d.name||'Template name')}</div>
              <div class="ag-card-footer">
                <span class="ag-price${d.free?' free':''}">${d.free?'Free':'$'+parseFloat(d.price||0).toFixed(2)}</span>
                <button class="ag-get-btn">Get</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="ag-btn-back" style="flex:1" onclick="agSaveTemplate('draft')">Save as draft</button>
        <button class="ag-btn-next" style="flex:1" onclick="agSaveTemplate('published')">Publish template 🚀</button>
      </div>`;
  }

  v.innerHTML = `
    <div class="ag-builder-wrap">
      <div class="ag-builder-steps">${stepsBar}</div>
      ${body}
      ${step < 4 ? `
      <div class="ag-apply-nav">
        ${step > 1 ? `<button class="ag-btn-back" onclick="agBuilderStep(${step-1})">← Back</button>` : '<span></span>'}
        <button class="ag-btn-next" onclick="agBuilderStep(${step+1})">Continue →</button>
      </div>` : ''}
    </div>`;
}

function agBuilderStep(step) {
  const d = _agBuilder.data;
  if (_agBuilder.step === 1) {
    d.name = ($('ab-name')||{}).value?.trim()||'';
    d.short_description = ($('ab-short')||{}).value?.trim()||'';
    d.full_description  = ($('ab-full')||{}).value?.trim()||'';
    d.category = ($('ab-cat')||{}).value||'workspace';
    d.tags = (($('ab-tags')||{}).value||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,5);
    if (!d.name) { showToast('Enter a template name.'); return; }
  }
  _agBuilder.step = step;
  agRenderBuilder();
}

function agBuilderSetColor(color, el) {
  _agBuilder.data.thumbnail_color = color;
  document.querySelectorAll('.ag-color-swatch').forEach(s => s.classList.remove('sel'));
  el.classList.add('sel');
}

function agBuilderToggleContent(id, row) {
  row.classList.toggle('sel');
  const cb = row.querySelector('input[type=checkbox]');
  if (cb) cb.checked = row.classList.contains('sel');
  const d = _agBuilder.data;
  if (!d.contents) d.contents = {};
  if (row.classList.contains('sel')) {
    if (!d.contents[id] || d.contents[id].length === 0) d.contents[id] = [{}];
  } else {
    delete d.contents[id];
  }
}

function agBuilderSetPricing(isFree) {
  _agBuilder.data.free = isFree;
  const wrap = $('ab-price-wrap');
  if (wrap) wrap.style.display = isFree ? 'none' : '';
  document.querySelectorAll('.ag-pricing-opt').forEach((b,i) => b.classList.toggle('active', i===0?isFree:!isFree));
}

function agBuilderUpdateEarnings() {
  const price = parseFloat(($('ab-price')||{}).value||0);
  _agBuilder.data.price = price;
  const prev = $('ab-earn-preview');
  if (prev) prev.innerHTML = agBuilderEarningsHTML(price);
}

function agBuilderUpdateNgn() {
  const v = ($('ab-price-ngn')||{}).value;
  _agBuilder.data.price_ngn = v ? parseFloat(v) : null;
}

function agBuilderEarningsHTML(price) {
  const net = (price * 0.9).toFixed(2);
  const fee = (price * 0.1).toFixed(2);
  return `
    <div style="font-size:.78rem;line-height:1.9">
      At <strong>$${parseFloat(price||0).toFixed(2)}</strong> per download:<br>
      You earn: <strong style="color:var(--green,#22c55e)">$${net}</strong> per sale<br>
      Sivarr fee: <strong>$${fee}</strong> per sale
    </div>`;
}

async function agSaveTemplate(status) {
  const d = _agBuilder.data;
  if ($('ab-price'))     d.price     = parseFloat(($('ab-price')||{}).value||0);
  if ($('ab-price-ngn')) d.price_ngn = ($('ab-price-ngn').value) ? parseFloat($('ab-price-ngn').value) : null;
  const body = {
    token: S.token,
    name: d.name, short_description: d.short_description,
    full_description: d.full_description, category: d.category,
    tags: d.tags, thumbnail_color: d.thumbnail_color,
    price: d.free ? 0 : d.price,
    price_ngn: d.free ? null : d.price_ngn,
    contents: d.contents, included_items: d.included_items,
  };
  try {
    let r;
    if (_agBuilder.id) {
      body.status = status;
      r = await fetch(`/api/agents/me/templates/${_agBuilder.id}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
    } else {
      r = await fetch('/api/agents/me/templates', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body),
      });
    }
    const result = await r.json();
    if (result.ok || result.template_id) {
      const tid = result.template_id || _agBuilder.id;
      if (status === 'published' && tid) {
        await fetch(`/api/agents/me/templates/${tid}/publish`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({token: S.token}),
        });
      }
      showToast(status === 'published' ? 'Template published!' : 'Draft saved.');
      agNav('dashboard');
      agRenderDashboard();
    } else {
      showToast(result.detail || 'Save failed.');
    }
  } catch { showToast('Save failed. Try again.'); }
}

// ── Review form ───────────────────────────────────────────────
async function agLeaveReview(templateId) {
  const d = await siModal.form('Leave a Review', [
    { id:'rating', label:'Rating', type:'select',
      options:[{value:'5',label:'⭐⭐⭐⭐⭐ — Excellent'},{value:'4',label:'⭐⭐⭐⭐ — Good'},{value:'3',label:'⭐⭐⭐ — Average'},{value:'2',label:'⭐⭐ — Poor'},{value:'1',label:'⭐ — Terrible'}],
      default:'5' },
    { id:'text', label:'Review (optional)', type:'textarea', placeholder:'What did you think?' },
  ], { confirmLabel:'Submit Review' });
  if (!d) return;
  const rating = parseInt(d.rating || '5');
  fetch(`/api/agents/templates/${templateId}/review`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({token: S.token, rating, review_text: d.text||''}),
  }).then(r=>r.json()).then(r => {
    if (r.ok) { showToast('Review submitted!'); agOpenTemplate(templateId); }
    else showToast(r.detail||'Review failed.');
  });
}

// ── Check payment success on page load ────────────────────────
function agCheckPaymentReturn() {
  const params     = new URLSearchParams(window.location.search);
  const payment    = params.get('payment');
  const templateId = params.get('template');
  const gateway    = params.get('gateway');
  const ref        = params.get('ref');

  if (gateway === 'paystack' && ref) {
    history.replaceState({}, '', window.location.pathname);
    nav('agents');
    agHandlePaystackReturn(ref, templateId);
    return;
  }
  if (payment === 'success' && templateId) {
    showToast('Payment successful! Template installed.');
    history.replaceState({}, '', window.location.pathname);
    nav('agents');
    agOpenTemplate(templateId);
  } else if (payment === 'cancelled') {
    showToast('Payment cancelled.');
    history.replaceState({}, '', window.location.pathname);
  }
}

async function agHandlePaystackReturn(reference, templateId) {
  showToast('Verifying payment…');
  try {
    const r = await fetch(`/api/payments/paystack/verify/${reference}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: S.token }),
    });
    const d = await r.json();
    if (d.ok) {
      if (d.contents) agApplyContents(d.contents);
      agShowInstallSuccess('Payment successful! Template installed.');
      if (templateId) agOpenTemplate(templateId);
    } else {
      showToast(d.detail || 'Verification failed. Contact support.');
    }
  } catch { showToast('Verification failed.'); }
}

// ═══════════════════════════════════════════════════════════════
// ONBOARDING FLOW
// Shown once to new users on first login. Stores completion in
// localStorage keyed to the user's SID so it never repeats.
// Steps: 1 Welcome → 2 Role → 3 Feature tour → 4 Ready
// ═══════════════════════════════════════════════════════════════

let _siObStep = 1;
let _siObRole = '';

function siObMaybeStart() {
  if (!S.sid) return;
  const done = localStorage.getItem(`si_onboarded_${S.sid}`);
  if (done) return;
  _siObStep = 1;
  _siObRole = '';
  const el = $('si-onboard');
  if (el) el.style.display = 'flex';
  siObRender();
}

function siObFinish() {
  if (S.sid) localStorage.setItem(`si_onboarded_${S.sid}`, '1');
  const el = $('si-onboard');
  if (el) el.style.display = 'none';
}

function siObRender() {
  const box = $('si-onboard-box');
  if (!box) return;
  const dots = [1,2,3,4].map(i =>
    `<div class="si-ob-dot${_siObStep===i?' active':''}"></div>`).join('');

  let content = '';
  if (_siObStep === 1) {
    content = `
      <div class="si-ob-emoji">👋</div>
      <div class="si-ob-title">Welcome to Sivarr,<br>${esc(S.name.split(' ')[0])}!</div>
      <div class="si-ob-sub">Your all-in-one productivity platform for students and professionals. Let's get you set up in under a minute.</div>
      <div class="si-ob-actions">
        <button class="si-ob-btn-pri" onclick="siObNext()">Get started →</button>
      </div>`;
  } else if (_siObStep === 2) {
    content = `
      <div class="si-ob-title">How will you use Sivarr?</div>
      <div class="si-ob-sub">Choose your primary focus — you can use all features regardless.</div>
      <div class="si-ob-role-grid">
        <div class="si-ob-role-card${_siObRole==='student'?' sel':''}" onclick="siObSelectRole('student',this)">
          <div class="si-ob-role-icon">🎓</div>
          <div class="si-ob-role-label">Student</div>
          <div class="si-ob-role-desc">Courses, exams, study tools & flashcards</div>
        </div>
        <div class="si-ob-role-card${_siObRole==='professional'?' sel':''}" onclick="siObSelectRole('professional',this)">
          <div class="si-ob-role-icon">💼</div>
          <div class="si-ob-role-label">Professional</div>
          <div class="si-ob-role-desc">Projects, tasks, team spaces & goals</div>
        </div>
        <div class="si-ob-role-card${_siObRole==='personal'?' sel':''}" onclick="siObSelectRole('personal',this)">
          <div class="si-ob-role-icon">🌱</div>
          <div class="si-ob-role-label">Personal</div>
          <div class="si-ob-role-desc">Habits, journaling, goals & self-growth</div>
        </div>
      </div>
      <div class="si-ob-actions">
        <button class="si-ob-btn-sec" onclick="siObPrev()">← Back</button>
        <button class="si-ob-btn-pri" onclick="siObNext()">Continue →</button>
      </div>`;
  } else if (_siObStep === 3) {
    content = `
      <div class="si-ob-title">Here's what's waiting for you</div>
      <div class="si-ob-sub">Everything you need, in one place.</div>
      <div class="si-ob-features">
        <div class="si-ob-feat"><div class="si-ob-feat-icon">🤖</div><div class="si-ob-feat-label">AI Tutor</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">✅</div><div class="si-ob-feat-label">Tasks</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">🎯</div><div class="si-ob-feat-label">Goals</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">🔁</div><div class="si-ob-feat-label">Habits</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">📚</div><div class="si-ob-feat-label">Study Tools</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">🏠</div><div class="si-ob-feat-label">Spaces</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">📅</div><div class="si-ob-feat-label">Calendar</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">🛒</div><div class="si-ob-feat-label">Agents Market</div></div>
        <div class="si-ob-feat"><div class="si-ob-feat-icon">📊</div><div class="si-ob-feat-label">Analytics</div></div>
      </div>
      <div class="si-ob-actions">
        <button class="si-ob-btn-sec" onclick="siObPrev()">← Back</button>
        <button class="si-ob-btn-pri" onclick="siObNext()">Almost there →</button>
      </div>`;
  } else if (_siObStep === 4) {
    const firstStep = _siObRole === 'student'
      ? 'Head to the <strong>Chat</strong> panel and ask your AI tutor anything.'
      : _siObRole === 'professional'
        ? 'Open <strong>Spaces</strong> and create your first workspace.'
        : 'Check out <strong>Habits</strong> and add your first daily habit.';
    content = `
      <div class="si-ob-emoji">🎉</div>
      <div class="si-ob-title">You're all set!</div>
      <div class="si-ob-sub">
        Your Sivarr workspace is ready. A suggested first step:<br>
        <span style="color:var(--text1)">${firstStep}</span>
      </div>
      <div class="si-ob-actions">
        <button class="si-ob-btn-pri" onclick="siObFinish()">Let's go →</button>
      </div>`;
  }

  box.innerHTML = `
    <div class="si-ob-logo">SIVARR</div>
    <div class="si-ob-dots">${dots}</div>
    ${content}`;
}

function siObSelectRole(role, el) {
  _siObRole = role;
  document.querySelectorAll('.si-ob-role-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
}

function siObNext() {
  if (_siObStep < 4) { _siObStep++; siObRender(); }
  else siObFinish();
}

function siObPrev() {
  if (_siObStep > 1) { _siObStep--; siObRender(); }
}
