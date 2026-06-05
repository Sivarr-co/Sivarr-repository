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
    if (r.status === 429) {
      const retryAfter = r.headers.get('Retry-After');
      err.retryAfter = retryAfter ? parseInt(retryAfter) : 60;
    }
    throw err;
  }
  return r.json();
};

function track(event, props = {}) {
  if (window.plausible) window.plausible(event, { props });
}

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

  return { input, confirm, alert, form, _done, _bgClose, _subInput, _subForm, _pickEmoji, _show_raw: _show };
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
  const s = $('login-sub');     if (s) s.textContent = isReg ? 'Join the Sivarr workspace.' : 'Sign in to your workspace.';
  const b = $('login-btn');     if (b) b.textContent = isReg ? 'Create account' : 'Sign in';
  const e = $('login-err');     if (e) e.textContent = '';
  const g = $('google-btn-text'); if (g) g.textContent = isReg ? 'Sign up with Google' : 'Continue with Google';

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
    track(isReg ? 'Register' : 'Login');
    _applyLoginData(r);

    try {
      const ann = await fetch('/api/lecturer/announcements');
      const ad  = await ann.json();
      if (ad.announcements?.length) {
        const latest = ad.announcements[0];
        addMsg('sivarr', `📢 New announcement:\n\n"${latest.message}"\n\n— ${latest.author}, ${latest.date}`);
      }
    } catch(_) {}

  } catch(e) {
    const status = e.status || 0;
    const detail = e.message || '';
    if (status === 403 && detail === 'email_not_verified') {
      if (err) err.textContent = `Your email isn't verified yet. A new link has been sent to ${email} — check your inbox and click the link, then try signing in again.`;
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
      clearSession();
      return;
    }
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
              New announcement
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
      addMsg('sivarr', '📢 Announcements:\n\n' +
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
  document.body.classList.add('dashboard-active');
  if (localStorage.getItem('sb_retracted') === '1') $('sidebar')?.classList.add('retracted');
  const _postCreate = sessionStorage.getItem('sivarr_post_create');
  if (_postCreate) {
    sessionStorage.removeItem('sivarr_post_create');
    nav(_postCreate, null);
  } else {
    nav('home', null);
  }

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
  _contextSent  = false; // fresh context for each login session
  _chatMsgCount = 0;
  setTimeout(_buildNotifs, 1200);
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
  // Accept any pending org invite from URL
  setTimeout(_acceptPendingOrgInvite, 800);
  // Load integration statuses
  setTimeout(gcalCheckStatus,           1000);
  setTimeout(githubCheckStatus,         1100);
  setTimeout(billingLoadStatus,         1200);
  setTimeout(monoCheckStatus,           1400);
  setTimeout(_sendTaskReminderIfNeeded, 3000);
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

// ─────────────────────────────────────────────────────────────
//  PAYWALL / PLAN ACCESS SYSTEM
// ─────────────────────────────────────────────────────────────

const _PLAN_LEVELS = { free: 0, 'Free': 0, pro: 1, 'Pro': 1, team: 2, 'Team': 2 };

function _planLevel(name) {
  return _PLAN_LEVELS[(name || 'free')] ?? 0;
}

function _hasPlan(required) {
  // Dev bypass: localStorage.setItem('sivarr_dev','1') in console to unlock everything
  if (localStorage.getItem('sivarr_dev') === '1') return true;
  const current = _planLevel(_BILLING_STATUS?.name || 'free');
  return current >= _planLevel(required);
}

const _PAYWALL_CFG = {
  org:      { plan: 'Pro', icon: 'ti-building', title: 'Organization Space', desc: 'Collaborate with your team, manage projects, and chat in real-time.', perks: ['Real-time org chat', 'Project kanban', 'Team goals & docs', 'Member management'] },
  orgchat:  { plan: 'Pro', icon: 'ti-messages', title: 'Org Chat', desc: 'Real-time team messaging with channels and direct messages.', perks: ['Slack-style channels', 'Direct messages', 'Presence indicators', 'Emoji reactions'] },
  team:     { plan: 'Pro', icon: 'ti-users', title: 'Team Space', desc: 'Manage your team, roles, and workload in one place.', perks: ['Team members', 'Role management', 'Workload view', 'Activity feed'] },
  projects: { plan: 'Pro', icon: 'ti-layout-kanban', title: 'Projects', desc: 'Build and track projects with kanban boards and milestones.', perks: ['Kanban boards', 'Milestones', 'GitHub linking', 'Progress tracking'] },
  founder:  { plan: 'Team', icon: 'ti-rocket', title: 'Founder Mode', desc: 'Strategic tools for building your company — metrics, pipeline, and vision.', perks: ['Company metrics', 'Fundraising pipeline', 'Team builder', 'Vision board'] },
};

function _showPaywall(panelName) {
  const cfg = _PAYWALL_CFG[panelName];
  if (!cfg) return;
  const panel = document.getElementById(`panel-${panelName}`);
  if (!panel) return;
  panel.querySelector('.paywall-overlay')?.remove();
  const el = document.createElement('div');
  el.className = 'paywall-overlay';
  el.innerHTML = `
    <div class="paywall-card">
      <div class="paywall-icon"><i class="ti ${cfg.icon}"></i></div>
      <h3>${esc(cfg.title)}</h3>
      <p>${esc(cfg.desc)}</p>
      <ul class="paywall-perks">${cfg.perks.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      <button class="paywall-btn" onclick="showPricing()">Upgrade to ${esc(cfg.plan)} →</button>
    </div>`;
  panel.style.position = 'relative';
  panel.appendChild(el);
}

function _removePaywall(panelName) {
  document.getElementById(`panel-${panelName}`)?.querySelector('.paywall-overlay')?.remove();
}

// Wire upgrade button in sidebar after billing loads
function _billingRenderSidebar() {
  const planName  = _BILLING_STATUS?.name || 'Free';
  const isPaid    = _planLevel(planName) > 0;
  const btn       = $('sb-upgrade-btn');
  const planLabel = $('sb-plan-label');
  const upLabel   = $('sb-upgrade-label');
  if (planLabel) planLabel.textContent = isPaid ? `${planName} Plan` : 'Free Plan';
  if (upLabel)   upLabel.textContent   = isPaid ? 'Manage subscription' : 'Upgrade Sivarr';
  if (btn) btn.style.borderColor = isPaid ? 'var(--teal)' : 'var(--border)';
}

// ─────────────────────────────────────────────────────────────
//  GITHUB INTEGRATION
// ─────────────────────────────────────────────────────────────

let _GITHUB_CONNECTED = false;
let _GITHUB_USERNAME  = '';

async function githubCheckStatus() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/integrations/github/status?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _GITHUB_CONNECTED = d.connected;
    _GITHUB_USERNAME  = d.username || '';
    integrationsRender();
  } catch(_) {}
}

function githubConnect() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) { toast('Sign in first.'); return; }
  window.location.href = `/auth/github?token=${encodeURIComponent(token)}`;
}

async function githubLoadRepos() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !_GITHUB_CONNECTED) return [];
  try {
    const r = await fetch(`/api/integrations/github/repos?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    return d.repos || [];
  } catch(_) { return []; }
}

async function githubLoadActivity(repoFullName) {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !_GITHUB_CONNECTED) return null;
  try {
    const r = await fetch(`/api/integrations/github/activity?token=${encodeURIComponent(token)}&repo=${encodeURIComponent(repoFullName)}`);
    return await r.json();
  } catch(_) { return null; }
}

// ─────────────────────────────────────────────────────────────
//  INTEGRATIONS PAGE (Library panel)
// ─────────────────────────────────────────────────────────────

function integrationsRender() {
  const grid = $('integrations-grid');
  if (!grid) return;
  const token = localStorage.getItem('sivarr_token') || '';
  const integrations = [
    {
      id: 'google',
      name: 'Google OAuth',
      logo: `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.8 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.3 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.1z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6L2.6 13.3A24 24 0 0 0 0 24c0 3.8.9 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.6-5.9c-2 1.4-4.7 2.2-7.6 2.2-6.3 0-11.6-3.8-13.5-9.2l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`,
      bg: '#fff',
      connected: true,
      statusText: 'Sign-in active',
      action: null,
      actionLabel: 'Connected',
    },
    {
      id: 'gcal',
      name: 'Google Calendar',
      logo: `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.8 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.3 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.1z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6L2.6 13.3A24 24 0 0 0 0 24c0 3.8.9 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.6-5.9c-2 1.4-4.7 2.2-7.6 2.2-6.3 0-11.6-3.8-13.5-9.2l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`,
      bg: '#fff',
      connected: _GCAL_CONNECTED,
      statusText: _GCAL_CONNECTED ? 'Syncing events' : 'Not connected',
      action: () => gcalConnect(),
      actionLabel: _GCAL_CONNECTED ? 'Connected' : 'Connect',
    },
    {
      id: 'github',
      name: 'GitHub',
      logo: `<svg width="20" height="20" viewBox="0 0 98 96" fill="currentColor"><path d="M48.9 0C21.8 0 0 22 0 49.2c0 21.8 14 40.3 33.5 46.8 2.5.5 3.4-1 3.4-2.3v-8c-13.7 3-16.6-6.7-16.6-6.7-2.2-5.7-5.5-7.2-5.5-7.2-4.5-3 .3-3 .3-3 5 .4 7.6 5.1 7.6 5.1 4.4 7.6 11.6 5.4 14.4 4.1.4-3.2 1.7-5.4 3.1-6.6-11-1.2-22.5-5.5-22.5-24.5 0-5.4 1.9-9.8 5.1-13.3-.5-1.3-2.2-6.3.5-13.1 0 0 4.1-1.3 13.4 5 3.9-1.1 8-1.6 12.2-1.6 4.1 0 8.3.5 12.2 1.6 9.3-6.3 13.4-5 13.4-5 2.7 6.8 1 11.8.5 13.1 3.1 3.5 5 7.9 5 13.3 0 19-11.6 23.3-22.6 24.5 1.8 1.5 3.4 4.5 3.4 9.2v13.6c0 1.3.8 2.8 3.4 2.3C84 89.4 98 70.9 98 49.2 97.9 22 76 0 48.9 0z"/></svg>`,
      bg: '#24292e',
      connected: _GITHUB_CONNECTED,
      statusText: _GITHUB_CONNECTED ? `@${_GITHUB_USERNAME}` : 'Not connected',
      action: () => githubConnect(),
      actionLabel: _GITHUB_CONNECTED ? 'Connected' : 'Connect',
    },
    {
      id: 'paystack',
      name: 'Paystack',
      logo: '💳',
      bg: '#00C3F7',
      connected: (_BILLING_STATUS?.plan || 'free') !== 'free',
      statusText: _BILLING_STATUS?.plan === 'free' || !_BILLING_STATUS ? 'Free plan' : `${_BILLING_STATUS.name} — expires ${_BILLING_STATUS.expires || ''}`,
      action: () => showPricing(),
      actionLabel: (_BILLING_STATUS?.plan || 'free') !== 'free' ? 'Manage' : 'Upgrade',
    },
    {
      id: 'flutterwave',
      name: 'Flutterwave',
      logo: '🦋',
      bg: '#F5A623',
      connected: (_BILLING_STATUS?.gateway === 'flutterwave'),
      statusText: _BILLING_STATUS?.gateway === 'flutterwave' ? `${_BILLING_STATUS.name} via Flutterwave` : 'Pay with card/bank/USSD',
      action: () => showPricing(),
      actionLabel: 'Upgrade',
    },
    {
      id: 'mono',
      name: 'Mono',
      logo: '🏦',
      bg: '#000',
      connected: _MONO_CONNECTED,
      statusText: _MONO_CONNECTED ? 'Bank account linked' : 'African open banking',
      action: () => monoConnect(),
      actionLabel: _MONO_CONNECTED ? 'Connected' : 'Connect',
    },
  ];

  grid.innerHTML = integrations.map(i => `
    <div class="int-card ${i.connected ? 'connected' : ''}">
      <div class="int-header">
        <div class="int-logo" style="background:${i.bg};color:${i.bg==='#fff'?'#000':'#fff'}">${i.logo}</div>
        <div>
          <div class="int-name">${esc(i.name)}</div>
          <div class="int-status ${i.connected ? 'ok' : ''}">${esc(i.statusText)}</div>
        </div>
      </div>
      ${i.action
        ? `<button class="int-btn ${i.connected ? 'connected-btn' : ''}" onclick="(${i.action.toString()})()">${i.connected ? '✓ ' : ''}${esc(i.actionLabel)}</button>`
        : `<button class="int-btn connected-btn" disabled>✓ ${esc(i.actionLabel)}</button>`
      }
    </div>`).join('');
}

// ─────────────────────────────────────────────────────────────
//  GOOGLE CALENDAR INTEGRATION
// ─────────────────────────────────────────────────────────────

let _GCAL_CONNECTED  = false;
let _GCAL_EVENTS     = [];

async function gcalCheckStatus() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/integrations/gcal/status?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _GCAL_CONNECTED = d.connected;
    const btn   = $('gcal-connect-btn');
    const label = $('gcal-btn-label');
    if (btn && label) {
      if (_GCAL_CONNECTED) {
        label.textContent = 'Google Connected';
        btn.style.borderColor = 'var(--teal)';
        btn.style.color       = 'var(--teal)';
        btn.onclick = gcalLoadEvents;
      } else {
        label.textContent = 'Connect Google';
        btn.style.borderColor = '';
        btn.style.color       = '';
        btn.onclick = gcalConnect;
      }
    }
    if (_GCAL_CONNECTED) gcalLoadEvents();
  } catch(_) {}
}

function gcalConnect() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) { toast('Sign in first.'); return; }
  window.location.href = `/auth/google/calendar?token=${encodeURIComponent(token)}`;
}

async function gcalLoadEvents() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !_GCAL_CONNECTED) return;
  const now     = new Date();
  const start   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end     = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
  try {
    const r = await fetch(`/api/integrations/gcal/events?token=${encodeURIComponent(token)}&time_min=${encodeURIComponent(start)}&time_max=${encodeURIComponent(end)}`);
    const d = await r.json();
    _GCAL_EVENTS = d.events || [];
    if (typeof renderCal === 'function') renderCal();
  } catch(_) {}
}

async function gcalPushEvent(ev) {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !_GCAL_CONNECTED) { toast('Connect Google Calendar first.'); return; }
  try {
    await API('/api/integrations/gcal/push', {
      token, title: ev.title, start: ev.start, end: ev.end || ev.start,
      allDay: !!ev.allDay, description: ev.description || '',
    });
    toast('Event pushed to Google Calendar!');
  } catch(e) {
    toast(e.message || 'Push to Google Calendar failed.');
  }
}

// ─────────────────────────────────────────────────────────────
//  PAYSTACK SUBSCRIPTION BILLING
// ─────────────────────────────────────────────────────────────

let _BILLING_STATUS = null;

async function billingLoadStatus() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/billing/status?token=${encodeURIComponent(token)}`);
    _BILLING_STATUS = await r.json();
    _billingRenderBadge();
    _billingRenderSidebar();
    integrationsRender();
  } catch(_) {}
}

function _billingRenderBadge() {
  const el = $('billing-plan-badge');
  if (!el || !_BILLING_STATUS) return;
  const plan = _BILLING_STATUS.name || 'Free';
  el.textContent = plan;
  el.style.background = plan === 'Free' ? 'var(--bg3)' : 'var(--teal2)';
  el.style.color       = plan === 'Free' ? 'var(--muted)' : 'var(--teal)';
}

async function showPricing() {
  const modal = $('pricing-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const token = localStorage.getItem('sivarr_token') || '';
  let planData = { plans: {}, paystack_available: false };
  try {
    const r = await fetch('/api/billing/plans');
    planData = await r.json();
  } catch(_) {}

  const cards = $('pricing-cards');
  if (cards) {
    const currentPlan = _BILLING_STATUS?.name?.toLowerCase() || 'free';
    const plans = [
      { id: 'free',        name: 'Free',  price: '₦0',     per: '/forever', perks: ['AI chat (20/day)', 'Tasks & Goals', 'Calendar', 'Personal journal'], cta: 'Current plan', free: true },
      { id: 'pro_monthly', name: 'Pro',   price: '₦2,500', per: '/month',   perks: ['Everything in Free', 'Unlimited AI', 'Org space access', 'Priority support'], featured: true },
      { id: 'team_monthly',name: 'Team',  price: '₦8,000', per: '/month',   perks: ['Everything in Pro', 'Full org suite', 'Analytics', 'Custom branding'] },
    ];
    cards.innerHTML = plans.map(p => {
      const isCurrent = currentPlan === p.name.toLowerCase() || (p.free && currentPlan === 'free');
      return `
      <div class="pricing-card${p.featured ? ' featured' : ''}${isCurrent ? ' current-plan' : ''}">
        <div class="pricing-name">${esc(p.name)}</div>
        <div class="pricing-price">${p.price}<span>${p.per}</span></div>
        <ul class="pricing-perks">${p.perks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${isCurrent
          ? `<button class="pricing-btn free-btn" disabled>Current plan</button>`
          : p.free
            ? `<button class="pricing-btn free-btn" disabled>Free</button>`
            : `<div style="display:flex;flex-direction:column;gap:6px">
                <button class="pricing-btn" onclick="billingSubscribe('${p.id}')">Paystack →</button>
                <button class="pricing-btn" style="background:var(--amber,#F5A623);border-color:var(--amber,#F5A623)" onclick="flutterwaveSubscribe('${p.id}')">Flutterwave →</button>
               </div>`
        }
      </div>`;
    }).join('');

    // Comparison table
    const tableWrap = cards.parentElement?.querySelector('#pricing-compare') || (() => {
      const t = document.createElement('div');
      t.id = 'pricing-compare';
      t.style.cssText = 'margin-top:24px;border-top:1px solid var(--border);padding-top:20px';
      cards.parentElement?.appendChild(t);
      return t;
    })();
    const CHECK = '<span style="color:var(--teal)">✓</span>';
    const CROSS = '<span style="color:var(--muted)">✗</span>';
    const rows = [
      ['AI messages / day',    '20',         'Unlimited',  'Unlimited'],
      ['Quizzes / day',        '5',          'Unlimited',  'Unlimited'],
      ['Core panels',          CHECK,        CHECK,        CHECK],
      ['Spaces (each type)',   '1',          '3',          'Unlimited'],
      ['Advanced analytics',   CROSS,        CHECK,        CHECK],
      ['Priority AI',          CROSS,        CHECK,        CHECK],
      ['Org members',          CROSS,        CROSS,        'Unlimited'],
      ['Team analytics',       CROSS,        CROSS,        CHECK],
      ['Data export',          CROSS,        CROSS,        CHECK],
      ['Price',                '₦0/mo',     '₦2,500/mo', '₦8,000/mo'],
    ];
    tableWrap.innerHTML = `
      <div style="font-weight:700;margin-bottom:12px;font-size:.9rem">Feature comparison</div>
      <table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);color:var(--muted);font-weight:600">Feature</th>
            ${['Free','Pro','Team'].map(n => `<th style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--border);color:${n.toLowerCase()===currentPlan?'var(--teal)':'var(--muted)'};font-weight:700">${n}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:7px 8px;color:var(--text2)">${r[0]}</td>
            ${r.slice(1).map(v => `<td style="padding:7px 8px;text-align:center">${v}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>`;
  }
}

function closePricing() {
  const modal = $('pricing-modal');
  if (modal) modal.style.display = 'none';
}

async function billingSubscribe(planId) {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) { toast('Sign in to subscribe.'); return; }
  try {
    const r = await API('/api/billing/subscribe', { token, plan: planId });
    if (r.authorization_url) {
      toast('Redirecting to Paystack…');
      window.location.href = r.authorization_url;
    }
  } catch(e) {
    toast(e.message || 'Could not start payment. Please try again.');
  }
}

async function billingVerify(reference, planId) {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !reference) return;
  try {
    const r = await fetch(`/api/billing/verify/${encodeURIComponent(reference)}?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    if (d.ok) {
      await billingLoadStatus();
      _unlockAfterPayment(d.name || planId || 'Pro');
    }
  } catch(_) {
    toast('Payment verification failed — contact support if funds were deducted.');
  }
}

function _unlockAfterPayment(planName) {
  const level = _planLevel(planName);
  const GUARDED = { org: 'Pro', orgchat: 'Pro', team: 'Pro', projects: 'Pro', founder: 'Team' };
  for (const [panel, required] of Object.entries(GUARDED)) {
    if (level >= _planLevel(required)) _removePaywall(panel);
  }
  if (level >= _planLevel('Pro')) {
    toast(`🎉 You're on the ${planName} plan! Org Space is now unlocked.`);
    setTimeout(() => nav('org'), 800);
  }
}

function checkAuthParams() {
  const params    = new URLSearchParams(window.location.search);
  const reset     = params.get('reset');
  const verify    = params.get('verify');
  const verified  = params.get('verified');
  const orgInvite = params.get('org_invite');
  const googleTok = params.get('google_token');
  const authErr   = params.get('auth_error');
  const gcalConn   = params.get('gcal_connected');
  const gcalErr    = params.get('gcal_error');
  const githubConn = params.get('github_connected');
  const githubErr  = params.get('github_error');
  const billing    = params.get('billing');
  const billingRef = params.get('ref');
  const billingPlan = params.get('plan');

  if (reset) {
    history.replaceState(null, '', '/');
    showResetPasswordForm(reset);
    return;
  }
  if (verify) {
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
  if (orgInvite) {
    history.replaceState(null, '', '/');
    sessionStorage.setItem('pending_org_invite', orgInvite);
  }

  // Google OAuth callback — exchange one-time code for real session token
  const googleCode = params.get('google_code');
  if (googleCode) {
    history.replaceState(null, '', '/');
    sessionStorage.setItem('google_login_pending_code', googleCode);
    return;
  }
  // Legacy fallback: direct token (old flow, keep for safety)
  if (googleTok) {
    history.replaceState(null, '', '/');
    localStorage.setItem('sivarr_token', googleTok);
    sessionStorage.setItem('google_login_pending', googleTok);
    return;
  }
  if (authErr) {
    history.replaceState(null, '', '/');
    const msgs = {
      google_not_configured: 'Google sign-in is not configured yet.',
      google_denied: 'Google sign-in was cancelled.',
      google_token_failed: 'Google token exchange failed. Please try again.',
      google_failed: 'Google sign-in failed. Please try again.',
      google_no_email: 'Could not retrieve email from Google. Please use email/password.',
    };
    toast(msgs[authErr] || 'Authentication error. Please try again.');
  }

  // Google Calendar callback
  if (gcalConn === '1') {
    history.replaceState(null, '', '/');
    sessionStorage.setItem('gcal_just_connected', '1');
  }
  if (gcalErr) {
    history.replaceState(null, '', '/');
    const msgs = {
      not_configured: 'Google Calendar integration not configured.',
      denied: 'Google Calendar access was denied.',
      session_expired: 'Session expired — please sign in again.',
      token_failed: 'Google Calendar token exchange failed.',
    };
    toast(msgs[gcalErr] || 'Google Calendar connection failed.');
  }

  // GitHub callback
  if (githubConn === '1') {
    history.replaceState(null, '', '/');
    sessionStorage.setItem('github_just_connected', '1');
  }
  if (githubErr) {
    history.replaceState(null, '', '/');
    const msgs = {
      not_configured: 'GitHub integration not configured.',
      denied: 'GitHub access was denied.',
      session_expired: 'Session expired — sign in again.',
      token_failed: 'GitHub token exchange failed.',
    };
    toast(msgs[githubErr] || 'GitHub connection failed.');
  }

  // Paystack billing callback
  if (billing === 'success' && billingRef) {
    history.replaceState(null, '', '/');
    sessionStorage.setItem('billing_verify_ref', billingRef);
    sessionStorage.setItem('billing_verify_plan', billingPlan || '');
  }

  // Flutterwave billing callback
  const flwBilling = params.get('flw_billing');
  const flwRef     = params.get('ref') || params.get('tx_ref') || '';
  if (flwBilling === 'success' && flwRef) {
    history.replaceState(null, '', '/');
    sessionStorage.setItem('flw_verify_ref', flwRef);
    sessionStorage.setItem('flw_verify_plan', sessionStorage.getItem('flw_billing_plan') || '');
  }
}

async function _acceptPendingOrgInvite() {
  const inviteToken = sessionStorage.getItem('pending_org_invite');
  if (!inviteToken) return;
  sessionStorage.removeItem('pending_org_invite');
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await API('/api/org/join', { token, invite_token: inviteToken });
    if (r.ok) {
      toast(`You joined ${r.org_name || 'the organization'}!`);
      navigate('org');
    }
  } catch(e) {
    toast(e.message || 'Invite link is invalid or expired.');
  }
}

async function orgCreateSpace() {
  const name = await siModal.input('Create Organization Space', 'e.g. Acme Corp, My Startup', '', { confirmLabel:'Create Space' });
  if (!name) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await API('/api/org/create', { token, name });
    if (r.ok) {
      toast(`${r.name} workspace created! Loading…`);
      sessionStorage.setItem('sivarr_post_create', 'org');
      setTimeout(() => location.reload(), 900);
    }
  } catch(e) {
    if (e.status === 409) {
      // Org already exists — just open it
      toast('Loading your organization…');
      sessionStorage.setItem('sivarr_post_create', 'org');
      setTimeout(() => location.reload(), 600);
      return;
    }
    toast(e.message || 'Could not create space');
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

// ── Google Sign-In helpers ────────────────────────────────────────────────────

function googleSignInStart(e) {
  const btn  = $('btn-google');
  const txt  = $('google-btn-text');
  if (btn) { btn.style.opacity = '0.7'; btn.style.pointerEvents = 'none'; }
  if (txt) txt.textContent = 'Redirecting to Google…';
  // Let the href navigate — no e.preventDefault()
}

async function _googleCheckAvailable() {
  try {
    const r = await fetch('/api/config');
    const d = await r.json();
    if (d.google_oauth === false) {
      const or  = $('google-or');
      const btn = $('btn-google');
      if (or)  or.style.display  = 'none';
      if (btn) btn.style.display = 'none';
    }
  } catch(_) { /* silently ignore — show button by default */ }
}

// Auto-restore on page load — try token first, fall back to re-login
window.addEventListener('DOMContentLoaded', async () => {
  localStorage.removeItem('sivarr_lecturer_token');
  localStorage.removeItem('sivarr_lecturer_name');

  // Restore accent colour immediately — before anything renders
  const _sa = localStorage.getItem('sivarr_accent');
  if (_sa) _applyAccentColor(_sa, localStorage.getItem('sivarr_accent2') || '');

  // Check if Google OAuth is available (hide button if not configured)
  _googleCheckAvailable();

  // Handle ?reset= / ?verify= / ?verified= URL params before anything else
  checkAuthParams();

  // Google OAuth — exchange one-time code for real session token
  const googleCode = sessionStorage.getItem('google_login_pending_code');
  if (googleCode) {
    sessionStorage.removeItem('google_login_pending_code');
    const btn = $('login-btn');
    if (btn) { btn.textContent = 'Signing in with Google…'; btn.disabled = true; }
    try {
      const r = await fetch(`/api/auth/google/exchange?code=${encodeURIComponent(googleCode)}`);
      const d = await r.json();
      if (!r.ok || !d.token) throw new Error(d.detail || 'Exchange failed');
      localStorage.setItem('sivarr_token', d.token);
      const ok = await restoreSession(d.token);
      if (ok) {
        toast('Signed in with Google!');
        _postLoginIntegrations();
        return;
      }
      throw new Error('Session restore failed');
    } catch(e) {
      toast('Google sign-in failed — please try again.');
      if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
      return;
    }
  }

  // Legacy fallback — direct google_token (kept for safety)
  const googlePending = sessionStorage.getItem('google_login_pending');
  if (googlePending) {
    sessionStorage.removeItem('google_login_pending');
    const btn = $('login-btn');
    if (btn) { btn.textContent = 'Signing in with Google…'; btn.disabled = true; }
    const ok = await restoreSession(googlePending);
    if (ok) {
      toast('Signed in with Google!');
      _postLoginIntegrations();
      return;
    }
    toast('Google sign-in failed — please try again.');
    if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
    return;
  }

  const saved = getSavedSession();
  if (!saved) return;

  const btn = $('login-btn');
  if (btn) { btn.textContent = 'Resuming session...'; btn.disabled = true; }

  // Token restore — no password required
  if (saved.token) {
    const ok = await restoreSession(saved.token);
    if (ok) {
      _postLoginIntegrations();
      return;
    }
    toast('Your session expired — please sign in again.');
  }

  // Fallback: pre-fill email and show login form for expired/invalid tokens
  if (saved.email && $('lm')) $('lm').value = saved.email;
  if (btn) { btn.textContent = 'Sign In'; btn.disabled = false; }
});

function _postLoginIntegrations() {
  // Google Calendar just connected
  if (sessionStorage.getItem('gcal_just_connected')) {
    sessionStorage.removeItem('gcal_just_connected');
    toast('Google Calendar connected!');
    gcalCheckStatus();
  }
  // GitHub just connected
  if (sessionStorage.getItem('github_just_connected')) {
    sessionStorage.removeItem('github_just_connected');
    toast('GitHub connected!');
    githubCheckStatus();
  }
  // Paystack billing just returned
  const bilRef  = sessionStorage.getItem('billing_verify_ref');
  const bilPlan = sessionStorage.getItem('billing_verify_plan');
  if (bilRef) {
    sessionStorage.removeItem('billing_verify_ref');
    sessionStorage.removeItem('billing_verify_plan');
    billingVerify(bilRef, bilPlan);
  }

  // Flutterwave billing just returned
  const flwRef  = sessionStorage.getItem('flw_verify_ref');
  const flwPlan = sessionStorage.getItem('flw_verify_plan');
  if (flwRef) {
    sessionStorage.removeItem('flw_verify_ref');
    sessionStorage.removeItem('flw_verify_plan');
    sessionStorage.removeItem('flw_billing_plan');
    flutterwaveVerify(flwRef, flwPlan);
  }

  // Set up browser push notifications (silent — user won't see this unless they approve)
  setTimeout(_pushSetup, 2000);
}

// ═══════════════════════ BROWSER PUSH NOTIFICATIONS ═════════════════════

function _urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function _pushSetup() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const token = localStorage.getItem('sivarr_token');
  if (!token) return;
  try {
    const res  = await fetch('/api/push/vapid-public');
    const data = await res.json();
    if (!data.available || !data.public_key) return;

    const reg = await navigator.serviceWorker.ready;
    let sub   = await reg.pushManager.getSubscription();
    if (!sub) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(data.public_key),
      });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, subscription: sub.toJSON() }),
    });
  } catch(_) {
    // Push is optional — fail silently
  }
}

['ln','lm'].forEach((id,i) => {
  const el = $(id);
  if (el) el.addEventListener('keydown', e => {
    if (e.key === 'Enter') i === 0 ? $('lm').focus() : doLogin();
  });
});

// Register service worker for PWA install + offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // Listen for FLUSH_QUEUE messages from service worker background sync
        navigator.serviceWorker.addEventListener('message', e => {
          if (e.data?.type === 'FLUSH_QUEUE') _flushOfflineQueue();
        });
      })
      .catch(err => console.warn('SW registration failed:', err));
  });
}

// ═══════════════════════ OFFLINE SUPPORT ════════════════════════

const _OFFLINE_QUEUE_KEY = 'sivarr_offline_queue';
let   _offlineQueue      = JSON.parse(localStorage.getItem(_OFFLINE_QUEUE_KEY) || '[]');

function _showOfflineBanner() {
  const b = $('offline-banner');
  if (b) b.style.display = 'flex';
  document.body.classList.add('offline');
  _updateOfflineCount();
}

function _hideOfflineBanner() {
  const b = $('offline-banner');
  if (b) b.style.display = 'none';
  document.body.classList.remove('offline');
}

function _updateOfflineCount() {
  const el = $('offline-queue-count');
  if (el && _offlineQueue.length) {
    el.textContent = `${_offlineQueue.length} change${_offlineQueue.length > 1 ? 's' : ''} pending`;
  } else if (el) {
    el.textContent = '';
  }
}

// Queue a POST API call for when we're back online
function _queueMutation(url, body) {
  const token = localStorage.getItem('sivarr_token') || '';
  _offlineQueue.push({ url, body: JSON.stringify({ ...body, token }), ts: Date.now() });
  localStorage.setItem(_OFFLINE_QUEUE_KEY, JSON.stringify(_offlineQueue));
  _updateOfflineCount();
}

// Flush queued mutations after reconnecting
async function _flushOfflineQueue() {
  if (!_offlineQueue.length || !navigator.onLine) return;
  const queue = [..._offlineQueue];
  _offlineQueue = [];
  localStorage.removeItem(_OFFLINE_QUEUE_KEY);
  let flushed = 0;
  for (const item of queue) {
    try {
      const body = JSON.parse(item.body);
      // Always use the current session token (original may have expired)
      const token = localStorage.getItem('sivarr_token');
      if (token && body.token !== undefined) body.token = token;
      const r = await fetch(item.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) flushed++;
      else _offlineQueue.push(item);
    } catch(_) {
      _offlineQueue.push(item);
    }
  }
  if (_offlineQueue.length) {
    localStorage.setItem(_OFFLINE_QUEUE_KEY, JSON.stringify(_offlineQueue));
  }
  _updateOfflineCount();
  if (flushed > 0) toast(`${flushed} offline change${flushed > 1 ? 's' : ''} synced ✓`);
}

// Online / offline event handlers
window.addEventListener('offline', () => {
  _showOfflineBanner();
});

window.addEventListener('online', async () => {
  _hideOfflineBanner();
  await _flushOfflineQueue();
  // Try Background Sync if supported
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (reg) reg.sync.register('sivarr-sync').catch(() => {});
  }
});

// Show banner immediately if already offline on load
if (!navigator.onLine) _showOfflineBanner();

// ═══════════════════════ AUTOSAVE SYSTEM ════════════════════════

let _unsavedChanges  = false;
let _saveStatusTimer = null;
let _jnlDraftTimer   = null;

function _saveStatus(state) {
  const el = $('global-save-status');
  clearTimeout(_saveStatusTimer);
  const cfg = {
    unsaved: { text: '● Unsaved', color: 'var(--coral)' },
    saving:  { text: '● Saving…', color: 'var(--text3)' },
    saved:   { text: '✓ Saved',   color: 'var(--teal)'  },
  };
  const c = cfg[state];
  _unsavedChanges = state === 'unsaved' || state === 'saving';
  if (el) {
    el.textContent = c ? c.text : '';
    el.style.color = c ? c.color : '';
  }
  if (state === 'saved') {
    _saveStatusTimer = setTimeout(() => {
      if (el) el.textContent = '';
      _unsavedChanges = false;
    }, 2500);
  }
}

// Warn before tab close / navigation when there are unsaved edits
window.addEventListener('beforeunload', e => {
  if (_unsavedChanges) { e.preventDefault(); e.returnValue = ''; }
});

// Journal input → debounced draft autosave
function _jnlInput() {
  _saveStatus('unsaved');
  clearTimeout(_jnlDraftTimer);
  _jnlDraftTimer = setTimeout(() => {
    const ta = $('journal-text');
    if (!ta?.value?.trim()) return;
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(`${JNL_KEY()}_jnl_draft_${today}`, ta.value.trim());
    _saveStatus('saved');
  }, 1500);
}

// Note textarea → track unsaved, persist draft
function _noteInput() {
  const ta = $('new-note-text');
  if (!ta) return;
  if (ta.value.trim()) {
    localStorage.setItem(`sivarr_note_draft_${S.sid}`, ta.value);
    _saveStatus('unsaved');
  } else {
    localStorage.removeItem(`sivarr_note_draft_${S.sid}`);
    _saveStatus('saved');
  }
}

// Wire journal textarea after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const jnl = $('journal-text');
  if (jnl) jnl.addEventListener('input', _jnlInput);
  const noteTA = $('new-note-text');
  if (noteTA) noteTA.addEventListener('input', _noteInput);
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
   Sivarr CONTEXT ENGINE
   Reads all local data stores and builds a rich snapshot that
   gets injected into the first message of each chat session,
   giving Sivarr genuine awareness of the user's world.
   ══════════════════════════════════════════════════════════════ */

let _contextSent = false; // reset to false on each login
let _chatMsgCount = 0;   // messages sent this session

// ── Activity streak (fires across all features) ───────────────
function _recordActivity() {
  if (!S.sid) return;
  const key = `sivarr_streak_${S.sid}`;
  const today = new Date().toDateString();
  try {
    const d = JSON.parse(localStorage.getItem(key) || '{}');
    if (d.last === today) return;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const streak = d.last === yesterday ? (d.streak || 0) + 1 : 1;
    localStorage.setItem(key, JSON.stringify({ last: today, streak }));
  } catch(_) {}
}

function _getActivityStreak() {
  if (!S.sid) return 0;
  try {
    const d = JSON.parse(localStorage.getItem(`sivarr_streak_${S.sid}`) || '{}');
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (d.last === today || d.last === yesterday) return d.streak || 0;
    return 0;
  } catch(_) { return 0; }
}

// ── Lightweight micro-context for messages 2+ ─────────────────
function buildMicroContext() {
  if (!S.sid) return '';
  try {
    const tasks  = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]').filter(t => !t.done);
    const goals  = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]').filter(g => !g.completed);
    const streak = _getActivityStreak();
    const parts  = [];
    if (tasks.length)  parts.push(`${tasks.length} open tasks`);
    if (goals.length)  parts.push(`top goal: ${goals[0].title}${goals[0].progress ? ` ${goals[0].progress}%` : ''}`);
    if (streak > 1)    parts.push(`${streak}-day streak`);
    return parts.length ? `[Context: ${parts.join(' · ')}] ` : '';
  } catch(_) { return ''; }
}

// ── Proactive greeting in chat (once per day) ─────────────────
function chatProactiveGreet() {
  if (!S.sid) return;
  const today = new Date().toDateString();
  const key   = `sivarr_greeted_${S.sid}`;
  if (localStorage.getItem(key) === today) return;

  const welcome = $('chat-welcome');
  if (!welcome || welcome.style.display === 'none') return;

  const firstName = S.name.split(' ')[0];
  const hr  = new Date().getHours();
  const tod = hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : 'Evening';

  const tasks  = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]').filter(t => !t.done);
  const goals  = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]').filter(g => !g.completed);
  const jnl    = JSON.parse(localStorage.getItem(`sivarr_journal_${S.sid}`) || '[]');
  const habits = JSON.parse(localStorage.getItem(`sivarr_habits_${S.sid}`) || '[]');
  const bestStreak = habits.reduce((m, h) => Math.max(m, h.streak || 0), 0);
  const today8601  = new Date().toISOString().split('T')[0];
  const journaledToday = jnl.some(e => e.date === today8601);

  const lines = [`${tod}, ${firstName}.`];
  if (tasks.length)           lines.push(`You have **${tasks.length} task${tasks.length > 1 ? 's' : ''}** open.`);
  if (goals.length)           lines.push(`Your **${goals[0].title}** goal is at ${goals[0].progress || 0}%.`);
  if (bestStreak >= 3)        lines.push(`🔥 ${bestStreak}-day habit streak — don't break it.`);
  if (!journaledToday && jnl.length) lines.push(`Haven't journalled today yet.`);
  if (!tasks.length && !goals.length) lines.push(`Your slate is clean — good time to set a goal or plan your week.`);
  lines.push(`What are we working on?`);

  welcome.style.display = 'none';
  addMsg('sivarr', lines.join(' '), false, false);
  localStorage.setItem(key, today);
}

async function buildSivarrContext() {
  if (!S.sid) return '';
  const sid = S.sid;
  const today = new Date().toDateString();
  const lines = [`Sivarr CONTEXT SNAPSHOT for ${S.name} — ${today}`];

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

  // ── Organization (fetched from server) ───────────────────
  try {
    const _tok = localStorage.getItem('sivarr_token') || '';
    const snapRes = _tok ? await fetch(`/api/context/snapshot?token=${encodeURIComponent(_tok)}`) : null;
    const snap = snapRes?.ok ? await snapRes.json() : null;
    if (snap?.org) {
      const o = snap.org;
      lines.push(`Organization: ${o.name} (role: ${o.role}, members: ${o.members})`);
      if (o.open_tasks?.length)   lines.push(`Org open tasks: ${o.open_tasks.join(' | ')}`);
      if (o.overdue_tasks?.length) lines.push(`Org OVERDUE tasks: ${o.overdue_tasks.join(' | ')}`);
      if (o.active_goals?.length)  lines.push(`Org active goals: ${o.active_goals.map(g => `${g.title} (${g.progress}%)`).join(' | ')}`);
    }
  } catch(_) {}

  if (lines.length <= 1) return ''; // only the header, no data yet
  return lines.join('\n');
}

let _lastFailedMsg = null;
let _lastUserMsg   = null;

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

  const btn = $('sb'); if (btn) btn.disabled = true;

  // Always inject context: full snapshot on message 1 and every 8 messages, micro-context otherwise
  let context = '';
  if (!retryText) {
    _chatMsgCount++;
    const needFullContext = !_contextSent || (_chatMsgCount % 8 === 0);
    if (needFullContext) {
      context = await buildSivarrContext();
      _contextSent = true;
    } else {
      context = buildMicroContext();
    }
  }

  _lastUserMsg = fullMsg;
  const r = await _chatStream(fullMsg, context);
  if (r && !r.error) {
    _lastFailedMsg = null;
    S.stats.questions++;
    updateSBStats();
    refreshTopics();
    chatCounterDecrement();
    track('Chat_Sent');
    _recordActivity();
  }
}

function retryChat() {
  if (!_lastFailedMsg) return;
  const msgs = $('msgs');
  if (msgs) {
    const errBubs = msgs.querySelectorAll('.msg-error');
    if (errBubs.length) errBubs[errBubs.length - 1].closest('.msg')?.remove();
  }
  const txt = _lastFailedMsg;
  _lastFailedMsg = null;
  send(txt);
}

function chatRegenerate() {
  if (!_lastUserMsg) return;
  const msgs = $('msgs');
  if (msgs) {
    const aiBubbles = msgs.querySelectorAll('.msg.sivarr');
    if (aiBubbles.length) aiBubbles[aiBubbles.length - 1].remove();
  }
  _chatStream(_lastUserMsg, '');
}

async function _chatStream(fullMsg, context) {
  const btn = $('sb'); if (btn) btn.disabled = true;
  _chatSetStatus(true);

  let res;
  try {
    res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: S.sid, message: fullMsg, context })
    });
  } catch {
    _chatSetStatus(false);
    if (btn) btn.disabled = false;
    addMsg('sivarr', 'Could not reach Sivarr — check your connection and tap "Try again".', false, true);
    _lastFailedMsg = fullMsg;
    return null;
  }

  if (!res.ok) {
    _chatSetStatus(false);
    if (btn) btn.disabled = false;
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      addMsg('sivarr', `You've sent a lot of messages — please wait ${data.retryAfter || 60} seconds before trying again.`, false, true);
    } else {
      addMsg('sivarr', 'Could not reach Sivarr — check your connection and tap "Try again".', false, true);
      _lastFailedMsg = fullMsg;
    }
    return null;
  }

  // Create streaming bubble
  const welcome = $('chat-welcome');
  if (welcome) welcome.style.display = 'none';
  const w = $('msgs');
  const d = document.createElement('div');
  d.className = 'msg sivarr';
  d.innerHTML = `<div class="msg-av">AI</div><div class="msg-inner"><div class="msg-bub md-body" style="min-height:1.4em"></div></div>`;
  w.appendChild(d);
  scrollMsgs();

  const msgId  = Date.now();
  d.dataset.msgId = msgId;
  const bub  = d.querySelector('.msg-bub');
  const slowTimer = setTimeout(() => { if (!bub.textContent.trim()) bub.textContent = 'Thinking…'; }, 8000);
  let fullText = '', isError = false, suggestions = [];

  const reader = res.body.getReader();
  const dec    = new TextDecoder();
  let buf = '';

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') break outer;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.done) { suggestions = parsed.suggestions || []; break outer; }
          if (parsed.token) {
            fullText += parsed.token;
            isError   = parsed.error || false;
            bub.textContent = fullText + '▌';
            scrollMsgs();
          }
        } catch {}
      }
    }
  } catch {
    clearTimeout(slowTimer);
    _chatSetStatus(false);
    if (btn) btn.disabled = false;
    bub.classList.add('msg-error');
    bub.innerHTML = 'Stream interrupted — <button class="chat-retry-btn" onclick="retryChat()">↻ Try again</button>';
    _lastFailedMsg = fullMsg;
    return null;
  }

  clearTimeout(slowTimer);

  // Finalise: render markdown, reactions, action buttons, suggestion pills
  bub.innerHTML = isError ? `<span class="msg-error">${esc(fullText)}</span>` : renderMarkdown(fullText);
  const inner = d.querySelector('.msg-inner');
  if (!isError) {
    inner.insertAdjacentHTML('beforeend', `
      <div class="msg-actions">
        <button class="action-btn" onclick="chatSaveTask(this)">+ Task</button>
        <button class="action-btn" onclick="chatSaveNote(this)">+ Note</button>
        <button class="action-btn" onclick="chatCopyMsg(this)">Copy</button>
        <button class="action-btn" onclick="chatRegenerate()" title="Regenerate response">↻</button>
        <button class="action-btn" onclick="downloadText(this.closest('.msg').querySelector('.msg-bub').innerText)">⬇ Save</button>
        <button class="action-btn chat-react-btn" data-val="up"   onclick="chatReact(this,'up')"   title="Good response">👍</button>
        <button class="action-btn chat-react-btn" data-val="down" onclick="chatReact(this,'down')" title="Bad response">👎</button>
      </div>`);
    if (suggestions.length) {
      inner.insertAdjacentHTML('beforeend', `
        <div class="chat-suggestions">
          ${suggestions.map(s => `<button class="chat-sug-pill" onclick="quickPrompt(${JSON.stringify(s)})">${esc(s)}</button>`).join('')}
        </div>`);
    }
  } else {
    _lastFailedMsg = fullMsg;
    inner.insertAdjacentHTML('beforeend',
      `<button class="chat-retry-btn" onclick="retryChat()">↻ Try again</button>`);
  }

  _chatSetStatus(false);
  if (btn) btn.disabled = false;
  scrollMsgs();
  return { reply: fullText, uncertain: false, error: isError };
}

function chatReact(btn, val) {
  const msgId = btn.closest('.msg')?.dataset.msgId;
  if (!msgId || !S.sid) return;
  const key   = `sivarr_chat_reactions_${S.sid}`;
  const store = JSON.parse(localStorage.getItem(key) || '{}');
  const cur   = store[msgId];
  store[msgId] = cur === val ? null : val; // toggle off if same
  localStorage.setItem(key, JSON.stringify(store));
  // Update visuals in the message
  btn.closest('.msg-actions').querySelectorAll('.chat-react-btn').forEach(b => {
    const active = store[msgId] === b.dataset.val;
    b.style.background    = active ? 'var(--teal2,rgba(13,122,95,.1))' : '';
    b.style.borderColor   = active ? 'var(--accent)' : '';
    b.style.fontWeight    = active ? '700' : '';
  });
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

  const w  = $('msgs');
  const d  = document.createElement('div');
  d.className = `msg ${role}`;

  const isAI     = role === 'sivarr';
  const av       = isAI ? 'AI' : (S.name?.[0]?.toUpperCase() || 'U');
  const rendered = isAI ? renderMarkdown(text) : esc(text);
  const errClass = isError ? ' msg-error' : '';

  d.innerHTML = `
    <div class="msg-av">${av}</div>
    <div class="msg-inner">
      <div class="msg-bub md-body${errClass}">${rendered}</div>
      ${uncertain ? `<div class="uncertain"><i class="ti ti-alert-triangle"></i> Verify with your lecturer</div>` : ''}
      ${isError   ? `<button class="chat-retry-btn" onclick="retryChat()">↻ Try again</button>` : ''}
      ${isAI && !isError ? `
        <div class="msg-actions">
          <button class="action-btn" onclick="chatSaveTask(this)">+ Task</button>
          <button class="action-btn" onclick="chatSaveNote(this)">+ Note</button>
          <button class="action-btn" onclick="chatCopyMsg(this)">Copy</button>
          <button class="action-btn" onclick="chatRegenerate()" title="Regenerate response">↻</button>
          <button class="action-btn" onclick="downloadText(this.closest('.msg').querySelector('.msg-bub').innerText)">⬇ Save</button>
        </div>` : ''}
    </div>`;
  w.appendChild(d);
  scrollMsgs();
  return d;
}

function chatCopyMsg(btn) {
  const text = btn.closest('.msg').querySelector('.msg-bub')?.innerText || '';
  navigator.clipboard?.writeText(text).then(() => toast('Copied ✓'));
}

async function chatClearConfirm() {
  const ok = await siModal.confirm('Clear this conversation?', { title: 'Clear chat', confirmLabel: 'Clear', danger: true });
  if (!ok) return;
  const w = $('msgs');
  if (!w) return;
  w.innerHTML = '';
  const welcome = document.createElement('div');
  welcome.id = 'chat-welcome';
  welcome.innerHTML = document.getElementById('chat-welcome')?.outerHTML
    ? $('panel-chat').querySelector('#chat-welcome')?.outerHTML || ''
    : '';
  // Simpler: reload the welcome screen
  w.innerHTML = `<div id="chat-welcome" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;padding:2.5rem 1.5rem;text-align:center;animation:fadeUp .5s cubic-bezier(.4,0,.2,1)">
    <div class="chat-welcome-orb"><img src="/static/sivarrai.png" alt="Sivarr"></div>
    <h1 class="chat-welcome-heading" id="welcome-greeting">Chat cleared</h1>
    <p class="chat-welcome-sub">Start a new conversation below.</p>
  </div>`;
  toast('Chat cleared');
}

function chatExport() {
  const msgs = document.querySelectorAll('#msgs .msg');
  if (!msgs.length) { toast('Nothing to export yet.'); return; }
  let out = `Sivarr AI Chat Export — ${new Date().toLocaleString()}\n${'─'.repeat(50)}\n\n`;
  msgs.forEach(m => {
    const role = m.classList.contains('sivarr') ? 'Sivarr AI' : (S.name || 'You');
    const text = m.querySelector('.msg-bub')?.innerText || '';
    out += `${role}:\n${text}\n\n`;
  });
  downloadText(out);
}

function _chatSetStatus(thinking = false) {
  const dot  = $('chat-status-dot');
  const text = $('chat-status-text');
  if (dot)  dot.classList.toggle('thinking', thinking);
  if (text) text.textContent = thinking ? 'Thinking…' : 'Online · Ready';
}

async function chatSaveTask(btn) {
  if (!S.sid) return;
  const msgText = btn.closest('.msg').querySelector('.msg-bub').innerText.trim().slice(0, 200);
  const title = await siModal.input('Save as Task', 'Task title:', msgText.split('\n')[0].slice(0, 100), { confirmLabel: 'Add Task' });
  if (!title) return;
  const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]');
  tasks.push({ id: Date.now(), title, status: 'todo', done: false, created: Date.now(), source: 'ai' });
  localStorage.setItem(`sivarr_tasks_${S.sid}`, JSON.stringify(tasks));
  toast('Task added');
}

async function chatSaveNote(btn) {
  if (!S.sid) return;
  const msgText = btn.closest('.msg').querySelector('.msg-bub').innerText.trim().slice(0, 2000);
  const title = await siModal.input('Save as Note', 'Note title:', '', { confirmLabel: 'Save Note' });
  if (!title) return;
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');
  notes.unshift({ id: Date.now(), title, content: msgText, created: new Date().toISOString(), source: 'ai' });
  localStorage.setItem(`sivarr_notes_${S.sid}`, JSON.stringify(notes.slice(0, 100)));
  toast('Note saved');
}

function addTyping() {
  _chatSetStatus(true);
  const w = $('msgs'), d = document.createElement('div');
  d.className = 'msg sivarr';
  d.innerHTML = `<div class="msg-av">AI</div>
    <div class="msg-inner"><div class="typing"><span></span><span></span><span></span></div></div>`;
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
  S.stats.quizzes++; updateSBStats(); loadWrong(); S.quizActive = false; _recordActivity();
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
    const _wt = localStorage.getItem('sivarr_token') || '';
    const r = await fetch(`/api/wrong?sid=${S.sid}&token=${encodeURIComponent(_wt)}`);
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
  const _st = localStorage.getItem('sivarr_token') || '';
  const r = await fetch(`/api/progress?sid=${S.sid}&token=${encodeURIComponent(_st)}`);
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
  const _pt = localStorage.getItem('sivarr_token') || '';
  const r = await fetch(`/api/progress?sid=${S.sid}&token=${encodeURIComponent(_pt)}`);
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

    <!-- AI coaching CTA -->
    <div style="background:linear-gradient(135deg,var(--accent)15,var(--accent2)10);border:1px solid var(--accent)30;border-radius:12px;padding:1rem;margin-bottom:.875rem;text-align:center">
      <div style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">✨ AI Coaching</div>
      <div style="font-size:.8rem;color:var(--text2);margin-bottom:.75rem">Get a personalised coaching session based on your progress data.</div>
      <button onclick="getProgressCoaching()" style="background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none;border-radius:9px;padding:9px 22px;font-family:var(--font);font-size:.8rem;font-weight:700;cursor:pointer">Get coaching from Sivarr →</button>
    </div>
  `;
}

function getProgressCoaching() {
  if (!S.sid) return;
  const tasks   = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]');
  const goals   = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]');
  const habits  = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  const jnl     = JSON.parse(localStorage.getItem(JNL_KEY()) || '[]');
  const streak  = _getActivityStreak();
  const today8601 = new Date().toISOString().split('T')[0];

  const doneTasks   = tasks.filter(t => t.done).length;
  const openTasks   = tasks.filter(t => !t.done).length;
  const activeGoals = goals.filter(g => !g.completed);
  const habitsToday = habits.filter(h => (h.completions || []).includes(today8601)).length;
  const jnlThisWeek = jnl.filter(e => {
    const diff = (Date.now() - new Date(e.date + 'T12:00:00').getTime()) / 86400000;
    return diff <= 7;
  }).length;

  const lines = [
    `Here's my Sivarr data for coaching:`,
    `- Tasks: ${doneTasks} done, ${openTasks} still open`,
    activeGoals.length ? `- Active goals: ${activeGoals.map(g => `${g.title} (${g.progress || 0}%)`).join(', ')}` : '- No active goals',
    `- Habit check-ins today: ${habitsToday}/${habits.length}`,
    `- Journal entries this week: ${jnlThisWeek}`,
    `- Activity streak: ${streak} day${streak !== 1 ? 's' : ''}`,
    S.stats?.questions ? `- AI questions asked: ${S.stats.questions}` : '',
    S.stats?.quizzes   ? `- Quizzes completed: ${S.stats.quizzes}` : '',
    ``,
    `Based on this, give me a honest coaching session. What patterns do you see? What should I stop, start, or do more of? Be direct and specific.`,
  ].filter(Boolean);

  nav('chat', null);
  setTimeout(() => {
    const ci = $('ci');
    if (ci) { ci.value = lines.join('\n'); ci.focus(); }
  }, 350);
}

// ═══════════════════════ GOALS ═════════════════════════════

let GL_GOALS = [];

function _glHealth(g) {
  if (g.completed) return { label: 'Done',      color: '#22c55e', icon: '✅' };
  if (!g.deadline) return null;
  const today    = new Date(); today.setHours(0,0,0,0);
  const deadline = new Date(g.deadline + 'T00:00:00');
  if (today > deadline) return { label: 'Off Track', color: '#ef4444', icon: '🔴' };
  const created  = g.created ? new Date(g.created.split('T')[0] + 'T00:00:00') : deadline;
  const total    = Math.max(1, (deadline - created) / 86400000);
  const elapsed  = Math.max(0, (today - created) / 86400000);
  const ePct     = (elapsed / total) * 100;
  const pct      = g.progress || 0;
  if (ePct < 5)         return { label: 'On Track',  color: '#22c55e', icon: '🟢' };
  if (pct >= ePct * 0.85) return { label: 'On Track',  color: '#22c55e', icon: '🟢' };
  if (pct >= ePct * 0.5)  return { label: 'At Risk',   color: '#f59e0b', icon: '🟡' };
  return                   { label: 'Off Track', color: '#ef4444', icon: '🔴' };
}

function glStartCheckin() {
  if (!S.sid) return;
  localStorage.setItem(`sivarr_gl_checkin_${S.sid}`, new Date().toISOString().split('T')[0]);
  glRender(); // re-render to dismiss banner
  const first = GL_GOALS.find(g => !g.completed);
  if (first) glUpdateProgress(first.id, first.progress || 0);
}

function _glCheckinDue() {
  if (!S.sid) return false;
  const key  = `sivarr_gl_checkin_${S.sid}`;
  const last = localStorage.getItem(key);
  if (!last) return GL_GOALS.some(g => !g.completed);
  const daysSince = (Date.now() - new Date(last + 'T00:00:00').getTime()) / 86400000;
  return daysSince >= 7 && GL_GOALS.some(g => !g.completed);
}

async function glLoad() {
  const cacheKey = `sivarr_goals_cache_${S.sid}`;
  try {
    const r = await fetch(`/api/goals?sid=${S.sid}`);
    const d = await r.json();
    GL_GOALS = d.goals || [];
    localStorage.setItem(cacheKey, JSON.stringify(GL_GOALS)); // cache for offline
    glRender();
  } catch(e) {
    // Offline fallback — use cached goals
    const cached = localStorage.getItem(cacheKey);
    GL_GOALS = cached ? JSON.parse(cached) : [];
    glRender();
  }
}

function glRender() {
  const list = $('gl-list'); if (!list) return;
  if (!GL_GOALS.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="es-orb" style="font-size:2rem;margin-bottom:10px">🎯</div>
      <div class="es-title">No goals yet</div>
      <p class="es-sub" style="max-width:300px">Goals keep you accountable. Set a target, track progress, and let Sivarr AI tell you if you're on track.</p>
      <button class="es-cta" onclick="glToggleForm()">+ Set your first goal</button>
    </div>`;
    return;
  }

  const checkinBanner = _glCheckinDue() ? `
    <div style="background:linear-gradient(135deg,var(--accent)08,var(--accent2)06);border:1px solid var(--accent)30;border-radius:12px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div>
        <div style="font-weight:700;font-size:.86rem;color:var(--text)">📋 Weekly check-in</div>
        <div style="font-size:.77rem;color:var(--muted);margin-top:2px">How are your goals tracking? Update your progress numbers.</div>
      </div>
      <button onclick="glStartCheckin()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:6px 14px;font-family:var(--font-body);font-size:.78rem;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0">Update now</button>
    </div>` : '';

  const today = new Date();
  list.innerHTML = checkinBanner + GL_GOALS.map(g => {
    const daysLeft = g.deadline
      ? Math.ceil((new Date(g.deadline + 'T00:00:00') - today) / 86400000) : null;
    const pct    = g.progress || 0;
    const health = _glHealth(g);
    const healthBadge = health ? `<span style="display:inline-flex;align-items:center;gap:3px;background:${health.color}18;color:${health.color};border-radius:5px;padding:1px 7px;font-size:.68rem;font-weight:700;letter-spacing:.02em">${health.icon} ${health.label}</span>` : '';
    const daysLabel = daysLeft !== null
      ? (daysLeft > 0 ? `${daysLeft}d left` : daysLeft === 0 ? 'Today!' : 'Overdue')
      : '';
    const krs = g.key_results || [];
    const isScore = g.goal_type === 'score';  // score model shows % bar only, no KR UI
    const hasKRs = !isScore && krs.length > 0;
    const krsHTML = krs.map(kr => {
      const krPct = Math.min(100, (kr.current / Math.max(0.01, kr.target)) * 100);
      return `
        <div style="margin-bottom:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;gap:8px">
            <span style="font-size:.78rem;color:var(--text2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(kr.title)}</span>
            <div style="display:flex;align-items:center;gap:5px;flex-shrink:0">
              <input type="number" value="${kr.current}" min="0"
                style="width:52px;text-align:right;background:var(--surface);border:1px solid var(--border);
                       border-radius:5px;padding:2px 6px;font-size:.76rem;color:var(--text);outline:none"
                onblur="glUpdateKR('${g.id}','${kr.id}',+this.value)"
                onkeydown="if(event.key==='Enter')this.blur()">
              <span style="font-size:.7rem;color:var(--muted);white-space:nowrap">/ ${kr.target}${kr.unit ? ' '+esc(kr.unit) : ''}</span>
              <span style="font-size:.7rem;font-weight:700;color:var(--accent);min-width:30px;text-align:right">${Math.round(krPct)}%</span>
              <button onclick="glDeleteKR('${g.id}','${kr.id}')"
                style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.72rem;padding:1px 3px;flex-shrink:0">✕</button>
            </div>
          </div>
          <div style="height:3px;background:var(--border);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${krPct}%;background:var(--accent);border-radius:2px;transition:width .3s"></div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="gl-card ${g.completed ? 'done' : ''}" data-id="${g.id}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
          <div style="flex:1;min-width:0">
            <div class="gl-title" style="margin-bottom:4px">${g.completed ? '✅ ' : ''}${esc(g.title)}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${healthBadge}
              ${g.subject ? `<span style="font-size:.72rem;color:var(--muted)">📚 ${esc(g.subject)}</span>` : ''}
              ${daysLeft !== null ? `<span style="font-size:.72rem;color:${daysLeft <= 0 ? '#ef4444' : daysLeft <= 3 ? '#f59e0b' : 'var(--muted)'}">${daysLabel}</span>` : ''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-family:var(--font);font-size:.9rem;font-weight:800;color:var(--accent)">${pct}%</div>
            <div style="font-size:.67rem;color:var(--muted)">${hasKRs ? `${krs.length} KR${krs.length!==1?'s':''}` : `of ${g.target_score}%`}</div>
          </div>
        </div>
        <div class="gl-prog-wrap">
          <div class="gl-prog-fill ${g.completed ? 'done' : ''}" style="width:${pct}%"></div>
        </div>
        ${hasKRs ? `<div style="margin-top:10px">${krsHTML}</div>` : ''}
        ${!isScore ? `<button onclick="glAddKR('${g.id}')"
          style="background:none;border:1px dashed var(--border);border-radius:7px;padding:4px 10px;
                 font-size:.74rem;color:var(--muted);cursor:pointer;margin-top:${hasKRs?'0':'8px'};width:100%;
                 font-family:var(--font-body);transition:var(--transition)"
          onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
          onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">
          + Key Result</button>` : ''}
        <div class="gl-actions" style="margin-top:8px">
          ${(isScore || !hasKRs) ? `<button class="gl-action-btn" onclick="glUpdateProgress('${g.id}',${pct})">📈 Update</button>` : ''}
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

function glToggleScoreField(type) {
  const sf = $('gl-score-field');
  if (sf) sf.style.display = type === 'score' ? 'block' : 'none';
}

async function glSaveGoal() {
  const title     = $('gl-title')?.value.trim();
  const subject   = $('gl-subject')?.value.trim();
  const target    = parseInt($('gl-target')?.value) || 70;
  const deadline  = $('gl-deadline')?.value;
  const goal_type = $('gl-type')?.value || 'okr';
  if (!title) { toast('Enter a goal title.'); return; }
  try {
    const r = await API('/api/goals/add', {sid:S.sid, title, subject, target_score:target, deadline, goal_type});
    GL_GOALS.push(r.goal);
    glRender();
    $('gl-add-form').classList.remove('open');
    $('gl-title').value = ''; $('gl-subject').value = '';
    $('gl-target').value = '70'; $('gl-deadline').value = '';
    if ($('gl-type')) $('gl-type').value = 'okr';
    glToggleScoreField('okr');
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

// ── Goal Key Results ──────────────────────────────────────────────────────────

function glAddKR(goalId) {
  // Inject inline form into the goal card
  const card = document.querySelector(`.gl-card[data-id="${goalId}"]`);
  if (!card) return;
  card.querySelectorAll('.gl-kr-form').forEach(f => f.remove());
  const form = document.createElement('div');
  form.className = 'gl-kr-form';
  form.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap';
  form.innerHTML = `
    <input placeholder="What will you measure?" id="kr-title-${goalId}"
      style="flex:2;min-width:130px;background:var(--surface);border:1px solid var(--accent);border-radius:7px;
             padding:5px 9px;color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none">
    <input type="number" placeholder="Target" id="kr-target-${goalId}" value="100" min="1"
      style="width:68px;background:var(--surface);border:1px solid var(--border);border-radius:7px;
             padding:5px 8px;color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none;text-align:center">
    <input placeholder="Unit" id="kr-unit-${goalId}" value="%"
      style="width:60px;background:var(--surface);border:1px solid var(--border);border-radius:7px;
             padding:5px 8px;color:var(--text);font-family:var(--font-body);font-size:.8rem;outline:none">
    <button onclick="glSaveKR('${goalId}')"
      style="background:var(--accent);color:#fff;border:none;border-radius:7px;
             padding:5px 13px;font-family:var(--font-body);font-size:.78rem;font-weight:600;cursor:pointer">Add</button>
    <button onclick="this.closest('.gl-kr-form').remove()"
      style="background:none;border:1px solid var(--border);border-radius:7px;
             padding:5px 9px;font-family:var(--font-body);font-size:.78rem;color:var(--muted);cursor:pointer">✕</button>`;
  card.appendChild(form);
  document.getElementById(`kr-title-${goalId}`)?.focus();
}

async function glSaveKR(goalId) {
  const title  = ($(`kr-title-${goalId}`)?.value || '').trim();
  const target = parseFloat($(`kr-target-${goalId}`)?.value) || 100;
  const unit   = ($(`kr-unit-${goalId}`)?.value || '').trim();
  if (!title) { toast('Enter a Key Result name'); return; }
  try {
    await API('/api/goals/kr/add', { sid: S.sid, goal_id: goalId, title, target, current: 0, unit });
    await glLoad();
    toast('Key Result added ✓');
  } catch { toast('Could not add Key Result'); }
}

async function glUpdateKR(goalId, krId, current) {
  try {
    await API('/api/goals/kr/update', { sid: S.sid, goal_id: goalId, kr_id: krId, current });
    // Update local cache silently, then re-render
    const g = GL_GOALS.find(x => x.id === goalId);
    if (g) {
      const kr = (g.key_results || []).find(k => k.id === krId);
      if (kr) kr.current = current;
      g.progress = Math.round(
        (g.key_results || []).reduce((s, k) => s + Math.min(100, (k.current / Math.max(0.01, k.target)) * 100), 0) /
        Math.max(1, (g.key_results || []).length)
      );
      if (g.progress >= 100) g.completed = true;
    }
    glRender();
  } catch { toast('Update failed'); }
}

async function glDeleteKR(goalId, krId) {
  if (!confirm('Delete this Key Result?')) return;
  try {
    await API('/api/goals/kr/delete', { sid: S.sid, goal_id: goalId, kr_id: krId });
    await glLoad();
  } catch { toast('Delete failed'); }
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

function dhTriggerUpload() { $('dh-upload-input').click(); }

function dhHandleUpload(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  let done = 0;
  const finish = () => { done++; if (done === files.length) { input.value = ''; dhRenderList(); toast(`${files.length === 1 ? `"${files[0].name}" uploaded` : `${files.length} files uploaded`} ✓`); } };
  files.forEach(file => {
    if (file.size > 8 * 1024 * 1024) { toast(`"${file.name}" exceeds 8 MB limit — skipped.`); finish(); return; }
    const isText = /^text\/|\.md$|\.txt$/i.test(file.type + file.name);
    const reader = new FileReader();
    reader.onerror = () => { toast(`Failed to read "${file.name}"`); finish(); };
    reader.onload = () => {
      const doc = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,5), title: file.name,
        content: isText ? reader.result : '', updated: Date.now(),
        kind: isText ? 'doc' : 'file', fileType: file.type || 'application/octet-stream',
        fileName: file.name, fileSize: file.size, fileData: isText ? null : reader.result };
      const docs = dhLoadDocs(); docs.push(doc); dhSaveDocs(docs); finish();
    };
    isText ? reader.readAsText(file) : reader.readAsDataURL(file);
  });
}

function _dhFileIcon(mimeType, fileName) {
  if (mimeType?.startsWith('image/')) return '🖼️';
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(fileName)) return '📕';
  if (mimeType?.includes('word') || /\.docx?$/i.test(fileName)) return '📘';
  if (mimeType?.startsWith('text/') || /\.(txt|md)$/i.test(fileName)) return '📝';
  return '📎';
}
function _dhFileLabel(mimeType, fileName) {
  if (mimeType?.startsWith('image/')) return 'Image';
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(fileName)) return 'PDF';
  if (mimeType?.includes('officedocument') || /\.docx$/i.test(fileName)) return 'DOCX';
  if (mimeType?.includes('msword') || /\.doc$/i.test(fileName)) return 'DOC';
  if (/\.md$/i.test(fileName)) return 'Markdown';
  if (mimeType?.startsWith('text/') || /\.txt$/i.test(fileName)) return 'Text';
  return 'File';
}
function _dhFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}

function dhOpenFile(id) {
  const doc = dhLoadDocs().find(d => d.id === id);
  if (!doc) return;
  if (doc.kind !== 'file') { dhOpenDoc(id); return; }
  if (doc.fileType?.startsWith('image/')) { _dhImageLightbox(doc); return; }
  if (doc.fileData) {
    const a = document.createElement('a');
    a.href = doc.fileData; a.download = doc.fileName || doc.title; a.click(); return;
  }
  toast('Cannot open this file type.');
}

function _dhImageLightbox(doc) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.87);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:1rem';
  ov.onclick = () => ov.remove();
  const img = document.createElement('img');
  img.src = doc.fileData; img.style.cssText = 'max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.5)';
  ov.appendChild(img); document.body.appendChild(ov);
}

function dhRenderList() {
  const docs = dhLoadDocs();
  const el   = $('dh-docs-list'); if (!el) return;
  if (!docs.length) {
    el.innerHTML = `<div style="text-align:center;padding:3rem 1rem;color:var(--muted)">
      <div style="font-size:2rem;margin-bottom:.5rem">📄</div>
      <div style="font-size:.85rem">No documents yet.<br>Create your first rich note or upload a file.</div>
    </div>`; return;
  }
  el.innerHTML = docs.sort((a,b)=>b.updated-a.updated).map(d => {
    const isFile = d.kind === 'file';
    const icon   = isFile ? _dhFileIcon(d.fileType, d.fileName) : '📄';
    const sub    = isFile
      ? `${_dhFileLabel(d.fileType, d.fileName)} · ${_dhFileSize(d.fileSize)}`
      : new Date(d.updated).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    const click  = isFile ? `dhOpenFile('${d.id}')` : `dhOpenDoc('${d.id}')`;
    return `
    <div class="dh-doc-item" onclick="${click}">
      <div style="font-size:1.1rem">${icon}</div>
      <div style="flex:1;overflow:hidden">
        <div class="dh-doc-title">${esc(d.title||'Untitled')}</div>
        <div class="dh-doc-date">${sub}</div>
      </div>
      <button onclick="event.stopPropagation();dhDeleteDoc('${d.id}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;padding:4px;transition:color .15s" onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--muted)'">🗑</button>
    </div>`;
  }).join('');
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
  _saveStatus('saved');
  if (!silent) {
    toast('Document saved ✓');
    const st = $('dh-save-status');
    if (st) { st.textContent = 'Saved'; st.style.color = 'var(--green)'; }
  } else {
    const st = $('dh-save-status');
    if (st) { st.textContent = 'Saved'; st.style.color = 'var(--green)'; }
  }
}

function dhAutoSave() {
  const st = $('dh-save-status');
  if (st) { st.textContent = 'Unsaved changes'; st.style.color = 'var(--yellow)'; }
  dhUpdateWordCount();
  _saveStatus('unsaved');
  clearTimeout(DH_SAVE_TIMER);
  DH_SAVE_TIMER = setTimeout(() => { _saveStatus('saving'); dhSaveDoc(true); }, 2000);
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
  let text = `Sivarr STUDY PLAN — ${subject.toUpperCase()}\n`;
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

  // Accent colour — mark the correct dot as selected
  const savedAccent = localStorage.getItem('sivarr_accent');
  if (savedAccent) {
    document.querySelectorAll('.st-accent-dot').forEach(d => {
      // compare hex values case-insensitively
      const bg = d.style.background.replace(/\s/g,'').toLowerCase();
      d.classList.toggle('sel', bg === savedAccent.toLowerCase());
    });
  }

  // Usage bars + plan details
  stUpdateUsage();
  stLoadBillingHistory();
}

function stUpdateUsage() {
  const today = new Date().toISOString().split('T')[0];
  const hist  = JSON.parse(localStorage.getItem(`sivarr_usage_${today}`) || '{"chat":0,"quiz":0}');
  const chatUsed = hist.chat || 0;
  const quizUsed = hist.quiz || 0;
  const isPaid   = _planLevel(_BILLING_STATUS?.name || 'free') > 0;
  const chatMax  = isPaid ? 999 : 20;
  const quizMax  = isPaid ? 999 : 5;

  const cu = $('st-usage-chat');    if (cu) cu.textContent = isPaid ? `${chatUsed} / ∞` : `${chatUsed} / ${chatMax}`;
  const cb = $('st-usage-chat-bar');if (cb) cb.style.width = isPaid ? '100%' : Math.min((chatUsed/chatMax)*100,100) + '%';
  if (cb && isPaid) cb.style.background = 'var(--accent)';
  const qu = $('st-usage-quiz');    if (qu) qu.textContent = isPaid ? `${quizUsed} / ∞` : `${quizUsed} / ${quizMax}`;
  const qb = $('st-usage-quiz-bar');if (qb) qb.style.width = isPaid ? '100%' : Math.min((quizUsed/quizMax)*100,100) + '%';
  if (qb && isPaid) qb.style.background = 'var(--accent)';

  const sub    = _BILLING_STATUS || {};
  const plan   = sub.name || 'Free';
  const status = sub.status || 'active';

  const badge = $('st-plan-badge');
  if (badge) {
    badge.textContent = isPaid ? `⚡ ${plan}` : '✦ Free';
    badge.className   = `st-plan-badge ${isPaid ? 'st-plan-pro' : 'st-plan-free'}`;
  }

  const meta = $('st-plan-meta');
  if (meta) {
    if (isPaid) {
      meta.style.display = '';
      const expEl = $('st-plan-expires');
      if (expEl) expEl.textContent = sub.expires || '—';
      const gwEl = $('st-plan-gateway');
      if (gwEl) gwEl.textContent = sub.gateway ? sub.gateway.charAt(0).toUpperCase() + sub.gateway.slice(1) : 'Paystack';
      const stEl = $('st-plan-status');
      if (stEl) {
        stEl.textContent = status === 'cancelled' ? 'Cancelled (access until expiry)' : 'Active';
        stEl.style.color  = status === 'cancelled' ? 'var(--amber,#f59e0b)' : 'var(--green,#22c55e)';
      }
    } else {
      meta.style.display = 'none';
    }
  }

  const cta    = $('st-plan-cta');
  const cancel = $('st-plan-cancel');
  if (cta)    cta.style.display    = isPaid ? 'none' : '';
  if (cancel) cancel.style.display = (isPaid && status !== 'cancelled') ? '' : 'none';
}

async function stLoadBillingHistory() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/billing/history?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    const list = $('st-billing-history-list');
    const wrap = $('st-billing-history');
    if (!list || !wrap) return;
    if (!d.history || d.history.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    list.innerHTML = d.history.map(h => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:.78rem">
        <div>
          <div style="font-weight:600">${esc(h.plan)}</div>
          <div style="color:var(--muted);margin-top:2px">${esc(h.date)} · ${esc(h.gateway || 'Paystack')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;color:var(--accent)">${esc(h.amount)}</div>
          <div style="color:var(--muted);font-size:.7rem">${esc(h.reference || '')}</div>
        </div>
      </div>`).join('');
  } catch(_) {}
}

async function billingCancelConfirm() {
  const ok = await siModal.confirm(
    'You\'ll keep access until your expiry date, but won\'t be renewed. Continue?',
    { title: 'Cancel subscription?', confirmLabel: 'Yes, cancel', danger: true });
  if (!ok) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch('/api/billing/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    if (d.ok) {
      toast(d.message || 'Subscription cancelled.');
      await billingLoadStatus();
      stUpdateUsage();
    } else {
      toast(d.detail || 'Could not cancel. Contact support.');
    }
  } catch(_) {
    toast('Could not cancel. Please try again.');
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

  _saveStatus('saved');
  toast('Profile saved ✓');
}

function stToggleTheme(btn) {
  btn.classList.toggle('on');
  toggleThemeFromMenu();
}

function stToggleNotif(btn, key) {
  const turningOn = !btn.classList.contains('on');
  btn.classList.toggle('on');
  const isOn = btn.classList.contains('on');
  localStorage.setItem(`sivarr_notif_${key}`, isOn ? 'on' : 'off');

  if (isOn && (key === 'streak' || key === 'tasks') && 'Notification' in window) {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        toast(`${key === 'streak' ? 'Streak' : 'Task'} reminders enabled`);
        _pushSubscribeForKey(key);
      } else {
        btn.classList.remove('on');
        localStorage.setItem(`sivarr_notif_${key}`, 'off');
        const errEl = document.createElement('div');
        errEl.style.cssText = 'font-size:.78rem;color:var(--red,#ef4444);margin-top:4px';
        errEl.textContent = 'Enable notifications in your browser settings first.';
        btn.parentElement?.appendChild(errEl);
        setTimeout(() => errEl.remove(), 4000);
      }
    });
  } else {
    toast(`${isOn ? 'Enabled' : 'Disabled'} notifications`);
  }
}

async function _pushSubscribeForKey(type) {
  try {
    const token = localStorage.getItem('sivarr_token') || '';
    if (!token || !navigator.serviceWorker) return;
    const cfgR = await fetch('/api/config');
    const cfg  = await cfgR.json();
    if (!cfg.vapid_public_key) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(cfg.vapid_public_key),
      });
    }
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, subscription: sub.toJSON(), type }),
    });
    localStorage.setItem('sivarr_notif_subscribed', 'true');
  } catch(_) {}
}

// Full accent colour map — each swatch defines every derived CSS variable
const _ACCENT_MAP = {
  '#4f6ef7': { teal:'#4f6ef7', teal2:'rgba(79,110,247,.12)',   teal3:'rgba(79,110,247,.22)',  teal4:'#3a55d4', purple:'#7c3aed', purple2:'rgba(124,58,237,.12)',  glow:'0 0 20px rgba(79,110,247,.3)' },
  '#0D7A5F': { teal:'#0D7A5F', teal2:'rgba(13,122,95,.12)',    teal3:'rgba(13,122,95,.22)',   teal4:'#085041', purple:'#534AB7', purple2:'rgba(83,74,183,.12)',   glow:'0 0 20px rgba(13,122,95,.3)'  },
  '#06b6d4': { teal:'#06b6d4', teal2:'rgba(6,182,212,.12)',    teal3:'rgba(6,182,212,.22)',   teal4:'#0891b2', purple:'#0284c7', purple2:'rgba(2,132,199,.12)',   glow:'0 0 20px rgba(6,182,212,.3)'  },
  '#10b981': { teal:'#10b981', teal2:'rgba(16,185,129,.12)',   teal3:'rgba(16,185,129,.22)',  teal4:'#059669', purple:'#0D7A5F', purple2:'rgba(13,122,95,.12)',   glow:'0 0 20px rgba(16,185,129,.3)' },
  '#f59e0b': { teal:'#f59e0b', teal2:'rgba(245,158,11,.12)',   teal3:'rgba(245,158,11,.22)',  teal4:'#d97706', purple:'#ef4444', purple2:'rgba(239,68,68,.1)',    glow:'0 0 20px rgba(245,158,11,.3)' },
  '#ef4444': { teal:'#ef4444', teal2:'rgba(239,68,68,.1)',     teal3:'rgba(239,68,68,.2)',    teal4:'#dc2626', purple:'#f97316', purple2:'rgba(249,115,22,.1)',   glow:'0 0 20px rgba(239,68,68,.3)'  },
  '#ec4899': { teal:'#ec4899', teal2:'rgba(236,72,153,.1)',    teal3:'rgba(236,72,153,.2)',   teal4:'#db2777', purple:'#8b5cf6', purple2:'rgba(139,92,246,.1)',   glow:'0 0 20px rgba(236,72,153,.3)' },
  '#8b5cf6': { teal:'#8b5cf6', teal2:'rgba(139,92,246,.12)',   teal3:'rgba(139,92,246,.22)',  teal4:'#7c3aed', purple:'#ec4899', purple2:'rgba(236,72,153,.1)',   glow:'0 0 20px rgba(139,92,246,.3)' },
};

function _applyAccentColor(color, color2) {
  const r = document.documentElement.style;
  const m = _ACCENT_MAP[color] || {};
  const c1 = m.teal    || color;
  const c2 = m.purple  || color2 || '#534AB7';
  r.setProperty('--accent',    c1);
  r.setProperty('--accent2',   c2);
  r.setProperty('--teal',      c1);
  r.setProperty('--teal2',     m.teal2   || `${c1}20`);
  r.setProperty('--teal3',     m.teal3   || `${c1}33`);
  r.setProperty('--teal4',     m.teal4   || c1);
  r.setProperty('--purple',    c2);
  r.setProperty('--purple2',   m.purple2 || `${c2}20`);
  r.setProperty('--glow-teal', m.glow    || `0 0 20px ${c1}44`);
  r.setProperty('--glow-purple', `0 0 20px ${c2}44`);
  r.setProperty('--ai-grad',   `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`);
}

function stSetAccent(color, color2, el) {
  document.querySelectorAll('.st-accent-dot').forEach(d => d.classList.remove('sel'));
  if (el) el.classList.add('sel');
  _applyAccentColor(color, color2);
  localStorage.setItem('sivarr_accent',  color);
  localStorage.setItem('sivarr_accent2', color2 || '');
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

// ═══════════════════════════════════════════════════════════════
//  IMPORT / EXPORT
// ═══════════════════════════════════════════════════════════════

async function stExportAll() {
  const token = localStorage.getItem('sivarr_token');
  if (!token) { toast('Sign in first.'); return; }

  const btn = $('export-btn');
  if (btn) { btn.textContent = 'Preparing ZIP…'; btn.disabled = true; }

  // Gather localStorage-only data to send alongside the token
  const habits  = JSON.parse(localStorage.getItem(`sivarr_habits_${S.sid}`)  || '[]');
  const journal = JSON.parse(localStorage.getItem(JNL_KEY())                  || '[]');

  try {
    const r = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, habits, journal }),
    });
    if (!r.ok) throw new Error('Export failed');
    const blob     = await r.blob();
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement('a');
    const dispHdr  = r.headers.get('Content-Disposition') || '';
    const match    = dispHdr.match(/filename="([^"]+)"/);
    a.download     = match ? match[1] : 'sivarr-export.zip';
    a.href         = url;
    a.click();
    URL.revokeObjectURL(url);
    toast('Export downloaded ✓');
  } catch(e) {
    toast('Export failed — try again.');
  } finally {
    if (btn) { btn.textContent = '↓ Export my data (ZIP)'; btn.disabled = false; }
  }
}

// ── CSV parser (no external library) ──────────────────────────

function _parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = _splitCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  return lines.slice(1).map(line => {
    const vals = _splitCSVLine(line);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim().replace(/^"|"$/g, ''); });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
}

function _splitCSVLine(line) {
  const result = [];
  let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

// ── Import handlers ───────────────────────────────────────────

async function stImportTasks(input) {
  const file = input.files[0]; input.value = '';
  if (!file) return;
  const token = localStorage.getItem('sivarr_token');
  if (!token) { toast('Sign in first.'); return; }
  const text = await file.text();
  const rows = _parseCSV(text);
  if (!rows.length) { toast('No valid rows found in CSV.'); return; }
  _setImportStatus(`Importing ${rows.length} tasks…`);
  try {
    const r = await fetch('/api/import/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, tasks: rows }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Import failed');
    _setImportStatus(`✓ ${d.imported} tasks imported`);
    toast(`${d.imported} tasks imported ✓`);
    // Sync localStorage from server
    const taskR = await fetch(`/api/tasks/sync`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({token, tasks: JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]')}) });
  } catch(e) {
    _setImportStatus('Import failed — check CSV format.');
    toast('Task import failed.');
  }
}

async function stImportGoals(input) {
  const file = input.files[0]; input.value = '';
  if (!file) return;
  const token = localStorage.getItem('sivarr_token');
  if (!token) { toast('Sign in first.'); return; }
  const text = await file.text();
  const rows = _parseCSV(text);
  if (!rows.length) { toast('No valid rows found in CSV.'); return; }
  _setImportStatus(`Importing ${rows.length} goals…`);
  try {
    const r = await fetch('/api/import/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, goals: rows }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Import failed');
    _setImportStatus(`✓ ${d.imported} goals imported`);
    toast(`${d.imported} goals imported ✓`);
  } catch(e) {
    _setImportStatus('Import failed — check CSV format.');
    toast('Goal import failed.');
  }
}

async function stImportNotes(input) {
  const file = input.files[0]; input.value = '';
  if (!file) return;
  const token = localStorage.getItem('sivarr_token');
  if (!token) { toast('Sign in first.'); return; }
  const markdown = await file.text();
  if (!markdown.trim()) { toast('File is empty.'); return; }
  _setImportStatus(`Importing ${file.name}…`);
  try {
    const r = await fetch('/api/import/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, markdown, filename: file.name }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || 'Import failed');
    _setImportStatus(`✓ Note imported as "${file.name.replace('.md','').replace('.txt','')}" in Docs`);
    toast('Note imported ✓ — check Docs & Notes');
  } catch(e) {
    _setImportStatus('Import failed.');
    toast('Note import failed.');
  }
}

function _setImportStatus(msg) {
  const el = $('import-status');
  if (el) el.textContent = msg;
}

// ── Habits + Journal sync wiring ─────────────────────────────

function _syncHabitsToServer(habits) {
  const token = localStorage.getItem('sivarr_token');
  if (!token || !S.sid) return;
  if (!navigator.onLine) { _queueMutation('/api/habits/sync', { token, habits }); return; }
  fetch('/api/habits/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, habits }),
  }).catch(() => _queueMutation('/api/habits/sync', { token, habits }));
}

function _syncJournalToServer(entries) {
  const token = localStorage.getItem('sivarr_token');
  if (!token || !S.sid) return;
  if (!navigator.onLine) { _queueMutation('/api/journal/sync', { token, entries }); return; }
  fetch('/api/journal/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, entries }),
  }).catch(() => _queueMutation('/api/journal/sync', { token, entries }));
}

async function stClearChat() {
  if (!await siModal.confirm('All chat history will be permanently deleted.', { title:'Clear Chat History', confirmLabel:'Clear', danger:true })) return;
  try {
    await fetch('/api/clear-history', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({sid: S.sid})
    });
  } catch(e) {}
  _contextSent  = false; // re-inject context on next message after a clear
  _chatMsgCount = 0;
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

let _cmdSearchTimer = null;

function cmdSearch() {
  const q   = ($('cmd-input')?.value || '').toLowerCase().trim();
  const res = $('cmd-results');
  if (!res) return;
  CMD_IDX = -1;

  const capRow = $('cmd-capture-row');
  if (capRow) capRow.style.display = q.length > 1 ? 'flex' : 'none';

  // ── Step 1: instant local results (panels + localStorage content) ──
  const notes = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`)   || '[]');
  const jnl   = JSON.parse(localStorage.getItem(`sivarr_journal_${S.sid}`) || '[]');

  const panelItems = CMD_ITEMS.filter(item =>
    !q || item.label.toLowerCase().includes(q) || (item.tag || '').toLowerCase().includes(q)
  ).map(i => ({ ...i, type: 'panel' }));

  const noteItems = q
    ? notes.filter(n => (n.text || n.title || '').toLowerCase().includes(q))
           .slice(0, 3)
           .map(n => ({
             icon: '📓', label: ((n.text || n.title || '').split('\n')[0].slice(0, 50)) || 'Note',
             tag: 'Note', type: 'note', action: () => nav('notes', null),
           }))
    : [];

  const jnlItems = q
    ? jnl.filter(e => (e.text || e.content || e.entry || '').toLowerCase().includes(q))
          .slice(0, 3)
          .map(e => ({
            icon: '✍️', label: ((e.text || e.content || e.entry || '').slice(0, 50)) || 'Journal entry',
            tag: 'Journal', type: 'journal', action: () => nav('journal', null),
          }))
    : [];

  CMD_VISIBLE = [...panelItems, ...noteItems, ...jnlItems];
  cmdRenderResults(q);

  // ── Step 2: server search — debounced 300ms, merges into results ──
  clearTimeout(_cmdSearchTimer);
  if (q.length >= 2) {
    const token = localStorage.getItem('sivarr_token');
    if (token) {
      _cmdSearchTimer = setTimeout(async () => {
        try {
          const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(token)}`);
          if (!r.ok) return;
          const data = await r.json();
          const serverItems = (data.results || []).map(item => {
            const ACTION_MAP = {
              task:  () => nav('flux', null),
              goal:  () => nav('goals', null),
              doc:   () => { nav('notes', null); setTimeout(() => docOpen(parseInt(item.id) || item.id), 150); },
              post:  () => nav('community', null),
            };
            return {
              icon:   item.icon,
              label:  (item.title || '').slice(0, 60),
              tag:    item.type.charAt(0).toUpperCase() + item.type.slice(1),
              type:   item.type,
              meta:   item.meta || '',
              action: ACTION_MAP[item.type] || (() => {}),
            };
          });
          // Merge: keep existing panels/notes/journal, replace content types with server data
          const panels = CMD_VISIBLE.filter(i => i.type === 'panel');
          const others = CMD_VISIBLE.filter(i => i.type !== 'panel' && !['task','goal','doc','post'].includes(i.type));
          CMD_VISIBLE = [...panels, ...serverItems, ...others];
          cmdRenderResults(q);
        } catch(_) {}
      }, 300);
    }
  }
}

function cmdRenderResults(q) {
  const res = $('cmd-results');
  if (!res) return;

  if (!CMD_VISIBLE.length) {
    res.innerHTML = q
      ? `<div class="cmd-empty">No results for "<strong>${esc(q)}</strong>" — capture it below ↓</div>`
      : `<div class="cmd-empty">Type to search panels, docs, tasks or actions…</div>`;
    return;
  }

  const groups = {};
  CMD_VISIBLE.forEach((item, idx) => {
    const g = item.type === 'doc'     ? 'Docs'
            : item.type === 'note'    ? 'Notes'
            : item.type === 'task'    ? 'Tasks'
            : item.type === 'goal'    ? 'Goals'
            : item.type === 'post'    ? 'Community'
            : item.type === 'journal' ? 'Journal'
            : (item.tag || 'Actions');
    if (!groups[g]) groups[g] = [];
    groups[g].push({ ...item, _idx: idx });
  });

  res.innerHTML = Object.entries(groups).map(([group, groupItems]) => `
    <div class="cmd-section-label">${group}</div>
    ${groupItems.map(item => `
      <button class="cmd-item" data-idx="${item._idx}" onclick="cmdRun(${item._idx})">
        <div class="cmd-item-icon">${item.icon}</div>
        <div style="flex:1;min-width:0">
          <div class="cmd-item-label">${esc(item.label)}</div>
          ${item.meta ? `<div style="font-size:.72rem;color:var(--text3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.meta)}</div>` : ''}
        </div>
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

// ════════════════════ GETTING STARTED GUIDE ══════════════════════

const _GS_KEY        = () => `sivarr_gs_${S.sid}`;
const _GS_JOINED_KEY = () => `sivarr_joined_${S.sid}`;
const _GS_DAYS       = 7;    // show for this many days after first login
const _GS_TOTAL      = 6;    // total video cards

function gsInit() {
  if (!S.sid) return;

  // Record first login date if not already stored
  const joinedKey = _GS_JOINED_KEY();
  if (!localStorage.getItem(joinedKey)) {
    localStorage.setItem(joinedKey, new Date().toISOString());
  }

  const section = $('gs-section');
  if (!section) return;

  // Check: dismissed?
  const state = JSON.parse(localStorage.getItem(_GS_KEY()) || '{}');
  if (state.dismissed) { section.style.display = 'none'; return; }

  // Check: within first N days?
  const joined  = new Date(localStorage.getItem(joinedKey));
  const ageMs   = Date.now() - joined.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > _GS_DAYS) { section.style.display = 'none'; return; }

  section.style.display = '';
  _gsRenderProgress(state.done || []);
}

function _gsRenderProgress(done) {
  const count = done.length;
  const fill  = $('gs-progress-fill');
  const label = $('gs-progress-label');
  if (fill)  fill.style.width  = `${Math.round((count / _GS_TOTAL) * 100)}%`;
  if (label) label.textContent = `${count} / ${_GS_TOTAL} done`;

  // Restore done state on cards
  done.forEach(idx => {
    const card = $(`gsvid-${idx}`);
    if (card) card.classList.add('done');
  });
}

const _GS_VIDEOS = [
  { title: 'Welcome to Sivarr',  embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Sivarr AI Chat',     embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Tasks & Goals',      embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Notes & Docs',       embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Org Space',          embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
  { title: 'Billing & Plans',    embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ' },
];

function gsOpenVideo(idx, card) {
  const v = _GS_VIDEOS[idx];
  if (!v) return;
  // Remove old modal if any
  document.getElementById('gs-video-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'gs-video-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:var(--bg);border-radius:14px;padding:20px;width:min(720px,95vw);position:relative">
      <button onclick="document.getElementById('gs-video-modal').remove()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:var(--muted);font-size:1.3rem;cursor:pointer;line-height:1">×</button>
      <div style="font-weight:700;margin-bottom:12px;padding-right:24px">${esc(v.title)}</div>
      <div style="position:relative;padding-top:56.25%;background:#000;border-radius:8px;overflow:hidden">
        <iframe src="${v.embed}?autoplay=1" style="position:absolute;inset:0;width:100%;height:100%;border:none" allow="autoplay;encrypted-media" allowfullscreen></iframe>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  // Mark done
  gsMarkDone(idx, card);
}

function gsMarkDone(idx, card) {
  const state = JSON.parse(localStorage.getItem(_GS_KEY()) || '{}');
  const done  = state.done || [];
  if (!done.includes(idx)) {
    done.push(idx);
    state.done = done;
    localStorage.setItem(_GS_KEY(), JSON.stringify(state));
  }
  if (card) card.classList.add('done');
  _gsRenderProgress(done);

  // Auto-dismiss when all done
  if (done.length >= _GS_TOTAL) {
    setTimeout(() => {
      const s = $('gs-section');
      if (s) { s.style.opacity = '0'; s.style.transition = 'opacity .4s'; setTimeout(() => s.style.display = 'none', 400); }
    }, 800);
  }
}

function gsDismiss() {
  const state = JSON.parse(localStorage.getItem(_GS_KEY()) || '{}');
  state.dismissed = true;
  localStorage.setItem(_GS_KEY(), JSON.stringify(state));
  const s = $('gs-section');
  if (s) { s.style.opacity = '0'; s.style.transition = 'opacity .3s'; setTimeout(() => s.style.display = 'none', 300); }
}

// ═════════════════════════════════════════════════════════════════

async function loadHome() {
  if (!S.sid) return;
  _recordActivity();
  _buildNotifs();
  gsInit();

  const hr        = new Date().getHours();
  const tod       = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = S.name.split(' ')[0] || 'there';
  const today8601 = new Date().toISOString().split('T')[0];

  const greet = $('home-greeting');
  if (greet) greet.textContent = `${tod}, ${firstName} 👋`;
  const sub = $('home-sub');
  if (sub) sub.textContent = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });

  // Pull all live data
  const tasks   = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]');
  const goals   = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]');
  const habits  = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  const jnl     = JSON.parse(localStorage.getItem(JNL_KEY()) || '[]');
  const events  = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');
  const notes   = JSON.parse(localStorage.getItem(`sivarr_notes_${S.sid}`) || '[]');

  const openTasks    = tasks.filter(t => !t.done);
  const activeGoals  = goals.filter(g => !g.completed);
  const streak       = _getActivityStreak();

  // ── Sivarr brief — fast data-driven first, AI overlay if cached ──────────────
  const briefMsg = $('home-brief-msg');
  if (briefMsg) {
    const briefKey = `sivarr_brief_${S.sid}_${today8601}`;
    const cached   = localStorage.getItem(briefKey);
    if (cached) {
      briefMsg.innerHTML = renderMarkdown(cached);
    } else {
      // Show structured data immediately from /api/home/briefing, then fetch AI brief in background
      const token = localStorage.getItem('sivarr_token') || '';
      briefMsg.innerHTML = `<span class="brief-pulse">Loading…</span>`;
      fetch(`/api/home/briefing?token=${encodeURIComponent(token)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          const parts = [`${d.greeting}, ${S.name.split(' ')[0]}.`];
          if (d.tasks_due_today) parts.push(`${d.tasks_due_today} task${d.tasks_due_today > 1 ? 's' : ''} due today${d.overdue_tasks ? ` · ${d.overdue_tasks} overdue` : ''}.`);
          if (d.streak_days)     parts.push(`${d.streak_days}-day streak — keep it going.`);
          if (d.goals_at_risk)   parts.push(`${d.goals_at_risk} goal${d.goals_at_risk > 1 ? 's' : ''} at risk.`);
          if (!briefMsg.querySelector('.brief-pulse')) return; // AI beat us, skip
          briefMsg.textContent = parts.join(' ');
          // Still fire the AI brief in background to replace with richer text
          _fetchHomeBrief({ openTasks, activeGoals, habits, jnl, events, today8601, streak, briefKey, briefMsg });
        })
        .catch(() => {
          briefMsg.innerHTML = `<span class="brief-pulse">Generating your brief…</span>`;
          _fetchHomeBrief({ openTasks, activeGoals, habits, jnl, events, today8601, streak, briefKey, briefMsg });
        });
    }
  }

  // ── Stats ─────────────────────────────────────────────────────
  const hq  = $('home-questions'); if (hq)  hq.textContent  = S.stats?.questions || 0;
  const hqz = $('home-quizzes');   if (hqz) hqz.textContent = S.stats?.quizzes   || 0;
  const hs  = $('home-sessions');  if (hs)  hs.textContent  = streak || S.stats?.sessions || 1;
  const gc  = $('home-goals-count'); if (gc) gc.textContent = activeGoals.length;

  // ── Today's priorities ─────────────────────────────────────────
  try {
    const pl = $('home-priorities-list');
    if (pl) {
      const hi = openTasks.filter(t => t.priority === 'high').slice(0, 2);
      const display = hi.length ? hi : openTasks.slice(0, 4);
      const colors  = { high:'var(--red3)', medium:'var(--amber3)', low:'var(--green3)' };
      if (display.length) {
        pl.innerHTML = display.map(t => `
          <div class="priority-item" onclick="nav('flux',null)" style="cursor:pointer">
            <div class="pr-dot" style="background:${colors[t.priority]||'var(--text4)'}"></div>
            <div class="pr-text">${esc(t.title)}</div>
            <span class="pr-tag" style="background:var(--bg3);color:var(--text3)">${t.priority||'task'}</span>
          </div>`).join('');
      } else {
        pl.innerHTML = `<div class="priority-item"><div class="pr-dot" style="background:var(--text4)"></div><div class="pr-text" style="color:var(--text4)">All done — nice work.</div></div>`;
      }
    }
  } catch(_) {}

  // ── Today's schedule ──────────────────────────────────────────
  try {
    const sl = $('home-schedule-list');
    if (sl) {
      const todayEvts = events
        .filter(e => (e.date || '').startsWith(today8601))
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      const shTasksToday = (getSHData().tasks || [])
        .filter(t => t.date === today8601 && t.status !== 'done')
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

      const schedItems = [
        ...todayEvts.slice(0, 3).map(e => `
          <div class="sched-item">
            <div class="sched-time">${e.time || 'All day'}</div>
            <div class="sched-dot" style="background:var(--teal)"></div>
            <div class="sched-info">
              <div class="sched-name">${esc(e.title)}</div>
              ${e.desc ? `<div class="sched-sub">${esc(e.desc.slice(0,40))}</div>` : ''}
            </div>
          </div>`),
        ...shTasksToday.slice(0, 3).map(t => `
          <div class="sched-item" onclick="nav('flux',null)" style="cursor:pointer">
            <div class="sched-time">${t.time || 'Task'}</div>
            <div class="sched-dot" style="background:var(--amber3,#f59e0b)"></div>
            <div class="sched-info">
              <div class="sched-name">${esc(t.title)}</div>
              ${t.type ? `<div class="sched-sub">${esc(t.type)}</div>` : ''}
            </div>
          </div>`),
      ];
      if (schedItems.length) {
        sl.innerHTML = schedItems.slice(0, 5).join('');
      } else {
        sl.innerHTML = `<div class="sched-item"><div class="sched-time">—</div><div class="sched-dot" style="background:var(--text4)"></div><div class="sched-info"><div class="sched-name" style="color:var(--text4)">No events today</div><div class="sched-sub">Add some in Calendar →</div></div></div>`;
      }
    }
  } catch(_) {}

  // ── Habits check-in ────────────────────────────────────────────
  try {
    const hl = $('home-habits-list');
    if (hl) {
      if (!habits.length) {
        hl.innerHTML = `<div style="font-size:.82rem;color:var(--text4);padding:8px 0">No habits yet — <button onclick="nav('habits',null)" style="background:none;border:none;color:var(--teal);cursor:pointer;font-family:var(--font);font-size:.82rem;padding:0">add one →</button></div>`;
      } else {
        hl.innerHTML = habits.slice(0, 5).map((h, i) => {
          const done = (h.completions || []).includes(today8601);
          return `<div class="habit-check-row" onclick="homeHabitToggle(${i})" style="cursor:pointer">
            <div class="habit-cb ${done ? 'done' : ''}"></div>
            <div class="habit-name">${esc(h.emoji || '📌')} ${esc(h.title)}</div>
            <div class="habit-streak">${h.streak > 0 ? `🔥 ${h.streak}d` : '—'}</div>
          </div>`;
        }).join('');
      }
    }
  } catch(_) {}

  // ── Active goals ───────────────────────────────────────────────
  try {
    const gs = $('home-goals-section');
    const gl = $('home-goals-list');
    if (gs && gl) {
      if (activeGoals.length) {
        gs.style.display = 'block';
        gl.innerHTML = activeGoals.slice(0, 3).map(g => {
          const pct      = g.progress || 0;
          const daysLeft = g.deadline ? Math.ceil((new Date(g.deadline) - new Date()) / 86400000) : null;
          const urgency  = daysLeft !== null && daysLeft <= 3 ? 'red' : 'teal';
          return `<div class="priority-item" onclick="nav('goals',null)" style="cursor:pointer">
            <div class="pr-dot" style="background:var(--${urgency})"></div>
            <div style="flex:1;min-width:0">
              <div class="pr-text">${esc(g.title)}</div>
              <div style="height:3px;background:var(--border);border-radius:2px;margin-top:4px">
                <div style="height:3px;width:${pct}%;background:var(--teal);border-radius:2px;transition:width .4s"></div>
              </div>
            </div>
            <span class="pr-tag" style="background:var(--${urgency}2);color:var(--${urgency}4)">
              ${daysLeft !== null ? `${daysLeft}d` : `${pct}%`}
            </span>
          </div>`;
        }).join('');
      } else {
        gs.style.display = 'none';
      }
    }
  } catch(_) {}

  // ── Recent notes ───────────────────────────────────────────────
  try {
    const ns = $('home-notes-section');
    const nl = $('home-notes-list');
    if (ns && nl && notes.length) {
      ns.style.display = 'block';
      nl.innerHTML = notes.slice(0, 3).map(n => `
        <div class="priority-item" onclick="nav('notes',null)" style="cursor:pointer">
          <div class="pr-dot" style="background:var(--purple)"></div>
          <div class="pr-text">${esc((n.text || '').split('\n')[0].slice(0, 60))}</div>
          <span style="font-size:.7rem;color:var(--text4)">${n.date || ''}</span>
        </div>`).join('');
    } else if (ns) {
      ns.style.display = 'none';
    }
  } catch(_) {}

  // ── Journal latest entry ───────────────────────────────────────
  try {
    const js = $('home-journal-section');
    const jt = $('home-journal-text');
    if (js && jt && jnl.length) {
      const latest = jnl[0];
      js.style.display = 'block';
      jt.textContent   = (latest.text || '').slice(0, 120) + ((latest.text || '').length > 120 ? '…' : '');
      const jd = $('home-journal-date');
      if (jd) jd.textContent = latest.date || '';
    }
  } catch(_) {}

  // ── Featured templates ─────────────────────────────────────────
  try {
    const htl = $('home-templates-list');
    if (htl && typeof TPL_BUILTIN !== 'undefined') {
      htl.innerHTML = TPL_BUILTIN.slice(0, 3).map(t => `
        <div class="priority-item" onclick="nav('templates',null)" style="cursor:pointer">
          <div style="font-size:1.1rem">${t.icon}</div>
          <div class="pr-text" style="font-weight:500">${esc(t.name)}</div>
          <span style="color:var(--text3);font-size:12px">→</span>
        </div>`).join('');
    }
  } catch(_) {}
}

async function _fetchHomeBrief({ openTasks, activeGoals, habits, jnl, events, today8601, streak, briefKey, briefMsg }) {
  if (!S.sid) return;
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;

  const overdueTasks = openTasks.filter(t => t.due_date && t.due_date < today8601);
  const topGoal      = activeGoals[0];
  const highPri      = openTasks.find(t => t.priority === 'high');
  const journalled   = jnl.some(e => (e.date || '') === today8601);
  const eventsToday  = events.filter(e => (e.date || '').startsWith(today8601)).length;

  try {
    const r = await API('/api/home/brief', {
      token,
      open_tasks:          openTasks.length,
      overdue_tasks:       overdueTasks.length,
      top_goal:            topGoal?.title || '',
      goal_pct:            topGoal?.progress || 0,
      streak,
      events_today:        eventsToday,
      journalled,
      high_priority_task:  highPri?.title || '',
    });
    if (r?.brief && briefMsg) {
      briefMsg.innerHTML = renderMarkdown(r.brief);
      localStorage.setItem(briefKey, r.brief);
    }
  } catch(_) {
    if (briefMsg) {
      const firstName = S.name.split(' ')[0];
      briefMsg.textContent = openTasks.length
        ? `${firstName}, you have ${openTasks.length} task${openTasks.length > 1 ? 's' : ''} open${overdueTasks.length ? ` (${overdueTasks.length} overdue)` : ''}. Make today count.`
        : `Clean slate, ${firstName}. Set a goal or plan your week.`;
    }
  }
}

async function refreshHomeBrief() {
  if (!S.sid) return;
  const today8601 = new Date().toISOString().split('T')[0];
  const briefKey  = `sivarr_brief_${S.sid}_${today8601}`;
  localStorage.removeItem(briefKey);

  const briefMsg = $('home-brief-msg');
  if (briefMsg) briefMsg.innerHTML = `<span class="brief-pulse">Refreshing…</span>`;

  const tasks  = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]');
  const goals  = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]');
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  const jnl    = JSON.parse(localStorage.getItem(JNL_KEY()) || '[]');
  const events = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');

  await _fetchHomeBrief({
    openTasks:   tasks.filter(t => !t.done),
    activeGoals: goals.filter(g => !g.completed),
    habits, jnl, events, today8601,
    streak: _getActivityStreak(),
    briefKey, briefMsg,
  });
}

function homeHabitToggle(idx) {
  if (!S.sid) return;
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  if (!habits[idx]) return;
  const today = new Date().toISOString().split('T')[0];
  habits[idx].completions = habits[idx].completions || [];
  if (habits[idx].completions.includes(today)) {
    habits[idx].completions = habits[idx].completions.filter(d => d !== today);
    habits[idx].streak = Math.max(0, (habits[idx].streak || 0) - 1);
  } else {
    habits[idx].completions.push(today);
    habits[idx].streak = (habits[idx].streak || 0) + 1;
    _recordActivity();
  }
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  loadHome();
}

// ════════════ CALENDAR ════════════
let CAL_YEAR = new Date().getFullYear();
let CAL_MONTH = new Date().getMonth();
let CAL_VIEW = 'month';   // 'month' | 'week' | 'day'
let CAL_WEEK_START = null; // Date (Monday of current week view)
let CAL_DAY_DATE   = null; // Date string for day view
let CAL_EVENTS_KEY = () => `sivarr_cal_${S.sid||'guest'}`;

function calInit() {
  _calRenderViewBtns();
  calRender();
}

function _calRenderViewBtns() {
  const hdr = document.querySelector('.cal-header');
  if (!hdr || $('cal-view-btns')) return;
  const wrap = document.createElement('div');
  wrap.id = 'cal-view-btns';
  wrap.style.cssText = 'display:flex;gap:4px;margin-left:auto';
  ['Month','Week','Day'].forEach(v => {
    const b = document.createElement('button');
    b.textContent = v;
    b.className = 'cal-nav-btn' + (v.toLowerCase() === CAL_VIEW ? ' active' : '');
    b.style.cssText = 'font-size:.78rem;padding:4px 10px';
    b.onclick = () => { CAL_VIEW = v.toLowerCase(); _calRenderViewBtns(); calRender(); };
    wrap.appendChild(b);
  });
  hdr.appendChild(wrap);
}

function calNav(dir) {
  if (CAL_VIEW === 'week') {
    const base = CAL_WEEK_START || _getWeekStart(new Date());
    CAL_WEEK_START = new Date(base.getTime() + dir * 7 * 86400000);
    calRender(); return;
  }
  if (CAL_VIEW === 'day') {
    const base = CAL_DAY_DATE ? new Date(CAL_DAY_DATE + 'T12:00:00') : new Date();
    base.setDate(base.getDate() + dir);
    CAL_DAY_DATE = base.toISOString().split('T')[0];
    calRender(); return;
  }
  CAL_MONTH += dir;
  if (CAL_MONTH > 11) { CAL_MONTH = 0; CAL_YEAR++; }
  if (CAL_MONTH < 0)  { CAL_MONTH = 11; CAL_YEAR--; }
  calRender();
}

function _getWeekStart(d) {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // move to Monday
  const m = new Date(d); m.setDate(d.getDate() + diff); m.setHours(0,0,0,0);
  return m;
}

function _calRenderWeek() {
  const start = CAL_WEEK_START || _getWeekStart(new Date());
  CAL_WEEK_START = start;
  const lbl = $('cal-month-label');
  const endD = new Date(start.getTime() + 6 * 86400000);
  if (lbl) lbl.textContent = `${start.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${endD.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`;

  const events = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    days.push(d);
  }
  const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = new Date().toISOString().split('T')[0];

  let html = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:10px;flex:1;overflow:auto">`;
  days.forEach((d, i) => {
    const ds = d.toISOString().split('T')[0];
    const isToday = ds === today;
    const dayEvs = events.filter(e => e.date === ds);
    html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px;min-height:100px;cursor:pointer${isToday?' border-color:var(--teal)':''}" onclick="calSelectDay('${ds}',${d.getDate()})">
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:4px">${DAYS[i]}</div>
      <div style="font-weight:700;font-size:.9rem;${isToday ? 'color:var(--teal)' : ''}">${d.getDate()}</div>
      ${dayEvs.slice(0,3).map(e => `<div style="margin-top:4px;padding:2px 6px;border-radius:4px;background:${e.color||'var(--teal)'}22;color:${e.color||'var(--teal)'};font-size:.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer" onclick="event.stopPropagation();calEditEvent('${e.id}')">${esc(e.title)}</div>`).join('')}
      ${dayEvs.length > 3 ? `<div style="font-size:.68rem;color:var(--muted);margin-top:2px">+${dayEvs.length - 3} more</div>` : ''}
    </div>`;
  });
  html += '</div>';

  const grid = $('cal-grid');
  if (grid) { grid.style.display = 'none'; }
  let weekView = $('cal-week-view');
  if (!weekView) {
    weekView = document.createElement('div');
    weekView.id = 'cal-week-view';
    weekView.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden';
    grid.parentElement.insertBefore(weekView, grid.nextSibling);
  }
  weekView.style.display = 'flex';
  weekView.innerHTML = html;
  const dayView = $('cal-day-view'); if (dayView) dayView.style.display = 'none';
}

function _calRenderDay() {
  const ds = CAL_DAY_DATE || new Date().toISOString().split('T')[0];
  CAL_DAY_DATE = ds;
  const lbl = $('cal-month-label');
  if (lbl) lbl.textContent = new Date(ds + 'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  const events = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]').filter(e => e.date === ds);
  let html = `<div style="flex:1;overflow:auto;padding:10px">`;
  for (let hr = 6; hr <= 23; hr++) {
    const label = hr < 12 ? `${hr}:00 AM` : hr === 12 ? '12:00 PM' : `${hr-12}:00 PM`;
    const hrEvs = events.filter(e => {
      const t = (e.time || '').slice(0,2);
      return parseInt(t, 10) === hr;
    });
    html += `<div style="display:flex;gap:8px;min-height:52px;border-bottom:1px solid var(--border);padding:6px 0">
      <div style="width:56px;font-size:.72rem;color:var(--muted);flex-shrink:0;padding-top:2px">${label}</div>
      <div style="flex:1;display:flex;flex-direction:column;gap:3px">
        ${hrEvs.map(e => `<div style="padding:4px 8px;border-radius:6px;background:${e.color||'var(--teal)'}22;color:${e.color||'var(--teal)'};font-size:.8rem;cursor:pointer" onclick="calEditEvent('${e.id}')">${esc(e.title)}</div>`).join('')}
      </div>
    </div>`;
  }
  html += '</div>';

  const grid = $('cal-grid'); if (grid) grid.style.display = 'none';
  const weekView = $('cal-week-view'); if (weekView) weekView.style.display = 'none';
  let dayView = $('cal-day-view');
  if (!dayView) {
    dayView = document.createElement('div');
    dayView.id = 'cal-day-view';
    dayView.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden';
    grid.parentElement.insertBefore(dayView, grid.nextSibling);
  }
  dayView.style.display = 'flex';
  dayView.innerHTML = html;
}

function calRender() {
  // Update view-button active states
  document.querySelectorAll('#cal-view-btns button').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase() === CAL_VIEW);
  });
  if (CAL_VIEW === 'week') { _calRenderWeek(); return; }
  if (CAL_VIEW === 'day')  { _calRenderDay();  return; }

  // Month view — restore grid, hide alternate views
  const weekView = $('cal-week-view'); if (weekView) weekView.style.display = 'none';
  const dayView  = $('cal-day-view');  if (dayView)  dayView.style.display  = 'none';

  const lbl = $('cal-month-label');
  if (lbl) lbl.textContent = new Date(CAL_YEAR, CAL_MONTH, 1)
    .toLocaleDateString('en-GB', { month:'long', year:'numeric' });

  const grid = $('cal-grid');
  if (!grid) return;
  grid.style.display = '';

  const headers = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    .map(d => `<div class="cal-dh">${d}</div>`).join('');

  const firstDay = new Date(CAL_YEAR, CAL_MONTH, 1).getDay();
  const daysInMonth = new Date(CAL_YEAR, CAL_MONTH + 1, 0).getDate();
  const today = new Date();
  const events   = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');
  const shTasks  = (getSHData().tasks || []).filter(t => t.date && t.status !== 'done');

  let cells = '';
  for (let i = 0; i < firstDay; i++) {
    const prevD = new Date(CAL_YEAR, CAL_MONTH, -firstDay + i + 1).getDate();
    cells += `<div class="cal-cell other-month"><div class="cal-num">${prevD}</div></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && CAL_MONTH === today.getMonth() && CAL_YEAR === today.getFullYear();
    const dateStr = `${CAL_YEAR}-${String(CAL_MONTH+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasEv   = events.some(e => e.date === dateStr);
    const hasTask = shTasks.some(t => t.date === dateStr);
    cells += `<div class="cal-cell${isToday?' today':''}" onclick="calSelectDay('${dateStr}',${d})">
      <div class="cal-num">${d}</div>
      <div style="display:flex;gap:3px;justify-content:center;margin-top:2px">
        ${hasEv   ? '<div class="cal-ev"></div>' : ''}
        ${hasTask ? '<div class="cal-ev" style="background:var(--amber3,#f59e0b)"></div>' : ''}
      </div>
    </div>`;
  }
  grid.innerHTML = headers + cells;
}

function calSelectDay(dateStr, d) {
  const lbl = $('cal-day-label');
  if (lbl) lbl.textContent = new Date(dateStr+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

  const events  = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]').filter(e => e.date === dateStr);
  const shTasks = (getSHData().tasks || []).filter(t => t.date === dateStr && t.status !== 'done');
  const list    = $('cal-events-list');
  if (!list) return;

  const evHTML = events.map(e => `
    <div class="ev-row" style="cursor:pointer" onclick="calEditEvent('${e.id}')">
      <div class="ev-time">${esc(e.time||'All day')}</div>
      <div class="ev-dot" style="background:${e.color||'var(--teal)'}"></div>
      <div class="ev-info">
        <div class="ev-name">${esc(e.title)}</div>
        ${e.desc ? `<div class="ev-sub">${esc(e.desc)}</div>` : ''}
      </div>
      <button onclick="event.stopPropagation();calDeleteEvent('${e.id}')" style="background:none;border:none;color:var(--text4);cursor:pointer;font-size:13px;padding:2px 6px" title="Delete">×</button>
    </div>`).join('');

  const taskHTML = shTasks.map(t => `
    <div class="ev-row">
      <div class="ev-time">${esc(t.time||'Task')}</div>
      <div class="ev-dot" style="background:var(--amber3,#f59e0b)"></div>
      <div class="ev-info">
        <div class="ev-name">${esc(t.title)}</div>
        ${t.type ? `<div class="ev-sub">${esc(t.type)}</div>` : ''}
      </div>
      <span style="font-size:.7rem;color:var(--amber3,#f59e0b);padding:2px 6px">${t.priority||''}</span>
    </div>`).join('');

  if (!evHTML && !taskHTML) {
    list.innerHTML = `<div class="ev-row"><div class="ev-time">—</div><div class="ev-dot" style="background:var(--text4)"></div><div class="ev-info"><div class="ev-name">No events</div><div class="ev-sub">Click + Event to add one</div></div></div>`;
    return;
  }
  list.innerHTML = evHTML + taskHTML;
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

async function calEditEvent(id) {
  const evs = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');
  const ev  = evs.find(e => e.id === id);
  if (!ev) return;
  document.getElementById('cal-edit-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'cal-edit-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
  const COLORS = [
    { label:'Teal',    val:'var(--teal)' },
    { label:'Purple',  val:'var(--purple)' },
    { label:'Red',     val:'var(--coral,#ef4444)' },
    { label:'Amber',   val:'var(--amber3,#f59e0b)' },
  ];
  const swatches = COLORS.map((c, i) => {
    const sel = ev.color === c.val;
    return `<div data-color="${c.val}" onclick="this.parentNode.querySelectorAll('[data-color]').forEach(x=>x.style.outline='none');this.style.outline='2px solid var(--teal)'" style="width:22px;height:22px;border-radius:50%;background:${c.val};cursor:pointer;${sel?'outline:2px solid var(--teal)':''}" title="${c.label}"></div>`;
  }).join('');
  modal.innerHTML = `
    <div style="background:var(--bg);border-radius:14px;padding:22px;width:min(380px,95vw);position:relative">
      <button onclick="document.getElementById('cal-edit-modal').remove()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer">×</button>
      <div style="font-weight:700;margin-bottom:16px">Edit Event</div>
      <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:4px">Title</label>
      <input id="cal-edit-title" value="${esc(ev.title)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--fg);font-family:var(--font);margin-bottom:12px;box-sizing:border-box">
      <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:4px">Date</label>
      <input id="cal-edit-date" type="date" value="${esc(ev.date)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--fg);font-family:var(--font);margin-bottom:12px;box-sizing:border-box">
      <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:4px">Time</label>
      <input id="cal-edit-time" type="text" value="${esc(ev.time||'')}" placeholder="e.g. 09:00" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--fg);font-family:var(--font);margin-bottom:14px;box-sizing:border-box">
      <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:6px">Colour</label>
      <div id="cal-edit-colors" style="display:flex;gap:8px;margin-bottom:16px">${swatches}</div>
      <div style="display:flex;justify-content:space-between;gap:8px">
        <button onclick="calDeleteEventFromEdit('${id}')" style="background:var(--red,#ef4444);color:#fff;border:none;border-radius:8px;padding:9px 14px;cursor:pointer;font-family:var(--font);font-size:.85rem">Delete</button>
        <button onclick="calSaveEditEvent('${id}')" style="background:var(--teal);color:#fff;border:none;border-radius:8px;padding:9px 18px;cursor:pointer;font-family:var(--font);font-size:.85rem;font-weight:600">Save</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

function calSaveEditEvent(id) {
  const evs   = JSON.parse(localStorage.getItem(CAL_EVENTS_KEY()) || '[]');
  const idx   = evs.findIndex(e => e.id === id);
  if (idx < 0) return;
  const title = $('cal-edit-title')?.value.trim();
  const date  = $('cal-edit-date')?.value;
  const time  = $('cal-edit-time')?.value.trim();
  const selectedSwatch = document.querySelector('#cal-edit-colors [data-color][style*="outline: 2px"]') ||
                         document.querySelector('#cal-edit-colors [data-color][style*="outline:2px"]');
  const color = selectedSwatch?.dataset.color || evs[idx].color;
  if (!title || !date) { toast('Title and date are required.'); return; }
  evs[idx] = { ...evs[idx], title, date, time, color };
  localStorage.setItem(CAL_EVENTS_KEY(), JSON.stringify(evs));
  document.getElementById('cal-edit-modal')?.remove();
  calRender();
  calSelectDay(date);
  toast('Event updated ✓');
}

function calDeleteEventFromEdit(id) {
  document.getElementById('cal-edit-modal')?.remove();
  calDeleteEvent(id);
}

// ════════════ HABITS ════════════
const HAB_KEY = () => `sivarr_habits_${S.sid||'guest'}`;

function _habFreqLabel(freq) {
  return ({daily:'Every day',weekdays:'Weekdays (M–F)',weekends:'Weekends',weekly:'Once a week'})[freq] || 'Every day';
}

function _habHeatmap(h) {
  const today = new Date();
  const cells = [];
  for (let d = 27; d >= 0; d--) {
    const dt = new Date(); dt.setDate(today.getDate() - d);
    const ds = dt.toISOString().split('T')[0];
    const done = (h.completions||[]).includes(ds);
    cells.push(`<div class="hm-cell${done?' done':''}" title="${ds}"></div>`);
  }
  return `<div class="hab-heatmap-grid">${cells.join('')}</div>`;
}

function habitInit() {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  const today  = new Date().toISOString().split('T')[0];

  // Stats
  const bestEver  = habits.reduce((m, h) => Math.max(m, h.best_streak||h.streak||0), 0);
  const doneToday = habits.filter(h => (h.completions||[]).includes(today)).length;
  const hs = $('hab-streak'); if (hs) hs.textContent = bestEver;
  const dt = $('hab-today'); if (dt) dt.textContent = `${doneToday}/${habits.length}`;
  // 28-day rate
  if (habits.length) {
    const dateRange = [];
    for (let d = 27; d >= 0; d--) {
      const dt2 = new Date(); dt2.setDate(dt2.getDate()-d);
      dateRange.push(dt2.toISOString().split('T')[0]);
    }
    const totalPossible = habits.length * 28;
    const totalDone = habits.reduce((s, h) => s + dateRange.filter(ds => (h.completions||[]).includes(ds)).length, 0);
    const rate = Math.round((totalDone / totalPossible) * 100);
    const rEl = $('hab-rate'); if (rEl) rEl.textContent = `${rate}%`;
  }

  const list = $('habits-list');
  if (!list) return;
  if (!habits.length) {
    list.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;padding:2.5rem 1rem;gap:10px;color:var(--muted)">
      <div style="font-size:2rem">🔥</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--text)">No habits yet</div>
      <div style="font-size:.82rem;text-align:center;max-width:280px">Build consistency by tracking daily habits. Click <strong>+ Habit</strong> to get started.</div>
    </div>`;
    return;
  }

  list.innerHTML = habits.map((h, i) => {
    const isToday = (h.completions||[]).includes(today);
    const streak  = h.streak || 0;
    const best    = Math.max(h.best_streak||0, streak);
    return `
    <div class="habit-card">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="habit-cb ${isToday ? 'done' : ''}" onclick="habitToggle(${i})" title="${isToday?'Mark undone':'Mark done today'}">${isToday ? '✓' : ''}</button>
        <div class="habit-emoji">${h.emoji||'📌'}</div>
        <div class="habit-info" style="flex:1;min-width:0">
          <div class="habit-title">${esc(h.title)}</div>
          <div class="habit-sub2">${_habFreqLabel(h.freq)} · 🔥 ${streak}${best > streak ? ` · best: ${best}` : ''}</div>
        </div>
        <div class="hab-card-actions">
          <button class="habit-action-btn" onclick="habitEdit(${i})" title="Edit"><i class="ti ti-pencil"></i></button>
          <button class="habit-action-btn" onclick="habitDelete(${i})" title="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      ${_habHeatmap(h)}
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
    habits[idx].best_streak = Math.max(habits[idx].best_streak||0, habits[idx].streak);
  }
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  _recordActivity();
  habitInit();
}

async function habitAdd() {
  const emojis = ['📚','🧘','🏃','💧','🥗','✍️','🎯','🛌','🔔','💡'];
  const d = await siModal.form('Add Habit', [
    { id:'title', label:'Habit name', placeholder:'e.g. Morning Study', required:true },
    { id:'emoji', label:'Pick an emoji', type:'emoji',
      options: emojis, default: emojis[Math.floor(Math.random()*emojis.length)] },
    { id:'freq', label:'Frequency', type:'select', options:[
      {value:'daily',    label:'Every day'},
      {value:'weekdays', label:'Weekdays (Mon–Fri)'},
      {value:'weekends', label:'Weekends'},
      {value:'weekly',   label:'Once a week'},
    ], default:'daily' },
  ], { confirmLabel:'Add Habit' });
  if (!d || !d.title) return;
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  habits.push({ id: Date.now().toString(), title: d.title, emoji: d.emoji||'📌',
    freq: d.freq||'daily', completions: [], streak: 0, best_streak: 0 });
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  habitInit();
  toast('Habit added ✓');
}

async function habitEdit(idx) {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  const h = habits[idx]; if (!h) return;
  const emojis = ['📚','🧘','🏃','💧','🥗','✍️','🎯','🛌','🔔','💡'];
  const d = await siModal.form('Edit Habit', [
    { id:'title', label:'Habit name', placeholder:'e.g. Morning Study', required:true, default: h.title },
    { id:'emoji', label:'Pick an emoji', type:'emoji', options: emojis, default: h.emoji||'📌' },
    { id:'freq', label:'Frequency', type:'select', options:[
      {value:'daily',    label:'Every day'},
      {value:'weekdays', label:'Weekdays (Mon–Fri)'},
      {value:'weekends', label:'Weekends'},
      {value:'weekly',   label:'Once a week'},
    ], default: h.freq||'daily' },
  ], { confirmLabel:'Save' });
  if (!d || !d.title) return;
  habits[idx].title = d.title;
  habits[idx].emoji = d.emoji || h.emoji || '📌';
  habits[idx].freq  = d.freq  || 'daily';
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  habitInit();
  toast('Habit updated ✓');
}

async function habitDelete(idx) {
  const habits = JSON.parse(localStorage.getItem(HAB_KEY()) || '[]');
  const h = habits[idx]; if (!h) return;
  if (!await siModal.confirm(`Delete "${h.title}"? All completion history will be lost.`,
    { title:'Delete Habit', confirmLabel:'Delete', danger:true })) return;
  habits.splice(idx, 1);
  localStorage.setItem(HAB_KEY(), JSON.stringify(habits));
  _syncHabitsToServer(habits);
  habitInit();
  toast('Habit deleted');
}

// ════════════ JOURNAL ════════════
const JNL_KEY = () => `sivarr_journal_${S.sid||'guest'}`;

const JNL_PROMPTS = [
  "What's one decision you made this week you'd make differently?",
  "What's something you've been avoiding that needs your attention?",
  "Describe a moment today where you felt fully present.",
  "What would you do this week if you weren't afraid of failing?",
  "What's one thing you learned today that surprised you?",
  "Who made a positive impact on you recently, and have you told them?",
  "What does success look like for you one year from now?",
  "What habit is quietly holding you back?",
  "What are you most grateful for right now?",
  "What's one thing you want to stop doing? One thing to start?",
  "Describe your energy level today. What drained you? What filled you?",
  "What problem have you been overthinking that needs a decision, not more thought?",
  "What did you build, create, or contribute today?",
  "If today was the only evidence someone had of who you are, what would it say?",
  "What's been on your mind that you haven't written down yet?",
  "Where did you spend the most focus today? Was it worth it?",
  "What's one conversation you need to have that you've been putting off?",
  "What's working well right now that you should protect?",
  "Name one thing you're proud of this week, however small.",
  "What boundary did you hold or fail to hold today?",
  "How has your thinking on a big goal shifted recently?",
  "What would you tell yourself 3 months ago?",
  "What's one thing you want to remember about today?",
  "Where are you being too hard on yourself?",
  "What would make next week significantly better than this one?",
  "Describe your ideal version of tomorrow.",
  "What are you currently building, and why does it matter to you?",
  "What's one relationship you want to invest more in?",
  "What does your gut say about a decision you're facing?",
  "What's the most important thing you didn't do today, and why?",
];

function journalInit() {
  const lbl = $('journal-date-label');
  if (lbl) lbl.textContent = new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

  // Load today's draft
  const todayKey = `jnl_draft_${new Date().toISOString().split('T')[0]}`;
  const draft = localStorage.getItem(`${JNL_KEY()}_${todayKey}`) || '';
  const ta = $('journal-text'); if (ta) ta.value = draft;

  // Daily prompt — fetch from API for server-consistent rotation, fall back to local
  const prompt2 = document.querySelector('.journal-prompt');
  if (prompt2) {
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const localPrompt = JNL_PROMPTS[dayOfYear % JNL_PROMPTS.length];
    prompt2.innerHTML = `<strong>Today's prompt:</strong> ${localPrompt}`;
    fetch('/api/journal/prompt').then(r => r.json()).then(d => {
      if (d.prompt) prompt2.innerHTML = `<strong>Today's prompt:</strong> ${d.prompt}`;
    }).catch(() => {});
  }

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
  _syncJournalToServer(entries);
  journalRenderEntries();
  _saveStatus('saved');
  _recordActivity();
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
  list.innerHTML = entries.map((e, i) => `
    <div class="journal-entry">
      <div class="je-date">${e.mood} ${new Date(e.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</div>
      <div class="je-text">${esc(e.text)}</div>
      <button onclick="reflectWithAI(${i})" style="margin-top:8px;background:none;border:1px solid var(--border);border-radius:7px;padding:5px 12px;color:var(--teal);font-size:.75rem;font-weight:600;cursor:pointer;font-family:var(--font)">✨ Reflect with AI</button>
    </div>`).join('');
}

function reflectWithAI(idx) {
  const entries = JSON.parse(localStorage.getItem(JNL_KEY()) || '[]');
  const e = entries[idx];
  if (!e) return;
  const prompt = `Here's my journal entry from ${e.date}:\n\n"${e.text}"\n\nReflect on this with me. What patterns do you notice? What should I pay attention to?`;
  nav('chat', null);
  setTimeout(() => {
    const ci = $('ci');
    if (ci) { ci.value = prompt; ci.focus(); }
  }, 300);
}

// ════════════ PHASE 3 — ADVANCED AI ════════════

async function aiTaskExtractor() {
  const text = await siModal.input(
    '✨ Extract Tasks with AI',
    'Paste an email, note, or message — Sivarr will pull out the tasks.',
    '',
    { confirmLabel: 'Extract', type: 'text' }
  );
  if (!text?.trim()) return;
  toast('Extracting tasks…');
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch('/api/ai/extract-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, text: text.trim() }),
    });
    const d = await r.json();
    if (!d.tasks || d.tasks.length === 0) {
      toast('No tasks found in that text.');
      return;
    }
    _aiShowExtractedTasks(d.tasks);
  } catch(_) { toast('AI extraction failed. Try again.'); }
}

function _aiShowExtractedTasks(tasks) {
  const checked = tasks.map((_, i) => i);
  const html = `
    <div class="si-modal-hd">
      <span class="si-modal-title">✨ ${tasks.length} task${tasks.length>1?'s':''} found</span>
      <button class="si-modal-x" onclick="siModal._done(null)"><i class="ti ti-x"></i></button>
    </div>
    <div class="si-modal-body" style="max-height:320px;overflow-y:auto">
      ${tasks.map((t,i) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
          <input type="checkbox" id="ait-${i}" checked style="margin-top:2px;accent-color:var(--accent);width:15px;height:15px;flex-shrink:0">
          <div>
            <div style="font-size:.85rem;font-weight:600">${esc(t.title)}</div>
            <div style="font-size:.72rem;color:var(--muted);margin-top:2px">
              ${t.priority ? `<span style="color:${t.priority==='high'?'var(--red,#ef4444)':t.priority==='medium'?'var(--amber,#f59e0b)':'var(--muted)'}">● ${t.priority}</span>` : ''}
              ${t.due ? ` · Due ${t.due}` : ''}
            </div>
          </div>
        </label>`).join('')}
    </div>
    <div class="si-modal-ft">
      <button class="si-modal-btn si-modal-btn-cancel" onclick="siModal._done(null)">Cancel</button>
      <button class="si-modal-btn si-modal-btn-primary" onclick="siModal._done('ok')">Add selected tasks</button>
    </div>`;
  siModal._show_raw(html).then(result => {
    if (!result) return;
    tasks.forEach((t, i) => {
      const cb = document.getElementById(`ait-${i}`);
      if (!cb || !cb.checked) return;
      _aiAddTask(t);
    });
    toast(`Tasks added ✓`);
  });
}

function _aiAddTask(t) {
  const key   = `sivarr_tasks_${S.sid}`;
  const tasks = JSON.parse(localStorage.getItem(key) || '[]');
  tasks.push({
    id:       `t_ai_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    title:    t.title,
    priority: t.priority || 'medium',
    due:      t.due || '',
    done:     false,
    created:  new Date().toISOString(),
    tags:     [],
  });
  localStorage.setItem(key, JSON.stringify(tasks));
}

async function aiWriteAssist() {
  const vals = await siModal.form('✍️ AI Writing Assistant', [
    { id:'text',   label:'Your text',  type:'textarea', placeholder:'Paste or type the text you want to improve…', required:true },
    { id:'action', label:'What to do', type:'select', options:[
        {label:'Improve clarity & flow', value:'improve'},
        {label:'Shorten',                value:'shorten'},
        {label:'Expand with detail',     value:'expand'},
        {label:'Make formal',            value:'formal'},
        {label:'Make casual',            value:'casual'},
        {label:'Convert to bullets',     value:'bullets'},
        {label:'Rewrite as email',       value:'email'},
        {label:'Summarise',              value:'summarise'},
      ], default:'improve' },
  ], { confirmLabel: 'Rewrite' });
  if (!vals?.text?.trim()) return;
  toast('Rewriting…');
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch('/api/ai/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, text: vals.text.trim(), action: vals.action || 'improve' }),
    });
    const d = await r.json();
    if (d.result) {
      _aiShowWriteResult(d.result);
    } else {
      toast(d.detail || 'AI unavailable. Try again.');
    }
  } catch(_) { toast('Writing assistant failed. Try again.'); }
}

function _aiShowWriteResult(result) {
  siModal._show_raw(`
    <div class="si-modal-hd">
      <span class="si-modal-title">✍️ AI Result</span>
      <button class="si-modal-x" onclick="siModal._done(null)"><i class="ti ti-x"></i></button>
    </div>
    <div class="si-modal-body">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:.85rem;line-height:1.65;color:var(--text1);white-space:pre-wrap;max-height:300px;overflow-y:auto">${esc(result)}</div>
    </div>
    <div class="si-modal-ft">
      <button class="si-modal-btn si-modal-btn-cancel" onclick="siModal._done(null)">Close</button>
      <button class="si-modal-btn si-modal-btn-primary" onclick="_aiCopyResult(${JSON.stringify(result)})">Copy text</button>
    </div>`);
}

function _aiCopyResult(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied ✓'));
}

// ════════════ COMMUNITY ════════════
let _commCategory = 'all';
let _oppCategory  = 'all';

function commSetMode(mode, btn) {
  document.querySelectorAll('.comm-mode-btn').forEach(b => {
    b.classList.remove('active');
    b.style.background = 'transparent';
    b.style.color       = 'var(--muted)';
    b.style.boxShadow   = 'none';
  });
  btn.classList.add('active');
  btn.style.background  = 'var(--card)';
  btn.style.color        = 'var(--text1)';
  btn.style.boxShadow    = '0 1px 3px #0002';
  const isFeed = mode === 'feed';
  const fv = $('comm-view-feed'); if (fv) fv.style.display = isFeed ? '' : 'none';
  const ov = $('comm-view-opp');  if (ov) ov.style.display = isFeed ? 'none' : '';
  const postBtn = document.querySelector('#comm-actions button:first-child');
  const oppBtn  = $('comm-opp-btn');
  if (postBtn) postBtn.style.display = isFeed ? '' : 'none';
  if (oppBtn)  oppBtn.style.display  = isFeed ? 'none' : '';
  if (!isFeed) commLoadOpportunities();
}

async function communityInit() {
  await commLoadFeed();
}

async function commLoadFeed(category) {
  if (category) _commCategory = category;
  const feed = $('community-feed');
  if (!feed) return;
  feed.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Loading…</div>';
  try {
    const r = await fetch(`/api/community/posts?category=${_commCategory}&limit=40`);
    const d = await r.json();
    if (!d.posts || d.posts.length === 0) {
      feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">No posts yet. Be the first to share!</div>';
      return;
    }
    feed.innerHTML = d.posts.map(p => _commRenderPost(p)).join('');
  } catch(_) {
    feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Could not load posts.</div>';
  }
}

function _commRenderPost(p) {
  const ago    = _timeAgo(p.created);
  const likes  = (p.likes || []).length;
  const reps   = (p.replies || []).length;
  const liked  = (p.likes || []).includes(S.sid || '');
  const initials = (p.author || 'U')[0].toUpperCase();
  const tags   = (p.tags || []).map(t => `<span class="feed-tag">${esc(t)}</span>`).join('');
  const replies = (p.replies || []).slice(-3).map(r => `
    <div style="margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:8px;font-size:.78rem">
      <span style="font-weight:600">${esc(r.author)}</span>
      <span style="color:var(--muted);margin-left:6px;font-size:.7rem">${_timeAgo(r.created)}</span>
      <div style="margin-top:4px;color:var(--text2)">${esc(r.body)}</div>
    </div>`).join('');
  return `
    <div class="feed-card" data-id="${esc(p.id)}">
      <div class="feed-hd">
        <div class="feed-av">${initials}</div>
        <div style="flex:1">
          <div class="feed-name">${esc(p.author)}</div>
          <div class="feed-time">${ago}</div>
        </div>
        ${p.category && p.category !== 'general' ? `<span class="feat-badge">${esc(p.category)}</span>` : ''}
      </div>
      <div class="feed-body">${esc(p.body)}</div>
      ${tags ? `<div class="feed-tags">${tags}</div>` : ''}
      ${replies}
      <div class="feed-actions">
        <button class="feed-action-btn ${liked?'liked':''}" onclick="commLike('${esc(p.id)}',this)">
          <i class="ti ti-heart${liked?' ti-heart-filled':''}"></i> <span>${likes}</span>
        </button>
        <button class="feed-action-btn" onclick="commReply('${esc(p.id)}',this)">
          <i class="ti ti-message"></i> <span>${reps}</span>
        </button>
      </div>
    </div>`;
}

function _timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

async function communityPost() {
  const body = await siModal.input('Share with Community', 'What\'s on your mind?', '', { confirmLabel:'Post' });
  if (!body?.trim()) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch('/api/community/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, body: body.trim(), category: _commCategory === 'all' ? 'general' : _commCategory }),
    });
    const d = await r.json();
    if (d.ok) {
      toast('Post shared ✓');
      commLoadFeed();
    }
  } catch(_) { toast('Could not post. Try again.'); }
}

async function commLike(postId, btn) {
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/community/posts/${postId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    if (d.ok) {
      const span = btn.querySelector('span');
      if (span) span.textContent = d.count;
      const icon = btn.querySelector('i');
      if (icon) icon.className = `ti ti-heart${d.liked?' ti-heart-filled':''}`;
    }
  } catch(_) {}
}

async function commReply(postId, btn) {
  const body = await siModal.input('Reply', 'Write your reply…', '', { confirmLabel:'Reply' });
  if (!body?.trim()) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/community/posts/${postId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, body: body.trim() }),
    });
    const d = await r.json();
    if (d.ok) {
      toast('Reply added ✓');
      commLoadFeed();
    }
  } catch(_) { toast('Could not reply.'); }
}

function commFilter(cat, btn) {
  document.querySelectorAll('[id^="comm-tab-"]').forEach(b => b.classList.remove('sp-add'));
  if (btn) btn.classList.add('sp-add');
  commLoadFeed(cat);
}

// ════════════ OPPORTUNITIES ════════════
async function commLoadOpportunities(category) {
  if (category) _oppCategory = category;
  const feed = $('opp-feed');
  if (!feed) return;
  feed.innerHTML = '<div style="text-align:center;padding:32px;color:var(--muted)">Loading…</div>';
  try {
    const r = await fetch(`/api/opportunities?category=${_oppCategory}&limit=50`);
    const d = await r.json();
    if (!d.opportunities || d.opportunities.length === 0) {
      feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">No opportunities listed yet. Add the first one!</div>';
      return;
    }
    feed.innerHTML = d.opportunities.map(o => `
      <div class="feed-card" style="cursor:default">
        <div class="feed-hd">
          <div class="feed-av" style="background:var(--accent2,#7c3aed)">🎯</div>
          <div style="flex:1">
            <div class="feed-name">${esc(o.title)}</div>
            <div class="feed-time">${esc(o.author)} · ${_timeAgo(o.created)}</div>
          </div>
          <span class="feat-badge" style="background:var(--accent2,#7c3aed)22;color:var(--accent2,#7c3aed)">${esc(o.category)}</span>
        </div>
        ${o.desc ? `<div class="feed-body">${esc(o.desc)}</div>` : ''}
        ${o.deadline ? `<div style="font-size:.75rem;color:var(--muted);margin:6px 0">⏰ Deadline: ${esc(o.deadline)}</div>` : ''}
        ${o.link ? `<a href="${esc(o.link)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;font-size:.78rem;font-weight:700;color:var(--accent);text-decoration:none">Apply / Learn more →</a>` : ''}
      </div>`).join('');
  } catch(_) {
    feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Could not load opportunities.</div>';
  }
}

function oppFilter(cat, btn) {
  document.querySelectorAll('[id^="opp-tab-"]').forEach(b => b.classList.remove('sp-add'));
  if (btn) btn.classList.add('sp-add');
  commLoadOpportunities(cat);
}

async function oppSubmit() {
  const vals = await siModal.form('Add Opportunity', [
    { id:'title',    label:'Title',    type:'text',     placeholder:'e.g. Google SWE Intern 2026', required:true },
    { id:'desc',     label:'Description', type:'textarea', placeholder:'What is this opportunity about?' },
    { id:'category', label:'Category', type:'select',   options:[
        {label:'Job',value:'job'},{label:'Internship',value:'internship'},
        {label:'Scholarship',value:'scholarship'},{label:'Grant',value:'grant'},{label:'Other',value:'other'}
      ], default:'internship' },
    { id:'deadline', label:'Deadline (optional)', type:'text', placeholder:'e.g. 2026-07-31' },
    { id:'link',     label:'Link / URL',          type:'text', placeholder:'https://…' },
  ], { confirmLabel:'Submit' });
  if (!vals?.title?.trim()) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, title: vals.title.trim(), desc: (vals.desc||'').trim(), link: (vals.link||'').trim(), category: vals.category||'other', deadline: (vals.deadline||'').trim() }),
    });
    const d = await r.json();
    if (d.ok) { toast('Opportunity added ✓'); commLoadOpportunities(); }
  } catch(_) { toast('Could not submit. Try again.'); }
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

// ── Sidebar toggle (desktop: retract/restore · mobile: open/close) ──
function toggleSidebar() {
  if (window.innerWidth <= 720) { toggleMobileSidebar(); return; }
  const sb = $('sidebar');
  if (!sb) return;
  const retracted = sb.classList.toggle('retracted');
  localStorage.setItem('sb_retracted', retracted ? '1' : '0');
}

// ── Fullscreen toggle ──────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => toast('Fullscreen not available'));
  } else {
    document.exitFullscreen();
  }
}
document.addEventListener('fullscreenchange', () => {
  const icon = $('fullscreen-icon');
  if (!icon) return;
  icon.className = document.fullscreenElement ? 'ti ti-minimize' : 'ti ti-maximize';
  const btn = document.getElementById('fullscreen-btn');
  if (btn) btn.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});

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
  flux:'work', notes:'work', calendar:'work', templates:'work', documenthub:'work',
  courses:'academic', quiz:'academic', lab:'academic',
  studyplan:'academic', pomodoro:'academic', contenthub:'academic',
  learninghub:'academic', studygroups:'academic',
  goals:'grow', habits:'grow', stats:'grow', journal:'grow', progress:'grow',
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
  _updateMobileNav(name);
  syncSnavFromPanel(name);
  _trackNav(name);

  // ── Paywall guards ──
  const _GUARDED = { org: 'Pro', orgchat: 'Pro', team: 'Pro', projects: 'Pro', founder: 'Team' };
  if (_GUARDED[name]) {
    if (!_hasPlan(_GUARDED[name])) { _showPaywall(name); return; }
    _removePaywall(name);
  }

  if (name === 'chat')      { chatCounterInit(); setTimeout(chatProactiveGreet, 400); return; }
  if (name === 'home')      { loadHome(); return; }
  if (name === 'notes')     { docInit(); return; }
  if (name === 'templates') { tplInit(); return; }
  if (name === 'calendar')  { calInit(); return; }
  if (name === 'habits')    { habitInit(); return; }
  if (name === 'journal')   { journalInit(); return; }
  if (name === 'community') { communityInit(); return; }
  if (name === 'library')   { integrationsRender(); return; }
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
  if (name === 'review')        reviewInit();
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
  const _rt = localStorage.getItem('sivarr_token') || '';
  const r = await fetch(`/api/progress?sid=${S.sid}&token=${encodeURIComponent(_rt)}`);
  const d = await r.json();
  S.topics = Object.keys(d.topics); S.weak = d.weak;
  renderTopics(S.topics, S.weak);
}

  
function toast(msg, ms=2500) {
  const el = $('toast');
  if (!el) return;
  clearTimeout(el._toastTimer);
  el.classList.remove('show');
  el.textContent = msg;
  void el.offsetWidth; // force reflow so animation replays on consecutive toasts
  el.classList.add('show');
  el._toastTimer = setTimeout(() => el.classList.remove('show'), ms);
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
let SH_DRAG     = null;
let SH_VIEW     = 'board';
let SH_ADD_COL  = 'todo';
let SH_SELECTED = null;
const SH_BULK_SEL = new Set();

function _fmtDueDate(date, time) {
  if (!date) return { label: '—', color: 'var(--muted)', overdue: false };
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(date + 'T00:00:00'); due.setHours(0,0,0,0);
  const diff  = Math.round((due - today) / 86400000);
  const t     = time ? `, ${time}` : '';
  if (diff < 0)   return { label: 'Overdue',         color: '#ef4444',       overdue: true  };
  if (diff === 0) return { label: `Today${t}`,        color: '#f59e0b',       overdue: false };
  if (diff === 1) return { label: `Tomorrow${t}`,     color: 'var(--accent)', overdue: false };
  return               { label: `${date}${t}`,        color: 'var(--text2)',  overdue: false };
}

function _shSelectTask(id) {
  SH_SELECTED = id;
  document.querySelectorAll('.sh-overview-row').forEach(r => {
    r.style.background = Number(r.dataset.id) === id ? 'var(--teal2,rgba(13,122,95,.08))' : '';
  });
}

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
  _syncTasksToServer(data.tasks || []);
}

// ── Silently mirror tasks to the server for digest + search ──
function _syncTasksToServer(tasks) {
  const token = localStorage.getItem('sivarr_token');
  if (!token || !S.sid) return;
  if (!navigator.onLine) { _queueMutation('/api/tasks/sync', { token, tasks }); return; }
  fetch('/api/tasks/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, tasks }),
  }).then(r => r.json()).then(d => {
    // If the server spawned new recurring task occurrences, merge them into localStorage
    if (d.spawned && d.spawned.length > 0) {
      const data = getSHData();
      const ids  = new Set((data.tasks || []).map(t => t.id));
      // Reload all tasks from server to get the new occurrences
      fetch(`/api/tasks/restore?token=${encodeURIComponent(token)}`).then(r2 => r2.json()).then(d2 => {
        if (d2.tasks && d2.tasks.length) {
          data.tasks = d2.tasks;
          localStorage.setItem(SH_KEY(), JSON.stringify(data));
          renderSHOverview();
          renderSHBoard();
          toast('New recurring task added ↻');
        }
      }).catch(() => {});
    }
  }).catch(() => _queueMutation('/api/tasks/sync', { token, tasks }));
}

function loadStudyHelp() {
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  const overviewBtn = $('sh-view-overview');
  setSHView('overview', overviewBtn);
  renderSHBoard();
}

// ── Filter / Sort state ───────────────────────────────────────
let _SH_FILTERS = {};
let _SH_SORT    = 'due_asc';

function shToggleFilter(e) {
  e.stopPropagation();
  const d = $('sh-filter-drop'), s = $('sh-sort-drop');
  if (s) s.style.display = 'none';
  if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
}
function shToggleSort(e) {
  e.stopPropagation();
  const d = $('sh-filter-drop'), s = $('sh-sort-drop');
  if (d) d.style.display = 'none';
  if (s) s.style.display = s.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', () => {
  const fd = $('sh-filter-drop'); if (fd) fd.style.display = 'none';
  const sd = $('sh-sort-drop');   if (sd) sd.style.display = 'none';
});

function shApplyFilters() {
  const checked = [...document.querySelectorAll('#sh-filter-drop input:checked')].map(el => el.value);
  _SH_FILTERS = {};
  checked.forEach(v => _SH_FILTERS[v] = true);
  if (SH_VIEW === 'overview') renderSHOverview();
  if (SH_VIEW === 'list')     renderSHListView();
}
function shApplySort() {
  const sel = document.querySelector('#sh-sort-drop input:checked');
  if (sel) _SH_SORT = sel.value;
  if (SH_VIEW === 'overview') renderSHOverview();
  if (SH_VIEW === 'list')     renderSHListView();
}

function _shFilterAndSort(tasks) {
  const today = new Date().toISOString().split('T')[0];
  const weekEnd = new Date(Date.now() + 6 * 86400000).toISOString().split('T')[0];
  const PRI = { high:4, medium:3, normal:2, low:1 };
  const hasF = Object.keys(_SH_FILTERS).length > 0;

  let out = hasF ? tasks.filter(t => {
    const s = t.status || (t.done ? 'done' : 'not_started');
    const p = t.priority || 'normal';
    const d = t.date || t.due_date || '';
    if (_SH_FILTERS['not_started'] || _SH_FILTERS['in_progress'] || _SH_FILTERS['done']) {
      if (!_SH_FILTERS[s]) return false;
    }
    if (_SH_FILTERS['p_high'] || _SH_FILTERS['p_medium'] || _SH_FILTERS['p_normal'] || _SH_FILTERS['p_low']) {
      if (!_SH_FILTERS[`p_${p}`]) return false;
    }
    if (_SH_FILTERS['due_overdue'] || _SH_FILTERS['due_today'] || _SH_FILTERS['due_week'] || _SH_FILTERS['due_none']) {
      if (_SH_FILTERS['due_none'] && !d) return true;
      if (_SH_FILTERS['due_overdue'] && d && d < today) return true;
      if (_SH_FILTERS['due_today']   && d === today)    return true;
      if (_SH_FILTERS['due_week']    && d > today && d <= weekEnd) return true;
      return false;
    }
    return true;
  }) : [...tasks];

  out.sort((a, b) => {
    const da = a.date || a.due_date || '';
    const db = b.date || b.due_date || '';
    const pa = PRI[a.priority || 'normal'] || 2;
    const pb = PRI[b.priority || 'normal'] || 2;
    if (_SH_SORT === 'due_asc')  return (da || '9') < (db || '9') ? -1 : 1;
    if (_SH_SORT === 'due_desc') return (da || '') > (db || '') ? -1 : 1;
    if (_SH_SORT === 'priority') return pb - pa;
    if (_SH_SORT === 'created')  return (b.id || '') > (a.id || '') ? 1 : -1;
    if (_SH_SORT === 'alpha')    return (a.title || '').localeCompare(b.title || '');
    return 0;
  });
  return out;
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
  const tasks  = _shFilterAndSort(data.tasks || []);
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
    tbody.innerHTML = `<tr><td colspan="12"><div style="display:flex;flex-direction:column;align-items:center;padding:3rem 1rem;gap:10px">
      <div style="font-size:2.2rem">✅</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--text)">No tasks yet</div>
      <div style="font-size:.82rem;color:var(--muted);text-align:center;max-width:340px;line-height:1.5">
        Capture everything you need to do. Press <kbd style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:.73rem;font-family:monospace">N</kbd> or click the button below to add your first task.
      </div>
      <button onclick="openAddTask('todo')" style="margin-top:6px;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-family:var(--font-body);font-size:.83rem;font-weight:600;cursor:pointer">+ New task</button>
    </div></td></tr>`;
    return;
  }

  // Group: top-level tasks first, subtasks indented beneath their parent
  const topLevel = tasks.filter(t => !t.parent_id);
  const childMap = {};
  tasks.filter(t => t.parent_id).forEach(t => {
    (childMap[String(t.parent_id)] = childMap[String(t.parent_id)] || []).push(t);
  });
  const ordered = [];
  topLevel.forEach(t => {
    ordered.push({ task: t, indent: false });
    (childMap[String(t.id)] || []).forEach(c => ordered.push({ task: c, indent: true }));
  });
  tasks.filter(t => t.parent_id && !topLevel.find(p => String(p.id) === String(t.parent_id)))
       .forEach(t => ordered.push({ task: t, indent: false }));

  tbody.innerHTML = ordered.map(({ task: t, indent }) => {
    const st     = STATUS[t.status]    || STATUS.todo;
    const pr     = PRIORITY[t.priority] || PRIORITY.normal;
    const ico    = TYPE_ICONS[t.type]  || '⚙️';
    const dueFmt = _fmtDueDate(t.date, t.time);
    const updated = t.updated || t.created || '—';
    const isDone  = t.status === 'done';
    const isSel   = SH_SELECTED === t.id;

    return `<tr class="sh-overview-row" data-id="${t.id}"
      style="transition:background .1s;background:${isSel ? 'var(--teal2,rgba(13,122,95,.08))' : ''};cursor:pointer"
      onclick="_shSelectTask(${t.id})"
      onmouseover="if(SH_SELECTED!==${t.id})this.style.background='var(--surface)'"
      onmouseout="this.style.background=SH_SELECTED===${t.id}?'var(--teal2,rgba(13,122,95,.08))':''">
      <td style="text-align:center;padding:4px;vertical-align:middle">
        <input type="checkbox" ${SH_BULK_SEL.has(t.id) ? 'checked' : ''}
          onclick="event.stopPropagation();_shToggleBulk(${t.id},this.checked)"
          style="cursor:pointer;accent-color:var(--accent)">
      </td>
      <td><div class="sh-cell" style="display:flex;align-items:center;gap:5px;${indent ? 'padding-left:12px' : ''}">
            ${indent ? '<span style="color:var(--border);font-size:.75rem;flex-shrink:0;margin-right:1px">↳</span>' : ''}
            <div class="sh-cell-title" style="flex:1;${isDone ? 'text-decoration:line-through;opacity:.6' : ''};cursor:pointer"
                onclick="event.stopPropagation();shOpenDetail(${t.id})">${esc(t.title)}${t.recurrence ? ' <span title="Recurring" style="color:var(--teal);font-size:.8em">↻</span>' : ''}</div>
            <button class="task-focus-btn" onclick="event.stopPropagation();focusStart(${JSON.stringify(t.title)},25)" title="Focus on this task"><i class="ti ti-player-play" style="font-size:10px"></i></button>
            <button class="task-focus-btn" onclick="event.stopPropagation();inlineEdit(${t.id},'title',this.parentElement.querySelector('.sh-cell-title'))" title="Rename task"><i class="ti ti-pencil" style="font-size:10px"></i></button>
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
      <td><div class="sh-cell editable" style="color:${isDone ? 'var(--muted)' : dueFmt.color};font-size:.78rem;font-weight:${dueFmt.overdue ? '700' : '400'}"
            onclick="inlineEditDate(${t.id},this)">${dueFmt.label}</div></td>
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
  if ($('sh-modal-recur')) $('sh-modal-recur').value = task.recurrence || '';
  _populateGoalPicker(task.goalId || '');
  const fn = $('sh-modal-file-name');
  if (fn) fn.textContent = task.attachName || 'No file chosen';
  modal.style.display = 'flex';
  setTimeout(() => $('sh-modal-title')?.focus(), 100);
}

function _populateGoalPicker(selectedId = '') {
  const sel = $('sh-modal-goal'); if (!sel) return;
  const goals = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]').filter(g => !g.completed);
  sel.innerHTML = '<option value="">— No goal —</option>' +
    goals.map(g => `<option value="${g.id}" ${String(g.id) === String(selectedId) ? 'selected' : ''}>${esc(g.title)}</option>`).join('');
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
  _populateGoalPicker('');
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

  const goalId = $('sh-modal-goal')?.value || '';
  const fields = {
    title,
    status:     $('sh-modal-status')?.value   || 'todo',
    type:       $('sh-modal-type')?.value      || 'other',
    desc:       $('sh-modal-desc')?.value.trim()     || '',
    assignee:   $('sh-modal-assignee')?.value.trim() || '',
    date:       $('sh-modal-date')?.value      || '',
    time:       $('sh-modal-time')?.value      || '',
    priority:   $('sh-modal-priority')?.value  || 'normal',
    summary:    $('sh-modal-summary')?.value.trim()  || '',
    recurrence: $('sh-modal-recur')?.value     || null,
    attachName: $('sh-modal-file')?._filename || '',
    goalId:     goalId,
    updated:    now,
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
  if (task) {
    task.status = newStatus;
    task.done   = newStatus === 'done';
    saveSHData(data);
    if (newStatus === 'done') {
      _recordActivity();
      // Auto-bump linked goal progress
      if (task.goalId && S.sid) {
        try {
          const goals = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]');
          const g = goals.find(g => String(g.id) === String(task.goalId));
          if (g && !g.completed) {
            g.progress = Math.min(100, (g.progress || 0) + 10);
            if (g.progress >= 100) g.completed = true;
            localStorage.setItem(`sivarr_goals_${S.sid}`, JSON.stringify(goals));
            toast(`🎯 ${g.title}: ${g.progress}%`);
          }
        } catch(_) {}
      }
    }
  }
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

document.addEventListener('keydown', function _shKeys(e) {
  if (!$('panel-flux')?.classList.contains('active')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ($('sh-modal-bg')?.style.display === 'flex') return;

  if (e.key === 'Escape') { shCloseDetail(); return; }
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAddTask('todo'); return; }
  if (!SH_SELECTED) return;
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); shOpenDetail(SH_SELECTED); }
  if (e.key === ' ') {
    e.preventDefault();
    const task = (getSHData().tasks || []).find(t => t.id === SH_SELECTED);
    if (task) moveSHTask(SH_SELECTED, task.status === 'done' ? 'todo' : 'done');
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    if (confirm('Delete this task?')) { deleteSHTask(SH_SELECTED); SH_SELECTED = null; shCloseDetail(); }
  }
});

// ── Bulk actions ──────────────────────────────────────────────────────────────

function _shBulkUpdateBar() {
  const bar   = $('sh-bulk-bar');
  const count = $('sh-bulk-count');
  const size  = SH_BULK_SEL.size;
  if (bar)   bar.style.display   = size > 0 ? 'flex' : 'none';
  if (count) count.textContent   = `${size} task${size !== 1 ? 's' : ''} selected`;
  const allCb = $('sh-bulk-all');
  if (allCb) {
    const total = (getSHData().tasks || []).length;
    allCb.checked       = size > 0 && size === total;
    allCb.indeterminate = size > 0 && size < total;
  }
}

function _shToggleBulk(id, checked) {
  if (checked) SH_BULK_SEL.add(id);
  else SH_BULK_SEL.delete(id);
  _shBulkUpdateBar();
}

function _shBulkSelectAll(checked) {
  const tasks = getSHData().tasks || [];
  if (checked) tasks.forEach(t => SH_BULK_SEL.add(t.id));
  else SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHOverview();
}

function _shBulkComplete() {
  if (!SH_BULK_SEL.size) return;
  const n = SH_BULK_SEL.size;
  const data = getSHData();
  (data.tasks || []).forEach(t => {
    if (SH_BULK_SEL.has(t.id)) { t.status = 'done'; t.done = true; t.updated = new Date().toLocaleDateString(); }
  });
  saveSHData(data);
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHBoard();
  toast(`✓ ${n} task${n !== 1 ? 's' : ''} completed`);
}

function _shBulkDelete() {
  if (!SH_BULK_SEL.size) return;
  const n = SH_BULK_SEL.size;
  if (!confirm(`Delete ${n} task${n !== 1 ? 's' : ''}?`)) return;
  const data = getSHData();
  data.tasks = (data.tasks || []).filter(t => !SH_BULK_SEL.has(t.id));
  saveSHData(data);
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHBoard();
  toast(`🗑 ${n} task${n !== 1 ? 's' : ''} deleted`);
}

function _shBulkPriority(p) {
  if (!p || !SH_BULK_SEL.size) return;
  const data = getSHData();
  (data.tasks || []).forEach(t => {
    if (SH_BULK_SEL.has(t.id)) { t.priority = p; t.updated = new Date().toLocaleDateString(); }
  });
  saveSHData(data);
  renderSHOverview();
  const sel = document.querySelector('#sh-bulk-bar select');
  if (sel) sel.value = '';
  toast(`Priority → ${p}`);
}

function _shBulkClear() {
  SH_BULK_SEL.clear();
  _shBulkUpdateBar();
  renderSHOverview();
}

// ── Task detail side panel ────────────────────────────────────────────────────

function shOpenDetail(id) {
  const data = getSHData();
  const task = (data.tasks || []).find(t => t.id === id);
  if (!task) return;

  const ST = {
    todo:       { label: 'Not started', color: '#94a3b8' },
    inprogress: { label: 'In progress', color: '#4f6ef7' },
    done:       { label: 'Done',        color: '#22c55e' },
  };
  const PR = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low', normal: '— Normal' };
  const dueFmt = _fmtDueDate(task.date, task.time);
  const st = ST[task.status] || ST.todo;

  $('sh-detail-body').innerHTML = `
    <div contenteditable="true" spellcheck="false"
      style="font-size:1.05rem;font-weight:700;color:var(--text);line-height:1.45;margin-bottom:16px;
             outline:none;border-radius:6px;padding:4px 6px;margin:-4px -6px"
      onblur="saveInline(${task.id},'title',this.innerText.trim())"
      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
      >${esc(task.title)}</div>

    <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:18px">
      <span style="background:${st.color}15;color:${st.color};border:1px solid ${st.color}30;
                   border-radius:6px;padding:3px 10px;font-size:.75rem;font-weight:600;cursor:pointer"
        onclick="inlineEditSelect(${task.id},'status',this)">${st.label}</span>
      <span style="background:var(--surface);border:1px solid var(--border);
                   border-radius:6px;padding:3px 10px;font-size:.75rem;font-weight:600;cursor:pointer;color:var(--text2)"
        onclick="inlineEditSelect(${task.id},'priority',this)">${PR[task.priority] || '— Normal'}</span>
      <span style="background:var(--surface);border:1px solid var(--border);
                   border-radius:6px;padding:3px 10px;font-size:.75rem;color:${dueFmt.color};font-weight:${dueFmt.overdue?'700':'500'};cursor:pointer"
        onclick="inlineEditDate(${task.id},this)">📅 ${dueFmt.label}</span>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Description</div>
      <div contenteditable="true" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
           padding:10px 12px;font-size:.84rem;color:var(--text);min-height:72px;line-height:1.6;outline:none"
        onblur="saveInline(${task.id},'desc',this.innerText.trim())">${esc(task.desc || '')}<br></div>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Notes</div>
      <div contenteditable="true" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
           padding:10px 12px;font-size:.84rem;color:var(--text);min-height:72px;line-height:1.6;outline:none"
        onblur="saveInline(${task.id},'notes',this.innerText.trim())">${esc(task.notes || '')}<br></div>
    </div>

    <div style="margin-bottom:20px;display:flex;flex-direction:column;gap:5px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Activity</div>
      ${task.created ? `<div style="font-size:.76rem;color:var(--muted)">📌 Created — ${task.created}</div>` : ''}
      ${task.updated ? `<div style="font-size:.76rem;color:var(--muted)">✏️ Updated — ${task.updated}</div>` : ''}
    </div>

    ${(() => {
      const allTasks = getSHData().tasks || [];
      const subs = allTasks.filter(c => String(c.parent_id) === String(task.id));
      const subsHTML = subs.length
        ? subs.map(s => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:7px;background:var(--surface);margin-bottom:4px">
            <input type="checkbox" ${s.status === 'done' ? 'checked' : ''}
              onchange="moveSHTask(${s.id},this.checked?'done':'todo');shOpenDetail(${task.id})"
              style="cursor:pointer;accent-color:var(--accent);flex-shrink:0">
            <span style="flex:1;font-size:.82rem;${s.status === 'done' ? 'text-decoration:line-through;opacity:.5;' : ''}">${esc(s.title)}</span>
            <button onclick="if(confirm('Delete subtask?')){deleteSHTask(${s.id});shOpenDetail(${task.id})}"
              style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.75rem;padding:2px 4px">✕</button>
          </div>`).join('')
        : `<div style="font-size:.78rem;color:var(--muted);padding:4px 0">No subtasks yet</div>`;
      return `
    <div style="margin-bottom:16px">
      <div style="font-size:.7rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
        <span>Subtasks ${subs.length ? `(${subs.filter(s=>s.done).length}/${subs.length})` : ''}</span>
        <button onclick="addSubtask(${task.id})"
          style="background:none;border:1px solid var(--border);border-radius:6px;padding:2px 8px;
                 font-size:.72rem;color:var(--accent);cursor:pointer;font-weight:600">+ Add</button>
      </div>
      ${subsHTML}
    </div>`;
    })()}

    <div style="display:flex;gap:8px">
      <button onclick="moveSHTask(${task.id},'${task.status === 'done' ? 'todo' : 'done'}');shOpenDetail(${task.id})"
        style="flex:1;background:${task.status === 'done' ? 'var(--surface)' : '#22c55e'};
               border:1px solid ${task.status === 'done' ? 'var(--border)' : '#22c55e'};
               color:${task.status === 'done' ? 'var(--text2)' : '#fff'};
               border-radius:8px;padding:9px;font-family:var(--font-body);font-size:.83rem;font-weight:600;cursor:pointer">
        ${task.status === 'done' ? '↩ Reopen' : '✓ Mark Done'}
      </button>
      <button onclick="openEditTask(${task.id})"
        style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
               padding:9px 14px;color:var(--text2);font-size:.83rem;cursor:pointer" title="Edit in modal">✎</button>
      <button onclick="if(confirm('Delete task?')){deleteSHTask(${task.id});shCloseDetail()}"
        style="background:none;border:1px solid var(--border);border-radius:8px;
               padding:9px 12px;color:var(--muted);font-size:.83rem;cursor:pointer">🗑</button>
    </div>`;

  const panel    = $('sh-detail-panel');
  const backdrop = $('sh-detail-backdrop');
  if (panel)    panel.style.transform   = 'translateX(0)';
  if (backdrop) backdrop.style.display  = 'block';
  _shSelectTask(id);
}

function shCloseDetail() {
  const panel    = $('sh-detail-panel');
  const backdrop = $('sh-detail-backdrop');
  if (panel)    panel.style.transform   = 'translateX(100%)';
  if (backdrop) backdrop.style.display  = 'none';
}

async function addSubtask(parentId) {
  const title = await siModal.input('New Subtask', 'Subtask name:', '', { confirmLabel: 'Add' });
  if (!title?.trim()) return;
  const data   = getSHData();
  const parent = (data.tasks || []).find(t => t.id === parentId);
  const now    = new Date().toLocaleDateString();
  data.tasks.push({
    id: Date.now(), title: title.trim(),
    status: 'todo', done: false,
    parent_id: parentId,
    priority: parent?.priority || 'normal',
    created: now, updated: now,
  });
  saveSHData(data);
  renderSHBoard();
  shOpenDetail(parentId);
  toast('Subtask added ✓');
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

    const allTasksForBoard = tasks;
    body.innerHTML = colTasks.length ? colTasks.filter(t => !t.parent_id).map(t => {
      const dFmt   = _fmtDueDate(t.date, t.time);
      const subs   = allTasksForBoard.filter(c => String(c.parent_id) === String(t.id));
      const subDone = subs.filter(c => c.done).length;
      return `
      <div class="sh-card" draggable="true"
        ondragstart="SH_DRAG=${t.id}"
        ondragend="document.querySelectorAll('.sh-col-body').forEach(b=>b.classList.remove('drag-over'))">
        <div class="sh-card-title">${esc(t.title)}</div>
        ${t.notes ? `<div class="sh-card-notes">${esc(t.notes)}</div>` : ''}
        <div class="sh-card-footer">
          ${t.date ? `<span class="sh-card-date" style="color:${dFmt.color};font-weight:${dFmt.overdue?'700':'400'}">${dFmt.overdue ? '⚠️' : '📅'} ${dFmt.label}</span>` : ''}
          ${subs.length ? `<span style="font-size:.67rem;color:var(--muted);background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 5px">${subDone}/${subs.length} ○</span>` : ''}
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
      </div>`; }).join('')
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
    container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;padding:3rem 1rem;gap:10px">
      <div style="font-size:2.2rem">✅</div>
      <div style="font-weight:700;font-size:.95rem;color:var(--text)">No tasks yet</div>
      <div style="font-size:.82rem;color:var(--muted);text-align:center;max-width:340px;line-height:1.5">
        Press <kbd style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:.73rem;font-family:monospace">N</kbd> to create your first task.
      </div>
      <button onclick="openAddTask('todo')" style="margin-top:6px;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-family:var(--font-body);font-size:.83rem;font-weight:600;cursor:pointer">+ New task</button>
    </div>`;
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
      ${(() => { const d = _fmtDueDate(t.date,t.time); return `<div style="font-size:.72rem;color:${d.color};font-weight:${d.overdue?'700':'400'}">${d.label}</div>`; })()}
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
    // Inline code — escape content before inserting to prevent XSS
    .replace(/`([^`]+)`/g, (_, c) => `<code style="background:var(--border);border-radius:4px;padding:1px 6px;font-size:.85em">${esc(c)}</code>`)
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
  return typeof DOMPurify !== 'undefined'
    ? DOMPurify.sanitize(h, { FORCE_BODY: true })
    : h;
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
  const blob = new Blob([`Sivarr AI — LECTURE LAB\n${'─'.repeat(40)}\n\n${LAB_RESULT_TEXT}`], {type:'text/plain'});
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
    list.innerHTML = filter
      ? `<div class="empty-state"><div class="es-icon">📓</div><div class="es-text">No notes with this tag.</div></div>`
      : `<div class="empty-state"><div class="es-icon">📓</div><div class="es-text">Nothing here yet.</div><button class="es-cta" onclick="noteToggleForm()">Write your first note →</button></div>`;
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
    const ta = $('new-note-text');
    if (ta) {
      delete ta.dataset.editIdx;
      // Restore unsaved draft if user was mid-write
      const draft = localStorage.getItem(`sivarr_note_draft_${S.sid}`);
      ta.value = draft || '';
      if (draft) _saveStatus('unsaved');
    }
    if ($('note-tag-input')) $('note-tag-input').value = '';
    noteCharCount();
    ta?.focus();
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

  _recordActivity();
  const trimmed = notes.slice(0, 100);
  localStorage.setItem(`sivarr_notes_${S.sid}`, JSON.stringify(trimmed));
  localStorage.removeItem(`sivarr_note_draft_${S.sid}`);
  ta.value = '';
  if ($('note-tag-input')) $('note-tag-input').value = '';
  noteCharCount();
  $('note-write-form').style.display = 'none';
  _saveStatus('saved');
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
  const html   = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';

  // Smooth colour transition
  document.body.classList.add('theme-transitioning');
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 300);

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

  // Re-apply accent so it uses the right dark/light tint values
  const savedAccent = localStorage.getItem('sivarr_accent');
  if (savedAccent) _applyAccentColor(savedAccent, localStorage.getItem('sivarr_accent2') || '');

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
// FEATURE 2 — DAILY Sivarr BRIEF
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

  // Build Sivarr message
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

// ══════════════════════════════════════════════════════════════
//  DOCS & NOTES — Tiptap rich-text editor
// ══════════════════════════════════════════════════════════════

const DOC_KEY         = () => `sivarr_docs_${S.sid || 'guest'}`;
const DOC_AUTOSAVE_MS = 1500;

let _docId      = null;
let _docTimer   = null;
let _docEditor  = null;   // Tiptap Editor instance
let _slashPos   = -1;     // ProseMirror position where / was typed
let _slashFilt  = '';     // text typed after /
let _slashIdx   = 0;      // highlighted item index

function docGetAll() {
  try { return JSON.parse(localStorage.getItem(DOC_KEY()) || '[]'); }
  catch { return []; }
}
function docSaveAll(list) {
  localStorage.setItem(DOC_KEY(), JSON.stringify(list));
  _syncDocsToServer(list);
}

function _syncDocsToServer(docs) {
  const token = localStorage.getItem('sivarr_token');
  if (!token || !S.sid) return;
  if (!navigator.onLine) { _queueMutation('/api/docs/sync', { token, docs }); return; }
  fetch('/api/docs/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, docs }),
  }).catch(() => _queueMutation('/api/docs/sync', { token, docs }));
}

// ── Feature usage tracking (fires on every panel navigation) ─
let _lastTrackedNav = '';
function _trackNav(panel) {
  const token = localStorage.getItem('sivarr_token');
  if (!token || !panel || panel === _lastTrackedNav) return;
  _lastTrackedNav = panel;
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, event: 'nav', panel }),
  }).catch(() => {});
}

const _DOC_TEMPLATES = {
  blank:   { title: '', content: '<p></p>' },
  meeting: { title: 'Meeting Notes', content: `<h2>Meeting Notes</h2><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p><p><strong>Attendees:</strong> </p><h3>Agenda</h3><ul><li></li></ul><h3>Discussion</h3><p></p><h3>Action Items</h3><ul><li></li></ul><h3>Next Steps</h3><p></p>` },
  project: { title: 'Project Brief', content: `<h1>Project Brief</h1><h2>Overview</h2><p></p><h2>Goals</h2><ul><li></li></ul><h2>Timeline</h2><p></p><h2>Resources Needed</h2><ul><li></li></ul><h2>Success Criteria</h2><p></p>` },
  study:   { title: 'Study Notes', content: `<h1>Study Notes</h1><p><strong>Subject:</strong> </p><p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p><h2>Key Concepts</h2><ul><li></li></ul><h2>Notes</h2><p></p><h2>Summary</h2><p></p><h2>Questions to Revisit</h2><ul><li></li></ul>` },
  journal: { title: `Journal — ${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}`, content: `<h2>${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</h2><h3>Today's Highlights</h3><p></p><h3>What I Learned</h3><p></p><h3>What I'm Grateful For</h3><ul><li></li></ul><h3>Tomorrow's Focus</h3><p></p>` },
  weekly:  { title: 'Weekly Review', content: `<h1>Weekly Review</h1><p><strong>Week of:</strong> ${new Date().toLocaleDateString()}</p><h2>Wins This Week</h2><ul><li></li></ul><h2>What Could Have Gone Better</h2><ul><li></li></ul><h2>Goals Progress</h2><p></p><h2>Focus for Next Week</h2><ul><li></li></ul>` },
};

function docNew() {
  // Show template picker in the editor area
  const emptyState = $('doc-empty-state');
  const wrap       = $('doc-editor-wrap');
  if (wrap) wrap.style.display = 'none';
  if (emptyState) {
    emptyState.style.display = 'flex';
    emptyState.innerHTML = `
      <div style="max-width:560px;width:100%;text-align:left">
        <div style="font-size:1.05rem;font-weight:800;color:var(--text);margin-bottom:4px">New Document</div>
        <div style="font-size:.83rem;color:var(--muted);margin-bottom:20px">Start from a template or create blank</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
          ${[{k:'blank',i:'📄',n:'Blank'},{k:'meeting',i:'📋',n:'Meeting Notes'},
             {k:'project',i:'🚀',n:'Project Brief'},{k:'study',i:'📚',n:'Study Notes'},
             {k:'journal',i:'✍️',n:'Daily Journal'},{k:'weekly',i:'🔁',n:'Weekly Review'}
            ].map(t => `
            <div onclick="docFromTemplate('${t.k}')" style="background:var(--surface);border:1px solid var(--border);
                 border-radius:10px;padding:16px 14px;cursor:pointer;transition:var(--transition)"
              onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--teal2,rgba(13,122,95,.06))'"
              onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)'">
              <div style="font-size:1.8rem;margin-bottom:8px">${t.i}</div>
              <div style="font-size:.82rem;font-weight:600;color:var(--text)">${t.n}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }
}

function docFromTemplate(key) {
  const tpl = _DOC_TEMPLATES[key] || _DOC_TEMPLATES.blank;
  const doc = { id: Date.now(), title: tpl.title, content: tpl.content, created: Date.now(), updated: Date.now() };
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

  if (_docEditor) {
    _docEditor.commands.setContent(doc.content || '<p></p>', false);
    setTimeout(() => _docEditor.commands.focus('end'), 50);
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
    if (_docEditor) _docEditor.commands.setContent('<p></p>', false);
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
  if (!_docId || !_docEditor) return;
  const list = docGetAll();
  const idx  = list.findIndex(d => d.id === _docId);
  if (idx < 0) return;
  list[idx].title   = $('doc-title')?.value?.trim() || 'Untitled';
  list[idx].content = _docEditor.getHTML();
  list[idx].updated = Date.now();
  docSaveAll(list);
  docRenderList();
  const st = $('doc-save-status');
  if (st) st.textContent = 'All changes saved';
}

function docUpdateWordCount() {
  const text  = _docEditor ? _docEditor.getText() : '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wc    = $('doc-word-count');
  if (wc) wc.textContent = `${words} word${words !== 1 ? 's' : ''}`;
  const rt = $('doc-read-time');
  if (rt) rt.textContent = `${Math.max(1, Math.round(words / 250))} min read`;
}

// ── Toolbar format commands (same names, now call Tiptap) ─────

function docFormat(cmd) {
  if (!_docEditor) return;
  const c = _docEditor.chain().focus();
  ({
    bold:                c.toggleBold(),
    italic:              c.toggleItalic(),
    underline:           c.toggleUnderline(),
    insertUnorderedList: c.toggleBulletList(),
    insertOrderedList:   c.toggleOrderedList(),
    strikeThrough:       c.toggleStrike(),
  }[cmd] || c).run();
  docScheduleSave();
}

function docFormatBlock(tag) {
  if (!_docEditor) return;
  const c = _docEditor.chain().focus();
  ({
    h1:         c.toggleHeading({ level: 1 }),
    h2:         c.toggleHeading({ level: 2 }),
    h3:         c.toggleHeading({ level: 3 }),
    p:          c.setParagraph(),
    blockquote: c.toggleBlockquote(),
    pre:        c.toggleCodeBlock(),
  }[tag] || c).run();
  docScheduleSave();
}

// ── Sivarr AI inline writing ──────────────────────────────────

let _docAiText = '';

function docInlineAI() {
  const panel = $('doc-ai-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { docAIPanelClose(); return; }
  panel.style.display = 'block';
  $('doc-ai-result').style.display = 'none';
  $('doc-ai-insert').style.display = 'none';
  $('doc-ai-replace').style.display = 'none';
  _docAiText = '';
  // Pre-fill hint if text is selected
  const sel = window.getSelection()?.toString()?.trim() || '';
  const inp = $('doc-ai-prompt');
  if (inp) { inp.value = sel ? `Improve this: "${sel.slice(0,60)}${sel.length>60?'…':''}"` : ''; inp.focus(); }
}

function docAIPanelClose() {
  const panel = $('doc-ai-panel');
  if (panel) panel.style.display = 'none';
}

async function docAIGenerate() {
  if (!S.sid) return;
  const prompt  = $('doc-ai-prompt')?.value?.trim();
  if (!prompt) { toast('Enter a prompt first'); return; }
  const sel     = window.getSelection()?.toString()?.trim() || '';
  const content = _docEditor ? _docEditor.getText().trim().slice(0, 400) : '';
  const title   = $('doc-title')?.value?.trim() || '';
  const ctx     = sel
    ? `Selected text from doc "${title}": "${sel}"\n\nInstruction: ${prompt}`
    : content
    ? `Document "${title}" so far: ${content}\n\nInstruction: ${prompt}`
    : prompt;
  const resultEl  = $('doc-ai-result');
  const insertBtn = $('doc-ai-insert');
  const replaceBtn = $('doc-ai-replace');
  if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = 'Generating…'; }
  try {
    const r = await API('/api/chat', { sid: S.sid, message: ctx, context: '' });
    _docAiText = r.reply || r.response || '';
    if (resultEl)   resultEl.textContent  = _docAiText;
    if (insertBtn)  insertBtn.style.display  = 'block';
    if (replaceBtn) replaceBtn.style.display = sel ? 'block' : 'none';
  } catch { if (resultEl) resultEl.textContent = 'Could not generate — try again.'; }
}

function docAIInsert() {
  if (!_docAiText || !_docEditor) return;
  _docEditor.chain().focus().insertContent(`<p>${_docAiText.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}</p>`).run();
  docScheduleSave();
  docAIPanelClose();
  toast('Text inserted ✓');
}

function docAIReplace() {
  if (!_docAiText || !_docEditor) return;
  _docEditor.chain().focus().insertContent(_docAiText.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')).run();
  docScheduleSave();
  docAIPanelClose();
  toast('Text replaced ✓');
}

// ── Export ────────────────────────────────────────────────────

function _htmlToMd(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  function node(n) {
    if (n.nodeType === 3) return n.textContent;
    const t = n.tagName?.toLowerCase();
    const c = Array.from(n.childNodes).map(node).join('');
    switch(t) {
      case 'h1': return `\n# ${c}\n`;
      case 'h2': return `\n## ${c}\n`;
      case 'h3': return `\n### ${c}\n`;
      case 'p':  return `\n${c}\n`;
      case 'strong': case 'b': return `**${c}**`;
      case 'em': case 'i':     return `*${c}*`;
      case 's': case 'strike': return `~~${c}~~`;
      case 'code': return `\`${c}\``;
      case 'pre':  return `\n\`\`\`\n${n.textContent}\n\`\`\`\n`;
      case 'blockquote': return `\n> ${c.trim().replace(/\n/g,'\n> ')}\n`;
      case 'ul': return `\n${Array.from(n.children).map(li=>`- ${li.textContent.trim()}`).join('\n')}\n`;
      case 'ol': return `\n${Array.from(n.children).map((li,i)=>`${i+1}. ${li.textContent.trim()}`).join('\n')}\n`;
      case 'hr': return `\n---\n`;
      case 'br': return '\n';
      default:   return c;
    }
  }
  return Array.from(div.childNodes).map(node).join('').replace(/\n{3,}/g,'\n\n').trim();
}

function docExportMd() {
  if (!_docEditor) { toast('Open a document first'); return; }
  const title = $('doc-title')?.value?.trim() || 'document';
  const md    = `# ${title}\n\n${_htmlToMd(_docEditor.getHTML())}`;
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(new Blob([md], { type:'text/markdown' }));
  a.download  = `${title.replace(/\s+/g,'-').toLowerCase()}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported as Markdown ✓');
}

function docExportPdf() {
  if (!_docEditor) { toast('Open a document first'); return; }
  const title   = $('doc-title')?.value?.trim() || 'Document';
  const content = _docEditor.getHTML();
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;color:#1a1a2e;line-height:1.75;font-size:16px}
    h1{font-size:2rem;font-weight:800;margin:1.5rem 0 .5rem}h2{font-size:1.4rem;font-weight:700;margin:1.2rem 0 .5rem}
    h3{font-size:1.15rem;font-weight:700;margin:1rem 0 .4rem}blockquote{border-left:3px solid #0D7A5F;padding:8px 16px;
    margin:1rem 0;background:#f0faf6}pre{background:#1a1a2e;color:#e2e8f0;padding:16px;border-radius:8px;overflow-x:auto}
    code{font-family:monospace;font-size:.9em;background:#f1f5f9;padding:2px 5px;border-radius:3px}
    ul,ol{padding-left:1.5rem}@media print{body{margin:0}}</style>
    </head><body><h1>${title}</h1>${content}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

// ── Legacy shim (anything calling docAskSiva still works) ─────
function docAskSiva() { docInlineAI(); }

// ── Tiptap initialisation ─────────────────────────────────────

function _waitForTiptap(cb) {
  if (window._tiptap) { cb(); return; }
  window.addEventListener('tiptap-ready', cb, { once: true });
}

function _initTiptapEditor() {
  if (_docEditor) return;
  const el = $('doc-content');
  if (!el || !window._tiptap) return;

  const { Editor, StarterKit, Placeholder, Underline } = window._tiptap;

  _docEditor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: 'Start writing… or type / for commands' }),
      Underline,
    ],
    content: '',
    onUpdate({ editor }) {
      docUpdateWordCount();
      docScheduleSave();
      const st = $('doc-save-status');
      if (st) st.textContent = 'Unsaved…';
      _checkSlash(editor);
    },
  });

  // Intercept keyboard for slash menu
  el.addEventListener('keydown', e => {
    if (!_slashOpen()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); _slashMove(1);  }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); _slashMove(-1); }
    else if (e.key === 'Enter')     { e.preventDefault(); _slashExec();   }
    else if (e.key === 'Escape')    { e.preventDefault(); _slashHide();   }
    else if (e.key === 'Backspace') {
      if (_slashFilt.length) { _slashFilt = _slashFilt.slice(0, -1); _slashRender(); }
      else _slashHide();
    }
  }, true);
}

function docInit() {
  docRenderList();
  _waitForTiptap(() => {
    _initTiptapEditor();
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
  });
}

// ══════════════════════════════════════════════════════════════
//  SLASH COMMAND MENU
// ══════════════════════════════════════════════════════════════

const _SLASH_CMDS = [
  { icon:'ti-h-1',          label:'Heading 1',      desc:'Large section heading',  act:() => docFormatBlock('h1') },
  { icon:'ti-h-2',          label:'Heading 2',       desc:'Medium heading',         act:() => docFormatBlock('h2') },
  { icon:'ti-h-3',          label:'Heading 3',       desc:'Small heading',          act:() => docFormatBlock('h3') },
  { icon:'ti-list',         label:'Bullet list',     desc:'Unordered list',         act:() => docFormat('insertUnorderedList') },
  { icon:'ti-list-numbers', label:'Numbered list',   desc:'Ordered list',           act:() => docFormat('insertOrderedList') },
  { icon:'ti-quote',        label:'Quote',           desc:'Blockquote',             act:() => docFormatBlock('blockquote') },
  { icon:'ti-code',         label:'Code block',      desc:'Monospace code',         act:() => docFormatBlock('pre') },
  { icon:'ti-minus',        label:'Divider',         desc:'Horizontal rule',        act:() => _docEditor?.chain().focus().setHorizontalRule().run() },
  { icon:'ti-info-circle',  label:'Callout',         desc:'Highlighted note block', act:() => _docEditor?.chain().focus().insertContent('<blockquote><p>💡 <strong>Note:</strong> </p></blockquote>').run() },
  { icon:'ti-sparkles',     label:'AI Write',        desc:'Generate with Sivarr AI',act:() => { _slashHide(); docInlineAI(); } },
];

function _checkSlash(editor) {
  const { from } = editor.state.selection;
  if (from < 1) { _slashHide(); return; }
  const $pos   = editor.state.doc.resolve(from);
  const lineStart = $pos.start();
  const lineText  = editor.state.doc.textBetween(lineStart, from);
  if (lineText === '/') {
    _slashPos  = from - 1;
    _slashFilt = '';
    _slashIdx  = 0;
    _slashShow(editor, _slashPos);
  } else if (_slashOpen() && lineText.startsWith('/')) {
    _slashFilt = lineText.slice(1).toLowerCase();
    _slashIdx  = 0;
    _slashRender();
  } else {
    _slashHide();
  }
}

function _slashOpen() {
  const m = $('slash-menu');
  return m && m.style.display !== 'none';
}

function _slashShow(editor, pos) {
  const menu = $('slash-menu');
  if (!menu) return;
  try {
    const coords = editor.view.coordsAtPos(pos);
    const scrollY = window.scrollY || 0;
    menu.style.top  = `${coords.bottom + scrollY + 4}px`;
    menu.style.left = `${Math.max(8, coords.left)}px`;
  } catch(_) {}
  menu.style.display = 'block';
  _slashRender();
}

function _slashRender() {
  const menu  = $('slash-menu');
  if (!menu) return;
  const q   = _slashFilt;
  const vis = _SLASH_CMDS.filter(c =>
    !q || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );
  if (!vis.length) { _slashHide(); return; }
  menu.innerHTML = vis.map((c, i) => `
    <div class="slash-item${i === _slashIdx ? ' sel' : ''}" onmousedown="event.preventDefault();_slashRun(${_SLASH_CMDS.indexOf(c)})">
      <div class="slash-ic"><i class="ti ${c.icon}"></i></div>
      <div>
        <div class="slash-lb">${c.label}</div>
        <div class="slash-ds">${c.desc}</div>
      </div>
    </div>`).join('');
}

function _slashMove(dir) {
  const q   = _slashFilt;
  const vis = _SLASH_CMDS.filter(c =>
    !q || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );
  _slashIdx = Math.max(0, Math.min(vis.length - 1, _slashIdx + dir));
  _slashRender();
}

function _slashExec() {
  const q   = _slashFilt;
  const vis = _SLASH_CMDS.filter(c =>
    !q || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );
  _slashRun(_SLASH_CMDS.indexOf(vis[_slashIdx]));
}

function _slashRun(idx) {
  _slashHide();
  const cmd = _SLASH_CMDS[idx];
  if (!cmd || !_docEditor) return;
  const delLen = 1 + _slashFilt.length;
  _docEditor.chain().focus()
    .deleteRange({ from: _slashPos, to: _slashPos + delLen })
    .run();
  setTimeout(() => cmd.act(), 20);
}

function _slashHide() {
  const m = $('slash-menu');
  if (m) m.style.display = 'none';
  _slashFilt = '';
  _slashIdx  = 0;
}

document.addEventListener('mousedown', e => {
  if (_slashOpen() && !$('slash-menu')?.contains(e.target)) _slashHide();
});

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

// ORG state — populated from API
let ORG = null; // { id, name, member_role, owner_sid, ... }
let ORG_MEMBERS  = [];
let ORG_TASKS    = [];
let ORG_PROJECTS = [];
let ORG_DOCS     = [];
let ORG_GOALS    = [];
let ORG_FOUNDER  = {};

const ORG_KANBAN_COLS = ['todo','inprogress','review','done'];
const ORG_COL_LABELS  = { todo:'To Do', inprogress:'In Progress', review:'Review', done:'Done' };

async function orgInit() {
  if (!S.sid) return;
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;

  // Show loading state
  const nameEl = $('os-space-name');
  if (nameEl) nameEl.textContent = 'Loading…';

  try {
    const r = await API('/api/org/get', { token });
    if (!r.org) {
      _orgShowSetup();
      return;
    }
    ORG          = r.org;
    ORG_MEMBERS  = r.members  || [];
    ORG_TASKS    = r.tasks    || [];
    ORG_PROJECTS = r.projects || [];
    ORG_DOCS     = r.docs     || [];
    ORG_GOALS    = r.goals    || [];
    ORG_FOUNDER  = r.founder  || {};
  } catch(e) {
    _orgShowSetup();
    if (e.status !== 404 && e.status !== 401 && e.status !== 403) {
      toast('Could not load organization — please refresh.');
    }
    return;
  }

  // Hero
  if (nameEl) nameEl.textContent = ORG.name;
  const mcEl = $('os-member-count'); if (mcEl) mcEl.textContent = ORG_MEMBERS.length;
  const ocEl = $('os-online-count'); if (ocEl) ocEl.textContent = 1;
  _orgRenderLogo();

  // Hide setup card, show org content
  const setup = $('org-setup-card');
  if (setup) setup.style.display = 'none';
  const content = $('org-main-content');
  if (content) content.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';

  orgRenderOverview();
  orgRenderGoals();
  orgRenderKanban();
  orgRenderProjects();
  orgRenderDocs();
  orgRenderMembers();
  orgRenderInsights();
  orgChatRender();
  founderRender();
  _founderTabVisibility();
}

function _orgRenderLogo() {
  const icon = $('os-hero-icon');
  if (!icon || !ORG) return;
  const key = `sivarr_org_logo_${ORG.id}`;
  const saved = localStorage.getItem(key);
  const placeholder = $('os-hero-icon-placeholder');
  const existing = icon.querySelector('img');
  if (saved) {
    if (!existing) {
      const img = document.createElement('img');
      img.src = saved;
      img.alt = ORG.name || 'Logo';
      if (placeholder) placeholder.style.display = 'none';
      icon.insertBefore(img, icon.firstChild);
    } else {
      existing.src = saved;
      if (placeholder) placeholder.style.display = 'none';
    }
  } else {
    if (existing) existing.remove();
    if (placeholder) placeholder.style.display = '';
  }
}

function orgLogoEdit() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file || !ORG) return;
    if (file.size > 2 * 1024 * 1024) { toast('Image must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      localStorage.setItem(`sivarr_org_logo_${ORG.id}`, e.target.result);
      _orgRenderLogo();
      toast('Logo updated');
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

function _orgShowSetup() {
  const setup = $('org-setup-card');
  if (setup) setup.style.display = 'flex';
  const content = $('org-main-content');
  if (content) content.style.cssText = 'display:none;';
}

function _orgMemberName(sid) {
  const m = ORG_MEMBERS.find(x => x.sid === sid);
  return m ? m.name : sid;
}

async function _orgRefresh() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !ORG) return;
  try {
    const r = await API('/api/org/get', { token });
    ORG          = r.org;
    ORG_MEMBERS  = r.members  || [];
    ORG_TASKS    = r.tasks    || [];
    ORG_PROJECTS = r.projects || [];
    ORG_DOCS     = r.docs     || [];
    ORG_GOALS    = r.goals    || [];
    ORG_FOUNDER  = r.founder  || {};
  } catch(e) { return; }
  orgRenderOverview();
  orgRenderGoals();
  orgRenderKanban();
  orgRenderProjects();
  orgRenderDocs();
  orgRenderMembers();
  orgRenderInsights();
  founderRender();
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
  if (tab === 'chat')  { orgChatInit(); }
  else               { _ocDisconnectSSE(); }
  if (tab === 'goals')    orgRenderGoals();
  if (tab === 'founder')  founderRender();
  if (tab === 'announce') {
    annLoad();
    const wrap = $('ann-compose-wrap');
    if (wrap) wrap.style.display = _orgIsAdmin() ? 'flex' : 'none';
  }
  if (tab === 'analytics')  orgAnalyticsLoad();
  if (tab === 'financials') psFinancialsLoad();
}

function orgRenderOverview() {
  const today   = new Date().toISOString().slice(0,10);
  const open    = ORG_TASKS.filter(t => t.status !== 'done').length;
  const done    = ORG_TASKS.filter(t => t.status === 'done').length;
  const overdue = ORG_TASKS.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length;

  const setVal = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setVal('os-open-tasks', open);
  setVal('os-done-tasks', done);
  setVal('os-proj-count', ORG_PROJECTS.length);
  setVal('os-mem-count',  ORG_MEMBERS.length);
  const ovEl = $('os-overdue-lbl');
  if (ovEl) ovEl.textContent = overdue ? `${overdue} overdue` : '';
  if (ovEl) ovEl.style.color = overdue ? 'var(--coral)' : 'var(--muted)';
  const invEl = $('os-invite-lbl');
  if (invEl) invEl.textContent = ORG_MEMBERS.length <= 1 ? 'Just you — invite your team' : '';
  const gcEl = $('os-goal-count');
  if (gcEl) gcEl.textContent = ORG_GOALS.filter(g => g.status === 'active').length;

  // Goals mini
  const gm = $('os-goals-mini');
  if (gm) {
    const active = ORG_GOALS.filter(g => g.status === 'active').slice(0,3);
    gm.innerHTML = active.length
      ? active.map(g => `
        <div class="os-task-card" onclick="orgTab('goals',null)">
          <div class="os-task-title">${escHtml(g.title)}</div>
          <div class="os-goal-bar-wrap"><div class="os-goal-bar-fill" style="width:${g.progress||0}%"></div></div>
          <div class="os-task-meta"><span>${g.progress||0}%</span>${g.due_date?`<span>${g.due_date}</span>`:''}</div>
        </div>`).join('')
      : '<div class="os-empty">No active goals. <span class="os-card-link" onclick="orgTab(\'goals\',null)">Add one →</span></div>';
  }

  // Priority tasks
  const pt = $('os-priority-tasks');
  if (pt) {
    const pri = ORG_TASKS.filter(t => t.status !== 'done' && t.priority === 'high').slice(0,5);
    pt.innerHTML = pri.length
      ? pri.map(t => `<div class="os-task-card" onclick="orgEditTask('${t.id}')"><div class="os-task-title">${escHtml(t.title)}</div><div class="os-task-meta"><span>${escHtml(ORG_COL_LABELS[t.status]||t.status)}</span>${t.due_date ? `<span>${t.due_date}</span>` : ''}</div></div>`).join('')
      : '<div class="os-empty">No high-priority tasks.</div>';
  }

  // Projects mini
  const pp = $('os-proj-progress');
  if (pp) {
    pp.innerHTML = ORG_PROJECTS.length
      ? ORG_PROJECTS.slice(0,4).map(p => `<div class="os-task-card"><div class="os-task-tag">${escHtml(p.status||'active')}</div><div class="os-task-title">${escHtml(p.name)}</div></div>`).join('')
      : '<div class="os-empty">No projects yet.</div>';
  }

  // Team mini
  const tm = $('os-team-mini');
  if (tm) {
    tm.innerHTML = ORG_MEMBERS.slice(0,5).map(m => `
      <div class="os-member-row">
        <div class="os-member-av">${(m.name||'?')[0].toUpperCase()}</div>
        <div class="os-member-info">
          <div class="os-member-name">${escHtml(m.name)}</div>
          <div class="os-member-role">${escHtml(m.role||'Member')}</div>
        </div>
      </div>`).join('') || '<div class="os-empty">No members yet.</div>';
  }

  const af = $('os-activity-feed');
  if (af) af.innerHTML = '<div class="os-empty">Activity from team chat will appear here.</div>';
}

function orgRenderKanban() {
  const board = $('os-kanban');
  if (!board) return;
  board.innerHTML = ORG_KANBAN_COLS.map(col => {
    const tasks = ORG_TASKS.filter(t => t.status === col);
    return `
    <div class="os-col">
      <div class="os-col-head">
        <span class="os-col-title">${ORG_COL_LABELS[col]}</span>
        <span class="os-col-count">${tasks.length}</span>
      </div>
      ${tasks.map(t => `
        <div class="os-task-card" onclick="orgEditTask('${t.id}')">
          ${t.priority === 'high' ? '<div class="os-task-tag">High</div>' : ''}
          <div class="os-task-title">${escHtml(t.title)}</div>
          <div class="os-task-meta">
            ${t.assignee_sid ? `<span>${escHtml(_orgMemberName(t.assignee_sid))}</span>` : ''}
            ${t.due_date ? `<span>${t.due_date}</span>` : ''}
          </div>
        </div>`).join('')}
      <button class="os-add-card-btn" onclick="orgAddTaskToCol('${col}')">+ Add task</button>
    </div>`;
  }).join('');
}

function orgRenderProjects() {
  const grid = $('os-proj-grid');
  if (!grid) return;
  if (!ORG_PROJECTS.length) {
    grid.innerHTML = '<div class="os-empty" style="padding:20px 0">No projects yet — create your first one.</div>';
    return;
  }
  grid.innerHTML = ORG_PROJECTS.map(p => {
    const color = p.color || '#0d9488';
    const taskCount = ORG_TASKS.filter(t => t.project_id === p.id).length;
    return `
    <div class="os-proj-card">
      <div class="os-proj-stripe" style="background:${escHtml(color)}"></div>
      <div class="os-proj-name">${escHtml(p.name)}</div>
      ${p.description ? `<div class="os-proj-desc">${escHtml(p.description)}</div>` : ''}
      <div class="os-proj-meta">
        <span class="os-proj-badge">${escHtml(p.status||'active')}</span>
        <span class="os-proj-tasks-count">${taskCount} tasks</span>
      </div>
    </div>`;
  }).join('');
}

function orgRenderDocs() {
  const grid = $('os-docs-grid');
  if (!grid) return;
  if (!ORG_DOCS.length) {
    grid.innerHTML = '<div class="os-empty" style="padding:20px 0">No docs yet — create one to share with your team.</div>';
    return;
  }
  grid.innerHTML = ORG_DOCS.map(doc => `
    <div class="os-doc-card" onclick="orgOpenDoc('${doc.id}')">
      <div class="os-doc-icon"><i class="ti ti-file-text"></i></div>
      <div class="os-doc-name">${escHtml(doc.title)}</div>
      <div class="os-doc-meta">${doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : 'Just now'}</div>
    </div>`).join('');
}

function orgRenderMembers() {
  const list = $('os-members-list');
  if (!list) return;
  const lbl = $('os-member-label');
  if (lbl) lbl.textContent = `${ORG_MEMBERS.length} member${ORG_MEMBERS.length !== 1 ? 's' : ''}`;
  if (!ORG_MEMBERS.length) { list.innerHTML = '<div class="os-empty" style="padding:16px 0">No members yet.</div>'; return; }
  list.innerHTML = ORG_MEMBERS.map(m => `
    <div class="os-member-row">
      <div class="os-member-av">${(m.name||'?')[0].toUpperCase()}</div>
      <div class="os-member-info">
        <div class="os-member-name">${escHtml(m.name)}${m.sid === S.sid ? ' <span style="color:var(--muted);font-size:.75rem">(you)</span>' : ''}</div>
        <div class="os-member-role">${escHtml(m.email || '')}</div>
      </div>
      <span class="os-member-badge">${escHtml(m.role||'member')}</span>
    </div>`).join('');
}

function orgRenderInsights() {
  const vel = $('os-velocity');
  const otr = $('os-ontime');
  const fhr = $('os-focus-hrs');
  const gac = $('os-goals-active');
  const done = ORG_TASKS.filter(t => t.status === 'done').length;
  if (vel) vel.textContent = done > 0 ? (done / Math.max(1, Math.ceil(done / 5))).toFixed(1) : '—';
  if (otr) otr.textContent = done > 0 ? Math.round((done / Math.max(1, ORG_TASKS.length)) * 100) + '%' : '—';
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
    tbm.innerHTML = ORG_MEMBERS.length
      ? ORG_MEMBERS.map(m => {
          const count = ORG_TASKS.filter(t => t.assignee_sid === m.sid).length;
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
    if (!done && !ORG_TASKS.length) {
      ai.innerHTML = '<div class="os-empty">Start adding tasks to unlock AI insights.</div>';
    } else {
      const rate = ORG_TASKS.length ? Math.round((done / ORG_TASKS.length) * 100) : 0;
      ai.innerHTML = `<div style="font-size:.84rem;color:var(--fg);line-height:1.6;padding:4px 0">
        Your team has completed <strong>${done}</strong> tasks (${rate}% completion rate).
        ${rate >= 70 ? ' Great momentum — keep it up!' : rate >= 40 ? ' Solid progress. Focus on clearing the backlog.' : ' Consider breaking tasks into smaller steps to build momentum.'}
      </div>`;
    }
  }
}

// ══════════════════════════════════════════════════
//  S3 — GOALS & OKRs
// ══════════════════════════════════════════════════

function orgRenderGoals() {
  const list = $('os-goals-list');
  if (!list) return;
  if (!ORG_GOALS.length) {
    list.innerHTML = '<div class="os-empty" style="padding:40px 0">No goals yet — create your first OKR to connect your team\'s work to strategy.</div>';
    return;
  }
  const statusColor = { active:'var(--teal)', achieved:'var(--green)', at_risk:'var(--coral)', paused:'var(--muted)' };
  list.innerHTML = ORG_GOALS.map(g => {
    const krs = g.key_results || [];
    const pct = g.progress || 0;
    const sc  = statusColor[g.status] || 'var(--muted)';
    return `
    <div class="os-goal-card">
      <div class="os-goal-head">
        <div class="os-goal-dot" style="background:${sc}"></div>
        <div class="os-goal-title">${escHtml(g.title)}</div>
        <span class="os-goal-badge" style="background:${sc}22;color:${sc}">${escHtml(g.type||'okr')}</span>
        <span class="os-goal-pct">${pct}%</span>
        <button class="os-goal-menu" onclick="orgEditGoal('${g.id}')"><i class="ti ti-pencil"></i></button>
        <button class="os-goal-menu" onclick="orgDeleteGoal('${g.id}')"><i class="ti ti-trash"></i></button>
      </div>
      <div class="os-goal-bar-wrap"><div class="os-goal-bar-fill" style="width:${pct}%"></div></div>
      ${g.description ? `<div class="os-goal-desc">${escHtml(g.description)}</div>` : ''}
      <div class="os-kr-list">
        ${krs.map(kr => {
          const kpct = kr.target_value > 0 ? Math.min(100, Math.round((kr.current_value/kr.target_value)*100)) : 0;
          return `
          <div class="os-kr-row">
            <div class="os-kr-title">${escHtml(kr.title)}</div>
            <div class="os-kr-progress">
              <div class="os-kr-bar"><div class="os-kr-fill" style="width:${kpct}%"></div></div>
              <span class="os-kr-val">${kr.current_value}/${kr.target_value}${escHtml(kr.unit)}</span>
            </div>
            <button class="os-goal-menu" onclick="orgUpdateKR('${kr.id}','${kr.current_value}','${kr.target_value}','${escHtml(kr.unit)}')"><i class="ti ti-edit"></i></button>
          </div>`;
        }).join('')}
        <button class="os-kr-add" onclick="orgAddKR('${g.id}')"><i class="ti ti-plus"></i> Add key result</button>
      </div>
    </div>`;
  }).join('');
}

async function orgNewGoal() {
  if (!ORG) return;
  const d = await siModal.form('New Goal', [
    { id:'title',    label:'Goal title',      placeholder:'e.g. Reach 100 paying customers', required:true },
    { id:'type',     label:'Type',            type:'select', options:[{value:'okr',label:'OKR'},{value:'quarterly',label:'Quarterly'},{value:'annual',label:'Annual'},{value:'company',label:'Company Vision'}] },
    { id:'due_date', label:'Target date',     type:'date' },
    { id:'desc',     label:'Description',     placeholder:'What does success look like?' },
  ], { confirmLabel:'Create Goal' });
  if (!d || !d.title) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/goals/create', { token, title:d.title, type:d.type||'okr', due_date:d.due_date||null, description:d.desc||'' });
    await _orgRefresh();
    toast('Goal created');
  } catch(e) { toast(e.message || 'Could not create goal'); }
}

async function orgEditGoal(goalId) {
  const g = ORG_GOALS.find(x => x.id === goalId);
  if (!g) return;
  const d = await siModal.form('Edit Goal', [
    { id:'title',    label:'Goal title',  required:true, default:g.title },
    { id:'progress', label:'Progress %',  type:'number',  default:String(g.progress||0) },
    { id:'status',   label:'Status',      type:'select', options:[{value:'active',label:'Active'},{value:'achieved',label:'Achieved'},{value:'at_risk',label:'At Risk'},{value:'paused',label:'Paused'}], default:g.status||'active' },
    { id:'due_date', label:'Target date', type:'date',   default:g.due_date||'' },
  ], { confirmLabel:'Save' });
  if (!d || !d.title) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/goals/update', { token, goal_id:goalId, title:d.title, progress:parseInt(d.progress)||0, status:d.status, due_date:d.due_date||null });
    await _orgRefresh();
    toast('Goal updated');
  } catch(e) { toast(e.message || 'Could not update goal'); }
}

async function orgDeleteGoal(goalId) {
  if (!await siModal.confirm('Delete this goal and all its key results?', { danger:true })) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/goals/delete', { token, goal_id:goalId });
    await _orgRefresh();
    toast('Goal deleted');
  } catch(e) { toast(e.message || 'Could not delete goal'); }
}

async function orgAddKR(goalId) {
  const d = await siModal.form('Add Key Result', [
    { id:'title',  label:'Key result',   placeholder:'e.g. Sign 50 beta users', required:true },
    { id:'target', label:'Target value', type:'number', default:'100' },
    { id:'unit',   label:'Unit',         placeholder:'%, users, $, etc.', default:'%' },
  ], { confirmLabel:'Add' });
  if (!d || !d.title) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/goals/kr/create', { token, goal_id:goalId, title:d.title, target_value:parseFloat(d.target)||100, unit:d.unit||'%' });
    await _orgRefresh();
    toast('Key result added');
  } catch(e) { toast(e.message || 'Could not add key result'); }
}

async function orgUpdateKR(krId, current, target, unit) {
  const d = await siModal.form('Update Key Result', [
    { id:'current', label:`Current value (target: ${target}${unit})`, type:'number', default:String(current) },
  ], { confirmLabel:'Update' });
  if (!d) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/goals/kr/update', { token, kr_id:krId, current_value:parseFloat(d.current)||0 });
    await _orgRefresh();
    toast('Progress updated');
  } catch(e) { toast(e.message || 'Could not update'); }
}

// ══════════════════════════════════════════════════
//  S8 — Sivarr AI EXECUTIVE BRIEFING
// ══════════════════════════════════════════════════

async function orgGetBriefing() {
  if (!ORG) return;
  const btn  = $('os-briefing-btn');
  const text = $('os-briefing-text');
  if (btn)  { btn.textContent = 'Generating…'; btn.disabled = true; }
  if (text) text.textContent = 'Sivarr is analysing your organisation…';
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await API('/api/org/ai/briefing', { token });
    if (text) text.textContent = r.briefing || 'No briefing generated.';
    if (btn)  { btn.textContent = 'Refresh →'; btn.disabled = false; }
  } catch(e) {
    if (text) text.textContent = 'Could not generate briefing — try again shortly.';
    if (btn)  { btn.textContent = 'Generate →'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════
//  S23 — FOUNDER MODE
// ══════════════════════════════════════════════════

function _founderTabVisibility() {
  const tab = $('os-tab-founder');
  if (!tab || !ORG) return;
  const role = ORG.member_role || '';
  tab.style.display = (role === 'owner' || role === 'admin') ? '' : 'none';
}

function founderRender() {
  const f = ORG_FOUNDER || {};
  const burn = parseFloat(f.burn_rate) || 0;
  const cash = parseFloat(f.cash_balance) || 0;
  const mrr  = parseFloat(f.mrr) || 0;
  const raised = parseFloat(f.total_raised) || 0;
  const runway = burn > 0 ? Math.round(cash / burn) : null;

  const fmt = v => v >= 1000000 ? `₦${(v/1000000).toFixed(1)}M` : v >= 1000 ? `₦${(v/1000).toFixed(0)}K` : `₦${v.toLocaleString()}`;

  const setV = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setV('fd-burn',   fmt(burn));
  setV('fd-runway', runway !== null ? `${runway}` : '—');
  setV('fd-mrr',    fmt(mrr));
  setV('fd-raised', fmt(raised));
  setV('fd-stage',  f.funding_stage || 'pre-seed');

  // Populate inputs
  const s = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
  s('fd-inp-stage',  f.funding_stage || 'pre-seed');
  s('fd-inp-cash',   cash || '');
  s('fd-inp-burn',   burn || '');
  s('fd-inp-mrr',    mrr || '');
  s('fd-inp-raised', raised || '');

  // Milestones
  const ml = $('fd-milestones-list');
  const milestones = Array.isArray(f.milestones) ? f.milestones : [];
  if (ml) {
    ml.innerHTML = milestones.length
      ? milestones.map((m, i) => `
        <div class="os-task-card" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" ${m.done?'checked':''} onchange="founderToggleMilestone(${i})" style="accent-color:var(--teal)">
          <span style="flex:1;${m.done?'text-decoration:line-through;color:var(--muted)':''}">${escHtml(m.text)}</span>
          <button class="os-goal-menu" onclick="founderRemoveMilestone(${i})"><i class="ti ti-x"></i></button>
        </div>`).join('')
      : '<div class="os-empty">No milestones yet.</div>';
  }

  // Investors
  const il = $('fd-investors-list');
  const investors = Array.isArray(f.investors) ? f.investors : [];
  if (il) {
    const stages = { contacted:'var(--muted)', interested:'var(--amber)', committed:'var(--teal)', passed:'var(--coral)' };
    il.innerHTML = investors.length
      ? `<div class="fd-inv-grid">${investors.map((inv, i) => `
        <div class="fd-inv-card">
          <div class="fd-inv-av">${(inv.name||'?')[0].toUpperCase()}</div>
          <div style="flex:1">
            <div class="fd-inv-name">${escHtml(inv.name)}</div>
            <div class="fd-inv-firm">${escHtml(inv.firm||'')}</div>
          </div>
          <span class="fd-inv-badge" style="background:${stages[inv.stage]||'var(--muted)'}22;color:${stages[inv.stage]||'var(--muted)'}">${escHtml(inv.stage||'contacted')}</span>
          <button class="os-goal-menu" onclick="founderRemoveInvestor(${i})"><i class="ti ti-x"></i></button>
        </div>`).join('')}</div>`
      : '<div class="os-empty">No investors tracked yet.</div>';
  }
}

async function founderSave() {
  if (!ORG) return;
  const token = localStorage.getItem('sivarr_token') || '';
  const f = ORG_FOUNDER || {};
  try {
    await API('/api/org/founder/save', {
      token,
      funding_stage: $('fd-inp-stage')?.value || 'pre-seed',
      cash_balance:  parseFloat($('fd-inp-cash')?.value) || 0,
      burn_rate:     parseFloat($('fd-inp-burn')?.value) || 0,
      mrr:           parseFloat($('fd-inp-mrr')?.value)  || 0,
      total_raised:  parseFloat($('fd-inp-raised')?.value) || 0,
      arr:           (parseFloat($('fd-inp-mrr')?.value) || 0) * 12,
      investors:     Array.isArray(f.investors) ? f.investors : [],
      milestones:    Array.isArray(f.milestones) ? f.milestones : [],
    });
    await _orgRefresh();
    toast('Founder data saved');
  } catch(e) { toast(e.message || 'Could not save'); }
}

async function founderAddMilestone() {
  const text = await siModal.input('New Milestone', 'e.g. Launch beta, Reach 100 users', '', { confirmLabel:'Add' });
  if (!text) return;
  const f = ORG_FOUNDER || {};
  const milestones = Array.isArray(f.milestones) ? [...f.milestones] : [];
  milestones.push({ text, done: false });
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/founder/save', { token, ...f, milestones, arr: (f.mrr||0)*12 });
    await _orgRefresh();
  } catch(e) { toast(e.message || 'Could not save'); }
}

async function founderToggleMilestone(idx) {
  const f = ORG_FOUNDER || {};
  const milestones = Array.isArray(f.milestones) ? [...f.milestones] : [];
  if (milestones[idx]) milestones[idx].done = !milestones[idx].done;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/founder/save', { token, ...f, milestones, arr: (f.mrr||0)*12 });
    await _orgRefresh();
  } catch(e) { toast(e.message || 'Could not save'); }
}

async function founderRemoveMilestone(idx) {
  const f = ORG_FOUNDER || {};
  const milestones = (Array.isArray(f.milestones) ? [...f.milestones] : []).filter((_,i) => i !== idx);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/founder/save', { token, ...f, milestones, arr: (f.mrr||0)*12 });
    await _orgRefresh();
  } catch(e) { toast(e.message || 'Could not save'); }
}

async function founderAddInvestor() {
  const d = await siModal.form('Add Investor', [
    { id:'name',  label:'Name',        placeholder:'e.g. Adeola Bello', required:true },
    { id:'firm',  label:'Firm',        placeholder:'e.g. Ventures Africa' },
    { id:'stage', label:'Stage',       type:'select', options:[{value:'contacted',label:'Contacted'},{value:'interested',label:'Interested'},{value:'committed',label:'Committed'},{value:'passed',label:'Passed'}] },
    { id:'note',  label:'Note',        placeholder:'Any context…' },
  ], { confirmLabel:'Add Investor' });
  if (!d || !d.name) return;
  const f = ORG_FOUNDER || {};
  const investors = Array.isArray(f.investors) ? [...f.investors] : [];
  investors.push({ name:d.name, firm:d.firm||'', stage:d.stage||'contacted', note:d.note||'' });
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/founder/save', { token, ...f, investors, arr: (f.mrr||0)*12 });
    await _orgRefresh();
  } catch(e) { toast(e.message || 'Could not save'); }
}

async function founderRemoveInvestor(idx) {
  const f = ORG_FOUNDER || {};
  const investors = (Array.isArray(f.investors) ? [...f.investors] : []).filter((_,i) => i !== idx);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/founder/save', { token, ...f, investors, arr: (f.mrr||0)*12 });
    await _orgRefresh();
  } catch(e) { toast(e.message || 'Could not save'); }
}

async function orgNewTask() {
  if (!ORG) return;
  const title = await siModal.input('New Task', 'Task title', '', { confirmLabel:'Create Task' });
  if (!title) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/tasks/create', { token, title, status: 'todo', priority: 'normal' });
    await _orgRefresh();
    toast('Task created');
  } catch(e) { toast(e.message || 'Could not create task'); }
}

async function orgAddTaskToCol(col) {
  if (!ORG) return;
  const label = ORG_COL_LABELS[col] || col;
  const title = await siModal.input(`Add to "${label}"`, 'Task title', '', { confirmLabel:'Add Task' });
  if (!title) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/tasks/create', { token, title, status: col, priority: 'normal' });
    await _orgRefresh();
    orgTab('tasks', null);
    toast('Task added');
  } catch(e) { toast(e.message || 'Could not add task'); }
}

async function orgEditTask(taskId) {
  if (!ORG) return;
  const task = ORG_TASKS.find(t => String(t.id) === String(taskId));
  if (!task) return;
  const d = await siModal.form('Edit Task', [
    { id:'title',    label:'Title',    placeholder:'Task title',     required:true, default: task.title },
    { id:'status',   label:'Status',   type:'select', options: ORG_KANBAN_COLS.map(c => ({ value:c, label:ORG_COL_LABELS[c] })), default: task.status },
    { id:'priority', label:'Priority', type:'select', options: [{value:'normal',label:'Normal'},{value:'high',label:'High'}], default: task.priority || 'normal' },
    { id:'due_date', label:'Due date', type:'date', default: task.due_date || '' },
  ], { confirmLabel:'Save' });
  if (!d || !d.title) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/tasks/update', { token, task_id: taskId, title: d.title, status: d.status, priority: d.priority, due_date: d.due_date || null });
    await _orgRefresh();
    toast('Task updated');
  } catch(e) { toast(e.message || 'Could not update task'); }
}

async function orgNewDoc() {
  if (!ORG) return;
  const title = await siModal.input('New Document', 'Document title', '', { confirmLabel:'Create' });
  if (!title) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/docs/save', { token, title, content: '' });
    await _orgRefresh();
    toast('Doc created');
  } catch(e) { toast(e.message || 'Could not create doc'); }
}

async function orgOpenDoc(docId) {
  const doc = ORG_DOCS.find(d => String(d.id) === String(docId));
  if (!doc) return;
  const content = await siModal.form('Edit Document', [
    { id:'content', label:'Content', type:'textarea', placeholder:'Write here…', default: doc.content || '' },
  ], { confirmLabel:'Save' });
  if (content === null) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/docs/save', { token, doc_id: docId, title: doc.title, content: content.content || '' });
    await _orgRefresh();
    toast('Doc saved');
  } catch(e) { toast(e.message || 'Could not save doc'); }
}

async function orgSendInvite() {
  if (!ORG) return;
  const email = $('os-invite-email')?.value.trim();
  if (!email || !email.includes('@')) { toast('Enter a valid email address.'); return; }
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/invite', { token, email, role: 'member' });
    if ($('os-invite-email')) $('os-invite-email').value = '';
    toast(`Invite sent to ${email}`);
  } catch(e) { toast(e.message || 'Could not send invite'); }
}

async function orgMoreMenu() {
  if (!ORG) return;
  const name = await siModal.input('Rename Space', 'Space name', ORG.name || '', { confirmLabel:'Rename' });
  if (!name) return;
  toast('Rename coming soon — contact support to change org name.');
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
  if (!ORG) { toast('You need to be part of an organization first.'); return; }
  const d = await siModal.form('Invite Team Member', [
    { id:'email', label:'Email address', type:'text', placeholder:'colleague@example.com', required:true },
    { id:'role',  label:'Role',          type:'select', options:[{value:'member',label:'Member'},{value:'manager',label:'Manager'},{value:'admin',label:'Admin'}] },
  ], { confirmLabel:'Send Invite' });
  if (!d || !d.email || !d.email.includes('@')) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/invite', { token, email: d.email, role: d.role || 'member' });
    toast(`Invite sent to ${d.email}`);
  } catch(e) { toast(e.message || 'Could not send invite'); }
}

/* ══════════════════════════════════════════════════
   PHASE 5 — TEAM CHAT
   ══════════════════════════════════════════════════ */

// ── Org Chat state ────────────────────────────────────────────
let _OC_CHANNEL  = 'general';
let _OC_SSE      = null;       // EventSource
let _OC_PRESENCE = null;       // setInterval
let _OC_CHANNELS = [];         // [{id,name,desc}]
let _OC_UNREAD   = {};         // {channelId: count}
let _OC_ONLINE   = new Set();  // set of sids currently online
let _OC_LAST_ID  = 0;          // highest message id received via SSE

// Avatar colour palette (seeded by name)
const _OC_COLOURS = ['#0d9488','#7c3aed','#d97706','#2563eb','#dc2626','#059669','#db2777','#0891b2'];
function _ocColour(name) {
  let h = 0;
  for (let i = 0; i < (name||'?').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return _OC_COLOURS[Math.abs(h) % _OC_COLOURS.length];
}

function orgChatInit() {
  if (!ORG) return;
  _ocLoadChannels();
  _ocConnectSSE();
  _ocStartPresence();
  orgChatRender();
}

async function _ocLoadChannels() {
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/channels?token=${encodeURIComponent(token)}`);
    if (!r.ok) return;
    const data = await r.json();
    _OC_CHANNELS = data.channels || [];
  } catch(_) {
    _OC_CHANNELS = [
      {id:'general',name:'general',desc:'Team-wide announcements'},
      {id:'random',name:'random',desc:'Off-topic conversations'},
    ];
  }
  // apply any locally-saved renames
  const _ocSavedNames = JSON.parse(localStorage.getItem(`sivarr_oc_names_${ORG?.id||''}`) || '{}');
  _OC_CHANNELS.forEach(ch => { if (_ocSavedNames[ch.id]) ch.name = _ocSavedNames[ch.id]; });
  _ocRenderSidebar();
}

function _ocRenderSidebar() {
  if (!ORG) return;
  const wsName = $('oc-ws-name');
  if (wsName) wsName.textContent = ORG.name || 'Workspace';

  const chList = $('oc-channels');
  if (chList) {
    chList.innerHTML = _OC_CHANNELS.map(ch => `
      <div class="oc-ch-item${ch.id === _OC_CHANNEL ? ' active' : ''}" onclick="ocSwitchChannel('${ch.id}')">
        <span class="oc-ch-hash">#</span>
        <span style="flex:1" title="Double-click to rename" ondblclick="event.stopPropagation();ocRenameChannel('${ch.id}',this)">${esc(ch.name)}</span>
        ${_OC_UNREAD[ch.id] ? '<div class="oc-ch-unread"></div>' : ''}
      </div>`).join('');
  }

  // DMs: show org members
  const dmList = $('oc-dms');
  if (dmList && ORG.members?.length) {
    dmList.innerHTML = ORG.members
      .filter(m => m.sid !== S.sid)
      .slice(0, 8)
      .map(m => {
        const online = _OC_ONLINE.has(m.sid);
        const dmId   = _ocDmId(S.sid, m.sid);
        return `<div class="oc-dm-item${_OC_CHANNEL === dmId ? ' active' : ''}" onclick="ocSwitchChannel('${dmId}')">
          <div class="oc-dm-av" style="background:${_ocColour(m.name)}">${(m.name||'?')[0].toUpperCase()}</div>
          <span style="flex:1;font-size:.82rem">${esc(m.name)}</span>
          <div class="oc-presence-dot ${online ? 'online' : 'offline'}"></div>
        </div>`;
      }).join('');
  }
}

function _ocDmId(a, b) {
  return 'dm_' + [a.slice(0,8), b.slice(0,8)].sort().join('_');
}

function ocRenameChannel(chId, el) {
  const ch = _OC_CHANNELS.find(c => c.id === chId);
  if (!ch) return;
  const oldName = ch.name;
  const inp = document.createElement('input');
  inp.className = 'oc-ch-rename';
  inp.value = oldName;
  el.replaceWith(inp);
  inp.focus(); inp.select();
  const commit = () => {
    const n = (inp.value.trim().replace(/\s+/g, '-').toLowerCase()) || oldName;
    ch.name = n;
    const key = `sivarr_oc_names_${ORG?.id || ''}`;
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    saved[chId] = n;
    localStorage.setItem(key, JSON.stringify(saved));
    _ocRenderSidebar();
    if (_OC_CHANNEL === chId) {
      const nameEl = $('oc-ch-name');
      const inputEl = $('os-chat-input');
      if (nameEl) nameEl.textContent = n;
      if (inputEl) inputEl.placeholder = `Message #${n}…`;
    }
  };
  inp.onblur = commit;
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { inp.value = oldName; inp.blur(); }
  };
}

function ocSwitchChannel(chId) {
  _OC_CHANNEL = chId;
  delete _OC_UNREAD[chId];

  // Update header
  const ch = _OC_CHANNELS.find(c => c.id === chId);
  const nameEl = $('oc-ch-name');
  const descEl = $('oc-ch-desc');
  const inputEl = $('os-chat-input');
  if (nameEl) nameEl.textContent = ch ? ch.name : chId;
  if (descEl) descEl.textContent = ch ? ch.desc : (chId.startsWith('dm_') ? 'Direct message' : '');
  if (inputEl) inputEl.placeholder = `Message ${ch ? '#' + ch.name : chId}…`;

  _ocRenderSidebar();
  orgChatRender();
}

function _ocConnectSSE() {
  if (_OC_SSE) { _OC_SSE.close(); _OC_SSE = null; }
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !ORG) return;

  _OC_SSE = new EventSource(`/api/org/chat/stream?token=${encodeURIComponent(token)}&last_id=${_OC_LAST_ID}`);
  _OC_SSE.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'announcement') {
        if (_ANN_LIST !== undefined) { _ANN_LIST.unshift(msg.ann); annRender(); }
        return;
      }
      // Track the cursor so reconnects don't re-deliver old messages
      if (msg.id && msg.id > _OC_LAST_ID) _OC_LAST_ID = msg.id;
      if (msg.channel === _OC_CHANNEL) {
        _ocAppendMsg(msg, true);
      } else {
        _OC_UNREAD[msg.channel] = (_OC_UNREAD[msg.channel] || 0) + 1;
        _ocRenderSidebar();
      }
    } catch(_) {}
  };
  _OC_SSE.onerror = () => {
    // auto-reconnect after 5s, resuming from last known message id
    setTimeout(() => { if (ORG && _OC_SSE) _ocConnectSSE(); }, 5000);
  };
}

function _ocDisconnectSSE() {
  if (_OC_SSE) { _OC_SSE.close(); _OC_SSE = null; }
  if (_OC_PRESENCE) { clearInterval(_OC_PRESENCE); _OC_PRESENCE = null; }
}

function _ocStartPresence() {
  const token = localStorage.getItem('sivarr_token') || '';
  const ping = () => {
    if (!ORG || !token) return;
    API('/api/org/presence', { token }).catch(() => {});
    fetch(`/api/org/presence?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        _OC_ONLINE = new Set((d.online || []).map(u => u.sid));
        _ocRenderPresenceBar(d.online || []);
        _ocRenderSidebar();
      }).catch(() => {});
  };
  ping();
  if (_OC_PRESENCE) clearInterval(_OC_PRESENCE);
  _OC_PRESENCE = setInterval(ping, 30000);
}

function _ocRenderPresenceBar(online) {
  const bar = $('oc-presence');
  if (!bar) return;
  if (!online.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = online.slice(0, 5).map(u => `
    <div class="oc-presence-chip">
      <div class="oc-presence-dot online"></div>
      <span>${esc(u.name.split(' ')[0])}</span>
    </div>`).join('') + (online.length > 5 ? `<span style="font-size:.68rem;color:var(--text4)">+${online.length - 5}</span>` : '');
}

async function orgChatRender() {
  const box = $('os-chat-messages');
  if (!box || !ORG) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await API('/api/org/messages', { token, channel: _OC_CHANNEL });
    const msgs = r.messages || [];
    if (!msgs.length) {
      box.innerHTML = `<div class="oc-chat-empty">No messages in #${esc(_OC_CHANNEL)} yet.<br>Be the first to say something.</div>`;
      return;
    }
    box.innerHTML = '';
    let lastAuthor = null;
    msgs.forEach(m => {
      box.appendChild(_ocBuildMsg(m, m.author_sid === lastAuthor));
      lastAuthor = m.author_sid;
    });
    box.scrollTop = box.scrollHeight;
  } catch(_) {
    box.innerHTML = '<div class="oc-chat-empty">Could not load messages.</div>';
  }
}

function _ocBuildMsg(m, continued = false) {
  const el  = document.createElement('div');
  el.className = `oc-msg${continued ? ' oc-msg-continued' : ''}`;
  const ts  = m.created_at ? new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
  const col = _ocColour(m.author_name);
  el.innerHTML = `
    <div class="oc-msg-av" style="background:${col}">${(m.author_name||'?')[0].toUpperCase()}</div>
    <div class="oc-msg-body">
      ${!continued ? `<div class="oc-msg-meta">
        <span class="oc-msg-name">${esc(m.author_name)}</span>
        <span class="oc-msg-time">${ts}</span>
      </div>` : ''}
      <div class="oc-msg-text">${esc(m.content)}</div>
    </div>`;
  return el;
}

function _ocAppendMsg(m, scroll = true) {
  const box = $('os-chat-messages');
  if (!box) return;
  // Remove empty state
  const empty = box.querySelector('.oc-chat-empty');
  if (empty) empty.remove();
  const lastMsg  = box.lastElementChild;
  const lastSid  = lastMsg?.querySelector('.oc-msg-name') ? null : lastMsg?.dataset?.sid;
  const continued = lastMsg?.dataset?.sid === m.author_sid;
  const el = _ocBuildMsg(m, continued);
  el.dataset.sid = m.author_sid;
  box.appendChild(el);
  if (scroll) box.scrollTop = box.scrollHeight;
}

async function orgChatSend() {
  if (!ORG) return;
  const inp = $('os-chat-input');
  const msg = inp ? inp.value.trim() : '';
  if (!msg) return;
  inp.value = '';
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/messages/send', { token, content: msg, channel: _OC_CHANNEL });
    // SSE will deliver the message back — no need to re-render
  } catch(e) { toast(e.message || 'Could not send message'); }
}

// ── Emoji picker ──────────────────────────────────────────────
const _OC_EMOJIS = ['😀','😂','👍','❤️','🔥','🎉','✅','👀','😅','🙏','💯','🚀',
  '😎','🤔','😬','🥳','💪','🙌','😭','🤣','😊','👏','⚡','🎯',
  '📌','📎','🔧','💡','📝','🎓','🏆','⭐'];

function ocEmojiToggle() {
  const p = $('oc-emoji-picker');
  if (!p) return;
  if (p.style.display !== 'none') { p.style.display = 'none'; return; }
  if (!p.children.length) {
    p.innerHTML = _OC_EMOJIS.map(e =>
      `<button class="oc-emoji-btn-item" onclick="ocInsertEmoji('${e}')">${e}</button>`
    ).join('');
  }
  p.style.display = 'grid';
}

function ocInsertEmoji(em) {
  const inp = $('os-chat-input');
  if (inp) { inp.value += em; inp.focus(); }
  const p = $('oc-emoji-picker');
  if (p) p.style.display = 'none';
}

// Close emoji picker on outside click
document.addEventListener('click', e => {
  const p = $('oc-emoji-picker');
  if (p && p.style.display !== 'none' && !e.target.closest('#oc-emoji-picker') && !e.target.closest('#oc-emoji-btn')) {
    p.style.display = 'none';
  }
});

/* ══════════════════════════════════════════════════
   PHASE 5 — PROJECTS
   ══════════════════════════════════════════════════ */

const PROJ_COLORS = ['#0d9488','#7c3aed','#d97706','#dc2626','#2563eb','#059669'];

async function projectNew() {
  if (!ORG) return;
  const d = await siModal.form('New Project', [
    { id:'name',  label:'Project name',           placeholder:'e.g. Website Redesign', required:true },
    { id:'desc',  label:'Description (optional)', placeholder:'What is this project about?' },
    { id:'color', label:'Color',                  type:'color', default:'#0D7A5F' },
  ], { confirmLabel:'Create Project' });
  if (!d || !d.name) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/projects/create', { token, name: d.name, description: d.desc||'', color: d.color||'#0D7A5F' });
    await _orgRefresh();
    toast('Project created');
  } catch(e) { toast(e.message || 'Could not create project'); }
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
  habit_streak:'Habit streak hits a milestone', daily_open:'I open Sivarr each day',
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
  const goals = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]').filter(g => !g.completed);
  const goalOpts = [
    { value: '', label: '— None' },
    ...goals.map(g => ({ value: String(g.id), label: g.title })),
  ];
  const f = await siModal.form('New Task', [
    { id:'title',    label:'What needs to be done?', placeholder:'e.g. Finish assignment', required:true },
    { id:'due_date', label:'Due date (optional)',    type:'date' },
    { id:'priority', label:'Priority', type:'select', default:'medium',
      options:[{value:'high',label:'High'},{value:'medium',label:'Medium'},{value:'low',label:'Low'}] },
    { id:'goalId',   label:'Link to goal (optional)', type:'select', default:'', options: goalOpts },
  ], { confirmLabel:'Add Task' });
  if (!f?.title) return;
  const d = psData();
  d.tasks = d.tasks || [];
  d.tasks.push({
    id: Date.now(), title: f.title, status:'todo', done:false, created: Date.now(),
    due_date: f.due_date || null, priority: f.priority || 'medium',
    goalId: f.goalId || null,
  });
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
        ${items.map(t => {
          const today8601 = new Date().toISOString().split('T')[0];
          const overdue   = t.due_date && t.due_date < today8601 && !t.done;
          const priColor  = t.priority === 'high' ? 'var(--red3,#f87171)' : t.priority === 'low' ? 'var(--green3,#34d399)' : 'var(--amber3,#f59e0b)';
          return `<div class="os-task-card" onclick="psMoveTask(${t.id})">
            <span class="os-task-title">${esc(t.title)}</span>
            <div style="display:flex;gap:5px;align-items:center;margin-top:4px;flex-wrap:wrap">
              ${t.priority ? `<span style="font-size:.65rem;color:${priColor}">${t.priority}</span>` : ''}
              ${t.due_date ? `<span style="font-size:.65rem;color:${overdue?'var(--red3,#f87171)':'var(--text4)'}">${overdue?'⚠ ':''}${t.due_date}</span>` : ''}
            </div>
          </div>`;
        }).join('')}
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
  if (next === 'done') {
    _recordActivity();
    if (t.goalId && S.sid) {
      try {
        const goals = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]');
        const g = goals.find(g => String(g.id) === String(t.goalId));
        if (g && !g.completed) {
          g.progress = Math.min(100, (g.progress || 0) + 10);
          if (g.progress >= 100) g.completed = true;
          localStorage.setItem(`sivarr_goals_${S.sid}`, JSON.stringify(goals));
          toast(`Goal: ${g.title} — ${g.progress}%`);
        }
      } catch(_) {}
    }
  }
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

      <!-- Template grid / launch hero -->
      ${filtered.length ? `
      <div class="ag-section-hd">
        <div class="ag-section-title">🔥 Trending this week</div>
        <span class="ag-section-link" onclick="agNav('directory');agRenderDirectory()">All agents →</span>
      </div>
      <div class="ag-grid" id="ag-grid">
        ${filtered.map(t => agTemplateCardHTML(t)).join('')}
      </div>` : `
      <div class="ag-launch-hero">
        <div class="ag-launch-icon">🚀</div>
        <div class="ag-launch-title">Marketplace is warming up</div>
        <div class="ag-launch-desc">Be among the first creators to publish templates on Sivarr and get in front of early users.</div>
        <button class="ag-tb-btn ag-tb-btn--primary" style="margin-top:8px" onclick="agNav('apply');agRenderApply()">
          <i class="ti ti-rocket"></i> Become a Creator
        </button>
      </div>`}

      <!-- Top agents section -->
      <div class="ag-section-hd" style="margin-top:${filtered.length ? 8 : 32}px">
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
      cont.innerHTML = `<div class="ag-empty" style="padding:24px 20px">
        <div class="ag-empty-icon">👋</div>
        <p>No agents yet — <span style="color:var(--accent);cursor:pointer;font-weight:600" onclick="agNav('apply');agRenderApply()">be the first to join</span>.</p>
      </div>`;
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
          : `<div class="ag-launch-hero" style="margin-top:24px">
              <div class="ag-launch-icon">🌐</div>
              <div class="ag-launch-title">No agents yet</div>
              <div class="ag-launch-desc">Sivarr Agents is in early access. Apply now and get prime visibility as one of the founding creators.</div>
              <button class="ag-tb-btn ag-tb-btn--primary" style="margin-top:8px" onclick="agNav('apply');agRenderApply()">
                <i class="ti ti-user-plus"></i> Apply to become an agent
              </button>
            </div>`}
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
  const dots = [1,2,3,4,5].map(i =>
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
      <div class="si-ob-emoji">🔗</div>
      <div class="si-ob-title">Connect your tools</div>
      <div class="si-ob-sub">Link your favourite apps to supercharge your workspace.</div>
      <div class="si-ob-int-grid">
        <button class="si-ob-int-btn ${_GCAL_CONNECTED?'done':''}" onclick="gcalConnect()">
          <span class="si-ob-int-icon">📅</span>
          <span class="si-ob-int-label">Google Calendar</span>
        </button>
        <button class="si-ob-int-btn ${_GITHUB_CONNECTED?'done':''}" onclick="githubConnect()">
          <span class="si-ob-int-icon">🐙</span>
          <span class="si-ob-int-label">GitHub</span>
        </button>
        <button class="si-ob-int-btn ${_MONO_CONNECTED?'done':''}" onclick="monoConnect()">
          <span class="si-ob-int-icon">🏦</span>
          <span class="si-ob-int-label">Mono Bank</span>
        </button>
      </div>
      <div class="si-ob-actions">
        <button class="si-ob-btn-sec" onclick="siObPrev()">← Back</button>
        <button class="si-ob-btn-pri" onclick="siObNext()">Finish →</button>
      </div>`;
  } else if (_siObStep === 5) {
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
    <div class="si-ob-logo">Sivarr</div>
    <div class="si-ob-dots">${dots}</div>
    ${content}`;
}

function siObSelectRole(role, el) {
  _siObRole = role;
  document.querySelectorAll('.si-ob-role-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
}

function siObNext() {
  if (_siObStep < _OB_TOTAL_STEPS) { _siObStep++; siObRender(); }
  else siObFinish();
}

function siObPrev() {
  if (_siObStep > 1) { _siObStep--; siObRender(); }
}

// ═══════════════════════ NOTIFICATIONS ══════════════════════════

const NOTIF_KEY = () => `sivarr_notifs_${S.sid || 'guest'}`;

function _buildNotifs() {
  if (!S.sid) return;
  const today8601    = new Date().toISOString().split('T')[0];
  const nowMs        = Date.now();
  const existing     = JSON.parse(localStorage.getItem(NOTIF_KEY()) || '[]');
  const existingIds  = new Set(existing.map(n => n.id));
  const fresh        = [];

  try {
    // Overdue tasks
    const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]')
      .filter(t => !t.done && t.date && new Date(t.date) < new Date(today8601));
    tasks.slice(0, 3).forEach(t => {
      const id = `overdue_${t.id}`;
      if (!existingIds.has(id))
        fresh.push({ id, type:'overdue', icon:'⏰', msg:`Overdue: "${t.title.slice(0,40)}"`, read:false, ts: nowMs });
    });

    // Goals with deadline ≤ 3 days
    const goals = JSON.parse(localStorage.getItem(`sivarr_goals_${S.sid}`) || '[]')
      .filter(g => !g.completed && g.deadline);
    goals.forEach(g => {
      const days = Math.ceil((new Date(g.deadline) - new Date(today8601)) / 86400000);
      if (days >= 0 && days <= 3) {
        const id = `goal_deadline_${g.id}`;
        if (!existingIds.has(id))
          fresh.push({ id, type:'deadline', icon:'🎯', msg:`Goal deadline in ${days === 0 ? 'today' : days + 'd'}: "${g.title.slice(0,35)}"`, read:false, ts: nowMs });
      }
    });

    // Habit streak at risk (streak > 3, not done today)
    const habits = JSON.parse(localStorage.getItem(`sivarr_habits_${S.sid}`) || '[]');
    const streakHabit = habits.find(h => (h.streak || 0) >= 3 && !(h.completions || []).includes(today8601));
    if (streakHabit) {
      const id = `streak_risk_${today8601}`;
      if (!existingIds.has(id))
        fresh.push({ id, type:'streak', icon:'🔥', msg:`${streakHabit.streak}-day streak at risk — complete "${streakHabit.title.slice(0,30)}"`, read:false, ts: nowMs });
    }

    // Journal not written in > 3 days
    const jnl = JSON.parse(localStorage.getItem(`sivarr_journal_${S.sid}`) || '[]');
    if (jnl.length) {
      const daysSince = Math.floor((nowMs - new Date(jnl[0].date + 'T12:00:00').getTime()) / 86400000);
      if (daysSince >= 3) {
        const id = `journal_gap_${today8601}`;
        if (!existingIds.has(id))
          fresh.push({ id, type:'journal', icon:'📓', msg:`Last journal entry was ${daysSince} days ago — write something today.`, read:false, ts: nowMs });
      }
    }
  } catch(_) {}

  if (fresh.length) {
    const merged = [...fresh, ...existing].slice(0, 20);
    localStorage.setItem(NOTIF_KEY(), JSON.stringify(merged));
  }

  _renderNotifBadge();
}

function _renderNotifBadge() {
  const badge = $('notif-badge'); if (!badge) return;
  const notifs = JSON.parse(localStorage.getItem(NOTIF_KEY()) || '[]');
  const unread = notifs.filter(n => !n.read).length;
  badge.style.display = unread > 0 ? 'block' : 'none';
}

function notifToggle() {
  const panel = $('notif-panel'); if (!panel) return;
  const open  = panel.style.display !== 'none';
  if (open) { panel.style.display = 'none'; return; }
  _renderNotifList();
  panel.style.display = 'block';
  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function _close(e) {
      if (!$('notif-panel')?.contains(e.target) && e.target.id !== 'notif-btn' && !$('notif-btn')?.contains(e.target)) {
        if ($('notif-panel')) $('notif-panel').style.display = 'none';
        document.removeEventListener('click', _close);
      }
    });
  }, 0);
}

function _renderNotifList() {
  const list   = $('notif-list');  if (!list) return;
  const notifs = JSON.parse(localStorage.getItem(NOTIF_KEY()) || '[]');

  if (!notifs.length) {
    list.innerHTML = `<div style="padding:24px;text-align:center;font-size:.82rem;color:var(--text4)">You're all caught up 👌</div>`;
    return;
  }

  const NAV_MAP = { overdue:'flux', deadline:'goals', streak:'habits', journal:'journal' };
  list.innerHTML = notifs.map(n => `
    <div onclick="notifAction('${n.id}')" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;background:${n.read ? 'transparent' : 'var(--teal)08'};transition:background .15s"
         onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='${n.read ? 'transparent' : 'var(--teal)08'}'">
      <span style="font-size:1.1rem;flex-shrink:0;margin-top:1px">${n.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.8rem;color:var(--text);line-height:1.45">${esc(n.msg)}</div>
      </div>
      ${!n.read ? `<div style="width:7px;height:7px;background:var(--teal);border-radius:50%;flex-shrink:0;margin-top:5px"></div>` : ''}
    </div>`).join('');

  // store nav map for onclick
  list._navMap = NAV_MAP;
  notifMarkAllRead();
}

function notifAction(id) {
  const notifs  = JSON.parse(localStorage.getItem(NOTIF_KEY()) || '[]');
  const n       = notifs.find(x => x.id === id);
  if (!n) return;
  const dest = { overdue:'flux', deadline:'goals', streak:'habits', journal:'journal' }[n.type];
  if (dest) nav(dest, null);
  if ($('notif-panel')) $('notif-panel').style.display = 'none';
}

function notifMarkAllRead() {
  const notifs = JSON.parse(localStorage.getItem(NOTIF_KEY()) || '[]').map(n => ({ ...n, read: true }));
  localStorage.setItem(NOTIF_KEY(), JSON.stringify(notifs));
  _renderNotifBadge();
}

// ═══════════════════════════ FEEDBACK ═══════════════════════════

let _fbRating = 0;

function openFeedback() {
  _fbRating = 0;
  const modal = $('feedback-modal'); if (!modal) return;
  const txt = $('fb-text');   if (txt) txt.value = '';
  const ferr = $('fb-error'); if (ferr) { ferr.style.display = 'none'; ferr.textContent = ''; }
  document.querySelectorAll('.fb-star').forEach(s => s.classList.remove('active'));
  modal.style.display = 'flex';
  setTimeout(() => txt?.focus(), 50);
}

function closeFeedback() {
  const modal = $('feedback-modal'); if (modal) modal.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
//  FLUTTERWAVE BILLING
// ═══════════════════════════════════════════════════════════════

async function flutterwaveSubscribe(planId) {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) { toast('Sign in to subscribe.'); return; }
  try {
    const r = await API('/api/billing/flutterwave/subscribe', { token, plan_id: planId });
    if (r.payment_url) {
      sessionStorage.setItem('flw_billing_plan', planId);
      window.location.href = r.payment_url;
    }
  } catch(e) {
    toast(e.message || 'Flutterwave payment failed. Try Paystack instead.');
  }
}

async function flutterwaveVerify(ref, planId) {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/billing/flutterwave/verify/${encodeURIComponent(ref)}?token=${encodeURIComponent(token)}&plan_id=${encodeURIComponent(planId || '')}`);
    const d = await r.json();
    if (d.ok) {
      await billingLoadStatus();
      _unlockAfterPayment(d.name || planId || 'Pro');
    }
  } catch(e) {
    toast('Could not verify payment — please contact support.');
  }
}

// ═══════════════════════════════════════════════════════════════
//  MONO OPEN BANKING INTEGRATION
// ═══════════════════════════════════════════════════════════════

let _MONO_CONNECTED   = false;
let _MONO_ACCOUNT     = null;
let _MONO_PUBLIC_KEY  = '';

async function monoCheckStatus() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/integrations/mono/status?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _MONO_CONNECTED = d.connected;
    integrationsRender();
    if (_MONO_CONNECTED) monoLoadAccount();
  } catch(_) {}
}

async function monoLoadAccount() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !_MONO_CONNECTED) return;
  try {
    const r = await fetch(`/api/integrations/mono/account?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _MONO_ACCOUNT = d;
    monoRender();
  } catch(_) {}
}

function monoConnect() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) { toast('Sign in first.'); return; }
  if (!_MONO_PUBLIC_KEY) {
    fetch(`/api/integrations/mono/status?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        _MONO_PUBLIC_KEY = d.public_key || '';
        _monoOpenWidget(token);
      })
      .catch(() => _monoOpenWidget(token));
    return;
  }
  _monoOpenWidget(token);
}

function _monoOpenWidget(token) {
  if (typeof MonoConnect === 'undefined') {
    toast('Mono Connect widget not loaded. Check your Mono public key.');
    return;
  }
  const mono = new MonoConnect({
    key: _MONO_PUBLIC_KEY,
    onSuccess: async ({ code }) => {
      try {
        const r = await API('/api/integrations/mono/auth', { token, code });
        if (r.ok) {
          _MONO_CONNECTED = true;
          toast('Bank account connected via Mono!');
          monoLoadAccount();
          integrationsRender();
        }
      } catch(e) {
        toast(e.message || 'Mono auth failed.');
      }
    },
    onClose: () => {},
  });
  mono.open();
}

function monoRender() {
  const container = $('mono-account-container');
  if (!container) return;
  if (!_MONO_CONNECTED || !_MONO_ACCOUNT) {
    container.innerHTML = `
      <div class="mono-connect-card">
        <div class="mono-logo">M</div>
        <div class="mono-connect-title">Connect your bank</div>
        <div class="mono-connect-desc">Link your African bank account via Mono to view your balance and transactions inside Sivarr.</div>
        <button class="mono-connect-btn" onclick="monoConnect()"><span style="font-weight:900">M</span> Connect Bank</button>
      </div>`;
    return;
  }
  const acc  = _MONO_ACCOUNT?.account?.data || _MONO_ACCOUNT?.account || {};
  const txns = _MONO_ACCOUNT?.transactions || [];
  const balance = acc.balance ? `₦${(acc.balance / 100).toLocaleString()}` : '—';
  container.innerHTML = `
    <div class="mono-account-card">
      <div class="mono-acc-head">
        <div class="mono-acc-icon">M</div>
        <div>
          <div class="mono-acc-name">${esc(acc.name || 'Account')}</div>
          <div class="mono-acc-bank">${esc(acc.institution?.name || '')} · ${esc(acc.accountNumber || '')}</div>
        </div>
      </div>
      <div class="mono-bal-row"><div class="mono-bal-label">Available Balance</div><div class="mono-bal-val">${balance}</div></div>
    </div>
    <div style="font-size:.82rem;font-weight:700;color:var(--fg);margin:12px 0 6px">Recent Transactions</div>
    <div class="mono-txn-list">
      ${txns.slice(0,10).map(t => {
        const amt = t.amount ? `₦${(t.amount/100).toLocaleString()}` : '';
        const cls = t.type === 'credit' ? 'credit' : 'debit';
        const sign = t.type === 'credit' ? '+' : '-';
        return `<div class="mono-txn-row">
          <div class="mono-txn-narration">${esc(t.narration || t.description || 'Transaction')}</div>
          <div class="mono-txn-date">${t.date ? t.date.slice(0,10) : ''}</div>
          <div class="mono-txn-amount ${cls}">${sign}${amt}</div>
        </div>`;
      }).join('') || '<div class="sp-empty">No transactions yet.</div>'}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  ORG ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════

let _ANN_LIST = [];

async function annLoad() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/org/announcements?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _ANN_LIST = d.announcements || [];
    annRender();
  } catch(_) {}
}

function annRender() {
  const feed = $('ann-feed');
  if (!feed) return;
  if (!_ANN_LIST.length) {
    feed.innerHTML = `<div class="os-empty" style="padding:40px 0;text-align:center;color:var(--muted)"><i class="ti ti-speakerphone" style="font-size:2rem;display:block;margin-bottom:8px"></i>No announcements yet.</div>`;
    return;
  }
  feed.innerHTML = _ANN_LIST.map(a => `
    <div class="ann-card ${a.pinned ? 'pinned' : ''}">
      <div class="ann-card-head">
        ${a.pinned ? '<span class="ann-pin-badge">Pinned</span>' : ''}
        <div class="ann-card-title">${esc(a.title)}</div>
        ${_orgIsAdmin() ? `<button class="ann-del-btn" onclick="annDelete('${esc(a.id)}')"><i class="ti ti-trash"></i></button>` : ''}
      </div>
      <div class="ann-card-body">${esc(a.body)}</div>
      <div class="ann-card-meta">By ${esc(a.author_name)} · ${_fmtTs(a.created_at)}</div>
    </div>`).join('');
}

function _orgIsAdmin() {
  const role = (typeof ORG !== 'undefined' && ORG) ? (ORG_MEMBERS.find(m => m.sid === S.sid)?.role || '') : '';
  return role === 'owner' || role === 'admin';
}

function _fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString('en-NG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  } catch(_) { return ts || ''; }
}

async function annPost() {
  const title  = $('ann-title-input')?.value.trim() || '';
  const body   = $('ann-body-input')?.value.trim() || '';
  const pinned = $('ann-pin-chk')?.checked || false;
  if (!title) { toast('Enter a title.'); return; }
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await API('/api/org/announce', { token, title, body, pinned });
    $('ann-title-input').value = '';
    $('ann-body-input').value  = '';
    if ($('ann-pin-chk')) $('ann-pin-chk').checked = false;
    toast('Announcement posted!');
    annLoad();
  } catch(e) {
    toast(e.message || 'Failed to post announcement.');
  }
}

async function annDelete(annId) {
  const ok = await siModal.confirm('Delete this announcement?', { danger: true });
  if (!ok) return;
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await fetch(`/api/org/announce/${encodeURIComponent(annId)}?token=${encodeURIComponent(token)}`, { method:'DELETE' });
    toast('Deleted.');
    annLoad();
  } catch(e) {
    toast('Delete failed.');
  }
}

// ═══════════════════════════════════════════════════════════════
//  ORG ANALYTICS DASHBOARD
// ═══════════════════════════════════════════════════════════════

async function orgAnalyticsLoad() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/org/analytics?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    orgAnalyticsRender(d);
  } catch(_) {
    toast('Could not load analytics.');
  }
}

function orgAnalyticsRender(d) {
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('an-members',    d.members ?? '—');
  set('an-completion', d.completion_rate != null ? d.completion_rate + '%' : '—');
  set('an-tasks-total', d.tasks_total ?? '—');
  set('an-tasks-done',  d.tasks_done ?? '—');
  set('an-messages',   d.messages ?? '—');
  set('an-docs',       d.docs ?? '—');

  // Message trend bar chart
  const chart = $('an-msg-chart');
  if (chart) {
    const trend = d.msg_trend || [];
    if (!trend.length) {
      chart.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:10px">No message data yet.</div>';
    } else {
      const max = Math.max(...trend.map(t => t.cnt), 1);
      chart.innerHTML = trend.map(t => `
        <div class="an-bar-col">
          <div class="an-bar-fill" style="height:${Math.round((t.cnt / max) * 85)}px"></div>
          <div class="an-bar-lbl">${(t.day || '').slice(5)}</div>
        </div>`).join('');
    }
  }

  // Status breakdown
  const statusGrid = $('an-status-grid');
  if (statusGrid && d.status_breakdown) {
    const total = Object.values(d.status_breakdown).reduce((a, b) => a + b, 0) || 1;
    const statuses = [
      { key: 'todo',    label: 'To Do',      cls: 'todo' },
      { key: 'in_progress', label: 'In Progress', cls: 'inprog' },
      { key: 'done',    label: 'Done',        cls: 'done' },
      { key: 'blocked', label: 'Blocked',     cls: 'blocked' },
    ];
    statusGrid.innerHTML = statuses.map(s => {
      const cnt = d.status_breakdown[s.key] || 0;
      const pct = Math.round((cnt / total) * 100);
      return `<div class="an-status-row">
        <div class="an-status-label">${s.label}</div>
        <div class="an-status-bar-wrap"><div class="an-status-bar-fill ${s.cls}" style="width:${pct}%"></div></div>
        <div class="an-status-count">${cnt}</div>
      </div>`;
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════════
//  EMAIL TASK REMINDER (triggered on login if tasks due soon)
// ═══════════════════════════════════════════════════════════════

async function _sendTaskReminderIfNeeded() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token || !S.sid) return;
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  try {
    const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${S.sid}`) || '[]')
      .filter(t => !t.done && t.date && (t.date === today || t.date === tomorrow))
      .slice(0, 5)
      .map(t => ({ title: t.title, due: t.date === today ? 'today' : 'tomorrow' }));
    if (!tasks.length) return;
    await API('/api/notify/tasks', { token, tasks });
  } catch(_) {}
}

// ═══════════════════════════════════════════════════════════════
//  MOBILE BOTTOM NAV — update active state
// ═══════════════════════════════════════════════════════════════

// Maps every panel name → which bottom nav button lights up
// 3-tab mobile nav map: panel name → tab button id suffix
const _MOB_NAV_MAP = {
  // Today tab
  home: 'today', habits: 'today', journal: 'today', calendar: 'today',
  stats: 'today', progress: 'today', announcements: 'today',
  // AI tab
  chat: 'ai', quiz: 'ai', lab: 'ai', studyplan: 'ai',
  // Me tab
  'me-mobile': 'me', goals: 'me', settings: 'me', profile: 'me',
  opportunities: 'me', community: 'me', library: 'me',
  // fallback: Tasks/Flux/Notes → Today
  flux: 'today', notes: 'today', documenthub: 'today',
  org: 'me', team: 'me', orgchat: 'me', projects: 'me',
};

function navMobileMe() {
  nav('me-mobile', null);
  renderMobileMePanel();
}

function renderMobileMePanel() {
  const el = $('mob-me-content');
  if (!el || !S.sid) return;

  const habits  = JSON.parse(localStorage.getItem(`sivarr_habits_${S.sid}`)  || '[]');
  const todayStr = new Date().toISOString().split('T')[0];
  const doneToday = habits.filter(h => (h.completions || []).includes(todayStr)).length;
  const maxStreak = habits.length ? Math.max(...habits.map(h => h.streak || 0), 0) : 0;
  const activeGoals = (typeof GL_GOALS !== 'undefined' ? GL_GOALS : []).filter(g => !g.completed).length;
  const initial = (S.name?.[0] || '?').toUpperCase();
  const planName = (typeof _BILLING_STATUS !== 'undefined' && _BILLING_STATUS?.name) || 'Free';

  el.innerHTML = `
    <!-- Profile card -->
    <div class="me-profile-card">
      <div class="me-av">${initial}</div>
      <div>
        <div class="me-name">${esc(S.name || 'My profile')}</div>
        <div class="me-plan">${planName} plan · ${esc(S.email || '')}</div>
      </div>
    </div>

    <!-- Stats -->
    <div class="me-stats">
      <div class="me-stat">
        <div class="me-stat-val">${maxStreak}</div>
        <div class="me-stat-lbl">Best streak</div>
      </div>
      <div class="me-stat">
        <div class="me-stat-val">${doneToday}/${habits.length}</div>
        <div class="me-stat-lbl">Done today</div>
      </div>
      <div class="me-stat">
        <div class="me-stat-val">${activeGoals}</div>
        <div class="me-stat-lbl">Active goals</div>
      </div>
    </div>

    <!-- Quick links -->
    <div class="me-links">
      <button class="me-link-btn" onclick="nav('goals',null)">
        <div class="me-link-icon">🎯</div>
        <div class="me-link-label">Goals</div>
        <div class="me-link-sub">${activeGoals} active</div>
      </button>
      <button class="me-link-btn" onclick="nav('habits',null)">
        <div class="me-link-icon">🔥</div>
        <div class="me-link-label">Habits</div>
        <div class="me-link-sub">${doneToday}/${habits.length} today</div>
      </button>
      <button class="me-link-btn" onclick="nav('journal',null)">
        <div class="me-link-icon">✍️</div>
        <div class="me-link-label">Journal</div>
        <div class="me-link-sub">Write today's entry</div>
      </button>
      <button class="me-link-btn" onclick="nav('settings',null)">
        <div class="me-link-icon">⚙️</div>
        <div class="me-link-label">Settings</div>
        <div class="me-link-sub">Account & appearance</div>
      </button>
    </div>

    <button class="me-sign-out" onclick="logout()">Sign out</button>
  `;
}

function _updateMobileNav(panelName) {
  document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
  const target = _MOB_NAV_MAP[panelName];
  if (target) {
    const btn = $('mob-' + target);
    if (btn) btn.classList.add('active');
  }
  if (window.innerWidth <= 720) closeMobileSidebar();
}

// ═══════════════════════════════════════════════════════════════
//  DOC EDITOR ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════

function dhFontSize(size) {
  if (!size) return;
  document.execCommand('fontSize', false, '7');
  document.querySelectorAll('#dh-editor font[size="7"]').forEach(el => {
    el.removeAttribute('size');
    el.style.fontSize = size;
  });
  $('dh-editor')?.focus();
}

let _dhSavedRange = null;

function dhInsertLink() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) _dhSavedRange = sel.getRangeAt(0).cloneRange();
  const txt = sel?.toString().trim() || '';
  const input = $('dh-link-text');
  if (input && txt) input.value = txt;
  const modal = $('dh-link-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => ($('dh-link-url') || $('dh-link-text'))?.focus(), 50);
}

function dhConfirmLink() {
  const text = $('dh-link-text')?.value.trim() || '';
  let   url  = $('dh-link-url')?.value.trim()  || '';
  if (!url) { toast('Enter a URL.'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const modal = $('dh-link-modal');
  if (modal) modal.style.display = 'none';
  $('dh-editor')?.focus();
  const sel = window.getSelection();
  if (_dhSavedRange) {
    sel.removeAllRanges();
    sel.addRange(_dhSavedRange);
  }
  const link = `<a href="${url}" target="_blank" rel="noopener">${text || url}</a>`;
  document.execCommand('insertHTML', false, link);
  _dhSavedRange = null;
  dhAutoSave();
}

// ═══════════════════════════════════════════════════════════════
//  ONBOARDING — Step 5 (connect integration) + nav updates
// ═══════════════════════════════════════════════════════════════

const _OB_TOTAL_STEPS = 5;

function fbSetRating(v) {
  _fbRating = v;
  document.querySelectorAll('.fb-star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.v) <= v);
  });
}

async function submitFeedback() {
  const text = $('fb-text')?.value.trim() || '';
  const ferr = $('fb-error');
  if (!text) {
    if (ferr) { ferr.textContent = 'Please write something before sending.'; ferr.style.display = 'block'; }
    return;
  }
  const token = localStorage.getItem('sivarr_token') || '';
  const page  = window.location.pathname;
  try {
    await API('/api/feedback', { token, text, rating: _fbRating || null, page });
    closeFeedback();
    track('Feedback_Sent', { rating: _fbRating });
  } catch(e) {
    if (ferr) { ferr.textContent = e.message || 'Failed to send — try again.'; ferr.style.display = 'block'; }
  }
}

// ═══════════════════════════════════════════════════════════════
//  PAYSTACK FINANCIAL DASHBOARD  — ps* functions
// ═══════════════════════════════════════════════════════════════

const _PS_TABS = ['overview','transactions','balance','settlements','customers','refunds','analytics','connect'];
let _psConnected = false;
let _psTxnPage   = 1;
let _psTxnTotal  = 0;

function psGoTab(name, btn) {
  _PS_TABS.forEach(t => {
    const tb = $('ps-tab-' + t), pn = $('ps-pane-' + t);
    if (tb) tb.classList.remove('on');
    if (pn) { pn.style.display = 'none'; pn.classList.remove('on'); }
  });
  const at = $('ps-tab-' + name), ap = $('ps-pane-' + name);
  if (at) at.classList.add('on');
  if (ap) { ap.style.display = 'flex'; ap.classList.add('on'); }
  if (btn) { document.querySelectorAll('.ps-tab').forEach(b => b.classList.remove('on')); btn.classList.add('on'); }

  if (name === 'overview')     psLoadOverview();
  if (name === 'transactions') { _psTxnPage = 1; psLoadTransactions(); }
  if (name === 'balance')      psLoadBalance();
  if (name === 'settlements')  psLoadSettlements();
  if (name === 'customers')    psLoadCustomers();
  if (name === 'refunds')      psLoadRefunds();
  if (name === 'analytics')    psLoadAnalytics();
  if (name === 'connect')      psCheckConnectStatus();
}

async function psFinancialsLoad() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  try {
    const r = await fetch(`/api/org/paystack/status?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _psConnected = !!d.connected;
  } catch(e) { _psConnected = false; }

  if (!_psConnected) {
    psGoTab('connect', null);
    const btn = $('ps-tab-connect'); if (btn) btn.classList.add('on');
  } else {
    psGoTab('overview', null);
    const btn = $('ps-tab-overview'); if (btn) btn.classList.add('on');
  }
}

function _psLoading(section, on) {
  const ld = $('ps-loading-' + section);
  const ct = $('ps-' + section + '-content') || $('ps-' + section + '-table') || null;
  if (ld) ld.style.display = on ? 'flex' : 'none';
  if (ct) ct.style.display = on ? 'none' : 'block';
}

function _psNgn(kobo) {
  return '₦' + Number(kobo / 100).toLocaleString('en-NG', {minimumFractionDigits: 0, maximumFractionDigits: 0});
}

function _psDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

function _psBadge(status) {
  const map = { success:'ps-badge-s', failed:'ps-badge-f', pending:'ps-badge-w',
                settled:'ps-badge-s', processing:'ps-badge-w', processed:'ps-badge-s',
                reversed:'ps-badge-n', abandoned:'ps-badge-n', active:'ps-badge-s',
                refunded:'ps-badge-n', awaiting:'ps-badge-a' };
  const cls = map[status?.toLowerCase()] || 'ps-badge-n';
  return `<span class="ps-badge ${cls}">${status || '—'}</span>`;
}

async function psLoadOverview() {
  if (!_psConnected) return;
  _psLoading('overview', true);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/paystack/overview?token=${encodeURIComponent(token)}`);
    if (!r.ok) { _psShowNotConnected(); return; }
    const d = await r.json();
    _psLoading('overview', false);
    const oc = $('ps-overview-content'); if (oc) oc.style.display = 'block';

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('ps-vol',          _psNgn(d.volume || 0));
    set('ps-txn-count',    (d.txn_count || 0).toLocaleString());
    set('ps-success-rate', `${d.success_rate || 0}% success rate`);
    set('ps-avail-bal',    _psNgn(d.available_bal || 0));
    set('ps-pending-stl',  _psNgn(d.pending_stl_amt || 0));
    set('ps-pending-date', d.pending_stl_date ? 'T+1 · ' + _psDate(d.pending_stl_date) : '');

    // Channels
    const chEl = $('ps-channels');
    if (chEl) {
      const ch = d.channels || {};
      const total = Object.values(ch).reduce((a, b) => a + b, 0) || 1;
      const colors = { card:'var(--teal)', bank:'var(--blue)', ussd:'var(--amber3)', mobile_money:'var(--purple)' };
      const labels = { card:'Card payments', bank:'Bank transfer', ussd:'USSD', mobile_money:'Mobile money' };
      chEl.innerHTML = Object.entries(ch).map(([k, v]) => {
        const pct = Math.round(v / total * 100);
        return `<div class="ps-ch-row">
          <div class="ps-ch-label"><span>${labels[k] || k}</span><span class="ps-ch-val" style="color:${colors[k]||'var(--teal)'}">${pct}%</span></div>
          <div class="ps-ch-bar-bg"><div class="ps-ch-bar-fill" style="width:${pct}%;background:${colors[k]||'var(--teal)'}"></div></div>
        </div>`;
      }).join('') || '<div style="color:var(--text4);font-size:.8rem">No channel data yet.</div>';
    }

    // AI insights
    const ins = $('ps-ai-insights');
    if (ins) {
      const sr = d.success_rate || 0;
      const vol = _psNgn(d.volume || 0);
      ins.innerHTML = `
        <div class="ps-insight ps-insight-g"><i class="ti ti-trending-up" style="color:var(--teal);margin-right:5px"></i>
          Total volume of <strong>${vol}</strong> across ${(d.success_count||0)} successful transactions this period.
        </div>
        <div class="ps-insight ${sr < 90 ? 'ps-insight-a' : 'ps-insight-g'}"><i class="ti ti-${sr < 90 ? 'alert-triangle' : 'circle-check'}" style="color:var(--${sr < 90 ? 'amber3' : 'teal'});margin-right:5px"></i>
          <strong>${sr}% success rate</strong> — ${sr < 90 ? 'above the 5% failure threshold. Review failed transactions for decline patterns.' : 'excellent, below the 5% industry failure threshold.'}.
        </div>
        <div class="ps-insight ps-insight-b"><i class="ti ti-building-bank" style="color:var(--blue);margin-right:5px"></i>
          Available balance: <strong>${_psNgn(d.available_bal||0)}</strong>. ${d.pending_stl_amt ? `Settlement of ${_psNgn(d.pending_stl_amt)} expected ${d.pending_stl_date ? 'on ' + _psDate(d.pending_stl_date) : 'soon'}.` : 'No pending settlements.'}
        </div>`;
    }

    // Recent transactions
    const rt = $('ps-recent-txns');
    if (rt && d.recent_txns) {
      rt.innerHTML = `<div class="ps-th-row" style="grid-template-columns:1fr 90px 110px 80px 80px">
          <span>Customer</span><span>Amount</span><span>Channel</span><span>Date</span><span>Status</span>
        </div>` +
        d.recent_txns.map(t => `<div class="ps-tr" style="grid-template-columns:1fr 90px 110px 80px 80px">
          <div><div class="ps-cust-name">${t.customer_name || t.customer || '—'}</div><div class="ps-cust-email">${t.customer}</div></div>
          <span class="ps-amount ${t.status==='success'?'ps-amount-g':'ps-amount-r'}">${_psNgn(t.amount)}</span>
          <span style="color:var(--text3);font-size:.78rem">${_psChan(t)}</span>
          <span style="color:var(--text4);font-size:.78rem">${_psDate(t.paid_at)}</span>
          ${_psBadge(t.status)}
        </div>`).join('');
    }
  } catch(e) { _psLoading('overview', false); toast('Could not load financial data.'); }
}

function _psChan(t) {
  let s = (t.channel || '').replace('_', ' ');
  if (t.card_type) s += ` · ${t.card_type}`;
  if (t.last4)     s += ` ···${t.last4}`;
  return s || '—';
}

let _psTxnData = [];
async function psLoadTransactions() {
  if (!_psConnected) return;
  _psLoading('transactions', true);
  const el = $('ps-txn-table'); if (el) el.innerHTML = '';
  const foot = $('ps-txn-footer'); if (foot) foot.style.display = 'none';
  const token = localStorage.getItem('sivarr_token') || '';
  const status  = $('ps-txn-status')?.value  || '';
  const channel = $('ps-txn-channel')?.value || '';
  _psTxnPage = 1;
  try {
    const r = await fetch(`/api/org/paystack/transactions?token=${encodeURIComponent(token)}&page=1&perPage=20&status=${status}&channel=${channel}`);
    const d = await r.json();
    _psTxnData = d.transactions || [];
    _psTxnTotal = d.total || 0;
    _psLoading('transactions', false);
    _psRenderTxnTable(_psTxnData);
    const shown = $('ps-txn-shown'); if (shown) shown.textContent = _psTxnData.length;
    const tot   = $('ps-txn-total'); if (tot)   tot.textContent   = _psTxnTotal;
    if (foot && _psTxnTotal > _psTxnData.length) foot.style.display = 'flex';
  } catch(e) { _psLoading('transactions', false); }
}

async function psLoadMoreTxns() {
  const token = localStorage.getItem('sivarr_token') || '';
  const status  = $('ps-txn-status')?.value  || '';
  const channel = $('ps-txn-channel')?.value || '';
  _psTxnPage++;
  try {
    const r = await fetch(`/api/org/paystack/transactions?token=${encodeURIComponent(token)}&page=${_psTxnPage}&perPage=20&status=${status}&channel=${channel}`);
    const d = await r.json();
    _psTxnData = [..._psTxnData, ...(d.transactions || [])];
    _psRenderTxnTable(_psTxnData);
    const shown = $('ps-txn-shown'); if (shown) shown.textContent = _psTxnData.length;
    if (_psTxnData.length >= _psTxnTotal) { const foot = $('ps-txn-footer'); if (foot) foot.style.display = 'none'; }
  } catch(e) {}
}

function _psRenderTxnTable(txns) {
  const el = $('ps-txn-table'); if (!el) return;
  el.innerHTML = `<div class="ps-th-row" style="grid-template-columns:130px 1fr 90px 110px 70px 90px 80px">
      <span>Reference</span><span>Customer</span><span>Amount</span><span>Channel</span><span>Fees</span><span>Date</span><span>Status</span>
    </div>` + txns.map(t => `<div class="ps-tr" style="grid-template-columns:130px 1fr 90px 110px 70px 90px 80px">
      <span class="ps-ref">${t.reference}</span>
      <div><div class="ps-cust-name">${t.customer_name || t.customer || '—'}</div><div class="ps-cust-email">${t.customer}</div></div>
      <span class="ps-amount ${t.status==='success'?'ps-amount-g':'ps-amount-r'}">${_psNgn(t.amount)}</span>
      <span style="color:var(--text3);font-size:.78rem">${_psChan(t)}</span>
      <span style="color:var(--text4);font-size:.78rem">${t.fees ? _psNgn(t.fees) : '—'}</span>
      <span style="color:var(--text4);font-size:.78rem">${_psDate(t.paid_at)}</span>
      ${_psBadge(t.status)}
    </div>`).join('') || '<div style="padding:24px;color:var(--text4);text-align:center;font-size:.82rem">No transactions found.</div>';
}

async function psLoadBalance() {
  if (!_psConnected) return;
  _psLoading('balance', true);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/paystack/balance?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _psLoading('balance', false);
    const ct = $('ps-balance-content'); if (ct) ct.style.display = 'block';
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('ps-bal-avail',    _psNgn(d.available || 0));
    set('ps-bal-pending',  '—');
    set('ps-bal-currency', d.currency || 'NGN');
    const hist = $('ps-bal-history');
    if (hist && d.history) {
      hist.innerHTML = `<div class="ps-th-row" style="grid-template-columns:90px 1fr 110px 100px">
          <span>Date</span><span>Activity</span><span>Type</span><span>Change</span>
        </div>` + d.history.map(h => `<div class="ps-tr" style="grid-template-columns:90px 1fr 110px 100px">
          <span style="color:var(--text4);font-size:.78rem">${_psDate(h.date)}</span>
          <span style="font-weight:500">${h.desc}</span>
          ${_psBadge('success')}
          <span class="ps-amount ${h.change >= 0 ? 'ps-amount-g' : 'ps-amount-r'}">${h.change >= 0 ? '+' : ''}${_psNgn(Math.abs(h.change))}</span>
        </div>`).join('') || '<div style="padding:16px;color:var(--text4);font-size:.8rem">No history yet.</div>';
    }
  } catch(e) { _psLoading('balance', false); }
}

async function psLoadSettlements() {
  if (!_psConnected) return;
  _psLoading('settlements', true);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/paystack/settlements?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _psLoading('settlements', false);
    const ct = $('ps-settlements-content'); if (ct) ct.style.display = 'block';
    const el = $('ps-stl-table'); if (!el) return;
    const rows = d.settlements || [];
    el.innerHTML = `<div class="ps-th-row" style="grid-template-columns:90px 130px 1fr 110px 80px">
        <span>Date</span><span>Settlement ID</span><span>Transactions</span><span>Amount</span><span>Status</span>
      </div>` + rows.map(s => `<div class="ps-tr" style="grid-template-columns:90px 130px 1fr 110px 80px">
        <span style="color:var(--text4);font-size:.78rem">${_psDate(s.settlement_date)}</span>
        <span class="ps-ref">${String(s.id).slice(0, 14)}</span>
        <span style="color:var(--text3);font-size:.78rem">${s.txn_count} transactions</span>
        <span class="ps-amount ${s.status==='settled'?'ps-amount-g':'ps-amber'}">${_psNgn(s.total_amount||0)}</span>
        ${_psBadge(s.status)}
      </div>`).join('') || '<div style="padding:20px;color:var(--text4);font-size:.8rem;text-align:center">No settlements yet.</div>';
  } catch(e) { _psLoading('settlements', false); }
}

async function psLoadCustomers() {
  if (!_psConnected) return;
  _psLoading('customers', true);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/paystack/customers?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _psLoading('customers', false);
    const ct = $('ps-customers-content'); if (ct) ct.style.display = 'block';
    const el = $('ps-cust-table'); if (!el) return;
    const rows = d.customers || [];
    el.innerHTML = `<div class="ps-th-row" style="grid-template-columns:1fr 110px 70px 90px">
        <span>Customer</span><span>Total spend</span><span>Txns</span><span>Since</span>
      </div>` + rows.map(c => `<div class="ps-tr" style="grid-template-columns:1fr 110px 70px 90px">
        <div><div class="ps-cust-name">${c.name || c.email}</div><div class="ps-cust-email">${c.email}</div></div>
        <span class="ps-amount ps-amount-g">${_psNgn(c.total_spend||0)}</span>
        <span style="color:var(--text3)">${c.txn_count||0}</span>
        <span style="color:var(--text4);font-size:.78rem">${_psDate(c.created_at)}</span>
      </div>`).join('') || '<div style="padding:20px;color:var(--text4);font-size:.8rem;text-align:center">No customers yet.</div>';
  } catch(e) { _psLoading('customers', false); }
}

async function psLoadRefunds() {
  if (!_psConnected) return;
  _psLoading('refunds', true);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/paystack/refunds?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _psLoading('refunds', false);
    const ct = $('ps-refunds-content'); if (ct) ct.style.display = 'block';
    const rl = $('ps-refund-list'), dl = $('ps-dispute-list');
    if (rl) rl.innerHTML = (d.refunds || []).map(r => `
      <div class="ps-tr" style="display:flex;align-items:center;gap:10px">
        <div style="flex:1"><div class="ps-cust-name">${r.customer || r.transaction}</div><div class="ps-cust-email">${r.transaction}</div></div>
        <span class="ps-amount ps-amount-r">${_psNgn(r.amount)}</span>
        ${_psBadge(r.status)}
      </div>`).join('') || '<div style="padding:16px;color:var(--text4);font-size:.8rem">No refunds yet.</div>';
    if (dl) dl.innerHTML = (d.disputes || []).map(dsp => `
      <div style="border:1px solid var(--amber2);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--amber2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <span class="ps-cust-name">${dsp.reference || dsp.id} · ${_psNgn(dsp.amount)}</span>
          ${_psBadge(dsp.status)}
        </div>
        <div style="font-size:.78rem;color:var(--text3);line-height:1.5">${dsp.message || 'Dispute filed.'}</div>
      </div>`).join('') || '<div style="padding:16px;color:var(--text4);font-size:.8rem">No disputes.</div>';
  } catch(e) { _psLoading('refunds', false); }
}

async function psLoadAnalytics() {
  if (!_psConnected) return;
  _psLoading('analytics', true);
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/paystack/analytics?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _psLoading('analytics', false);
    const ct = $('ps-analytics-content'); if (ct) ct.style.display = 'block';

    // Rates
    const ratesEl = $('ps-an-rates');
    if (ratesEl) {
      const sr = d.success_rate || 0, fr = 100 - sr;
      ratesEl.innerHTML = `
        <div class="ps-rate-row"><div class="ps-rate-label"><span>Successful</span><span class="ps-rate-val" style="color:var(--teal)">${sr}%</span></div><div class="ps-rate-bg"><div class="ps-rate-fill" style="width:${sr}%;background:var(--teal)"></div></div></div>
        <div class="ps-rate-row"><div class="ps-rate-label"><span>Failed</span><span class="ps-rate-val" style="color:var(--red3)">${fr.toFixed(1)}%</span></div><div class="ps-rate-bg"><div class="ps-rate-fill" style="width:${fr}%;background:var(--red3)"></div></div></div>`;
    }

    // Weekday
    const wdEl = $('ps-an-weekday');
    if (wdEl && d.by_weekday) {
      const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const max = Math.max(...Object.values(d.by_weekday), 1);
      wdEl.innerHTML = days.map(day => {
        const v = d.by_weekday[day] || 0;
        const pct = Math.round(v / max * 100);
        return `<div class="ps-wd-row">
          <span class="ps-wd-lbl">${day}</span>
          <div class="ps-wd-bar-bg"><div class="ps-wd-bar-fill" style="width:${pct}%;opacity:${0.4 + pct/160}"></div></div>
          <span class="ps-wd-val">${v ? _psNgn(v) : '—'}</span>
        </div>`;
      }).join('');
    }

    // Daily bar chart
    const dayEl = $('ps-an-daily');
    if (dayEl && d.by_day) {
      const entries = Object.entries(d.by_day);
      const max = Math.max(...entries.map(([,v]) => v), 1);
      dayEl.innerHTML = entries.map(([day, v]) => {
        const pct = Math.round(v / max * 100);
        return `<div class="ps-bar-wrap"><div class="ps-bar" style="height:${Math.max(pct,4)}%"></div><div class="ps-bar-lbl">${day.slice(5)}</div></div>`;
      }).join('');
    }

    // AI summary
    const aiEl = $('ps-an-ai');
    if (aiEl) {
      const sr = d.success_rate || 0;
      const wd = d.by_weekday || {};
      const topDay = Object.entries(wd).sort((a,b) => b[1]-a[1])[0];
      aiEl.innerHTML = `
        <div class="ps-insight ps-insight-g">
          ${topDay ? `<strong>Peak day:</strong> ${topDay[0]} generates ${_psNgn(topDay[1])} on average. Schedule billing reminders and promotions on ${topDay[0]}s for maximum conversion.` : 'Collect more transactions to see peak day analytics.'}
        </div>
        <div class="ps-insight ${sr < 90 ? 'ps-insight-a' : 'ps-insight-g'}">
          <strong>Success rate: ${sr}%</strong> — ${sr < 90 ? 'above the 5% industry failure threshold. Consider adding bank transfer as a fallback for card declines.' : 'excellent performance, within industry benchmarks.'}
        </div>
        <div class="ps-insight ps-insight-b">
          <strong>Paystack fees:</strong> ${_psNgn(d.total_fees || 0)} paid across all transactions. Optimise by encouraging bank transfers (lower fee per transaction).
        </div>`;
    }
  } catch(e) { _psLoading('analytics', false); }
}

async function psCheckConnectStatus() {
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await fetch(`/api/org/paystack/status?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    _psConnected = !!d.connected;
  } catch(e) {}
  const info = $('ps-connected-info'), form = $('ps-connect-form');
  if (_psConnected) {
    if (info) info.style.display = 'flex';
    if (form) form.style.display = 'none';
  } else {
    if (info) info.style.display = 'none';
    if (form) form.style.display = 'block';
  }
}

async function psConnect() {
  const key = $('ps-key-input')?.value.trim() || '';
  const err = $('ps-connect-err');
  if (!key) { if (err) { err.textContent = 'Enter your Paystack secret key.'; err.style.display = 'block'; } return; }
  if (!key.startsWith('sk_live_') && !key.startsWith('sk_test_')) {
    if (err) { err.textContent = 'Key must start with sk_live_ or sk_test_'; err.style.display = 'block'; } return;
  }
  if (err) err.style.display = 'none';
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    const r = await API('/api/org/paystack/connect', { token, secret_key: key });
    _psConnected = true;
    toast('Paystack connected!');
    psFinancialsLoad();
  } catch(e) {
    if (err) { err.textContent = e.message || 'Could not connect. Check your key.'; err.style.display = 'block'; }
  }
}

async function psDisconnect() {
  const token = localStorage.getItem('sivarr_token') || '';
  try {
    await fetch(`/api/org/paystack/disconnect?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    _psConnected = false;
    toast('Paystack disconnected.');
    psGoTab('connect', null);
    const btn = $('ps-tab-connect'); if (btn) { document.querySelectorAll('.ps-tab').forEach(b => b.classList.remove('on')); btn.classList.add('on'); }
    psCheckConnectStatus();
  } catch(e) { toast('Failed to disconnect.'); }
}

function _psShowNotConnected() {
  _psConnected = false;
  psGoTab('connect', null);
}

/* ═══════════════════════════════════════════════════════════════
   WEEKLY REVIEW
═══════════════════════════════════════════════════════════════ */

let _reviewGenerated = false;

function reviewInit() {
  _reviewGenerated = false;
  _reviewPopulateStats();
  const aiCard = $('review-ai-card');
  const empty  = $('review-empty');
  if (aiCard) aiCard.style.display = 'none';
  if (empty)  empty.style.display  = 'flex';
  _moodChartLoad();
  _reviewAutoLoad();
}

async function _reviewAutoLoad() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  // Check for a cached review from this week in localStorage
  const weekStart = (() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split('T')[0];
  })();
  const cacheKey = `sivarr_weekly_review_${S.sid}_${weekStart}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    _reviewShowContent(cached, weekStart);
    return;
  }
  // Try fetching from server if the review was auto-generated
  try {
    const r = await fetch(`/api/ai/weekly-review/latest?token=${encodeURIComponent(token)}`);
    if (!r.ok) return;
    const d = await r.json();
    if (d.review && d.week_start === weekStart) {
      localStorage.setItem(cacheKey, d.review);
      _reviewShowContent(d.review, weekStart);
    }
  } catch(_) {}
}

function _reviewShowContent(text, weekStart) {
  const aiCard  = $('review-ai-card');
  const empty   = $('review-empty');
  const content = $('review-ai-content');
  const weekEl  = $('review-ai-week');
  if (content) content.innerHTML = typeof _reviewFormatMd === 'function' ? _reviewFormatMd(text) : text;
  if (weekEl)  weekEl.textContent = `Week of ${weekStart}`;
  if (aiCard)  { aiCard.style.display = 'block'; _reviewGenerated = true; }
  if (empty)   empty.style.display = 'none';
}

async function _moodChartLoad() {
  const token = localStorage.getItem('sivarr_token') || '';
  if (!token) return;
  let container = $('mood-chart-card');
  if (!container) {
    // Append card after the review stats section
    const reviewWrap = document.querySelector('.review-stats-wrap') || document.querySelector('#review-ai-card')?.parentElement;
    if (!reviewWrap) return;
    container = document.createElement('div');
    container.id = 'mood-chart-card';
    container.style.cssText = 'margin-top:16px;padding:16px 18px;background:var(--surface);border:1px solid var(--border);border-radius:12px';
    reviewWrap.parentElement?.appendChild(container);
  }
  container.innerHTML = '<div style="font-size:.82rem;color:var(--muted)">Loading mood data…</div>';
  try {
    const r = await fetch(`/api/analytics/mood?token=${encodeURIComponent(token)}&days=30`);
    const d = await r.json();
    const pts = d.data || [];
    if (pts.length < 3) {
      container.innerHTML = '<div style="font-weight:700;margin-bottom:8px;font-size:.9rem">Mood trend — last 30 days</div><div style="font-size:.82rem;color:var(--muted)">Keep journalling to see your mood trend.</div>';
      return;
    }
    const W = 480, H = 120, PAD_L = 52, PAD_R = 12, PAD_T = 12, PAD_B = 28;
    const w = W - PAD_L - PAD_R, h = H - PAD_T - PAD_B;
    const COLORS = { great:'var(--teal)', good:'#22c55e', okay:'var(--amber,#f59e0b)', low:'#d97706', stressed:'var(--red,#ef4444)' };
    const LABELS = { 5:'Great', 4:'Good', 3:'Okay', 2:'Low', 1:'Stressed' };
    const xs = pts.map((_, i) => PAD_L + (i / (pts.length - 1)) * w);
    const ys = pts.map(p => PAD_T + h - ((p.mood_score - 1) / 4) * h);
    const poly = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
    const dots = pts.map((p, i) => `<circle cx="${xs[i]}" cy="${ys[i]}" r="4" fill="${COLORS[p.mood] || 'var(--teal)'}" stroke="var(--surface)" stroke-width="1.5"><title>${p.date}: ${p.mood}</title></circle>`).join('');
    const yLabels = [1,3,5].map(v => {
      const y = PAD_T + h - ((v - 1) / 4) * h;
      return `<text x="${PAD_L - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${LABELS[v]}</text><line x1="${PAD_L}" y1="${y}" x2="${PAD_L + w}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
    }).join('');
    const step = Math.max(1, Math.floor(pts.length / 5));
    const xLabels = pts.filter((_, i) => i % step === 0).map((p, i2) => {
      const idx = i2 * step;
      const label = p.date.slice(5); // MM-DD
      return `<text x="${xs[idx]}" y="${PAD_T + h + 16}" text-anchor="middle" font-size="9" fill="var(--muted)">${label}</text>`;
    }).join('');
    container.innerHTML = `
      <div style="font-weight:700;margin-bottom:10px;font-size:.9rem">Mood trend — last 30 days</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block;overflow:visible">
        ${yLabels}
        <polyline points="${poly}" fill="none" stroke="var(--teal)" stroke-width="2" stroke-linejoin="round"/>
        ${dots}
        ${xLabels}
      </svg>`;
  } catch(_) {
    container.innerHTML = '<div style="font-size:.82rem;color:var(--muted)">Could not load mood data.</div>';
  }
}

function _reviewPopulateStats() {
  if (!S.sid) return;
  const sid   = S.sid;
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];

  // Tasks
  try {
    const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${sid}`) || '[]');
    const done  = tasks.filter(t => t.done).length;
    const total = tasks.length;
    const tv = $('rs-tasks-val');
    if (tv) tv.textContent = `${done}/${total}`;
  } catch(_) {}

  // Habits
  try {
    const habits = JSON.parse(localStorage.getItem(`sivarr_habits_${sid}`) || '[]');
    if (habits.length) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
        days.push(d);
      }
      let completed = 0, possible = habits.length * 7;
      habits.forEach(h => {
        const c = (h.completions || []);
        days.forEach(d => { if (c.includes(d)) completed++; });
      });
      const pct = possible ? Math.round(completed / possible * 100) : 0;
      const hv = $('rs-habits-val');
      if (hv) hv.textContent = `${pct}%`;
    } else {
      const hv = $('rs-habits-val'); if (hv) hv.textContent = '—';
    }
  } catch(_) {}

  // Goals
  try {
    const goals  = JSON.parse(localStorage.getItem(`sivarr_goals_${sid}`) || '[]');
    const active = goals.filter(g => !g.done).length;
    const gv = $('rs-goals-val'); if (gv) gv.textContent = active || '0';
  } catch(_) {}

  // Focus sessions this week
  try {
    const log = JSON.parse(localStorage.getItem(`sivarr_focus_log_${sid}`) || '[]');
    const thisWeek = log.filter(f => f.date && f.date >= weekAgo);
    const fv = $('rs-focus-val'); if (fv) fv.textContent = thisWeek.length || '0';
  } catch(_) {}
}

async function reviewGenerate() {
  if (!S.sid || !S.token) { toast('Sign in to generate your review.'); return; }
  const btn = $('review-gen-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> Generating…'; }

  const sid = S.sid;
  // Collect week stats
  let tasksDone = 0, tasksTotal = 0, habitsPct = 0;
  const goals = [];

  try {
    const tasks = JSON.parse(localStorage.getItem(`sivarr_tasks_${sid}`) || '[]');
    tasksDone  = tasks.filter(t => t.done).length;
    tasksTotal = tasks.length;
  } catch(_) {}

  try {
    const habits = JSON.parse(localStorage.getItem(`sivarr_habits_${sid}`) || '[]');
    if (habits.length) {
      const days = [];
      for (let i = 0; i < 7; i++) {
        days.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
      }
      let completed = 0, possible = habits.length * 7;
      habits.forEach(h => {
        (h.completions || []).forEach(d => { if (days.includes(d)) completed++; });
      });
      habitsPct = possible ? Math.round(completed / possible * 100) : 0;
    }
  } catch(_) {}

  try {
    const gl = JSON.parse(localStorage.getItem(`sivarr_goals_${sid}`) || '[]');
    gl.filter(g => !g.done).slice(0, 5).forEach(g => {
      goals.push({ title: g.title || '', progress: g.progress || 0 });
    });
  } catch(_) {}

  const jnl = JSON.parse(localStorage.getItem(`sivarr_journal_${sid}`) || '[]');
  const mood = jnl.length ? (jnl[jnl.length - 1].mood || '') : '';

  try {
    const res = await API('/api/ai/weekly-review', {
      token: S.token,
      tasks_done: tasksDone,
      tasks_total: tasksTotal,
      habits_pct: habitsPct,
      goals,
      mood,
    });

    const aiCard = $('review-ai-card');
    const empty  = $('review-empty');
    const content = $('review-ai-content');
    const weekEl  = $('review-ai-week');

    if (content) content.innerHTML = _reviewFormatMd(res.review || '');
    if (weekEl)  weekEl.textContent = res.week || '';
    if (aiCard)  aiCard.style.display = 'block';
    if (empty)   empty.style.display  = 'none';
    _reviewGenerated = true;
  } catch(e) {
    toast('Could not generate review. Try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-sparkles"></i> Generate Review'; }
  }
}

function _reviewFormatMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<span style="display:block;padding-left:12px;position:relative;margin-bottom:4px"><span style="position:absolute;left:0;color:var(--teal)">•</span>$1</span>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

/* ═══════════════════════════════════════════════════════════════
   NATURAL LANGUAGE QUICK-ADD
═══════════════════════════════════════════════════════════════ */

let _nlParsed = null;
let _nlDebounce = null;

function nlOpen() {
  const overlay = $('nl-overlay');
  const input   = $('nl-input');
  if (!overlay) return;
  overlay.classList.add('open');
  _nlReset();
  setTimeout(() => input?.focus(), 60);
}

function nlClose() {
  const overlay = $('nl-overlay');
  if (overlay) overlay.classList.remove('open');
  _nlParsed = null;
}

function _nlReset() {
  const input   = $('nl-input');
  const preview = $('nl-preview');
  if (input)   input.value = '';
  if (preview) preview.style.display = 'none';
  _nlParsed = null;
  clearTimeout(_nlDebounce);
}

function nlExample(el) {
  const input = $('nl-input');
  if (!input) return;
  // Strip leading emoji + space
  input.value = el.textContent.replace(/^[\p{Emoji}\s]+/u, '').trim();
  input.focus();
  nlSubmit();
}

async function nlSubmit() {
  const input = $('nl-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  clearTimeout(_nlDebounce);
  _nlDebounce = setTimeout(async () => {
    const preview = $('nl-preview');
    if (preview) preview.style.display = 'none';

    try {
      const res = await API('/api/ai/parse-intent', { token: S.token, text });
      if (!res?.ok) return;
      _nlParsed = res.parsed;
      _nlShowPreview(res.parsed);
    } catch(_) {
      // Fallback — just create as task without preview
      _nlParsed = { action: 'task', title: text, priority: 'normal', due: null };
      _nlShowPreview(_nlParsed);
    }
  }, 300);
}

function _nlShowPreview(p) {
  const preview = $('nl-preview');
  const badge   = $('nl-prev-type');
  const title   = $('nl-prev-title');
  const meta    = $('nl-prev-meta');
  if (!preview) return;

  badge.textContent = p.action;
  badge.className   = `nl-badge ${p.action}`;
  title.textContent = p.title || '';

  const parts = [];
  if (p.priority && p.priority !== 'normal') parts.push(p.priority + ' priority');
  if (p.due) parts.push('due ' + p.due);
  if (p.subject) parts.push(p.subject);
  meta.textContent = parts.join(' · ');

  preview.style.display = 'block';
}

async function nlConfirm() {
  if (!_nlParsed) return;
  const p   = _nlParsed;
  const sid = S.sid;

  if (p.action === 'task') {
    // Save to tasks localStorage (same key as Flux panel)
    try {
      const key   = `sivarr_tasks_${sid}`;
      const tasks = JSON.parse(localStorage.getItem(key) || '[]');
      tasks.unshift({
        id:       Date.now(),
        title:    p.title,
        status:   'todo',
        priority: p.priority || 'normal',
        date:     p.due || '',
        done:     false,
        created:  new Date().toISOString().split('T')[0],
      });
      localStorage.setItem(key, JSON.stringify(tasks));
      toast(`Task added: "${p.title}" ✓`);
    } catch(_) { toast('Could not save task.'); }

  } else if (p.action === 'goal') {
    // Call goals API
    try {
      await API('/api/goals/add', {
        token:        S.token,
        title:        p.title,
        subject:      p.subject || '',
        deadline:     p.due || '',
        target_score: 70,
      });
      toast(`Goal added: "${p.title}" ✓`);
    } catch(_) { toast('Could not save goal.'); }

  } else {
    // Note — save to journal/notes localStorage
    try {
      const key   = `sivarr_notes_${sid}`;
      const notes = JSON.parse(localStorage.getItem(key) || '[]');
      notes.unshift({
        id:      Date.now(),
        title:   p.title,
        content: p.title,
        created: new Date().toISOString(),
      });
      localStorage.setItem(key, JSON.stringify(notes));
      toast(`Note saved ✓`);
    } catch(_) { toast('Could not save note.'); }
  }

  nlClose();
}

// Keyboard shortcut: Alt+A
document.addEventListener('keydown', e => {
  if (e.altKey && e.key === 'a' && !e.ctrlKey && !e.metaKey) {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    if (!isTyping) { e.preventDefault(); nlOpen(); }
  }
});
