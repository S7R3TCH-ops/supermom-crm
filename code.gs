/**
 * SUPERMOM FOR HIRE — Backend Core v4.98
 * Fixes from audit:
 *   - Added missing: deleteClient, updateClientField, getRowById
 *   - Added missing switch cases: updateClientField, updateList
 *   - Fixed getRows() to use formatVal() instead of raw .toISOString()
 *   - Fixed updateBizConfig() key names to match frontend expectations
 *   - Removed dead getSyncData() reference to TABS.WORKERS
 */

const TZ = 'America/Toronto';
const LOCK_TIMEOUT = 15000;
const SS = SpreadsheetApp.getActiveSpreadsheet();

const TABS = {
  CONFIG:   '00_CONFIG',
  CLIENTS:  '01_CLIENTS',
  JOBS:     '02_JOBS',
  INVOICES: '03_INVOICES',
  PAYMENTS: '04_PAYMENTS',
  AUDIT:    '05_AUDIT_LOG'
};

function doGet(e) {
  // If a payload param is present, this is a data request from gasCall — handle it
  // NOTE: No script lock on GET — locks hang indefinitely on GET requests in GAS.
  // Solo operator so concurrent write conflicts are not a real concern.
  if (e && e.parameter && e.parameter.payload) {
    try {
      const payload = JSON.parse(e.parameter.payload);
      if (!payload || !payload.action) return res({ success: false, error: 'No action' });
      let result = { success: false };
      switch (payload.action) {
        case 'getAllData':         result = getAllData();                  break;
        case 'addClient':         result = addClient(payload);            break;
        case 'updateClient':      result = updateClient(payload);         break;
        case 'updateClientField': result = updateClientField(payload);    break;
        case 'deleteClient':      result = deleteClient(payload);         break;
        case 'addJob':            result = addJob(payload);               break;
        case 'updateJobDetails':  result = updateJobDetails(payload);     break;
        case 'markJobComplete':   result = markJobComplete(payload);      break;
        case 'markInvoicePaid':   result = markInvoicePaid(payload);      break;
        case 'deleteJob':         result = deleteJob(payload);            break;
        case 'updateList':        result = updateList(payload);           break;
        case 'updateBizConfig':   result = updateBizConfig(payload);      break;
        case 'uploadLogo':          result = uploadLogo(payload);             break;
        case 'cascadeDeleteClient': result = cascadeDeleteClient(payload);    break;
        default: result = { success: false, error: 'Unknown action: ' + payload.action };
      }
      return res(result);
    } catch (err) {
      return res({ success: false, error: err.toString() });
    }
  }

  // No payload — serve the HTML page
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Supermom for Hire')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(LOCK_TIMEOUT)) return res({ success: false, error: "Lock timeout" });

    // Accept payload from POST body or URL param fallback
    let payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.payload) {
      payload = JSON.parse(e.parameter.payload);
    }

    if (!payload || !payload.action) return res({ success: false, error: "No action" });

    const action = payload.action;
    let result = { success: false };

    switch (action) {
      case 'getAllData':        result = getAllData();              break;
      case 'addClient':        result = addClient(payload);        break;
      case 'updateClient':     result = updateClient(payload);     break;
      case 'updateClientField':result = updateClientField(payload);break;
      case 'deleteClient':     result = deleteClient(payload);     break;
      case 'addJob':           result = addJob(payload);           break;
      case 'updateJobDetails': result = updateJobDetails(payload); break;
      case 'markJobComplete':  result = markJobComplete(payload);  break;
      case 'markInvoicePaid':  result = markInvoicePaid(payload);  break;
      case 'deleteJob':        result = deleteJob(payload);        break;
      case 'updateList':       result = updateList(payload);       break;
      case 'updateBizConfig':  result = updateBizConfig(payload);  break;
      case 'uploadLogo':           result = uploadLogo(payload);             break;
      case 'cascadeDeleteClient':  result = cascadeDeleteClient(payload);    break;
      default: result = { success: false, error: "Unknown action: " + action };
    }
    return res(result);
  } catch (err) {
    return res({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function res(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── DATA ENGINE ──────────────────────────────────────────────

function getAllData() {
  const config = getRows(TABS.CONFIG);
  const clients = getRows(TABS.CLIENTS).filter(r => String(r.Is_Deleted).toUpperCase() !== 'TRUE');
  const jobs    = getRows(TABS.JOBS).filter(r => String(r.Is_Deleted).toUpperCase() !== 'TRUE');
  const payments = getRows(TABS.PAYMENTS).filter(r => String(r.Is_Void).toUpperCase() !== 'TRUE');

  const biz   = {};
  const lists = {};

  config.forEach(row => {
    if (row.Category === 'settings') {
      biz[row.Key] = row.Value;
    } else {
      if (!lists[row.Category]) lists[row.Category] = [];
      lists[row.Category].push(row.Value);
    }
  });

  // FIX: remap sheet key names to what the frontend expects
  // Sheet stores: biz_name, owner_name, hourly_rate, hst_number
  // Frontend expects: biz, owner, rate, hst_num
  const bizMapped = {
    biz:         biz['biz_name']    || biz['biz']    || '',
    owner:       biz['owner_name']  || biz['owner']  || '',
    rate:        parseFloat(biz['hourly_rate'] || biz['rate'] || 50),
    hst_num:     biz['hst_number']  || biz['hst_num'] || '',
    tax_rate:    parseFloat(biz['tax_rate'] || 0.13),
    tax_enabled: biz['tax_enabled'] || 'FALSE',
    logo:        biz['logo']        || '',
    service_prices: (() => {
      try { return JSON.parse(biz['service_prices'] || '{}'); } catch(e) { return {}; }
    })()
  };

  const financials = jobs.map(j => {
    const jobPayments = payments.filter(p => String(p.Job_ID).trim() === String(j.Job_ID).trim());
    const paidSum     = jobPayments.reduce((sum, p) => sum + parseFloat(p.Amount || 0), 0);
    const totalAmount = parseFloat(j.Total_Amount || 0);

    let status = 'Pending';
    if (paidSum >= (totalAmount - 0.01) && totalAmount > 0) status = 'Paid';
    else if (paidSum > 0) status = 'Partial';

    return {
      Job_ID:         j.Job_ID,
      Client_ID:      j.Client_ID,
      Amount:         totalAmount,
      Status:         status,
      Paid_Date:      jobPayments.length ? jobPayments[0].Payment_Date : '',
      Payment_Method: jobPayments.length ? jobPayments[0].Payment_Method : ''
    };
  });

  return { success: true, clients, jobs, financials, lists, biz: bizMapped };
}

// ── CRUD LOGIC ───────────────────────────────────────────────

function addClient(p) {
  const id = p.Client_ID || 'C-' + Date.now();
  p.Client_ID  = id;
  p.Is_Deleted = 'FALSE';
  appendRow(TABS.CLIENTS, p);
  return { success: true, Client_ID: id };
}

function updateClient(p) {
  updateRow(TABS.CLIENTS, 'Client_ID', p.clientId || p.Client_ID, p);
  return { success: true };
}

// FIX: was missing entirely
function updateClientField(p) {
  const update = {};
  update[p.field] = p.value;
  updateRow(TABS.CLIENTS, 'Client_ID', p.clientId, update);
  return { success: true };
}

// FIX: was missing entirely
function deleteClient(p) {
  updateRow(TABS.CLIENTS, 'Client_ID', p.clientId, { Is_Deleted: 'TRUE' });
  return { success: true };
}

function addJob(p) {
  const id = p.Job_ID || 'J-' + Date.now();
  p.Job_ID     = id;
  p.Is_Deleted = 'FALSE';
  appendRow(TABS.JOBS, p);
  return { success: true, Job_ID: id };
}

function updateJobDetails(p) {
  const id = p.jobId || p.Job_ID;
  const raw = {
    Service:          p.svc,
    Scheduled_Date:   p.date,
    Time:             p.time,
    Job_Notes:        p.notes,
    Completion_Notes: p.comp,
    Actual_Duration:  p.hrs,
    Estimated_Hours:  p.estimatedHours,
    Pricing_Type:     p.pricingType,
    Flat_Rate:        p.flatRate,
    Surcharge:        p.surcharge,
    Additional_Cost:        p.additionalCost,
    Additional_Cost_Notes:  p.additionalCostNotes,
    Total_Amount:           p.totalAmount,
    Review_Status:          p.revStatus,
    Follow_Up:              p.followUp
  };
  // Only write keys that were actually sent — prevents partial calls
  // (e.g. clearFU, markRevRequested) from blanking unrelated columns
  const update = {};
  for (const k in raw) { if (raw[k] !== undefined) update[k] = raw[k]; }
  updateRow(TABS.JOBS, 'Job_ID', id, update);
  if (p.markPaid) markInvoicePaid({ jobId: id, method: p.method, ppAmt: p.totalAmount });
  return { success: true };
}

function markJobComplete(p) {
  // totalAmount always sent by frontend (calculated from actual hours/rate/surcharge/addCost).
  // Trusting frontend value — same pattern as updateJobDetails.
  const existingJob = getRowById(TABS.JOBS, 'Job_ID', p.jobId);
  const update = {
    Job_Status:            'Completed',
    Completion_Date:       new Date().toISOString().split('T')[0],
    Actual_Duration:       p.actualHours,
    Completion_Notes:      p.notes,
    Photo_Links:           p.photos,
    Follow_Up:             p.followUp,
    Review_Status:         p.reqRev ? 'Pending' : '',
    Surcharge:             p.surcharge,
    Additional_Cost:       p.additionalCost,
    Additional_Cost_Notes: p.additionalCostNotes,
    Total_Amount:          p.totalAmount
  };
  updateRow(TABS.JOBS, 'Job_ID', p.jobId, update);
  if (p.markPaid) {
    markInvoicePaid({ jobId: p.jobId, method: p.method, ppAmt: p.totalAmount });
  } else if (parseFloat(p.additionalCost) > 0 && existingJob && existingJob.Payment_Status === 'Paid') {
    // Job was already fully paid; additional cost (e.g. tip) added at completion — record a payment for the delta
    appendRow(TABS.PAYMENTS, {
      Payment_ID:     uid('PAY'),
      Job_ID:         p.jobId,
      Client_ID:      existingJob.Client_ID,
      Amount:         parseFloat(p.additionalCost),
      Payment_Method: existingJob.Payment_Method || 'Cash',
      Payment_Date:   new Date().toISOString().split('T')[0],
      Recorded_Date:  new Date().toISOString().split('T')[0]
    });
  }
  return { success: true };
}

function markInvoicePaid(p) {
  const job = getRowById(TABS.JOBS, 'Job_ID', p.jobId);
  if (!job) return { success: false, error: 'Job not found: ' + p.jobId };

  const totalAmt = parseFloat(job.Total_Amount) || 0;
  const paidAmt  = parseFloat(p.ppAmt) || totalAmt;
  const isPartial = paidAmt > 0 && paidAmt < (totalAmt - 0.01);

  const payment = {
    Payment_ID:     uid('PAY'),
    Job_ID:         p.jobId,
    Client_ID:      job.Client_ID,
    Amount:         paidAmt,
    Payment_Method: p.method || 'Cash',
    Payment_Date:   new Date().toISOString().split('T')[0],
    Recorded_Date:  new Date().toISOString().split('T')[0]
  };
  appendRow(TABS.PAYMENTS, payment);

  // Update job row: partial pre-pay vs full paid
  const jobUpdate = {
    Payment_Status: isPartial ? 'Partial' : 'Paid',
    Payment_Method: p.method || 'Cash'
  };
  if (isPartial) {
    jobUpdate.PrePaid_Amount = paidAmt;
    if (p.ppReason) jobUpdate.PrePaid_Reason = p.ppReason;
  }
  updateRow(TABS.JOBS, 'Job_ID', p.jobId, jobUpdate);
  return { success: true };
}

function deleteJob(p) {
  updateRow(TABS.JOBS, 'Job_ID', p.jobId, { Is_Deleted: 'TRUE' });
  return { success: true };
}

function cascadeDeleteClient(p) {
  const clientId = p.clientId || p.Client_ID;
  if (!clientId) return { success: false, error: 'No clientId provided' };

  // Soft-delete client
  updateRow(TABS.CLIENTS, 'Client_ID', clientId, { Is_Deleted: 'TRUE' });

  // Soft-delete all jobs for this client
  softDeleteAllByClientId(TABS.JOBS,     { Is_Deleted: 'TRUE' }, clientId);

  // Soft-delete all invoices for this client (Is_Deleted column, added for future-proofing)
  softDeleteAllByClientId(TABS.INVOICES, { Is_Deleted: 'TRUE' }, clientId);

  // Void all payments for this client (PAYMENTS uses Is_Void, not Is_Deleted)
  softDeleteAllByClientId(TABS.PAYMENTS, { Is_Void: 'TRUE' },    clientId);

  return { success: true };
}

// Walk every row in tabName and apply updateObj to any row whose Client_ID matches
function softDeleteAllByClientId(tabName, updateObj, clientId) {
  const sheet   = SS.getSheetByName(tabName);
  if (!sheet) return;
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const cidIdx  = headers.indexOf('Client_ID');
  if (cidIdx === -1) return;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cidIdx]).trim() !== String(clientId).trim()) continue;
    for (const key in updateObj) {
      const cIdx = headers.indexOf(key);
      if (cIdx > -1) sheet.getRange(i + 1, cIdx + 1).setValue(updateObj[key]);
    }
  }
}

function updateList(p) {
  const sheet = SS.getSheetByName(TABS.CONFIG);
  const data  = sheet.getDataRange().getValues();
  // Delete existing rows for this list key (walk backwards to preserve row indices)
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][2] === p.listKey) sheet.deleteRow(i + 1);
  }
  // Re-append all items
  p.list.forEach((val, idx) => sheet.appendRow([val, val, p.listKey, idx, '']));
  return { success: true };
}

function updateBizConfig(p) {
  // FIX: key names now match what getAllData reads back and what frontend expects
  // Sheet Key column stores these names; getAllData remaps them on read
  upsertConfig('settings', 'biz_name',      p.biz);
  upsertConfig('settings', 'owner_name',    p.owner);
  upsertConfig('settings', 'hourly_rate',   p.rate);
  upsertConfig('settings', 'hst_number',    p.hst_num);
  upsertConfig('settings', 'tax_rate',      p.tax_rate);
  upsertConfig('settings', 'tax_enabled',   p.tax_enabled);
  upsertConfig('settings', 'service_prices',p.service_prices || '{}');
  return { success: true };
}

function uploadLogo(p) {
  const decoded = Utilities.base64Decode(p.base64.split(',')[1]);
  const blob    = Utilities.newBlob(decoded, 'image/png', p.fileName);
  const file    = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://lh3.googleusercontent.com/d/' + file.getId();
  upsertConfig('settings', 'logo', url);
  return { success: true, url: url };
}

// ── UTILITIES ─────────────────────────────────────────────────

// FIX: use formatVal() for all values so Date objects (including 1899 time values)
// are handled correctly instead of raw .toISOString() which breaks time fields
function getRows(tabName) {
  const sheet = SS.getSheetByName(tabName);
  if (!sheet) return [];
  const vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers = vals.shift();
  return vals.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = formatVal(row[i]); });
    return obj;
  });
}

// FIX: was missing — called by markInvoicePaid
function getRowById(tabName, idCol, idVal) {
  const rows = getRows(tabName);
  return rows.find(r => String(r[idCol]).trim() === String(idVal).trim()) || null;
}

function formatVal(v) {
  if (v instanceof Date) {
    if (v.getFullYear() === 1899) return Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  if (typeof v === 'string' && v.includes('T')) return v.split('T')[0];
  return v;
}

function appendRow(tabName, obj) {
  const sheet = SS.getSheetByName(tabName);
  // Get only the first row (headers) specifically
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => (obj[h] !== undefined && obj[h] !== null) ? obj[h] : '');
  sheet.appendRow(row);
}


function updateRow(tabName, idCol, idVal, updateObj) {
  const sheet    = SS.getSheetByName(tabName);
  const data     = sheet.getDataRange().getValues();
  const headers  = data[0];
  const colIndex = headers.indexOf(idCol);
  const rowIndex = data.findIndex(r => String(r[colIndex]).trim() === String(idVal).trim());
  if (rowIndex === -1) return false;
  const rowNum = rowIndex + 1;
  for (const key in updateObj) {
    const cIdx = headers.indexOf(key);
    if (cIdx > -1) sheet.getRange(rowNum, cIdx + 1).setValue(updateObj[key]);
  }
  return true;
}

function upsertConfig(cat, key, val) {
  const sheet    = SS.getSheetByName(TABS.CONFIG);
  const data     = sheet.getDataRange().getValues();
  const rowIndex = data.findIndex(r => r[0] === key && r[2] === cat);
  if (rowIndex > -1) sheet.getRange(rowIndex + 1, 2).setValue(val);
  else sheet.appendRow([key, val, cat, 99, '']);
}

function uid(pfx) {
  return pfx + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}