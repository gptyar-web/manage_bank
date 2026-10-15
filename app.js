"use strict";
(function () {
  const STORAGE = "mana_bank_accounts_v1";
  const ITERATIONS = 240000;
  const MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
  const WEEKDAYS = ["ش","ی","د","س","چ","پ","ج"];
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const nf = new Intl.NumberFormat("fa-IR");
  const pf = new Intl.DateTimeFormat("en-US-u-ca-persian", {year:"numeric",month:"numeric",day:"numeric",timeZone:"UTC"});
  let active = null, section = "dashboard", currentCard = null;
  let searchText = "", typeFilter = "all", viewingCalendar = null, authTab = "login";
  let busy = false;
  const $ = (selector) => document.querySelector(selector);
  const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toLatin = (value) => String(value ?? "").replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0)-1632));
  const digits = (value) => String(value ?? "").replace(/[0-9]/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[+c]);
  const amount = (value) => nf.format(Number(value || 0));
  const money = (value) => amount(value) + " <small>تومان</small>";
  const newId = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
  const bytesToB64 = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  const b64ToBytes = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  const getAccounts = () => { try { let list = JSON.parse(localStorage.getItem(STORAGE) || "[]"); return Array.isArray(list) ? list : []; } catch { return []; } };
  const saveAccounts = (list) => localStorage.setItem(STORAGE, JSON.stringify(list));
  const normalizeCard = (s) => toLatin(s).replace(/[\s-]/g, "");
  const parseAmount = (s) => {
    const n = Number(toLatin(s).replace(/[,\u066c٬\s]/g, ""));
    return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
  };
  const nowTime = () => String(new Date().getHours()).padStart(2,"0") + ":" + String(new Date().getMinutes()).padStart(2,"0");
  const pParts = (date) => {
    const parts = Object.fromEntries(pf.formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
    return {y:parts.year,m:parts.month,d:parts.day};
  };
  const dateValue = (p) => String(p.y).padStart(4,"0") + "/" + String(p.m).padStart(2,"0") + "/" + String(p.d).padStart(2,"0");
  const today = () => pParts(new Date(Date.UTC(new Date().getFullYear(),new Date().getMonth(),new Date().getDate())));
  const todayValue = () => dateValue(today());
  const addMonth = (y,m,offset) => {
    let n = y * 12 + (m-1) + offset;
    return {y:Math.floor(n/12),m:((n%12)+12)%12+1};
  };
  const cmpP = (a,b) => (a.y-b.y) || (a.m-b.m) || (a.d-b.d);
  function gregorianFromPersian(y,m,d) {
    const origin = Date.UTC(y+620,0,1), days = 1100, target = {y,m,d};
    let lo = 0, hi = days;
    while (lo < hi) {
      const mid = (lo+hi) >> 1;
      if (cmpP(pParts(new Date(origin+mid*86400000)),target) < 0) lo = mid+1;
      else hi = mid;
    }
    return new Date(origin+lo*86400000);
  }
  const dateDisplay = (date) => digits(date || todayValue());
  const cardBalance = (card) => Number(card.openingBalance) + card.transactions.reduce((sum,t) => sum + (t.type === "deposit" ? t.amount : -t.amount),0);
  const allTransactions = () => active.vault.cards.flatMap((card) => card.transactions.map((t) => ({...t,cardId:card.id,cardName:card.name})));
  const txSort = (list) => [...list].sort((a,b) => (b.date+" "+b.time).localeCompare(a.date+" "+a.time) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const transactionKind = (t) => ({deposit:"واریز",pos:"خرید با دستگاه POS",online:"خرید اینترنتی",transfer:"کارت به کارت"}[t.type] || "تراکنش");
  const transDescription = (t) => t.type === "deposit" ? ("از " + t.senderFirst + " " + t.senderLast) : t.type === "transfer" ? ("به " + t.recipientFirst + " " + t.recipientLast) : (t.description || t.reason || t.purchaseType || "برداشت از کارت");
  function toast(message,isError=false) {
    const el = document.createElement("div");
    el.className = "toast" + (isError?" error":"");
    el.textContent = message;
    $("#toast-container").appendChild(el);
    setTimeout(() => el.remove(), 4300);
  }
  async function deriveKey(code,salt) {
    const imported = await crypto.subtle.importKey("raw",encoder.encode(code),"PBKDF2",false,["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:ITERATIONS,hash:"SHA-256"},imported,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  }
  async function decryptAccount(entry,code) {
    const key = await deriveKey(code,b64ToBytes(entry.salt));
    const plain = await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(entry.iv)},key,b64ToBytes(entry.payload));
    const vault = JSON.parse(decoder.decode(plain));
    if (!vault || !Array.isArray(vault.cards)) throw Error("Invalid vault");
    return {key,vault};
  }
  async function persist() {
    if (!active) return;
    const all = getAccounts(), index = all.findIndex((x) => x.id === active.id);
    if (index < 0) throw Error("حساب پیدا نشد");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name:"AES-GCM",iv},active.key,encoder.encode(JSON.stringify(active.vault)));
    all[index].iv = bytesToB64(iv);
    all[index].payload = bytesToB64(new Uint8Array(encrypted));
    saveAccounts(all);
  }
  function setAuthTab(tab) {
    authTab = tab;
    $("#tab-login").classList.toggle("active",tab === "login");
    $("#tab-register").classList.toggle("active",tab === "register");
    $("#register-fields").classList.toggle("hidden",tab !== "register");
    $("#code-hint").classList.toggle("hidden",tab !== "register");
    $("#auth-title").textContent = tab === "login" ? "ورود به حساب شخصی" : "ساخت حساب جدید";
    $("#auth-subtitle").textContent = tab === "login" ? "کد اختصاصی خود را وارد کنید تا اطلاعاتتان باز شود." : "اطلاعات خود را وارد کنید و یک کد اختصاصی قدرتمند بسازید.";
    $("#auth-submit").innerHTML = (tab === "login" ? "ورود به سامانه " : "ایجاد حساب و شروع ") + icon("arrow");
    $("#auth-error").classList.add("hidden");
    $("#first-name").required = $("#last-name").required = tab === "register";
    $("#auth-code").value = "";
  }
  function showAuth() {
    active=null; currentCard=null; section="dashboard"; searchText=""; typeFilter="all";
    $("#app").classList.add("hidden"); $("#auth").classList.remove("hidden");
    $("#auth-form").reset(); setAuthTab("login");
  }
  async function handleAuth(event) {
    event.preventDefault(); if (busy) return;
    const code = $("#auth-code").value.trim();
    const error = $("#auth-error");
    error.classList.add("hidden");
    if (code.length < 8) { error.textContent="کد اختصاصی باید حداقل ۸ نویسه باشد.";error.classList.remove("hidden");return; }
    busy=true; $("#auth-submit").disabled=true;
    try {
      if (authTab === "register") {
        const first = $("#first-name").value.trim(), last = $("#last-name").value.trim();
        if (!first || !last) throw Error("نام و نام خانوادگی را تکمیل کنید.");
        const entries = getAccounts();
        for (const entry of entries) {
          try { await decryptAccount(entry,code); throw Object.assign(Error("این کد قبلاً ثبت شده است. کد دیگری انتخاب کنید."),{duplicate:true}); }
          catch(e) { if(e.duplicate) throw e; }
        }
        const salt = crypto.getRandomValues(new Uint8Array(16)), key = await deriveKey(code,salt);
        const vault = {first,last,cards:[],createdAt:new Date().toISOString()};
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(JSON.stringify(vault)));
        const id = newId();
        entries.push({id,salt:bytesToB64(salt),iv:bytesToB64(iv),payload:bytesToB64(new Uint8Array(encrypted)),version:1});
        saveAccounts(entries);
        active={id,key,vault}; toast("حساب شخصی شما ساخته شد.");
      } else {
        let found = null;
        for (const entry of getAccounts()) {
          try { const data = await decryptAccount(entry,code);found={id:entry.id,...data};break; }
          catch {}
        }
        if(!found) throw Error("کد اختصاصی صحیح نیست یا در این مرورگر حسابی با این کد وجود ندارد.");
        active=found; toast("خوش آمدید!");
      }
      $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden");
      $("#auth-form").reset(); section="dashboard"; render();
    } catch(e) {
      error.textContent=e.message || "خطا در باز کردن حساب. فضای ذخیره‌سازی مرورگر را بررسی کنید.";
      error.classList.remove("hidden");
    } finally {busy=false;$("#auth-submit").disabled=false;}
  }
  function changeSection(name) {
    if(!active) return;
    if(!["dashboard","cards","activity","backup"].includes(name))return;
    section=name;searchText="";typeFilter="all";
    $("#sidebar").classList.remove("open");$("#app").classList.remove("menu-open");
    render(); window.scrollTo({top:0,behavior:"smooth"});
  }
  function render() {
    if(!active)return;
    const v=active.vault;
    $("#sidebar-name").textContent=v.first+" "+v.last;
    $("#sidebar-avatar").textContent=(v.first[0]||"م");
    $("#today-label").textContent = new Intl.DateTimeFormat("fa-IR-u-ca-persian",{weekday:"long",year:"numeric",month:"long",day:"numeric"}).format(new Date());
    const titles={dashboard:"داشبورد مالی",cards:"کارت‌های من",activity:"گزارش تراکنش‌ها",backup:"پشتیبان و امنیت"};
    $("#page-title").textContent=titles[section];
    $("#page-crumb").textContent="پیشخوان / "+titles[section];
    document.querySelectorAll("[data-section]").forEach((btn)=>btn.classList.toggle("active",btn.dataset.section===section));
    $("#screen").innerHTML=({dashboard:renderDashboard,cards:renderCards,activity:renderActivity,backup:renderBackup}[section])();
  }
  function cardTile(card,index) {
    const num=card.number, balance=cardBalance(card);
    return '<button type="button" class="bank-card theme-'+(index%5)+'" data-action="open-card" data-id="'+escapeHtml(card.id)+'" aria-label="نمایش کارت '+escapeHtml(card.name)+'">'+
      '<div class="bank-card-top"><span>'+escapeHtml(card.name)+'</span>'+icon("card")+'</div>'+
      '<div class="bank-card-balance">'+money(balance)+'</div>'+
      '<div class="bank-card-bottom"><span class="card-digits">'+escapeHtml(num.slice(0,4))+' •••• •••• '+escapeHtml(num.slice(-4))+'</span><span>MANА / CARD</span></div>'+
      '</button>';
  }
  function emptyCard() {
    return '<div class="empty-state">'+
      '<div class="empty-icon">'+icon("card")+'</div><h3>هنوز کارتی اضافه نکرده‌اید</h3>'+
      '<p>اولین کارت خود را با شماره ۱۶ رقمی و موجودی اولیه ثبت کنید تا مدیریت تراکنش‌ها را شروع کنید.</p>'+
      '<button class="btn btn-primary" data-action="new-card">'+icon("plus")+' افزودن اولین کارت</button></div>';
  }
  function sectionHead(title,subtitle,actions="") {
    return '<div class="section-intro"><div><h2>'+title+'</h2><p>'+subtitle+'</p></div><div class="section-actions">'+actions+'</div></div>';
  }
  function summaryStats() {
    const v=active.vault, all=allTransactions(), y= today().y, m=today().m;
    const monthKey=String(y).padStart(4,"0")+"/"+String(m).padStart(2,"0")+"/";
    const monthly=all.filter((t)=>t.date.startsWith(monthKey));
    const total=v.cards.reduce((s,c)=>s+cardBalance(c),0);
    const income=monthly.filter((t)=>t.type==="deposit").reduce((s,t)=>s+t.amount,0);
    const expense=monthly.filter((t)=>t.type!=="deposit").reduce((s,t)=>s+t.amount,0);
    const stat=(label,value,sub,ic,cls)=>'<div class="stat-card"><div class="stat-head"><span>'+label+'</span><span class="stat-icon '+cls+'">'+icon(ic)+'</span></div><div class="stat-value">'+money(value)+'</div><div class="stat-foot">'+sub+'</div></div>';
    return '<div class="stats-grid">'+stat("موجودی کل کارت‌ها",total,digits(v.cards.length)+" کارت ثبت‌شده","wallet","")+
      stat("واریزی‌های این ماه",income,MONTHS[m-1]+" "+digits(y),"in","in")+
      stat("برداشت‌های این ماه",expense,MONTHS[m-1]+" "+digits(y),"out","out")+'</div>';
  }
  function renderDashboard() {
    const cards=active.vault.cards, all=txSort(allTransactions()).slice(0,6);
    return '<section class="welcome-banner"><div><h2>سلام '+escapeHtml(active.vault.first)+' عزیز، خوش آمدی 👋</h2><p>اینجا یک نمای کامل از حساب‌ها و تراکنش‌های توست. همه‌چیز تحت کنترل توست.</p></div><div class="banner-mark">✧</div></section>'+
      summaryStats()+
      '<div class="block-head"><h3>کارت‌های بانکی من</h3><button class="text-button" data-section="cards">مشاهده همه '+icon("chevron-left")+'</button></div>'+
      (cards.length ? '<div class="cards-grid">'+cards.slice(0,6).map(cardTile).join("")+'</div>':emptyCard())+
      '<div class="block-head"><h3>آخرین تراکنش‌ها</h3><button class="text-button" data-section="activity">همه تراکنش‌ها '+icon("chevron-left")+'</button></div>'+
      (all.length?'<div class="surface"><div class="transaction-list">'+all.map(renderTxRow).join("")+'</div></div>':
       '<div class="empty-state"><div class="empty-icon">'+icon("activity")+'</div><h3>تراکنشی ثبت نشده است</h3><p>پس از ثبت اولین واریز یا برداشت، گردش حساب شما در اینجا نمایش داده می‌شود.</p></div>');
  }
  function renderCards() {
    const cards=active.vault.cards;
    if(currentCard && !cards.some((x)=>x.id===currentCard))currentCard=null;
    if(currentCard) return renderCardDetail(cards.find((x)=>x.id===currentCard));
    return sectionHead("کارت‌های بانکی من",digits(cards.length)+" کارت ثبت‌شده؛ برای نمایش جزئیات روی هر کارت کلیک کنید.",'<button class="btn btn-primary" data-action="new-card">'+icon("plus")+" افزودن کارت</button>")+
      (cards.length ? '<div class="cards-grid">'+cards.map(cardTile).join("")+'</div>':emptyCard());
  }
  function renderCardDetail(card) {
    const index=active.vault.cards.indexOf(card), transactions=txSort(card.transactions);
    return '<div class="card-breadcrumb"><button data-action="back-cards">کارت‌های من</button>'+icon("chevron-left")+'<span>'+escapeHtml(card.name)+'</span></div>'+
      '<div class="card-detail">'+cardTile(card,index)+
      '<div class="card-detail-actions"><h3>مدیریت '+escapeHtml(card.name)+'</h3><p>ثبت سریع تراکنش و محاسبه خودکار موجودی کارت</p>'+
      '<div class="action-buttons"><button class="btn btn-primary" data-action="deposit" data-id="'+card.id+'">'+icon("in")+' ثبت واریزی</button>'+
      '<button class="btn btn-soft" data-action="withdraw" data-id="'+card.id+'">'+icon("out")+' ثبت برداشت</button>'+
      '<button class="btn btn-outline" data-action="csv" data-id="'+card.id+'">'+icon("download")+' خروجی CSV</button></div>'+
      '<div class="detail-stat"><span>موجودی اولیه: <b>'+money(card.openingBalance)+'</b></span><span>تراکنش‌ها: <b>'+digits(card.transactions.length)+'</b></span></div></div></div>'+
      '<div class="block-head"><h3>گردش حساب '+escapeHtml(card.name)+'</h3></div>'+
      (transactions.length ? '<div class="surface"><div class="transaction-list">'+transactions.map(renderTxRow).join("")+'</div></div>' :
      '<div class="empty-state"><div class="empty-icon">'+icon("activity")+'</div><h3>گردش حساب خالی است</h3><p>برای این کارت یک واریز یا برداشت ثبت کنید.</p></div>')+
      '<div class="danger-zone"><div><h4>حذف کارت و تاریخچه آن</h4><p>با حذف کارت، تمامی تراکنش‌های آن نیز حذف خواهد شد.</p></div><button class="btn btn-danger" data-action="delete-card" data-id="'+card.id+'">'+icon("trash")+' حذف کارت</button></div>';
  }
  function renderTxRow(t) {
    const positive=t.type==="deposit";
    return '<div class="transaction-row">'+
      '<div class="trx-symbol '+(positive?"deposit":"")+'">'+icon(positive?"in":"out")+'</div>'+
      '<div class="trx-info"><b>'+transactionKind(t)+'</b><span>'+escapeHtml(transDescription(t))+
      (t.cardName?' · '+escapeHtml(t.cardName):'')+'</span></div>'+
      '<div class="trx-meta">'+dateDisplay(t.date)+'<br>'+digits(t.time)+'</div>'+
      '<div class="trx-amount"><strong class="'+(positive?"deposit":"withdrawal")+'">'+(positive?"+":"−")+amount(t.amount)+'</strong><small>تومان</small></div>'+
      '<button class="link-icon" aria-label="جزئیات تراکنش" title="جزئیات تراکنش" data-action="tx-detail" data-id="'+escapeHtml(t.id)+'" data-card="'+escapeHtml(t.cardId||currentCard||"")+'">'+icon("chevron-left")+'</button>'+
      '</div>';
  }
  function renderActivity() {
    const list=txSort(allTransactions()).filter((t)=> {
      if(typeFilter==="deposit" && t.type!=="deposit")return false;
      if(typeFilter==="withdrawal" && t.type==="deposit")return false;
      const corpus=[t.description,t.reason,t.purchaseType,t.senderFirst,t.senderLast,t.recipientFirst,t.recipientLast,t.recipientCard,t.cardName,t.amount].join(" ").toLowerCase();
      return corpus.includes(searchText.toLowerCase());
    });
    return sectionHead("تمام تراکنش‌ها","جزئیات واریزها و برداشت‌های تمام کارت‌های شما")+
      '<div class="transaction-toolbar"><div class="search-box">'+icon("search")+'<input id="transaction-search" type="search" placeholder="جستجو در توضیحات، نام و مبلغ..." value="'+escapeHtml(searchText)+'"></div>'+
      '<select id="type-filter" class="select-filter" aria-label="نوع تراکنش"><option value="all" '+(typeFilter==="all"?"selected":"")+'>همه تراکنش‌ها</option><option value="deposit" '+(typeFilter==="deposit"?"selected":"")+'>فقط واریزی‌ها</option><option value="withdrawal" '+(typeFilter==="withdrawal"?"selected":"")+'>فقط برداشت‌ها</option></select></div>'+
      (list.length?'<div class="surface"><div class="transaction-list">'+list.map(renderTxRow).join("")+'</div></div>':
      '<div class="empty-state"><div class="empty-icon">'+icon("search")+'</div><h3>تراکنشی یافت نشد</h3><p>در صورت نیاز، عبارت جستجو یا فیلتر خود را تغییر دهید.</p></div>');
  }
  function renderBackup() {
    return sectionHead("امنیت و پشتیبان‌گیری","کنترل داده‌های مالی و نگهداری نسخه پشتیبان")+
      '<div class="notice">'+icon("info")+'<span><b>نکته مهم:</b> این برنامه یک دفتر مالی شخصی است و به هیچ بانک واقعی متصل نیست. داده‌ها فقط در این مرورگر ذخیره می‌شوند و با پاک‌شدن داده‌های سایت ممکن است از بین بروند؛ حتماً نسخه پشتیبان تهیه کنید.</span></div>'+
      '<div class="report-cards">'+
      '<div class="report-card"><div class="report-icon">'+icon("download")+'</div><h3>دریافت فایل پشتیبان</h3><p>همه حساب‌ها، کارت‌ها و تراکنش‌های رمزگذاری‌شده این مرورگر را در یک فایل JSON ذخیره کنید. کدهای ورود در فایل نوشته نمی‌شوند.</p><button class="btn btn-primary" data-action="export-backup">'+icon("download")+' دانلود پشتیبان امن</button></div>'+
      '<div class="report-card"><div class="report-icon">'+icon("upload")+'</div><h3>بازیابی اطلاعات</h3><p>فایل پشتیبان قبلی را وارد کنید تا حساب‌های آن به مرورگر فعلی اضافه شوند. برای ورود به هر حساب به کد اختصاصی همان حساب نیاز دارید.</p><button class="btn btn-outline" data-action="import-backup">'+icon("upload")+' انتخاب فایل پشتیبان</button></div></div>'+
      '<div class="surface surface-pad" style="margin-top:22px"><h3 style="margin-bottom:9px">حریم خصوصی اطلاعات شما</h3><ul class="privacy-list"><li>اطلاعات کارت و تراکنش به سرور یا مخزن GitHub ارسال نمی‌شود.</li><li>محتوای حساب با AES-GCM و کلیدی مشتق‌شده از کد اختصاصی رمزگذاری می‌شود.</li><li>اطلاعات هر حساب از سایر حساب‌ها جداست؛ کد ورود را فراموش نکنید.</li><li>برای استفاده در دستگاه دیگری، فایل پشتیبان را منتقل و در مرورگر مقصد بازیابی کنید.</li><li>پیشنهاد می‌شود از کد طولانی و غیرقابل‌حدس استفاده کنید.</li></ul></div>';
  }
