My bad, I totally left the Admin page hanging. Let's finish the teardown. 

Here is exactly what broke the service defaults in the Admin panel and the concrete, smarter code fixes for all three issues so you can patch this and push to `main`.

### The Admin Page Bug (The Orphan Key Issue)
If the default service amounts aren't translating to new jobs, it’s a **key mismatch**. 

In `app.js`, `S.biz.service_prices` is a JSON object that maps prices directly to the exact string name of the service (e.g., `{"Deep Clean": 60}`). If Sandra goes into the Admin lists and edits a service name (e.g., changes "Deep Clean" to "Deep Cleaning"), the old price stays tied to the old name. The new service name has no price associated with it, so it silently falls back to the global $50 CAD/hr default. 

---

### The Ultimate Fixes (Copy-Paste Ready)

#### 1. Fix the Admin Orphan Keys
We need to intercept service name changes and deletions, update the `service_prices` JSON, and trigger a save. Update these two functions in `app.js`:

**In `saveListItem()`:**
```javascript
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
```

**In `delListItem()`:**
```javascript
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
```

#### 2. Expose the Ghost Rate in Edit Modals
Give Sandra visual control over the rate so she isn't locked into an old $45 CAD snapshot. 

In `openJobModal` (around line 724) and `openJobModalEdit` (around line 757), inject this input group right next to the Estimated/Actual Hours:
```html
<div class="fg" id="je-rate-g" style="display:${j.Pricing_Type==='Flat'?'none':''};">
  <label class="fl">Hourly Rate ($)</label>
  <input class="fi" id="je-rate" type="text" inputmode="decimal" pattern="[0-9\.]*" value="${esc(j.Hourly_Rate || S.biz.rate || 50)}" oninput="jeCalc()">
</div>
```
Then, update `submitJobEdit` and `jeCalc` to pull `$('je-rate').value` and pass it into the `getJobTotals` override object as `rate: $('je-rate').value`. (You'll also need to quickly update `getJobTotals` to accept `rate` in its overrides). 

#### 3. Un-hide the Breakdowns
**For `openJobModal` (Scheduled Jobs):**
Find line 729 and strip out `style="display:none;"`. It should just be:
```html
<div id="je-calc-preview" class="hidden" style="background:var(--blue-s);border:1.5px solid var(--blue-b);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--txt2);"></div>
```

**For `openJobModalEdit` (Completed Jobs):**
Inject the exact same `#je-calc-preview` block above the Job Notes. Then, add `oninput="jeCalc()"` to `#je-hrs`, `#je-addcost`, and `#je-flat` so the breakdown actually updates when she types.