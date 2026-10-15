import { createClient } from "npm:@supabase/supabase-js@2.75.0";

// Public registration endpoint. The secret service-role key is obtained only
// from Supabase Edge Function environment variables; never put it in GitHub.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
function respond(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload),{status,headers});
}
function latinDigits(value: string) {
  return value.replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776))
              .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
}
Deno.serve(async (request) => {
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(request.method!=="POST")return respond({error:"Method not allowed"},405);
  const length=Number(request.headers.get("content-length")||"0");
  if(length>4096)return respond({error:"Request body too large"},413);
  let raw: Record<string,unknown>;
  try{raw=await request.json();}catch{return respond({error:"Invalid JSON"},400);}
  if(!raw || typeof raw!=="object")return respond({error:"Invalid request"},400);
  const first=typeof raw.first==="string"?raw.first.trim():"";
  const last=typeof raw.last==="string"?raw.last.trim():"";
  const code=typeof raw.code==="string"?latinDigits(raw.code.trim()):"";
  if(!first||!last||first.length>60||last.length>60 ||
     code.length<12||code.length>128||!/[A-Za-z]/.test(code)||!/[0-9]/.test(code)){
    return respond({error:"نام، نام خانوادگی و کد دارای حداقل ۱۲ نویسه، عدد و حرف انگلیسی الزامی است."},422);
  }
  const url=Deno.env.get("SUPABASE_URL");
  const adminKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!adminKey)return respond({error:"تنظیمات سرویس ناقص است."},500);

  const rawKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(code),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({
    name:"PBKDF2",salt:new TextEncoder().encode("mana-login-alias-v2"),iterations:250000,hash:"SHA-256"
  },rawKey,256);
  const hash=Array.from(new Uint8Array(bits),v=>v.toString(16).padStart(2,"0")).join("");
  const email="mana-"+hash+"@users.example.com";

  const admin=createClient(url,adminKey,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {error}=await admin.auth.admin.createUser({
    email,password:code,email_confirm:true,
    user_metadata:{first_name:first,last_name:last,app:"mana"}
  });
  if(error){
    if(/registered|exists|duplicate|already/i.test(error.message))
      return respond({error:"این کد اختصاصی قبلاً ثبت شده است."},409);
    console.error("Failed to register Mana user",error.code||error.status||"unknown");
    return respond({error:"ثبت‌نام ناموفق بود. وضعیت Supabase Auth را بررسی کنید."},500);
  }
  return respond({ok:true},201);
});
