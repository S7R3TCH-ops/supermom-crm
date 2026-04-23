// ============================================================================
// 1. CONSTANTS, GLOBALS & STATE
// ============================================================================
const APP_VERSION = '4.13';

const GAS_URL = "https://script.google.com/macros/s/AKfycbwmhWli_n6kSgG9LiHWJrZGeZ73uvz7XrgO0G24i6MRyCcdFJ65hCmtY5oPPqCMZ9CEEA/exec";

const DL = {
  services: ['Deep Clean','Regular Clean','Move In / Move Out','Post-Renovation','Organization',
    'Laundry & Folding','Fridge & Oven Clean','Window Washing','Senior Companionship',
    'Childcare Support','Caregiving','Coaching Session','Errands / Tasks','Other / Custom'],
  referral_sources: ['Word of Mouth','Google Search','Facebook','Instagram',
    'Kijiji','Returning Client','Neighbour Referral','Flyer / Postcard','Other'],
  payment_methods: ['Cash','E-Transfer','Cheque','Other'],
  prepaid_reasons: ['Client Pre-Paid','Deposit Received','Gift / Package','Other'],
};

// Placeholder for your giant base64 string. Paste it back in later!
const GLOBAL_LOGO = "https://lh3.googleusercontent.com/d/1vYV_0VFk2MF8QrZyQ77BKyx4hnpuDqSb";

const DEFAULT_BIZ = {
  biz: 'Supermom for Hire',
  owner: 'Sandra',
  rate: 50,
  hst_num: '',
  tax_rate: 0.13,
  tax_enabled: 'FALSE', 
  service_prices: {},
  logo: GLOBAL_LOGO 
};

let S = {
  clients: [], jobs: [], financials: [],
  lists: JSON.parse(JSON.stringify(DL)),
  biz: JSON.parse(JSON.stringify(DEFAULT_BIZ)),
  view: 'dashboard', stack: [],
  curCli: null, editCli: null,
  cliStatus: 'Lead', priceType: 'Hourly', schedType: 'hard',
  jobModal: null, followUp: 'No', payNow: false, reqRev: false,
  listMeta: null, notesMeta: null, isDemo: false, 
  showAllSched: false, showAllArc: false, showAllOwed: false, showAllUnschd: false, showAllOver: false, showAllFu: false, showAllRev: false, showAllLead: false, moneyFilter: 'month',
  profileJobFilter: 'all',
  showMoneyOwed: false, showMoneyPaid: false
};

let _isSaving = false;
let _reqs = 0;
let _backLock = false;
let _tt;

const _pendingDeletes = { jobs: new Set(), clients: new Set() };

try {
  const saved = JSON.parse(localStorage.getItem('smhq_pending_deletes') || '{}');
  if (saved.jobs) saved.jobs.forEach(id => _pendingDeletes.jobs.add(id));
  if (saved.clients) saved.clients.forEach(id => _pendingDeletes.clients.add(id));
} catch(e) {}

// ============================================================================
// 2. UTILITY FUNCTIONS
// ============================================================================

const taxRate = () => String(S.biz.tax_enabled).toUpperCase() === 'TRUE' ? 0.13 : 0;
const hourlyRate = () => S.biz.rate || 50;
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const shortId = () => Math.random().toString(36).slice(2, 8);

const getCli = id => S.clients.find(c => c.Client_ID === id) || {};
const getJob = id => S.jobs.find(j => j.Job_ID === id) || {};
const getInv = jid => S.financials.find(f => f.Job_ID === jid);
const gl = k => S.lists[k] || DL[k] || [];

const fullN = c => ((c.First_Name || '') + ' ' + (c.Last_Name || '')).trim() || 'Unknown';
const inits = c => (((c.First_Name || '')[0] || '') + ((c.Last_Name || '')[0] || '')).toUpperCase() || '??';

const fmtD = d => { if(!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }); };
const fmtDFull = d => { if(!d) return '—'; return new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtT = t => {
  if(!t || t.includes('1899')) return '';
  try {
    const [h, m] = t.split(':');
    if(h === undefined || m === undefined) return t;
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m}${hr >= 12 ? 'pm' : 'am'}`;
  } catch { return t; }
};

function fmtTRange(j) {
  const hrs = parseFloat(j.Estimated_Hours || 1);
  if(j.Time && !j.Time.includes('1899')) {
    try {
      const [h, m] = j.Time.split(':');
      const start = new Date(); start.setHours(parseInt(h), parseInt(m), 0, 0);
      const end = new Date(start.getTime() + hrs * 3600000);
      const fmt = d => { const hr=d.getHours(),mn=d.getMinutes(); return `${hr%12||12}${mn?':'+String(mn).padStart(2,'0'):''}${hr>=12?'pm':'am'}`; };
      return fmt(start) + ' → ' + fmt(end);
    } catch(e) {}
  }
  return '~' + hrs + ' hr' + (hrs !== 1 ? 's' : '');
}

function formatVal(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money') {
    const n = parseFloat(v);
    return isNaN(n) ? '$0.00' : '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === 'date') {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return v;
}

// Fixed escaping to prevent HTML/JS compilation crashes
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

// Bulletproof math parser to stop NaN crashes
const parseMoney = val => parseFloat(String(val || "0").replace(/[^0-9.-]+/g, "")) || 0;

// Phone normalization: strips non-digits, removes leading 1 from 11-digit numbers.
// Returns 10-digit string, '' if non-standard length (treat as blank), null if too short to be valid.
function normalizePhone(val) {
  if(!val) return '';
  const digits = String(val).replace(/\D/g, '');
  if(digits.length < 7) return null;
  if(digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if(digits.length === 10) return digits;
  return '';
}

// Display formatter: converts 10-digit string to (XXX) XXX-XXXX, falls back to raw.
function formatPhone(val) {
  if(!val) return '';
  const d = String(val).replace(/\D/g, '');
  if(d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return val;
}

const isPaidJob = j => {
  if(j.Payment_Status === 'Paid') return true;
  if(j.Payment_Status === 'Partial') return false;
  const inv = getInv(j.Job_ID);
  return !!(inv && inv.Status === 'Paid');
};
const isArchived = j => j.Job_Status === 'Completed' && isPaidJob(j) && j.Follow_Up !== 'Yes' && j.Review_Status !== 'Pending';

const $ = id => document.getElementById(id);

function showMo(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('show');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    const inner = el.querySelector('.msheet');
    if (inner) inner.scrollTop = 0;
  });
}

function closeMo(id, e) { const el=$(id); if(!el)return; if(e && e.target !== el) return; el.classList.remove('show'); document.body.classList.remove('modal-open'); }

function showToast(m) {
  const t = $('toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(_tt);
  _tt = setTimeout(() => t.classList.remove('show'), 2800);
}

function row(label, sub, val, color) {
  return `<div style="display:flex;justify-content:space-between;margin-bottom:4px;${color ? 'color:' + color + ';' : ''}"><span>${label}${sub ? ` <span style="color:var(--txt3);font-size:11px;">${sub}</span>` : ''}</span><span>${val}</span></div>`;
}

function dsec(lid, sid, jobs, type, cap, showAll, toggleFn) {
  const l = $(lid); const s = $(sid);
  if (!l || !s) return;
  if (!jobs || jobs.length === 0) { s.classList.add('hidden'); return; }
  s.classList.remove('hidden');
  const display = (cap && !showAll) ? jobs.slice(0, cap) : jobs;
  const overflow = cap ? Math.max(0, jobs.length - display.length) : 0;
  const moreHtml = overflow > 0 && toggleFn
    ? `<div class="show-more-link" onclick="${toggleFn}()">+ ${overflow} more</div>` : '';
  l.innerHTML = display.map(j => jrHTML(j, type)).join('') + moreHtml;
}

function savePendingDeletes() {
  try {
    localStorage.setItem('smhq_pending_deletes', JSON.stringify({
      jobs: [..._pendingDeletes.jobs],
      clients: [..._pendingDeletes.clients]
    }));
  } catch(e) {}
}

// ============================================================================
// 2b. FINANCIAL BRAIN — single source of truth for all job math
// ============================================================================

// Pass a job object + optional form overrides (what the user typed).
// Overrides: { hrs, flatRate, surcharge, addCost, pricingType }
function getJobTotals(j, ov) {
  ov = ov || {};
  // Prefer the override rate, then the job's stored rate, then the current global rate.
  const rate = ov.rate !== undefined ? parseFloat(ov.rate) 
             : (parseFloat(j.Hourly_Rate) || parseFloat(S.biz.rate) || 50);
  const tRate  = (j.HST_Rate !== undefined && j.HST_Rate !== '') ? parseFloat(j.HST_Rate) || 0 : taxRate();
  const isFlat = (ov.pricingType || j.Pricing_Type) === 'Flat';

  let base = 0;
  if (isFlat) {
    base = parseMoney(ov.flatRate !== undefined ? ov.flatRate : j.Flat_Rate);
  } else {
    const hrsSource = ov.hrs !== undefined ? ov.hrs
      : (j.Job_Status === 'Completed' ? (j.Actual_Duration || j.Estimated_Hours)
                                       : j.Estimated_Hours);
    base = (parseFloat(hrsSource) || 0) * rate;
  }

  const sur     = parseMoney(ov.surcharge !== undefined ? ov.surcharge : j.Surcharge);
  const addCost = parseMoney(ov.addCost   !== undefined ? ov.addCost   : j.Additional_Cost);
  const sub     = base + sur + addCost;
  const hst     = sub * tRate;
  const total   = sub + hst;

  const prePaid = parseMoney(j.PrePaid_Amount);
  const paid    = j.Payment_Status === 'Paid'    ? total
                : j.Payment_Status === 'Partial' ? prePaid
                : 0;
  const balance = Math.max(0, total - paid);

  return { base, sur, addCost, sub, hst, total, paid, balance, tRate, isFlat, rate };
}

// ============================================================================
// 3. CORE API / DATA SYNC (HYBRID)
// ============================================================================

function showLoader() { if(_reqs++ === 0) $('global-loader').classList.add('show'); }
function hideLoader() { if(--_reqs <= 0) { _reqs = 0; $('global-loader').classList.remove('show'); } }

async function gasCall(payload, isRetry = false) {
  showLoader();
  try {
    // GET with payload as URL param — works from GAS iframe and GitHub Pages (no CORS preflight)
    const url = GAS_URL + '?payload=' + encodeURIComponent(JSON.stringify(payload));
    const r = await fetch(url, { method: 'GET', redirect: 'follow' });
    const json = await r.json();
    hideLoader();
    if (!json.success) console.error('GAS Error:', json.error);
    return json;
  } catch (e) {
    hideLoader();
    console.error('GAS Connection Error:', e);
    // Queue write actions for later sync when offline
    if (!isRetry && payload.action !== 'getAllData') {
      try {
        const q = JSON.parse(localStorage.getItem('smhq_queue') || '[]');
        q.push({ payload, timestamp: Date.now() });
        localStorage.setItem('smhq_queue', JSON.stringify(q));
        showToast('📴 Offline. Change queued for sync.');
      } catch(_) {}
    }
    return { success: false, offline: true };
  }
}


async function loadAllData() {
  if(S.isDemo){ loadDemo(); return; }
  try {
    const cached = localStorage.getItem('smhq_cache');
    if(cached){
      const p = JSON.parse(cached);
      S.clients=p.clients; S.jobs=p.jobs; S.financials=p.financials; S.lists=p.lists;
      refreshAll();
    }
  } catch(e){}
  
  const r = await gasCall({ action: 'getAllData' });
  if(r.success){
    S.clients = (r.clients || []).filter(c => !_pendingDeletes.clients.has(c.Client_ID));
    S.jobs = (r.jobs || []).filter(j => !_pendingDeletes.jobs.has(j.Job_ID));
    S.financials = r.financials || [];
    S.lists = r.lists || S.lists;
    if(r.biz) S.biz = Object.assign(S.biz, r.biz);

    updateHeaderBrand();
    refreshAll();
    cacheWrite();
    await drainOfflineQueue(true);
  } else {
    showToast('⚠️ Couldn\'t sync — showing saved data');
  }
}

// fromLoad=true skips the post-drain loadAllData re-sync (caller is already inside one)
async function drainOfflineQueue(fromLoad = false) {
  try{
    const raw = localStorage.getItem('smhq_queue');
    if(!raw) return;
    const q = JSON.parse(raw);
    if(!q.length) return;

    localStorage.removeItem('smhq_queue');
    const synced = q.length;
    showToast('🔄 Syncing '+synced+' offline change'+(synced!==1?'s':'')+'…');

    // Fire all queued writes in parallel — no ordering dependency between them
    const results = await Promise.allSettled(q.map(item => gasCall(item.payload, true)));
    const failed = q.filter((_, i) => {
      const res = results[i];
      return res.status==='rejected' || res.value?.offline || !res.value?.success;
    });

    const currentQueue = JSON.parse(localStorage.getItem('smhq_queue')||'[]');
    if (failed.length || currentQueue.length) {
      localStorage.setItem('smhq_queue',JSON.stringify([...failed,...currentQueue]));
    }

    if(!failed.length){
      showToast('✅ '+synced+' offline change'+(synced!==1?'s':'')+' synced');
      // Re-sync from GAS to pull canonical IDs for queued adds
      if(!fromLoad) await loadAllData();
    } else {
      showToast('⚠️ '+failed.length+' change'+(failed.length!==1?'s':'')+' still pending');
    }
  }catch(e){ console.warn('drainOfflineQueue error:', e); }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
function cacheWrite() {
  try { localStorage.setItem('smhq_cache', JSON.stringify({clients:S.clients, jobs:S.jobs, financials:S.financials, lists:S.lists})); } catch(e) {}
}
function cacheInvalidate() {
  try { localStorage.removeItem('smhq_cache'); } catch(e) {}
}
function queueRequest(payload) {
  try { const q=JSON.parse(localStorage.getItem('smhq_queue')||'[]'); q.push({payload}); localStorage.setItem('smhq_queue', JSON.stringify(q)); } catch(e) {}
}

function loadDemo() {
  S.clients=[]; S.jobs=[]; S.financials=[];
  refreshAll();
}

function refreshAll() {
  renderDash(); renderCli(); popCliDrop(); popLists(); renderAdmin(); renderSvcPrices();
}

function refreshData() {
  if(S.view==='dashboard') renderDash();
  else if(S.view==='clients') renderCli();
  else if(S.view==='profile') openProfile(S.curCli);
  else if(S.view==='admin') renderAdmin();
  popCliDrop(); popLists();
}

// ============================================================================
// 5. EVENT LISTENERS & INITIALIZATION
// ============================================================================

window.addEventListener('DOMContentLoaded', () => {
  const p = new URLSearchParams(location.search);
  S.isDemo = p.get('demo') === '1';
  $('ver-txt').textContent = APP_VERSION;
  if(S.isDemo) $('demo-bar').classList.remove('hidden');
  
  const d = new Date();
  $('t-dayname').textContent = d.toLocaleDateString('en-CA', { weekday: 'long' });
  $('t-date').textContent = d.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
  
  // Select text on input focus
  document.addEventListener('focus', e => {
  if(e.target.matches('input.fi, textarea.fi')) { e.target.select(); }
  }, true);

  // Global Event Delegation for buttons/actions
  document.getElementById('scroll').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if(btn){
      e.stopPropagation();
      const action = btn.dataset.action;
      const jid = btn.dataset.jid;
      const cid = btn.dataset.cid;
      if(action==='complete')       openCompleteModal(jid);
      if(action==='paid')           quickMarkPaid(jid);
      if(action==='clearfu')        clearFU(jid);
      if(action==='revreq')         markRevRequested(jid);
      if(action==='schedule')       openJobModal(jid);
      if(action==='booklead')       openBookJobForLead(cid);
      if(action==='open-profile')   openProfile(cid);
      if(action==='open-job')       openJobModal(jid);
      if(action==='openEditNotes')  openEditNotes();
      if(action==='openEditAccess') openEditAccess();
      if(action==='openEditFamily') openEditFamily();
      if(action==='p-paid')         quickMarkPaid(jid);
      if(action==='p-prepay')       openPaidModal(jid);
      if(action==='p-edit')         openJobModal(jid);
      if(action==='bookagain')      bookAgain(jid);
      return;
    }
    const ladmin = e.target.closest('.ladmin');
    if(ladmin){
      e.stopPropagation();
      const act = ladmin.dataset.ladmin; const k = ladmin.dataset.lk; const i = parseInt(ladmin.dataset.li);
      if(act==='add')  openLAdd(k);
      if(act==='edit') openLEdit(k,i);
      if(act==='del')  delListItem(k,i);
    }
  });

  // Call loadBizConfig if it exists in Admin section later
  if (typeof loadBizConfig === 'function') loadBizConfig();
  updHeader('dashboard');
  renderDash();
  loadAllData(); 
  if (typeof calc === 'function') calc();

  window.addEventListener('popstate', () => {
    if (!_backLock) goBack();
  });
});


// ============================================================================
// 6. UI NAVIGATION
// ============================================================================

function navTo(v, push=false) {
  if(push) { S.stack.push(S.view); history.pushState({}, ''); }
  else { S.stack=[]; history.replaceState({}, ''); }
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  document.getElementById('view-'+v).classList.add('active');
  requestAnimationFrame(()=>{document.getElementById('scroll').scrollTop=0;});
  S.view=v; updHeader(v); updNav(v);
  if(v==='dashboard') renderDash();
  else if(v==='clients') renderCli();
}

function goBack() {
  if(_backLock) return; _backLock=true; setTimeout(()=>_backLock=false,400);
  if(S.stack.length){
    const p = S.stack.pop();
    document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
    document.getElementById('view-'+p).classList.add('active');
    requestAnimationFrame(()=>{document.getElementById('scroll').scrollTop=0;});
    S.view=p; updHeader(p); updNav(p);
    if(p==='dashboard') renderDash();
    else if(p==='clients') renderCli();
  } else navTo('dashboard');
}

function updHeader(v) {
  const bk=$('hbk'), ac=$('hacts');
  ac.innerHTML=''; bk.classList.add('hidden');
  const hc=$('htc'); if(hc) hc.remove();
  const hb=(ic,fn)=>{const b=document.createElement('button');b.className='hb';b.textContent=ic;b.onclick=fn;return b;};
  const isDash=v==='dashboard';
  
  const logoEl=$('brand-logo');
  if(logoEl){
    if(isDash){logoEl.classList.remove('logo-sm');}
    else{logoEl.classList.add('logo-sm');}
  }
  
  const titleEl=$('brand-title');
  if(titleEl) titleEl.style.display='';
  
  if(v==='dashboard')  ac.appendChild(hb('↺',loadAllData));
  if(v==='clients')    {bk.classList.remove('hidden');setHT('Clients');ac.appendChild(hb('+',startAddClient));}
  if(v==='add-client') {bk.classList.remove('hidden');setHT(S.editCli?'Edit Client':'New Client');}
  if(v==='book-job')   {bk.classList.remove('hidden');setHT('Book a Job');}
  if(v==='profile')    {bk.classList.remove('hidden');setHT(S.curCli?fullN(getCli(S.curCli)):'Client');ac.appendChild(hb('✏️',editClient));ac.appendChild(hb('+',openBookJobForClient));}
  if(v==='admin')      {bk.classList.remove('hidden');setHT('Admin & Settings');if(typeof renderAdmin === 'function') renderAdmin();if(typeof syncBizUI === 'function') syncBizUI();}
}

function setHT(t) {
  document.querySelectorAll('#htc').forEach(el=>el.remove()); 
  const d=document.createElement('div'); d.id='htc'; d.textContent=t; 
  const htw=$('htw'); if(htw) htw.appendChild(d);
}

function updNav(v) {
  document.querySelectorAll('.ni').forEach(n=>n.classList.toggle('active',n.dataset.v===v));
}

// ============================================================================
// 7. DASHBOARD LOGIC
// ============================================================================

function renderDash() {
  renderEarnBars();
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  const allPaid = S.financials.filter(f => f.Status === 'Paid');
  const paidThisMonth = allPaid.filter(f => String(f.Paid_Date).startsWith(thisMonth));
  const displayPaid = S.moneyFilter === 'month' ? paidThisMonth : allPaid;
  const totalCollected = displayPaid.reduce((sum, f) => sum + parseMoney(f.Amount), 0);

  const owedJobs = S.jobs.filter(j => j.Job_Status === 'Completed' && !isPaidJob(j));
  const totalOwed = owedJobs.reduce((sum, j) => sum + parseMoney(j.Total_Amount), 0);

  if($('m-owed')) $('m-owed').textContent = S.showMoneyOwed ? '$' + totalOwed.toFixed(2) : '$****';
  if($('m-owed-s')) $('m-owed-s').textContent = owedJobs.length + ' unpaid';
  if($('m-paid')) $('m-paid').textContent = S.showMoneyPaid ? '$' + totalCollected.toFixed(2) : '$****';
  if($('m-paid-s')) $('m-paid-s').textContent = displayPaid.length + (S.moneyFilter === 'month' ? ' this month' : ' total');

  if($('mf-month')) $('mf-month').className = S.moneyFilter === 'month' ? 'tb on' : 'tb';
  if($('mf-all')) $('mf-all').className = S.moneyFilter === 'all' ? 'tb on' : 'tb';

  const tod = today();
  const todayJobs = S.jobs.filter(j => j.Job_Status === 'Scheduled' && j.Scheduled_Date === tod)
    .map(j => {
      let isPastDue = false;
      if(j.Time && !j.Time.includes('1899')){
        try {
          const [h, m] = j.Time.split(':');
          const start = new Date(); start.setHours(parseInt(h), parseInt(m), 0, 0);
          const hrs = parseFloat(j.Estimated_Hours || 1);
          const end = new Date(start.getTime() + hrs * 3600000);
          isPastDue = end < now;
        } catch(e) {}
      }
      return {...j, _pastDue: isPastDue};
    })
    .sort((a, b) => {
      if (a._pastDue && !b._pastDue) return -1;
      if (!a._pastDue && b._pastDue) return 1;
      return (a.Time || '').localeCompare(b.Time || '');
    });

  if($('t-ct')) $('t-ct').textContent = todayJobs.length ? todayJobs.length + ' job(s) scheduled today' : 'No jobs today — enjoy your day! 🌸';
  
  const upNextId = todayJobs.find(j => !j._pastDue)?.Job_ID || null;
  const tjList = $('today-jobs-list');
  if(tjList) {
    tjList.innerHTML = todayJobs.map(j => {
      const c = getCli(j.Client_ID);
      const pd = j._pastDue;
      const isUpNext = !pd && j.Job_ID === upNextId;
      const hasTime = j.Time && !j.Time.includes('1899');
      const timeRange = hasTime ? fmtTRange(j) : '';
      const hrs = parseFloat(j.Estimated_Hours || 1);
      const [tStart, tEnd] = hasTime ? timeRange.split(' → ') : ['—', ''];
      const hrsNote = !hasTime ? '~' + hrs + ' hr' + (hrs !== 1 ? 's' : '') : '';
      const col = pd ? 'color:var(--orange);' : isUpNext ? 'color:var(--pink);font-weight:900;' : '';
      return `<div class="today-job" data-action="open-job" data-jid="${esc(j.Job_ID)}" style="${pd?'border-left:3px solid var(--orange);background:rgba(192,88,0,.07);':isUpNext?'border-left:3px solid var(--pink);':''}">
        <div class="tj-time" style="display:flex;flex-direction:column;align-items:center;gap:1px;${col}">
          <span>${tStart}</span>
          ${tEnd ? `<span style="font-size:11px;font-weight:900;opacity:0.75;line-height:1;">↓</span><span>${tEnd}</span>` : ''}
        </div>
        <div class="tj-info">
          <div class="tj-name">${esc(fullN(c))}${pd?` <span class="pill p-ora" style="font-size:9px;">⚠️ Past Due</span>`:isUpNext?` <span class="pill p-pink" style="font-size:9px;">⚡ Up Next</span>`:''}</div>
          <div class="tj-svc">${esc(j.Service)}</div>
          ${hrsNote ? `<div style="font-size:11px;color:var(--txt3);margin-top:1px;">${hrsNote}</div>` : ''}
        </div>
        <button class="btn b-sm b-p" data-action="complete" data-jid="${esc(j.Job_ID)}">✅ Done</button>
      </div>`;
    }).join('');
  }

  const allFuture = S.jobs.filter(j => j.Job_Status === 'Scheduled' && j.Scheduled_Date > tod && j.Scheduled_Date !== '')
    .sort((a, b) => (a.Scheduled_Date || '').localeCompare(b.Scheduled_Date || ''));
  dsec('d-upcoming', 'd-upcoming-sec', allFuture, 'sched', 3, S.showAllSched, 'showAllSched');

  const unschd = S.jobs.filter(j => j.Job_Status === 'Scheduled' && (!j.Scheduled_Date || j.Scheduled_Date === ''));
  dsec('d-unschd', 'd-unschd-sec', unschd, 'unschd', 3, S.showAllUnschd, 'showAllUnschd');

  const overdue = S.jobs.filter(j => j.Job_Status === 'Scheduled' && j.Scheduled_Date !== '' && j.Scheduled_Date < tod)
    .sort((a, b) => (a.Scheduled_Date || '').localeCompare(b.Scheduled_Date || ''));
  dsec('d-overdue', 'd-overdue-sec', overdue, 'overdue', 3, S.showAllOver, 'showAllOver');

  dsec('d-owed', 'd-owed-sec', owedJobs, 'owed', 3, S.showAllOwed, 'showAllOwed');

  const fuJobs = S.jobs.filter(j => j.Follow_Up === 'Yes' && j.Job_Status !== 'Cancelled' && !(j.Job_Status === 'Completed' && !isPaidJob(j)));
  dsec('d-fu', 'd-fu-sec', fuJobs, 'fu', 3, S.showAllFu, 'showAllFu');

  const revJobs = S.jobs.filter(j => j.Review_Status === 'Pending' && j.Job_Status === 'Completed');
  dsec('d-rev', 'd-rev-sec', revJobs, 'review', 3, S.showAllRev, 'showAllRev');

  const archived = S.jobs.filter(isArchived).sort((a, b) => (b.Completion_Date || '').localeCompare(a.Completion_Date || ''));
  dsec('d-arc', 'd-arc-sec', archived, 'paid', 3, S.showAllArc, 'showAllArchived');

  const leads = S.clients.filter(c => c.Status === 'Lead');
  if(!leads.length) {
    if($('d-lead-sec')) $('d-lead-sec').classList.add('hidden');
  } else {
    if($('d-lead-sec')) $('d-lead-sec').classList.remove('hidden');
    const displayLeads = S.showAllLead ? leads : leads.slice(0, 3);
    const leadOverflow = leads.length - displayLeads.length;
    const leadMoreHtml = leadOverflow > 0
      ? `<div class="show-more-link" onclick="showAllLead()">+ ${leadOverflow} more</div>` : '';
    if($('d-lead')) $('d-lead').innerHTML = displayLeads.map(c => `
      <div class="jr lead">
        <div class="ji">🟡</div>
        <div class="jd" data-action="open-profile" data-cid="${esc(c.Client_ID)}" style="cursor:pointer;">
          <div class="jn">${esc(fullN(c))}</div>
          <div class="jm">${esc(formatPhone(c.Phone) || 'No phone')} · ${esc(c.Referral_Source || '—')}</div>
        </div>
        <button class="btn b-sm b-p" data-action="booklead" data-cid="${esc(c.Client_ID)}">📅 Book</button>
      </div>`).join('') + leadMoreHtml;
  }
}

function setMoneyFilter(f)  { S.moneyFilter=f;     renderDash(); }
function toggleMoney(e, type) {
  if (e) e.stopPropagation();
  const key = 'showMoney' + type;
  S[key] = !S[key];
  renderDash();
}
function showAllSched()     { S.showAllSched=true;  renderDash(); }
function showAllArchived()  { S.showAllArc=true;    renderDash(); }
function showAllOwed()      { S.showAllOwed=true;   renderDash(); }
function showAllUnschd()    { S.showAllUnschd=true; renderDash(); }
function showAllOver()      { S.showAllOver=true;   renderDash(); }
function showAllFu()        { S.showAllFu=true;     renderDash(); }
function showAllRev()       { S.showAllRev=true;    renderDash(); }
function showAllLead()      { S.showAllLead=true;   renderDash(); }

function showOwedList() {
  const owedJobs = S.jobs.filter(j => j.Job_Status === 'Completed' && !isPaidJob(j))
    .sort((a, b) => (b.Completion_Date || '').localeCompare(a.Completion_Date || ''));
  const total = owedJobs.reduce((s, j) => s + parseMoney(j.Total_Amount), 0);
  if ($('m-money-t')) $('m-money-t').textContent = '💰 Owed — $' + total.toFixed(2);
  const body = $('m-money-body');
  if (!body) return;
  if (!owedJobs.length) {
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--txt3);font-size:13px;">No unpaid jobs — you\'re all caught up! 🎉</div>';
  } else {
    body.innerHTML = owedJobs.map(j => {
      const c = getCli(j.Client_ID);
      const t = getJobTotals(j);
      const isPartial = j.Payment_Status === 'Partial';
      const prePaid = parseMoney(j.PrePaid_Amount);
      const bal = isPartial ? Math.max(0, t.total - prePaid) : t.total;
      const ppPill = isPartial ? `<span class="pill p-pur" style="font-size:9px;">💜 $${prePaid.toFixed(2)} deposit</span>` : '';
      return `<div class="jr owed" style="cursor:pointer;" onclick="closeMo('m-money');openJobModal('${esc(j.Job_ID)}')">
        <div class="ji">🔴</div>
        <div class="jd" style="pointer-events:none;">
          <div class="jn">${esc(fullN(c))}</div>
          <div class="jm">${esc(j.Service)}</div>
          <div class="jm">${j.Completion_Date ? '✅ Done ' + fmtD(j.Completion_Date) : ''}${j.Scheduled_Date && !j.Completion_Date ? '📅 Sched. ' + fmtD(j.Scheduled_Date) : ''}</div>
          ${ppPill ? `<div style="margin-top:4px;">${ppPill}</div>` : ''}
        </div>
        <div class="jr-right" style="pointer-events:none;">
          <span class="ja" style="color:var(--red);">$${bal.toFixed(2)}</span>
          ${isPartial ? `<div style="font-size:10px;color:var(--txt3);">of $${t.total.toFixed(2)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  showMo('m-money');
}

function showCollectedList() {
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const allPaid = S.financials.filter(f => f.Status === 'Paid');
  const paidThisMonth = allPaid.filter(f => String(f.Paid_Date).startsWith(thisMonth));
  const displayPaid = S.moneyFilter === 'month' ? paidThisMonth : allPaid;
  const total = displayPaid.reduce((s, f) => s + parseMoney(f.Amount), 0);
  const label = S.moneyFilter === 'month' ? 'This Month' : 'All Time';
  if ($('m-money-t')) $('m-money-t').textContent = '✅ Collected (' + label + ') — $' + total.toFixed(2);
  const body = $('m-money-body');
  if (!body) return;
  if (!displayPaid.length) {
    body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--txt3);font-size:13px;">No payments recorded' + (S.moneyFilter === 'month' ? ' this month.' : ' yet.') + '</div>';
  } else {
    const sorted = [...displayPaid].sort((a, b) => (b.Paid_Date || '').localeCompare(a.Paid_Date || ''));
    body.innerHTML = sorted.map(f => {
      const j = getJob(f.Job_ID);
      if (!j.Job_ID) return ''; // job was deleted/pending — skip orphaned financial record
      const c = getCli(f.Client_ID || j.Client_ID);
      const cid = c.Client_ID || f.Client_ID || j.Client_ID;
      const isComp = j.Job_Status === 'Completed';
      const wasPrepay = !isComp && (j.Payment_Status === 'Paid' || j.Payment_Status === 'Partial');
      const isPartialPre = j.Payment_Status === 'Partial';

      // Status line
      let statusLine = '';
      if (isComp && j.Completion_Date) {
        statusLine = '✅ Completed ' + fmtD(j.Completion_Date);
      } else if (j.Scheduling_Type === 'ASAP' && !j.Scheduled_Date) {
        statusLine = '⚡ ASAP — to be scheduled';
      } else if (j.Scheduled_Date) {
        statusLine = '📅 Scheduled ' + fmtD(j.Scheduled_Date);
      } else {
        statusLine = '📋 ' + (j.Job_Status || 'Booked');
      }

      // Prepaid pill
      const ppPill = wasPrepay ? `<span class="pill p-pur" style="font-size:9px;">💜 Pre-Paid</span>`
        : isPartialPre ? `<span class="pill p-pur" style="font-size:9px;">💜 Deposit</span>`
        : '';

      return `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--green-s);border-radius:var(--rsm);border:1px solid var(--green-b);margin-bottom:8px;cursor:pointer;" onclick="closeMo('m-money');openProfile('${esc(cid)}')">
        <div class="ji" style="background:rgba(255,255,255,.6);">${wasPrepay || isPartialPre ? '💜' : '✅'}</div>
        <div style="flex:1;min-width:0;pointer-events:none;">
          <div style="font-family:'Nunito',sans-serif;font-size:14px;font-weight:800;color:var(--txt);">${esc(fullN(c))}</div>
          <div style="font-size:12px;color:var(--txt2);margin-top:2px;">${esc(j.Service || '—')}</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:2px;">💰 Paid ${fmtD(f.Paid_Date)} · ${esc(f.Payment_Method || '—')}</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:1px;">${statusLine}</div>
          ${ppPill ? `<div style="margin-top:4px;">${ppPill}</div>` : ''}
        </div>
        <div style="flex-shrink:0;text-align:right;pointer-events:none;">
          <div style="font-family:'Nunito',sans-serif;font-size:15px;font-weight:900;color:var(--green);">$${parseMoney(f.Amount).toFixed(2)}</div>
        </div>
      </div>`;
    }).join('');
  }
  showMo('m-money');
}
function renderEarnBars() {
  const el=$('earn-bars');if(!el)return;
  const weeks=[];const now=new Date();
  const dayOfWeek=now.getDay()||7;
  const thisMon=new Date(now);thisMon.setDate(now.getDate()-(dayOfWeek-1));thisMon.setHours(0,0,0,0);
  for(let w=3;w>=0;w--){
    const wMon=new Date(thisMon);wMon.setDate(thisMon.getDate()-w*7);
    const wSun=new Date(wMon);wSun.setDate(wMon.getDate()+6);
    const wMonS=wMon.toISOString().split('T')[0];const wSunS=wSun.toISOString().split('T')[0];
    const total=S.financials.filter(f=>f.Status==='Paid'&&f.Paid_Date>=wMonS&&f.Paid_Date<=wSunS)
      .reduce((s,f)=>s+parseMoney(f.Amount),0);
    const lbl=w===0?'This Wk':w===1?'Last Wk':(wMon.toLocaleDateString('en-CA',{month:'short',day:'numeric'}));
    weeks.push({total,lbl,cur:w===0});
  }
  const maxVal=Math.max(...weeks.map(w=>w.total),1);
  el.innerHTML=weeks.map(w=>{
    const pct=Math.round((w.total/maxVal)*100);const h=Math.max(pct*0.44,3);
    return`<div class="earn-bar-wrap">
      <div style="font-size:10px;color:var(--txt2);font-weight:700;margin-bottom:2px;">${w.total>0?'$'+Math.round(w.total):''}</div>
      <div class="earn-bar${w.cur?' cur':''}" style="height:${h}px;"></div>
      <div class="earn-lbl">${esc(w.lbl)}</div>
    </div>`;
  }).join('');
}

// ============================================================================
// 8. CLIENT & PROFILE LOGIC
// ============================================================================

function renderCli(q='') {
  const l=$('cli-list');
  let cs=[...S.clients].sort((a,b)=>(a.Last_Name||'').localeCompare(b.Last_Name||''));
  if(q){const lq=q.toLowerCase();cs=cs.filter(c=>fullN(c).toLowerCase().includes(lq)||(c.Phone||'').includes(lq)||(c.Email||'').toLowerCase().includes(lq)||(c.City||'').toLowerCase().includes(lq));}
  if(!cs.length){l.innerHTML='<div class="es"><div class="es-i">👥</div><div class="es-t">No clients found</div><div class="es-s">Tap + to add</div></div>';return;}
  l.innerHTML=cs.map(c=>{
    const cj=S.jobs.filter(j=>j.Client_ID===c.Client_ID);
    const pc=cj.filter(j=>j.Job_Status==='Completed'&&!isPaidJob(j)).length;
    const nxt=cj.filter(j=>j.Job_Status==='Scheduled'&&(j.Scheduled_Date)>='').sort((a,b)=>(a.Scheduled_Date||'').localeCompare(b.Scheduled_Date||''))[0];
    const pill=pc>0?`<span class="pill p-red">${pc} Unpaid</span>`:c.Status==='Lead'?'<span class="pill p-amb">Lead</span>':c.Status==='Inactive'?'<span class="pill p-grey">Inactive</span>':'<span class="pill p-green">Active</span>';
    return`<div class="cr" data-action="open-profile" data-cid="${esc(c.Client_ID)}">
      <div class="av">${esc(inits(c))}</div>
      <div class="ci"><div class="cn">${esc(fullN(c))}</div>
        <div class="cs">${esc(formatPhone(c.Phone)||c.Email||'No contact')}${nxt?' · Next: '+fmtD(nxt.Scheduled_Date||nxt.Date):''}</div>
      </div>${pill}<span style="color:var(--txt3);font-size:22px;flex-shrink:0;">›</span>
    </div>`;
  }).join('');
}
function filterClients(q) { renderCli(q); }

function openProfile(cid) {
  S.curCli=cid;
  const c=getCli(cid); const cj=S.jobs.filter(j=>j.Client_ID===cid);
  const ci=S.financials.filter(f=>f.Client_ID===cid);
  const totPaid=ci.filter(f=>f.Status==='Paid').reduce((s,f)=>s+parseMoney(f.Amount),0);
  const totOwed=cj.filter(j=>j.Job_Status==='Completed'&&!isPaidJob(j))
    .reduce((s,j)=>s+parseMoney(j.Total_Amount),0);
  
  if($('p-av')) $('p-av').textContent=inits(c); 
  if($('p-name')) $('p-name').textContent=fullN(c);
  
  if($('p-pills')) {
    $('p-pills').innerHTML=
      (c.Status==='Lead'?'<span class="pill p-amb">🟡 Lead</span>':c.Status==='Inactive'?'<span class="pill p-grey">Inactive</span>':'<span class="pill p-green">✅ Active</span>')+
      (c.Referral_Source?`<span class="pill p-grey">📣 ${esc(c.Referral_Source)}</span>`:'');
  }
  
  const addr=[c.Street,c.City,(c.Province||'ON'),c.Postal_Code].filter(Boolean).join(', ');
  const mapsUrl=addr?`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`:'';
  
  if($('p-info')) {
    $('p-info').innerHTML=
      (c.Phone?`<div class="ir"><span class="ii">📞</span><div><div class="il">Phone</div><div class="iv"><a href="tel:${esc(c.Phone)}" style="color:var(--blue);text-decoration:none;font-weight:700;">${esc(formatPhone(c.Phone))}</a></div></div></div>`:'')+
      (c.Phone2?`<div class="ir"><span class="ii">📱</span><div><div class="il">Alt Phone</div><div class="iv"><a href="tel:${esc(c.Phone2)}" style="color:var(--blue);text-decoration:none;font-weight:700;">${esc(formatPhone(c.Phone2))}</a></div></div></div>`:'')+
      (c.Email?`<div class="ir"><span class="ii">✉️</span><div><div class="il">Email</div><div class="iv"><a href="mailto:${esc(c.Email)}" style="color:var(--blue);text-decoration:none;font-weight:700;">${esc(c.Email)}</a></div></div></div>`:'')+
      (addr?`<div class="ir"><span class="ii">📍</span><div><div class="il">Address</div><div class="iv"><a href="${mapsUrl}" target="_blank" style="color:var(--blue);text-decoration:underline;font-weight:700;">${esc(addr)}</a></div></div></div>`:'')+
      `<div class="ir"><span class="ii">📝</span><div style="flex:1;min-width:0;"><div class="il">General Notes</div><div class="iv" style="${!c.Global_Notes?'color:var(--txt3);font-style:italic;':''}">${esc(c.Global_Notes)||'Nothing noted yet'}</div></div><button class="btn b-xs b-s" style="flex-shrink:0;margin-left:8px;" data-action="openEditNotes">✏️</button></div>`+
      `<div class="ir"><span class="ii">🔑</span><div style="flex:1;min-width:0;"><div class="il">Access Info</div><div class="iv" style="${!c.Access_Info?'color:var(--txt3);font-style:italic;':''}">${esc(c.Access_Info)||'Nothing noted yet'}</div></div><button class="btn b-xs b-s" style="flex-shrink:0;margin-left:8px;" data-action="openEditAccess">✏️</button></div>`+
      `<div class="ir"><span class="ii">👨‍👩‍👧</span><div style="flex:1;min-width:0;"><div class="il">Family & Pets</div><div class="iv" style="${!c.Family_Details?'color:var(--txt3);font-style:italic;':''}">${esc(c.Family_Details)||'Nothing noted yet'}</div></div><button class="btn b-xs b-s" style="flex-shrink:0;margin-left:8px;" data-action="openEditFamily">✏️</button></div>`+
      (c.Created_Date?`<div class="ir"><span class="ii">📅</span><div><div class="il">Client Since</div><div class="iv">${fmtDFull(c.Created_Date)}</div></div></div>`:'');
  }

  if($('p-jobs')) $('p-jobs').textContent=cj.length;
  if($('p-paid')) $('p-paid').textContent='$'+totPaid.toFixed(2);
  if($('p-owed')) $('p-owed').textContent='$'+totOwed.toFixed(2);
  
  S.profileJobFilter='all';
  renderProfileJobs(cj);
  navTo('profile',true);
}

function renderProfileJobs(cj) {
  const f=S.profileJobFilter||'all';['all','paid','owed'].forEach(k=>{
    const el=$('pf-'+k);if(!el)return;
    el.style.outline=f===k?'2px solid var(--pink)':'';
    el.style.transform=f===k?'scale(1.03)':'';
  });
  let jobs=cj||S.jobs.filter(j=>j.Client_ID===S.curCli);
  const sorted=jobs.sort((a,b)=>(b.Scheduled_Date||'').localeCompare(a.Scheduled_Date||''));
  let filtered=sorted;
  if(f==='paid') filtered=sorted.filter(j=>isPaidJob(j));
  else if(f==='owed') filtered=sorted.filter(j=>!isPaidJob(j)&&j.Job_Status==='Completed');
  
  if($('p-jobs-list')) {
    $('p-jobs-list').innerHTML=filtered.length?
      filtered.map(profJobRow).join(''):
      '<div style="text-align:center;padding:24px;color:var(--txt3);font-size:13px;">'+(f==='all'?'No jobs yet.':f==='paid'?'No paid jobs.':'No unpaid jobs.')+'</div>';
  }
}

function setProfFilter(f) { S.profileJobFilter=f; renderProfileJobs(); }

function profJobRow(j) {
  const isPaid = isPaidJob(j); const isSched = j.Job_Status === 'Scheduled';
  const tod = today(); const sd = j.Scheduled_Date;
  const isASAP = j.Scheduling_Type === 'ASAP' && !sd;
  const isOverdue = isSched && sd && sd < tod;
  // Prepaid: any non-completed job with payment recorded
  const notComplete  = j.Job_Status !== 'Completed';
  const isFullPre    = notComplete && j.Payment_Status === 'Paid';
  const isPartialPre = notComplete && j.Payment_Status === 'Partial';
  const isAnyPrepaid = isFullPre || isPartialPre;
  const prePaidAmt   = parseMoney(j.PrePaid_Amount);
  const totalJobAmt  = parseMoney(j.Total_Amount);
  const isDone = isArchived(j);
  const tc = isDone ? 'paid' : isOverdue ? 'overdue' : isSched ? 'sched' : isPaid ? 'paid' : j.Job_Status === 'Completed' ? 'owed' : 'sched';
  
  const hRaw    = j.Job_Status === 'Completed' ? (j.Actual_Duration || j.Estimated_Hours) : j.Estimated_Hours;
  const hDisplay = hRaw ? (j.Job_Status === 'Completed' ? hRaw + ' hrs' : 'est. ' + hRaw + ' hrs') : '';

  // Pill logic — prepaid takes priority over booking/ASAP status
  const sp = isAnyPrepaid ? (isFullPre ? `<span class="pill p-pur">💜 Pre-Paid</span>` : `<span class="pill p-pur">💜 Deposit</span>`) :
    isPaid ? `<span class="pill p-green">✅ Paid in Full</span>` :
    isSched ? (isASAP ? `<span class="pill p-amb">⚡ ASAP</span>` : `<span class="pill p-blue">📅 Booked</span>`) :
    `<span class="pill p-red">⏳ Unpaid</span>`;
  
  const rev = j.Review_Status === 'Received' ? '<span class="pill p-green">⭐ Reviewed</span>' :
    j.Review_Status === 'Requested' ? '<span class="pill p-pur">⭐ Sent</span>' :
    j.Review_Status === 'Pending' ? '<span class="pill p-amb">⭐ Ask?</span>' : '';

  let acts = '';
  if (isSched && isASAP) {
    acts += `<button class="btn b-sm b-amb" data-action="schedule" data-jid="${esc(j.Job_ID)}">📅 Set Date</button>`;
  } else if (isSched) {
    acts += `<button class="btn b-sm b-bl" data-action="complete" data-jid="${esc(j.Job_ID)}">✅ Done</button>`;
  }
  if (!isPaid && j.Job_Status === 'Completed') acts += `<button class="btn b-sm b-bl" data-action="p-paid" data-jid="${esc(j.Job_ID)}">💰 Paid</button>`;
  if (isSched && !isAnyPrepaid) acts += `<button class="btn b-sm b-s" data-action="p-prepay" data-jid="${esc(j.Job_ID)}">💜 Pre-Pay</button>`;
  if (j.Job_Status === 'Completed') acts += `<button class="btn b-sm b-s" data-action="bookagain" data-jid="${esc(j.Job_ID)}">📋 Again</button>`;

  // Prepaid note line
  let ppNote = '';
  if (isFullPre) {
    ppNote = `<div class="jm note" style="color:var(--purple);font-style:normal;font-weight:800;">💜 Paid in full${prePaidAmt > 0 ? ' · $' + prePaidAmt.toFixed(2) : ''}${j.PrePaid_Reason ? ' · ' + esc(j.PrePaid_Reason) : ''}</div>`;
  } else if (isPartialPre && prePaidAmt > 0) {
    ppNote = `<div class="jm note" style="color:var(--purple);font-style:normal;font-weight:800;">💜 $${prePaidAmt.toFixed(2)} deposit · <span style="color:var(--red);">$${(totalJobAmt - prePaidAmt).toFixed(2)} owed at door</span></div>`;
  }

  return `<div class="jr ${tc}" data-action="open-job" data-jid="${esc(j.Job_ID)}">
    <div class="ji">${isPaid ? '✅' : isOverdue ? '🚨' : isSched ? '🔵' : '🚨'}</div>
    <div class="jd">
      <div class="jn">${esc(j.Service)}${isSched && !isOverdue && j.Time && !j.Time.includes('1899') && sd ? ` <span style="color:var(--pink);font-weight:800;">${fmtTRange(j)}</span>` : ''}</div>
      <div class="jm"><span style="color:var(--pink);font-weight:800;">${!sd ? '⚡ ASAP' : fmtD(sd)}</span> · ${esc(j.Service)}${(!j.Time || j.Time.includes('1899')) && hDisplay ? ' · ' + hDisplay : ''}</div>
      ${j.Completion_Date && !isSched ? `<div class="jm note">✅ Completed ${fmtD(j.Completion_Date)}</div>` : ''}
      ${!isSched && j.Completion_Notes ? `<div class="jm note">📋 ${esc(j.Completion_Notes).substring(0, 52)}${j.Completion_Notes.length > 52 ? '…' : ''}</div>` : ''}
      ${isSched && j.Job_Notes ? `<div class="jm note">📝 ${esc(j.Job_Notes).substring(0, 52)}${j.Job_Notes.length > 52 ? '…' : ''}</div>` : ''}
      ${isOverdue ? `<div class="jm note" style="color:var(--orange);font-style:normal;font-weight:800;">⚠️ Past due — tap to update</div>` : ''}
      ${ppNote}
    </div>
    <div class="jr-right">
      <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;white-space:nowrap;">${rev}${sp}<span class="ja">$${parseMoney(j.Total_Amount).toFixed(2)}</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">${acts}</div>
    </div>
  </div>`;
}

function jrHTML(j, type) {
  const c = getCli(j.Client_ID);
  const amt = parseMoney(j.Total_Amount);
  const sd = j.Scheduled_Date;
  const isASAP = j.Scheduling_Type === 'ASAP' && !sd;
  const dStr = isASAP ? '⚡ ASAP' : fmtD(sd);
  const icons = { 
    owed: '🚨', 
    sched: '🔵', 
    fu: '🔔', 
    review: '⭐', 
    overdue: '🚨', 
    unschd: '🗓️', 
    lead: '🟡' 
  };

  const hRaw2    = j.Job_Status === 'Completed' ? (j.Actual_Duration || j.Estimated_Hours) : j.Estimated_Hours;
  const hDisplay = hRaw2 ? (j.Job_Status === 'Completed' ? hRaw2 + ' hrs' : 'est. ' + hRaw2 + ' hrs') : '';

  // Prepaid detection — works for scheduled, ASAP, by-date, any non-completed job
  const notComplete  = j.Job_Status !== 'Completed';
  const isFullPre    = notComplete && j.Payment_Status === 'Paid';
  const isPartialPre = notComplete && j.Payment_Status === 'Partial';
  const isAnyPrepaid = isFullPre || isPartialPre;
  const prePaidAmt   = parseMoney(j.PrePaid_Amount);
  const totalJobAmt  = parseMoney(j.Total_Amount);

  let pillHtml = '';
  if (isAnyPrepaid) {
    pillHtml = isFullPre
      ? `<span class="pill p-pur">💜 Pre-Paid</span>`
      : `<span class="pill p-pur">💜 Deposit</span>`;
  } else if (type === 'sched') {
    pillHtml = isASAP ? `<span class="pill p-amb">⚡ ASAP</span>` : `<span class="pill p-blue">📅 Booked</span>`;
  } else if (type === 'owed') {
    pillHtml = `<span class="pill p-red">⏳ Unpaid</span>`;
  } else if (type === 'fu') {
    pillHtml = `<span class="pill p-pink">🔔 Follow-Up</span>`;
  } else if (type === 'review') {
    pillHtml = `<span class="pill p-amb">⭐ Ask Review</span>`;
  } else if (type === 'overdue') {
    pillHtml = `<span class="pill p-ora">⚠️ Past Due</span>`;
  } else if (type === 'unschd') {
    pillHtml = `<span class="pill p-amb">${isASAP ? '⚡ ASAP' : esc(j.Scheduling_Type || 'TBD')}</span>`;
  }

  let btnHtml = '';
  if (type === 'sched' || type === 'overdue') {
    if (isASAP) {
      btnHtml = `<button class="btn b-sm b-amb" data-action="schedule" data-jid="${esc(j.Job_ID)}">📅 Set Date</button>`;
    } else {
      btnHtml = `<button class="btn b-sm b-bl" data-action="complete" data-jid="${esc(j.Job_ID)}">✅ Done</button>`;
    }
  } else if (type === 'owed') {
    btnHtml = `<button class="btn b-sm b-g" data-action="paid" data-jid="${esc(j.Job_ID)}">💰 Paid</button>`;
  } else if (type === 'fu') {
    btnHtml = `<button class="btn b-sm b-s" data-action="clearfu" data-jid="${esc(j.Job_ID)}">✓ Clear</button>`;
  } else if (type === 'review') {
    btnHtml = `<button class="btn b-sm b-pur" data-action="revreq" data-jid="${esc(j.Job_ID)}">⭐ Requested</button>`;
  } else if (type === 'unschd') {
    btnHtml = `<button class="btn b-sm b-amb" data-action="schedule" data-jid="${esc(j.Job_ID)}">📅 Set Date</button>`;
  }

  const cd = j.Completion_Date;
  const showCd = (type === 'owed' || type === 'overdue' || type === 'fu' || type === 'review') && cd;
  const noteText = j.Job_Status !== 'Completed' && j.Job_Notes ? j.Job_Notes
                 : j.Job_Status === 'Completed' && j.Completion_Notes ? j.Completion_Notes
                 : '';

  // Prepaid note line — shows for any non-completed prepaid job (no dollar amounts on home page)
  let ppNote = '';
  if (isFullPre) {
    ppNote = `<div class="jm note" style="color:var(--purple);font-style:normal;font-weight:800;">💜 Paid in full${j.PrePaid_Reason ? ' · ' + esc(j.PrePaid_Reason) : ''}</div>`;
  } else if (isPartialPre && prePaidAmt > 0) {
    ppNote = `<div class="jm note" style="color:var(--purple);font-style:normal;font-weight:800;">💜 Deposit paid · <span style="color:var(--red);">balance due at door</span></div>`;
  }

  const hasTime = j.Time && !j.Time.includes('1899');
  const schedTime = (hasTime && (sd || isASAP)) ? fmtTRange(j) : hDisplay;
  const unpaidBadge = type === 'owed' ? `<span class="pill p-red">● UNPAID</span>` : '';

  return `<div class="jr ${type}" data-action="open-job" data-jid="${esc(j.Job_ID)}">
    <div class="ji">${icons[type] || '📋'}</div>
    <div class="jd">
      <div class="jn">${esc(fullN(c))}${j.Service ? `<span class="jn-svc"> · ${esc(j.Service)}</span>` : ''}</div>
      <div class="jm-sched"><span class="jms-date">${dStr}</span>${schedTime ? `<span class="jms-sep">·</span><span class="jms-time">${schedTime}</span>` : ''}</div>
      ${showCd ? `<div class="jm note">✅ Completed ${fmtD(cd)}</div>` : ''}
      ${noteText ? `<div class="jm note">📝 ${esc(noteText).substring(0, 48)}${noteText.length > 48 ? '…' : ''}</div>` : ''}
      ${type === 'overdue' ? `<div class="jm note" style="color:var(--orange);font-style:normal;font-weight:800;">Was ${fmtD(sd)} — tap to update</div>` : ''}
      ${ppNote}
    </div>
    <div class="jr-right">
      <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;white-space:nowrap;">${pillHtml}${unpaidBadge}</div>
      ${btnHtml}
    </div>
  </div>`;
}


// ============================================================================
// 9. ADD / EDIT CLIENT LOGIC
// ============================================================================

function startAddClient() {
  S.editCli=null;S.cliStatus='Lead';['ac-first','ac-last','ac-phone','ac-phone2','ac-email','ac-street','ac-city','ac-postal','ac-notes','ac-family','ac-access'].forEach(i=>$(i).value='');
  setCS('Lead');popLists();if($('ac-savebook'))$('ac-savebook').style.display='';navTo('add-client',true);
  requestAnimationFrame(()=>{const s=$('scroll');if(s)s.scrollTop=0;});
}

function editClient() {
  const c=getCli(S.curCli);if(!c.Client_ID)return;
  S.editCli=c.Client_ID;S.cliStatus=c.Status||'Lead';popLists();
  if($('ac-first')) $('ac-first').value=c.First_Name||'';
  if($('ac-last')) $('ac-last').value=c.Last_Name||'';
  if($('ac-phone')) $('ac-phone').value=c.Phone||'';
  if($('ac-phone2')) $('ac-phone2').value=c.Phone2||'';
  if($('ac-email')) $('ac-email').value=c.Email||'';
  if($('ac-street')) $('ac-street').value=c.Street||'';
  if($('ac-city')) $('ac-city').value=c.City||'';
  if($('ac-postal')) $('ac-postal').value=c.Postal_Code||'';
  if($('ac-notes')) $('ac-notes').value=c.Global_Notes||'';
  if($('ac-family')) $('ac-family').value=c.Family_Details||'';
  if($('ac-access')) $('ac-access').value=c.Access_Info||'';
  
  setCS(c.Status||'Lead');
  if($('ac-ref')) $('ac-ref').value=c.Referral_Source||'';
  if($('ac-savebook')) $('ac-savebook').style.display='none';
  navTo('add-client',true);
}

function setCS(v) {
  S.cliStatus=v;['Lead','Active','Inactive'].forEach(s=>{const el=$('s-'+s.toLowerCase());if(el)el.classList.toggle('on',s===v);});
}

async function submitClient(thenBook=false, btn=null) {
  if(_isSaving)return;
  _isSaving = true;

  const origText = btn ? btn.textContent : 'Save Client';

  if(btn) {
    btn.disabled = true;
    btn.classList.add('saving');
    btn.textContent = '⏳ Saving...';
  }

  const first=$('ac-first')?.value.trim()||'';
  const last=$('ac-last')?.value.trim()||'';
  const rawPhone=$('ac-phone')?.value.trim()||'';
  const rawPhone2=$('ac-phone2')?.value.trim()||'';
  const phone=normalizePhone(rawPhone);
  const phone2=normalizePhone(rawPhone2);
  const email=$('ac-email')?.value.trim()||'';

  if(!first){
    showToast('⚠️ First name is required');
    _isSaving=false;
    if(btn){btn.disabled=false;btn.classList.remove('saving');btn.textContent=origText;}
    return;
  }
  if(phone===null||(rawPhone2&&phone2===null)){
    showToast("⚠️ Phone number doesn't look valid");
    _isSaving=false;
    if(btn){btn.disabled=false;btn.classList.remove('saving');btn.textContent=origText;}
    return;
  }
  if(!phone&&!email){
    showToast('⚠️ Phone or email required');
    _isSaving=false;
    if(btn){btn.disabled=false;btn.classList.remove('saving');btn.textContent=origText;}
    return;
  }

  const data={First_Name:first,Last_Name:last,Phone:phone||'',Phone2:phone2||'',
    Email:email,Street:$('ac-street')?.value.trim()||'',
    City:$('ac-city')?.value.trim()||'Georgetown',Province:'ON',
    Postal_Code:$('ac-postal')?.value.trim().toUpperCase()||'',Status:S.cliStatus,
    Referral_Source:$('ac-ref')?.value||'',Family_Details:$('ac-family')?.value.trim()||'',
    Access_Info:$('ac-access')?.value.trim()||'',Global_Notes:$('ac-notes')?.value.trim()||''};

  if(S.editCli){
    const c=S.clients.find(x=>x.Client_ID===S.editCli);if(c)Object.assign(c,data);
    if(!S.isDemo)await gasCall({action:'updateClient',clientId:S.editCli,...data});
    cacheInvalidate();
    showToast('✓ Client updated');
    goBack();
    if(S.curCli) openProfile(S.curCli);
  }else{
    // Duplicate check: phone, email, or exact full name — last name alone is too broad
    const dup=S.clients.find(c=>{
      if(phone&&c.Phone&&String(c.Phone).replace(/\D/g,'')===phone)return true;
      if(email&&c.Email&&c.Email.toLowerCase()===email.toLowerCase())return true;
      const sameFirst=first&&c.First_Name&&c.First_Name.toLowerCase()===first.toLowerCase();
      const sameLast=last&&c.Last_Name&&c.Last_Name.toLowerCase()===last.toLowerCase();
      if(sameFirst&&sameLast)return true;
      return false;
    });
    if(dup){
      _isSaving=false;if(btn){btn.disabled=false;btn.classList.remove('saving');btn.textContent=origText;}
      showDupWarning(dup,data);return;
    }
    data.Client_ID='C'+shortId();data.Created_Date=today();S.clients.push(data);
    cacheWrite();
    if(!S.isDemo) await persistNewClient(data);
    S.curCli=data.Client_ID;showToast('✓ '+first+' '+last+' added!');
    if(thenBook){openBookJobForClient();}
    else{navTo('clients');renderCli();}
  }
  _isSaving=false;
  if(btn){btn.disabled=false;btn.classList.remove('saving');btn.textContent=origText;}
}

function showDupWarning(existing, newData) {
  const mdb = $('m-del-body');
  if(mdb) {
    mdb.innerHTML=`
      <div style="font-size:14px;color:var(--txt2);margin-bottom:16px;line-height:1.6;">
        <strong style="color:var(--txt);">Possible duplicate detected</strong><br>
        <strong>${esc(fullN(existing))}</strong> already exists with similar information
        ${existing.Phone?'<br>📞 '+esc(formatPhone(existing.Phone)):''}
        ${existing.Email?'<br>✉️ '+esc(existing.Email):''}
        ${existing.Street?'<br>📍 '+esc(existing.Street):''}
      </div>
      <button class="btn b-p mb8" onclick="closeMo('m-del');openProfile('${esc(existing.Client_ID)}');">
        👤 View existing client
      </button>
      <button class="btn b-s mb8" onclick="closeMo('m-del');forceAddClient(${JSON.stringify(newData).replace(/"/g,'"')});">
        ➕ Create as new client anyway
      </button>
      <button class="btn b-s" onclick="closeMo('m-del')">Cancel</button>`;
    showMo('m-del');
  }
}

// Shared GAS sync for any new-client add — updates canonical ID in-place, queues on failure
async function persistNewClient(data) {
  try {
    const r=await gasCall({action:'addClient',...data});
    if(r&&r.Client_ID){
      const idx=S.clients.findIndex(x=>x.Client_ID===data.Client_ID);
      if(idx!==-1)S.clients[idx].Client_ID=r.Client_ID;
      data.Client_ID=r.Client_ID;
    }
    if(!r||!r.success){
      if(!r?.offline) queueRequest({action:'addClient',...data});
    } else {
      cacheInvalidate();
    }
  } catch(e) {
    queueRequest({action:'addClient',...data});
    showToast('⚠️ Offline — client queued, will sync on next open');
  }
}

async function forceAddClient(data) {
  data.Client_ID='C'+shortId();data.Created_Date=today();S.clients.push(data);
  cacheWrite();
  if(!S.isDemo) await persistNewClient(data);
  S.curCli=data.Client_ID;showToast('✓ '+data.First_Name+' '+data.Last_Name+' added!');
  navTo('clients');renderCli();
}

function confirmDeleteClient() {
  const c = getCli(S.curCli);
  if (!c.Client_ID) return;
  
  const mdb = $('m-del-body');
  if(mdb) {
    mdb.innerHTML = `
      <div style="font-size:14px;color:var(--txt2);margin-bottom:16px;line-height:1.5;">
        Delete <strong>${esc(fullN(c))}</strong> and all their job history? 
        <br><br>
        <span style="color:var(--red); font-weight:800;">This cannot be undone.</span>
      </div>
      <button class="btn b-r mb8" onclick="deleteClient()">🗑️ Yes, Delete Client</button>
      <button class="btn b-s" onclick="closeMo('m-del')">Cancel</button>`;
    showMo('m-del');
  }
}

async function deleteClient() {
  const cid = S.curCli;
  if (!cid) return;
  closeMo('m-del');
  _pendingDeletes.clients.add(cid);
  savePendingDeletes();

  const clientJobs = S.jobs.filter(j => j.Client_ID === cid);
  clientJobs.forEach(j => _pendingDeletes.jobs.add(j.Job_ID));
  savePendingDeletes();

  S.clients = S.clients.filter(c => c.Client_ID !== cid);
  S.jobs = S.jobs.filter(j => j.Client_ID !== cid);
  S.financials = S.financials.filter(f => f.Client_ID !== cid);

  navTo('clients');
  renderCli();

  if (!S.isDemo) {
    await gasCall({ action: 'deleteClient', clientId: cid });
    cacheInvalidate();
  }
  showToast('🗑️ Client deleted');
}


// ============================================================================
// 10. JOB & BOOKING LOGIC
// ============================================================================

function navBookJob() {
  S.stack=[]; popCliDrop(); popLists(); navTo('book-job');
  requestAnimationFrame(() => resetBookForm());
}

function resetBookForm() {
  ['bj-cli','bj-svc','bj-date','bj-time','bj-notes','bj-flat','bj-sur','bj-hrs'].forEach(id=>{const el=$(id);if(el)el.value='';});
  if($('bj-nb'))$('bj-nb').classList.add('hidden');
  setSched('hard'); setPrice('Hourly'); updHourlyBtnText(); calc();
  requestAnimationFrame(()=>{const s=$('scroll');if(s)s.scrollTop=0;});
}

function openBookJobForClient() {
  popCliDrop(); popLists(); navTo('book-job',true);
  requestAnimationFrame(()=>{resetBookForm();if(S.curCli){const bjc=$('bj-cli');if(bjc)bjc.value=S.curCli;onCliSelect();}});
}

function openBookJobForLead(cid) {
  S.curCli=cid; openBookJobForClient();
}

function popCliDrop() {
  const sel=$('bj-cli');if(!sel)return;
  const prev=sel.value;
  sel.innerHTML='<option value="">— Select client —</option>';
  [...S.clients].sort((a,b)=>fullN(a).localeCompare(fullN(b))).forEach(c=>{
    const o=document.createElement('option');o.value=c.Client_ID;o.textContent=fullN(c);
    sel.appendChild(o);
  });
  sel.value=prev;
}

function popLists() {
  const ref=$('ac-ref');
  if(ref){ref.innerHTML='';gl('referral_sources').forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;ref.appendChild(o);});}
  const svc=$('bj-svc');
  if(svc){svc.innerHTML='';gl('services').forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;svc.appendChild(o);});}
}

function onCliSelect() {
  const cid=$('bj-cli')?.value;const nb=$('bj-nb');
  if(!cid||!nb){if(nb)nb.classList.add('hidden');return;}
  const c=getCli(cid);const parts=[];
  if(c.Access_Info)parts.push('🔑 '+esc(c.Access_Info));
  if(c.Global_Notes)parts.push('📝 '+esc(c.Global_Notes));
  if(c.Family_Details)parts.push('👨‍👩‍👧 '+esc(c.Family_Details));
  if(parts.length){nb.innerHTML='<strong style="color:var(--amber);">Client Notes:</strong><br>'+parts.join('<br>');nb.classList.remove('hidden');}
  else nb.classList.add('hidden');
}

function onSvcChange() {
  const svc=$('bj-svc')?.value;const hint=$('svc-price-hint');
  if(!svc||!hint)return;
  updHourlyBtnText();
  const prices=S.biz.service_prices||{};
  if(prices[svc]!==undefined){
    const p=prices[svc];
    hint.textContent=`💡 Custom rate: $${p}/hr`;hint.style.display='';
    setPrice('Hourly');
  }else{hint.style.display='none';}
}

function updHourlyBtnText() {
  const svc = $('bj-svc')?.value;
  const rate = (S.biz.service_prices || {})[svc || ''] || S.biz.rate || 50;
  const pb = $('pr-h');
  if (pb) pb.textContent = `⏱ Hourly ($${rate}/hr)`;
}

function setSched(t) {
  S.schedType=t;
  [['hard','sc-h'],['asap','sc-a'],['by','sc-b']].forEach(([x,id])=>{$(id)?.classList.toggle('on',x===t);});
  const dg=$('bj-date-g');const tg=$('bj-time-g');const hint=$('sc-hint');const dl=$('bj-dl');
  if(t==='asap'){if(dg)dg.style.display='none';if(tg)tg.style.display='none';}
  else{if(dg)dg.style.display='';if(tg)tg.style.display='';}
  if(hint){hint.textContent=t==='hard'?'Client confirmed this specific date.':t==='asap'?'No date yet — schedule when ready.':'Complete by this date — flexible timing.';}
  if(dl){dl.textContent=t==='by'?'Complete By Date *':'Scheduled Date *';}
}

function setPrice(t) {
  S.priceType=t;$('pr-h')?.classList.toggle('on',t==='Hourly');$('pr-f')?.classList.toggle('on',t==='Flat');
  if($('bj-hrs-g'))$('bj-hrs-g').style.display=t==='Hourly'?'':'none';
  if($('bj-flat-g'))$('bj-flat-g').style.display=t==='Flat'?'':'none';
  const hint=$('svc-price-hint');if(hint)hint.style.display='none';
  calc();
}

function calc() {
  // Use a minimal job shell so getJobTotals can do the math
  const mockJ = {
    Pricing_Type: S.priceType,
    Hourly_Rate:  (S.biz.service_prices||{})[$('bj-svc')?.value||''] || S.biz.rate || 50,
    Flat_Rate:    $('bj-flat')?.value || '0',
    Surcharge:    $('bj-sur')?.value  || '0',
    Additional_Cost: '0',
    Estimated_Hours: $('bj-hrs')?.value || '0',
    Actual_Duration: '', PrePaid_Amount: '', Payment_Status: ''
  };
  const t = getJobTotals(mockJ);

  if($('c-base')) $('c-base').textContent = '$' + t.base.toFixed(2);
  if($('c-sur'))  $('c-sur').textContent  = '$' + t.sur.toFixed(2);

  const hstRow = $('c-hst')?.closest('.pr');
  if (hstRow) {
    if (t.tRate === 0) {
      hstRow.classList.add('hidden');
    } else {
      hstRow.classList.remove('hidden');
      $('c-hst').textContent = '$' + t.hst.toFixed(2);
      hstRow.querySelector('span').textContent = `HST (${Math.round(t.tRate * 100)}%)`;
    }
  }
  if($('c-tot')) $('c-tot').textContent = '$' + t.total.toFixed(2);
}

function calcBookTimeRange() {
  const el = $('bj-time-range');
  if (!el) return;
  const timeVal = $('bj-time')?.value;
  const hrs = parseFloat($('bj-hrs')?.value || 0);
  if (timeVal && hrs > 0) {
    try {
      const [h, m] = timeVal.split(':');
      const start = new Date(); start.setHours(parseInt(h), parseInt(m), 0, 0);
      const end = new Date(start.getTime() + hrs * 3600000);
      const fmt = d => { const hr=d.getHours(),mn=d.getMinutes(); return `${hr%12||12}${mn?':'+String(mn).padStart(2,'0'):''}${hr>=12?'pm':'am'}`; };
      el.textContent = fmt(start) + ' → ' + fmt(end);
      el.classList.remove('hidden');
    } catch(e) { el.classList.add('hidden'); }
  } else { el.classList.add('hidden'); }
}

function checkTimeConflict() {
  const dateVal=$('bj-date')?.value;const timeVal=$('bj-time')?.value;
  const box=$('bj-conflict');if(!box)return;
  if(!dateVal||!timeVal){box.classList.add('hidden');return;}
  const conflicts=S.jobs.filter(j=>{
    if(j.Job_Status==='Cancelled'||j.Job_Status==='Completed')return false;
    return(j.Scheduled_Date)===dateVal&&j.Time&&!j.Time.includes('1899');
  });
  if(!conflicts.length){box.classList.add('hidden');return;}
  const[sh,sm]=timeVal.split(':').map(Number);const selMins=sh*60+sm;
  const close=conflicts.filter(j=>{
    const[jh,jm]=j.Time.split(':').map(Number);return Math.abs(jh*60+jm-selMins)<120;
  });
  if(!close.length){box.classList.add('hidden');return;}
  const msgs=close.map(j=>`${esc(j.Service)} @ ${fmtT(j.Time)} (${esc(getCli(j.Client_ID).First_Name||'client')})`).join(', ');
  box.innerHTML=`⚠️ <strong>Heads up:</strong> You already have ${msgs} that day.`;
  box.classList.remove('hidden');
}

async function submitJob() {
  if(_isSaving)return; _isSaving = true;
  
  const btn = document.querySelector('#view-book-job .btn.b-p'); 
  const origText = '📅 Save Job';
  
  if(btn) { 
    btn.disabled = true; 
    btn.innerHTML = '<span>⏳ Saving...</span>';
    btn.style.opacity = '0.7';
  }

  const cid=$('bj-cli')?.value;
  if(!cid){
    showToast('⚠️ Select a client'); 
    _isSaving=false; 
    if(btn){btn.disabled=false;btn.innerHTML=origText;btn.style.opacity='1';} 
    return;
  }
  
  const svc=$('bj-svc')?.value||'';
  const schedType=S.schedType;
  let date=$('bj-date')?.value||'';const time=$('bj-time')?.value||'';
  if(schedType!=='asap'&&!date){
    showToast('⚠️ Enter a date'); 
    _isSaving=false; 
    if(btn){btn.disabled=false;btn.innerHTML=origText;btn.style.opacity='1';} 
    return;
  }
  
  if(schedType==='asap')date='';
  const notes=$('bj-notes')?.value.trim()||'';

  // Build a shell job so getJobTotals does the math consistently
  const mockBook = {
    Pricing_Type:    S.priceType,
    Hourly_Rate:     (S.biz.service_prices||{})[$('bj-svc')?.value||''] || S.biz.rate || 50,
    Flat_Rate:       $('bj-flat')?.value || '0',
    Estimated_Hours: $('bj-hrs')?.value  || '0',
    Surcharge:       $('bj-sur')?.value  || '0',
    Additional_Cost: '0', Actual_Duration: '', PrePaid_Amount: '', Payment_Status: ''
  };
  const bt = getJobTotals(mockBook);

  const data={Job_ID:'J'+shortId(),Client_ID:cid,Service:svc,Scheduled_Date:date,Completion_Date:'',Time:time,
    Pricing_Type:S.priceType,Estimated_Hours:S.priceType==='Hourly'?($('bj-hrs')?.value||'2'):'',
    Flat_Rate:S.priceType==='Flat'?($('bj-flat')?.value||''):'',Surcharge:String(bt.sur),
    Hourly_Rate:S.priceType==='Hourly'?((S.biz.service_prices||{})[$('bj-svc')?.value||'']||S.biz.rate||50):'',
    Subtotal:bt.sub.toFixed(2),HST_Rate:bt.tRate,HST_Amount:bt.hst.toFixed(2),Total_Amount:bt.total.toFixed(2),
    Job_Status:'Scheduled',Follow_Up:'No',
    Scheduling_Type:schedType==='hard'?'Hard Date':schedType==='asap'?'ASAP':'By Date',
    Job_Notes:notes,Completion_Notes:'',Actual_Duration:'',Additional_Cost:'',Additional_Cost_Notes:'',
    Review_Status:'',Review_Notes:'',Payment_Status:'',Payment_Method:'',
    Photo_Links:'',Created_Date:today(),PrePaid_Reason:''};
    
  S.jobs.push(data);
  const c=S.clients.find(x=>x.Client_ID===cid);if(c&&c.Status==='Lead')c.Status='Active';

  // Persist new job to cache immediately — survives a reload even if the GAS write hasn't landed yet
  cacheWrite();

  if(S.stack.includes('add-client')){S.stack=[];openProfile(cid);}
  else if(S.stack.includes('profile')){goBack();openProfile(cid);}
  else{goBack();renderDash();}

  _isSaving=false;
  if(btn){btn.disabled=false;btn.innerHTML=origText;btn.style.opacity='1';}

  if(!S.isDemo){
    try {
      const r = await gasCall({action:'addJob',...data});
      if(r&&r.Job_ID){
        const idx=S.jobs.findIndex(x=>x.Job_ID===data.Job_ID);
        if(idx!==-1)S.jobs[idx].Job_ID=r.Job_ID;
      }
      if(!r||!r.success){
        // r.offline=true means gasCall already queued it — don't double-queue.
        // Only queue explicitly when GAS returned a failure response (not a network drop).
        if(!r?.offline){
          // GAS returned failure (not a network drop). Guard against re-queuing if the
          // write may have partially landed — skip if another job with same client/service/date
          // already appears in S.jobs (excluding the one we just optimistically added).
          const alreadyExists = S.jobs.some(x =>
            x.Client_ID===data.Client_ID && x.Service===data.Service &&
            x.Scheduled_Date===data.Scheduled_Date && x.Job_ID!==data.Job_ID
          );
          if(!alreadyExists) queueRequest({action:'addJob',...data});
        }
        showToast('⚠️ Offline — job queued, will sync on next open');
      } else {
        cacheInvalidate(); // success — clear so next loadAllData pulls fresh GAS data
        showToast('📅 Job booked!');
      }
    } catch(e) {
      // gasCall shouldn't throw (it catches internally), but just in case
      queueRequest({action:'addJob',...data});
      showToast('⚠️ Offline — job queued, will sync on next open');
    }
  } else {
    showToast('📅 Job booked!');
  }
}

function openJobModal(jid) {
  S.jobModal=jid;const j=getJob(jid);if(!j.Job_ID)return;
  const isPaid=isPaidJob(j);const c=getCli(j.Client_ID);
  const isComp=j.Job_Status==='Completed';
  const isPrePaid=(j.Payment_Status==='Paid'||j.Payment_Status==='Partial')&&!isComp;
  const sd=j.Scheduled_Date;
  S.followUp=j.Follow_Up||'No';
  $('m-job-t').textContent=(isComp?'✅ Completed Job':'✏️ Edit Job')+' — '+esc(j.Service);
  const cliEl=$('m-job-cli');
  cliEl.textContent='👤 '+fullN(c)+' →';
  cliEl.onclick=()=>{closeMo('m-job');openProfile(j.Client_ID);};
  const mOpts=gl('payment_methods').map(m=>`<option value="${esc(m)}" ${j.Payment_Method===m?'selected':''}>${esc(m)}</option>`).join('');

  if(isComp){
    const addCost    = parseMoney(j.Additional_Cost);
    const surcharge  = parseMoney(j.Surcharge);
    const rate       = parseFloat(S.biz.rate) || 50;
    const tRate      = taxRate();

    // Use getJobTotals so summary always matches what was saved
    const t2 = getJobTotals(j);
    const labourLabel = j.Pricing_Type === 'Flat'
      ? `${esc(j.Service)} (flat rate)`
      : `${parseFloat(j.Actual_Duration||j.Estimated_Hours||0)} hrs × $${t2.rate.toFixed(0)}/hr`;

    const bdr = `border-top:1px solid var(--green-b);margin:8px 0 6px;`;
    const lrow = (lbl, sub, val, bold) =>
      `<div style="display:flex;justify-content:space-between;margin-bottom:4px;${bold?'font-weight:900;font-size:14px;':'font-size:13px;'}">
        <span style="color:var(--txt2);">${lbl}${sub?` <span style="color:var(--txt3);font-size:11px;">${sub}</span>`:''}
        </span><span style="color:var(--txt);font-weight:${bold?'900':'600'};">${val}</span>
      </div>`;

    $('m-job-body').innerHTML=`
      <div style="background:var(--green-s);border:1.5px solid var(--green-b);border-radius:var(--r);padding:14px;margin-bottom:16px;">
        <div style="font-family:'Nunito',sans-serif;font-size:16px;font-weight:900;color:var(--green);margin-bottom:4px;">✅ ${esc(j.Service)}</div>
        <div style="font-size:12px;color:var(--txt3);margin-bottom:12px;">
          ${fmtDFull(sd)}${j.Time&&!j.Time.includes('1899')?' @ '+fmtT(j.Time):''}
          ${j.Completion_Date?' · Completed '+fmtD(j.Completion_Date):''}
        </div>

        ${lrow(labourLabel, '', '$'+t2.base.toFixed(2))}
        ${t2.sur > 0 ? lrow('Travel', '', '$'+t2.sur.toFixed(2)) : ''}
        ${t2.addCost > 0 ? lrow(
            j.Additional_Cost_Notes ? esc(j.Additional_Cost_Notes) : 'Additional costs',
            '',
            '$'+t2.addCost.toFixed(2)
          ) : ''}

        <div style="${bdr}"></div>
        ${lrow('Subtotal', '', '$'+t2.sub.toFixed(2))}
        ${t2.tRate > 0 ? lrow('HST ('+Math.round(t2.tRate*100)+'%)', '', '$'+t2.hst.toFixed(2)) : ''}
        <div style="${bdr}"></div>
        ${lrow('Total', '', '$'+t2.total.toFixed(2), true)}

        ${j.Completion_Notes?`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--green-b);">
          <div style="color:var(--txt3);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Completion Notes</div>
          <div style="font-size:13px;color:var(--txt);line-height:1.5;">${esc(j.Completion_Notes)}</div>
        </div>`:''}
        ${j.Job_Notes?`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--green-b);">
          <div style="color:var(--txt3);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Pre-Job Notes</div>
          <div style="font-size:13px;color:var(--txt);line-height:1.5;">${esc(j.Job_Notes)}</div>
        </div>`:''}

        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--green-b);display:flex;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;">
            <div style="color:var(--txt3);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;">Payment</div>
            <div style="font-weight:700;font-size:13px;">${isPaid?'✅ Paid in Full · '+esc(j.Payment_Method||''):'⏳ Unpaid'}</div>
          </div>
          <div style="flex:1;">
            <div style="color:var(--txt3);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;">Review</div>
            <div style="font-weight:700;font-size:13px;">${j.Review_Status||'—'}</div>
          </div>
        </div>
      </div>
      ${!isPaid?`
        <div class="fg"><label class="fl">Payment Method</label>
          <select class="fs" id="je-pm">${mOpts}</select>
        </div>
        <button class="btn b-g mb8" onclick="submitQuickPaidFromSummary(this)">💰 Mark as Paid — $${t2.total.toFixed(2)}</button>
      `:''}
      <button class="btn b-s mb8" onclick="openJobModalEdit()">✏️ Edit This Job</button>
      <button class="btn b-r mb8" onclick="confirmDeleteJob()">🗑️ Delete Job</button>
      <button class="btn b-s" onclick="closeMo('m-job')">Close</button>`;
  } else {
    $('m-job-body').innerHTML=`
      <div class="fg"><label class="fl">Service</label>
        <select class="fs" id="je-svc">${gl('services').map(s=>`<option ${j.Service===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">Scheduled Date</label><input class="fi" id="je-date" type="date" value="${esc(sd||'')}"></div>
      <div class="fg"><label class="fl">Start Time</label><input class="fi" id="je-time" type="time" value="${esc(j.Time&&!j.Time.includes('1899')?j.Time:'09:00')}" oninput="jeCalc()"></div>
      <div id="je-time-range" class="hidden" style="text-align:center;font-family:'Nunito',sans-serif;font-weight:900;font-size:16px;color:var(--pink);margin:-8px 0 14px;"></div>
      <div class="fg"><label class="fl">Pricing Type</label>
        <div class="tr">
          <button class="tb ${j.Pricing_Type==='Hourly'?'on':''}" id="je-pr-h" onclick="jeSetPrice('Hourly')">⏱ Hourly</button>
          <button class="tb ${j.Pricing_Type==='Flat'?'on':''}" id="je-pr-f" onclick="jeSetPrice('Flat')">📋 Flat</button>
        </div></div>
      <div class="fg" id="je-hrs-g" style="display:${j.Pricing_Type!=='Flat'?'':'none'};"><label class="fl">Estimated Hours</label>
        <input class="fi" id="je-est-hrs" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Estimated_Hours||'')}" placeholder="e.g. 2.5" oninput="jeCalc()"></div>
      <div class="fg" id="je-rate-g" style="display:${j.Pricing_Type==='Flat'?'none':''};">
        <label class="fl">Hourly Rate ($)</label>
        <input class="fi" id="je-rate" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Hourly_Rate || S.biz.rate || 50)}" oninput="jeCalc()">
      </div>
      <div class="fg" id="je-flat-g" style="display:${j.Pricing_Type==='Flat'?'':'none'};"><label class="fl">Flat Rate (before tax)</label>
        <input class="fi" id="je-flat" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Flat_Rate||'')}" placeholder="e.g. 180.00" oninput="jeCalc()"></div>
      <div class="fg"><label class="fl">Surcharge ($)</label>
        <input class="fi" id="je-sur" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${parseMoney(j.Surcharge)>0?esc(j.Surcharge):''}" placeholder="e.g. 15.00" oninput="jeCalc()"></div>
      <div id="je-calc-preview" style="background:var(--blue-s);border:1.5px solid var(--blue-b);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--txt2);"></div>
      <div class="fg"><label class="fl">Job Notes (pre-job)</label><textarea class="ft" id="je-notes">${esc(j.Job_Notes||'')}</textarea></div>
      <div class="fg"><label class="fl">Follow-Up</label>
        <div class="tr"><button class="tb ${j.Follow_Up!=='Yes'?'on':''}" id="jfu-n" onclick="jFU('No')">No</button><button class="tb ${j.Follow_Up==='Yes'?'on':''}" id="jfu-y" onclick="jFU('Yes')">🔔 Yes</button></div></div>
      <div class="fg"><label class="fl">➕ Known Additional Costs ($)</label>
        <input class="fi" id="je-addcost" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${parseMoney(j.Additional_Cost)>0?esc(j.Additional_Cost):''}" placeholder="e.g. 25.00" oninput="jeCalc()"></div>
      <div class="fg"><label class="fl">Additional Cost Description</label>
        <input class="fi" id="je-addcost-notes" type="text" value="${esc(j.Additional_Cost_Notes||'')}" placeholder="e.g. Parking fee"></div>
      <div style="background:var(--bg);border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:13px;">
        <div style="color:var(--txt3);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Payment Status</div>
        ${isPrePaid?`<div style="color:var(--purple);font-weight:800;">💜 Pre-payment recorded · $${parseMoney(j.PrePaid_Amount||j.Total_Amount).toFixed(2)} via ${esc(j.Payment_Method||'—')}${j.PrePaid_Reason?' · '+esc(j.PrePaid_Reason):''}</div>${j.Payment_Status==='Partial'?'<div style="color:var(--txt3);font-size:12px;margin-top:4px;">Balance owing will update when you save with the new total above.</div>':''}`:`<div style="color:var(--txt2);">⏳ Unpaid — see total above</div>`}
      </div>
      <button class="btn b-p mb8" onclick="submitJobEdit(this, false)">💾 Save Changes</button>
      ${!isPrePaid?`<button class="btn b-s mb8" onclick="closeMo('m-job');openPaidModal('${esc(j.Job_ID)}')">💜 Record Pre-Payment</button>`:''}
      <button class="btn b-r mb8" onclick="confirmDeleteJob()">🗑️ Delete Job</button>
      <button class="btn b-s" onclick="closeMo('m-job')">Cancel</button>`;
  }
  showMo('m-job');requestAnimationFrame(()=>jeCalc());
}

function openJobModalEdit() {
  const jid=S.jobModal;const j=getJob(jid);if(!j.Job_ID)return;
  const isPaid=isPaidJob(j);const c=getCli(j.Client_ID);
  const sd=j.Scheduled_Date;
  const mOpts=gl('payment_methods').map(m=>`<option value="${esc(m)}" ${j.Payment_Method===m?'selected':''}>${esc(m)}</option>`).join('');
  $('m-job-t').textContent='✏️ Edit Completed Job — '+esc(fullN(c));
  $('m-job-body').innerHTML=`
    <div class="fg"><label class="fl">Service</label>
      <select class="fs" id="je-svc">${gl('services').map(s=>`<option ${j.Service===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="fg"><label class="fl">Scheduled Date</label><input class="fi" id="je-date" type="date" value="${esc(sd||'')}"></div>
    <div class="fg"><label class="fl">Start Time</label><input class="fi" id="je-time" type="time" value="${esc(j.Time&&!j.Time.includes('1899')?j.Time:'09:00')}"></div>
    <div class="fg"><label class="fl">Job Notes</label><textarea class="ft" id="je-notes">${esc(j.Job_Notes||'')}</textarea></div>
    <div class="fg"><label class="fl">Completion Notes</label><textarea class="ft" id="je-comp">${esc(j.Completion_Notes||'')}</textarea></div>
    <div class="fg" id="je-hrs-g" style="display:${j.Pricing_Type==='Flat'?'none':''};">
      <label class="fl">Actual Hours</label>
      <input class="fi" id="je-hrs" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Actual_Duration||'')}" oninput="jeCalc()">
    </div>
    <div class="fg" id="je-flat-g" style="display:${j.Pricing_Type==='Flat'?'':'none'};">
      <label class="fl">Flat Rate (before tax)</label>
      <input class="fi" id="je-flat" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Flat_Rate||'')}" placeholder="e.g. 180.00" oninput="jeCalc()">
    </div>
    <div class="fg" id="je-rate-g" style="display:${j.Pricing_Type==='Flat'?'none':''};">
      <label class="fl">Hourly Rate ($)</label>
      <input class="fi" id="je-rate" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Hourly_Rate || S.biz.rate || 50)}" oninput="jeCalc()">
    </div>
    <div class="fg"><label class="fl">Additional Costs ($)</label>
      <input class="fi" id="je-addcost" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Additional_Cost||'')}" placeholder="e.g. 25.00" oninput="jeCalc()"></div>
    <div id="je-calc-preview" class="hidden" style="background:var(--blue-s);border:1.5px solid var(--blue-b);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--txt2);"></div>
    <div class="fg"><label class="fl">Additional Cost Description</label>
      <input class="fi" id="je-addcost-notes" type="text" value="${esc(j.Additional_Cost_Notes||'')}" placeholder="e.g. Cleaning supplies" oninput="jeCalc()"></div>
    <div class="fg"><label class="fl">📸 Photo Link</label><input class="fi" id="je-photos" type="url" value="${esc(j.Photo_Links||'')}" placeholder="Google Photos link…"></div>
    <div class="fg"><label class="fl">Review Status</label>
      <select class="fs" id="je-rev">
        <option value="">—</option>
        <option value="Pending" ${j.Review_Status==='Pending'?'selected':''}>⭐ Pending</option>
        <option value="Requested" ${j.Review_Status==='Requested'?'selected':''}>📤 Requested</option>
        <option value="Received" ${j.Review_Status==='Received'?'selected':''}>✅ Received</option>
      </select></div>
    <div class="fg"><label class="fl">Follow-Up</label>
      <div class="tr"><button class="tb ${j.Follow_Up!=='Yes'?'on':''}" id="jfu-n" onclick="jFU('No')">No</button><button class="tb ${j.Follow_Up==='Yes'?'on':''}" id="jfu-y" onclick="jFU('Yes')">🔔 Yes</button></div></div>
    <div class="fg"><label class="fl">Payment Method</label><select class="fs" id="je-pm">${mOpts}</select></div>
    ${!isPaid?`<button class="btn b-g mb8" onclick="submitJobEdit(this, true)">💰 Save + Mark Paid</button>`:''}
    <button class="btn b-p mb8" onclick="submitJobEdit(this, false)">💾 Save Changes</button>
    <button class="btn b-r mb8" onclick="confirmDeleteJob()">🗑️ Delete Job</button>
    <button class="btn b-s" onclick="closeMo('m-job')">Cancel</button>`;
}

async function submitJobEdit(btn, markPaid = false) {
  if (_isSaving) return;
  _isSaving = true;
  const origText = btn ? btn.textContent : '💾 Save Changes';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const jid = S.jobModal;
    const j = S.jobs.find(x => x.Job_ID === jid);
    if (!j) throw new Error("Job not found");

    const getVal = (id) => {
      const el = $(id);
      if (!el || el.offsetParent === null) return undefined;
      return el.value;
    };

    const svc = $('je-svc')?.value || '';
    const date = $('je-date')?.value || '';
    const time = $('je-time')?.value || '';
    const notes = $('je-notes')?.value.trim() || '';
    const comp = $('je-comp')?.value.trim() || '';
    const actHrs = getVal('je-hrs');
    const estHrs = getVal('je-est-hrs');
    const flatRate = getVal('je-flat');
    const sur = getVal('je-sur');
    const addCost = getVal('je-addcost');
    const addCostNotes = $('je-addcost-notes')?.value.trim() || '';
    const method = $('je-pm')?.value || 'Cash';
    const isFlat  = $('je-pr-f')?.classList.contains('on');
    const pType   = isFlat ? 'Flat' : 'Hourly';
    const revStatus = $('je-rev')?.value ?? j.Review_Status ?? '';
    const rateOverride = getVal('je-rate');

    // Use getJobTotals so math is identical everywhere
    // For completed jobs je-hrs is actual hours; for scheduled jobs je-est-hrs is estimated
    const hrsForCalc = actHrs !== undefined ? actHrs
                     : (estHrs !== undefined ? estHrs : undefined);
    const t = getJobTotals(j, {
      pricingType: pType,
      flatRate:    flatRate,
      hrs:         hrsForCalc,
      rate:        rateOverride,
      surcharge:   sur,
      addCost:     addCost
    });
    const tot        = t.total;
    const currentSur = t.sur;
    const currentAdd = t.addCost;

    closeMo('m-job');

    Object.assign(j, {
      Service: svc, Scheduled_Date: date, Time: time, Job_Notes: notes,
      Completion_Notes: comp || j.Completion_Notes,
      Actual_Duration: actHrs !== undefined ? String(actHrs) : j.Actual_Duration,
      Estimated_Hours: estHrs !== undefined ? String(estHrs) : j.Estimated_Hours,
      Pricing_Type: pType, Flat_Rate: flatRate !== undefined ? String(flatRate) : j.Flat_Rate,
      Surcharge: String(currentSur), Additional_Cost: String(currentAdd),
      Additional_Cost_Notes: addCostNotes || j.Additional_Cost_Notes,
      Review_Status: revStatus,
      Hourly_Rate: rateOverride !== undefined ? String(rateOverride) : j.Hourly_Rate,
      Total_Amount: tot.toFixed(2)
    });

    // Update payment state locally so every display reflects the new amount immediately
    if (markPaid) {
      j.Payment_Status = 'Paid';
      j.Payment_Method = method;
      const tod = today();
      const inv = S.financials.find(f => f.Job_ID === jid);
      if (inv) {
        inv.Status = 'Paid'; inv.Payment_Method = method;
        inv.Paid_Date = tod; inv.Amount = tot.toFixed(2);
      } else {
        S.financials.push({ Invoice_ID: 'INV' + Date.now(), Job_ID: jid,
          Client_ID: j.Client_ID, Amount: tot.toFixed(2),
          Status: 'Paid', Payment_Method: method, Paid_Date: tod });
      }
    } else {
      // Even if not marking paid, keep existing financial record amount in sync
      const inv = S.financials.find(f => f.Job_ID === jid);
      if (inv && inv.Status !== 'Paid') inv.Amount = tot.toFixed(2);
    }

    if (!S.isDemo) {
      await gasCall({
        action: 'updateJobDetails',
        jobId: jid,
        totalAmount: tot.toFixed(2),
        svc, date, time, notes, comp, hrs: actHrs,
        estimatedHours: estHrs, flatRate: flatRate,
        surcharge: sur, additionalCost: addCost,
        additionalCostNotes: addCostNotes, revStatus, method, markPaid,
        followUp: S.followUp,
        pricingType: pType
      });
    }

    cacheInvalidate();
    if (S.view === 'dashboard') renderDash();
    else if (S.view === 'profile') openProfile(j.Client_ID);
    showToast(markPaid ? '💰 Paid — $' + tot.toFixed(2) + ' recorded' : '✓ Job updated');

  } catch (err) {
    console.error("Save Error:", err);
    showToast("⚠️ Error saving");
  } finally {
    _isSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

async function deleteJob() {
  const jid = S.jobModal;
  if (!jid) return;

  closeMo('m-del');
  closeMo('m-job');

  _pendingDeletes.jobs.add(jid);
  savePendingDeletes();

  S.jobs = S.jobs.filter(x => x.Job_ID !== jid);
  S.financials = S.financials.filter(x => x.Job_ID !== jid);

  if (S.view === 'dashboard') renderDash();
  else if (S.view === 'profile') renderProfileJobs();

  if (!S.isDemo) {
    await gasCall({ action: 'deleteJob', jobId: jid });
    cacheInvalidate();
  }
  showToast('🗑️ Job deleted');
}

function confirmDeleteJob() {
  const jid = S.jobModal;
  const j = getJob(jid);
  if (!j.Job_ID) return;

  const mdb = $('m-del-body');
  if(mdb) {
    mdb.innerHTML = `
      <div style="font-size:14px;color:var(--txt2);margin-bottom:16px;line-height:1.5;">
        Delete this <strong>${esc(j.Service)}</strong> job?
        <br><br>
        <span style="color:var(--red); font-weight:800;">This will remove the job and associated payment records.</span>
      </div>
      <button class="btn b-r mb8" onclick="deleteJob()">🗑️ Yes, Delete Job</button>
      <button class="btn b-s" onclick="closeMo('m-del')">Cancel</button>`;
    showMo('m-del');
  }
}

function bookAgain(jid) {
  const j=getJob(jid);if(!j.Job_ID)return;
  popCliDrop();popLists();
  const bjc=$('bj-cli');if(bjc)bjc.value=j.Client_ID||'';
  onCliSelect();
  const svcEl=$('bj-svc');if(svcEl)svcEl.value=j.Service||'';
  onSvcChange();
  if(j.Pricing_Type==='Flat'){setPrice('Flat');if($('bj-flat'))$('bj-flat').value=j.Flat_Rate||'';}
  else{setPrice('Hourly');if($('bj-hrs'))$('bj-hrs').value=j.Estimated_Hours||'';}
  if($('bj-sur'))$('bj-sur').value=parseMoney(j.Surcharge)>0?j.Surcharge:'';
  if($('bj-notes'))$('bj-notes').value=j.Job_Notes||'';
  calc();
  if($('bj-date'))$('bj-date').value='';
  setSched('hard');
  navTo('book-job',true);
  showToast('📋 Pre-filled from last job — pick a new date');
}

// Mark as Paid from the completed job summary view.
// Uses existing Total_Amount as-is — user must edit the job first if amounts need adjusting.
async function submitQuickPaidFromSummary(btn) {
  if (_isSaving) return;
  _isSaving = true;
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const jid   = S.jobModal;
    const method = $('je-pm')?.value || 'Cash';
    const j     = S.jobs.find(x => x.Job_ID === jid);
    if (!j) throw new Error('Job not found');

    const amt = parseMoney(j.Total_Amount);
    const tod = today();

    // Update local job state
    j.Payment_Status = 'Paid';
    j.Payment_Method = method;

    // Update or create financial record
    const inv = S.financials.find(f => f.Job_ID === jid);
    if (inv) {
      inv.Status = 'Paid'; inv.Payment_Method = method;
      inv.Paid_Date = tod; inv.Amount = amt.toFixed(2);
    } else {
      S.financials.push({ Invoice_ID: 'INV' + Date.now(), Job_ID: jid,
        Client_ID: j.Client_ID, Amount: amt.toFixed(2),
        Status: 'Paid', Payment_Method: method, Paid_Date: tod });
    }

    closeMo('m-job');
    if (!S.isDemo) await gasCall({ action: 'markInvoicePaid', jobId: jid, method, ppAmt: amt.toFixed(2) });
    cacheInvalidate();

    refreshData();
    showToast('💰 Paid — $' + amt.toFixed(2) + ' recorded');
  } catch (err) {
    console.error('Pay error:', err);
    showToast('⚠️ Error recording payment');
  } finally {
    _isSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

function jeSetPrice(t) {
  $('je-pr-h')?.classList.toggle('on',t==='Hourly');
  $('je-pr-f')?.classList.toggle('on',t==='Flat');
  if($('je-hrs-g'))$('je-hrs-g').style.display=t==='Flat'?'none':'';
  if($('je-flat-g'))$('je-flat-g').style.display=t==='Flat'?'':'none';
  jeCalc();
}

function jeCalc() {
  const preview = $('je-calc-preview');
  if (!preview) return;
  const trEl = $('je-time-range');
  if (trEl) {
    const timeVal = $('je-time')?.value;
    const hrs = parseFloat($('je-est-hrs')?.value || $('je-hrs')?.value || 0);
    if (timeVal && hrs > 0) {
      try {
        const [h, m] = timeVal.split(':');
        const start = new Date(); start.setHours(parseInt(h), parseInt(m), 0, 0);
        const end = new Date(start.getTime() + hrs * 3600000);
        const fmt = d => { const hr=d.getHours(),mn=d.getMinutes(); return `${hr%12||12}${mn?':'+String(mn).padStart(2,'0'):''}${hr>=12?'pm':'am'}`; };
        trEl.textContent = fmt(start) + ' → ' + fmt(end);
        trEl.classList.remove('hidden');
      } catch(e) { trEl.classList.add('hidden'); }
    } else { trEl.classList.add('hidden'); }
  }
  const isFlat = $('je-pr-f')?.classList.contains('on');
  const jid = S.jobModal;
  const j   = getJob(jid) || {};
  const t   = getJobTotals(j, {
    pricingType: isFlat ? 'Flat' : 'Hourly',
    flatRate:    $('je-flat')?.value,
    hrs:         $('je-est-hrs')?.value || $('je-hrs')?.value,
    rate:        $('je-rate')?.value,
    surcharge:   $('je-sur')?.value,
    addCost:     $('je-addcost')?.value
  });
  if (t.sub === 0) { preview.classList.add('hidden'); return; }
  preview.classList.remove('hidden');
  const addNotes = $('je-addcost-notes')?.value.trim() || '';
  let html = `<div style="display:flex;justify-content:space-between;margin-bottom:3px;">
    <span>${t.isFlat ? 'Flat rate' : 'Labour (' + ($('je-est-hrs')?.value || $('je-hrs')?.value || 0) + ' hrs × $' + t.rate + '/hr)'}</span>
    <span>$${t.base.toFixed(2)}</span></div>`;
  if (t.sur > 0)     html += `<div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span>Surcharge</span><span>$${t.sur.toFixed(2)}</span></div>`;
  if (t.addCost > 0) html += `<div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span>Additional costs${addNotes ? ' — ' + esc(addNotes) : ''}</span><span>$${t.addCost.toFixed(2)}</span></div>`;
  html += `<div style="border-top:1px solid var(--blue-b);margin:6px 0 4px;"></div>`;
  if (t.tRate > 0) html += `<div style="display:flex;justify-content:space-between;margin-bottom:3px;color:var(--txt3);"><span>HST (${Math.round(t.tRate*100)}%)</span><span>$${t.hst.toFixed(2)}</span></div>`;
  html += `<div style="display:flex;justify-content:space-between;font-family:'Nunito',sans-serif;font-weight:900;color:var(--txt);font-size:14px;"><span>New Total</span><span>$${t.total.toFixed(2)}</span></div>`;
  preview.innerHTML = html;
}

function jFU(v) { S.followUp=v; $('jfu-y')?.classList.toggle('on',v==='Yes'); $('jfu-n')?.classList.toggle('on',v==='No'); }


// ============================================================================
// 11. COMPLETION & PAYMENT LOGIC
// ============================================================================

function quickMarkPaid(jid) {
  S.jobModal=jid;
  const j=getJob(jid);const c=getCli(j.Client_ID);
  const mOpts=gl('payment_methods').map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  const qb = $('m-qpaid-body');
  if(qb) {
    qb.innerHTML=`
      <div style="text-align:center;padding:10px 0 20px;">
        <div style="font-family:'Nunito',sans-serif;font-size:36px;font-weight:900;color:var(--green);">$${parseMoney(j.Total_Amount).toFixed(2)}</div>
        <div style="font-size:14px;color:var(--txt2);margin-top:4px;">${esc(fullN(c))} · ${esc(j.Service)}</div>
      </div>
      <div class="fg"><label class="fl">Payment Method</label><select class="fs" id="qp-method">${mOpts}</select></div>
      <button class="btn b-g mb8" onclick="submitQuickPaid(this)">✅ Confirm Payment</button>
      <button class="btn b-s" onclick="closeMo('m-qpaid')">Cancel</button>`;
    showMo('m-qpaid');
  }
}

async function submitQuickPaid(btn) {
  if(_isSaving)return;_isSaving=true;
  if(btn){btn.disabled=true;btn.textContent='Saving...';}
  const jid=S.jobModal;const method=$('qp-method')?.value||'Cash';
  const j=S.jobs.find(x=>x.Job_ID===jid);if(!j){_isSaving=false;return;}
  j.Payment_Status='Paid';j.Payment_Method=method;
  const tod=today();
  const inv=S.financials.find(f=>f.Job_ID===jid);
  if(inv){inv.Status='Paid';inv.Payment_Method=method;inv.Paid_Date=tod;}
  else S.financials.push({Invoice_ID:'INV'+Date.now(),Job_ID:jid,Client_ID:j.Client_ID,Amount:j.Total_Amount,Status:'Paid',Payment_Method:method,Paid_Date:tod});
  closeMo('m-qpaid');
  if(!S.isDemo){
    try{
      await gasCall({action:'markInvoicePaid',jobId:jid,method,ppReason:''});
      cacheInvalidate();
    }catch(e){
      showToast('⚠️ Payment save failed — please retry');
      _isSaving=false;if(btn){btn.disabled=false;btn.textContent='✅ Confirm Payment';}
      return;
    }
  }
  refreshData();
  showToast('💰 Payment recorded — $'+parseMoney(j.Total_Amount).toFixed(2));
  _isSaving=false;
}

function openCompleteModal(jid) {
  const j=getJob(jid);
  if(!j.Job_ID)return;
  const sd=j.Scheduled_Date;
  if(j.Scheduling_Type==='ASAP'&&!sd){
    showToast('⚠️ Set a date before marking complete');
    return;
  }
  S.jobModal=jid;S.followUp='No';S.payNow=false;S.reqRev=false;
  const c=getCli(j.Client_ID);
  const tod=today();
  const isOverdue=j.Job_Status==='Scheduled'&&sd&&sd<tod;
  const isPrePaid=j.Payment_Status==='Paid'||j.Payment_Status==='Partial';
  S.payNow=false; 
  if($('m-comp-t')) $('m-comp-t').textContent=(isOverdue?'🟠 Update Overdue Job':'✅ Mark Completed')+' — '+esc(fullN(c));
  const mOpts=gl('payment_methods').map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  
  const mcb = $('m-comp-body');
  if(mcb) {
    mcb.innerHTML=`
      ${isOverdue?`<div class="info-box orange"><strong>⚠️ This job's date has passed.</strong><br>Enter actual hours and confirm payment below.</div>`:''}
      <div style="background:var(--bg);border-radius:12px;padding:14px;margin-bottom:16px;font-size:13px;color:var(--txt2);">
        <strong style="color:var(--txt);font-size:14px;">${esc(j.Service)}</strong> · ${!sd?'ASAP':fmtD(sd)}<br>
        ${j.Pricing_Type==='Hourly'?`<span>Quoted: <strong style="color:var(--pink);">$${parseMoney(j.Total_Amount).toFixed(2)}</strong> · ${esc(j.Estimated_Hours||'?')} hrs @ $${parseMoney(j.Flat_Rate||hourlyRate()).toFixed(0)}/hr${parseMoney(j.Surcharge)>0?' + $'+parseMoney(j.Surcharge).toFixed(2)+' surcharge':''}</span>`:`<span>Quoted: <strong style="color:var(--pink);">$${parseMoney(j.Total_Amount).toFixed(2)}</strong> (flat rate)</span>`}
        ${j.Job_Notes?`<br>📝 ${esc(j.Job_Notes)}`:''}
      </div>
      <div class="fg"><label class="fl">✏️ Actual Hours Worked</label>
        <input class="fi" id="cp-hrs" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Actual_Duration||j.Estimated_Hours||'')}" placeholder="How long did it take?" oninput="calcJobTotal()"></div>
      <div class="fg"><label class="fl">📋 Completion Notes</label>
        <textarea class="ft" id="cp-notes" placeholder="How did it go? Notes for next visit?">${esc(j.Completion_Notes||'')}</textarea></div>
      <div class="fg"><label class="fl">Surcharge ($)</label>
        <input class="fi" id="cp-sur" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${parseMoney(j.Surcharge)>0?esc(j.Surcharge):''}" placeholder="e.g. 15.00" oninput="calcJobTotal()"></div>
      <div class="fg"><label class="fl">➕ Additional Costs ($)</label>
        <input class="fi" id="cp-addcost" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Additional_Cost||'')}" placeholder="e.g. 25.00" oninput="calcJobTotal()"></div>
      <div class="fg"><label class="fl">Additional Cost Description</label>
        <input class="fi" id="cp-addcost-notes" type="text" value="${esc(j.Additional_Cost_Notes||'')}" placeholder="e.g. Cleaning supplies purchased"></div>
      <div id="cp-total-preview" style="background:var(--blue-s);border:1.5px solid var(--blue-b);border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13px;color:var(--txt2);">
        <div id="cp-preview-rows"></div>
      </div>
      <div class="fg"><label class="fl">📸 Photo Link (optional)</label>
        <input class="fi" id="cp-photos" type="url" value="${esc(j.Photo_Links||'')}" placeholder="Google Photos or Drive link…"></div>
      <div class="fg"><label class="fl">🔔 Follow-Up Needed?</label>
        <div class="tr"><button class="tb on" id="fu-n" onclick="setFU('No')">No follow-up</button><button class="tb" id="fu-y" onclick="setFU('Yes')">🔔 Yes, remind me</button></div></div>
      <div class="fg"><label class="fl">⭐ Request a Review?</label>
        <div class="tr"><button class="tb on" id="rev-n" onclick="setRev(false)">Skip for now</button><button class="tb" id="rev-y" onclick="setRev(true)">⭐ Yes — I'll ask them</button></div></div>
      <div id="cp-pay-section"></div>
      <button class="btn b-p mb8 mt8" id="cp-save-btn" onclick="submitComplete(this)">✅ Save Job</button>
      <button class="btn b-s" onclick="closeMo('m-comp')">Cancel</button>`;
    showMo('m-comp');requestAnimationFrame(()=>calcJobTotal());
  }
}

function calcJobTotal() {
  const jid = S.jobModal; const j = getJob(jid); if (!j.Job_ID) return;
  const rows = $('cp-preview-rows'); if (!rows) return;
  const mOpts = gl('payment_methods').map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');

  const addNotes = $('cp-addcost-notes')?.value.trim() || '';
  const t = getJobTotals(j, {
    hrs:       $('cp-hrs')?.value,
    surcharge: $('cp-sur')?.value,
    addCost:   $('cp-addcost')?.value
  });

  const isFullPrepay = j.Payment_Status === 'Paid';
  const isPartialPre = j.Payment_Status === 'Partial';
  const prePaidAmt   = parseMoney(j.PrePaid_Amount);
  const remaining    = isPartialPre ? Math.max(0, t.total - prePaidAmt) : t.total;

  let html = '';
  if (j.Pricing_Type === 'Hourly') {
    const hrsDisp = parseFloat($('cp-hrs')?.value) || parseFloat(j.Estimated_Hours || 0);
    html += row('Labour', hrsDisp + ' hrs × $' + t.rate.toFixed(0) + '/hr', '$' + t.base.toFixed(2));
  } else {
    html += row('Flat rate', '', '$' + t.base.toFixed(2));
  }
  if (t.sur > 0)     html += row('Surcharge', '', '$' + t.sur.toFixed(2));
  if (t.addCost > 0) html += row('Additional costs', addNotes ? esc(addNotes) : '', '$' + t.addCost.toFixed(2));

  html += `<div style="border-top:1px solid var(--blue-b);margin:8px 0 6px;"></div>`;
  html += row('Subtotal', '', '$' + t.sub.toFixed(2));
  if (t.tRate > 0) html += row('HST (' + Math.round(t.tRate * 100) + '%)', '', '$' + t.hst.toFixed(2), 'var(--txt3)');
  html += `<div style="display:flex;justify-content:space-between;font-family:'Nunito',sans-serif;font-weight:900;color:var(--txt);font-size:15px;margin-top:6px;padding-top:6px;border-top:1px solid var(--blue-b);"><span>Total</span><span>$${t.total.toFixed(2)}</span></div>`;

  if (isPartialPre) {
    html += `<div style="border-top:1px solid var(--blue-b);margin:8px 0 6px;"></div>`;
    html += `<div style="display:flex;justify-content:space-between;color:var(--purple);font-weight:700;margin-bottom:4px;"><span>💜 Pre-payment received</span><span>-$${prePaidAmt.toFixed(2)}</span></div>`;
    html += `<div style="display:flex;justify-content:space-between;font-family:'Nunito',sans-serif;font-weight:900;color:var(--red);font-size:15px;margin-top:2px;"><span>💸 Balance owing</span><span>$${remaining.toFixed(2)}</span></div>`;
  }
  rows.innerHTML = html;

  const ps = $('cp-pay-section'); if (!ps) return;
  if (isFullPrepay) {
    ps.innerHTML = `<div class="info-box purple" style="margin-bottom:14px;">💜 Fully pre-paid — payment already recorded.</div>`;
    S.payNow = true;
  } else {
    if (typeof S.payNow !== 'boolean') S.payNow = isPartialPre;
    ps.innerHTML = `
      <div class="fg"><label class="fl" style="font-weight:900;color:var(--txt);">${isPartialPre ? '💰 Collect Balance: <strong style="color:var(--red);">$' + remaining.toFixed(2) + '</strong>' : '💰 Payment'}</label>
        <div class="tr">
          <button class="tb ${S.payNow ? '' : 'on'}" id="pay-l" onclick="setPayNow(false)">⏳ ${isPartialPre ? 'Collect later' : 'Not paid yet'}</button>
          <button class="tb ${S.payNow ? 'on' : ''}" id="pay-n" onclick="setPayNow(true)">💵 ${isPartialPre ? 'Collect $' + remaining.toFixed(2) + ' now' : 'Paid now'}</button>
        </div>
      </div>
      <div id="cp-pm-g" class="fg" style="display:${S.payNow ? '' : 'none'};"><label class="fl">Payment Method</label><select class="fs" id="cp-pm">${mOpts}</select></div>
      ${S.payNow ? `<div style="background:var(--green-s);border:2px solid var(--green-b);border-radius:12px;padding:12px 14px;margin-bottom:4px;">
        <div style="font-family:'Nunito',sans-serif;font-weight:900;font-size:15px;color:var(--green);margin-bottom:4px;">✅ Confirming payment received</div>
        <div style="font-size:13px;color:var(--txt2);">${isPartialPre ? 'Balance' : 'Total'}: <strong style="color:var(--green);">$${remaining.toFixed(2)}</strong></div>
      </div>` : ''}`;
  }
  const btn = $('cp-save-btn');
  if (btn) {
    if (isFullPrepay) btn.textContent = '✅ Save Completed Job';
    else if (S.payNow) {
      const amt = isPartialPre ? remaining : t.total;
      btn.textContent = '✅ Save + Confirm $' + amt.toFixed(2) + ' Received';
      btn.style.background = 'var(--green)';
    } else {
      btn.textContent = '💾 Save Job — Collect Payment Later';
      btn.style.background = '';
    }
  }
}

function setFU(v) { S.followUp=v; $('fu-y')?.classList.toggle('on',v==='Yes'); $('fu-n')?.classList.toggle('on',v==='No'); }
function setRev(v) { S.reqRev=v; $('rev-y')?.classList.toggle('on',v); $('rev-n')?.classList.toggle('on',!v); }
function setPayNow(v) { S.payNow=v; calcJobTotal(); }

async function submitComplete(btn) {
  if(_isSaving)return;
  _isSaving=true;

  const origText = btn ? btn.textContent : '';
  if(btn && btn.tagName === 'BUTTON') { 
    btn.disabled = true; 
    btn.textContent = 'Saving...'; 
  }  
  if(btn) btn.classList.add('saving'); 

  const jid=S.jobModal;
  const j0=getJob(jid); 
  const hrs=$('cp-hrs')?.value||'';
  const notes=$('cp-notes')?.value.trim()||'';
  const photos=$('cp-photos')?.value.trim()||'';
  const method=$('cp-pm')?.value||$('cp-pm-g')?.querySelector('select')?.value||'Cash';
  const addCost=parseFloat($('cp-addcost')?.value)||0;
  const addCostNotes=$('cp-addcost-notes')?.value.trim()||'';

  const surchargeInput = $('cp-sur')?.value;
  const t = getJobTotals(j0, { hrs, surcharge: surchargeInput, addCost: String(addCost) });
  const newTotal   = t.total;
  const surcharge  = t.sur;
  const prePaidAmt = parseMoney(j0.PrePaid_Amount);
  const isFullPrepay = j0.Payment_Status === 'Paid';
  const isPartialPre = j0.Payment_Status === 'Partial';
  const remaining  = isPartialPre ? Math.max(0, newTotal - prePaidAmt) : newTotal;

  closeMo('m-comp');
  const j=S.jobs.find(x=>x.Job_ID===jid);
  if(j){
    j.Job_Status='Completed'; j.Completion_Date=today();
    j.Actual_Duration=hrs; j.Completion_Notes=notes; j.Photo_Links=photos; j.Follow_Up=S.followUp;
    if(S.reqRev) j.Review_Status='Pending';
    j.Total_Amount=newTotal.toFixed(2);
    if(surcharge > 0) j.Surcharge=String(surcharge);
    if(addCost > 0){ j.Additional_Cost=String(addCost); j.Additional_Cost_Notes=addCostNotes; }
    if(S.payNow||isFullPrepay){ j.Payment_Status='Paid'; if(method) j.Payment_Method=method; }
  }

  const tod=today();const inv=S.financials.find(f=>f.Job_ID===jid);

  if(isFullPrepay){
    if(inv){inv.Amount=newTotal.toFixed(2);}
  } else if(S.payNow&&isPartialPre){
    S.financials.push({Invoice_ID:'INV'+Date.now(),Job_ID:jid,Client_ID:j.Client_ID,Amount:remaining.toFixed(2),Status:'Paid',Payment_Method:method,Paid_Date:tod});
    if(inv){inv.Amount=j.PrePaid_Amount;}
  } else if(S.payNow){
    if(inv){inv.Status='Paid';inv.Payment_Method=method;inv.Paid_Date=tod;inv.Amount=newTotal.toFixed(2);}
    else S.financials.push({Invoice_ID:'INV'+Date.now(),Job_ID:jid,Client_ID:j.Client_ID,Amount:newTotal.toFixed(2),Status:'Paid',Payment_Method:method,Paid_Date:tod});
  } else {
    if(inv){inv.Amount=newTotal.toFixed(2);}
    else S.financials.push({Invoice_ID:'INV'+Date.now(),Job_ID:jid,Client_ID:j.Client_ID,Amount:newTotal.toFixed(2),Status:'Pending',Payment_Method:'',Paid_Date:''});
  }

  if(!S.isDemo) await gasCall({action:'markJobComplete',jobId:jid,followUp:S.followUp,notes,photos,
    actualHours:hrs,reqRev:S.reqRev,markPaid:S.payNow||isFullPrepay,method,
    surcharge:String(surcharge),additionalCost:addCost,additionalCostNotes:addCostNotes,
    totalAmount:newTotal.toFixed(2),reviewStatus:j?.Review_Status||'',paymentStatus:j?.Payment_Status||''});
  cacheInvalidate();
  const toast=isFullPrepay?'✅ Job complete — fully pre-paid':S.payNow?'✅ Done + $'+newTotal.toFixed(2)+' paid!':'✅ Job saved — payment pending';
  refreshData(); showToast(toast);
  _isSaving=false;
}

function openPaidModal(jid) {
  S.jobModal=jid;
  const j=getJob(jid);const c=getCli(j.Client_ID);
  const amt=parseMoney(j.Total_Amount);
  const notComp=j.Job_Status!=='Completed';
  const mOpts=gl('payment_methods').map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('');
  const ppOpts=gl('prepaid_reasons').map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('');
  const prb = $('m-payrec-body');
  if(prb) {
    prb.innerHTML=`
      <div style="text-align:center;padding:16px 0 20px;">
        <div style="font-size:44px;margin-bottom:8px;">💰</div>
        <div style="font-family:'Nunito',sans-serif;font-size:36px;font-weight:900;color:var(--green);">$${amt.toFixed(2)}</div>
        <div style="font-size:14px;color:var(--txt2);margin-top:4px;">${esc(fullN(c))} · ${esc(j.Service)}</div>
      </div>
      ${notComp?`<div class="info-box purple"><strong style="display:block;margin-bottom:6px;">⚠️ Job not yet completed — this records a pre-payment</strong>
        <div class="fg"><label class="fl">Reason for Pre-Payment</label><select class="fs" id="pp-reason">${ppOpts}</select></div>
        <div class="fg" style="margin-bottom:0;"><label class="fl">Amount Received ($)</label><input class="fi" id="pp-amt" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${amt.toFixed(2)}" placeholder="${amt.toFixed(2)}"></div>
      </div>`:''}
      <div class="fg"><label class="fl">Payment Method</label><select class="fs" id="paid-method">${mOpts}</select></div>
      <button class="btn b-g mb8" onclick="submitMarkPaid(this)">✅ Confirm Payment Received</button>
      <button class="btn b-s" onclick="closeMo('m-payrec')">Cancel</button>`;
    showMo('m-payrec');
  }
}

async function submitMarkPaid(btn) {
  if(_isSaving)return;_isSaving=true;
  if(btn){btn.disabled=true;btn.textContent='Saving...';}
  try {
    const jid=S.jobModal;const method=$('paid-method')?.value||'';const ppReason=$('pp-reason')?.value||'';
    const ppAmtEl=$('pp-amt');const ppAmt=ppAmtEl?parseFloat(ppAmtEl.value)||0:0;
    const tod=today();closeMo('m-payrec');
    const j=S.jobs.find(x=>x.Job_ID===jid);
    if(!j){showToast('⚠️ Job not found');return;}
    const fullAmt=parseMoney(j.Total_Amount);
    const isPartial=ppAmt>0&&ppAmt<fullAmt;
    j.Payment_Status=isPartial?'Partial':'Paid';
    j.Payment_Method=method;
    if(ppReason)j.PrePaid_Reason=ppReason;
    if(ppAmt>0)j.PrePaid_Amount=String(ppAmt);
    const inv=S.financials.find(f=>f.Job_ID===jid);
    const invAmt=ppAmt>0?String(ppAmt):j.Total_Amount;
    if(inv){inv.Status='Paid';inv.Payment_Method=method;inv.Paid_Date=tod;inv.Amount=invAmt;}
    else S.financials.push({Invoice_ID:'INV'+Date.now(),Job_ID:jid,Client_ID:j.Client_ID,Amount:invAmt,Status:'Paid',Payment_Method:method,Paid_Date:tod});
    if(!S.isDemo)await gasCall({action:'markInvoicePaid',jobId:jid,method,ppReason,ppAmt});
    cacheInvalidate();
    refreshData();showToast('💰 Payment recorded!');
  } catch(e) {
    showToast('⚠️ Payment save failed — please retry');
    if(btn){btn.disabled=false;btn.textContent='✅ Confirm Payment Received';}
  } finally {
    _isSaving=false;
  }
}

async function markRevRequested(jid) {
  const j=S.jobs.find(x=>x.Job_ID===jid);if(j)j.Review_Status='Requested';
  if(!S.isDemo)await gasCall({action:'updateJobDetails',jobId:jid,revStatus:'Requested'});
  cacheInvalidate();refreshData();showToast('⭐ Review marked as Requested');
}

async function clearFU(jid) {
  const j=S.jobs.find(x=>x.Job_ID===jid);if(j)j.Follow_Up='No';
  if(!S.isDemo)await gasCall({action:'updateJobDetails',jobId:jid,followUp:'No'});
  cacheInvalidate();refreshData();showToast('✓ Follow-up cleared');
}


// ============================================================================
// 12. NOTES LOGIC
// ============================================================================

function openEditNotes() {
  const c=getCli(S.curCli);S.notesMeta='Global_Notes';
  if($('m-notes-t')) $('m-notes-t').textContent='📝 General Notes';
  if($('m-notes-inp')) {
    $('m-notes-inp').value=c.Global_Notes||'';
    $('m-notes-inp').dataset.mode='clientnote';
  }
  showMo('m-notes');
}

function openEditAccess() {
  const c=getCli(S.curCli);S.notesMeta='Access_Info';
  if($('m-notes-t')) $('m-notes-t').textContent='🔑 Access Info';
  if($('m-notes-inp')) {
    $('m-notes-inp').value=c.Access_Info||'';
    $('m-notes-inp').dataset.mode='clientnote';
  }
  showMo('m-notes');
}

function openEditFamily() {
  const c=getCli(S.curCli);S.notesMeta='Family_Details';
  if($('m-notes-t')) $('m-notes-t').textContent='👨‍👩‍👧 Family & Pets';
  if($('m-notes-inp')) {
    $('m-notes-inp').value=c.Family_Details||'';
    $('m-notes-inp').dataset.mode='clientnote';
  }
  showMo('m-notes');
}

async function saveNotes() {
  if(_isSaving)return;_isSaving=true;
  const btn = $('btn-save-notes');
  const origText = btn ? btn.textContent : '';
  if(btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  
  const val=$('m-notes-inp')?.value.trim()||'';const mode=$('m-notes-inp')?.dataset.mode;
  closeMo('m-notes');
  if(mode==='jobnote'){
    const j=S.jobs.find(x=>x.Job_ID===S.jobModal);if(j)j.Job_Notes=val;
    if(!S.isDemo)await gasCall({action:'updateJobDetails',jobId:S.jobModal,notes:val});
    cacheInvalidate();refreshData();showToast('✓ Notes saved');
    _isSaving=false;
    if(btn){btn.disabled=false;btn.textContent=origText;}
    return;
  }
  const c=S.clients.find(x=>x.Client_ID===S.curCli);if(c)c[S.notesMeta]=val;
  if(!S.isDemo)await gasCall({action:'updateClientField',clientId:S.curCli,field:S.notesMeta,value:val});
  cacheInvalidate();refreshData();showToast('✓ Notes saved');
  _isSaving=false;
  if(btn){btn.disabled=false;btn.textContent=origText;}
}

function openQuickNote(jid) {
  const j=getJob(jid);if(!j.Job_ID)return;
  S.notesMeta='Job_Notes';S.jobModal=jid;
  if($('m-notes-t')) $('m-notes-t').textContent='📝 Job Notes — '+esc(j.Service||'');
  if($('m-notes-inp')) {
    $('m-notes-inp').value=j.Job_Notes||'';
    $('m-notes-inp').dataset.mode='jobnote';
  }
  showMo('m-notes');
}

// ============================================================================
// 13. ADMIN & SETTINGS
// ============================================================================

function loadBizConfig() {
  try {
    const s = localStorage.getItem('smhq_biz');
    if (s) {
      const p = JSON.parse(s);
      S.biz = Object.assign(JSON.parse(JSON.stringify(DEFAULT_BIZ)), p);
    }
  } catch(e) {}

  if (!S.biz.logo || S.biz.logo === "") {
     S.biz.logo = GLOBAL_LOGO;
  }

  syncBizUI();
  updateHeaderBrand();
  updHourlyBtnText();
}

function syncBizUI() {
  if($('cfg-biz')) $('cfg-biz').value = S.biz.biz || '';
  if($('cfg-owner')) $('cfg-owner').value = S.biz.owner || '';
  if($('cfg-rate')) $('cfg-rate').value = S.biz.rate || 50;
  if($('cfg-hst')) $('cfg-hst').value = S.biz.hst_num || '';
  
  if($('tax-on')) $('tax-on').classList.toggle('on', S.biz.tax_enabled === 'TRUE');
  if($('tax-off')) $('tax-off').classList.toggle('on', S.biz.tax_enabled === 'FALSE');

  const logoSrc = S.biz.logo && !S.biz.logo.startsWith('data:') ? S.biz.logo : GLOBAL_LOGO;
  const emptyEl = $('logo-thumb-empty');
  const imgEl = $('logo-thumb-img');
  const removeBtn = $('logo-remove-btn');
  if(emptyEl && imgEl){
    if(logoSrc){
      imgEl.src = logoSrc;
      imgEl.classList.remove('hidden');
      emptyEl.classList.add('hidden');
      if(removeBtn) removeBtn.classList.add('hidden'); // no remove — logo is managed manually
    } else {
      imgEl.classList.add('hidden');
      emptyEl.classList.remove('hidden');
      if(removeBtn) removeBtn.classList.add('hidden');
    }
  }
}

function updateHeaderBrand() {
  const logoEl = document.getElementById('brand-logo'); 
  const nameEl = document.getElementById('brand-name-txt');
  
  if(!logoEl || !nameEl) return;

  const bizName = S.biz.biz || '';
  const isDefault = !bizName || bizName === 'Supermom for Hire';

  if(isDefault){
    nameEl.innerHTML = 'Supermom <span>for Hire</span>';
  } else {
    nameEl.textContent = bizName;
  }

  const logoSource = S.biz.logo || GLOBAL_LOGO;

  if(logoSource && logoSource !== "" && !logoSource.startsWith('data:')){
    logoEl.style.maxHeight=''; logoEl.style.maxWidth=''; logoEl.style.width=''; logoEl.style.height='';
    logoEl.onload = function(){
      const aspect = this.naturalWidth / (this.naturalHeight || 1);
      if(aspect >= 2){
        this.style.maxWidth='240px'; this.style.maxHeight='64px';
        this.style.width='auto'; this.style.height='auto';
      } else {
        this.style.maxHeight='64px'; this.style.maxWidth='240px';
        this.style.height='64px'; this.style.width='auto';
      }
    };
    logoEl.src = logoSource;
    logoEl.classList.remove('hidden');
    nameEl.classList.add('hidden');
  } else {
    logoEl.classList.add('hidden');
    logoEl.onload = null;
    nameEl.classList.remove('hidden');
  }
}

function handleLogoUpload(input) {
  // Logo is managed via Google Drive URL set directly in the sheet.
  // Upload through app is disabled for now.
  showToast('⚠️ Logo is managed manually — see Admin guide');
}

function removeLogo() {
  S.biz.logo='';
  syncBizUI();updateHeaderBrand();
  const inp=$('logo-file-inp');if(inp)inp.value='';
  showToast('✓ Logo removed — tap Save');
}

async function saveBizConfig() {
  S.biz.biz = $('cfg-biz').value.trim();
  S.biz.owner = $('cfg-owner').value.trim();
  S.biz.rate = parseFloat($('cfg-rate').value) || 50;
  S.biz.hst_num = $('cfg-hst').value.trim();

  if(!S.isDemo) {
    await gasCall({
      action: 'updateBizConfig',
      biz: S.biz.biz,
      owner: S.biz.owner,
      rate: S.biz.rate,
      hst_num: S.biz.hst_num,
      tax_rate: S.biz.tax_rate,
      tax_enabled: S.biz.tax_enabled,
      service_prices: JSON.stringify(S.biz.service_prices || {})
    });
  }
  localStorage.setItem('smhq_biz', JSON.stringify(S.biz));
  showToast('✓ Settings saved');
  calc();
}

function renderAdmin() {
  const el=$('admin-lists');if(!el)return;
  const listKeys=[{k:'services',l:'Services'},{k:'referral_sources',l:'Referral Sources'},
    {k:'payment_methods',l:'Payment Methods'},{k:'prepaid_reasons',l:'Pre-Pay Reasons'}];
  el.innerHTML=listKeys.map(({k,l})=>`
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-family:'Nunito',sans-serif;font-size:15px;font-weight:800;">${l}</div>
        <button class="btn b-sm b-p ladmin" style="width:auto;" data-ladmin="add" data-lk="${k}" onclick="openLAdd('${k}')">+ Add</button>
      </div>
      ${gl(k).map((item,i)=>`<div class="li-row">
        <span class="li-lbl">${esc(item)}</span>
        <div class="li-acts">
          <button class="btn b-xs b-s ladmin" data-ladmin="edit" data-lk="${k}" data-li="${i}">✏️</button>
          <button class="btn b-xs b-r ladmin" data-ladmin="del" data-lk="${k}" data-li="${i}">✕</button>
        </div>
      </div>`).join('')}
      <div style="font-size:11px;color:var(--txt3);margin-top:4px;">✓ Changes to this list save automatically</div>
    </div>`).join('');
  renderSvcPrices();
}

function openLAdd(k) { S.listMeta={k,i:-1}; if($('m-ladd-t')) $('m-ladd-t').textContent='Add to '+k.replace('_',' '); if($('m-ladd-inp')) $('m-ladd-inp').value=''; showMo('m-ladd'); }

async function addListItem() {
  const v=$('m-ladd-inp')?.value.trim()||'';if(!v){showToast('⚠️ Enter a value');return;}
  const k=S.listMeta.k;S.lists[k]=[...(S.lists[k]||[]),v];
  if(!S.isDemo)await gasCall({action:'updateList',listKey:k,list:S.lists[k]});
  cacheWrite();
  closeMo('m-ladd');renderAdmin();popLists();showToast('✓ Added');
}

function openLEdit(k,i) { S.listMeta={k,i}; if($('m-ledit-t')) $('m-ledit-t').textContent='Edit Item'; if($('m-ledit-inp')) $('m-ledit-inp').value=gl(k)[i]||''; showMo('m-ledit'); }

async function saveListItem() {
  const v=$('m-ledit-inp')?.value.trim()||'';if(!v){showToast('⚠️ Enter a value');return;}
  const{k,i}=S.listMeta;const l=gl(k);
  const oldVal = l[i]; 
  l[i]=v;S.lists[k]=l;
  
  // Smart Fix: Update service price key if a service was renamed
  if (k === 'services' && S.biz.service_prices && S.biz.service_prices[oldVal] !== undefined) {
    S.biz.service_prices[v] = S.biz.service_prices[oldVal];
    delete S.biz.service_prices[oldVal];
    saveBizConfig(); // Pushes updated JSON to GAS
  }

  if(!S.isDemo)await gasCall({action:'updateList',listKey:k,list:l});
  cacheWrite();
  closeMo('m-ledit');renderAdmin();popLists();showToast('✓ Saved');
}

async function delListItem(k,i) {
  const l=gl(k);const r=l.splice(i,1)[0];S.lists[k]=l;
  
  // Smart Fix: Nuke the service price if the service is deleted
  if (k === 'services' && S.biz.service_prices && S.biz.service_prices[r] !== undefined) {
    delete S.biz.service_prices[r];
    saveBizConfig(); 
  }

  if(!S.isDemo)await gasCall({action:'updateList',listKey:k,list:l});
  cacheWrite();
  popLists();renderAdmin();showToast('✕ "'+r+'" removed');
}

function renderSvcPrices() {
  const el=$('svc-price-list');if(!el)return;
  const svcs=gl('services');const prices=S.biz.service_prices||{};
  el.innerHTML=svcs.map(s=>`
    <div class="li-row" style="flex-wrap:wrap;gap:8px;">
      <span class="li-lbl" style="min-width:120px;">${esc(s)}</span>
      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:140px;">
        <span style="font-size:13px;color:var(--txt2);font-weight:700;">$</span>
        <input class="fi" type="text" inputmode="decimal" pattern="[0-9\.]*" style="flex:1;min-height:40px;font-size:14px;padding:8px 12px;"
          placeholder="e.g. 45 ($/hr)" value="${prices[s]!==undefined?prices[s]:''}"
          oninput="setSvcPrice('${esc(s.replace(/'/g,"\\'"))}',this.value)">
        <span style="font-size:13px;color:var(--txt2);font-weight:700;">/hr</span>
        ${prices[s]!==undefined?`<button class="btn b-xs b-r" style="min-height:36px;width:36px;" onclick="clearSvcPrice('${esc(s.replace(/'/g,"\\'"))}')">✕</button>`:''}
      </div>
    </div>`).join('');
}

function setSvcPrice(svc,val) {
  if(!S.biz.service_prices)S.biz.service_prices={};
  const n=parseFloat(val);
  if(!isNaN(n)&&val!=='')S.biz.service_prices[svc]=n;else delete S.biz.service_prices[svc];
  try{localStorage.setItem('smhq_biz',JSON.stringify(S.biz));}catch(e){}
}

function clearSvcPrice(svc) {
  if(S.biz.service_prices)delete S.biz.service_prices[svc];
  try{localStorage.setItem('smhq_biz',JSON.stringify(S.biz));}catch(e){}
  renderSvcPrices();
}

async function saveSvcRates() {
  await saveBizConfig();
}

function setTaxToggle(val) {
  S.biz.tax_enabled = val;
  if($('tax-on')) $('tax-on').classList.toggle('on', val === 'TRUE');
  if($('tax-off')) $('tax-off').classList.toggle('on', val === 'FALSE');
}