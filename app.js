import {cloud} from "./cloud.js";
"use strict";
(function () {
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
  async function deriveBackupKey(code,salt) {
    const material = await crypto.subtle.importKey("raw",encoder.encode(code),"PBKDF2",false,["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:240000,hash:"SHA-256"},
      material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  }
  async function syncData() {
    if(!active)return;
    const user=active.user;
    const vault=await cloud.fetchVault(user);
    active.vault=vault;
  }
  function setAuthTab(tab) {
    authTab = tab;
    $("#tab-login").classList.toggle("active",tab === "login");
    $("#tab-register").classList.toggle("active",tab === "register");
    $("#register-fields").classList.toggle("hidden",tab !== "register");
    $("#code-hint").classList.toggle("hidden",tab !== "register");
    $("#auth-title").textContent = tab === "login" ? "ورود به حساب شخصی" : "ساخت حساب جدید";
    $("#auth-subtitle").textContent = tab === "login" ? "کد اختصاصی خود را وارد کنید تا اطلاعاتتان از Supabase بارگذاری شود." : "یک کد اختصاصی قوی بسازید؛ این کد تنها راه ورود شماست.";
    $("#auth-submit").innerHTML = (tab === "login" ? "ورود به سامانه " : "ایجاد حساب و شروع ") + icon("arrow");
    $("#auth-error").classList.add("hidden");
    $("#first-name").required = $("#last-name").required = tab === "register";
    $("#auth-code").value = "";
  }
  function showAuth() {
    const logoutPromise=cloud.logout();
    if(logoutPromise && typeof logoutPromise.catch==="function")logoutPromise.catch(()=>{});
    active=null;currentCard=null;section="dashboard";searchText="";typeFilter="all";
    $("#app").classList.add("hidden");$("#auth").classList.remove("hidden");
    $("#auth-form").reset();setAuthTab("login");
  }
  async function handleAuth(event) {
    event.preventDefault();if(busy)return;
    const code=$("#auth-code").value.trim();
    const error=$("#auth-error");error.classList.add("hidden");
    if(code.length<12 || !/[0-9۰-۹٠-٩]/.test(code) || !/[A-Za-z]/.test(code)) {
      error.textContent="کد اختصاصی باید حداقل ۱۲ نویسه و شامل حروف انگلیسی و عدد باشد.";
      error.classList.remove("hidden");return;
    }
    busy=true;$("#auth-submit").disabled=true;
    try{
      if(authTab==="register"){
        const first=$("#first-name").value.trim(),last=$("#last-name").value.trim();
        if(!first||!last)throw Error("نام و نام خانوادگی را تکمیل کنید.");
        await cloud.register(first,last,code);
      }
      const user=await cloud.login(code);
      active={id:user.id,user,vault:{first:user.user_metadata?.first_name||"کاربر",last:user.user_metadata?.last_name||"مانا",cards:[]}};
      await syncData();
      $("#auth").classList.add("hidden");$("#app").classList.remove("hidden");
      $("#auth-form").reset();section="dashboard";render();
      toast(authTab==="register"?"حساب ابری با موفقیت ساخته شد.":"به حساب ابری مانا خوش آمدید!");
    }catch(e){
      if(active){await cloud.logout().catch(()=>{});active=null;}
      error.textContent=e.message||"خطا در اتصال به Supabase.";
      error.classList.remove("hidden");
    }finally{busy=false;$("#auth-submit").disabled=false;}
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
      '<div class="detail-panel"><b>شماره کامل کارت:</b> <span class="full-number">'+escapeHtml(card.number)+'</span></div>'+
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
    return sectionHead("امنیت و پشتیبان‌گیری","اطلاعات بانکی شما در فضای اختصاصی حساب Supabase نگهداری می‌شود.")+
      '<div class="notice">'+icon("info")+'<span><b>توجه:</b> مانا یک دفتر ثبت دستی واریز و برداشت است و به شبکه بانکی واقعی متصل نیست. اطلاعات در Supabase ذخیره می‌شوند و با کد اختصاصی در دستگاه‌های دیگر قابل دسترسی هستند. نسخه پشتیبان رمزگذاری‌شده هم تهیه کنید.</span></div>'+
      '<div class="report-cards">'+
      '<div class="report-card"><div class="report-icon">'+icon("download")+'</div><h3>دریافت پشتیبان رمزگذاری‌شده</h3><p>نسخه رمزگذاری‌شده کارت‌ها و تراکنش‌ها را دریافت کنید. رمز پشتیبان هنگام دانلود از شما خواسته می‌شود و در GitHub ثبت نمی‌شود.</p><button class="btn btn-primary" data-action="export-backup">'+icon("download")+' دانلود پشتیبان امن</button></div>'+
      '<div class="report-card"><div class="report-icon">'+icon("upload")+'</div><h3>بازیابی داده‌ها</h3><p>یک فایل پشتیبان نسخه جدید مانا را با رمز آن وارد کنید تا کارت‌های موجود در فایل به حساب ابری فعلی شما افزوده شوند. کارت‌های تکراری نادیده گرفته می‌شوند.</p><button class="btn btn-outline" data-action="import-backup">'+icon("upload")+' انتخاب فایل پشتیبان</button></div></div>'+
      '<div class="surface surface-pad" style="margin-top:22px"><h3 style="margin-bottom:9px">حریم خصوصی و امنیت</h3><ul class="privacy-list">'+
      '<li>اطلاعات به‌صورت ابری در Supabase ذخیره می‌شوند و در مخزن GitHub قرار نمی‌گیرند.</li>'+
      '<li>سیاست‌های RLS هر رکورد را به شناسه کاربر مالک محدود می‌کنند.</li>'+
      '<li>ورود با Supabase Auth انجام می‌شود؛ کد اختصاصی را قوی و محرمانه نگه دارید.</li>'+
      '<li>فایل پشتیبان با الگوریتم AES-GCM رمزگذاری می‌شود.</li>'+
      '<li>اطلاعات سمت سرور به‌صورت رمزگذاری سرتاسری نیستند؛ از وارد کردن CVV2، رمز دوم و PIN خودداری کنید.</li>'+
      '<li>اگر کد ورود خود را فراموش کنید، بازیابی آن بدون راهکار بازیابی اضافی ممکن نیست.</li></ul></div>';
  }
    function field(label,name,placeholder="",opts="") {
    return '<label class="field"><span>'+label+'</span><input name="'+name+'" placeholder="'+escapeHtml(placeholder)+'" '+opts+'></label>';
  }
  function textArea(label,name,placeholder,required=false) {
    return '<label class="field"><span>'+label+'</span><textarea name="'+name+'" rows="2" maxlength="350" placeholder="'+escapeHtml(placeholder)+'" '+(required?"required":"")+'></textarea></label>';
  }
  function amountField(label="مبلغ (تومان)") {
    return field(label,"amount","مثلاً ۲۵۰۰۰۰", 'type="text" inputmode="numeric" maxlength="17" required dir="ltr"');
  }
  function dateFields() {
    return '<div class="two-col"><label class="field"><span>تاریخ شمسی</span>'+
      '<input id="date-input" name="date" type="hidden" value="'+todayValue()+'">'+
      '<button type="button" class="read-only-date" data-action="pick-date">'+icon("calendar")+'<span id="date-label">'+dateDisplay(todayValue())+'</span>'+icon("chevron-left")+'</button></label>'+
      '<label class="field"><span>ساعت (۲۴ ساعته)</span><input name="time" type="time" value="'+nowTime()+'" required></label></div>';
  }
  function purchaseSelect() {
    const opts=["خوراک و سوپرمارکت","پوشاک","حمل‌ونقل","درمان و سلامت","آموزش","قبوض","خدمات","تفریح","لوازم دیجیتال","سایر"];
    return '<label class="field"><span>نوع خرید</span><select name="purchaseType" required><option value="">انتخاب نوع خرید</option>'+
      opts.map((o)=>'<option value="'+o+'">'+o+'</option>').join("")+'</select></label>';
  }
  function modal(title,subtitle,ic,body,footer="",formMode="",cardId="") {
    $("#overlay").innerHTML='<div class="modal" role="dialog" aria-modal="true" aria-label="'+escapeHtml(title)+'">'+
      '<div class="modal-top"><div class="modal-title"><span class="modal-icon">'+icon(ic)+'</span><div><h3>'+escapeHtml(title)+'</h3><small>'+escapeHtml(subtitle)+'</small></div></div>'+
      '<button class="icon-button" data-action="close-modal" type="button" aria-label="بستن">'+icon("close")+'</button></div>'+
      (formMode?'<form id="modal-form" data-mode="'+formMode+'" data-id="'+escapeHtml(cardId)+'">':'')+
      '<div class="modal-body">'+body+'</div>'+
      (footer?'<div class="modal-footer">'+footer+'</div>':'')+
      (formMode?'</form>':'')+'</div>';
    $("#overlay").classList.remove("hidden");
    document.body.style.overflow="hidden";
    const first=$("#overlay input:not([type=hidden])");
    if(first)setTimeout(()=>first.focus(),80);
  }
  const cancelBtn = '<button class="btn btn-outline" type="button" data-action="close-modal">انصراف</button>';
  const saveBtn = '<button type="submit" class="btn btn-primary">'+icon("check")+' ذخیره اطلاعات</button>';
  function closeModal() {
    $("#overlay").classList.add("hidden");
    $("#overlay").innerHTML="";
    document.body.style.overflow="";
    closeCalendar();
  }
  function newCardModal() {
    modal("افزودن کارت جدید","شماره کارت و موجودی اولیه را وارد کنید","card",
      '<div class="modal-fields">'+
      field("عنوان کارت","name","مثلاً کارت روزمره یا بانک ملی",'maxlength="50" required')+
      field("شماره کارت ۱۶ رقمی","number","۶۰۳۷ ۹۹۱۸ ...",'inputmode="numeric" maxlength="22" required dir="ltr"')+
      amountField("موجودی اولیه (تومان)")+
      '<p class="form-helper">موجودی اولیه نقطه شروع محاسبات است. اطلاعات کارت به‌صورت رمزگذاری‌شده ذخیره خواهد شد.</p>'+
      '</div>',cancelBtn+saveBtn,"card");
  }
  function depositModal(cardId) {
    modal("ثبت واریزی","افزایش موجودی کارت پس از ذخیره","in",
      '<div class="modal-fields">'+amountField()+
      '<div class="two-col">'+field("نام فرستنده","senderFirst","نام",'maxlength="70" required')+
      field("نام خانوادگی فرستنده","senderLast","نام خانوادگی",'maxlength="70" required')+'</div>'+
      textArea("توضیحات","description","توضیحات مربوط به واریز",true)+dateFields()+'</div>',
      cancelBtn+saveBtn,"deposit",cardId);
  }
  function withdrawModal(cardId) {
    const choice=(type,label,ic)=>'<button class="choice-card" data-action="withdraw-type" data-id="'+escapeHtml(cardId)+'" data-kind="'+type+'">'+icon(ic)+'<span>'+label+'</span></button>';
    modal("ثبت برداشت","روش برداشت از کارت را انتخاب کنید","out",
      '<p class="muted" style="font-size:12px;line-height:2">برای درج اطلاعات دقیق‌تر، نوع تراکنش را مشخص کنید.</p>'+
      '<div class="withdraw-choices">'+choice("pos","برداشت با POS","pos")+choice("online","خرید اینترنتی","globe")+choice("transfer","کارت به کارت","transfer")+'</div>',
      '<button type="button" class="btn btn-outline" data-action="close-modal">بستن</button>');
  }
  function withdrawalForm(kind,cardId) {
    const title={pos:"برداشت با دستگاه POS",online:"خرید اینترنتی",transfer:"انتقال کارت به کارت"}[kind];
    let body=amountField();
    if(kind==="pos") body+=textArea("توضیحات","description","فروشگاه یا توضیحات خرید",true)+purchaseSelect();
    if(kind==="online")body+=textArea("علت خرید اینترنتی","reason","علت یا شرح خرید",true)+purchaseSelect();
    if(kind==="transfer")body+=
      field("شماره کارت گیرنده","recipientCard","شماره کارت ۱۶ رقمی",'inputmode="numeric" maxlength="22" dir="ltr" required')+
      '<div class="two-col">'+field("نام گیرنده","recipientFirst","نام",'maxlength="70" required')+
      field("نام خانوادگی گیرنده","recipientLast","نام خانوادگی",'maxlength="70" required')+'</div>'+
      textArea("علت انتقال","reason","علت کارت به کارت",true)+purchaseSelect();
    body+=dateFields();
    modal(title,"تراکنش پس از ذخیره از موجودی کسر می‌شود",kind==="pos"?"pos":kind==="online"?"globe":"transfer",
      '<div class="modal-fields">'+body+'</div>',cancelBtn+saveBtn,kind,cardId);
  }
  function txDetails(tx,card) {
    const labeled=(title,val)=>'<div style="display:flex;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid #eff1f7"><span style="color:#8892a7">'+title+'</span><b style="text-align:left;overflow-wrap:anywhere">'+escapeHtml(val||"—")+'</b></div>';
    const total=tx.type==="deposit"?"+"+amount(tx.amount):"−"+amount(tx.amount);
    let data=labeled("نوع تراکنش",transactionKind(tx))+
      labeled("کارت",card.name)+labeled("مبلغ",total+" تومان")+
      labeled("تاریخ",dateDisplay(tx.date))+labeled("ساعت",digits(tx.time));
    if(tx.type==="deposit") data+=labeled("فرستنده",tx.senderFirst+" "+tx.senderLast)+labeled("توضیحات",tx.description);
    if(tx.type==="pos") data+=labeled("نوع خرید",tx.purchaseType)+labeled("توضیحات",tx.description);
    if(tx.type==="online")data+=labeled("نوع خرید",tx.purchaseType)+labeled("علت",tx.reason);
    if(tx.type==="transfer")data+=labeled("کارت گیرنده",tx.recipientCard)+labeled("گیرنده",tx.recipientFirst+" "+tx.recipientLast)+labeled("علت",tx.reason)+labeled("نوع خرید",tx.purchaseType);
    modal("جزئیات تراکنش","اطلاعات ثبت‌شده","activity",'<div style="font-size:12px">'+data+'</div>',
      '<button class="btn btn-danger" type="button" data-action="delete-tx" data-card="'+card.id+'" data-id="'+tx.id+'">'+icon("trash")+' حذف تراکنش</button>'+
      '<button class="btn btn-outline" data-action="close-modal">بستن</button>');
  }
  function closeCalendar(){const old=$("#date-pop");if(old)old.remove();viewingCalendar=null;}
  function openCalendar() {
    const current=toLatin($("#date-input")?.value||todayValue()).split("/").map(Number);
    viewingCalendar={y:current[0],m:current[1]};
    redrawCalendar();
  }
  function redrawCalendar() {
    if(!viewingCalendar)return;
    const {y,m}=viewingCalendar, start=gregorianFromPersian(y,m,1);
    const offset=(start.getUTCDay()+1)%7;
    const origin=start.getTime()-offset*86400000, todayStr=todayValue();
    const selected=toLatin($("#date-input")?.value||"");
    let days="";
    for(let n=0;n<42;n++){
      const p=pParts(new Date(origin+n*86400000)), value=dateValue(p);
      days+='<button type="button" class="calendar-day'+(p.m!==m?" other":"")+(value===todayStr?" today":"")+(value===selected?" selected":"")+'" data-action="calendar-select" data-date="'+value+'" aria-label="'+digits(p.d)+' '+MONTHS[p.m-1]+'">'+digits(p.d)+'</button>';
    }
    let pop=$("#date-pop");
    if(!pop){pop=document.createElement("div");pop.id="date-pop";pop.className="date-picker-pop";document.body.appendChild(pop);}
    pop.innerHTML='<div class="calendar" role="dialog" aria-modal="true" aria-label="انتخاب تاریخ شمسی">'+
      '<div class="calendar-top">'+
      '<button type="button" class="calendar-nav" data-action="calendar-next" aria-label="ماه بعد">'+icon("chevron-right")+'</button>'+
      '<div class="calendar-heading"><strong>'+MONTHS[m-1]+' '+digits(y)+'</strong><small>تقویم هجری شمسی</small></div>'+
      '<button type="button" class="calendar-nav" data-action="calendar-prev" aria-label="ماه قبل">'+icon("chevron-left")+'</button></div>'+
      '<div class="calendar-grid">'+WEEKDAYS.map((w)=>'<span class="calendar-weekday">'+w+'</span>').join("")+days+'</div>'+
      '<div class="calendar-footer"><button type="button" data-action="calendar-today">رفتن به امروز</button><span>شنبه تا جمعه</span></div></div>';
  }
  async function saveModalForm(form) {
    if(busy||!active)return;
    const mode=form.dataset.mode,cardId=form.dataset.id,d=new FormData(form);
    const val=(name)=>String(d.get(name)||"").trim();
    let err="",record=null,editing=null;
    if(mode==="card" || mode==="edit-card"){
      editing=mode==="edit-card"?active.vault.cards.find(c=>c.id===cardId):null;
      const name=val("name"),number=normalizeCard(val("number")),opening=parseAmount(val("amount"));
      if(mode==="edit-card"&&!editing)err="کارت پیدا نشد.";
      else if(!name)err="عنوان کارت الزامی است.";
      else if(!/^\d{16}$/.test(number))err="شماره کارت باید دقیقاً ۱۶ رقم باشد.";
      else if(!Number.isFinite(opening))err="موجودی اولیه نامعتبر است.";
      else if(active.vault.cards.some(c=>c.number===number&&c.id!==cardId))err="این شماره کارت قبلاً ثبت شده است.";
      if(!err)record={name,number,opening};
    }else{
      const card=active.vault.cards.find(c=>c.id===cardId);
      if(!card){toast("کارت پیدا نشد.",true);return;}
      const value=parseAmount(val("amount")),date=toLatin(val("date")),time=toLatin(val("time"));
      if(!Number.isFinite(value)||value<=0)err="مبلغ باید عددی مثبت باشد.";
      else if(!/^\d{4}\/\d{2}\/\d{2}$/.test(date))err="تاریخ معتبر نیست.";
      else if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))err="ساعت معتبر نیست.";
      else if(mode!=="deposit"&&value>cardBalance(card))err="موجودی کارت برای برداشت کافی نیست.";
      let details={};
      if(mode==="deposit"){
        details={senderFirst:val("senderFirst"),senderLast:val("senderLast"),description:val("description")};
        if(!details.senderFirst||!details.senderLast||!details.description)err="فرستنده و توضیحات را تکمیل کنید.";
      }else if(mode==="pos"){
        details={description:val("description"),purchaseType:val("purchaseType")};
        if(!details.description||!details.purchaseType)err="توضیحات و نوع خرید را تکمیل کنید.";
      }else if(mode==="online"){
        details={reason:val("reason"),purchaseType:val("purchaseType")};
        if(!details.reason||!details.purchaseType)err="علت و نوع خرید را تکمیل کنید.";
      }else if(mode==="transfer"){
        details={recipientCard:normalizeCard(val("recipientCard")),recipientFirst:val("recipientFirst"),recipientLast:val("recipientLast"),reason:val("reason"),purchaseType:val("purchaseType")};
        if(!/^\d{16}$/.test(details.recipientCard))err="شماره کارت گیرنده باید ۱۶ رقمی باشد.";
        else if(!details.recipientFirst||!details.recipientLast||!details.reason||!details.purchaseType)err="اطلاعات گیرنده، علت و نوع خرید را تکمیل کنید.";
      }else err="نوع تراکنش نامعتبر است.";
      if(!err)record={type:mode,amount:value,date,time,...details};
    }
    if(err){toast(err,true);return;}
    busy=true;
    const submit=form.querySelector('[type="submit"]');
    if(submit)submit.disabled=true;
    try{
      if(mode==="card"){
        const saved=await cloud.createCard(active.id,record.name,record.number,record.opening);
        currentCard=saved.id;
      }else if(mode==="edit-card"){
        await cloud.updateCard(cardId,record.name,record.number,record.opening);
        currentCard=cardId;
      }else{
        await cloud.createTransaction(active.id,cardId,record);
        currentCard=cardId;
      }
      section="cards";await syncData();closeModal();render();
      toast(mode==="card"?"کارت در Supabase ثبت شد.":mode==="edit-card"?"اطلاعات کارت به‌روزرسانی شد.":"تراکنش در Supabase ذخیره و موجودی به‌روزرسانی شد.");
    }catch(e){
      toast("خطا در ثبت اطلاعات: "+(e.message||"ارتباط با سرور"),true);
    }finally{busy=false;if(submit)submit.disabled=false;}
  }
  function downloadFile(filename,content,type) {
    const blob=new Blob([content],{type});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function exportBackup() {
    if(!active)return;
    const password=prompt("برای رمزگذاری فایل پشتیبان یک رمز قوی وارد کنید (حداقل ۱۲ نویسه):");
    if(password===null)return;
    if(password.length<12){toast("رمز پشتیبان باید حداقل ۱۲ نویسه باشد.",true);return;}
    try{
      const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
      const key=await deriveBackupKey(password,salt);
      const payload=encoder.encode(JSON.stringify({version:2,vault:active.vault}));
      const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,payload));
      const backup={format:"mana-supabase-backup",version:2,salt:bytesToB64(salt),iv:bytesToB64(iv),data:bytesToB64(ciphertext)};
      downloadFile("mana-secure-backup-"+todayValue().replace(/\//g,"-")+".json",JSON.stringify(backup,null,2),"application/json");
      toast("فایل پشتیبان رمزگذاری‌شده دانلود شد.");
    }catch(e){toast("تهیه پشتیبان ناموفق بود.",true);}
  }
  async function importBackup(file) {
    if(!file)return;
    if(file.size>10*1024*1024){toast("حجم فایل بیش از ۱۰ مگابایت است.",true);return;}
    try{
      const obj=JSON.parse(await file.text());
      if(obj.format!=="mana-supabase-backup"||obj.version!==2 || !obj.salt || !obj.iv || !obj.data)
        throw Error("فایل نسخه جدید مانا معتبر نیست.");
      const pass=prompt("رمز فایل پشتیبان را وارد کنید:");
      if(pass===null)return;
      const key=await deriveBackupKey(pass,b64ToBytes(obj.salt));
      let clear;
      try{clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(obj.iv)},key,b64ToBytes(obj.data));}
      catch{throw Error("رمز پشتیبان اشتباه است یا فایل آسیب دیده است.");}
      const backup=JSON.parse(decoder.decode(clear));
      if(backup.version!==2||!Array.isArray(backup.vault?.cards))throw Error("اطلاعات پشتیبان نامعتبر است.");
      const result=await cloud.importVault(active.id,backup.vault);
      await syncData();render();
      toast(digits(result.cardsCount)+" کارت و "+digits(result.txCount)+" تراکنش در Supabase بازیابی شد.");
    }catch(e){toast(e.message||"بازیابی اطلاعات ناموفق بود.",true);}
  }
  function cardCsv(card) {
    const csvCell=(v)=>{
      let s=String(v??"");
      if(/^[=+\-@\t\r]/.test(s))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const rows=[["نوع تراکنش","مبلغ (تومان)","تاریخ شمسی","ساعت","توضیحات","نام فرستنده یا گیرنده","شماره کارت گیرنده","نوع خرید"]];
    txSort(card.transactions).forEach((t)=>rows.push([transactionKind(t),t.amount,t.date,t.time,t.description||t.reason||"",t.type==="deposit"?(t.senderFirst+" "+t.senderLast):(t.type==="transfer"?(t.recipientFirst+" "+t.recipientLast):""),t.recipientCard||"",t.purchaseType||""]));
    downloadFile("mana-card-"+card.number.slice(-4)+".csv","\ufeff"+rows.map((r)=>r.map(csvCell).join(",")).join("\r\n"),"text/csv;charset=utf-8");
  }
  document.addEventListener("click", async (event)=>{
    const tab=event.target.closest("[data-auth-tab]");
    if(tab){setAuthTab(tab.dataset.authTab);return;}
    const nav=event.target.closest("[data-section]");
    if(nav){changeSection(nav.dataset.section);return;}
    const button=event.target.closest("[data-action]");
    if(!button){
      if(event.target===$("#overlay"))closeModal();
      if(event.target.id==="date-pop")closeCalendar();
      return;
    }
    const action=button.dataset.action,id=button.dataset.id;
    const card=()=>active?.vault.cards.find((x)=>x.id===id);
    switch(action) {
      case "logout":closeModal();showAuth();toast("از حساب خارج شدید.");break;
      case "toggle-menu":$("#sidebar").classList.toggle("open");$("#app").classList.toggle("menu-open");break;
      case "new-card":newCardModal();break;
      case "open-card":currentCard=id;section="cards";render();window.scrollTo({top:0,behavior:"smooth"});break;
      case "back-cards":currentCard=null;render();break;
      case "deposit":if(card())depositModal(id);break;
      case "withdraw":if(card())withdrawModal(id);break;
      case "withdraw-type":withdrawalForm(button.dataset.kind,id);break;
      case "close-modal":closeModal();break;
      case "pick-date":openCalendar();break;
      case "calendar-next": viewingCalendar=addMonth(viewingCalendar.y,viewingCalendar.m,1);redrawCalendar();break;
      case "calendar-prev": viewingCalendar=addMonth(viewingCalendar.y,viewingCalendar.m,-1);redrawCalendar();break;
      case "calendar-today":{
        const p=today();$("#date-input").value=dateValue(p);$("#date-label").textContent=dateDisplay(dateValue(p));closeCalendar();break;
      }
      case "calendar-select":$("#date-input").value=button.dataset.date;$("#date-label").textContent=dateDisplay(button.dataset.date);closeCalendar();break;
      case "tx-detail":{
        const c=active.vault.cards.find((x)=>x.id===button.dataset.card);
        const tx=c?.transactions.find((t)=>t.id===id);
        if(c&&tx)txDetails(tx,c);break;
      }
      case "delete-tx":{
        const c=active.vault.cards.find((x)=>x.id===button.dataset.card);
        if(!c||!confirm("این تراکنش حذف شود؟ موجودی کارت دوباره محاسبه می‌شود."))break;
        c.transactions=c.transactions.filter((t)=>t.id!==id);
        try{await persist();closeModal();render();toast("تراکنش حذف و موجودی اصلاح شد.");}
        catch{closeModal();showAuth();toast("ذخیره تغییرات ناموفق بود.",true);}
        break;
      }
      case "delete-card":{
        const c=card();
        if(!c||!confirm("کارت «"+c.name+"» و تمام تراکنش‌هایش برای همیشه حذف شود؟"))break;
        active.vault.cards=active.vault.cards.filter((x)=>x.id!==id);
        try{await persist();currentCard=null;render();toast("کارت و تراکنش‌هایش حذف شدند.");}
        catch{showAuth();toast("ذخیره تغییرات ناموفق بود.",true);}
        break;
      }
      case "csv":if(card())cardCsv(card());break;
      case "export-backup":exportBackup();break;
      case "import-backup":$("#backup-file").click();break;
    }
  });
  document.addEventListener("submit",(event)=>{
    if(event.target.id==="auth-form")return handleAuth(event);
    if(event.target.id==="modal-form"){event.preventDefault();saveModalForm(event.target);}
  });
  document.addEventListener("input",(event)=>{
    if(event.target.id==="transaction-search"){
      searchText=event.target.value;
      const pos=event.target.selectionStart;
      render();
      const elem=$("#transaction-search");if(elem){elem.focus();try{elem.setSelectionRange(pos,pos);}catch{}}
    }
  });
  document.addEventListener("change",(event)=>{
    if(event.target.id==="type-filter"){typeFilter=event.target.value;render();}
    if(event.target.id==="backup-file"){
      importBackup(event.target.files?.[0]);
      event.target.value="";
    }
  });
  $("#toggle-code").addEventListener("click",()=>{
    const input=$("#auth-code"),reveal=input.type==="password";
    input.type=reveal?"text":"password";
    $("#toggle-code").innerHTML=icon(reveal?"eye-off":"eye");
    $("#toggle-code").setAttribute("aria-label",reveal?"پنهان کردن کد":"نمایش کد");
  });
  if(!window.crypto?.subtle) {
    $("#auth-error").textContent="برای رمزگذاری اطلاعات باید برنامه را در محیط HTTPS یا localhost اجرا کنید.";
    $("#auth-error").classList.remove("hidden");
    $("#auth-submit").disabled=true;
  }
  setAuthTab("login");
})();
