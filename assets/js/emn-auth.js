// Shared Supabase client + optional sign-in for EMN pages.
// Own Supabase project, separate from AMBRA's — separate URL, separate anon
// key, separate database. Never mix these two.
//
// Pages that use this must load the Supabase JS library first:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="/assets/js/emn-auth.js?v={{ site.time | date: '%s' }}"></script>
// (the ?v= cache-busts it the same way emn.css already does — without it,
// browsers can keep serving a stale cached copy after this file changes.)
//
// There's no self-signup anywhere — the only way to get an account is being
// invited by an Admin. Sign-in itself is optional everywhere: this file
// never redirects anyone, it just exposes `emnSession` / `emnStudentProfile`
// (both null when signed out) after `emnInit()` resolves.

const EMN_SUPABASE_URL = 'https://gpoddvcrsdkpgfmyniqu.supabase.co';
const EMN_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwb2RkdmNyc2RrcGdmbXluaXF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0Nzc3MzksImV4cCI6MjEwNTA1MzczOX0.N9XvN4xdln5GFlTcpv3nE3iThH7Jfoym23HPp97_fxc';

// Email links (password reset, invite) land on whichever page Supabase's "Site
// URL" points to whenever the requested redirect isn't on the project's
// Redirect URLs allow-list — often the home page. Forward them to the login
// page, the only one that knows how to finish the flow, before anything here
// swallows the tokens in the URL.
const emnAuthHash = new URLSearchParams(location.hash.slice(1));
const emnForwardToLogin = ['recovery', 'invite'].includes(emnAuthHash.get('type'))
  && emnAuthHash.get('access_token')
  && !location.pathname.startsWith('/emn-login');
if(emnForwardToLogin) location.replace('/emn-login' + location.hash);

const emnSupabase = window.supabase.createClient(
  EMN_SUPABASE_URL, EMN_SUPABASE_ANON_KEY,
  emnForwardToLogin ? { auth: { detectSessionInUrl: false } } : undefined
);

let emnSession = null;
let emnStudentProfile = null; // row from `students` — null until signed in AND loaded

async function emnLoadSession(){
  const { data } = await emnSupabase.auth.getSession();
  emnSession = data.session || null;
  emnStudentProfile = null;
  if(emnSession){
    const { data: profile } = await emnSupabase.from('students').select('*').eq('id', emnSession.user.id).maybeSingle();
    emnStudentProfile = profile || null;
  }
  return emnSession;
}

emnSupabase.auth.onAuthStateChange((_event, session) => {
  emnSession = session;
  if(!session) emnStudentProfile = null;
});

// Drops a "Log in" link (signed out) or a "Mi cuenta / Cerrar sesión"
// dropdown (signed in) into the shared `.emn-nav` header — only present on
// the marketing pages (Home, Practice Lab, Feedback, etc.), not the
// `.emn-tool` pages. Built by hand for the same reason as the other
// dropdowns in this file: it's injected after the shared caret-toggle
// script has already wired up whatever `.emn-nav__item`s existed at load.
function emnInjectAuthLink(){
  const nav = document.querySelector('.emn-nav');
  if(!nav) return;

  if(!emnSession){
    const authLink = document.createElement('a');
    authLink.className = 'emn-nav__link';
    authLink.href = '/emn-login';
    authLink.textContent = 'Iniciar sesión';
    nav.appendChild(authLink);
    return;
  }

  const item = document.createElement('div');
  item.className = 'emn-nav__item';
  const displayName = emnStudentProfile?.full_name || emnSession.user.email;
  item.innerHTML = `
    <a href="#" class="emn-nav__link emn-nav__link--user">${displayName}</a>
    <button class="emn-nav__caret" aria-label="Abrir menú de cuenta" aria-expanded="false">&#9662;</button>
    <div class="emn-nav__dropdown">
      <a href="#" class="emn-nav__dropdown-item" id="emn-my-account-link">Mi cuenta</a>
      <a href="#" class="emn-nav__dropdown-item" id="emn-logout-link">Cerrar sesión</a>
    </div>
  `;
  nav.appendChild(item);

  const caret = item.querySelector('.emn-nav__caret');
  const label = item.querySelector('.emn-nav__link');
  const toggle = (e) => {
    e.preventDefault();
    const isOpen = item.classList.contains('is-open');
    document.querySelectorAll('.emn-nav__item').forEach((i) => i.classList.remove('is-open'));
    item.classList.toggle('is-open', !isOpen);
    caret.setAttribute('aria-expanded', String(!isOpen));
  };
  caret.addEventListener('click', toggle);
  label.addEventListener('click', toggle);
  document.addEventListener('click', (e) => {
    if(!item.contains(e.target)) item.classList.remove('is-open');
  });

  item.querySelector('#emn-my-account-link').addEventListener('click', (e) => {
    e.preventDefault();
    item.classList.remove('is-open');
    emnOpenAccountModal();
  });
  item.querySelector('#emn-logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    item.classList.remove('is-open');
    const ok = await emnConfirm('¿Cerrar sesión?');
    if(ok){ await emnSupabase.auth.signOut(); location.reload(); }
  });
}

/* ============================= IN-PAGE MODALS =============================
   Self-contained (styles + markup injected via JS) so every EMN page gets
   these for free just by loading this file — no per-layout CSS/HTML needed. */

function emnEnsureModalStyles(){
  if(document.getElementById('emn-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'emn-modal-styles';
  style.textContent = `
    .emn-modal-overlay{ position:fixed; inset:0; background:rgba(20,18,16,.45); display:flex; align-items:center; justify-content:center; z-index:9999; padding:20px; }
    .emn-modal-box{ background:#fff; border-radius:14px; padding:24px 26px; width:100%; max-width:380px; box-shadow:0 24px 60px rgba(0,0,0,.25); font-family:'Inter', system-ui, sans-serif; }
    .emn-modal-box h3{ font-size:17px; margin:0 0 16px; color:#1A1A1A; }
    .emn-modal-field{ margin-bottom:12px; }
    .emn-modal-field label{ display:block; font-size:11px; font-weight:600; color:#666; margin-bottom:4px; }
    .emn-modal-field input{ width:100%; padding:9px 10px; border:1px solid #D9D6D1; border-radius:7px; font-size:13.5px; box-sizing:border-box; font-family:inherit; }
    .emn-modal-field input:disabled{ color:#999; background:#F5F4F2; }
    .emn-modal-avatar-row{ display:flex; align-items:center; gap:12px; margin-bottom:16px; }
    .emn-modal-avatar{ width:52px; height:52px; border-radius:50%; background:#C8102E; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; overflow:hidden; flex-shrink:0; }
    .emn-modal-avatar img{ width:100%; height:100%; object-fit:cover; }
    .emn-modal-msg{ font-size:12px; margin:8px 0 0; display:none; }
    .emn-modal-actions{ display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
    .emn-modal-btn-primary{ border:none; background:#C8102E; color:#fff; font-weight:600; font-size:13px; padding:9px 16px; border-radius:8px; cursor:pointer; font-family:inherit; }
    .emn-modal-btn-primary:hover{ background:#9C0C24; }
    .emn-modal-btn-primary:disabled{ opacity:.6; cursor:default; }
    .emn-modal-btn-ghost{ border:1px solid #D9D6D1; background:none; color:#555; font-weight:600; font-size:13px; padding:9px 16px; border-radius:8px; cursor:pointer; font-family:inherit; }
    .emn-modal-btn-ghost:hover{ border-color:#C8102E; color:#C8102E; }
    .emn-modal-sep{ border:none; border-top:1px solid #EEE; margin:16px 0; }
  `;
  document.head.appendChild(style);
}

const emnEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// In-page replacement for window.confirm() — returns a Promise<boolean>.
// House rule: every popup on this site is one of these in-page modals, never
// the browser's native alert()/confirm()/prompt().
function emnConfirm(message, { yesLabel = 'Sí', noLabel = 'Cancelar' } = {}){
  emnEnsureModalStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'emn-modal-overlay';
    overlay.innerHTML = `
      <div class="emn-modal-box" role="dialog" aria-modal="true">
        <h3>${emnEsc(message)}</h3>
        <div class="emn-modal-actions">
          <button type="button" class="emn-modal-btn-ghost" id="emn-confirm-no">${emnEsc(noLabel)}</button>
          <button type="button" class="emn-modal-btn-primary" id="emn-confirm-yes">${emnEsc(yesLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const onKey = (e) => { if(e.key === 'Escape') cleanup(false); };
    const cleanup = (result) => { document.removeEventListener('keydown', onKey); document.body.removeChild(overlay); resolve(result); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#emn-confirm-yes').addEventListener('click', () => cleanup(true));
    overlay.querySelector('#emn-confirm-no').addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if(e.target === overlay) cleanup(false); });
    overlay.querySelector('#emn-confirm-yes').focus();
  });
}

// In-page replacement for window.alert() — resolves when dismissed.
function emnAlert(message, { okLabel = 'Entendido' } = {}){
  emnEnsureModalStyles();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'emn-modal-overlay';
    overlay.innerHTML = `
      <div class="emn-modal-box" role="alertdialog" aria-modal="true">
        <h3>${emnEsc(message)}</h3>
        <div class="emn-modal-actions">
          <button type="button" class="emn-modal-btn-primary" id="emn-alert-ok">${emnEsc(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const onKey = (e) => { if(e.key === 'Escape' || e.key === 'Enter') cleanup(); };
    const cleanup = () => { document.removeEventListener('keydown', onKey); document.body.removeChild(overlay); resolve(); };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#emn-alert-ok').addEventListener('click', cleanup);
    overlay.addEventListener('click', (e) => { if(e.target === overlay) cleanup(); });
    overlay.querySelector('#emn-alert-ok').focus();
  });
}

// "Mi cuenta" modal — change display name, upload a profile photo (stored
// in the `avatars` Storage bucket), and set a new password. Needs
// `students.avatar_url` (text column) and a public `avatars` bucket to
// exist — see the SQL given alongside this feature.
function emnOpenAccountModal(){
  emnEnsureModalStyles();
  const profile = emnStudentProfile || {};
  const overlay = document.createElement('div');
  overlay.className = 'emn-modal-overlay';
  const initials = (profile.full_name || emnSession.user.email || '?').trim().charAt(0).toUpperCase();
  overlay.innerHTML = `
    <div class="emn-modal-box">
      <h3>Mi cuenta</h3>
      <div class="emn-modal-avatar-row">
        <div class="emn-modal-avatar" id="emn-account-avatar">${profile.avatar_url ? `<img src="${profile.avatar_url}">` : initials}</div>
        <input type="file" accept="image/*" id="emn-account-photo-input">
      </div>
      <div class="emn-modal-field"><label>Nombre</label><input type="text" id="emn-account-name" value="${(profile.full_name || '').replace(/"/g, '&quot;')}"></div>
      <div class="emn-modal-field"><label>Correo</label><input type="email" value="${emnSession.user.email}" disabled></div>
      <div class="emn-modal-field"><label>Nueva contraseña</label><input type="password" id="emn-account-password" placeholder="Dejar en blanco para no cambiar" autocomplete="new-password" minlength="6"></div>
      <p class="emn-modal-msg" id="emn-account-msg"></p>
      <hr class="emn-modal-sep">
      <div class="emn-modal-actions">
        <button type="button" class="emn-modal-btn-ghost" id="emn-account-cancel">Cerrar</button>
        <button type="button" class="emn-modal-btn-primary" id="emn-account-save">Guardar cambios</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#emn-account-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if(e.target === overlay) close(); });

  let pendingFile = null;
  overlay.querySelector('#emn-account-photo-input').addEventListener('change', (e) => {
    pendingFile = e.target.files[0] || null;
    if(pendingFile){
      const reader = new FileReader();
      reader.onload = () => { overlay.querySelector('#emn-account-avatar').innerHTML = `<img src="${reader.result}">`; };
      reader.readAsDataURL(pendingFile);
    }
  });

  overlay.querySelector('#emn-account-save').addEventListener('click', async () => {
    const btn = overlay.querySelector('#emn-account-save');
    const msg = overlay.querySelector('#emn-account-msg');
    const newName = overlay.querySelector('#emn-account-name').value.trim();
    const newPassword = overlay.querySelector('#emn-account-password').value;
    msg.style.display = 'none';

    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
      let avatarUrl = profile.avatar_url || null;
      if(pendingFile){
        const ext = pendingFile.name.split('.').pop();
        const path = `${emnSession.user.id}/avatar.${ext}`;
        const { error: uploadError } = await emnSupabase.storage.from('avatars').upload(path, pendingFile, { upsert: true });
        if(uploadError) throw uploadError;
        const { data: pub } = emnSupabase.storage.from('avatars').getPublicUrl(path);
        avatarUrl = pub.publicUrl + '?t=' + Date.now();
      }

      const { error: updateError } = await emnSupabase.from('students')
        .update({ full_name: newName, avatar_url: avatarUrl })
        .eq('id', emnSession.user.id);
      if(updateError) throw updateError;

      if(newPassword){
        if(newPassword.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
        const { error: pwError } = await emnSupabase.auth.updateUser({ password: newPassword });
        if(pwError) throw pwError;
      }

      emnStudentProfile = { ...profile, full_name: newName, avatar_url: avatarUrl };
      msg.textContent = 'Cambios guardados ✓';
      msg.style.color = '#1E8E5A';
      msg.style.display = 'block';
      setTimeout(() => { close(); location.reload(); }, 900);
    } catch(err){
      console.error(err);
      msg.textContent = err.message || 'No se pudo guardar.';
      msg.style.color = '#C8102E';
      msg.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    }
  });
}

// "Administrar" dropdown (Usuarios / Actividad / Calendar) — Admin and Professor only.
// Students never see this tab at all. Built by hand (not the shared
// caret-toggle script those other dropdowns use) because it's injected
// after that script has already wired up whatever `.emn-nav__item`s
// existed at page load.
function emnInjectAdminMenu(){
  if(!emnStudentProfile || (emnStudentProfile.role !== 'admin' && emnStudentProfile.role !== 'professor')) return;
  const nav = document.querySelector('.emn-nav');
  if(!nav) return;

  const item = document.createElement('div');
  item.className = 'emn-nav__item';
  item.innerHTML = `
    <a href="#" class="emn-nav__link">Administrar</a>
    <button class="emn-nav__caret" aria-label="Abrir submenú de Administrar" aria-expanded="false">&#9662;</button>
    <div class="emn-nav__dropdown">
      <a href="/usuarios" class="emn-nav__dropdown-item">Usuarios</a>
      <a href="/actividad" class="emn-nav__dropdown-item">Actividad</a>
      <a href="/admin-calendar" class="emn-nav__dropdown-item">Calendario de clases</a>
      <a href="/cursos-editor" class="emn-nav__dropdown-item">Editor de cursos</a>
    </div>
  `;
  nav.appendChild(item);

  const caret = item.querySelector('.emn-nav__caret');
  const label = item.querySelector('.emn-nav__link');
  const toggle = (e) => {
    e.preventDefault();
    const isOpen = item.classList.contains('is-open');
    document.querySelectorAll('.emn-nav__item').forEach((i) => i.classList.remove('is-open'));
    item.classList.toggle('is-open', !isOpen);
    caret.setAttribute('aria-expanded', String(!isOpen));
  };
  caret.addEventListener('click', toggle);
  label.addEventListener('click', toggle);

  document.addEventListener('click', (e) => {
    if(!item.contains(e.target)) item.classList.remove('is-open');
  });
}

// Signed-in people get "Interview Prep" in the Practice Lab dropdown split
// into two sub-items: Practice (the public tool) and Questions (their own
// saved answers). Signed-out visitors keep the single link from
// _includes/emn-header.html, straight to /interview-prep.
function emnSplitInterviewLink(){
  if(!emnSession) return;
  const link = document.querySelector('.emn-nav [data-emn-interview]');
  if(!link) return;
  const path = location.pathname.replace(/\/$/, '');
  link.outerHTML = `
    <span class="emn-nav__dropdown-label">Interview Prep</span>
    <a href="/interview-prep" class="emn-nav__dropdown-item emn-nav__dropdown-item--sub ${path === '/interview-prep' ? 'is-active' : ''}">Practice</a>
    <a href="/clases-interview-prep" class="emn-nav__dropdown-item emn-nav__dropdown-item--sub ${path === '/clases-interview-prep' ? 'is-active' : ''}">Questions</a>
  `;
}

// "Mi Aula" dropdown (Calendario, Career Progress) — any signed-in person
// (student, professor or admin), never shown to a signed-out visitor since
// everything underneath it is personal, per-account data. Built by hand for
// the same reason as emnInjectAdminMenu(): it's injected after the shared
// caret-toggle script has already wired up whatever `.emn-nav__item`s
// existed at page load.
function emnInjectCareerMenu(){
  if(!emnSession) return;
  const nav = document.querySelector('.emn-nav');
  if(!nav) return;

  const path = location.pathname.replace(/\/$/, '');
  const item = document.createElement('div');
  item.className = 'emn-nav__item';
  item.innerHTML = `
    <a href="#" class="emn-nav__link">Mi Aula</a>
    <button class="emn-nav__caret" aria-label="Abrir submenú de Mi Aula" aria-expanded="false">&#9662;</button>
    <div class="emn-nav__dropdown">
      <a href="/career" class="emn-nav__dropdown-item ${path === '/career' ? 'is-active' : ''}">Calendario</a>
      <a href="/career-progress" class="emn-nav__dropdown-item ${path === '/career-progress' ? 'is-active' : ''}">Career Progress</a>
    </div>
  `;
  nav.appendChild(item);

  const caret = item.querySelector('.emn-nav__caret');
  const label = item.querySelector('.emn-nav__link');
  const toggle = (e) => {
    e.preventDefault();
    const isOpen = item.classList.contains('is-open');
    document.querySelectorAll('.emn-nav__item').forEach((i) => i.classList.remove('is-open'));
    item.classList.toggle('is-open', !isOpen);
    caret.setAttribute('aria-expanded', String(!isOpen));
  };
  caret.addEventListener('click', toggle);
  label.addEventListener('click', toggle);

  document.addEventListener('click', (e) => {
    if(!item.contains(e.target)) item.classList.remove('is-open');
  });
}

async function emnInit(){
  await emnLoadSession();
  emnSplitInterviewLink();
  emnInjectCareerMenu();
  emnInjectAdminMenu();
  // Keep the "Cursos" button right beside the account/login link, after the
  // dropdowns injected above.
  const cursos = document.querySelector('.emn-nav .emn-nav__link--cta');
  if(cursos) cursos.parentElement.appendChild(cursos);
  emnInjectAuthLink();
}

/* ============================= PRACTICE TIME HEARTBEAT =============================
   Used by sight-melody.html and interview-prep.html only. Call
   emnStartHeartbeat('sight-melody' | 'interview-prep') once, after emnInit()
   resolves and only if emnSession exists — it no-ops silently for signed-out
   visitors, which is what makes sign-in optional there too: the tool works
   the same either way, it just doesn't log time when nobody's signed in.

   "Active" = the tab is visible AND the student has interacted (click, key,
   pointer move, touch) within the last INACTIVITY_LIMIT — so time isn't
   still counting while they've tabbed away or stepped away from the
   keyboard. Ticks every HEARTBEAT_SECONDS and adds that many seconds to
   today's row for this student+tool, creating it on the first tick of the
   day (upsert with an additive read-then-write, not a raw insert). */
const HEARTBEAT_SECONDS = 30;
const INACTIVITY_LIMIT_MS = 60000;

function emnStartHeartbeat(tool){
  if(!emnSession) return;
  let lastInteraction = Date.now();
  ['click','keydown','pointermove','touchstart'].forEach(evt => {
    document.addEventListener(evt, () => { lastInteraction = Date.now(); }, { passive: true });
  });

  setInterval(async () => {
    if(document.visibilityState !== 'visible') return;
    if(Date.now() - lastInteraction > INACTIVITY_LIMIT_MS) return;

    const today = new Date();
    const activityDate = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

    const { data: existing, error: selectErr } = await emnSupabase
      .from('practice_activity')
      .select('id, seconds')
      .eq('student_id', emnSession.user.id)
      .eq('tool', tool)
      .eq('activity_date', activityDate)
      .maybeSingle();
    if(selectErr){ console.error('emnStartHeartbeat: could not read practice_activity', selectErr); return; }

    if(existing){
      const { error: updateErr } = await emnSupabase.from('practice_activity').update({
        seconds: existing.seconds + HEARTBEAT_SECONDS,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
      if(updateErr) console.error('emnStartHeartbeat: could not update practice_activity', updateErr);
    } else {
      const { error: insertErr } = await emnSupabase.from('practice_activity').insert({
        student_id: emnSession.user.id, tool, activity_date: activityDate, seconds: HEARTBEAT_SECONDS
      });
      if(insertErr) console.error('emnStartHeartbeat: could not insert practice_activity', insertErr);
    }
  }, HEARTBEAT_SECONDS * 1000);
}
