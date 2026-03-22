// ============================================================
// SUPERMOM FOR HIRE — Google Apps Script Backend
// Production v4.0 — Best Practices Edition
// ============================================================
// ARCHITECTURE NOTES:
//   - doPost holds a script lock for write safety (prevents concurrent writes)
//   - Calendar sync runs AFTER the lock is released (avoids timeout)
//   - _cfg cache is cleared on every write so reads are always fresh
//   - audit() is wired into every meaningful action
//   - All sheet writes are header-aware — safe to add columns at any time
//   - Worker_ID defaults to script owner email so multi-client is clean
//   - Calendar ID stored in 00_CONFIG as 'calendar_id' — one line to swap per client
// ============================================================

const SHEET = {
  CONFIG:   '00_CONFIG',
  CLIENTS:  '01_CLIENTS',
  JOBS:     '02_JOBS',
  INVOICES: '03_INVOICES',
  PAYMENTS: '04_PAYMENTS',
  AUDIT:    '05_AUDIT_LOG',
  WORKERS:  '06_WORKERS',
};

const TZ = 'America/Toronto';

// ── REQUEST HANDLING ─────────────────────────────────────────

function doPost(e) {
  // Lock prevents two simultaneous writes from corrupting sheet data
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);

  let result;
  let calendarJobId = null; // track job needing calendar sync after lock releases

  try {
    let payload;
    if (e.postData && e.postData.contents && e.postData.contents.trim().startsWith('{')) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.payload) {
      payload = JSON.parse(e.parameter.payload);
    } else {
      throw new Error('Invalid payload format.');
    }

    result = route(payload);

    // Flag jobs that need calendar sync — sync happens OUTSIDE the lock
    // to prevent CalendarApp latency from eating into the 15s window
    if (result.success && result._syncCalendar) {
      calendarJobId = result._syncCalendar;
      delete result._syncCalendar; // don't expose internal flag to client
    }

  } catch(err) {
    result = { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }

  // Calendar sync outside the lock — safe, non-blocking for the response
  if (calendarJobId) {
    try { syncToCalendar(calendarJobId); } catch(e) {
      Logger.log('Calendar sync failed for ' + calendarJobId + ': ' + e.message);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, message: 'Supermom API v4.0 is live.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function route(p) {
  switch(p.action) {
    case 'getAllData':        return getAllData();
    case 'addClient':        return addClient(p);
    case 'updateClient':     return updateClient(p);
    case 'updateClientField':return updateClientField(p);
    case 'deleteClient':     return deleteClient(p);
    case 'addJob':           return addJob(p);
    case 'updateJobDetails': return updateJobDetails(p);
    case 'markJobComplete':  return markJobComplete(p);
    case 'markInvoicePaid':  return markInvoicePaid(p);
    case 'deleteJob':        return deleteJob(p);
    case 'cancelJob':        return cancelJob(p);
    case 'updateList':       return updateList(p);
    case 'updateBizConfig':  return updateBizConfig(p);
    default: return { success: false, error: 'Unknown action: ' + p.action };
  }
}

// ── UTILITIES ────────────────────────────────────────────────

function ss()     { return SpreadsheetApp.getActiveSpreadsheet(); }
function sh(name) { return ss().getSheetByName(name); }
function now()    { return new Date().toISOString(); }
function today()  { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function uid(pfx) { return pfx + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7).toUpperCase(); }

// Returns the worker ID for audit purposes — defaults to script owner email
function whoami() {
  try { return Session.getEffectiveUser().getEmail() || 'W001'; } catch(e) { return 'W001'; }
}

function formatVal(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    // Google Sheets returns time-only cells as Date objects anchored at Dec 30 1899
    if (val.getFullYear() <= 1900) {
      const h = val.getHours();
      const m = val.getMinutes();
      return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
    }
    return Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
  }
  return String(val);
}

// ── CONFIG ───────────────────────────────────────────────────
// Cached per execution. Cleared after any write that changes config.

let _cfg = null;

function getConfig() {
  if (_cfg) return _cfg;
  const s = sh(SHEET.CONFIG);
  if (!s) return { _lists: {} };
  const raw = s.getDataRange().getValues();
  _cfg = { _lists: {} };
  for (let i = 1; i < raw.length; i++) {
    const key  = String(raw[i][0]).trim();
    const val  = String(raw[i][1]);
    const cat  = String(raw[i][2]).trim();
    const sort = parseInt(raw[i][3] || 0);
    if (!key) continue;
    if (cat === 'settings') {
      _cfg[key] = val;
    } else {
      if (!_cfg._lists[cat]) _cfg._lists[cat] = [];
      _cfg._lists[cat].push({ val, sort });
    }
  }
  return _cfg;
}

function clearConfigCache() {
  _cfg = null;
}

function getList(cat) {
  const c = getConfig();
  if (!c._lists[cat]) return [];
  return c._lists[cat].sort((a,b) => a.sort - b.sort).map(x => x.val);
}

// ── SHEET OPERATIONS ─────────────────────────────────────────

function getObjects(sheetName) {
  const s = sh(sheetName);
  if (!s) return [];
  const raw = s.getDataRange().getValues();
  if (raw.length < 2) return [];
  const hdrs = raw[0].map(String);
  return raw.slice(1)
    .filter(r => r.some(c => c !== ''))
    .map(r => {
      const o = {};
      hdrs.forEach((h, i) => { o[h] = formatVal(r[i]); });
      return o;
    });
}

function updateRow(sheetName, idCol, idVal, updates) {
  const s = sh(sheetName);
  if (!s) return false;
  const raw = s.getDataRange().getValues();
  const hdrs = raw[0].map(String);
  const idIdx = hdrs.indexOf(idCol);
  if (idIdx === -1) return false;

  for (let i = 1; i < raw.length; i++) {
    if (String(raw[i][idIdx]) === String(idVal)) {
      const newRow = raw[i].slice();
      let changed = false;
      Object.keys(updates).forEach(k => {
        const cIdx = hdrs.indexOf(k);
        if (cIdx > -1) { newRow[cIdx] = updates[k]; changed = true; }
      });
      if (changed) s.getRange(i + 1, 1, 1, newRow.length).setValues([newRow]);
      return true;
    }
  }
  return false;
}

function appendRow(sheetName, obj) {
  const s = sh(sheetName);
  if (!s) return;
  const hdrs = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0].map(String);
  // Unknown columns get empty string — adding columns to sheet never breaks writes
  s.appendRow(hdrs.map(h => (obj[h] !== undefined ? obj[h] : '')));
}

// ── AUDIT LOG ────────────────────────────────────────────────
// Every meaningful action is recorded. Provides paper trail for the business
// and will surface in AppSheet automatically (AppSheet reads all sheets).
// Never throws — audit failure must never crash the main action.

function audit(action, clientId, jobId, paymentId, field, oldVal, newVal, notes) {
  try {
    const s = sh(SHEET.AUDIT);
    if (!s) return;
    s.appendRow([
      uid('LOG'),       // Log_ID
      now(),            // Timestamp
      clientId  || '',  // Client_ID
      jobId     || '',  // Job_ID
      paymentId || '',  // Payment_ID
      action,           // Action  e.g. ADD_JOB, COMPLETE_JOB, DELETE_CLIENT
      '',               // Entity  (reserved for AppSheet virtual columns)
      field     || '',  // Changed_Field
      oldVal    || '',  // Old_Value
      newVal    || '',  // New_Value
      'app',            // Source
      whoami(),         // Worker_ID — actual script owner email
      '',               // Session_ID (reserved)
      notes     || '',  // Notes
    ]);
  } catch(e) {
    Logger.log('Audit write failed: ' + e.message);
  }
}

// ── CLIENT STATS ─────────────────────────────────────────────
// Keeps computed columns in 01_CLIENTS fresh for AppSheet and Looker Studio

// recalcClientStats: used after single-client mutations (payment, completion)
// For bulk updates across all clients, getAllData calls updateAllClientStats instead.
function recalcClientStats(clientId) {
  if (!clientId) return;
  const jobs = getObjects(SHEET.JOBS).filter(j =>
    j.Client_ID === clientId &&
    j.Job_Status !== 'Cancelled' &&
    j.Is_Deleted !== 'TRUE'
  );
  const payments = getObjects(SHEET.PAYMENTS).filter(p =>
    p.Client_ID === clientId && p.Is_Void !== 'TRUE'
  );
  const totalPaid = payments.reduce((s, p) => s + parseFloat(p.Amount || 0), 0);
  const completionDates = jobs
    .filter(j => j.Job_Status === 'Completed' && j.Completion_Date)
    .map(j => j.Completion_Date)
    .sort();

  updateRow(SHEET.CLIENTS, 'Client_ID', clientId, {
    Total_Jobs:           String(jobs.length),
    Total_Lifetime_Value: totalPaid.toFixed(2),
    First_Service_Date:   completionDates.length ? completionDates[0] : '',
    Last_Service_Date:    completionDates.length ? completionDates[completionDates.length - 1] : '',
    Last_Modified_Date:   now(),
  });
}

// updateAllClientStats: batch version — pre-indexes all data, walks clients sheet
// ONCE, writes all updates in one pass. Called at end of getAllData only.
// This is O(n) vs recalcClientStats which is O(n²) for bulk updates.
function updateAllClientStats(clients, jobs, payments) {
  const s = sh(SHEET.CLIENTS);
  if (!s) return;
  const raw     = s.getDataRange().getValues();
  const headers = raw[0].map(String);

  // Build column index map once
  const col = {};
  ['Client_ID','Total_Jobs','Total_Lifetime_Value',
   'First_Service_Date','Last_Service_Date','Last_Modified_Date'].forEach(h => {
    col[h] = headers.indexOf(h);
  });

  // Pre-index jobs and payments by client for O(1) lookup
  const jobsByClient = {};
  jobs.forEach(j => {
    if (!jobsByClient[j.Client_ID]) jobsByClient[j.Client_ID] = [];
    jobsByClient[j.Client_ID].push(j);
  });
  const paidByClient = {};
  payments.forEach(p => {
    if (!paidByClient[p.Client_ID]) paidByClient[p.Client_ID] = 0;
    paidByClient[p.Client_ID] += parseFloat(p.Amount || 0);
  });

  // Walk sheet once, update rows that need changes
  for (let i = 1; i < raw.length; i++) {
    const row      = raw[i];
    const clientId = String(row[col['Client_ID']] || '');
    if (!clientId || row.every(c => c === '' || c === null)) continue;

    const cJobs    = (jobsByClient[clientId] || [])
      .filter(j => j.Job_Status !== 'Cancelled' && j.Is_Deleted !== 'TRUE');
    const totalPaid = paidByClient[clientId] || 0;
    const doneDate  = cJobs
      .filter(j => j.Job_Status === 'Completed' && j.Completion_Date)
      .map(j => j.Completion_Date).sort();

    const newRow = row.slice();
    if (col['Total_Jobs']           > -1) newRow[col['Total_Jobs']]           = String(cJobs.length);
    if (col['Total_Lifetime_Value'] > -1) newRow[col['Total_Lifetime_Value']] = totalPaid.toFixed(2);
    if (col['Last_Service_Date']    > -1) newRow[col['Last_Service_Date']]    = doneDate.length ? doneDate[doneDate.length-1] : '';
    if (col['Last_Modified_Date']   > -1) newRow[col['Last_Modified_Date']]   = now();
    // Only set First_Service_Date if not already set
    if (col['First_Service_Date'] > -1 && doneDate.length && !String(row[col['First_Service_Date']])) {
      newRow[col['First_Service_Date']] = doneDate[0];
    }
    s.getRange(i + 1, 1, 1, newRow.length).setValues([newRow]);
  }
}

// ── GOOGLE CALENDAR SYNC ─────────────────────────────────────
// Called OUTSIDE the script lock so CalendarApp latency doesn't eat
// into the 15s lock window and risk a timeout crashing a sheet write.
//
// MSP SETUP FOR EACH NEW CLIENT:
//   1. Client shares their calendar with your agency Google account
//      Google Calendar → Settings → Share → Add person → "Make changes to events"
//   2. Client copies their Calendar ID from those same settings
//   3. You paste it into their 00_CONFIG sheet: key=calendar_id, value=<id>, category=settings
//   4. That's it. No code changes needed per client.
//
// FIRST TIME SETUP (authorize Calendar access):
//   1. In Apps Script editor, select syncToCalendar from the function dropdown
//   2. Click Run — Google will ask for Calendar permission
//   3. Authorize it. Permission is then permanently granted for this deployment.

function getCalendar() {
  const c = getConfig();
  const calId = (c.calendar_id || '').trim();
  if (!calId) {
    Logger.log('calendar_id not set in CONFIG — calendar sync disabled.');
    return null;
  }
  try {
    const cal = CalendarApp.getCalendarById(calId);
    if (!cal) {
      Logger.log('Calendar not found or no access: ' + calId);
      return null;
    }
    return cal;
  } catch(e) {
    Logger.log('Calendar access error: ' + e.message);
    return null;
  }
}

function syncToCalendar(jobId) {
  Logger.log('CAL SYNC: Starting for job ' + jobId);

  const cal = getCalendar();
  if (!cal) {
    Logger.log('CAL SYNC: No calendar — check calendar_id in 00_CONFIG');
    return;
  }
  Logger.log('CAL SYNC: Calendar found');

  const job = getObjects(SHEET.JOBS).find(j => j.Job_ID === jobId);
  if (!job) { Logger.log('CAL SYNC: Job not found: ' + jobId); return; }

  Logger.log('CAL SYNC: Job status=' + job.Job_Status + ' date=' + job.Scheduled_Date + ' time=' + job.Time);

  // Remove event if job is gone, cancelled, deleted, or has no date+time
  if (job.Is_Deleted === 'TRUE' || job.Job_Status === 'Cancelled' ||
      !job.Scheduled_Date || !job.Time) {
    Logger.log('CAL SYNC: Skipping — no date/time or cancelled/deleted');
    if (job.Event_ID) {
      try { cal.getEventById(job.Event_ID).deleteEvent(); } catch(e) {}
      updateRow(SHEET.JOBS, 'Job_ID', jobId, { Event_ID: '' });
    }
    return;
  }

  const client = getObjects(SHEET.CLIENTS).find(c => c.Client_ID === job.Client_ID) || {};
  const clientName = [client.First_Name, client.Last_Name].filter(Boolean).join(' ') || 'Client';
  const title = clientName + ' — ' + (job.Service || 'Supermom Service');

  // Build Date objects explicitly using numeric parts — avoids timezone string parsing edge cases
  const dateParts = job.Scheduled_Date.split('-').map(Number);
  const timeParts = job.Time.split(':').map(Number);
  if (dateParts.length < 3 || timeParts.length < 2) {
    Logger.log('CAL SYNC: Invalid date/time format — date=' + job.Scheduled_Date + ' time=' + job.Time);
    return;
  }
  const [yy, mo, dd] = dateParts;
  const [hh, mm]     = timeParts;
  const startTime    = new Date(yy, mo - 1, dd, hh, mm, 0);
  const durationHrs  = parseFloat(job.Duration_Estimate || job.Estimated_Hours || 1);
  const endTime      = new Date(startTime.getTime() + durationHrs * 3600000);

  Logger.log('CAL SYNC: Start=' + startTime + ' End=' + endTime + ' Duration=' + durationHrs + 'hrs');

  const loc = [client.Street, client.City, client.Province || 'ON']
    .filter(Boolean).join(', ');

  const desc = [
    'Client: ' + clientName,
    client.Phone       ? '📞 ' + client.Phone       : '',
    client.Access_Info ? '🔑 ' + client.Access_Info : '',
    job.Job_Notes      ? '📝 ' + job.Job_Notes      : '',
    '',
    'Job ID: ' + job.Job_ID,
    'Managed by Supermom for Hire',
  ].filter(Boolean).join('\n');

  let event = null;

  // Update existing event if we have the ID
  if (job.Event_ID) {
    Logger.log('CAL SYNC: Updating existing event ' + job.Event_ID);
    try {
      event = cal.getEventById(job.Event_ID);
      if (event) {
        event.setTitle(title);
        event.setTime(startTime, endTime);
        if (loc) event.setLocation(loc);
        event.setDescription(desc);
        Logger.log('CAL SYNC: Event updated successfully');
      }
    } catch(e) {
      Logger.log('CAL SYNC: Existing event fetch failed: ' + e.message + ' — will recreate');
      event = null;
    }
  }

  // Create new event if none exists or existing was deleted
  if (!event) {
    Logger.log('CAL SYNC: Creating new event');
    event = cal.createEvent(title, startTime, endTime, {
      location:    loc,
      description: desc,
    });
    updateRow(SHEET.JOBS, 'Job_ID', jobId, { Event_ID: event.getId() });
    Logger.log('CAL SYNC: ✅ New event created, ID=' + event.getId());
  } else {
    Logger.log('CAL SYNC: ✅ Existing event updated');
  }
}

// ── GET ALL DATA ─────────────────────────────────────────────

function getAllData() {
  const clients  = getObjects(SHEET.CLIENTS).filter(c => c.Is_Deleted !== 'TRUE');
  const jobs     = getObjects(SHEET.JOBS).filter(j => j.Is_Deleted !== 'TRUE');
  const payments = getObjects(SHEET.PAYMENTS).filter(p => p.Is_Void !== 'TRUE');

  const financials = getObjects(SHEET.INVOICES).map(inv => {
    const invPayments = payments.filter(p => p.Invoice_ID === inv.Invoice_ID);
    const totalPaid   = invPayments.reduce((s, p) => s + parseFloat(p.Amount || 0), 0);
    const isPaid      = totalPaid >= parseFloat(inv.Total_Amount || 0) - 0.01;
    const lastPmt     = invPayments.sort((a,b) =>
      b.Payment_Date.localeCompare(a.Payment_Date)
    )[0];
    return {
      Invoice_ID:     inv.Invoice_ID,
      Job_ID:         inv.Job_ID,
      Client_ID:      inv.Client_ID,
      Amount:         inv.Total_Amount,
      Status:         isPaid ? 'Paid' : 'Pending',
      Payment_Method: lastPmt ? lastPmt.Payment_Method : '',
      Paid_Date:      lastPmt ? lastPmt.Payment_Date   : '',
    };
  });

  const c = getConfig();
  let servicePrices = {};
  try { servicePrices = JSON.parse(c.service_prices || '{}'); } catch(e) {}

  // Batch-update all client computed stats (Total_Jobs, Total_Lifetime_Value, etc.)
  // Done here rather than per-mutation to keep writes fast and avoid cascading reads.
  try { updateAllClientStats(clients, jobs, payments); } catch(e) {
    Logger.log('updateAllClientStats failed: ' + e.message);
  }

  return {
    success: true,
    clients,
    jobs,
    financials,
    biz: {
      biz:            c.biz_name    || 'Supermom for Hire',
      owner:          c.owner_name  || '',
      rate:           parseFloat(c.hourly_rate || 50),
      hst_num:        c.hst_number  || '',
      tax_rate:       parseFloat(c.tax_rate    || 0.13),
      service_prices: servicePrices,
    },
    lists: {
      services:             getList('services'),
      referral_sources:     getList('referral_sources'),
      payment_methods:      getList('payment_methods'),
      prepaid_reasons:      getList('prepaid_reasons'),
      cancellation_reasons: getList('cancellation_reasons'),
    },
  };
}

// ── BUSINESS CONFIG ──────────────────────────────────────────

function updateBizConfig(p) {
  const s = sh(SHEET.CONFIG);
  if (!s) return { success: false, error: 'CONFIG sheet not found' };
  const raw = s.getDataRange().getValues();

  function setC(key, val) {
    for (let i = 1; i < raw.length; i++) {
      if (String(raw[i][0]) === key) { s.getRange(i + 1, 2).setValue(val); return; }
    }
    s.appendRow([key, val, 'settings', '99', '']);
  }

  if (p.biz           !== undefined) setC('biz_name',       p.biz);
  if (p.owner         !== undefined) setC('owner_name',      p.owner);
  if (p.rate          !== undefined) setC('hourly_rate',     p.rate);
  if (p.hst_num       !== undefined) setC('hst_number',      p.hst_num);
  if (p.tax_rate      !== undefined) setC('tax_rate',        p.tax_rate);
  if (p.calendar_id   !== undefined) setC('calendar_id',     p.calendar_id);
  if (p.service_prices !== undefined) setC('service_prices', JSON.stringify(p.service_prices));

  clearConfigCache();
  audit('UPDATE_CONFIG', '', '', '', 'biz_config', '', '', JSON.stringify(p));
  return { success: true };
}

// ── CLIENTS ──────────────────────────────────────────────────

function addClient(p) {
  const id = p.Client_ID || uid('CLI');

  if (getObjects(SHEET.CLIENTS).some(c => c.Client_ID === id)) {
    return { success: true, Client_ID: id, note: 'Duplicate caught' };
  }

  appendRow(SHEET.CLIENTS, {
    Client_ID:         id,
    First_Name:        p.First_Name        || '',
    Last_Name:         p.Last_Name         || '',
    Phone:             p.Phone             || '',
    Phone2:            p.Phone2            || '',
    Email:             p.Email             || '',
    Street:            p.Street            || '',
    City:              p.City              || 'Georgetown',
    Province:          p.Province          || 'ON',
    Postal_Code:       p.Postal_Code       || '',
    Status:            p.Status            || 'Lead',
    Referral_Source:   p.Referral_Source   || '',
    Family_Details:    p.Family_Details    || '',
    Access_Info:       p.Access_Info       || '',
    Global_Notes:      p.Global_Notes      || '',
    Preferred_Service: p.Preferred_Service || '',
    Preferred_Day:     p.Preferred_Day     || '',
    Preferred_Time:    p.Preferred_Time    || '',
    Total_Jobs:             '0',
    Total_Lifetime_Value:   '0.00',
    Created_Date:      p.Created_Date      || today(),
    Last_Modified_Date:     now(),
    Is_Deleted:             'FALSE',
  });

  audit('ADD_CLIENT', id, '', '', '', '', id,
    (p.First_Name || '') + ' ' + (p.Last_Name || ''));
  return { success: true, Client_ID: id };
}

function updateClient(p) {
  const before = getObjects(SHEET.CLIENTS).find(c => c.Client_ID === p.clientId);

  updateRow(SHEET.CLIENTS, 'Client_ID', p.clientId, {
    First_Name:        p.First_Name        || '',
    Last_Name:         p.Last_Name         || '',
    Phone:             p.Phone             || '',
    Phone2:            p.Phone2            || '',
    Email:             p.Email             || '',
    Street:            p.Street            || '',
    City:              p.City              || '',
    Postal_Code:       p.Postal_Code       || '',
    Status:            p.Status            || 'Active',
    Referral_Source:   p.Referral_Source   || '',
    Family_Details:    p.Family_Details    || '',
    Access_Info:       p.Access_Info       || '',
    Global_Notes:      p.Global_Notes      || '',
    Last_Modified_Date:     now(),
  });

  audit('UPDATE_CLIENT', p.clientId, '', '', 'profile',
    before ? before.Last_Name : '', p.Last_Name || '', '');
  return { success: true };
}

function updateClientField(p) {
  const before = getObjects(SHEET.CLIENTS).find(c => c.Client_ID === p.clientId);
  const oldVal = before ? before[p.field] : '';

  updateRow(SHEET.CLIENTS, 'Client_ID', p.clientId, {
    [p.field]:         p.value,
    Last_Modified_Date:now(),
  });

  audit('UPDATE_CLIENT_FIELD', p.clientId, '', '', p.field, oldVal, p.value, '');
  return { success: true };
}

function deleteClient(p) {
  const client = getObjects(SHEET.CLIENTS).find(c => c.Client_ID === p.clientId);

  updateRow(SHEET.CLIENTS, 'Client_ID', p.clientId, {
    Is_Deleted:        'TRUE',
    Last_Modified_Date:now(),
  });

  getObjects(SHEET.JOBS)
    .filter(j => j.Client_ID === p.clientId && j.Is_Deleted !== 'TRUE')
    .forEach(j => {
      updateRow(SHEET.JOBS, 'Job_ID', j.Job_ID, {
        Is_Deleted:        'TRUE',
        Last_Modified_Date:now(),
      });
      updateRow(SHEET.INVOICES, 'Job_ID', j.Job_ID, {
        Status:            'Void',
        Last_Modified_Date:now(),
      });
      if (j.Event_ID) {
        try {
          const cal = getCalendar();
          if (cal) cal.getEventById(j.Event_ID).deleteEvent();
        } catch(e) {}
      }
    });

  const name = client
    ? (client.First_Name + ' ' + client.Last_Name).trim()
    : p.clientId;
  audit('DELETE_CLIENT', p.clientId, '', '', '', name, 'DELETED', '');
  return { success: true };
}

// ── JOBS ─────────────────────────────────────────────────────

function addJob(p) {
  const jid   = p.Job_ID || uid('JOB');
  const invId = uid('INV');
  const c     = getConfig();

  if (getObjects(SHEET.JOBS).some(j => j.Job_ID === jid)) {
    return { success: true, Job_ID: jid, Invoice_ID: invId, note: 'Duplicate caught' };
  }

  appendRow(SHEET.JOBS, {
    Job_ID:                  jid,
    Client_ID:               p.Client_ID,
    Service:                 p.Service             || '',
    Original_Scheduled_Date: p.Scheduled_Date      || '',
    Scheduled_Date:          p.Scheduled_Date      || '',
    Time:                    p.Time                || '',
    Duration_Estimate:       p.Estimated_Hours     || '',
    Pricing_Type:            p.Pricing_Type        || 'Hourly',
    Hourly_Rate:             String(c.hourly_rate  || 50),
    Estimated_Hours:         p.Estimated_Hours     || '',
    Flat_Rate:               p.Flat_Rate           || '',
    Surcharge:               p.Surcharge           || '0',
    Subtotal:                p.Subtotal            || '0',
    HST_Rate:                String(c.tax_rate     || 0.13),
    HST_Amount:              p.HST                 || '0',
    Total_Amount:            p.Total_Amount        || '0',
    Job_Status:              'Scheduled',
    Payment_Status:          '',
    Scheduling_Type:         p.Scheduling_Type     || 'Hard Date',
    Follow_Up:               'No',
    Job_Notes:               p.Job_Notes           || '',
    Worker_ID:               p.Worker_ID           || whoami(),
    Created_Date:            p.Created_Date        || today(),
    Last_Modified_Date:      now(),
    Is_Deleted:              'FALSE',
  });

  appendRow(SHEET.INVOICES, {
    Invoice_ID:        invId,
    Job_ID:            jid,
    Client_ID:         p.Client_ID,
    Invoice_Date:      today(),
    Due_Date:          p.Scheduled_Date || today(),
    Subtotal:          p.Subtotal       || '0',
    HST_Rate:          String(c.tax_rate || 0.13),
    HST_Amount:        p.HST            || '0',
    Total_Amount:      p.Total_Amount   || '0',
    Status:            'Pending',
    Created_Date:      today(),
    Last_Modified_Date:now(),
  });

  updateRow(SHEET.CLIENTS, 'Client_ID', p.Client_ID, {
    Status:            'Active',
    Last_Modified_Date:now(),
  });

  audit('ADD_JOB', p.Client_ID, jid, '', '', '', jid,
    (p.Service || '') + ' on ' + (p.Scheduled_Date || 'ASAP'));

  return { success: true, Job_ID: jid, Invoice_ID: invId, _syncCalendar: jid };
}

function updateJobDetails(p) {
  const u = { Last_Modified_Date: now() };

  if (p.svc         !== undefined) u.Service           = p.svc;
  if (p.time        !== undefined) u.Time              = p.time;
  if (p.notes       !== undefined) u.Job_Notes         = p.notes;
  if (p.comp        !== undefined) u.Completion_Notes  = p.comp;
  if (p.photos      !== undefined) u.Photo_Links       = p.photos;
  if (p.revStatus   !== undefined) u.Review_Status     = p.revStatus;
  if (p.followUp    !== undefined) u.Follow_Up         = p.followUp;
  if (p.actualHours !== undefined) u.Actual_Duration   = p.actualHours;
  if (p.workerId    !== undefined) u.Worker_ID         = p.workerId;
  if (p.eventId     !== undefined) u.Event_ID          = p.eventId;

  if (p.date !== undefined) {
    // Track reschedule count — useful for AppSheet reporting and audit
    const existingJob = getObjects(SHEET.JOBS).find(x => x.Job_ID === p.jobId);
    if (existingJob && existingJob.Scheduled_Date && existingJob.Scheduled_Date !== p.date) {
      const count = parseInt(existingJob.Rescheduled_Count || '0') + 1;
      u.Rescheduled_Count = String(count);
      if (p.rescheduleReason) u.Reschedule_Reason = p.rescheduleReason;
      audit('RESCHEDULE_JOB', existingJob.Client_ID, p.jobId, '', 'Scheduled_Date',
        existingJob.Scheduled_Date, p.date, 'Reschedule #' + count);
    }
    u.Scheduled_Date    = p.date;
    u.Duration_Estimate = p.estimatedHours || (existingJob ? existingJob.Duration_Estimate : '') || '';
    updateRow(SHEET.INVOICES, 'Job_ID', p.jobId, {
      Due_Date:          p.date,
      Last_Modified_Date:now(),
    });
  }

  if (p.additionalCost !== undefined && parseFloat(p.additionalCost) > 0) {
    u.Additional_Cost       = String(p.additionalCost);
    u.Additional_Cost_Notes = p.additionalCostNotes || '';
  }

  if (p.actualHours !== undefined || p.additionalCost !== undefined) {
    const job = getObjects(SHEET.JOBS).find(x => x.Job_ID === p.jobId);
    if (job && job.Job_Status === 'Completed') {
      const cfg    = getConfig();
      const tax    = parseFloat(cfg.tax_rate || 0.13);
      const rate   = parseFloat(job.Hourly_Rate || cfg.hourly_rate || 50);
      const addCst = p.additionalCost !== undefined
        ? parseFloat(p.additionalCost)
        : parseFloat(job.Additional_Cost || 0);
      const labour = job.Pricing_Type === 'Hourly'
        ? (parseFloat(p.actualHours) || parseFloat(job.Actual_Duration) || parseFloat(job.Estimated_Hours) || 0) * rate
        : parseFloat(job.Flat_Rate || 0);
      const sub    = labour + parseFloat(job.Surcharge || 0) + addCst;
      const hst    = sub * tax;
      const tot    = sub + hst;

      u.Subtotal     = sub.toFixed(2);
      u.HST_Amount   = hst.toFixed(2);
      u.Total_Amount = tot.toFixed(2);

      updateRow(SHEET.INVOICES, 'Job_ID', p.jobId, {
        Subtotal:          sub.toFixed(2),
        HST_Amount:        hst.toFixed(2),
        Additional_Cost:   addCst > 0 ? String(addCst) : '',
        Total_Amount:      tot.toFixed(2),
        Status:            job.Payment_Status === 'Paid' ? 'Paid' : 'Pending',
        Last_Modified_Date:now(),
      });
    }
  }

  updateRow(SHEET.JOBS, 'Job_ID', p.jobId, u);

  if (p.markPaid) {
    const job = getObjects(SHEET.JOBS).find(x => x.Job_ID === p.jobId);
    if (job) {
      updateRow(SHEET.JOBS, 'Job_ID', p.jobId, {
        Payment_Status:    'Paid',
        Payment_Method:    p.method || '',
      });
      const inv = getObjects(SHEET.INVOICES).find(i => i.Job_ID === p.jobId);
      if (inv) updateRow(SHEET.INVOICES, 'Job_ID', p.jobId, {
        Status:            'Paid',
        Last_Modified_Date:now(),
      });
      appendRow(SHEET.PAYMENTS, {
        Payment_ID:     uid('PMT'),
        Invoice_ID:     inv ? inv.Invoice_ID : '',
        Job_ID:         p.jobId,
        Client_ID:      job.Client_ID,
        Payment_Type:   'Full',
        Amount:         job.Total_Amount,
        Payment_Method: p.method || '',
        Payment_Date:   today(),
        Recorded_Date:  now(),
        Recorded_By:    whoami(),
        Is_Void:        'FALSE',
      });
      recalcClientStats(job.Client_ID);
      audit('MARK_PAID', job.Client_ID, p.jobId, '', 'Payment_Status',
        'Unpaid', 'Paid', p.method || '');
    }
  }

  audit('UPDATE_JOB', '', p.jobId, '', Object.keys(u).join(','), '', '', '');
  return { success: true, _syncCalendar: p.jobId };
}

function markJobComplete(p) {
  const job = getObjects(SHEET.JOBS).find(x => x.Job_ID === p.jobId);
  if (!job) return { success: false, error: 'Job not found' };

  const cfg    = getConfig();
  const tax    = parseFloat(cfg.tax_rate || 0.13);
  const rate   = parseFloat(job.Hourly_Rate || cfg.hourly_rate || 50);
  const labour = job.Pricing_Type === 'Hourly'
    ? (parseFloat(p.actualHours) || parseFloat(job.Estimated_Hours) || 0) * rate
    : parseFloat(job.Flat_Rate || 0);
  const sub    = labour + parseFloat(job.Surcharge || 0) + parseFloat(p.additionalCost || 0);
  const hst    = sub * tax;
  const tot    = sub + hst;

  const u = {
    Job_Status:        'Completed',
    Completion_Date:   today(),
    Actual_Duration:   p.actualHours        || '',
    Completion_Notes:  p.notes              || '',
    Photo_Links:       p.photos             || '',
    Follow_Up:         p.followUp           || 'No',
    Total_Amount:      tot.toFixed(2),
    HST_Amount:        hst.toFixed(2),
    Subtotal:          sub.toFixed(2),
    Last_Modified_Date:now(),
  };

  if (parseFloat(p.additionalCost || 0) > 0) {
    u.Additional_Cost       = String(p.additionalCost);
    u.Additional_Cost_Notes = p.additionalCostNotes || '';
  }
  if (p.reqRev) u.Review_Status = 'Pending';
  if (p.markPaid || p.paymentStatus === 'Paid') {
    u.Payment_Status = 'Paid';
    u.Payment_Method = p.method || '';
  }

  updateRow(SHEET.JOBS, 'Job_ID', p.jobId, u);
  updateRow(SHEET.INVOICES, 'Job_ID', p.jobId, {
    Total_Amount:      tot.toFixed(2),
    HST_Amount:        hst.toFixed(2),
    Subtotal:          sub.toFixed(2),
    Status:            u.Payment_Status === 'Paid' ? 'Paid' : 'Pending',
    Last_Modified_Date:now(),
  });

  if (u.Payment_Status === 'Paid') {
    const prePaid = parseFloat(job.PrePaid_Amount || 0);
    const inv     = getObjects(SHEET.INVOICES).find(i => i.Job_ID === p.jobId);
    const pmtType = (job.Payment_Status === 'Partial' && prePaid > 0) ? 'Final' : 'Full';
    const pmtAmt  = pmtType === 'Final'
      ? Math.max(0, tot - prePaid).toFixed(2)
      : tot.toFixed(2);

    appendRow(SHEET.PAYMENTS, {
      Payment_ID:     uid('PMT'),
      Invoice_ID:     inv ? inv.Invoice_ID : '',
      Job_ID:         p.jobId,
      Client_ID:      job.Client_ID,
      Payment_Type:   pmtType,
      Amount:         pmtAmt,
      Payment_Method: p.method || '',
      Payment_Date:   today(),
      Recorded_Date:  now(),
      Recorded_By:    whoami(),
      Is_Void:        'FALSE',
    });
    audit('PAYMENT_RECEIVED', job.Client_ID, p.jobId, '', 'Payment',
      '0', pmtAmt, p.method || '');
  }

  recalcClientStats(job.Client_ID);
  audit('COMPLETE_JOB', job.Client_ID, p.jobId, '', 'Job_Status',
    'Scheduled', 'Completed', 'Hours: ' + (p.actualHours || '?'));

  return { success: true };
}

function markInvoicePaid(p) {
  const job = getObjects(SHEET.JOBS).find(x => x.Job_ID === p.jobId);
  if (!job) return { success: false, error: 'Job not found' };

  const inv   = getObjects(SHEET.INVOICES).find(i => i.Job_ID === p.jobId);
  const ppAmt = parseFloat(p.ppAmt || 0);
  const tot   = parseFloat(job.Total_Amount || 0);

  if (ppAmt > 0 && ppAmt < tot) {
    updateRow(SHEET.JOBS, 'Job_ID', p.jobId, {
      Payment_Status:    'Partial',
      PrePaid_Amount:    String(ppAmt),
      PrePaid_Reason:    p.ppReason    || '',
      Payment_Method:    p.method      || '',
      Last_Modified_Date:now(),
    });
    appendRow(SHEET.PAYMENTS, {
      Payment_ID:     uid('PMT'),
      Invoice_ID:     inv ? inv.Invoice_ID : '',
      Job_ID:         p.jobId,
      Client_ID:      job.Client_ID,
      Payment_Type:   'Prepayment',
      Amount:         ppAmt.toFixed(2),
      Payment_Method: p.method   || '',
      Payment_Date:   today(),
      Recorded_Date:  now(),
      Notes:          p.ppReason || '',
      Recorded_By:    whoami(),
      Is_Void:        'FALSE',
    });
    audit('PREPAYMENT', job.Client_ID, p.jobId, '', 'Payment_Status',
      '', 'Partial', ppAmt.toFixed(2) + ' via ' + (p.method || ''));
  } else {
    updateRow(SHEET.JOBS, 'Job_ID', p.jobId, {
      Payment_Status:    'Paid',
      Payment_Method:    p.method || '',
      Last_Modified_Date:now(),
    });
    updateRow(SHEET.INVOICES, 'Job_ID', p.jobId, {
      Status:            'Paid',
      Last_Modified_Date:now(),
    });
    appendRow(SHEET.PAYMENTS, {
      Payment_ID:     uid('PMT'),
      Invoice_ID:     inv ? inv.Invoice_ID : '',
      Job_ID:         p.jobId,
      Client_ID:      job.Client_ID,
      Payment_Type:   'Full',
      Amount:         tot.toFixed(2),
      Payment_Method: p.method || '',
      Payment_Date:   today(),
      Recorded_Date:  now(),
      Recorded_By:    whoami(),
      Is_Void:        'FALSE',
    });
    audit('PAYMENT_RECEIVED', job.Client_ID, p.jobId, '', 'Payment_Status',
      '', 'Paid', tot.toFixed(2) + ' via ' + (p.method || ''));
  }

  recalcClientStats(job.Client_ID);
  return { success: true };
}

function deleteJob(p) {
  const job = getObjects(SHEET.JOBS).find(j => j.Job_ID === p.jobId);

  updateRow(SHEET.JOBS, 'Job_ID', p.jobId, {
    Is_Deleted:        'TRUE',
    Last_Modified_Date:now(),
  });
  updateRow(SHEET.INVOICES, 'Job_ID', p.jobId, {
    Status:            'Void',
    Last_Modified_Date:now(),
  });

  if (job && job.Event_ID) {
    try {
      const cal = getCalendar();
      if (cal) cal.getEventById(job.Event_ID).deleteEvent();
    } catch(e) {}
  }

  audit('DELETE_JOB', job ? job.Client_ID : '', p.jobId, '', '', '', 'DELETED', '');
  return { success: true };
}

function cancelJob(p) {
  const job = getObjects(SHEET.JOBS).find(j => j.Job_ID === p.jobId);
  if (!job) return { success: false, error: 'Job not found' };

  updateRow(SHEET.JOBS, 'Job_ID', p.jobId, {
    Job_Status:          'Cancelled',
    Cancellation_Date:   today(),
    Cancellation_Reason: p.reason || '',
    Last_Modified_Date:  now(),
  });

  updateRow(SHEET.INVOICES, 'Job_ID', p.jobId, {
    Status:            'Void',
    Last_Modified_Date:now(),
  });

  if (job.Event_ID) {
    try {
      const cal = getCalendar();
      if (cal) {
        cal.getEventById(job.Event_ID).deleteEvent();
        updateRow(SHEET.JOBS, 'Job_ID', p.jobId, { Event_ID: '' });
      }
    } catch(e) {}
  }

  audit('CANCEL_JOB', job.Client_ID, p.jobId, '', 'Job_Status',
    'Scheduled', 'Cancelled', p.reason || '');
  return { success: true };
}

// ── PAYMENT HELPER ───────────────────────────────────────────
// Single function for all payment writes — avoids duplicated appendRow blocks.

function recordPayment(jobId, clientId, invoiceId, method, amount, type, notes) {
  appendRow(SHEET.PAYMENTS, {
    Payment_ID:     uid('PMT'),
    Invoice_ID:     invoiceId  || '',
    Job_ID:         jobId      || '',
    Client_ID:      clientId   || '',
    Payment_Type:   type       || 'Full',
    Amount:         String(amount || 0),
    Payment_Method: method     || '',
    Payment_Date:   today(),
    Recorded_Date:  now(),
    Notes:          notes      || '',
    Recorded_By:    whoami(),
    Is_Void:        'FALSE',
    Void_Date:      '',
    Void_Reason:    '',
  });
}

// ── LISTS ────────────────────────────────────────────────────

function updateList(p) {
  const s = sh(SHEET.CONFIG);
  if (!s) return { success: false };
  const raw   = s.getDataRange().getValues();
  const toDel = [];

  for (let i = raw.length - 1; i >= 1; i--) {
    if (String(raw[i][2]) === p.listKey) toDel.push(i + 1);
  }
  toDel.forEach(r => s.deleteRow(r));

  if (p.list && p.list.length > 0) {
    const rows = p.list.map((item, idx) => [
      p.listKey + '_' + idx, item, p.listKey, String(idx), '',
    ]);
    s.getRange(s.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  }

  clearConfigCache();
  audit('UPDATE_LIST', '', '', '', p.listKey, '', (p.list || []).join(','), '');
  return { success: true };
}

// ── SETUP ────────────────────────────────────────────────────
// Run once manually from the Apps Script editor after first deployment.
// Safe to re-run — only creates sheets that don't already exist.
// After running: Deploy → New Deployment → Web App → Execute as Me → Anyone

function setupSpreadsheet() {
  const ssApp = ss();

  const defs = {
    [SHEET.CONFIG]: [
      'Key','Value','Category','Sort_Order','Notes',
    ],
    [SHEET.CLIENTS]: [
      'Client_ID','First_Name','Last_Name','Phone','Phone2','Email',
      'Street','City','Province','Postal_Code','Status','Referral_Source',
      'Family_Details','Access_Info','Global_Notes',
      'Preferred_Service','Preferred_Day','Preferred_Time',
      'First_Service_Date','Last_Service_Date',
      'Total_Jobs','Total_Lifetime_Value',
      'Created_Date','Last_Modified_Date','Notes_Updated_Date','Is_Deleted',
    ],
    [SHEET.JOBS]: [
      'Job_ID','Client_ID','Service',
      'Original_Scheduled_Date','Scheduled_Date','Completion_Date','Time',
      'Duration_Estimate','Actual_Duration',
      'Pricing_Type','Hourly_Rate','Estimated_Hours','Flat_Rate','Surcharge',
      'Subtotal','HST_Rate','HST_Amount','Additional_Cost','Additional_Cost_Notes',
      'Total_Amount',
      'Job_Status','Payment_Status','Payment_Method','PrePaid_Amount','PrePaid_Reason',
      'Scheduling_Type','Follow_Up','Follow_Up_Notes','Job_Notes','Completion_Notes',
      'Photo_Links','Review_Status','Review_Notes',
      'Rescheduled_Count','Reschedule_Reason',
      'Cancellation_Date','Cancellation_Reason',
      'Worker_ID','Event_ID',
      'Created_Date','Last_Modified_Date','Is_Deleted',
    ],
    [SHEET.INVOICES]: [
      'Invoice_ID','Job_ID','Client_ID','Invoice_Date','Due_Date',
      'Subtotal','HST_Rate','HST_Amount','Additional_Cost','Total_Amount',
      'Status','Notes','Created_Date','Last_Modified_Date',
    ],
    [SHEET.PAYMENTS]: [
      'Payment_ID','Invoice_ID','Job_ID','Client_ID',
      'Payment_Type','Amount','Payment_Method','Payment_Date',
      'Recorded_Date','Notes','Recorded_By','Is_Void','Void_Date','Void_Reason',
    ],
    [SHEET.AUDIT]: [
      'Log_ID','Timestamp','Client_ID','Job_ID','Payment_ID',
      'Action','Entity','Changed_Field','Old_Value','New_Value',
      'Source','Worker_ID','Session_ID','Notes',
    ],
    [SHEET.WORKERS]: [
      'Worker_ID','First_Name','Last_Name','Email','Phone',
      'Role','Hourly_Rate','Status','Created_Date',
    ],
  };

  Object.entries(defs).forEach(([name, headers]) => {
    let sheet = ssApp.getSheetByName(name);

    if (!sheet) {
      // Sheet doesn't exist — create it fresh with all headers
      sheet = ssApp.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length)
        .setValues([headers])
        .setFontWeight('bold')
        .setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
      Logger.log('CREATED: ' + name + ' (' + headers.length + ' columns)');

    } else {
      // Sheet exists — find which columns are missing and append to the right
      const lastCol = sheet.getLastColumn();
      const existingHeaders = lastCol > 0
        ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String).map(h => h.trim())
        : [];

      const missing = headers.filter(h => !existingHeaders.includes(h));

      if (missing.length === 0) {
        Logger.log('OK: ' + name + ' — all ' + headers.length + ' columns present');
      } else {
        // Append each missing column to the right of existing data
        let nextCol = existingHeaders.length + 1;
        missing.forEach(h => {
          sheet.getRange(1, nextCol)
            .setValue(h)
            .setFontWeight('bold')
            .setBackground('#f3f3f3');
          nextCol++;
        });
        Logger.log('UPDATED: ' + name + ' — added ' + missing.length + ' column(s): ' + missing.join(', '));
      }

      // Ensure header row styling and freeze are applied regardless
      sheet.getRange(1, 1, 1, sheet.getLastColumn())
        .setFontWeight('bold')
        .setBackground('#f3f3f3');
      if (sheet.getFrozenRows() === 0) sheet.setFrozenRows(1);
    }
  });

  // Seed default CONFIG values if not already present
  const configSheet   = ssApp.getSheetByName(SHEET.CONFIG);
  const existingKeys  = configSheet.getDataRange().getValues().slice(1).map(r => String(r[0]));
  const defaults = [
    // Settings
    ['biz_name',         'Supermom for Hire',  'settings',         '1', 'Business display name'],
    ['owner_name',       'Sandra',             'settings',         '2', 'Owner first name'],
    ['hourly_rate',      '50',                 'settings',         '3', 'Default hourly rate CAD'],
    ['hst_number',       '',                   'settings',         '4', 'HST registration number'],
    ['tax_rate',         '0.13',               'settings',         '5', 'Ontario HST — 13% = 0.13'],
    ['calendar_id',      '',                   'settings',         '6', 'Google Calendar ID for job sync'],
    ['service_prices',   '{}',                 'settings',         '7', 'JSON map of service name to default price'],
    // Services
    ['svc_1', 'Regular Clean',     'services',            '1', ''],
    ['svc_2', 'Deep Clean',        'services',            '2', ''],
    ['svc_3', 'Move In/Out Clean', 'services',            '3', ''],
    ['svc_4', 'Post-Reno Clean',   'services',            '4', ''],
    ['svc_5', 'Office Clean',      'services',            '5', ''],
    // Referral sources
    ['ref_1', 'Word of Mouth',     'referral_sources',    '1', ''],
    ['ref_2', 'Google Search',     'referral_sources',    '2', ''],
    ['ref_3', 'Facebook',          'referral_sources',    '3', ''],
    ['ref_4', 'Kijiji',            'referral_sources',    '4', ''],
    ['ref_5', 'Neighbour Referral','referral_sources',    '5', ''],
    ['ref_6', 'Returning Client',  'referral_sources',    '6', ''],
    // Payment methods
    ['pay_1', 'E-Transfer',        'payment_methods',     '1', ''],
    ['pay_2', 'Cash',              'payment_methods',     '2', ''],
    ['pay_3', 'Credit Card',       'payment_methods',     '3', ''],
    ['pay_4', 'Cheque',            'payment_methods',     '4', ''],
    // Pre-pay reasons
    ['pre_1', 'Deposit',           'prepaid_reasons',     '1', ''],
    ['pre_2', 'Materials',         'prepaid_reasons',     '2', ''],
    ['pre_3', 'Full Pre-Payment',  'prepaid_reasons',     '3', ''],
    // Cancellation reasons
    ['can_1', 'Client Cancelled',  'cancellation_reasons','1', ''],
    ['can_2', 'Rescheduled',       'cancellation_reasons','2', ''],
    ['can_3', 'No Show',           'cancellation_reasons','3', ''],
    ['can_4', 'Weather',           'cancellation_reasons','4', ''],
    ['can_5', 'Emergency',         'cancellation_reasons','5', ''],
  ];
  defaults.forEach(row => {
    if (!existingKeys.includes(row[0])) configSheet.appendRow(row);
  });

  // Seed 06_WORKERS with Sandra if empty
  const wkSheet = ssApp.getSheetByName(SHEET.WORKERS);
  if (wkSheet && wkSheet.getLastRow() <= 1) {
    wkSheet.appendRow(['W001','Sandra','','','','Owner','50','Active',today()]);
    Logger.log('Seeded 06_WORKERS with Sandra');
  }

  Logger.log('');
  Logger.log('✅ Setup complete. Next steps:');
  Logger.log('   1. Deploy → New Deployment → Web App → Execute as Me → Anyone');
  Logger.log('   2. To enable calendar sync:');
  Logger.log('      a. Sandra shares her Google Calendar with: ' + whoami());
  Logger.log('      b. She copies her Calendar ID from calendar settings');
  Logger.log('      c. Paste it into 00_CONFIG row calendar_id');
  Logger.log('      d. Run syncToCalendar("test") here to authorize Calendar access');
}
