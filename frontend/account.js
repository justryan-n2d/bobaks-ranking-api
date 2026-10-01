import { createAuthClient } from "./account-core.mjs?v=20261001-auth-core-2";
import { buildRobloxAuthorizeUrl, createPkceChallenge, randomUrlSafeToken } from "./roblox-identity-core.mjs?v=20261001-identity-2";
window.__BOBAKS_ROBLOX_OAUTH__={buildRobloxAuthorizeUrl,createPkceChallenge,randomUrlSafeToken};

const config=window.__BOBAKS_AUTH_CONFIG__||{};
const client=createAuthClient({
  supabaseUrl:config.supabaseUrl,
  publishableKey:config.publishableKey
});
window.__BOBAKS_AUTH__=client;

const state={
  status:"loading",
  session:null,
  user:null,
  profile:null,
  alerts:null,
  error:"",
  mode:"signin",
  busy:false,
  confirmation:{pending:false,email:"",message:""},
  verification:{emailConfirmed:null,lastCheckedAt:null},
  migration:{status:"idle",sourceCount:0,syncedCount:0,failed:[]},
  robloxIdentity:null
};

const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=value=>Number(value||0).toLocaleString("en-US",{maximumFractionDigits:0});
const app=()=>window.__BOBAKS_ACCOUNT_APP__||{};
const getSaved=()=>Array.isArray(app().getSaved?.())?app().getSaved?.():[];
const setSaved=ids=>app().setSaved?.([...new Set((ids||[]).map(String).filter(id=>/^\d+$/.test(id)))].slice(0,25));
const footer=()=>app().footer?.()||"";
const icon=value=>app().icon?.(value)||"";
const render=()=>app().render?.();
const setAccountMeta=()=>app().setAccountMeta?.();
const setAuthMeta=mode=>app().authMeta?.(mode);
const setHomeMeta=()=>app().setPageMeta?.(null);
const goHome=()=>app().goHome?.();
const api=path=>window.__BOBAKS_API_REQUEST__?window.__BOBAKS_API_REQUEST__(path):fetch(path,{headers:{accept:"application/json"}}).then(async r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json()});

function isSignedIn(){return state.status==="signed_in"&&!!state.user}
function displayName(){
  return String(state.profile?.display_name||state.user?.user_metadata?.display_name||state.user?.email||"Bobaks User").trim();
}
function initials(){
  const name=displayName().replace(/[^a-zA-Z0-9 ]+/g," ").trim();
  const parts=name.split(/\s+/).filter(Boolean);
  return (parts.length>=2?parts[0][0]+parts.at(-1)[0]:name.slice(0,2)||"BR").toUpperCase();
}
function isEmailVerified(user=state.user){
  return Boolean(user?.email_confirmed_at||user?.confirmed_at);
}
function maskEmail(email){
  const value=String(email||"").trim();
  const at=value.indexOf("@");
  if(at<1)return value;
  const local=value.slice(0,at);
  const domain=value.slice(at+1);
  return local.slice(0,2)+(local.length>2?"•••":"")+"@"+domain;
}
function guestSavedCount(){return getSaved().length}
function migrationMessage(){
  const m=state.migration;
  if(m.status==="syncing")return "Syncing "+fmt(m.sourceCount)+" saved game"+(m.sourceCount===1?"":"s")+" to your account…";
  if(m.failed.length)return fmt(m.syncedCount)+" synced. "+fmt(m.failed.length)+" still on this device.";
  if(m.sourceCount)return fmt(m.syncedCount)+" saved game"+(m.syncedCount===1?"":"s")+" synced to your account.";
  return "";
}
async function migrateGuestGames(ids){
  const source=[...new Set((ids||[]).map(String).filter(id=>/^\d+$/.test(id)))].slice(0,25);
  if(!source.length){state.migration={status:"idle",sourceCount:0,syncedCount:0,failed:[]};return []}
  state.migration={status:"syncing",sourceCount:source.length,syncedCount:0,failed:[]};
  renderAccountArea();
  const results=await Promise.all(source.map(async id=>{
    try{await client.addWatchlistGame(id);return {id,ok:true}}catch{return {id,ok:false}}
  }));
  const failed=results.filter(x=>!x.ok).map(x=>x.id);
  state.migration={status:failed.length?"partial":"complete",sourceCount:source.length,syncedCount:source.length-failed.length,failed};
  return failed;
}
async function retryGuestMigration(){
  if(!isSignedIn()||state.busy||!state.migration.failed.length)return;
  state.busy=true;
  const pending=state.migration.failed.slice();
  try{
    const results=await Promise.all(pending.map(async id=>{
      try{await client.addWatchlistGame(id);return {id,ok:true}}catch{return {id,ok:false}}
    }));
    const failed=results.filter(x=>!x.ok).map(x=>x.id);
    state.migration.failed=failed;
    state.migration.status=failed.length?"partial":"complete";
    state.migration.syncedCount=state.migration.sourceCount-failed.length;
    const remote=await client.listWatchlist().catch(()=>[]);
    const remoteIds=[...new Set((remote||[]).map(row=>String(row.game_id)).filter(id=>/^\d+$/.test(id)))].slice(0,25);
    const merged=[...new Set([...remoteIds,...failed])].slice(0,25);
    setSaved(merged);
    persistSaved(merged);
    state.error=failed.length?"Some saved games are still waiting to sync.":"All saved games are synced.";
  }finally{
    state.busy=false;
    render();
  }
}
function loadGuestSaved(){
  try{
    const value=JSON.parse(localStorage.getItem("bobaks.watchlist")||"[]");
    return Array.isArray(value)?[...new Set(value.map(String).filter(id=>/^\d+$/.test(id)))].slice(0,25):[];
  }catch{return []}
}
function persistSaved(ids){
  try{localStorage.setItem("bobaks.watchlist",JSON.stringify(ids))}catch{}
}

async function hydrate({migrateGuest=true,rerender=true}={}){
  let session=await client.getSession().catch(()=>null);
  if(!session){
    session=await client.recoverSessionFromUrl({replaceUrl:()=>{
      try{history.replaceState(null,"",location.pathname+location.search)}catch{}
    }}).catch(()=>null);
  }
  if(!session){
    state.status="signed_out";
    state.session=state.user=state.profile=state.alerts=null;
    state.verification={emailConfirmed:null,lastCheckedAt:null};
    state.robloxIdentity=null;
    state.error="";
    window.__BOBAKS_ACCOUNT_ALERT_PREFS__=null;
    const guest=getSaved();
    if(guest.length===0){const local=loadGuestSaved();if(local.length)setSaved(local)}
    if(rerender)render();
    return null;
  }

  state.status="signed_in";
  state.session=session;
  state.user=session.user;
  state.verification={emailConfirmed:isEmailVerified(session.user),lastCheckedAt:new Date().toISOString()};
  state.busy=false;

  let failed=[];
  const guestBeforeMigration=migrateGuest?getSaved():[];
  if(migrateGuest&&guestBeforeMigration.length)failed=await migrateGuestGames(guestBeforeMigration);

  const [profile,alerts,watchlist,robloxIdentity]=await Promise.all([
    client.getProfile().catch(()=>null),
    client.getAlertPreferences().catch(()=>null),
    client.listWatchlist().catch(()=>[]),
    client.getRobloxIdentity().catch(()=>null)
  ]);
  state.profile=profile;
  state.alerts=alerts;
  state.robloxIdentity=robloxIdentity;
  const remoteIds=[...new Set((watchlist||[]).map(row=>String(row.game_id)).filter(id=>/^\d+$/.test(id)))].slice(0,25);
  const ids=[...new Set([...remoteIds,...failed])].slice(0,25);
  setSaved(ids);
  persistSaved(ids);
  if(!migrateGuest&&!state.migration.failed.length)state.migration={status:"idle",sourceCount:0,syncedCount:0,failed:[]};
  window.__BOBAKS_ACCOUNT_ALERT_PREFS__=alerts||null;
  if(rerender)render();
  return session;
}

function renderAccountArea(){
  const host=document.getElementById("accountArea");
  if(!host)return;
  if(state.status==="loading"){
    host.innerHTML='<div class="account-loading"><span class="account-avatar">…</span><div><b>Account</b><small>Checking session…</small></div></div>';
    return;
  }
  if(isSignedIn()){
    host.innerHTML=
      '<button class="account-card" id="accountOpen" type="button" aria-label="Open account settings">'+
        '<span class="account-avatar">'+esc(initials())+'</span>'+
        '<span class="account-copy"><b>'+esc(displayName())+'</b><small>'+esc(state.user.email||"Signed in")+'</small></span>'+
        '<span class="account-chevron">›</span>'+
      '</button>'+
      '<button class="account-signout" id="accountSignout" type="button">Sign out</button>';
    return;
  }
  const count=guestSavedCount();
  host.innerHTML=
    '<div class="account-card signed-out"><span class="account-avatar">?</span><span class="account-copy"><b>Guest mode</b><small>'+(count?fmt(count)+" saved on this device":"Optional account for sync")+'</small></span></div>'+
    '<button class="btn primary account-cta" id="accountSignIn" type="button">Sign in</button>'+
    '<button class="btn account-cta" id="accountSignUp" type="button">Create account</button>';
}

function accountLoadingPage(){return '<div class="account-loading-screen"><span class="account-spinner"></span><b>Loading account...</b></div>'}
function authPage(){
  if(state.status==="loading")return accountLoadingPage();
  if(state.confirmation.pending){
    const message=state.confirmation.message?'<div class="account-form-note">'+esc(state.confirmation.message)+'</div>':"";
    return '<section class="account-page auth-page">'+
      '<div class="account-hero"><div class="eyebrow">EMAIL VERIFICATION</div>'+
        '<h1>Check your <em>email</em></h1>'+
        '<p>We sent a confirmation link to <strong>'+esc(maskEmail(state.confirmation.email))+'</strong>. Confirm it before signing in.</p>'+
      '</div>'+
      '<section class="account-form-card">'+
        '<div class="account-verification-icon">✓</div>'+
        '<h2 class="account-confirm-title">Confirm your Bobaks account</h2>'+
        '<p class="account-confirm-copy">After confirming, return here and sign in. Your guest watchlist will still be here to sync.</p>'+
        message+
        '<button class="btn primary account-submit" id="resendConfirmation" type="button">Resend confirmation email</button>'+
        '<button class="btn account-guest" id="backToSignIn" type="button">Back to sign in</button>'+
      '</section>'+footer()+
    '</section>';
  }
  const signup=state.mode==="signup";
  const error=state.error?'<div class="account-form-error" role="alert">'+esc(state.error)+'</div>':"";
  const guestCount=guestSavedCount();
  const guestNote=guestCount
    ?'<div class="account-migration-note">'+esc(fmt(guestCount)+" saved game"+(guestCount===1?"":"s")+" on this device will be synced after sign in.")+'</div>'
    :"";
  return '<section class="account-page auth-page">'+
    '<div class="account-hero"><div class="eyebrow">BOBAKS ACCOUNT</div>'+
      '<h1>'+(signup?'Keep your Bobaks <em>in sync</em>':'Welcome back to <em>Bobaks</em>')+'</h1>'+
      '<p>'+(signup?'Create an optional account to keep your watchlist, alerts, and profile across devices.':'Sign in to sync your watchlist and alert preferences across devices. You can keep using Bobaks as a guest.')+'</p>'+
    '</div>'+
    '<section class="account-form-card">'+
      '<div class="account-switcher"><button class="'+(signup?"":"active")+'" data-auth-mode="signin" type="button">Sign in</button><button class="'+(signup?"active":"")+'" data-auth-mode="signup" type="button">Create account</button></div>'+
      error+guestNote+
      '<form id="authForm" class="account-form" novalidate>'+
        (signup?'<label>Display name <span>optional</span><input id="authDisplayName" name="displayName" maxlength="80" autocomplete="name" placeholder="How Bobaks should call you"></label>':"")+
        '<label>Email<input id="authEmail" name="email" type="email" maxlength="254" autocomplete="email" required placeholder="you@example.com"></label>'+
        '<label>Password<input id="authPassword" name="password" type="password" minlength="8" autocomplete="'+(signup?"new-password":"current-password")+'" required placeholder="At least 8 characters"></label>'+
        '<button class="btn primary account-submit" id="authSubmit" type="submit">'+(signup?"Create account":"Sign in")+'</button>'+
      '</form>'+
      '<div class="account-form-note">'+(signup?"You may need to confirm your email before the first sign-in.":"No account yet? You can create one in seconds.")+'</div>'+
      '<button class="btn account-guest" id="continueGuest" type="button">Continue as guest</button>'+
    '</section>'+footer()+
  '</section>';
}

async function accountPage(){
  const defaults={alerts_enabled:true,top10_enabled:true,new_peak_enabled:true,rank_jump_enabled:true,rank_jump_threshold:5};
  const alerts=state.alerts||defaults;
  const profile=state.profile||{};
  const ids=getSaved();
  const verified=Boolean(state.verification.emailConfirmed);
  const roblox=state.robloxIdentity;
  const cards=await Promise.all(ids.map(async id=>{
    try{const response=await api("/api/games/"+encodeURIComponent(id));return response.data||{id,name:"Game #"+id}}catch{return {id,name:"Game #"+id}}
  }));
  const error=state.error?'<div class="account-form-error" role="alert">'+esc(state.error)+'</div>':"";
  const email=esc(state.user?.email||"");
  return '<section class="account-page">'+
    '<div class="account-hero"><div class="eyebrow">YOUR ACCOUNT</div><div class="account-hero-row">'+
      '<span class="account-avatar account-avatar-large">'+esc(initials())+'</span><div><h1>'+esc(displayName())+'<em>.</em></h1><p>'+email+' · Your Bobaks identity and saved data.</p></div>'+
    '</div></div>'+
    error+
    (state.migration.failed.length
      ?'<div class="account-migration-warning" role="status"><b>Some guest saves still need syncing.</b><small>'+esc(migrationMessage())+'</small><button class="btn" id="retryGuestMigration" type="button">Retry sync</button></div>'
      :state.migration.sourceCount
        ?'<div class="account-migration-success" role="status">'+esc(migrationMessage())+'</div>'
        :"")+
    '<div class="account-grid">'+
      '<section class="account-panel"><div class="account-panel-head"><div><div class="eyebrow">PROFILE</div><h2>Your profile</h2><p>Manage the small amount of profile data Bobaks stores.</p></div></div>'+
        '<form id="profileForm" class="account-form compact">'+
          '<label>Email<input value="'+email+'" disabled aria-disabled="true"></label>'+
          '<label>Display name<input id="profileDisplayName" maxlength="80" value="'+esc(profile.display_name||"")+'" placeholder="Your Bobaks display name"></label>'+
          '<label class="account-check"><input id="profilePublic" type="checkbox" '+(profile.is_public?"checked":"")+'> Allow your profile to be shown publicly later</label>'+
          '<button class="btn primary" id="profileSubmit" type="submit">Save profile</button>'+
        '</form>'+
      '</section>'+
      '<section class="account-panel"><div class="account-panel-head"><div><div class="eyebrow">ALERTS</div><h2>Persistent alerts</h2><p>These settings follow your account across devices. Alert checks still happen when you revisit Bobaks.</p></div></div>'+
        '<form id="alertForm" class="alert-settings">'+
          '<label class="setting-row"><span><b>Enable alerts</b><small>Master switch</small></span><input id="alertsEnabled" type="checkbox" '+(alerts.alerts_enabled?"checked":"")+'></label>'+
          '<label class="setting-row"><span><b>Top 10</b><small>Saved game enters the Top 10</small></span><input id="top10Enabled" type="checkbox" '+(alerts.top10_enabled?"checked":"")+'></label>'+
          '<label class="setting-row"><span><b>New peak</b><small>Saved game reaches a new recorded peak</small></span><input id="newPeakEnabled" type="checkbox" '+(alerts.new_peak_enabled?"checked":"")+'></label>'+
          '<label class="setting-row"><span><b>Rank jump</b><small>Saved game jumps by the threshold below</small></span><input id="rankJumpEnabled" type="checkbox" '+(alerts.rank_jump_enabled?"checked":"")+'></label>'+
          '<label>Jump threshold<input id="rankJumpThreshold" type="number" min="1" max="100" value="'+(Number(alerts.rank_jump_threshold)||5)+'"></label>'+
          '<button class="btn primary" id="alertSubmit" type="submit">Save alert settings</button>'+
        '</form>'+
      '</section>'+
    '</div>'+
    '<section class="account-panel account-watchlist-panel"><div class="account-panel-head account-panel-head-row"><div><div class="eyebrow">WATCHLIST</div><h2>Saved games</h2><p>'+(ids.length?"Synced to your Bobaks account across devices.":"Save games from rankings and they will appear here.")+'</p></div><button class="btn" id="accountBrowse" type="button">Browse rankings</button></div>'+
      '<div class="account-watchlist">'+(cards.length?cards.map(g=>'<article class="account-game"><button class="account-game-main" data-game="'+g.id+'">'+icon(g.iconUrl)+'<span><b>'+esc(g.name||("Game #"+g.id))+'</b><small>'+esc(g.creatorName||"Unknown creator")+'</small></span></button><button class="mini" data-save="'+g.id+'">Remove</button></article>').join(""):'<div class="empty account-empty">No saved games yet.</div>')+'</div>'+
    '</section>'+
    '<div class="account-grid">'+
      '<section class="account-panel"><div class="account-panel-head"><div><div class="eyebrow">VERIFICATION</div><h2>Email status</h2><p>Keep your account email verified for recovery and future identity linking.</p></div></div>'+
        '<div class="account-verification-status '+(verified?"verified":"unverified")+'"><span>'+(verified?"✓":"!")+'</span><div><b>'+(verified?"Email verified":"Email confirmation needed")+'</b><small>'+(verified?"Your Supabase Auth email is confirmed.":"Check your inbox for the confirmation link.")+'</small></div></div>'+
        '<button class="btn" id="refreshVerification" type="button">Refresh verification status</button>'+
      '</section>'+
      '<section class="account-panel"><div class="account-panel-head"><div><div class="eyebrow">ROBLOX IDENTITY</div><h2>Connect Roblox</h2><p>Bobaks will use Roblox OAuth 2.0 + OpenID Connect for identity verification. No Roblox password or cookie is stored.</p></div></div>'+
        (roblox
          ?'<div class="account-verification-status verified"><span>✓</span><div><b>@'+esc(roblox.username||roblox.display_name||"Roblox user")+'</b><small>Connected · last verified '+esc(String(roblox.last_verified_at||roblox.connected_at||"").slice(0,10)||"not available")+'</small></div></div><a class="account-link" target="_blank" rel="noreferrer noopener" href="'+esc(roblox.profile_url||("https://www.roblox.com/users/"+encodeURIComponent(roblox.roblox_user_id||"")))+'">Open Roblox profile ↗</a>'
          :'<div class="account-verification-status"><span>○</span><div><b>Not connected yet</b><small>Secure OAuth callback and token exchange are the next server-side step.</small></div></div>')+
        '<button class="btn" id="connectRoblox" type="button" disabled title="Roblox connection is not enabled yet">Connect Roblox</button>'+
      '</section>'+
    '</div>'+
    '<section class="account-panel account-security"><div><div class="eyebrow">ACCOUNT</div><h2>Session</h2><p>'+(verified?"Email verified.":"Email confirmation still pending.")+' Core rankings and search remain available without an account.</p></div><button class="btn" id="accountSignOut" type="button">Sign out</button></section>'+
    footer()+
  '</section>';
}

function goAuth(mode="signin",{push=true}={}){
  state.mode=mode==="signup"?"signup":"signin";
  state.error="";
  if(push&&location.pathname!=="/account")history.pushState({view:"auth"},"","/account");
  setAuthMeta(state.mode);
  render();
}
function goAccount({push=true}={}){
  if(!isSignedIn()){goAuth("signin",{push});return}
  state.error="";
  if(push&&location.pathname!=="/account")history.pushState({view:"account"},"","/account");
  setAccountMeta();
  render();
}
async function resendConfirmation(){
  const email=String(state.confirmation.email||"").trim();
  if(!email||state.busy)return;
  state.busy=true;
  state.confirmation.message="";
  state.error="";
  render();
  try{
    await client.resendSignupConfirmation(email,new URL("/account",location.origin).toString());
    state.confirmation.message="A fresh confirmation email was requested.";
  }catch(error){
    state.confirmation.message=String(error?.message||"Could not resend the confirmation email yet.");
  }finally{
    state.busy=false;
    render();
  }
}
async function refreshVerification(){
  if(!isSignedIn()||state.busy)return;
  state.busy=true;
  try{
    const user=await client.getUser();
    state.user=user;
    state.verification={emailConfirmed:isEmailVerified(user),lastCheckedAt:new Date().toISOString()};
    state.error="";
  }catch(error){state.error=String(error?.message||"Could not refresh verification status.")}
  finally{state.busy=false;render()}
}

async function submitAuth(){
  const form=document.getElementById("authForm");
  if(!form||state.busy)return;
  const data=new FormData(form);
  state.busy=true;
  state.error="";
  render();
  try{
    const result=state.mode==="signup"
      ?await client.signUp({email:String(data.get("email")||"").trim(),password:String(data.get("password")||""),displayName:String(data.get("displayName")||"").trim(),emailRedirectTo:new URL("/account",location.origin).toString()})
      :await client.signIn({email:String(data.get("email")||"").trim(),password:String(data.get("password")||"")});
    if(result.session){
      await hydrate({migrateGuest:true,rerender:false});
      state.error="";
      if(isSignedIn()){setAccountMeta()}
    }else{
      state.confirmation={pending:true,email:String(data.get("email")||"").trim(),message:""};
      state.error="";
    }
    if(result.session)history.replaceState({view:"account"},"","/account");
  }catch(error){
    state.error=String(error?.message||"Authentication failed. Please try again.");
  }finally{
    state.busy=false;
    render();
  }
}

async function submitProfile(){
  if(!isSignedIn()||state.busy)return;
  state.busy=true;
  try{
    state.profile=await client.updateProfile({
      display_name:String(document.getElementById("profileDisplayName")?.value||"").trim()||null,
      is_public:Boolean(document.getElementById("profilePublic")?.checked)
    });
    state.error="";
  }catch(error){state.error=String(error?.message||"Could not save your profile.")}
  finally{state.busy=false;render()}
}
async function submitAlerts(){
  if(!isSignedIn()||state.busy)return;
  state.busy=true;
  try{
    state.alerts=await client.updateAlertPreferences({
      alerts_enabled:Boolean(document.getElementById("alertsEnabled")?.checked),
      top10_enabled:Boolean(document.getElementById("top10Enabled")?.checked),
      new_peak_enabled:Boolean(document.getElementById("newPeakEnabled")?.checked),
      rank_jump_enabled:Boolean(document.getElementById("rankJumpEnabled")?.checked),
      rank_jump_threshold:Number(document.getElementById("rankJumpThreshold")?.value||5)
    });
    state.error="";
    window.__BOBAKS_ACCOUNT_ALERT_PREFS__=state.alerts||null;
  }catch(error){state.error=String(error?.message||"Could not save alert settings.")}
  finally{state.busy=false;render()}
}
async function signOut(){
  if(state.busy)return;
  state.busy=true;
  let error="";
  try{await client.signOut()}catch(err){error=String(err?.message||"Signed out locally.")}
  state.status="signed_out";
  state.session=state.user=state.profile=state.alerts=null;
  state.error=error;
  state.busy=false;
  state.confirmation={pending:false,email:"",message:""};
  state.verification={emailConfirmed:null,lastCheckedAt:null};
  state.robloxIdentity=null;
  window.__BOBAKS_ACCOUNT_ALERT_PREFS__=null;
  const local=getSaved();
  if(local.length===0){const fallback=loadGuestSaved();if(fallback.length)setSaved(fallback)}
  goHome();
}

client.onAuthStateChange((event,session)=>{
  if(event==="SIGNED_OUT"){
    state.status="signed_out";
    state.session=state.user=state.profile=state.alerts=null;
    state.error="";
    state.confirmation={pending:false,email:"",message:""};
    state.verification={emailConfirmed:null,lastCheckedAt:null};
    state.robloxIdentity=null;
    window.__BOBAKS_ACCOUNT_ALERT_PREFS__=null;
    const fallback=loadGuestSaved();if(fallback.length)setSaved(fallback);
    render();
  }else if(event==="SIGNED_IN"||event==="SIGNED_UP"||event==="TOKEN_REFRESHED"){
    hydrate({migrateGuest:event!=="TOKEN_REFRESHED",rerender:true}).catch(()=>{});
  }
});

window.__BOBAKS_ACCOUNT_UI__={
  client:()=>client,
  resendConfirmation,
  refreshVerification,
  retryGuestMigration,
  isSignedIn,
  isBusy:()=>state.busy,
  state,
  hydrate,
  renderAccountArea,
  authPage,
  accountPage,
  goAuth,
  goAccount,
  submitAuth,
  submitProfile,
  submitAlerts,
  signOut
};

document.addEventListener("click",event=>{
  const button=event.target?.closest?.("#resendConfirmation,#backToSignIn,#refreshVerification,#retryGuestMigration,#savedAccountCta");
  if(!button)return;
  if(button.id==="resendConfirmation")resendConfirmation();
  else if(button.id==="backToSignIn"){state.confirmation={pending:false,email:"",message:""};goAuth("signin",{push:false})}
  else if(button.id==="refreshVerification")refreshVerification();
  else if(button.id==="retryGuestMigration")retryGuestMigration();
  else if(button.id==="savedAccountCta")goAuth("signin");
});

const authReady=authReadyBootstrap();
async function authReadyBootstrap(){
  await hydrate({migrateGuest:true,rerender:false}).catch(()=>{
    state.status="signed_out";
  });
  window.__BOBAKS_AUTH_READY_RESOLVED__=true;
  renderAccountArea();
  window.dispatchEvent(new CustomEvent("bobaks:auth-ready",{detail:{available:true,signedIn:isSignedIn()}}));
  window.dispatchEvent(new CustomEvent("bobaks:account-ready",{detail:{available:true,signedIn:isSignedIn()}}));
}
