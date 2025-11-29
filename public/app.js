// async function api(path, opts = {}) {
//   // Try same-origin first. If it fails (404/405 or network error), try the default server at http://localhost:3030
//   const optsWithHeaders = Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts);

//   async function fetchAndParse(url) {
//     const res = await fetch(url, optsWithHeaders);
//     const text = await res.text();
//     if (!res.ok) {
//       // try to parse JSON error body if present
//       try {
//         const parsed = JSON.parse(text);
//         // return structured parsed error so callers can display friendly message
//         return { __error: true, status: res.status, body: parsed };
//       } catch (e) {
//         return { __error: true, status: res.status, body: text };
//       }
//     }
//     try { return JSON.parse(text); } catch(e) { return text; }
//   }

//   // 1) Same-origin (works when opening via server or Live Server under the same origin)
//   try {
//     const result = await fetchAndParse(path);
//     if (!result || !result.__error) return result; // successful JSON/object
//     // If it was an error response (404/405), fall back to explicit server below
//   } catch (e) {
//     // network error — fall back to localhost:3030
//   }

//   // 2) Fallback: try the backend server at localhost:3030 (useful when opening via Live Server or file://)
//   try {
//     const fallbackUrl = 'http://localhost:3030' + (path.startsWith('/') ? path : '/' + path);
//     const fallback = await fetchAndParse(fallbackUrl);
//     if (!fallback || !fallback.__error) return fallback;
//     // both failed — return the fallback error to caller
//     return { error: `Request failed (${fallback.status})`, details: fallback.text };
//   } catch (e) {
//     // Both attempts failed — return a helpful error object
//     return { error: 'Network error (could not reach same-origin or http://localhost:3030)', details: String(e) };
//   }
// }

// // REGISTER
// if (document.getElementById('stage1')) {
//   const stage1 = document.getElementById('stage1');
//   const s2wrap = document.getElementById('stage2-wrapper');
//   const qaList = document.getElementById('qa-list');
//   let registrationId = null;

//   stage1.addEventListener('submit', async (ev) => {
//     ev.preventDefault();
//     const fd = Object.fromEntries(new FormData(stage1));
//     const resultEl = document.getElementById('result');
//     resultEl.innerText = '';
//     let resp;
//     try {
//       resp = await api('/api/register-stage1', { method: 'POST', body: JSON.stringify(fd) });
//     } catch (err) {
//       console.error('register-stage1 request failed', err);
//       resultEl.innerHTML = '<div class="text-danger">Could not reach server — make sure you started the server and opened the site via http://localhost:3030</div>';
//       return;
//     }
//     // If the helper returned a structured error object (server returned 4xx/5xx)
//     if (resp && resp.__error) {
//       const body = resp.body;
//       let msg = `Server error (${resp.status})`;
//       if (body) {
//         if (typeof body === 'string') msg = body;
//         else if (body.error) msg = body.error;
//         else msg = JSON.stringify(body);
//       }
//       resultEl.innerHTML = `<div class="text-danger">${msg}</div>`;
//       return;
//     }
//     registrationId = resp.registrationId;
//     // persist only if server returned a real id
//     try {
//       if (registrationId && typeof registrationId === 'string' && registrationId !== 'undefined' && registrationId !== 'null') {
//         sessionStorage.setItem('registrationId', registrationId);
//       } else {
//         sessionStorage.removeItem('registrationId');
//       }
//     } catch(e) {}
//     // load questions
//     const q = await api('/api/questions');
//     if (!q || q.error || !q.questions) {
//       const message = (q && (q.error || q.details)) ? (q.error || q.details) : 'Unable to fetch security questions.';
//       resultEl.innerHTML = `<div class="text-danger">${message}</div>`;
//       // keep user on stage 1
//       return;
//     }
//     qaList.innerHTML = '';
//     for (let i = 0; i < 3; i++) {
//       const div = document.createElement('div');
//       div.className = 'col-12';
//       div.innerHTML = `
//         <label class="form-label">Question ${i+1}</label>
//         <select class="form-select" data-index="${i}" name="q${i}"></select>
//         <label class="form-label mt-2">Answer</label>
//         <input class="form-control" name="a${i}" required />
//       `;
//       qaList.appendChild(div);
//       const sel = div.querySelector('select');
//       q.questions.forEach(opt => {
//         const o = document.createElement('option'); o.value = opt; o.textContent = opt; sel.appendChild(o);
//       });
//     }
//     stage1.style.display = 'none';
//     s2wrap.style.display = 'block';
//   });

//   document.getElementById('backTo1').addEventListener('click', () => {
//     stage1.style.display = 'block'; s2wrap.style.display = 'none';
//   });

//   document.getElementById('stage2').addEventListener('submit', async (ev) => {
//     ev.preventDefault();
//     const fm = new FormData(ev.target);
//     // ensure we have a registrationId (try sessionStorage if needed)
//     if (!registrationId) {
//       try {
//         const stored = sessionStorage.getItem('registrationId');
//         if (stored && stored !== 'undefined' && stored !== 'null') registrationId = stored; else registrationId = null;
//       } catch(e) { registrationId = null; }
//     }
//     if (!registrationId) return document.getElementById('result').innerHTML = '<div class="text-danger">Registration session missing — please start again from stage 1.</div>';
//     const answers = [];
//     for (let i=0;i<3;i++) answers.push({ question: fm.get('q'+i), answer: fm.get('a'+i) });
//     let resp;
//     try {
//       resp = await api('/api/register-stage2', { method: 'POST', body: JSON.stringify({ registrationId, answers }) });
//     } catch (err) {
//       console.error('register-stage2 failed', err);
//       return document.getElementById('result').innerHTML = '<div class="text-danger">Could not save registration — server unreachable.</div>';
//     }
//     if (resp && resp.error) return document.getElementById('result').innerText = resp.error;
//     // clear stored registration session id
//     try { sessionStorage.removeItem('registrationId'); } catch(e) {}
//     document.getElementById('result').innerHTML = '<div class="status">Registration complete — you can now <a href="/login.html">login</a></div>';
//     s2wrap.style.display = 'none';
//   });
// }

// // LOGIN
// if (document.getElementById('login1')) {
//   let currentCaptcha = null;
//   const login1 = document.getElementById('login1');
//   const login2wrap = document.getElementById('login2-wrapper');
//   const login2form = document.getElementById('login2');
//   const loginResult = document.getElementById('login-result');

//   async function loadCaptcha() {
//     try {
//       const r = await api('/api/captcha');
//       if (!r || !r.svg) throw new Error('No captcha returned');
//       document.getElementById('captcha-holder').innerHTML = r.svg;
//       currentCaptcha = r.captchaId;
//     } catch (err) {
//       console.error('Failed to load captcha:', err);
//       const holder = document.getElementById('captcha-holder');
//       holder.innerHTML = '<div class="text-danger">Unable to load captcha — is the server running?</div>';
//       currentCaptcha = null;
//     }
//   }

//   loadCaptcha();
//   document.getElementById('new-captcha').addEventListener('click', loadCaptcha);

//   login1.addEventListener('submit', async (ev) => {
//     ev.preventDefault();
//     const fd = Object.fromEntries(new FormData(login1));
//     fd.captchaId = currentCaptcha;
//     let r;
//     try {
//       r = await api('/api/login-step1', { method: 'POST', body: JSON.stringify(fd) });
//     } catch (err) {
//       console.error('login-step1 request failed', err);
//       loginResult.innerHTML = '<div class="text-danger">Could not reach server — start it and open via http://localhost:3030</div>';
//       loadCaptcha();
//       return;
//     }
//     if (r && r.error) { loginResult.innerText = r.error; loadCaptcha(); return; }
//     // show questions in step 2
//     login1.style.display = 'none';
//     loginResult.innerText = '';
//     login2wrap.style.display = 'block';
//     login2form.dataset.loginid = r.loginId;
//     const qa = document.getElementById('login-qa'); qa.innerHTML = '';
//     r.questions.forEach((q, idx) => {
//       const div = document.createElement('div'); div.className = 'col-12';
//       div.innerHTML = `<label class="form-label">${q}</label><input class="form-control" name="a${idx}" required />`;
//       qa.appendChild(div);
//     });
//   });

//   login2form.addEventListener('submit', async (ev) => {
//     ev.preventDefault();
//     const loginId = login2form.dataset.loginid;
//     const fm = new FormData(login2form);
//     const answers = [fm.get('a0'), fm.get('a1'), fm.get('a2')];
//     let r;
//     try {
//       r = await api('/api/login-step2', { method: 'POST', body: JSON.stringify({ loginId, answers }) });
//     } catch (err) {
//       console.error('login-step2 failed', err);
//       return loginResult.innerHTML = '<div class="text-danger">Could not complete login — server unreachable.</div>';
//     }
//     if (r && r.error) { loginResult.innerText = r.error; return; }
//     // save token + user for session
//     localStorage.setItem('authToken', r.token);
//     localStorage.setItem('authUser', JSON.stringify(r.user));
//     loginResult.innerHTML = '<div class="status">Login success — redirecting to dashboard...</div>';
//     setTimeout(()=> location.href = '/dashboard.html', 800);
//   });

//   document.getElementById('logout').addEventListener('click', ()=>{
//     login2wrap.style.display='none'; login1.style.display='block';
//   });
// }

// // DASHBOARD
// if (document.body.classList.contains('dashboard') || document.getElementById('openCalendar')) {
//   // pages
//   const token = localStorage.getItem('authToken');
//   const user = JSON.parse(localStorage.getItem('authUser') || 'null');
//   if (!token || !user) { location.href = '/login.html'; }
//   document.getElementById('userInfo').innerText = `${user.name} — ${user.email}`;
//   document.getElementById('welcomeTitle').innerText = `Welcome, ${user.name}`;

//   document.querySelectorAll('.navbtn').forEach(b => b.addEventListener('click', ()=>{
//     const p = b.dataset.page; document.getElementById('pageContent').innerHTML = `<h3>${p}</h3><p>This is placeholder content for ${p}.</p>`;
//   }));

//   document.getElementById('doLogout').addEventListener('click', async ()=>{
//     await api('/api/logout', { method: 'POST', body: JSON.stringify({ token }) });
//     localStorage.removeItem('authToken'); localStorage.removeItem('authUser'); location.href = '/';
//   });

//   const calModal = document.getElementById('calendarModal');
//   document.getElementById('openCalendar').addEventListener('click', async ()=>{
//     calModal.style.display = 'flex'; loadCalendar();
//   });
//   document.getElementById('closeCal').addEventListener('click', ()=> calModal.style.display = 'none');

//   let pollInterval = null;

//   async function loadCalendar() {
//     const c = await api('/api/calendar');
//     const container = document.getElementById('calContainer'); container.innerHTML = '';
//     c.months.forEach(m => {
//       const card = document.createElement('div'); card.className = 'calendar-month-card';
//       card.innerHTML = `<strong>${m.label}</strong>`;
//       m.days.forEach(dd => {
//         const d = document.createElement('div'); d.className = 'day '+dd.status; d.dataset.id = dd.id;
//         d.innerHTML = `<div class="date">${dd.date}</div><div class="meta">${dd.status}${dd.holder ? ' (by you)' : ''}</div>`;
//         if (dd.status === 'available') {
//           d.addEventListener('click', async ()=>{
//             const r = await api('/api/calendar/reserve', { method: 'POST', body: JSON.stringify({ token, dateId: dd.id }) });
//             if (r.error) alert(r.error); else {
//               d.className = 'day reserved';
//               const meta = d.querySelector('.meta'); if (meta) meta.innerText = 'reserved — will book in 5s';
//             }
//           });
//         }
//         card.appendChild(d);
//       });
//       container.appendChild(card);
//     });
//     // poll for status updates
//     if (pollInterval) clearInterval(pollInterval);
//     pollInterval = setInterval(async ()=>{
//       try {
//         const s = await api('/api/calendar/status');
//         // refresh
//         s.months.forEach(m=> m.days.forEach(d => {
//           const el = document.querySelector(`[data-id='${d.id}']`);
//           if (el) {
//             el.className = 'day ' + d.status;
//             const meta = el.querySelector('.meta');
//             if (meta) meta.innerText = d.status + (d.holder ? ' (by you)' : '');
//           }
//         }));
//       } catch (e) {}
//     }, 1000);
//   }

// }

// ===========================================
// 🔁 Auto Backend URL (supports Vercel + local)
// ===========================================
function getBackendUrl() {
  // Vite injects VITE_BACKEND_URL from .env.local or Vercel ENV
  const envUrl = import.meta.env.VITE_BACKEND_URL;

  if (envUrl) {
    return envUrl;
  }

  // Fallback: same origin (for rare cases)
  if (location.hostname !== 'localhost' && location.hostname.includes('.vercel.app')) {
    console.warn('⚠️ VITE_BACKEND_URL not set. Using same origin.');
    return '';
  }

  // Local development
  return 'http://localhost:3030';
}

// ===========================================
// 🌐 Unified API Function
// ===========================================
async function api(path, opts = {}) {
  const baseUrl = getBackendUrl();
  const url = new URL(path, baseUrl).href;

  const optsWithHeaders = {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  };

  try {
    const res = await fetch(url, optsWithHeaders);
    const text = await res.text();

    if (!res.ok) {
      try {
        const parsed = JSON.parse(text);
        return { __error: true, status: res.status, body: parsed };
      } catch (e) {
        return { __error: true, status: res.status, body: text };
      }
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  } catch (err) {
    console.error('API call failed:', err);
    return {
      error: 'Network error — could not reach backend',
      details: String(err)
    };
  }
}

// ===========================================
// 📝 REGISTER FLOW
// ===========================================
if (document.getElementById('stage1')) {
  const stage1 = document.getElementById('stage1');
  const s2wrap = document.getElementById('stage2-wrapper');
  const qaList = document.getElementById('qa-list');
  let registrationId = null;

  stage1.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(stage1));
    const resultEl = document.getElementById('result');
    resultEl.innerText = '';
    let resp;
    try {
      resp = await api('/api/register-stage1', { method: 'POST', body: JSON.stringify(fd) });
    } catch (err) {
      console.error('register-stage1 request failed', err);
      resultEl.innerHTML = '<div class="text-danger">Could not reach server — make sure backend is running.</div>';
      return;
    }
    if (resp && resp.__error) {
      const body = resp.body;
      let msg = `Server error (${resp.status})`;
      if (body) {
        if (typeof body === 'string') msg = body;
        else if (body.error) msg = body.error;
        else msg = JSON.stringify(body);
      }
      resultEl.innerHTML = `<div class="text-danger">${msg}</div>`;
      return;
    }
    registrationId = resp.registrationId;
    try {
      if (registrationId && typeof registrationId === 'string' && registrationId !== 'undefined' && registrationId !== 'null') {
        sessionStorage.setItem('registrationId', registrationId);
      } else {
        sessionStorage.removeItem('registrationId');
      }
    } catch(e) {}
    const q = await api('/api/questions');
    if (!q || q.error || !q.questions) {
      const message = (q && (q.error || q.details)) ? (q.error || q.details) : 'Unable to fetch security questions.';
      resultEl.innerHTML = `<div class="text-danger">${message}</div>`;
      return;
    }
    qaList.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const div = document.createElement('div');
      div.className = 'col-12';
      div.innerHTML = `
        <label class="form-label">Question ${i+1}</label>
        <select class="form-select" data-index="${i}" name="q${i}"></select>
        <label class="form-label mt-2">Answer</label>
        <input class="form-control" name="a${i}" required />
      `;
      qaList.appendChild(div);
      const sel = div.querySelector('select');
      q.questions.forEach(opt => {
        const o = document.createElement('option'); o.value = opt; o.textContent = opt; sel.appendChild(o);
      });
    }
    stage1.style.display = 'none';
    s2wrap.style.display = 'block';
  });

  document.getElementById('backTo1').addEventListener('click', () => {
    stage1.style.display = 'block'; s2wrap.style.display = 'none';
  });

  document.getElementById('stage2').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fm = new FormData(ev.target);
    if (!registrationId) {
      try {
        const stored = sessionStorage.getItem('registrationId');
        if (stored && stored !== 'undefined' && stored !== 'null') registrationId = stored; else registrationId = null;
      } catch(e) { registrationId = null; }
    }
    if (!registrationId) return document.getElementById('result').innerHTML = '<div class="text-danger">Registration session missing — please start again.</div>';
    const answers = [];
    for (let i=0;i<3;i++) answers.push({ question: fm.get('q'+i), answer: fm.get('a'+i) });
    let resp;
    try {
      resp = await api('/api/register-stage2', { method: 'POST', body: JSON.stringify({ registrationId, answers }) });
    } catch (err) {
      console.error('register-stage2 failed', err);
      return document.getElementById('result').innerHTML = '<div class="text-danger">Could not save registration.</div>';
    }
    if (resp && resp.error) return document.getElementById('result').innerText = resp.error;
    try { sessionStorage.removeItem('registrationId'); } catch(e) {}
    document.getElementById('result').innerHTML = '<div class="status">Registration complete — you can now <a href="/login.html">login</a></div>';
    s2wrap.style.display = 'none';
  });
}

// ===========================================
// 🔑 LOGIN FLOW
// ===========================================
if (document.getElementById('login1')) {
  let currentCaptcha = null;
  const login1 = document.getElementById('login1');
  const login2wrap = document.getElementById('login2-wrapper');
  const login2form = document.getElementById('login2');
  const loginResult = document.getElementById('login-result');

  async function loadCaptcha() {
    try {
      const r = await api('/api/captcha');
      if (!r || !r.svg) throw new Error('No captcha returned');
      document.getElementById('captcha-holder').innerHTML = r.svg;
      currentCaptcha = r.captchaId;
    } catch (err) {
      console.error('Failed to load captcha:', err);
      const holder = document.getElementById('captcha-holder');
      holder.innerHTML = '<div class="text-danger">Unable to load captcha.</div>';
      currentCaptcha = null;
    }
  }

  loadCaptcha();
  document.getElementById('new-captcha').addEventListener('click', loadCaptcha);

  login1.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(login1));
    fd.captchaId = currentCaptcha;
    let r;
    try {
      r = await api('/api/login-step1', { method: 'POST', body: JSON.stringify(fd) });
    } catch (err) {
      console.error('login-step1 request failed', err);
      loginResult.innerHTML = '<div class="text-danger">Could not reach server.</div>';
      loadCaptcha();
      return;
    }
    if (r && r.error) { loginResult.innerText = r.error; loadCaptcha(); return; }
    login1.style.display = 'none';
    loginResult.innerText = '';
    login2wrap.style.display = 'block';
    login2form.dataset.loginid = r.loginId;
    const qa = document.getElementById('login-qa'); qa.innerHTML = '';
    r.questions.forEach((q, idx) => {
      const div = document.createElement('div'); div.className = 'col-12';
      div.innerHTML = `<label class="form-label">${q}</label><input class="form-control" name="a${idx}" required />`;
      qa.appendChild(div);
    });
  });

  login2form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const loginId = login2form.dataset.loginid;
    const fm = new FormData(login2form);
    const answers = [fm.get('a0'), fm.get('a1'), fm.get('a2')];
    let r;
    try {
      r = await api('/api/login-step2', { method: 'POST', body: JSON.stringify({ loginId, answers }) });
    } catch (err) {
      console.error('login-step2 failed', err);
      return loginResult.innerHTML = '<div class="text-danger">Could not complete login.</div>';
    }
    if (r && r.error) { loginResult.innerText = r.error; return; }
    localStorage.setItem('authToken', r.token);
    localStorage.setItem('authUser', JSON.stringify(r.user));
    loginResult.innerHTML = '<div class="status">Login success — redirecting...</div>';
    setTimeout(()=> location.href = '/dashboard.html', 800);
  });

  document.getElementById('logout').addEventListener('click', ()=>{
    login2wrap.style.display='none'; login1.style.display='block';
  });
}

// ===========================================
// 📊 DASHBOARD + CALENDAR
// ===========================================
if (document.body.classList.contains('dashboard') || document.getElementById('openCalendar')) {
  const token = localStorage.getItem('authToken');
  const user = JSON.parse(localStorage.getItem('authUser') || 'null');
  if (!token || !user) { location.href = '/login.html'; }
  document.getElementById('userInfo')?.setAttribute('innerText', `${user.name} — ${user.email}`);
  document.getElementById('welcomeTitle')?.setAttribute('innerText', `Welcome, ${user.name}`);

  document.querySelectorAll('.navbtn').forEach(b => b.addEventListener('click', ()=>{
    const p = b.dataset.page; document.getElementById('pageContent').innerHTML = `<h3>${p}</h3><p>This is placeholder content for ${p}.</p>`;
  }));

  document.getElementById('doLogout')?.addEventListener('click', async ()=>{
    await api('/api/logout', { method: 'POST', body: JSON.stringify({ token }) });
    localStorage.removeItem('authToken'); localStorage.removeItem('authUser'); location.href = '/';
  });

  const calModal = document.getElementById('calendarModal');
  document.getElementById('openCalendar')?.addEventListener('click', async ()=>{
    calModal.style.display = 'flex'; loadCalendar();
  });
  document.getElementById('closeCal')?.addEventListener('click', ()=> calModal.style.display = 'none');

  let pollInterval = null;

  async function loadCalendar() {
    const c = await api('/api/calendar');
    const container = document.getElementById('calContainer'); container.innerHTML = '';
    c.months.forEach(m => {
      const card = document.createElement('div'); card.className = 'calendar-month-card';
      card.innerHTML = `<strong>${m.label}</strong>`;
      m.days.forEach(dd => {
        const d = document.createElement('div'); d.className = 'day '+dd.status; d.dataset.id = dd.id;
        d.innerHTML = `<div class="date">${dd.date}</div><div class="meta">${dd.status}${dd.holder ? ' (by you)' : ''}</div>`;
        if (dd.status === 'available') {
          d.addEventListener('click', async ()=>{
            const r = await api('/api/calendar/reserve', { method: 'POST', body: JSON.stringify({ token, dateId: dd.id }) });
            if (r.error) alert(r.error); else {
              d.className = 'day reserved';
              const meta = d.querySelector('.meta'); if (meta) meta.innerText = 'reserved — will book in 5s';
            }
          });
        }
        card.appendChild(d);
      });
      container.appendChild(card);
    });
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async ()=>{
      try {
        const s = await api('/api/calendar/status');
        s.months.forEach(m=> m.days.forEach(d => {
          const el = document.querySelector(`[data-id='${d.id}']`);
          if (el) {
            el.className = 'day ' + d.status;
            const meta = el.querySelector('.meta');
            if (meta) meta.innerText = d.status + (d.holder ? ' (by you)' : '');
          }
        }));
      } catch (e) {}
    }, 2000);
  }
}