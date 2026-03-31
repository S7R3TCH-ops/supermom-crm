// ============================================================================
// SUPERMOM FOR HIRE — CRM v5.1 (Incremental Baseline)
// ============================================================================
const APP_VERSION = '5.1';
const GAS_URL = "https://script.google.com/macros/s/AKfycbzoqPyDDmpdgNp60xAKrXtClxqOdWxmmwgnH4sK7fM-rcM8LyPoE9Br7Lg6CtI3hCREzw/exec";

const DL = {
  services: ['Deep Clean','Regular Clean','Move In / Move Out','Post-Renovation','Organization','Laundry & Folding','Fridge & Oven Clean','Window Washing','Senior Companionship','Childcare Support','Caregiving','Coaching Session','Errands / Tasks','Other / Custom'],
  referral_sources: ['Word of Mouth','Google Search','Facebook','Instagram','Kijiji','Returning Client','Neighbour Referral','Flyer / Postcard','Other'],
  payment_methods: ['Cash','E-Transfer','Cheque','Other'],
  prepaid_reasons: ['Client Pre-Paid','Deposit Received','Gift / Package','Other'],
};

const GLOBAL_LOGO = "https://lh3.googleusercontent.com/d/1vYV_0VFk2MF8QrZyQ77BKyx4hnpuDqSb";

const DEFAULT_BIZ = {
  biz: 'Supermom for Hire', owner: 'Sandra', rate: 50, hst_num: '', tax_rate: 0.13, tax_enabled: 'FALSE', service_prices: {}, logo: GLOBAL_LOGO
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
  showAllSched: false, showAllArc: false, moneyFilter: 'month',
  profileJobFilter: 'all'
};

let _isSaving = false, _reqs = 0, _backLock = false, _tt;
const _pendingDeletes = { jobs: new Set(), clients: new Set() };

// ── THE HYBRID PIPE ──────────────────────────────────────────────────────────
async function gasCall(payload, isRetry = false) {
  showLoader();
  try {
    let url = GAS_URL;
    let options;
    if (payload.action === 'getAllData') {
      url += '?payload=' + encodeURIComponent(JSON.stringify(payload));
      options = { method: 'GET' };
    } else {
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      };
    }
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const json = await response.json();
    hideLoader();
    return json;
  } catch (e) {
    hideLoader();
    console.error('Connection Error:', e);
    if (!isRetry && payload.action !== 'getAllData') {
      const q = JSON.parse(localStorage.getItem('smhq_queue') || '[]');
      q.push({ payload, timestamp: Date.now() });
      localStorage.setItem('smhq_queue', JSON.stringify(q));
      showToast('📴 Saved locally (Syncing later)');
    }
    return { success: false, offline: true };
  }
}

// ── THE FINANCIAL BRAIN ───────────────────────────────────────────────────────
function getJobTotals(j) {
  const savedTotal = parseMoney(j.Total_Amount);
  const rate = parseFloat(S.biz.rate) || 50;
  const hstRate = String(S.biz.tax_enabled).toUpperCase() === 'TRUE' ? 0.13 : 0;
  
  const hrs = parseFloat(j.Actual_Duration || j.Estimated_Hours) || 0;
  let base = (j.Pricing_Type === 'Flat') ? parseMoney(j.Flat_Rate) : hrs * rate;

  const sur = parseMoney(j.Surcharge);
  const add = parseMoney(j.Additional_Cost);
  const subtotal = base + sur + add;
  const hstAmount = subtotal * hstRate;
  
  const calcTotal = subtotal + hstAmount;
  const total = (savedTotal > 0 && j.Job_Status === 'Completed') ? savedTotal : calcTotal;

  const inv = S.financials.find(f => f.Job_ID === j.Job_ID);
  let paid = inv ? parseMoney(inv.Amount) : (j.Payment_Status === 'Paid' ? total : parseMoney(j.PrePaid_Amount));

  return { subtotal, hstAmount, hstRate, total, paid, balance: Math.max(0, total - paid) };
}

// ── UTILITIES ────────────────────────────────────────────────────────────────
const taxRate = () => String(S.biz.tax_enabled).toUpperCase() === 'TRUE' ? 0.13 : 0;
const hourlyRate = () => S.biz.rate || 50;
const today = () => new Date().toISOString().split('T')[0];
const getCli = id => S.clients.find(c => c.Client_ID === id) || {};
const getJob = id => S.jobs.find(j => j.Job_ID === id) || {};
const getInv = jid => S.financials.find(f => f.Job_ID === jid);
const gl = k => S.lists[k] || DL[k] || [];
const fullN = c => ((c.First_Name || '') + ' ' + (c.Last_Name || '')).trim() || 'Unknown';
const inits = c => (((c.First_Name || '')[0] || '') + ((c.Last_Name || '')[0] || '')).toUpperCase() || '??';
const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—';
const fmtT = t => {
  if (!t || t.includes('1899')) return '';
  try {
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m}${hr >= 12 ? 'pm' : 'am'}`;
  } catch { return t; }
};
const parseMoney = v => parseFloat(String(v || '0').replace(/[^0-9.-]+/g, '')) || 0;
const esc = s => s == null ? '' : String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const isPaidJob = j => getJobTotals(j).balance <= 0.01;
const isArchived = j => j.Job_Status === 'Completed' && isPaidJob(j) && j.Follow_Up !== 'Yes';
const $ = id => document.getElementById(id);
function showMo(id) { $(id).classList.add('show'); document.body.classList.add('modal-open'); }
function closeMo(id, e) { if (e && e.target !== $(id)) return; $(id).classList.remove('show'); document.body.classList.remove('modal-open'); }
function showToast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(_tt); _tt = setTimeout(() => t.classList.remove('show'), 2800); }
function showLoader() { if (_reqs++ === 0) $('global-loader').classList.add('show'); }
function hideLoader() { if (--_reqs <= 0) { _reqs = 0; $('global-loader').classList.remove('show'); } }
function row(l, s, v, c) { return `<div style="display:flex;justify-content:space-between;margin-bottom:4px;${c?'color:'+c+';':''}"><span>${l}${s?` <span style="color:var(--txt3);font-size:11px;">${s}</span>`:''}</span><span>${v}</span></div>`; }
function dsec(lid, sid, jobs, type) { const l=$(lid), s=$(sid); if (!l||!s) return; if (!jobs||!jobs.length) { s.style.display='none'; return; } s.style.display=''; l.innerHTML=jobs.map(j=>jrHTML(j,type)).join(''); }
function uid(pfx) { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let res = ''; for (let i = 0; i < 6; i++) res += chars.charAt(Math.floor(Math.random() * chars.length)); return pfx + '-' + res; }

// ── DATA LOADING ─────────────────────────────────────────────────────────────
async function loadAllData() {
  const cached = localStorage.getItem('smhq_cache');
  if (cached) {
    const p = JSON.parse(cached);
    S.clients = p.clients || []; S.jobs = p.jobs || []; S.financials = p.financials || []; refreshAll();
  }
  const r = await gasCall({ action: 'getAllData' });
  if (r.success) {
    S.clients = r.clients || []; S.jobs = r.jobs || []; S.financials = r.financials || [];
    S.biz = Object.assign(S.biz, r.biz);
    refreshAll();
    localStorage.setItem('smhq_cache', JSON.stringify({ clients: S.clients, jobs: S.jobs, financials: S.financials, lists: S.lists, biz: S.biz }));
  }
}

async function drainOfflineQueue() {
  const raw = localStorage.getItem('smhq_queue'); if (!raw) return;
  const q = JSON.parse(raw); if (!q.length) return;
  localStorage.removeItem('smhq_queue');
  for (const item of q) { try { await gasCall(item.payload, true); } catch (e) {} }
  showToast('✅ Sync Complete');
}

function refreshAll() { renderDash(); renderCli(); popCliDrop(); popLists(); renderAdmin(); renderSvcPrices(); updateHeaderBrand(); }
function refreshData() { if (S.view === 'dashboard') renderDash(); else if (S.view === 'clients') renderCli(); else if (S.view === 'profile') openProfile(S.curCli); }

// ── DASHBOARD ────────────────────────────────────────────────────────────────
function renderDash() {
  renderEarnBars();
  const tod = today();
  const cat = { today: [], upcoming: [], overdue: [], unschd: [], owed: [], done: [] };

  S.jobs.forEach(j => {
    const totals = getJobTotals(j);
    if (j.Job_Status === 'Scheduled') {
      if (!j.Scheduled_Date) cat.unschd.push(j);
      else if (j.Scheduled_Date < tod) cat.overdue.push(j);
      else if (j.Scheduled_Date === tod) cat.today.push(j);
      else cat.upcoming.push(j);
    } else if (j.Job_Status === 'Completed') {
      if (totals.balance > 0.01) cat.owed.push(j);
      else cat.done.push(j);
    }
  });

  if ($('t-ct')) $('t-ct').textContent = cat.today.length ? cat.today.length + ' scheduled today' : 'No jobs today 🌸';
  const tjList = $('today-jobs-list');
  if (tjList) tjList.innerHTML = cat.today.map(j => `
    <div class="today-job" data-action="open-job" data-jid="${esc(j.Job_ID)}">
      <div class="tj-time">${j.Time && !j.Time.includes('1899') ? fmtT(j.Time) : 'All Day'}</div>
      <div class="tj-info"><div class="tj-name">${esc(fullN(getCli(j.Client_ID)))}</div><div class="tj-svc">${esc(j.Service)}</div></div>
      <button class="btn b-sm b-p" data-action="complete" data-jid="${esc(j.Job_ID)}">✅ Done</button>
    </div>`).join('');

  dsec('d-upcoming', 'd-upcoming-sec', cat.upcoming.slice(0, 5), 'sched');
  dsec('d-overdue', 'd-overdue-sec', cat.overdue, 'overdue');
  dsec('d-unschd', 'd-unschd-sec', cat.unschd, 'unschd');
  dsec('d-owed', 'd-owed-sec', cat.owed, 'owed');
  dsec('d-arc', 'd-arc-sec', cat.done.sort((a,b) => b.Completion_Date.localeCompare(a.Completion_Date)).slice(0, 3), 'paid');

  let totalOwed = 0; cat.owed.forEach(j => totalOwed += getJobTotals(j).balance);
  const displayPaid = S.moneyFilter === 'month' ? S.financials.filter(f => String(f.Paid_Date).startsWith(tod.substring(0, 7))) : S.financials;
  
  if ($('m-owed')) $('m-owed').textContent = '$' + totalOwed.toFixed(2);
  if ($('m-paid')) $('m-paid').textContent = '$' + displayPaid.reduce((sum, f) => sum + parseMoney(f.Amount), 0).toFixed(2);
  
  if ($('mf-month')) $('mf-month').classList.toggle('on', S.moneyFilter === 'month');
  if ($('mf-all')) $('mf-all').classList.toggle('on', S.moneyFilter === 'all');
}

function setMoneyFilter(f) { S.moneyFilter = f; renderDash(); }

// ── CLIENTS ──────────────────────────────────────────────────────────────────
function renderCli(q = '') {
  const l = $('cli-list');
  let cs = [...S.clients].sort((a, b) => (a.Last_Name || '').localeCompare(b.Last_Name || ''));
  if (q) { const lq = q.toLowerCase(); cs = cs.filter(c => fullN(c).toLowerCase().includes(lq) || String(c.Phone).includes(lq)); }
  l.innerHTML = cs.map(c => `
    <div class="cr" data-action="open-profile" data-cid="${esc(c.Client_ID)}">
      <div class="av">${esc(inits(c))}</div>
      <div class="ci"><div class="cn">${esc(fullN(c))}</div><div class="cs">${esc(c.Phone || 'No Phone')}</div></div>
      <span style="color:var(--txt3);font-size:22px;">›</span>
    </div>`).join('');
}

async function submitClient(thenBook = false) {
  if (_isSaving) return; _isSaving = true;
  const data = {
    Client_ID: S.editCli || uid('C'),
    First_Name: $('ac-first').value.trim(),
    Last_Name: $('ac-last').value.trim(),
    Phone: $('ac-phone').value.trim(),
    Email: $('ac-email').value.trim(),
    Street: $('ac-street').value.trim(),
    City: $('ac-city').value.trim(),
    Status: S.cliStatus,
    Global_Notes: $('ac-notes').value.trim(),
    Created_Date: today(),
    Is_Deleted: 'FALSE'
  };
  if (!S.editCli) S.clients.push(data); else Object.assign(S.clients.find(c => c.Client_ID === S.editCli), data);
  showToast('✓ Client Saved');
  if (thenBook) { S.curCli = data.Client_ID; openBookJobForClient(); } else { goBack(); renderCli(); }
  gasCall({ action: S.editCli ? 'updateClient' : 'addClient', ...data });
  _isSaving = false;
}

function openProfile(cid) {
  S.curCli = cid; const c = getCli(cid); const cj = S.jobs.filter(j => j.Client_ID === cid);
  if ($('p-name')) $('p-name').textContent = fullN(c);
  if ($('p-jobs')) $('p-jobs').textContent = cj.length;
  renderProfileJobs(cj);
  navTo('profile', true);
}

// ── JOBS ─────────────────────────────────────────────────────────────────────
function calc() {
  const mockJob = { Pricing_Type: S.priceType, Estimated_Hours: $('bj-hrs')?.value, Flat_Rate: $('bj-flat')?.value, Surcharge: $('bj-sur')?.value };
  const t = getJobTotals(mockJob);
  if ($('c-base')) $('c-base').textContent = '$' + (t.subtotal - parseMoney(mockJob.Surcharge)).toFixed(2);
  if ($('c-tot')) $('c-tot').textContent = '$' + t.total.toFixed(2);
}

function submitJob() {
  const cid = $('bj-cli').value; if (!cid) return showToast('⚠️ Select Client');
  const totals = getJobTotals({ Pricing_Type: S.priceType, Estimated_Hours: $('bj-hrs').value, Flat_Rate: $('bj-flat').value, Surcharge: $('bj-sur').value });
  const jobData = {
    Job_ID: uid('J'), Client_ID: cid, Service: $('bj-svc').value, Scheduled_Date: $('bj-date').value,
    Time: $('bj-time').value, Pricing_Type: S.priceType, Estimated_Hours: $('bj-hrs').value,
    Flat_Rate: $('bj-flat').value, Surcharge: $('bj-sur').value, Subtotal: totals.subtotal.toFixed(2),
    HST_Rate: totals.hstRate, HST_Amount: totals.hstAmount.toFixed(2), Total_Amount: totals.total.toFixed(2),
    Job_Status: 'Scheduled', Payment_Status: 'Unpaid', Created_Date: today(), Is_Deleted: 'FALSE'
  };
  S.jobs.push(jobData); renderDash(); goBack();
  gasCall({ action: 'addJob', ...jobData });
}

function openCompleteModal(jid) {
  S.jobModal = jid; S.payNow = false;
  const j = getJob(jid); const c = getCli(j.Client_ID);
  if ($('m-comp-t')) $('m-comp-t').textContent = '✅ Complete: ' + fullN(c);
  calcJobTotal();
  showMo('m-comp');
}

function calcJobTotal() {
  const j = getJob(S.jobModal);
  const mock = { ...j, Actual_Duration: $('cp-hrs')?.value, Additional_Cost: $('cp-addcost')?.value };
  const t = getJobTotals(mock);
  const rows = $('cp-preview-rows');
  if (rows) rows.innerHTML = row('Subtotal', '', '$' + t.subtotal.toFixed(2)) + row('HST', '', '$' + t.hstAmount.toFixed(2)) + `<div class="pr tot"><span>Total</span><span>$${t.total.toFixed(2)}</span></div>`;
  const ps = $('cp-pay-section');
  if (ps) ps.innerHTML = `
    <div class="fg" style="margin-top:15px; border-top:1px solid var(--border); padding-top:15px;">
      <label class="fl">💰 Payment Collected?</label>
      <div class="tr">
        <button class="tb ${S.payNow ? 'on' : ''}" onclick="setPayNow(true)">💵 Yes, Paid $${t.total.toFixed(2)}</button>
        <button class="tb ${!S.payNow ? 'on' : ''}" onclick="setPayNow(false)">⏳ No</button>
      </div>
    </div>`;
}

function setPayNow(v) { S.payNow = v; calcJobTotal(); }

async function submitComplete() {
  const j = getJob(S.jobModal);
  const t = getJobTotals({ ...j, Actual_Duration: $('cp-hrs').value, Additional_Cost: $('cp-addcost').value });
  Object.assign(j, { Job_Status: 'Completed', Completion_Date: today(), Actual_Duration: $('cp-hrs').value, Total_Amount: t.total.toFixed(2), Payment_Status: S.payNow ? 'Paid' : 'Unpaid' });
  if (S.payNow) S.financials.push({ Job_ID: j.Job_ID, Amount: t.total.toFixed(2), Paid_Date: today(), Status: 'Paid' });
  closeMo('m-comp'); renderDash();
  gasCall({ action: 'markJobComplete', jobId: j.Job_ID, actualHours: j.Actual_Duration, totalAmount: j.Total_Amount, markPaid: S.payNow, subtotal: t.subtotal.toFixed(2), hstAmount: t.hstAmount.toFixed(2), hstRate: t.hstRate });
}

// ── UI HELPERS ───────────────────────────────────────────────────────────────
function popLists() {
  const ref = $('ac-ref'); if(ref) { ref.innerHTML = ''; gl('referral_sources').forEach(v => { const o = document.createElement('option'); o.value=v; o.textContent=v; ref.appendChild(o); }); }
  const svc = $('bj-svc'); if(svc) { svc.innerHTML = ''; gl('services').forEach(v => { const o = document.createElement('option'); o.value=v; o.textContent=v; svc.appendChild(o); }); }
}
function popCliDrop() {
  const sel = $('bj-cli'); if(!sel) return;
  sel.innerHTML = '<option value="">— Select client —</option>';
  [...S.clients].sort((a,b)=>fullN(a).localeCompare(fullN(b))).forEach(c => {
    const o = document.createElement('option'); o.value=c.Client_ID; o.textContent=fullN(c); sel.appendChild(o);
  });
}
function renderAdmin() {
  const el = $('admin-lists'); if(!el) return;
  const listKeys = [{k:'services',l:'Services'},{k:'referral_sources',l:'Referral Sources'},{k:'payment_methods',l:'Payment Methods'}];
  el.innerHTML = listKeys.map(({k,l}) => `<div class="card"><div class="slbl">${l}</div>${gl(k).map(item=>`<div class="li-row"><span class="li-lbl">${esc(item)}</span></div>`).join('')}</div>`).join('');
}
function renderSvcPrices() {
  const el = $('svc-price-list'); if(!el) return;
  el.innerHTML = gl('services').map(s => `<div class="li-row"><span class="li-lbl">${esc(s)}</span></div>`).join('');
}
function updateHeaderBrand() {
  const logo = $('brand-logo'), name = $('brand-name-txt');
  if(S.biz.logo && S.biz.logo !== GLOBAL_LOGO) { logo.src = S.biz.logo; logo.classList.remove('hidden'); name.style.display='none'; }
  else { logo.classList.add('hidden'); name.style.display=''; }
}
function renderEarnBars() { /* Chart logic placeholder for v5.2 */ }

// ── CORE NAV ─────────────────────────────────────────────────────────────────
function navTo(v, push=false) {
  if (push) S.stack.push(S.view); else S.stack = [];
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('view-' + v);
  if(target) target.classList.add('active');
  S.view = v; updHeader(v);
}
function goBack() { if (S.stack.length) navTo(S.stack.pop()); else navTo('dashboard'); }
function updHeader(v) { if($('hbk')) $('hbk').classList.toggle('hidden', v === 'dashboard'); }

function jrHTML(j, type) { 
  return `<div class="jr ${type}" data-action="open-job" data-jid="${esc(j.Job_ID)}"><div class="jd"><div class="jn">${esc(fullN(getCli(j.Client_ID)))}</div><div class="jm">${esc(j.Service)}</div></div><div class="ja">$${parseMoney(j.Total_Amount).toFixed(2)}</div></div>`; 
}
function renderProfileJobs(cj) { if($('p-jobs-list')) $('p-jobs-list').innerHTML = cj.map(j => jrHTML(j, 'sched')).join(''); }

window.addEventListener('DOMContentLoaded', () => {
  loadAllData();
  document.getElementById('scroll').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, jid, cid } = btn.dataset;
    if (action === 'complete') openCompleteModal(jid);
    if (action === 'open-profile') openProfile(cid);
    if (action === 'open-job') openJobModal(jid);
  });
});
