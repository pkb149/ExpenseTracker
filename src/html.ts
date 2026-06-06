export function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>Expense Tracker</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --primary:#6366f1;--primary-light:#e0e7ff;
  --danger:#ef4444;--success:#22c55e;
  --bg:#f1f5f9;--card:#fff;--border:#e2e8f0;
  --text:#1e293b;--muted:#64748b;
  --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.header{background:var(--primary);color:#fff;padding:.875rem 1rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(99,102,241,.35)}
.header h1{font-size:1.0625rem;font-weight:600}
.export-btn{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:.3rem .65rem;border-radius:.375rem;font-size:.8125rem;cursor:pointer}
.export-btn:hover{background:rgba(255,255,255,.25)}
.month-nav{background:#fff;border-bottom:1px solid var(--border);padding:.625rem 1rem;display:flex;align-items:center;justify-content:center;gap:.75rem}
.month-btn{background:none;border:none;cursor:pointer;color:var(--primary);font-size:1.375rem;line-height:1;padding:0 .125rem}
.month-label{font-weight:600;font-size:.9375rem;min-width:150px;text-align:center}
.summary{padding:.875rem;display:grid;grid-template-columns:repeat(2,1fr);gap:.625rem}
.card{background:var(--card);border-radius:.75rem;padding:.875rem 1rem;box-shadow:var(--shadow)}
.card-label{font-size:.6875rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:500}
.card-value{font-size:1.3125rem;font-weight:700;margin-top:.2rem}
.v-total{color:var(--primary)}.v-prashant{color:#0ea5e9}.v-prayashi{color:#ec4899}.v-common{color:#f59e0b}
.section{padding:0 .875rem .875rem}
.section-title{font-size:.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem}
.cat-row{display:flex;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border);gap:.625rem;font-size:.875rem}
.cat-row:last-child{border-bottom:none}
.cat-name{min-width:90px}
.cat-bar-wrap{flex:1;background:#e2e8f0;border-radius:4px;height:6px;overflow:hidden}
.cat-bar{height:100%;background:var(--primary);border-radius:4px}
.cat-right{text-align:right;white-space:nowrap;min-width:80px;font-weight:600}
.cat-pct{color:var(--muted);font-weight:400;font-size:.75rem;margin-left:.2rem}
.settle-card{display:flex;flex-direction:column;gap:.375rem}
.settle-amount{font-size:1.125rem;font-weight:700}
.settle-detail{font-size:.8rem;color:var(--muted)}
.ai-card{display:flex;flex-direction:column;gap:.875rem}
.insight-list{list-style:none;display:flex;flex-direction:column;gap:.5rem}
.insight-item{display:flex;gap:.5rem;font-size:.875rem;line-height:1.45}
.insight-item::before{content:"•";color:var(--primary);font-weight:700;flex-shrink:0}
.expenses-section{padding:0 .875rem 6rem}
.expense-card{background:var(--card);border-radius:.625rem;padding:.75rem;margin-bottom:.5rem;box-shadow:var(--shadow);display:flex;gap:.75rem}
.exp-main{flex:1;min-width:0}
.exp-desc{font-weight:500;font-size:.9375rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.exp-raw{font-size:.75rem;color:var(--muted);margin-top:.2rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic}
.exp-meta{display:flex;gap:.375rem;margin-top:.3rem;flex-wrap:wrap}
.badge{font-size:.6875rem;padding:.1rem .4rem;border-radius:9999px;font-weight:500}
.b-indigo{background:#e0e7ff;color:#4338ca}
.b-pink{background:#fce7f3;color:#be185d}
.b-amber{background:#fef3c7;color:#b45309}
.b-gray{background:#f1f5f9;color:#475569}
.b-green{background:#dcfce7;color:#15803d}
.exp-right{text-align:right;flex-shrink:0}
.exp-amt{font-weight:700;font-size:1rem}
.exp-date{font-size:.75rem;color:var(--muted);margin-top:.15rem}
.exp-actions{display:flex;gap:.25rem;justify-content:flex-end;margin-top:.35rem}
.btn-icon{background:none;border:none;cursor:pointer;font-size:.875rem;padding:.2rem .3rem;border-radius:.25rem;color:var(--muted)}
.btn-icon:hover{background:#f1f5f9}
.empty{text-align:center;padding:3rem 1rem;color:var(--muted)}
.empty-icon{font-size:2.5rem;margin-bottom:.5rem}
.fab{position:fixed;bottom:1.5rem;right:1.5rem;z-index:200}
.fab-main{width:3.25rem;height:3.25rem;border-radius:50%;background:var(--primary);color:#fff;border:none;cursor:pointer;font-size:1.625rem;line-height:1;box-shadow:0 4px 14px rgba(99,102,241,.45);display:flex;align-items:center;justify-content:center;transition:transform .15s}
.fab-main:hover{transform:scale(1.08)}
.fab-main.rotated{transform:rotate(45deg)}
.fab-menu{position:absolute;bottom:3.75rem;right:0;display:flex;flex-direction:column;gap:.5rem;align-items:flex-end;opacity:0;pointer-events:none;transform:translateY(.5rem);transition:opacity .15s,transform .15s}
.fab.open .fab-menu{opacity:1;pointer-events:auto;transform:translateY(0)}
.fab-option{display:flex;align-items:center;gap:.5rem;background:#fff;border:none;cursor:pointer;padding:.5rem .875rem;border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.12);font-size:.875rem;font-weight:500;color:var(--text);white-space:nowrap}
.fab-option:hover{background:#f8fafc}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:300;display:none;align-items:flex-end;justify-content:center}
.overlay.open{display:flex}
.modal{background:#fff;border-radius:1.25rem 1.25rem 0 0;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;padding:1.25rem;-webkit-overflow-scrolling:touch}
.modal-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem}
.modal-title{font-size:1.0625rem;font-weight:600}
.modal-close{background:none;border:none;cursor:pointer;font-size:1.375rem;color:var(--muted);line-height:1}
.fr{margin-bottom:.875rem}
.fr label{display:block;font-size:.8rem;font-weight:500;color:var(--muted);margin-bottom:.25rem}
.fr input,.fr select,.fr textarea{width:100%;padding:.6rem .75rem;border:1.5px solid var(--border);border-radius:.5rem;font-size:.9375rem;color:var(--text);background:#fff;-webkit-appearance:auto}
.fr input:focus,.fr select:focus,.fr textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-light)}
.fr textarea{resize:vertical;min-height:5.5rem}
.fg2{display:grid;grid-template-columns:1fr 1fr;gap:.875rem}
.cb-row{display:flex;align-items:center;gap:.5rem;cursor:pointer}
.cb-row input{width:auto;accent-color:var(--primary);cursor:pointer}
.btn{padding:.625rem 1.25rem;border-radius:.5rem;border:none;cursor:pointer;font-size:.9375rem;font-weight:500}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--primary);color:#fff}
.btn-secondary{background:#f1f5f9;color:var(--text)}
.btn-success{background:var(--success);color:#fff}
.btn-row{display:flex;gap:.625rem;margin-top:1rem}
.btn-row .btn{flex:1}
.btn-block{width:100%}
.pending-btn{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:.3rem .65rem;border-radius:.375rem;font-size:.8125rem;cursor:pointer;display:flex;align-items:center;gap:.35rem}
.pending-btn:hover{background:rgba(255,255,255,.25)}
.badge-count{background:#ef4444;color:#fff;border-radius:9999px;font-size:.65rem;font-weight:700;padding:.1rem .4rem;min-width:1.1rem;text-align:center;display:none}
.pending-card{background:var(--card);border-radius:.625rem;padding:.875rem;margin-bottom:.625rem;box-shadow:var(--shadow);border-left:3px solid var(--primary)}
.pending-card .exp-desc{font-weight:600;font-size:.9375rem}
.pending-source{font-size:.7rem;color:var(--muted);margin-top:.15rem}
.pending-actions{display:flex;gap:.5rem;margin-top:.75rem}
.pending-actions .btn{flex:1;font-size:.8125rem;padding:.45rem .5rem}
.parse-result{margin-top:1rem;border-top:1.5px solid var(--border);padding-top:1rem;display:none}
.parse-result.show{display:block}
.spinner{display:inline-block;width:.875rem;height:.875rem;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:.35rem}
@keyframes spin{to{transform:rotate(360deg)}}
@media(min-width:600px){
  .modal{border-radius:1rem}
  .overlay{align-items:center}
  .summary{grid-template-columns:repeat(4,1fr)}
}
</style>
</head>
<body>

<header class="header">
  <h1>Expense Tracker</h1>
  <div style="display:flex;gap:.5rem;align-items:center">
    <button class="pending-btn" onclick="openPendingModal()" id="pending-btn">
      Review <span class="badge-count" id="pending-count">0</span>
    </button>
    <button class="export-btn" onclick="exportCSV()">Export CSV</button>
    <a href="/auth/logout" class="export-btn" style="text-decoration:none">Logout</a>
  </div>
</header>

<div class="month-nav">
  <button class="month-btn" onclick="prevMonth()">&#8249;</button>
  <div class="month-label" id="month-label" onclick="openMonthPicker()" style="cursor:pointer;text-decoration:underline dotted #94a3b8"></div>
  <button class="month-btn" onclick="nextMonth()">&#8250;</button>
</div>
<div id="month-picker" style="display:none;background:#fff;border-bottom:1px solid var(--border);padding:.75rem 1rem">
  <div style="display:flex;gap:.5rem;align-items:center;justify-content:center">
    <select id="pick-month" style="padding:.4rem .5rem;border:1.5px solid var(--border);border-radius:.4rem;font-size:.9rem">
      <option value="01">January</option><option value="02">February</option><option value="03">March</option>
      <option value="04">April</option><option value="05">May</option><option value="06">June</option>
      <option value="07">July</option><option value="08">August</option><option value="09">September</option>
      <option value="10">October</option><option value="11">November</option><option value="12">December</option>
    </select>
    <input id="pick-year" type="number" min="2020" max="2099" style="width:5rem;padding:.4rem .5rem;border:1.5px solid var(--border);border-radius:.4rem;font-size:.9rem">
    <button class="btn btn-primary" style="padding:.4rem .875rem" onclick="applyMonthPicker()">Go</button>
    <button class="btn btn-secondary" style="padding:.4rem .75rem" onclick="closeMonthPicker()">✕</button>
  </div>
</div>

<div class="summary" id="summary"></div>

<div class="section" id="settlement-section" style="display:none">
  <div class="section-title">Monthly Settlement</div>
  <div class="card" id="settlement-card"></div>
</div>

<div class="section" id="cat-section" style="display:none">
  <div class="section-title">By Category</div>
  <div id="cat-breakdown"></div>
</div>

<div class="section">
  <div class="section-title">AI Analysis</div>
  <div class="card ai-card">
    <button class="btn btn-primary btn-block" id="analyze-btn" onclick="doAnalyze()">&#x2728; Analyze this month</button>
    <div id="ai-result" style="display:none"></div>
  </div>
</div>

<div class="expenses-section">
  <div class="section-title" style="margin-bottom:.5rem">Transactions</div>
  <div id="expenses-list"></div>
</div>

<div class="fab" id="fab">
  <div class="fab-menu">
    <button class="fab-option" onclick="openSmartModal();closeFab()">&#x1F916; Smart Add</button>
    <button class="fab-option" onclick="openAddModal();closeFab()">&#x1F4DD; Manual Add</button>
  </div>
  <button class="fab-main" id="fab-btn" onclick="toggleFab()">+</button>
</div>

<div class="overlay" id="form-overlay">
  <div class="modal">
    <div class="modal-hdr">
      <div class="modal-title" id="form-title">Add Expense</div>
      <button class="modal-close" onclick="closeFormModal()">&times;</button>
    </div>
    <form id="expense-form" onsubmit="submitForm(event)">
      <div class="fr">
        <label>Description</label>
        <input type="text" id="f-desc" required placeholder="e.g. Swiggy dinner">
      </div>
      <div class="fg2">
        <div class="fr">
          <label>Amount (&#x20B9;)</label>
          <input type="number" id="f-amt" required min="0" step="0.01" placeholder="0">
        </div>
        <div class="fr">
          <label>Date</label>
          <input type="date" id="f-date" required>
        </div>
      </div>
      <div class="fg2">
        <div class="fr">
          <label>Paid By</label>
          <select id="f-paid-by"><option>Prashant</option><option>Prayashi</option></select>
        </div>
        <div class="fr">
          <label>Category</label>
          <select id="f-cat">
            <option>Food</option><option>Travel</option><option>Subscription</option>
            <option>Shopping</option><option>Rent</option><option>Medical</option>
            <option>Entertainment</option><option>Utilities</option><option>Other</option>
          </select>
        </div>
      </div>
      <div class="fr">
        <label>Who is it for?</label>
        <select id="f-for"><option>Common</option><option>Prashant</option><option>Prayashi</option></select>
      </div>
      <div class="fr">
        <label>Notes / original input <span style="color:var(--muted);font-weight:400">(optional — paste SMS, receipt, or any context)</span></label>
        <textarea id="f-raw" rows="2" placeholder="e.g. INR 450 debited for Swiggy order #12345"></textarea>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" onclick="closeFormModal()">Cancel</button>
        <button type="submit" class="btn btn-primary" id="form-save-btn">Save</button>
      </div>
    </form>
  </div>
</div>

<div class="overlay" id="smart-overlay">
  <div class="modal">
    <div class="modal-hdr">
      <div class="modal-title">&#x1F916; Smart Add</div>
      <button class="modal-close" onclick="closeSmartModal()">&times;</button>
    </div>
    <div class="fr">
      <label>Paste UPI SMS, receipt text, or describe the expense freely</label>
      <textarea id="smart-text" placeholder="Examples:&#10;Paid 450 for Swiggy tonight, Prashant paid for both&#10;&#10;INR 6600 debited — cook+maid, Prayashi paid monthly&#10;&#10;Amazon order iPhone case 899, I paid&#10;&#10;Uber ride 280 just me yesterday"></textarea>
    </div>
    <button class="btn btn-primary btn-block" id="parse-btn" onclick="doParse()">Parse with AI</button>
    <div class="parse-result" id="parse-result">
      <div style="font-weight:600;margin-bottom:.75rem">Review &amp; Confirm</div>
      <form id="smart-form" onsubmit="submitSmartForm(event)">
        <div class="fr">
          <label>Description</label>
          <input type="text" id="s-desc" required>
        </div>
        <div class="fg2">
          <div class="fr">
            <label>Amount (&#x20B9;)</label>
            <input type="number" id="s-amt" required min="0" step="0.01">
          </div>
          <div class="fr">
            <label>Date</label>
            <input type="date" id="s-date" required>
          </div>
        </div>
        <div class="fg2">
          <div class="fr">
            <label>Paid By</label>
            <select id="s-paid-by"><option>Prashant</option><option>Prayashi</option></select>
          </div>
          <div class="fr">
            <label>Category</label>
            <select id="s-cat">
              <option>Food</option><option>Travel</option><option>Subscription</option>
              <option>Shopping</option><option>Rent</option><option>Medical</option>
              <option>Entertainment</option><option>Utilities</option><option>Other</option>
            </select>
          </div>
        </div>
        <div class="fr">
          <label>Who is it for?</label>
          <select id="s-for"><option>Common</option><option>Prashant</option><option>Prayashi</option></select>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" onclick="closeSmartModal()">Cancel</button>
          <button type="submit" class="btn btn-success">Save Expense</button>
        </div>
      </form>
    </div>
  </div>
</div>

<div class="overlay" id="pending-overlay">
  <div class="modal" style="max-height:92vh">
    <div class="modal-hdr">
      <div class="modal-title">Review Queue</div>
      <div style="display:flex;gap:.5rem;align-items:center">
        <button class="btn btn-success" style="font-size:.8125rem;padding:.35rem .75rem" onclick="approveAll()">Approve All</button>
        <button class="modal-close" onclick="closePendingModal()">&times;</button>
      </div>
    </div>
    <div id="pending-list"><div class="empty"><div class="empty-icon">&#x2705;</div><div>No pending items</div></div></div>
  </div>
</div>

<script>
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DEFAULT_CATS=['Food','Travel','Subscription','Shopping','Rent','Medical','Entertainment','Utilities','Groceries','Education','Insurance','EMI','Personal Care','Gifts','Other'];

let currentMonth=(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');})();
let expenses=[];
let editingId=null;
let fabOpen=false;

function toggleFab(){
  fabOpen=!fabOpen;
  document.getElementById('fab').classList.toggle('open',fabOpen);
  document.getElementById('fab-btn').classList.toggle('rotated',fabOpen);
}
function closeFab(){
  fabOpen=false;
  document.getElementById('fab').classList.remove('open');
  document.getElementById('fab-btn').classList.remove('rotated');
}
document.addEventListener('click',e=>{if(!e.target.closest('#fab'))closeFab();});

function prevMonth(){
  const[y,m]=currentMonth.split('-').map(Number);
  currentMonth=m===1?(y-1)+'-12':y+'-'+String(m-1).padStart(2,'0');
  load();
}
function nextMonth(){
  const[y,m]=currentMonth.split('-').map(Number);
  currentMonth=m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0');
  load();
}

async function load(){
  const[y,m]=currentMonth.split('-');
  document.getElementById('month-label').textContent=MONTHS[parseInt(m)-1]+' '+y;
  try{
    const res=await fetch('/api/expenses?month='+currentMonth);
    expenses=await res.json();
    refreshCategoryDropdowns();
    renderSummary();
    renderList();
  }catch(e){console.error(e);}
}

function refreshCategoryDropdowns(){
  const usedCats=[...new Set(expenses.map(e=>e.category).filter(Boolean))];
  const allCats=[...new Set([...DEFAULT_CATS,...usedCats])].sort();
  for(const id of['f-cat','s-cat']){
    const sel=document.getElementById(id);
    if(!sel)continue;
    const cur=sel.value;
    sel.innerHTML=allCats.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    if(cur)sel.value=cur;
  }
}

function fmt(n){return Number(n).toLocaleString('en-IN',{maximumFractionDigits:0});}
function fmtDate(d){if(!d)return'';const[y,m,day]=d.split('-');return day+'/'+m+'/'+y.slice(2);}
function esc(s){const d=document.createElement('div');d.appendChild(document.createTextNode(String(s)));return d.innerHTML;}
function todayISO(){return new Date().toISOString().split('T')[0];}

function renderSummary(){
  const total=expenses.reduce((s,e)=>s+e.amount,0);
  const pPaid=expenses.filter(e=>e.paid_by==='Prashant').reduce((s,e)=>s+e.amount,0);
  const qPaid=expenses.filter(e=>e.paid_by==='Prayashi').reduce((s,e)=>s+e.amount,0);
  const common=expenses.filter(e=>e.who_for==='Common').reduce((s,e)=>s+e.amount,0);
  document.getElementById('summary').innerHTML=
    card('Total','v-total',total)+card('Prashant paid','v-prashant',pPaid)+
    card('Prayashi paid','v-prayashi',qPaid)+card('Common','v-common',common);

  // Settlement
  const cmnP=expenses.filter(e=>e.who_for==='Common'&&e.paid_by==='Prashant').reduce((s,e)=>s+e.amount,0);
  const cmnQ=expenses.filter(e=>e.who_for==='Common'&&e.paid_by==='Prayashi').reduce((s,e)=>s+e.amount,0);
  const totalCommon=cmnP+cmnQ;
  if(totalCommon>0){
    const net=(cmnP-cmnQ)/2;
    const settled=Math.abs(net)<1;
    let who,color;
    if(settled){who='All settled up!';color='var(--success)';}
    else if(net>0){who='Prayashi owes Prashant &#x20B9;'+fmt(Math.abs(net));color='#ec4899';}
    else{who='Prashant owes Prayashi &#x20B9;'+fmt(Math.abs(net));color='#0ea5e9';}
    document.getElementById('settlement-card').innerHTML=
      '<div class="settle-card">'+
        '<div class="settle-amount" style="color:'+color+'">'+who+'</div>'+
        '<div class="settle-detail">Common &#x20B9;'+fmt(totalCommon)+
          ' &nbsp;·&nbsp; Prashant paid &#x20B9;'+fmt(cmnP)+
          ' &nbsp;·&nbsp; Prayashi paid &#x20B9;'+fmt(cmnQ)+'</div>'+
      '</div>';
    document.getElementById('settlement-section').style.display='block';
  }else{
    document.getElementById('settlement-section').style.display='none';
  }

  // Category bars
  const byCat={};
  expenses.forEach(e=>{byCat[e.category]=(byCat[e.category]||0)+e.amount;});
  const sorted=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  if(sorted.length){
    const maxAmt=sorted[0][1]||1;
    document.getElementById('cat-breakdown').innerHTML=sorted.map(([c,a])=>{
      const pct=total>0?Math.round((a/total)*100):0;
      const barW=Math.round((a/maxAmt)*100);
      return'<div class="cat-row">'+
        '<span class="cat-name">'+esc(c)+'</span>'+
        '<div class="cat-bar-wrap"><div class="cat-bar" style="width:'+barW+'%"></div></div>'+
        '<span class="cat-right">&#x20B9;'+fmt(a)+'<span class="cat-pct">'+pct+'%</span></span>'+
      '</div>';
    }).join('');
    document.getElementById('cat-section').style.display='block';
  }else{
    document.getElementById('cat-section').style.display='none';
  }
}

async function doAnalyze(){
  const btn=document.getElementById('analyze-btn');
  const result=document.getElementById('ai-result');
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>Analyzing...';
  result.style.display='none';
  try{
    const res=await fetch('/api/analyze?month='+currentMonth);
    const d=await res.json();
    if(d.error){result.innerHTML='<div style="color:var(--danger);font-size:.875rem">'+esc(d.error)+'</div>';}
    else{
      result.innerHTML='<ul class="insight-list">'+
        d.insights.map(i=>'<li class="insight-item">'+esc(i)+'</li>').join('')+
      '</ul>';
    }
    result.style.display='block';
  }catch(e){
    result.innerHTML='<div style="color:var(--danger);font-size:.875rem">Network error</div>';
    result.style.display='block';
  }finally{
    btn.disabled=false;
    btn.innerHTML='&#x2728; Analyze this month';
  }
}

function card(label,cls,amount){
  return '<div class="card"><div class="card-label">'+label+'</div><div class="card-value '+cls+'">&#x20B9;'+fmt(amount)+'</div></div>';
}

function renderList(){
  const el=document.getElementById('expenses-list');
  if(!expenses.length){
    el.innerHTML='<div class="empty"><div class="empty-icon">&#x1F4ED;</div><div>No expenses this month</div></div>';
    return;
  }
  el.innerHTML=expenses.map(e=>{
    const pb=e.paid_by==='Prayashi'?'b-pink':'b-indigo';
    const wf=e.who_for==='Prayashi'?'b-pink':e.who_for==='Common'?'b-amber':'b-indigo';
    return'<div class="expense-card">'+
      '<div class="exp-main">'+
        '<div class="exp-desc">'+esc(e.description)+'</div>'+
        (e.raw_input?'<div class="exp-raw">'+esc(e.raw_input)+'</div>':'')+
        '<div class="exp-meta">'+
          '<span class="badge '+pb+'">'+esc(e.paid_by)+'</span>'+
          '<span class="badge '+wf+'">For: '+esc(e.who_for)+'</span>'+
          '<span class="badge b-gray">'+esc(e.category)+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="exp-right">'+
        '<div class="exp-amt">&#x20B9;'+fmt(e.amount)+'</div>'+
        '<div class="exp-date">'+fmtDate(e.date)+'</div>'+
        '<div class="exp-actions">'+
          '<button class="btn-icon" onclick="openEditModal('+e.id+')" title="Edit">&#x270F;&#xFE0F;</button>'+
          '<button class="btn-icon" onclick="delExpense('+e.id+')" title="Delete">&#x1F5D1;&#xFE0F;</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

function openAddModal(){
  editingId=null;
  document.getElementById('form-title').textContent='Add Expense';
  document.getElementById('form-save-btn').textContent='Save';
  document.getElementById('expense-form').reset();
  document.getElementById('f-date').value=todayISO();
  document.getElementById('f-raw').value='';
  document.getElementById('form-overlay').classList.add('open');
}

function openEditModal(id){
  const e=expenses.find(x=>x.id===id);
  if(!e)return;
  editingId=id;
  document.getElementById('form-title').textContent='Edit Expense';
  document.getElementById('form-save-btn').textContent='Update';
  document.getElementById('f-desc').value=e.description;
  document.getElementById('f-amt').value=e.amount;
  document.getElementById('f-date').value=e.date;
  document.getElementById('f-paid-by').value=e.paid_by;
  ensureCategoryOption('f-cat',e.category);
  document.getElementById('f-for').value=e.who_for;
  document.getElementById('f-raw').value=e.raw_input||'';
  document.getElementById('form-overlay').classList.add('open');
}

function closeFormModal(){document.getElementById('form-overlay').classList.remove('open');}

async function submitForm(ev){
  ev.preventDefault();
  const rawVal=document.getElementById('f-raw').value.trim();
  const data={
    description:document.getElementById('f-desc').value,
    amount:parseFloat(document.getElementById('f-amt').value),
    date:document.getElementById('f-date').value,
    paid_by:document.getElementById('f-paid-by').value,
    category:document.getElementById('f-cat').value,
    who_for:document.getElementById('f-for').value,
    ...(rawVal&&{raw_input:rawVal}),
    source:'manual'
  };
  const btn=document.getElementById('form-save-btn');
  btn.disabled=true;
  if(editingId){
    await fetch('/api/expenses/'+editingId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  }else{
    await fetch('/api/expenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  }
  btn.disabled=false;
  closeFormModal();
  load();
}

async function delExpense(id){
  if(!confirm('Delete this expense?'))return;
  await fetch('/api/expenses/'+id,{method:'DELETE'});
  load();
}

function openSmartModal(){
  document.getElementById('smart-overlay').classList.add('open');
  document.getElementById('smart-text').value='';
  document.getElementById('parse-result').classList.remove('show');
}
function closeSmartModal(){document.getElementById('smart-overlay').classList.remove('open');}

async function doParse(){
  const text=document.getElementById('smart-text').value.trim();
  if(!text)return;
  const btn=document.getElementById('parse-btn');
  btn.disabled=true;
  btn.innerHTML='<span class="spinner"></span>Parsing...';
  try{
    const res=await fetch('/api/parse',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text})
    });
    const d=await res.json();
    if(d.error){alert('Parse failed. Add manually or try rephrasing.');return;}
    document.getElementById('s-desc').value=d.description||'';
    document.getElementById('s-amt').value=d.amount||0;
    document.getElementById('s-date').value=d.date||todayISO();
    document.getElementById('s-paid-by').value=d.paid_by||'Prashant';
    ensureCategoryOption('s-cat',d.category||'Other');
    document.getElementById('s-for').value=d.who_for||'Common';
    const pr=document.getElementById('parse-result');
    pr.classList.add('show');
    pr.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){
    alert('Network error: '+e.message);
  }finally{
    btn.disabled=false;
    btn.textContent='Parse with AI';
  }
}

async function submitSmartForm(ev){
  ev.preventDefault();
  const data={
    description:document.getElementById('s-desc').value,
    amount:parseFloat(document.getElementById('s-amt').value),
    date:document.getElementById('s-date').value,
    paid_by:document.getElementById('s-paid-by').value,
    category:document.getElementById('s-cat').value,
    who_for:document.getElementById('s-for').value,
    raw_input:document.getElementById('smart-text').value.trim(),
    source:'smart'
  };
  await fetch('/api/expenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  closeSmartModal();
  load();
}

function exportCSV(){window.open('/api/export?month='+currentMonth,'_blank');}

function openMonthPicker(){
  const[y,m]=currentMonth.split('-');
  document.getElementById('pick-month').value=m;
  document.getElementById('pick-year').value=y;
  document.getElementById('month-picker').style.display='block';
}
function closeMonthPicker(){document.getElementById('month-picker').style.display='none';}
function applyMonthPicker(){
  const m=document.getElementById('pick-month').value;
  const y=document.getElementById('pick-year').value;
  currentMonth=y+'-'+m;
  closeMonthPicker();
  load();
}

function ensureCategoryOption(selectId,value){
  const sel=document.getElementById(selectId);
  if(!sel||!value)return;
  const exists=[...sel.options].some(o=>o.value===value);
  if(!exists){const o=document.createElement('option');o.value=o.textContent=value;sel.appendChild(o);}
  sel.value=value;
}

load();

let pendingItems=[];

async function loadPendingCount(){
  try{
    const res=await fetch('/api/pending');
    pendingItems=await res.json();
    const badge=document.getElementById('pending-count');
    if(pendingItems.length){badge.textContent=pendingItems.length;badge.style.display='inline-block';}
    else{badge.style.display='none';}
  }catch(e){}
}

function openPendingModal(){
  renderPendingList();
  document.getElementById('pending-overlay').classList.add('open');
}
function closePendingModal(){document.getElementById('pending-overlay').classList.remove('open');}

function renderPendingList(){
  const el=document.getElementById('pending-list');
  if(!pendingItems.length){
    el.innerHTML='<div class="empty"><div class="empty-icon">&#x2705;</div><div>All clear — no pending items</div></div>';
    return;
  }
  el.innerHTML=pendingItems.map(function(p){
    var selPb=function(v){return p.paid_by===v?' selected':''};
    var selWf=function(v){return p.who_for===v?' selected':''};
    return '<div class="pending-card" id="pc-'+p.id+'">'+
      '<div class="exp-desc">'+esc(p.description)+'</div>'+
      '<div class="pending-source">'+esc(p.source||'ingest')+' &middot; '+fmtDate(p.date)+'</div>'+
      (p.raw_input?'<div class="exp-raw" style="margin-top:.3rem">'+esc(p.raw_input.slice(0,120))+'</div>':'')+
      '<div class="fg2" style="margin-top:.625rem">'+
        '<div class="fr" style="margin-bottom:.5rem"><label>Amount (&#x20B9;)</label><input type="number" id="pa-'+p.id+'" value="'+p.amount+'" step="0.01"></div>'+
        '<div class="fr" style="margin-bottom:.5rem"><label>Date</label><input type="date" id="pd-'+p.id+'" value="'+p.date+'"></div>'+
      '</div>'+
      '<div class="fg2">'+
        '<div class="fr" style="margin-bottom:.5rem"><label>Paid By</label>'+
          '<select id="ppb-'+p.id+'"><option'+selPb('Prashant')+'>Prashant</option><option'+selPb('Prayashi')+'>Prayashi</option></select>'+
        '</div>'+
        '<div class="fr" style="margin-bottom:.5rem"><label>Who For</label>'+
          '<select id="pwf-'+p.id+'"><option'+selWf('Common')+'>Common</option><option'+selWf('Prashant')+'>Prashant</option><option'+selWf('Prayashi')+'>Prayashi</option></select>'+
        '</div>'+
      '</div>'+
      '<div class="fr" style="margin-bottom:.5rem"><label>Category</label><input type="text" id="pcat-'+p.id+'" value="'+esc(p.category)+'"></div>'+
      '<div class="pending-actions">'+
        '<button class="btn btn-secondary" onclick="skipPending('+p.id+')">Skip</button>'+
        '<button class="btn btn-success" onclick="approvePending('+p.id+')">Approve</button>'+
      '</div>'+
    '</div>';
  }).join('');
}

async function approvePending(id){
  const overrides={
    amount:parseFloat(document.getElementById('pa-'+id).value),
    date:document.getElementById('pd-'+id).value,
    paid_by:document.getElementById('ppb-'+id).value,
    who_for:document.getElementById('pwf-'+id).value,
    category:document.getElementById('pcat-'+id).value,
  };
  await fetch('/api/pending/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(overrides)});
  pendingItems=pendingItems.filter(p=>p.id!==id);
  renderPendingList();
  loadPendingCount();
  load();
}

async function skipPending(id){
  await fetch('/api/pending/'+id,{method:'DELETE'});
  pendingItems=pendingItems.filter(p=>p.id!==id);
  renderPendingList();
  loadPendingCount();
}

async function approveAll(){
  for(const p of [...pendingItems]){await approvePending(p.id);}
}

loadPendingCount();
setInterval(loadPendingCount,5*60*1000);
load();
</script>
</body>
</html>`;
}
