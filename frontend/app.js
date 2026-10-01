
'use strict';
const API='/api';window.__BOBAKS_API__=API;
const periods=[['live','Live'],['week','This Week'],['month','This Month'],['year','This Year']];
const RANKING_PATHS={live:'/',week:'/rankings/weekly',month:'/rankings/monthly',year:'/rankings/yearly'};
const COMMUNITY_META={title:'Bobaks Ranking Community | Discord, Feedback & Game Discovery',description:'Join the Bobaks Ranking community, share feedback, request features, report bugs, and discuss Roblox game discovery.'};
const DISCORD_INVITE_URL=window.__BOBAKS_COMMUNITY__?.discordInviteUrl||'';
const COMMUNITY_DISCORD_URL=DISCORD_INVITE_URL;
const RANKING_META={
  live:{title:'Live Roblox Game Rankings | Bobaks Ranking',description:'See the latest live Roblox experience rankings, player counts, and rank movement collected by Bobaks Ranking.'},
  week:{title:"This Week's Roblox Game Rankings | Bobaks Ranking",description:"See this week's Roblox experience rankings, player activity, and rank movement collected by Bobaks Ranking."},
  month:{title:"This Month's Roblox Game Rankings | Bobaks Ranking",description:"See this month's Roblox experience rankings, player activity, and rank movement collected by Bobaks Ranking."},
  year:{title:"This Year's Roblox Game Rankings | Bobaks Ranking",description:"See this year's Roblox experience rankings, player activity, and rank movement collected by Bobaks Ranking."}
};
const state={
  view:'home',period:'live',theme:'dark',rankingExpanded:true,rankingLimit:15,movingLimit:2,
  games:[],saved:[],compare:[],selected:null,query:'',results:[],loading:false,error:'',
  next:null,timer:null,searchRequest:0
};
const $=id=>document.getElementById(id);
const GAME_ROUTE=/^\/game\/(\d+)$/;
const gameUrl=id=>new URL('/game/'+encodeURIComponent(String(id)),location.origin).toString();
const rankingPath=period=>RANKING_PATHS[period]||'/';
function periodFromLocation(){
  if(location.pathname==='/rankings/weekly')return 'week';
  if(location.pathname==='/rankings/monthly')return 'month';
  if(location.pathname==='/rankings/yearly')return 'year';
  const query=new URLSearchParams(location.search).get('period');
  return periods.some(x=>x[0]===query)?query:'live';
}
function setRankingMeta(period){
  const meta=RANKING_META[period]||RANKING_META.live;
  document.title=meta.title;
  const desc=document.querySelector('#seo-description');if(desc)desc.content=meta.description;
  const canonicalEl=document.querySelector('#seo-canonical');if(canonicalEl)canonicalEl.href=new URL(rankingPath(period),location.origin).toString();
  const canonical=new URL(rankingPath(period),location.origin).toString();
  const ogTitle=document.querySelector('#seo-og-title');if(ogTitle)ogTitle.content=meta.title;
  const ogDesc=document.querySelector('#seo-og-description');if(ogDesc)ogDesc.content=meta.description;
  const ogUrl=document.querySelector('#seo-og-url');if(ogUrl)ogUrl.content=canonical;
  const ogImage=document.querySelector('#seo-og-image');if(ogImage)ogImage.content=new URL('/assets/bobaks-logo.png',location.origin).toString();
  const twTitle=document.querySelector('#seo-twitter-title');if(twTitle)twTitle.content=meta.title;
  const twDesc=document.querySelector('#seo-twitter-description');if(twDesc)twDesc.content=meta.description;
  const twImage=document.querySelector('#seo-twitter-image');if(twImage)twImage.content=new URL('/assets/bobaks-logo.png',location.origin).toString();
}
function setCommunityMeta(){
  document.title=COMMUNITY_META.title;
  const desc=document.querySelector('#seo-description');if(desc)desc.content=COMMUNITY_META.description;
  const canonical=new URL('/community',location.origin).toString();
  const canonicalEl=document.querySelector('#seo-canonical');if(canonicalEl)canonicalEl.href=canonical;
  const ogTitle=document.querySelector('#seo-og-title');if(ogTitle)ogTitle.content=COMMUNITY_META.title;
  const ogDesc=document.querySelector('#seo-og-description');if(ogDesc)ogDesc.content=COMMUNITY_META.description;
  const ogUrl=document.querySelector('#seo-og-url');if(ogUrl)ogUrl.content=canonical;
  const twTitle=document.querySelector('#seo-twitter-title');if(twTitle)twTitle.content=COMMUNITY_META.title;
  const twDesc=document.querySelector('#seo-twitter-description');if(twDesc)twDesc.content=COMMUNITY_META.description;
  const twImage=document.querySelector('#seo-twitter-image');if(twImage)twImage.content=new URL('/assets/bobaks-logo.png',location.origin).toString();
}
function goCommunity({push=true}={}){
  if(push&&location.pathname!=='/community')history.pushState({view:'community'},'', '/community');
  state.view='community';state.selected=null;state.error='';setCommunityMeta();render();track('page_view',{route:'/community'});
}

function communityAction(title,copy,href,label,disabled=false){
  const action=disabled
    ? '<span class="btn community-disabled" aria-disabled="true">'+label+'</span>'
    : '<a class="btn primary" href="'+esc(href)+'">'+label+'</a>';
  return '<article class="community-card"><div class="community-icon" aria-hidden="true">'+title.slice(0,1)+'</div><div><h2>'+esc(title)+'</h2><p>'+esc(copy)+'</p></div>'+action+'</article>';
}
function communityPage(){
  const discordReady=!!COMMUNITY_DISCORD_URL;
  const discordHref=discordReady?COMMUNITY_DISCORD_URL:'#';
  const discordAction=discordReady
    ? '<a class="btn primary" target="_blank" rel="noreferrer noopener" href="'+esc(discordHref)+'">Join Discord</a>'
    : '<span class="btn community-disabled" aria-disabled="true">Discord link not configured yet.</span>';
  const pollAction=discordReady
    ? '<a class="btn primary" target="_blank" rel="noreferrer noopener" href="'+esc(discordHref)+'">Open Discord</a>'
    : '<a class="btn" href="mailto:bobaksranking@gmail.com?subject=Community%20poll">Suggest a poll</a>';
  const discoveryAction=discordReady
    ? '<a class="btn primary" target="_blank" rel="noreferrer noopener" href="'+esc(discordHref)+'">Open Discord</a>'
    : '<a class="btn" href="mailto:bobaksranking@gmail.com?subject=Game%20discovery">Send a game</a>';
  return '<section class="hero"><div class="hero-main"><div class="eyebrow">BOBAKS COMMUNITY</div><h1>Build Bobaks <em>with us</em></h1><p>Talk about Roblox games, share ideas, report problems, and help shape what Bobaks builds next.</p></div></section><section class="community-grid">'+
    '<article class="community-card community-primary"><div class="community-icon" aria-hidden="true">D</div><div><div class="community-label">COMMUNITY HOME</div><h2>Discord community</h2><p>Chat with other gamers, discuss rankings, share discoveries, and take part in Bobaks community activity.</p></div>'+discordAction+'</article>'+
    communityAction('Feedback','Tell us what is useful, confusing, missing, or worth improving.','mailto:bobaksranking@gmail.com?subject=Bobaks%20Feedback','Send feedback')+
    communityAction('Feature requests','Suggest a feature and explain what problem it would solve for you.','mailto:bobaksranking@gmail.com?subject=Bobaks%20Feature%20Request','Request a feature')+
    communityAction('Bug reports','Report a broken page, wrong display, or other issue with the page URL included.','mailto:bobaksranking@gmail.com?subject=Bobaks%20Bug%20Report','Report a bug')+
    '<article class="community-card"><div class="community-icon" aria-hidden="true">P</div><div><h2>Community polls</h2><p>Help guide future improvements and vote on community questions through Discord when the server link is configured.</p></div>'+pollAction+'</article>'+
    '<article class="community-card"><div class="community-icon" aria-hidden="true">G</div><div><h2>Game discovery</h2><p>Share Roblox experiences you think Bobaks should track or discuss with the community.</p></div>'+discoveryAction+'</article>'+
    '</section><section class="panel community-note"><h2>Keep reports useful</h2><p>For bug reports, include the Bobaks page URL, what you expected, and what happened. For feature requests, describe the problem first so the community can discuss the need behind the idea.</p></section>'+footer();
}

function setAccountMeta(){document.title="Account | Bobaks Ranking";const canonical=document.querySelector("#seo-canonical");if(canonical)canonical.href=new URL("/account",location.origin).toString()}
function authMeta(mode){document.title=(mode==="signup"?"Create a Bobaks Account":"Sign in")+" | Bobaks Ranking";const canonical=document.querySelector("#seo-canonical");if(canonical)canonical.href=new URL("/account",location.origin).toString()}

function setPageMeta(game){
  const name=String(game?.name||'');
  if(game&&name){
    const title=name+' | Bobaks Ranking';
    const description=String(game.description||'Current players, Bobaks rank, recorded peak, and historical trends for '+name+'.').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
    document.title=title;
    const desc=document.querySelector('#seo-description');if(desc)desc.content=description;
    const canonical=gameUrl(game.gameId||game.id);
    const canonicalEl=document.querySelector('#seo-canonical');if(canonicalEl)canonicalEl.href=canonical;
    const ogTitle=document.querySelector('#seo-og-title');if(ogTitle)ogTitle.content=title;
    const ogDesc=document.querySelector('#seo-og-description');if(ogDesc)ogDesc.content=description;
    const ogUrl=document.querySelector('#seo-og-url');if(ogUrl)ogUrl.content=canonical;
    const ogImage=document.querySelector('#seo-og-image');if(ogImage)ogImage.content=String(game.iconUrl||new URL('/assets/bobaks-logo.png',location.origin));
    const twTitle=document.querySelector('#seo-twitter-title');if(twTitle)twTitle.content=title;
    const twDesc=document.querySelector('#seo-twitter-description');if(twDesc)twDesc.content=description;
    const twImage=document.querySelector('#seo-twitter-image');if(twImage)twImage.content=String(game.iconUrl||new URL('/assets/bobaks-logo.png',location.origin));
    return;
  }
  setRankingMeta(state.period);
}

function track(event,data={}){
  const analyticsContext=window.__BOBAKS_ANALYTICS__?.context?.()||{};
  const payload={event,route:location.pathname,period:data.period||state.period,gameId:data.gameId?String(data.gameId):undefined,channel:data.channel,visitorId:analyticsContext.visitorId,sessionId:analyticsContext.sessionId};
  const body=JSON.stringify(payload);
  try{if(navigator.sendBeacon&&navigator.sendBeacon('/analytics',new Blob([body],{type:'application/json'})))return}catch{}
  fetch('/analytics',{method:'POST',headers:{'content-type':'application/json'},body,keepalive:true}).catch(()=>{});
}
function goHome({push=true}={}){
  const target=rankingPath(state.period);
  if(push&&(location.pathname!==target||location.search))history.pushState({period:state.period},'',target);
  state.view='home';state.selected=null;state.error='';setPageMeta(null);render();track('page_view',{period:state.period});loadRankings();
}

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(Number(v)||0);
const fmtTime=v=>new Date(v).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true});
const fmtDateTime=v=>new Date(v).toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
const API_CACHE=new Map();
const API_DEFAULT_TTL=12000;
function apiCacheTtl(path){
  if(path.startsWith('/api/rankings'))return 8000;
  if(path.startsWith('/api/search'))return 30000;
  if(path.startsWith('/api/games/'))return 60000;
  if(path.startsWith('/api/social/feed'))return 30000;
  return API_DEFAULT_TTL;
}
async function api(path,{cache=true}={}){
  if(!API)return Promise.reject(new Error('API origin unavailable'));
  const key=String(path);
  const requestPath=key.startsWith(API+'/')?key.slice(API.length):key;
  const now=Date.now();
  if(cache){
    const hit=API_CACHE.get(key);
    if(hit&&hit.expiresAt>now)return hit.promise;
  }
  const promise=fetch(API+requestPath,{headers:{accept:'application/json'},cache:cache?'default':'no-store'}).then(async r=>{
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).catch(error=>{
    const current=API_CACHE.get(key);
    if(current?.promise===promise)API_CACHE.delete(key);
    throw error;
  });
  if(cache)API_CACHE.set(key,{expiresAt:now+apiCacheTtl(key),promise});
  return promise;
}
window.__BOBAKS_API_REQUEST__=api;
function loadTheme(){try{const saved=localStorage.getItem('bobaks.theme');state.theme=saved==='light'?'light':'dark'}catch{state.theme='dark'}document.documentElement.setAttribute('data-theme',state.theme)}
function setTheme(theme){state.theme=theme==='light'?'light':'dark';document.documentElement.setAttribute('data-theme',state.theme);try{localStorage.setItem('bobaks.theme',state.theme)}catch{};nav()}
function loadSaved(){try{const v=JSON.parse(localStorage.getItem('bobaks.watchlist')||'[]');if(Array.isArray(v))state.saved=[...new Set(v.map(String))].slice(0,25)}catch{state.saved=[]}}
function saveSaved(){try{localStorage.setItem('bobaks.watchlist',JSON.stringify(state.saved))}catch{}}
window.__BOBAKS_ACCOUNT_APP__={
  getSaved:()=>state.saved.slice(),
  setSaved:ids=>{
    state.saved=[...new Set((ids||[]).map(String).filter(id=>/^\d+$/.test(id)))].slice(0,25);
    saveSaved();
    render();
  },
  render:()=>render(),
  goHome:()=>goHome(),
  footer,
  icon,
  api,
  track,
  setAccountMeta,
  authMeta,
  setPageMeta,
  esc
};
function nav(){
  $('rankNav')?.classList.toggle('active',state.view==='home');
  $('savedNav')?.classList.toggle('active',state.view==='saved');
  $('communityNav')?.classList.toggle('active',state.view==='community');
  if($('savedCount'))$('savedCount').textContent=state.saved.length?'('+state.saved.length+')':'';
  if($('compareNav')){$('compareNav').hidden=state.compare.length===0;$('compareNav').textContent='Compare ('+state.compare.length+')'}
  const themeBtn=$('themeNav');if(themeBtn){themeBtn.textContent=state.theme==='dark'?'☾ Dark':'☀ Light';themeBtn.title=state.theme==='dark'?'Switch to light mode':'Switch to dark mode';themeBtn.setAttribute('aria-label',themeBtn.title)}
  renderAccountArea();
}
function accountUI(){return window.__BOBAKS_ACCOUNT_UI__||null}
let accountModulePromise,accountModuleAttempt=0;
function ensureAccountModule(){
  if(window.__BOBAKS_ACCOUNT_UI__)return Promise.resolve(window.__BOBAKS_ACCOUNT_UI__);
  const url='/account.js?v=20261001-auth-5-'+(++accountModuleAttempt);
  accountModulePromise=import(url).catch(error=>{
    console.error('Bobaks account module failed:',error);
    accountModulePromise=null;
    if(location.pathname==='/account'){
      $('app').innerHTML='<div class="banner error" role="alert">Account failed to load. <button class="btn primary" id="retryAccountModule" type="button">Retry</button></div>';
      $('retryAccountModule')?.addEventListener('click',()=>location.reload(),{once:true});
    }
    return null;
  });
  return accountModulePromise;
}
function authClient(){return accountUI()?.client?.()||null}
function isSignedIn(){return !!accountUI()?.isSignedIn?.()}
function renderAccountArea(){accountUI()?.renderAccountArea?.()}
function authPage(){return accountUI()?.authPage?.()||'<div class="banner">Loading account...</div>'}
function accountPage(){return accountUI()?.accountPage?.()||Promise.resolve('<div class="banner">Loading account...</div>')}
function goAuth(mode='signin',opts={}){return accountUI()?.goAuth?.(mode,opts)}
function goAccount(opts={}){return accountUI()?.goAccount?.(opts)}
function submitAuth(){return accountUI()?.submitAuth?.()}
function submitProfile(){return accountUI()?.submitProfile?.()}
function submitAlertSettings(){return accountUI()?.submitAlerts?.()}
function signOutAccount(){return accountUI()?.signOut?.()}
function accountBusy(){return !!accountUI()?.isBusy?.()}
function accountState(){return accountUI()?.state||null}

function fallbackNext(){const n=Date.now(),step=600000;return new Date((Math.floor(n/step)+1)*step+15000).toISOString()}
function schedule(){if(state.timer)clearTimeout(state.timer);if(state.next)state.timer=setTimeout(loadRankings,Math.max(1000,new Date(state.next).getTime()-Date.now()))}
const RANKING_SHARE_LABELS={live:'Top 10 Roblox games right now',week:"Top 10 Roblox games this week",month:"Top 10 Roblox games this month",year:"Top 10 Roblox games this year"};
function rankingShareText(period,games){
  const title=RANKING_SHARE_LABELS[period]||RANKING_SHARE_LABELS.live;
  const lines=(games||[]).slice(0,10).map((g,index)=>{
    const rank=Number(g.rank||index+1);
    const players=fmt(g.playing);
    return rank+'. '+String(g.name||'Unknown game')+' · '+players+' players';
  });
  const url=new URL(rankingPath(period),location.origin).toString();
  return [title,'',...lines,'','Visit Bobaks Ranking:',url].join('\n');
}
async function shareSocialPost(kind){
  const status=$('socialStatus');
  const setStatus=message=>{if(status){status.textContent=message;status.classList.add('show')}};
  try{
    const response=await api('/api/social/feed?period='+encodeURIComponent(state.period));
    const post=response.posts?.[kind];
    if(!post?.text)throw new Error('Social post unavailable');
    const postUrl=String(post.url||new URL(rankingPath(state.period),location.origin).toString());
    const title=String(post.title||'Bobaks Ranking');
    if(navigator.share){
      await navigator.share({title,text:post.text,url:postUrl});
      track('ranking_share',{period:state.period,channel:'social_'+kind});
      setStatus('Shared '+kind+' content.');
      return;
    }
    if(navigator.clipboard){
      await navigator.clipboard.writeText(post.text);
      track('ranking_share',{period:state.period,channel:'social_'+kind});
      setStatus('Share caption copied.');
      return;
    }
    setStatus('Sharing is unavailable on this browser.');
  }catch(error){
    if(error?.name==='AbortError')return;
    setStatus('Social content is unavailable right now. Try again after the next ranking refresh.');
  }
}
async function shareRanking(){
  await shareSocialPost('ranking');
}
function movement(g){if(g.previousRank==null)return '<span class="new movement-badge">NEW</span>';const d=Number(g.rankChange||0);if(d>0)return '<span class="up movement-badge">▲ '+d+' rank'+(d===1?'':'s')+'</span>';if(d<0)return '<span class="down movement-badge">▼ '+Math.abs(d)+' rank'+(Math.abs(d)===1?'':'s')+'</span>';return '<span class="movement-badge">• No change</span>'}
function icon(url){return url?'<img src="'+esc(url)+'" alt="" loading="lazy" decoding="async">':'<div class="cover"></div>'}
async function loadRankings(force=false){
  state.loading=true;state.error='';render();
  try{
    const p=await api('/api/rankings?period='+encodeURIComponent(state.period),{cache:false});
    window.__BOBAKS_RANKING_SNAPSHOT__={period:state.period,data:p.data||[],updatedAt:p.updatedAt||null};
    const previous=new Map(state.games.map(g=>[g.gameId,g]));
    state.games=(p.data||[]).map(x=>{
      const id=String(x.gameId),old=previous.get(id),playing=Number(x.score||0);
      return {rank:Number(x.rank),gameId:id,name:x.game?.name||'Unknown game',creator:x.game?.creatorName||'Unknown creator',icon:x.game?.iconUrl||'',playing,previousPlaying:old?.playing??null,changed:old!=null&&playing!==old.playing,previousRank:x.previousRank==null?null:Number(x.previousRank),rankChange:x.rankChange==null?null:Number(x.rankChange),calculatedAt:x.calculatedAt||null,placeId:Number(x.game?.placeId||0)}
    });
    state.next=p.nextCollectionAt||fallbackNext()
  }catch(e){
    state.games=[];state.next=null;state.error='Ranking data could not be loaded right now. Try again in a moment.'
  }finally{state.loading=false;render();schedule()}
}
function renderSearchResults(){
  const el=document.querySelector('.results');
  if(!el)return;
  el.innerHTML=state.results.map(g=>'<button data-search-game="'+g.id+'"><b>'+esc(g.name)+'</b><br><small>'+esc(g.creator)+'</small></button>').join('');
  document.querySelectorAll('[data-search-game]').forEach(b=>b.onclick=()=>{state.results=[];openGame(b.dataset.searchGame)});
}
async function search(q){
  const query=q.trim();
  const requestId=++state.searchRequest;
  if(query.length<2){state.results=[];renderSearchResults();return}
  try{
    const p=await api('/api/search?q='+encodeURIComponent(query));
    if(requestId!==state.searchRequest || query!==state.query.trim())return;
    state.results=(p.data||[]).map(x=>({id:String(x.id),name:x.name,creator:x.creatorName||'Unknown creator'}));
    track('search_used',{period:state.period});
    renderSearchResults();
  }catch{
    if(requestId!==state.searchRequest)return;
    state.results=[];
    renderSearchResults();
  }
}
function footer(){return '<footer class="foot"><div>Bobaks Ranking · Independent fan-made analytics site · Not affiliated with Roblox Corporation.</div><div><button data-info="methodology">How Rankings Work</button> <button data-info="privacy">Privacy</button> <button data-info="terms">Terms</button> <button data-info="sources">Data Sources</button></div></footer>'}
function home(){
  const tabs=periods.map(p=>'<button class="'+(state.period===p[0]?'active':'')+'" data-period="'+p[0]+'">'+p[1]+'</button>').join('');
  let rows='';
  if(state.loading&&!state.games.length)rows='<div class="empty">Loading live ranking data...</div>';
  else if(!state.games.length)rows='<div class="empty">No ranking data is available right now.</div>';
  else {
    const visibleGames=state.period==='live'?state.games.slice(0,state.rankingLimit):state.games;
    rows=visibleGames.map((g,i)=>{
      const valueAnim=g.changed&&g.previousPlaying!=null?' data-from="'+g.previousPlaying+'" data-to="'+g.playing+'"':'';
      return '<div class="row '+(g.changed?'value-changed ':'')+(i===0?'top-ranked':'')+'"><span class="rank">#'+g.rank+'</span><button class="game" data-game="'+g.gameId+'">'+icon(g.icon)+'<span><b>'+esc(g.name)+(g.rank===1?'<span class="top-badge">★ #1</span>':g.rank===2?'<span class="top-badge rank-2">★ #2</span>':g.rank===3?'<span class="top-badge rank-3">★ #3</span>':'')+'</b><small>'+esc(g.creator)+'</small><span class="game-tags"><span class="tag">'+(state.period==='live'?'<span class="live-pulse"></span>Live players':periods.find(p=>p[0]===state.period)[1])+'</span></span></span></button><span class="creator">'+esc(g.creator)+'</span><span class="players"><b class="live-value"'+valueAnim+'>'+fmt(g.playing)+'</b><small>'+(state.period==='live'?'players':'avg players')+'</small></span><span class="movement">'+movement(g)+'</span><span class="actions"><button class="mini" data-save="'+g.gameId+'">'+(state.saved.includes(g.gameId)?'Saved':'Save')+'</button><button class="mini" data-compare="'+g.gameId+'">'+(state.compare.includes(g.gameId)?'Compared':'Compare')+'</button></span></div>'
    }).join('');
  }

  const movers=state.games.filter(g=>g.rankChange!==null&&g.rankChange!==0).sort((a,b)=>Math.abs(Number(b.rankChange||0))-Math.abs(Number(a.rankChange||0)));
  const visibleMovers=movers.slice(0,state.movingLimit);
  const moverMax=Math.max(1,...movers.map(g=>g.playing));
  const movingHtml=visibleMovers.length?visibleMovers.map((g,i)=>{
    const change=Number(g.rankChange||0),positive=change>0,label=positive?(change>=5?'Strong rise':'Rising'):'Falling';
    const width=Math.max(8,Math.round((g.playing/moverMax)*100));
    return '<button class="moving-card" data-game="'+g.gameId+'"><div class="moving-card-head">'+icon(g.icon)+'<span class="moving-info"><b>'+esc(g.name)+'</b><small>'+esc(g.creator)+'</small></span><span class="moving-rank">#'+g.rank+'</span></div><div class="moving-change"><span class="'+(positive?'up':'down')+'">'+(positive?'▲ ':'▼ ')+Math.abs(change)+' rank'+(Math.abs(change)===1?'':'s')+'</span><strong>'+label+'</strong></div><div class="moving-bar"><span style="width:'+width+'%"></span></div><span class="moving-label">'+fmt(g.playing)+' current players</span></button>'
  }).join(''):'<div class="empty">No major rank changes in the current ranking set.</div>';
  const movingButton=movers.length>2?'<div class="load-more-wrap"><button class="load-more-btn" id="movingToggle">'+(state.movingLimit>2?'Show less':'Load more')+(state.movingLimit>2?' ↑':' ↓')+'</button></div>':'';

  const result=state.results.map(g=>'<button data-search-game="'+g.id+'"><b>'+esc(g.name)+'</b><br><small>'+esc(g.creator)+'</small></button>').join('');
  const latest=state.games[0]?.calculatedAt;
  const updated=latest?fmtDateTime(latest):(state.loading?'Refreshing ranking data...':'Waiting for ranking data');
  const coverage=state.games.length+'/100';
  const rankingTitle=state.period==='live'?'Top Games Right Now':periods.find(p=>p[0]===state.period)[1]+' Rankings';
  const rankingTotal=state.games.length;
  const rankingButton=state.period==='live'&&rankingTotal>15
    ?'<div class="load-more-wrap"><button class="load-more-btn" id="rankingLoadMore">'+(state.rankingLimit<50?'Load more ↓':state.rankingLimit<rankingTotal?'Load more ↓':'Show less ↑')+'</button></div>'
    :'';

  return '<section class="hero"><div class="hero-main"><div class="eyebrow">BOBAKS ANALYTICS</div><h1>Live <em>Rankings</em></h1><p>Live rankings and historical trends for Roblox experiences.</p></div><div class="hero-status"><span class="status-label">Latest ranking snapshot</span><strong>'+esc(updated)+'</strong><div style="margin-top:8px;display:flex;align-items:center;gap:8px;color:#C7D8EA;font-size:10px"><span class="status-dot"></span>Ranking data connected</div></div></section><div class="controls"><nav class="tabs">'+tabs+'</nav><div class="social-actions"><button class="btn" id="shareRanking">↗ Share ranking</button><button class="btn primary" id="refresh">↻ Refresh</button></div><div class="social-status" id="socialStatus" aria-live="polite"></div></div><div class="search"><div class="search-wrap"><span class="search-icon">⌕</span><input id="search" placeholder="Search games, creators, or developers" value="'+esc(state.query)+'"></div><div class="results">'+result+'</div></div>'+(state.error?'<div class="banner error">'+esc(state.error)+'</div>':'')+'<section class="moving-section"><div class="moving-head"><div><h2>Trending Games</h2><p>Games with the largest upward rank movement in the current '+esc(periods.find(p=>p[0]===state.period)?.[1]||'ranking')+' set.</p></div><button class="btn" id="shareTrending">↗ Share trending</button></div><div class="moving-grid">'+movingHtml+'</div>'+movingButton+'</section><section class="social-peaks panel"><div class="social-peaks-head"><div><div class="eyebrow">SOCIAL HIGHLIGHT</div><h2>Peak Records</h2><p>Ready-to-post highlights of the highest recorded peaks Bobaks has stored.</p></div><button class="btn" id="sharePeaks">↗ Share peak records</button></div></section><section class="dashboard"><section class="main-card"><div class="listhead"><div><h2>'+rankingTitle+'</h2><p>Ranked from Bobaks collected game-level data.</p></div><div style="display:flex;align-items:center;gap:8px"><div class="updated">'+(state.next?'Next refresh<br><strong style="color:#C9D9EA;font-size:10px">'+fmtTime(state.next)+'</strong>':'')+'</div><button class="rank-toggle '+(state.rankingExpanded?'':'collapsed')+'" id="rankingToggle" aria-expanded="'+state.rankingExpanded+'"><span class="rank-chevron">⌄</span>'+(state.rankingExpanded?'Hide':'Show')+'</button></div></div><div class="ranking-body '+(state.rankingExpanded?'':'collapsed')+'"><div class="table-head"><span>#</span><span>Game</span><span>Creator</span><span>Players</span><span>Change</span><span>Actions</span></div><section class="rows">'+rows+'</section>'+rankingButton+'</div></section><aside class="side-stack"><article class="side-card"><div class="side-top"><div class="side-icon">↻</div><div><h3>Update status</h3><p>Bobaks is serving the latest available ranking set.</p></div></div><div style="margin-top:13px;color:#C1D2E5;font-size:10px">Latest snapshot<br><strong style="display:inline-block;margin-top:4px;color:#fff">'+esc(updated)+'</strong></div></article><article class="side-card"><div class="side-top"><div class="side-icon">▦</div><div><h3>Data coverage</h3><p>Current ranking rows available to the frontend.</p></div></div><ul class="data-list"><li><span>Live rankings</span><strong>'+(state.period==='live'?coverage:'100/100')+'</strong></li><li><span>Weekly rankings</span><strong>'+(state.period==='week'?coverage:'100/100')+'</strong></li><li><span>Monthly rankings</span><strong>'+(state.period==='month'?coverage:'100/100')+'</strong></li><li><span>Yearly rankings</span><strong>'+(state.period==='year'?coverage:'100/100')+'</strong></li></ul><div class="health"><div class="health-row"><span class="status-dot"></span> Ranking endpoint online</div><small>Collector, database, and ranking engine status are reflected through successful ranking responses.</small></div></article><article class="side-card"><div class="side-top"><div class="side-icon">i</div><div><h3>About Bobaks Ranking</h3><p>An independent analytics platform for Roblox experiences.</p></div></div><p style="margin-top:12px">Explore live popularity, historical trends, and rank movement using Bobaks collected game-level data.</p><button class="about-link" data-info="methodology">How rankings work →</button></article></aside></section>'+footer();
}
async function openGame(id,{push=true}={}){const gameId=String(id);if(push&&location.pathname!=='/game/'+encodeURIComponent(gameId))history.pushState({gameId},'',gameUrl(gameId));state.view='detail';state.selected={gameId,loading:true};window.__BOBAKS_SELECTED_GAME__=state.selected;state.error='';render();if(push)track('page_view',{gameId,period:state.period});try{const [g,h,p,rh]=await Promise.all([api('/api/games/'+encodeURIComponent(gameId)),api('/api/games/'+encodeURIComponent(gameId)+'/history?days=365'),api('/api/games/'+encodeURIComponent(gameId)+'/peak'),api('/api/games/'+encodeURIComponent(gameId)+'/rank-history?days=31')]);state.selected={...(g.data||{}),gameId,history:h.data||[],peak:Number(p.data?.peakPlayers||0),peakAt:p.data?.peakAt||null,rankHistory:rh.data||[],loading:false};window.__BOBAKS_SELECTED_GAME__=state.selected;setPageMeta(state.selected)}catch{state.selected={gameId,loading:false};window.__BOBAKS_SELECTED_GAME__=state.selected;state.error='That game could not be loaded.';setPageMeta(null)}render()}
function daily(points){const m=new Map();for(const p of points||[]){const d=String(p.timestamp||p.date).slice(0,10);const v=Number(p.playerCount||p.averagePlayers||0);if(!m.has(d))m.set(d,[]);m.get(d).push(v)}return [...m].map(([date,a])=>({date,avg:a.reduce((x,y)=>x+y,0)/a.length})).sort((a,b)=>a.date.localeCompare(b.date))}
function chart(points,rankMode){const a=rankMode?(points||[]).map(x=>({date:x.date,avg:Number(x.rank)})):daily(points);if(a.length<2)return '<div class="empty">Not enough collected history yet.</div>';const vals=a.map(x=>x.avg),min=Math.min(...vals),max=Math.max(...vals),range=Math.max(1,max-min),w=900,h=190;const pts=a.map((x,i)=>((i/(a.length-1))*w).toFixed(1)+','+(h-8-((x.avg-min)/range)*(h-20)).toFixed(1)).join(' ');return '<div class="chart"><svg viewBox="0 0 '+w+' '+h+'"><line class="gridline" x1="0" y1="10" x2="900" y2="10"/><line class="gridline" x1="0" y1="95" x2="900" y2="95"/><line class="gridline" x1="0" y1="182" x2="900" y2="182"/><polyline class="'+(rankMode?'rankline':'line')+'" points="'+pts+'"/></svg></div>'}
function detail(){
  const g=state.selected;
  if(!g||g.loading)return '<div class="banner">Loading game details...</div>';
  const live=g.rankings?.live;
  const current=Number(g.currentPlayers||live?.score||0);
  const rank=live?.rank;
  return '<button class="btn ghost" id="back">← Back to rankings</button><section class="detail-head" style="margin-top:12px"><img class="cover" src="'+esc(g.iconUrl||'')+'" alt="" loading="lazy" decoding="async"><div><div class="eyebrow">GAME DETAILS</div><h1>'+esc(g.name||'Unknown game')+'</h1><p>by '+esc(g.creatorName||'Unknown creator')+'</p><div class="actions-wide"><a class="btn primary" target="_blank" rel="noreferrer" href="https://www.roblox.com/games/'+encodeURIComponent(g.placeId||0)+'">Open on Roblox ↗</a><button class="btn" data-save="'+g.gameId+'">'+(state.saved.includes(g.gameId)?'Saved':'Save game')+'</button><button class="btn" data-share="'+g.gameId+'">Share rank card</button><button class="btn" data-compare="'+g.gameId+'">Compare</button></div></div></section><section class="stats"><div class="stat"><span>Current Players</span><strong>'+fmt(current)+'</strong><small>latest qualifying snapshot</small></div><div class="stat"><span>Current Rank</span><strong>'+(rank?'#'+rank:'Not ranked')+'</strong><small>Live</small></div><div class="stat"><span>Recorded Peak</span><strong>'+fmt(g.peak)+'</strong><small>'+String(g.peakAt||'').slice(0,10)+'</small></div><div class="stat"><span>History</span><strong>'+fmt((g.history||[]).length)+'</strong><small>collected points</small></div></section><section class="panel"><h2>Player Count</h2><p>Collected history. Missing periods are not invented.</p>'+chart(g.history,false)+'</section><section class="panel"><h2>Rank History</h2><p>Daily rank from Bobaks collected history.</p>'+chart(g.rankHistory,true)+'</section><section class="panel"><h2>Game information</h2><div class="meta"><div><small>Universe ID</small><b>'+esc(g.universeId||'Not available')+'</b></div><div><small>Place ID</small><b>'+esc(g.placeId||'Not available')+'</b></div><div><small>Creator</small><b>'+esc(g.creatorName||'Unknown')+'</b></div><div><small>Recorded Peak</small><b>Highest count Bobaks has recorded</b></div></div></section>'+footer();
}
async function savedPage(){
  const cards=[];
  for(const id of state.saved){
    try{const r=await api('/api/games/'+encodeURIComponent(id));if(r.data)cards.push(r.data)}catch{}
  }
  const guestSync=(!isSignedIn()&&state.saved.length)
    ?'<div class="banner">You have '+fmt(state.saved.length)+' saved game'+(state.saved.length===1?'':'s')+' on this device. <button class="btn primary" id="savedAccountCta" type="button">Sign in to sync</button></div>'
    :"";
  return '<section class="hero"><div class="hero-main"><div class="eyebrow">YOUR WATCHLIST</div><h1>Saved <em>Games</em></h1><p>'+(isSignedIn()?'Synced to your Bobaks account across devices.':'Saved only on this device. Sign in to sync across devices.')+'</p></div></section>'+guestSync+'<section class="main-card"><div class="listhead"><div><h2>Your saved games</h2><p>Quick access to games you want to keep watching.</p></div></div><section class="rows">'+(cards.length?cards.map(g=>'<div class="row" style="grid-template-columns:54px minmax(0,1fr) 120px"><span class="rank">•</span><button class="game" data-game="'+g.id+'">'+icon(g.iconUrl)+'<span><b>'+esc(g.name)+'</b><small>'+esc(g.creatorName||'Unknown creator')+'</small></span></button><span class="actions"><button class="mini" data-save="'+g.id+'">Remove</button></span></div>').join(''):'<div class="empty">Nothing saved yet.</div>')+'</section></section>'+footer();
}
async function comparePage(){
  if(!state.compare.length)return '<section class="hero"><div class="hero-main"><div class="eyebrow">GAME COMPARISON</div><h1>Compare <em>Games</em></h1><p>Choose Compare on ranking rows to add games.</p></div></section>'+footer();
  const cards=[];
  for(const id of state.compare){
    try{const r=await api('/api/games/'+encodeURIComponent(id));if(r.data)cards.push(r.data)}catch{}
  }
  return '<section class="hero"><div class="hero-main"><div class="eyebrow">GAME COMPARISON</div><h1>Compare <em>Games</em></h1><p>Compare current popularity and live rank for selected games.</p></div></section><section class="compare">'+cards.map(g=>'<article class="panel"><div class="side-top"><img class="cover" src="'+esc(g.iconUrl||'')+'" alt="" loading="lazy" decoding="async"><div><h2>'+esc(g.name)+'</h2><p>'+esc(g.creatorName||'Unknown creator')+'</p></div></div><div class="stats"><div class="stat"><span>Players</span><strong>'+fmt(g.currentPlayers)+'</strong></div><div class="stat"><span>Live Rank</span><strong>'+(g.rankings?.live?.rank?'#'+g.rankings.live.rank:'N/A')+'</strong></div></div><button class="btn primary" data-game="'+g.id+'">Open game</button></article>').join('')+'</section>'+footer();
}
function info(key){const data={privacy:['Privacy Policy','Bobaks Ranking focuses on game-level analytics. No player-level profiles are required for the public ranking experience. Anonymous first-party visitor and session identifiers may be used to measure product usage, return visits, and session depth. They are not Roblox account IDs, are not used to build player profiles, and do not include IP addresses or raw search text. Visitor identifiers expire after 30 days and session identifiers use a 30-minute idle window.'],terms:['Terms of Use','Bobaks Ranking is an independent third-party analytics site. Player counts and rankings may change, be delayed, or become unavailable.'],sources:['Data Sources','Bobaks Ranking uses permitted public Roblox game-level data and calculates rankings from collected snapshots.']};if(key==='methodology')return '<section class="info"><button class="btn" id="back">← Back</button><h1>How Bobaks Rankings Work</h1><p>Rankings use qualifying Bobaks collection data. Live rankings require a recent qualifying snapshot. Weekly and monthly rankings use qualifying samples and the existing 50% coverage rule. Rank movement compares the current persisted ranking with the previous ranking set.</p><p>Recorded Peak means the highest player count Bobaks has recorded, not Roblox-wide all-time history.</p><p>Historical coverage depends on what Bobaks has successfully collected.</p></section>';const d=data[key]||data.privacy;return '<section class="info"><button class="btn" id="back">← Back</button><h1>'+d[0]+'</h1><p>'+d[1]+'</p><p>Contact: bobaksranking@gmail.com</p></section>'}
function render(){
  nav();
  if(state.view==='auth'){
    $('app').innerHTML=authPage();bind();return;
  }
  if(state.view==='account'){
    $('app').innerHTML='<div class="banner">Loading your account...</div>';
    accountPage().then(html=>{if(state.view==='account'){$('app').innerHTML=html;bind()}});
    return;
  }
  if(state.view==='community'){$('app').innerHTML=communityPage();bind();return}
  if(state.view==='detail'){$('app').innerHTML=detail();bind();return}
  if(state.view==='saved'){$('app').innerHTML='<div class="banner">Loading saved games...</div>';savedPage().then(html=>{if(state.view==='saved'){$('app').innerHTML=html;bind()}});return}
  if(state.view==='compare'){$('app').innerHTML='<div class="banner">Loading comparison...</div>';comparePage().then(html=>{if(state.view==='compare'){$('app').innerHTML=html;bind()}});return}
  if(state.view==='info'){$('app').innerHTML=info(state.infoKey);bind();return}
  $('app').innerHTML=home();bind();
}
function bind(){
  animateLiveValues();
  const q=$('search');if(q){q.oninput=e=>{state.query=e.target.value;clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>search(state.query),250)}}
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.period=b.dataset.period;state.rankingLimit=15;state.movingLimit=2;goHome({push:true})});
  const r=$('refresh');if(r)r.onclick=()=>loadRankings(true);
  const shareRankingBtn=$('shareRanking');if(shareRankingBtn)shareRankingBtn.onclick=shareRanking;
  const shareTrendingBtn=$('shareTrending');if(shareTrendingBtn)shareTrendingBtn.onclick=()=>shareSocialPost('trending');
  const sharePeaksBtn=$('sharePeaks');if(sharePeaksBtn)sharePeaksBtn.onclick=()=>shareSocialPost('peaks');
  const rankingToggle=$('rankingToggle');if(rankingToggle)rankingToggle.onclick=()=>{state.rankingExpanded=!state.rankingExpanded;render()};
  const rankingLoadMore=$('rankingLoadMore');if(rankingLoadMore)rankingLoadMore.onclick=()=>{if(state.rankingLimit<50)state.rankingLimit=50;else if(state.rankingLimit<state.games.length)state.rankingLimit=state.games.length;else state.rankingLimit=15;render()};
  const movingToggle=$('movingToggle');if(movingToggle)movingToggle.onclick=()=>{state.movingLimit=state.movingLimit>2?2:6;render()};
  const back=$('back');if(back)back.onclick=()=>{state.view='home';state.selected=null;state.error='';setPageMeta(null);render();loadRankings()};
  const accountOpen=$('accountOpen');if(accountOpen)accountOpen.onclick=()=>goAccount();
  const accountSignIn=$('accountSignIn');if(accountSignIn)accountSignIn.onclick=()=>goAuth('signin');
  const accountSignUp=$('accountSignUp');if(accountSignUp)accountSignUp.onclick=()=>goAuth('signup');
  const accountSignout=$('accountSignout');if(accountSignout)accountSignout.onclick=signOutAccount;
  const accountSignOut=$('accountSignOut');if(accountSignOut)accountSignOut.onclick=signOutAccount;
  const accountBrowse=$('accountBrowse');if(accountBrowse)accountBrowse.onclick=()=>goHome({push:true});
  const authForm=$('authForm');if(authForm)authForm.onsubmit=e=>{e.preventDefault();if(!accountBusy())submitAuth()};
  document.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>goAuth(b.dataset.authMode,{push:false}));
  const continueGuest=$('continueGuest');if(continueGuest)continueGuest.onclick=()=>goHome();
  const profileForm=$('profileForm');if(profileForm)profileForm.onsubmit=e=>{e.preventDefault();if(!accountBusy())submitProfile()};
  const alertForm=$('alertForm');if(alertForm)alertForm.onsubmit=e=>{e.preventDefault();if(!accountBusy())submitAlertSettings()};
  document.querySelectorAll('[data-game]').forEach(b=>b.onclick=()=>openGame(b.dataset.game));
  document.querySelectorAll('[data-search-game]').forEach(b=>b.onclick=()=>{state.results=[];openGame(b.dataset.searchGame)});
  document.querySelectorAll('[data-save]').forEach(b=>b.onclick=async e=>{
    e.stopPropagation();
    const id=String(b.dataset.save),had=state.saved.includes(id),client=authClient();
    try{
      if(isSignedIn()&&client){
        if(had)await client.removeWatchlistGame(id);
        else if(state.saved.length<25)await client.addWatchlistGame(id);
        else throw new Error('Your watchlist is limited to 25 games for now.');
      }else if(!had&&state.saved.length>=25)throw new Error('Your watchlist is limited to 25 games for now.');
      state.saved=had?state.saved.filter(x=>x!==id):[...state.saved,id];
      saveSaved();
      track(had?'watchlist_remove':'watchlist_add',{gameId:id});
      render();
    }catch(error){
      const ui=accountUI();
      if(ui?.state)ui.state.error=String(error?.message||'Could not update your watchlist.');
      render();
    }
  });
  document.querySelectorAll('[data-compare]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();const id=String(b.dataset.compare);const had=state.compare.includes(id);state.compare=had?state.compare.filter(x=>x!==id):state.compare.length<2?[...state.compare,id]:state.compare;track(had?'compare_remove':'compare_add',{gameId:id});render();
  });
  document.querySelectorAll('[data-share]').forEach(b=>b.onclick=()=>{track('share_opened',{gameId:b.dataset.share,channel:'rank_card'});share(b.dataset.share)});
  document.querySelectorAll('[data-info]').forEach(b=>b.onclick=()=>{state.view='info';state.infoKey=b.dataset.info;render()});
}
function animateLiveValues(){
  document.querySelectorAll('.live-value[data-from][data-to]').forEach(el=>{
    const from=Number(el.dataset.from),to=Number(el.dataset.to);
    if(!Number.isFinite(from)||!Number.isFinite(to)||from===to)return;
    const start=performance.now(),duration=560;
    const ease=t=>1-Math.pow(1-t,3);
    const tick=now=>{
      const t=Math.min(1,(now-start)/duration);
      el.textContent=fmt(Math.round(from+(to-from)*ease(t)));
      if(t<1)requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function cardTier(rank){
  const n=Number(rank);
  if(n===1)return {
    name:'LEGENDARY',family:'gold',
    accent:'#FFD34F',accent2:'#FFF4B0',accent3:'#FFFDF0',
    badge:'TOP 1',glow:1.45,foil:'gold'
  };
  if(n>=2&&n<=3)return {
    name:'EPIC',family:'purple',
    accent:'#A66CFF',accent2:'#E4C8FF',accent3:'#FBF5FF',
    badge:'TOP 3',glow:1.18,foil:'purple'
  };
  if(n>=4&&n<=10)return {
    name:'RARE',family:'blue',
    accent:'#25C7FF',accent2:'#B9F1FF',accent3:'#F0FEFF',
    badge:'TOP 10',glow:1.02,foil:'blue'
  };
  if(n>=11&&n<=25)return {
    name:'UNCOMMON',family:'green',
    accent:'#45E28C',accent2:'#C9FFDD',accent3:'#F1FFF5',
    badge:'TOP 25',glow:.92,foil:'green'
  };
  if(n>=26&&n<=100)return {
    name:'COMMON',family:'white',
    accent:'#E9F0F7',accent2:'#FFFFFF',accent3:'#FFFFFF',
    badge:'TOP 100',glow:.78,foil:'silver'
  };
  return {
    name:'DISCOVERED',family:'discovered',
    accent:'#9FB3C8',accent2:'#E2EAF2',accent3:'#FFFFFF',
    badge:'DISCOVERED',glow:.64,foil:'discovered'
  };
}

function cardMessage(g,rank){
  const n=Number(rank);
  const change=g.rankings?.live?.rankChange;
  if(n===1)return 'You are looking at the current #1 game on Bobaks. Keep your crown shining. 👑';
  if(change!=null&&change>=10)return 'This game is flying up the leaderboard. 🚀 Keep watching the climb.';
  if(change!=null&&change>=3)return 'This game is climbing the board. 🔥 One to keep your eye on.';
  if(change!=null&&change<=-10)return 'The leaderboard moved. The next refresh could tell a different story.';
  if(g.isNewEntry)return 'A fresh face just entered the Bobaks Top 100. Welcome to the board. ✨';
  if(n&&n<=3)return 'A top-three game on Bobaks. That spot is worth showing off. ✨';
  if(n&&n<=10)return 'You are looking at a top-ten game on Bobaks right now. 👀';
  if(Number(g.currentPlayers||0)>=10000)return 'Thousands of players are showing up right now. 🔥';
  if(n&&n<=100)return 'A ranked game worth keeping on your watchlist.';
  return 'Discover where this game stands on Bobaks Ranking.';
}

function roundRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
}

function hexToRgba(hex,alpha){
  const h=hex.replace('#','');
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}

function wrapLines(ctx,text,maxWidth,maxLines=3){
  const words=String(text||'').split(/\s+/);
  const lines=[];let line='';
  for(const word of words){
    const next=line?line+' '+word:word;
    if(ctx.measureText(next).width<=maxWidth){line=next;continue}
    if(line)lines.push(line);
    line=word;
    if(lines.length===maxLines-1)break;
  }
  if(lines.length<maxLines&&line)lines.push(line);
  if(lines.length===maxLines&&words.join(' ').length>lines.join(' ').length){
    let last=lines[maxLines-1];
    while(ctx.measureText(last+'…').width>maxWidth&&last.length>1)last=last.slice(0,-1);
    lines[maxLines-1]=last+'…';
  }
  return lines;
}

async function loadCardImage(url){
  if(!url)return null;
  try{
    const img=new Image();
    img.crossOrigin='anonymous';
    const loaded=new Promise((resolve,reject)=>{img.onload=()=>resolve(img);img.onerror=reject});
    img.src=url;
    return await Promise.race([loaded,new Promise((_,reject)=>setTimeout(()=>reject(new Error('image timeout')),4500))]);
  }catch{return null}
}


function ordinalRank(rank){
  const n=Number(rank);
  if(!Number.isFinite(n)||n<1)return {number:'',suffix:''};
  const mod100=n%100;
  const suffix=(mod100>=11&&mod100<=13)?'TH':(n%10===1?'ST':n%10===2?'ND':n%10===3?'RD':'TH');
  return {number:String(n),suffix};
}

function drawOrdinalRank(ctx,rank,x,y){
  const ord=ordinalRank(rank);
  if(!ord.number){ctx.fillText('UNRANKED',x,y);return}
  const baseSize=rank===1?154:rank&&rank<=3?138:126;
  ctx.font='900 '+baseSize+'px Inter,system-ui,sans-serif';
  const numberWidth=ctx.measureText(ord.number).width;
  ctx.font='900 '+Math.round(baseSize*.43)+'px Inter,system-ui,sans-serif';
  const suffixWidth=ctx.measureText(ord.suffix).width;
  const gap=7;
  const total=numberWidth+gap+suffixWidth;
  let start=x-total/2;
  ctx.font='900 '+baseSize+'px Inter,system-ui,sans-serif';
  ctx.fillText(ord.number,start,y);
  start+=numberWidth+gap;
  ctx.font='900 '+Math.round(baseSize*.43)+'px Inter,system-ui,sans-serif';
  ctx.fillText(ord.suffix,start,y-baseSize*.48);
}

let qrCodePromise=null;
function ensureQrCode(){
  if(typeof qrcode==='function')return Promise.resolve();
  if(qrCodePromise)return qrCodePromise;
  qrCodePromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/qrcode-generator.js';
    script.async=true;
    script.onload=()=>typeof qrcode==='function'?resolve():reject(new Error('QR library unavailable'));
    script.onerror=()=>reject(new Error('QR library failed to load'));
    document.head.appendChild(script);
  });
  return qrCodePromise;
}
function drawCardQr(ctx,text,x,y,size,tier){
  if(typeof qrcode!=='function')return false;
  try{
    const qr=qrcode(0,'M');
    qr.addData(text,'Byte');
    qr.make();
    const modules=qr.getModuleCount();
    const quiet=4;
    const cell=Math.max(2,Math.floor((size*0.76)/(modules+quiet*2)));
    const actual=(modules+quiet*2)*cell;
    const ox=x+(size-actual)/2;
    const oy=y+(size-actual)/2;
    ctx.save();
    roundRect(ctx,x,y,size,size,12);
    ctx.fillStyle='#FFFFFF';
    ctx.fill();
    ctx.strokeStyle=hexToRgba(tier.accent,0.55);
    ctx.lineWidth=3;
    ctx.stroke();
    ctx.fillStyle='#FFFFFF';
    ctx.fillRect(ox,oy,actual,actual);
    ctx.fillStyle='#111111';
    for(let row=0;row<modules;row++){
      for(let col=0;col<modules;col++){
        if(qr.isDark(row,col)){
          ctx.fillRect(ox+(col+quiet)*cell,oy+(row+quiet)*cell,cell,cell);
        }
      }
    }
    ctx.restore();
    return true;
  }catch{return false}
}

function shareIconSvg(key){
  const common='viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if(key==='messenger')return '<svg '+common+'><path d="M4 12c0-4.3 3.5-7.5 8-7.5s8 3.2 8 7.5-3.5 7.5-8 7.5c-1.3 0-2.5-.3-3.6-.8L5 20l.9-2.9C4.7 15.8 4 14 4 12Z"/><path d="m8 13 3-3 2.2 2 2.8-2"/></svg>';
  if(key==='instagram')return '<svg '+common+'><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.7" r=".8" fill="currentColor" stroke="none"/></svg>';
  if(key==='tiktok')return '<svg '+common+'><path d="M14 4v10.3a4.2 4.2 0 1 1-3.3-4.1"/><path d="M14 4c.8 2 2.1 3.3 4.5 3.8"/></svg>';
  if(key==='whatsapp')return '<svg '+common+'><path d="M20.2 11.7a8.2 8.2 0 0 1-12.1 7.2L4 20l1.2-3.8a8.2 8.2 0 1 1 15-4.5Z"/><path d="M9 9.3c.3-.4.7-.4 1-.1l1 .9c.3.2.3.6.1.9l-.5.6c.8 1.1 1.5 1.7 2.7 2.3l.6-.5c.3-.2.7-.2.9.1l.9 1c.3.3.2.7-.1 1-.5.5-1.1.7-1.8.5-2.8-.8-5-2.6-6.4-5.1-.3-.6-.2-1.2.2-1.6Z"/></svg>';
  if(key==='facebook')return '<svg '+common+'><circle cx="12" cy="12" r="8.7"/><path d="M13.5 19v-6h2l.3-2.1h-2.3V9.5c0-.7.2-1.1 1.2-1.1h1.2V6.5c-.4-.1-1.1-.1-1.8-.1-2.2 0-3.6 1.3-3.6 3.7v.8H9v2.1h1.5v6"/></svg>';
  if(key==='x')return '<svg '+common+'><path d="m5 4 14 16"/><path d="M19 4 5 20"/></svg>';
  if(key==='discord')return '<svg '+common+'><path d="M7 7.5A8.4 8.4 0 0 1 12 6a8.4 8.4 0 0 1 5 1.5l1.8 9.2c-1.5 1.1-3.1 1.7-4.7 1.8l-.9-1.2"/><path d="M17 16.7c-1.6-.8-3.2-1.2-5-1.2s-3.4.4-5 1.2"/><circle cx="9.3" cy="11.2" r=".8" fill="currentColor" stroke="none"/><circle cx="14.7" cy="11.2" r=".8" fill="currentColor" stroke="none"/></svg>';
  return '<svg '+common+'><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7h14v-7"/></svg>';
}

async function generateRankCard(g){
  const rank=Number(g.rankings?.live?.rank||0);
  const previousRank=g.rankings?.live?.previousRank==null?null:Number(g.rankings.live.previousRank);
  const rankChange=g.rankings?.live?.rankChange==null?null:Number(g.rankings.live.rankChange);
  const current=Number(g.currentPlayers||g.rankings?.live?.score||0);
  const peak=Number(g.peak||g.recordedPeak||0);
  const tier=cardTier(rank);
  const W=1200,H=1600,canvas=document.createElement('canvas');
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Canvas is unavailable');

  const logoPromise=loadCardImage(location.origin+'/assets/bobaks-logo.png');
  const gameImagePromise=loadCardImage(g.iconUrl||g.icon||'');
  const [logo,gameImage]=await Promise.all([logoPromise,gameImagePromise]);

  function drawSpark(ctx,x,y,size,alpha,stroke){
    ctx.save();
    ctx.translate(x,y);
    ctx.strokeStyle=hexToRgba(stroke,alpha);
    ctx.lineWidth=Math.max(2,size*.10);
    ctx.beginPath();ctx.moveTo(-size,0);ctx.lineTo(size,0);ctx.moveTo(0,-size);ctx.lineTo(0,size);ctx.stroke();
    ctx.rotate(Math.PI/4);
    ctx.globalAlpha=.55;
    ctx.beginPath();ctx.moveTo(-size*.66,0);ctx.lineTo(size*.66,0);ctx.moveTo(0,-size*.66);ctx.lineTo(0,size*.66);ctx.stroke();
    ctx.restore();
  }

  function seededRandom(seed){
    const x=Math.sin(seed*12.9898+78.233)*43758.5453;
    return x-Math.floor(x);
  }

  function drawSymbol(ctx,type,x,y,size,rotation,alpha,fill,stroke){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(rotation);
    ctx.globalAlpha=Math.max(0,Math.min(1,alpha));
    ctx.fillStyle=fill;
    ctx.strokeStyle=stroke;
    ctx.lineWidth=Math.max(2,size*.055);
    ctx.beginPath();

    if(type==='circle'){
      ctx.arc(0,0,size*.5,0,Math.PI*2);
      ctx.fill();
    }else if(type==='triangle'){
      ctx.moveTo(0,-size*.55);
      ctx.lineTo(size*.56,size*.47);
      ctx.lineTo(-size*.56,size*.47);
      ctx.closePath();
      ctx.fill();
    }else if(type==='square'){
      ctx.rect(-size*.45,-size*.45,size*.9,size*.9);
      ctx.fill();
    }else if(type==='block'){
      const w=size*.95,h=size*.56,r=size*.12;
      roundRect(ctx,-w/2,-h/2,w,h,r);
      ctx.fill();
    }else if(type==='gamepad'){
      const w=size*1.02,h=size*.58,r=size*.22;
      roundRect(ctx,-w/2,-h/2,w,h,r);
      ctx.fill();
      ctx.fillStyle=stroke;
      ctx.globalAlpha*=.72;
      ctx.fillRect(-size*.28,-size*.045,size*.20,size*.09);
      ctx.fillRect(-size*.235,-size*.09,size*.09,size*.18);
      ctx.beginPath();
      ctx.arc(size*.22,-size*.08,size*.06,0,Math.PI*2);
      ctx.arc(size*.30,size*.05,size*.06,0,Math.PI*2);
      ctx.fill();
    }

    ctx.stroke();
    ctx.restore();
  }

  function drawRandomSymbols(ctx,time,preview){
    if(!preview)return;

    const slotCount=rank===1?11:rank&&rank<=3?9:8;
    const step=500;
    const t=Math.max(0,time||0);
    const cycle=Math.floor(t/step);
    const phase=(t%step)/step;
    const fadeOut=Math.max(0,1-phase/.5);
    const fadeIn=Math.min(1,phase/.5);
    const types=['block','circle','triangle','square','gamepad'];

    function sceneSymbol(slot,scene){
      const base=scene*997+slot*113+rank*31;
      return {
        type:types[Math.floor(seededRandom(base+5)*types.length)%types.length],
        x:90+seededRandom(base+1)*(W-180),
        y:150+seededRandom(base+2)*(H-300),
        size:22+seededRandom(base+3)*36,
        rotation:(seededRandom(base+4)-.5)*Math.PI
      };
    }

    for(let slot=0;slot<slotCount;slot++){
      const oldSymbol=sceneSymbol(slot,cycle);
      const newSymbol=sceneSymbol(slot,cycle+1);
      const baseOpacity=.045;

      drawSymbol(
        ctx,oldSymbol.type,oldSymbol.x,oldSymbol.y,oldSymbol.size,oldSymbol.rotation,
        baseOpacity*fadeOut,hexToRgba(tier.accent,1),hexToRgba(tier.accent2,.95)
      );
      drawSymbol(
        ctx,newSymbol.type,newSymbol.x,newSymbol.y,newSymbol.size,newSymbol.rotation,
        baseOpacity*fadeIn,hexToRgba(tier.accent,1),hexToRgba(tier.accent2,.95)
      );
    }
  }

  function drawFoil(ctx,time,preview=true){
    drawRandomSymbols(ctx,time,preview);

    if(preview){
      const count=rank===1?26:rank&&rank<=3?18:12;
      for(let i=0;i<count;i++){
        const seed=i*1337+rank*97;
        const x=75+(Math.abs(Math.sin(seed))*1050);
        const y=120+(Math.abs(Math.cos(seed*.71))*1310);
        const pulse=.7+.3*Math.sin((time||0)/900+i);
        drawSpark(ctx,x,y,(rank===1?7:5)*pulse,.5*pulse,tier.accent2);
      }
    }
  }

function drawFrame(time=0,preview=true){
    ctx.clearRect(0,0,W,H);

    const bg=ctx.createLinearGradient(0,0,W,H);
    if(tier.family==='gold'){
      bg.addColorStop(0,'#120D02');bg.addColorStop(.32,'#3B2608');bg.addColorStop(.52,'#8D6212');bg.addColorStop(.76,'#2B1A05');bg.addColorStop(1,'#090602');
    }else if(tier.family==='purple'){
      bg.addColorStop(0,'#0D0718');bg.addColorStop(.32,'#281045');bg.addColorStop(.55,'#5C2E97');bg.addColorStop(.76,'#22103D');bg.addColorStop(1,'#07030E');
    }else if(tier.family==='blue'){
      bg.addColorStop(0,'#02131C');bg.addColorStop(.34,'#063D59');bg.addColorStop(.55,'#087EA4');bg.addColorStop(.78,'#063349');bg.addColorStop(1,'#011018');
    }else if(tier.family==='green'){
      bg.addColorStop(0,'#04130B');bg.addColorStop(.34,'#0C4B2A');bg.addColorStop(.55,'#1E8E52');bg.addColorStop(.8,'#0A3A22');bg.addColorStop(1,'#020C07');
    }else if(tier.family==='white'){
      bg.addColorStop(0,'#0F1318');bg.addColorStop(.32,'#48535E');bg.addColorStop(.52,'#AEB7C0');bg.addColorStop(.76,'#3B454F');bg.addColorStop(1,'#0A0D11');
    }else{
      bg.addColorStop(0,'#08101A');bg.addColorStop(.45,'#172636');bg.addColorStop(1,'#05090E');
    }
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

    const glow=ctx.createRadialGradient(W*.5,260,30,W*.5,260,780);
    glow.addColorStop(0,hexToRgba(tier.accent,.26*tier.glow));
    glow.addColorStop(.4,hexToRgba(tier.accent,.095*tier.glow));
    glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,W,900);

    for(let i=0;i<28;i++){
      const x=(i*157+73)%W,y=(i*89+140)%H;
      ctx.fillStyle=hexToRgba(tier.accent2,.035+(i%3)*.01);
      ctx.beginPath();ctx.arc(x,y,1.5+(i%3),0,Math.PI*2);ctx.fill();
    }

    roundRect(ctx,30,30,W-60,H-60,48);
    ctx.fillStyle='rgba(3,8,15,.32)';ctx.fill();
    ctx.strokeStyle=hexToRgba(tier.accent,rank===1?.86:.62);
    ctx.lineWidth=rank===1?10:7;ctx.stroke();

    roundRect(ctx,50,50,W-100,H-100,40);
    ctx.strokeStyle=hexToRgba(tier.accent2,rank===1?.62:.38);
    ctx.lineWidth=3;ctx.stroke();

    const inner=ctx.createLinearGradient(0,0,W,0);
    inner.addColorStop(0,hexToRgba(tier.accent,.03));
    inner.addColorStop(.5,hexToRgba(tier.accent2,.13));
    inner.addColorStop(1,hexToRgba(tier.accent,.03));
    ctx.fillStyle=inner;ctx.fillRect(62,62,W-124,18);ctx.fillRect(62,H-80,W-124,18);

    if(rank===1){
      for(let i=0;i<18;i++){
        const a=(i/18)*Math.PI*2;
        const rr=470+(i%3)*38;
        drawSpark(ctx,W/2+Math.cos(a)*rr,280+Math.sin(a)*rr,7+(i%3)*2,.62,tier.accent2);
      }
    }

    if(logo)ctx.drawImage(logo,72,72,58,58);
    ctx.textAlign='left';
    ctx.fillStyle='#F7FAFF';ctx.font='800 30px Inter,system-ui,sans-serif';
    ctx.fillText('BOBAKS RANKING',146,110);
    ctx.fillStyle=tier.accent;ctx.font='900 18px Inter,system-ui,sans-serif';
    ctx.fillText(tier.name,146,140);

    ctx.textAlign='center';
    ctx.fillStyle=tier.accent;
    ctx.font=rank===1?'900 158px Inter,system-ui,sans-serif':rank&&rank<=3?'900 142px Inter,system-ui,sans-serif':'900 128px Inter,system-ui,sans-serif';
    ctx.shadowColor=hexToRgba(tier.accent,.68);ctx.shadowBlur=rank===1?46:30;
    drawOrdinalRank(ctx,rank,W/2,315);
    ctx.shadowBlur=0;
    ctx.fillStyle=tier.accent2;ctx.font='900 24px Inter,system-ui,sans-serif';
    ctx.fillText(tier.badge,W/2,360);

    const artX=92,artY=405,artW=W-184,artH=530;
    roundRect(ctx,artX,artY,artW,artH,30);
    ctx.save();ctx.clip();
    if(gameImage){
      const s=Math.max(artW/gameImage.width,artH/gameImage.height),dw=gameImage.width*s,dh=gameImage.height*s;
      const dx=artX+(artW-dw)/2,dy=artY+(artH-dh)/2;
      ctx.globalAlpha=.88;ctx.drawImage(gameImage,dx,dy,dw,dh);ctx.globalAlpha=1;
      const fade=ctx.createLinearGradient(0,artY,0,artY+artH);
      fade.addColorStop(0,'rgba(2,7,17,.03)');fade.addColorStop(.62,'rgba(2,7,17,.08)');fade.addColorStop(1,'rgba(2,7,17,.83)');
      ctx.fillStyle=fade;ctx.fillRect(artX,artY,artW,artH);
    }else{
      ctx.fillStyle='#10223A';ctx.fillRect(artX,artY,artW,artH);
      ctx.fillStyle=tier.accent;ctx.font='900 160px Inter,system-ui,sans-serif';
      ctx.fillText(String(g.name||'?').charAt(0).toUpperCase(),W/2,artY+330);
    }

    const artGlow=ctx.createRadialGradient(W*.5,artY+210,30,W*.5,artY+210,520);
    artGlow.addColorStop(0,hexToRgba(tier.accent,.20*tier.glow));
    artGlow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=artGlow;ctx.fillRect(artX,artY,artW,artH);
    ctx.restore();

    roundRect(ctx,artX,artY,artW,artH,30);
    ctx.strokeStyle=hexToRgba(tier.accent,.78);ctx.lineWidth=5;ctx.stroke();
    roundRect(ctx,artX+8,artY+8,artW-16,artH-16,24);
    ctx.strokeStyle=hexToRgba(tier.accent2,.28);ctx.lineWidth=2;ctx.stroke();

    drawFoil(ctx,time,preview);

    ctx.textAlign='left';
    ctx.fillStyle='#fff';
    ctx.font=rank===1?'900 58px Inter,system-ui,sans-serif':'900 52px Inter,system-ui,sans-serif';
    const titleLines=wrapLines(ctx,g.name||'Unknown game',1000,2);
    titleLines.forEach((line,i)=>ctx.fillText(line,100,1010+i*64));

    ctx.fillStyle='#B8CBE0';ctx.font='700 22px Inter,system-ui,sans-serif';
    ctx.fillText('by '+String(g.creatorName||g.creator||'Unknown creator').slice(0,54),100,1148);

    const statY=1210;
    const boxes=[
      {label:'CURRENT PLAYERS',value:fmt(current)},
      {label:'RECORDED PEAK',value:fmt(peak)}
    ];
    boxes.forEach((b,i)=>{
      const x=100+i*500;
      roundRect(ctx,x,statY,450,112,18);
      ctx.fillStyle=hexToRgba(tier.accent,.07);ctx.fill();
      ctx.strokeStyle=hexToRgba(tier.accent2,.25);ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='#7890A8';ctx.font='800 16px Inter,system-ui,sans-serif';ctx.fillText(b.label,x+24,statY+32);
      ctx.fillStyle='#fff';ctx.font='900 38px Inter,system-ui,sans-serif';ctx.fillText(b.value,x+24,statY+78);
    });

    ctx.fillStyle=rankChange==null?tier.accent2:rankChange>0?'#37D6A2':rankChange<0?'#FF7586':tier.accent2;
    ctx.font='900 25px Inter,system-ui,sans-serif';
    const movement=rankChange==null?(previousRank==null?'NEW ENTRY':'RANK'):(rankChange>0?'▲ '+rankChange+' RANK'+(rankChange===1?'':'S')+' UP':rankChange<0?'▼ '+Math.abs(rankChange)+' RANK'+(Math.abs(rankChange)===1?'':'S')+' DOWN':'NO RANK CHANGE');
    ctx.fillText(movement,100,1380);

    ctx.fillStyle='#EEF6FF';ctx.font='800 22px Inter,system-ui,sans-serif';
    const msgLines=wrapLines(ctx,cardMessage({...g,isNewEntry:previousRank==null},rank),760,2);
    msgLines.forEach((line,i)=>ctx.fillText(line,100,1418+i*29));

    const cardLink=gameUrl(g.gameId||g.id);

    // Dedicated footer composition: keep the QR code in its own right-hand zone
    // and keep the destination text comfortably above the inner card border.
    drawCardQr(ctx,cardLink,945,1396,112,tier);

    ctx.fillStyle='#7A91A8';ctx.font='700 17px Inter,system-ui,sans-serif';
    ctx.fillText('Track this game on Bobaks Ranking',100,1502);

    ctx.fillStyle=tier.accent2;ctx.font='900 19px Inter,system-ui,sans-serif';
    ctx.fillText(location.host,100,1534);

    ctx.textAlign='center';
    ctx.fillStyle='#6C849D';ctx.font='800 12px Inter,system-ui,sans-serif';
    ctx.fillText('SCAN TO VISIT BOBAKS',1001,1385);
    ctx.textAlign='left';
  }

  drawFrame(performance.now(),true);
  const gameLink=gameUrl(g.gameId||g.id);
  const shareMessage=cardMessage({...g,isNewEntry:previousRank==null},rank);
  const shareText=[
    String(g.name||'Unknown game')+' · '+(rank?'#'+rank:'Unranked'),
    '',
    shareMessage,
    '',
    'Visit Bobaks Ranking:',
    gameLink
  ].join('\n');

  return {
    canvas,
    rank,
    tier,
    rankChange,
    text:shareText,
    gameLink,
    drawFrame,
    startAnimation(){
      let raf;
      const tick=now=>{
        drawFrame(now,true);
        raf=requestAnimationFrame(tick);
      };
      raf=requestAnimationFrame(tick);
      return ()=>cancelAnimationFrame(raf);
    }
  };
}

function closeRankCardModal(){
  const modal=document.querySelector('.rank-card-modal');
  if(modal)modal.remove();
}

async function share(id){
  let modal;
  const qrReady=ensureQrCode().catch(()=>{});
  try{
    const r=await api('/api/games/'+encodeURIComponent(id));
    await qrReady;
    const g={...(r.data||{}),gameId:String(id)};
    if(!g.name)throw new Error('Game not found');

    modal=document.createElement('div');
    modal.className='rank-card-modal';
    modal.innerHTML='<div class="rank-card-dialog" role="dialog" aria-modal="true" aria-label="Your Bobaks Game Rank Card"><div class="rank-card-dialog-head"><div class="rank-card-dialog-copy"><h2 class="rank-card-dialog-title">Your Game Rank Card</h2><p class="rank-card-dialog-sub" data-rank-context>Preparing your card…</p><span class="rank-card-live"><span class="rank-card-live-dot"></span>Live Bobaks data</span></div><button class="rank-card-close" aria-label="Close">×</button></div><div class="rank-card-canvas-wrap"><div class="rank-card-generating"><span class="spinner"></span><span>Generating your card…</span></div></div></div>';
    document.body.appendChild(modal);

    const result=await generateRankCard(g);
    const wrap=modal.querySelector('.rank-card-canvas-wrap');
    wrap.innerHTML='';
    result.canvas.className='rank-card-canvas';
    wrap.appendChild(result.canvas);

    let stopAnimation=result.startAnimation();
    const stop=()=>{if(stopAnimation){stopAnimation();stopAnimation=null}};
    const restart=()=>{if(!stopAnimation)stopAnimation=result.startAnimation()};

    const filename='bobaks-'+String(g.name||'game').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()+'-rank-card.png';
    const getBlob=async()=>{
      const wasAnimating=!!stopAnimation;
      if(wasAnimating)stop();
      result.drawFrame(performance.now(),false);
      const b=await new Promise((resolve,reject)=>result.canvas.toBlob(x=>x?resolve(x):reject(new Error('PNG export failed')),'image/png'));
      if(wasAnimating)restart();
      return b;
    };
    const copyText=async textValue=>{
      if(!navigator.clipboard)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(textValue);
    };
    const downloadBlob=async b=>{
      const url=URL.createObjectURL(b);
      const a=document.createElement('a');
      a.href=url;a.download=filename;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
    };
    const setStatus=message=>{
      const el=modal.querySelector('.rank-card-share-status');
      if(el){el.textContent=message;el.classList.add('show')}
    };

    const caption=result.text;
    const link=result.gameLink;

    modal.querySelector('.rank-card-close').onclick=()=>{stop();closeRankCardModal()};
    modal.addEventListener('click',e=>{if(e.target===modal){stop();closeRankCardModal()}});

    const rankHeader=(()=>{
      const rank=result.rank;
      if(!rank)return 'Discovered';
      const mod100=rank%100;
      const suffix=(mod100>=11&&mod100<=13)?'TH':({1:'ST',2:'ND',3:'RD'}[rank%10]||'TH');
      return String(rank)+suffix;
    })();

    const rankContext=modal.querySelector('[data-rank-context]');
    if(rankContext)rankContext.textContent=String(g.name||'Unknown game')+' · '+rankHeader;

    wrap.dataset.tier=result.tier?.family||'blue';
    if(result.tier?.accent)wrap.style.setProperty('--rank-accent',result.tier.accent);

    const actions=document.createElement('div');
    actions.className='rank-card-actions';
    actions.innerHTML='<button class="btn primary" data-download>↓ Download Card</button><button class="btn" data-share>↗ Share Card</button>';
    wrap.parentElement.appendChild(actions);

    const toolsBox=document.createElement('div');
    toolsBox.className='rank-card-secondary';
    toolsBox.innerHTML='<button type="button" data-copy-caption>Copy caption</button><span class="rank-card-secondary-sep" aria-hidden="true">·</span><button type="button" data-copy-link>Copy link</button>';
    wrap.parentElement.appendChild(toolsBox);

    const sectionHead=document.createElement('div');
    sectionHead.className='rank-card-section-head';
    sectionHead.innerHTML='<div><h3 class="rank-card-section-title">Share your rank</h3><p class="rank-card-section-sub">Choose where to share</p></div>';
    wrap.parentElement.appendChild(sectionHead);

    const recommended=document.createElement('div');
    recommended.className='rank-card-recommended';
    recommended.innerHTML='<div class="rank-card-recommended-copy"><strong>Recommended</strong>Copy caption + share card for apps that separate the image and text.</div><button class="rank-card-recommended-action" type="button" data-recommended>Copy + share</button>';
    wrap.parentElement.appendChild(recommended);

    const platforms=document.createElement('div');
    platforms.className='rank-card-platform-grid';
    platforms.innerHTML=[
      ['Messenger','messenger','Prepare share'],
      ['Instagram','instagram','Prepare post'],
      ['TikTok','tiktok','Prepare post'],
      ['WhatsApp','whatsapp','Prepare share'],
      ['Facebook','facebook','Prepare post'],
      ['X','x','Prepare post'],
      ['Discord','discord','Prepare share'],
      ['More apps','native','Use share sheet']
    ].map(([name,key,sub])=>'<button class="btn platform" type="button" data-platform="'+key+'"><span class="platform-icon">'+shareIconSvg(key)+'</span><strong>'+name+'</strong><small>'+sub+'</small></button>').join('');
    wrap.parentElement.appendChild(platforms);

    const note=document.createElement('div');
    note.className='rank-card-note';
    note.textContent='Some apps may separate the image and caption. Bobaks keeps both ready for you.';
    wrap.parentElement.appendChild(note);

    const status=document.createElement('div');
    status.className='rank-card-share-status';
    wrap.parentElement.appendChild(status);

    modal.querySelector('[data-download]').onclick=async()=>{
      try{
        const b=await getBlob();
        await downloadBlob(b);
        setStatus('PNG downloaded. Your caption is ready to copy for platforms that need it separately.');
      }catch{setStatus('The card could not be downloaded. Try Copy caption or Share Card.')}
    };

    modal.querySelector('[data-share]').onclick=async()=>{
      try{
        const b=await getBlob();
        const file=new File([b],filename,{type:'image/png'});
        const canShareFiles=!!(navigator.canShare&&navigator.canShare({files:[file]}));

        if(navigator.share&&canShareFiles){
          await navigator.share({
            title:String(g.name||'Bobaks Game')+' · '+(result.rank?'#'+result.rank:'Unranked')+' · Bobaks Ranking',
            text:caption,
            url:link,
            files:[file]
          });
          setStatus('Share sheet used. If the selected app drops the caption, use Copy caption and paste it after sending the image.');
        }else if(navigator.share){
          await navigator.share({
            title:String(g.name||'Bobaks Game')+' · '+(result.rank?'#'+result.rank:'Unranked')+' · Bobaks Ranking',
            text:caption,
            url:link
          });
          setStatus('Text and link shared. Download PNG separately when the app requires the image.');
        }else{
          await copyText(caption);
          await downloadBlob(b);
          setStatus('Caption copied + PNG downloaded. You can post both on any platform.');
        }
      }catch(error){
        if(error?.name==='AbortError')return;
        setStatus('Sharing is unavailable here. Use Download PNG + Copy caption instead.');
      }
    };

    modal.querySelector('[data-copy-caption]').onclick=async()=>{
      try{
        await copyText(caption);
        setStatus('Caption copied. Paste it into Messenger, Instagram, TikTok, Facebook, WhatsApp, X, Discord, or another app.');
      }catch{
        setStatus('Clipboard access is unavailable. Use the device share action instead.');
      }
    };

    modal.querySelector('[data-copy-link]').onclick=async()=>{
      try{
        await copyText(link);
        setStatus('Bobaks link copied. Paste it below your caption on any platform.');
      }catch{setStatus('Clipboard access is unavailable.')}
    };

    modal.querySelector('[data-recommended]').onclick=async()=>{
      try{
        await copyText(caption);
        setStatus('Caption copied. Opening the share flow next…');
        modal.querySelector('[data-share]').click();
      }catch{
        setStatus('Clipboard access is unavailable. Use Share Card instead.');
      }
    };

    const preparePlatform=async key=>{
      const b=await getBlob();
      const open=url=>window.open(url,'_blank','noopener,noreferrer');

      if(key==='messenger'){
        await copyText(caption);
        if(navigator.share){
          const file=new File([b],filename,{type:'image/png'});
          const canShareFiles=!!(navigator.canShare&&navigator.canShare({files:[file]}));
          if(canShareFiles){
            try{
              await navigator.share({
                title:String(g.name||'Bobaks Game')+' · '+(result.rank?'#'+result.rank:'Unranked'),
                text:caption,
                url:link,
                files:[file]
              });
              setStatus('Caption copied. Choose Messenger in the share sheet, send the card, then paste the copied caption if Messenger sends only the image.');
              return;
            }catch(error){
              if(error?.name==='AbortError')return;
            }
          }
        }
        await downloadBlob(b);
        setStatus('Caption copied + PNG downloaded. Open Messenger, attach the image, then paste the copied caption.');
        return;
      }

      if(key==='whatsapp'){
        await downloadBlob(b);
        open('https://wa.me/?text='+encodeURIComponent(caption));
        setStatus('WhatsApp opened with the caption and Bobaks link. Attach the downloaded PNG if needed.');
        return;
      }

      if(key==='x'){
        await downloadBlob(b);
        open('https://twitter.com/intent/tweet?text='+encodeURIComponent(caption)+'&url='+encodeURIComponent(link));
        setStatus('X opened with the caption and Bobaks link. Add the downloaded PNG if you want the image attached.');
        return;
      }

      if(key==='facebook'){
        await copyText(caption);
        await downloadBlob(b);
        open('https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(link));
        setStatus('Facebook opened for the Bobaks link. Caption copied + PNG downloaded for your post.');
        return;
      }

      if(key==='instagram'){
        await copyText(caption);
        await downloadBlob(b);
        open('https://www.instagram.com/');
        setStatus('Instagram opened. Caption copied + PNG downloaded. Create a post and paste the caption.');
        return;
      }

      if(key==='tiktok'){
        await copyText(caption);
        await downloadBlob(b);
        open('https://www.tiktok.com/');
        setStatus('TikTok opened. Caption copied + PNG downloaded. Create a photo post and paste the caption.');
        return;
      }

      if(key==='discord'){
        await copyText(caption);
        await downloadBlob(b);
        open('https://discord.com/app');
        setStatus('Discord opened. Caption copied + PNG downloaded. Attach the card and paste the caption.');
        return;
      }

      if(key==='native'){
        const file=new File([b],filename,{type:'image/png'});
        if(navigator.share){
          try{
            if(navigator.canShare&&navigator.canShare({files:[file]})){
              await navigator.share({
                title:String(g.name||'Bobaks Game')+' · Bobaks Ranking',
                text:caption,
                url:link,
                files:[file]
              });
            }else{
              await navigator.share({
                title:String(g.name||'Bobaks Game')+' · Bobaks Ranking',
                text:caption,
                url:link
              });
            }
            setStatus('Native share sheet opened. Choose any supported app.');
            return;
          }catch(error){
            if(error?.name==='AbortError')return;
          }
        }
        await copyText(caption);
        await downloadBlob(b);
        setStatus('Caption copied + PNG downloaded. Use any app you like.');
      }
    };

    platforms.querySelectorAll('[data-platform]').forEach(btn=>{
      btn.onclick=async()=>{
        try{await preparePlatform(btn.dataset.platform)}
        catch{setStatus('Could not prepare this platform. Use Download PNG + Copy caption instead.')}
      };
    });
  }catch{
    if(modal)modal.remove();
    state.error='The Bobaks rank card could not be generated right now.';
    render();
  }
}

$('homeBtn').onclick=()=>goHome();
$('rankNav').onclick=()=>goHome();
$('savedNav').onclick=()=>{state.view='saved';render();track('saved_view')};
$('compareNav').onclick=()=>{state.view='compare';render();track('compare_view')};
$('themeNav').onclick=()=>setTheme(state.theme==='dark'?'light':'dark');
$('sidebarClose')?.addEventListener('click',()=>document.body.classList.remove('sidebar-open'));
$('mobileMenu')?.addEventListener('click',()=>document.body.classList.add('sidebar-open'));
$('mobileAccount')?.addEventListener('click',()=>{document.body.classList.remove('sidebar-open');goAccount()});
window.addEventListener('bobaks:account-ready',()=>{
  renderAccountArea();
  if(location.pathname==='/account'){
    if(isSignedIn()){state.view='account';setAccountMeta()}
    else {state.view='auth';authMeta(accountState()?.mode||'signin')}
    render();
  }
});
window.addEventListener('bobaks:auth-state',event=>{
  if(event.detail?.event==='SIGNED_OUT'){
    loadSaved();
    state.view=state.view==='account'||state.view==='auth'?'home':state.view;
    if(state.view==='home')setPageMeta(null);
    render();
  }
});
window.addEventListener('popstate',()=>{
  if(location.pathname==='/community'){state.view='community';state.selected=null;setCommunityMeta();render();track('page_view',{route:'/community'});return}
  if(location.pathname==='/account'){
    state.selected=null;
    state.view=isSignedIn()?'account':'auth';
    if(isSignedIn()){setAccountMeta()}else{authMeta(accountState()?.mode||'signin')}
    render();
    ensureAccountModule().then(()=>{
      state.view=isSignedIn()?'account':'auth';
      if(isSignedIn()){setAccountMeta()}else{authMeta(accountState()?.mode||'signin')}
      render();
    });
    return;
  }
  const gameMatch=location.pathname.match(GAME_ROUTE);
  if(gameMatch){openGame(gameMatch[1],{push:false});return}
  state.period=periodFromLocation();state.view='home';state.selected=null;setPageMeta(null);render();track('page_view',{period:state.period});loadRankings();
});
loadTheme();loadSaved();
ensureAccountModule();
state.period=periodFromLocation();
if(location.pathname==='/community'){state.view='community';setCommunityMeta();render();track('page_view',{route:'/community'});}
else if(location.pathname==='/account'){
  state.view=isSignedIn()?'account':'auth';
  if(isSignedIn()){setAccountMeta()}
  else {authMeta(accountState()?.mode||'signin')}
  render();
  ensureAccountModule().then(()=>{
    if(isSignedIn()){state.view='account';setAccountMeta()}
    else {state.view='auth';authMeta(accountState()?.mode||'signin')}
    render();
  });
}
else {
  const initialGame=location.pathname.match(GAME_ROUTE);
  if(initialGame){openGame(initialGame[1],{push:false});track('page_view',{gameId:initialGame[1],period:state.period});}
  else {setPageMeta(null);render();track('page_view',{period:state.period});loadRankings();}
}
setTimeout(()=>import('/return-loops.js').catch(()=>{}),800);
