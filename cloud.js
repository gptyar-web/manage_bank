import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
const SUPABASE_URL = "https://efibfevyiepkwpnobaro.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmaWJmZXZ5aWVwa3dwbm9iYXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NDI5ODEsImV4cCI6MjEwNjQxODk4MX0.qv4UjC8UM_MuVu-bGY4ufR8HRWM4YDJ_B0UvzUv1GOA";
const supabase = createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
  auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}
});
const normalizeCode = (text)=>String(text).trim().replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
async function emailFor(code) {
  const bytes = new TextEncoder().encode("mana-login-v1:"+normalizeCode(code));
  const hashed = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return "mana-"+[...hashed].map(b=>b.toString(16).padStart(2,"0")).join("")+"@users.example.com";
}
async function requireSuccess(query){
  const {data,error}=await query;
  if(error) throw new Error(error.message||"خطا در ارتباط با پایگاه داده.");
  return data;
}
async function fetchAll(table,fields){
  let offset=0,rows=[],batch;
  do {
    batch=await requireSuccess(supabase.from(table).select(fields).range(offset,offset+499));
    rows.push(...batch);
    offset+=batch.length;
  } while(batch.length===500);
  return rows;
}
export const cloud = {
  async register(first,last,code){
    const {data,error}=await supabase.functions.invoke("mana-register",{body:{first,last,code:normalizeCode(code)}});
    if(error){
      let message="ایجاد حساب در Supabase انجام نشد.";
      try{
        const result=await error.context.json();
        if(result?.error) message=result.error;
      }catch{}
      throw new Error(message);
    }
    if(!data?.ok)throw new Error(data?.error||"خطا در ثبت‌نام");
  },
  async login(code){
    const email=await emailFor(code);
    const {data,error}=await supabase.auth.signInWithPassword({email,password:normalizeCode(code)});
    if(error)throw new Error("کد اختصاصی اشتباه است یا حساب هنوز ثبت نشده است.");
    return data.user;
  },
  async logout(){
    await supabase.auth.signOut({scope:"local"});
  },
  async fetchVault(user){
    const [cards,transactions]=await Promise.all([
      fetchAll("mana_cards","id,name,number,opening_balance,created_at"),
      fetchAll("mana_transactions","id,card_id,type,amount,date,time,details,created_at")
    ]);
    const mapped=cards.map(c=>({
      id:c.id,name:c.name,number:c.number,openingBalance:Number(c.opening_balance),transactions:[]
    }));
    const lookup=new Map(mapped.map(c=>[c.id,c]));
    for(const t of transactions){
      const card=lookup.get(t.card_id);
      if(card)card.transactions.push({
        ...t.details,id:t.id,type:t.type,amount:Number(t.amount),
        date:t.date,time:t.time,createdAt:t.created_at
      });
    }
    return {
      first:user.user_metadata?.first_name||"کاربر",
      last:user.user_metadata?.last_name||"مانا",
      cards:mapped
    };
  },
  async createCard(userId,name,number,opening){
    return requireSuccess(supabase.from("mana_cards").insert({
      user_id:userId,name,number,opening_balance:opening
    }).select("id").single());
  },
  async updateCard(id,name,number,opening){
    return requireSuccess(supabase.from("mana_cards").update({
      name,number,opening_balance:opening
    }).eq("id",id).select("id").single());
  },
  async createTransaction(userId,cardId,item){
    const {type,amount,date,time,createdAt,...details}=item;
    return requireSuccess(supabase.from("mana_transactions").insert({
      user_id:userId,card_id:cardId,type,amount,date,time,details
    }).select("id").single());
  },
  async deleteTransaction(id){
    return requireSuccess(supabase.from("mana_transactions").delete().eq("id",id));
  },
  async deleteCard(id){
    return requireSuccess(supabase.from("mana_cards").delete().eq("id",id));
  },
  async importVault(userId,vault){
    let cardsCount=0, txCount=0;
    for(const card of vault.cards||[]){
      const number=String(card.number||"").replace(/\D/g,"");
      if(!/^\d{16}$/.test(number))continue;
      const {data:existing,error}=await supabase.from("mana_cards").select("id").eq("number",number).limit(1);
      if(error)throw Error(error.message);
      if(existing.length)continue;
      const saved=await this.createCard(userId,String(card.name||"کارت بازیابی‌شده").slice(0,50),number,Number(card.openingBalance)||0);
      cardsCount++;
      for(const tx of card.transactions||[]){
        if(!["deposit","pos","online","transfer"].includes(tx.type))continue;
        if(!Number.isSafeInteger(tx.amount)||tx.amount<=0)continue;
        const {id,createdAt,...item}=tx;
        await this.createTransaction(userId,saved.id,item);txCount++;
      }
    }
    return {cardsCount,txCount};
  }
};
