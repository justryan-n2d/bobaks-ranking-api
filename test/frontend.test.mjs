import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const frontendPath = path.resolve("frontend/index.html");
const returnLoopsPath = path.resolve("frontend/return-loops.js");
const appPath = path.resolve("frontend/app.js");

function readHtml() {
  assert.ok(fs.existsSync(frontendPath));
  return fs.readFileSync(frontendPath, "utf8");
}

function readReturnLoops() {
  assert.ok(fs.existsSync(returnLoopsPath));
  return fs.readFileSync(returnLoopsPath, "utf8");
}

function readApp() {
  assert.ok(fs.existsSync(appPath));
  return fs.readFileSync(appPath, "utf8");
}

function readFrontend() {
  return readHtml() + "\n" + readApp();
}

test("frontend entrypoint contains Phase 6 SEO and routing surfaces", () => {
  const html = readFrontend();
  assert.match(html, /id="seo-description"/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:url"/);
  assert.match(html, /name="twitter:card"/);
  assert.ok(html.includes("const GAME_ROUTE=/^\\/game\\/(\\d+)$/;"));
  assert.ok(html.includes("const RANKING_PATHS={live:'/',week:'/rankings/weekly',month:'/rankings/monthly',year:'/rankings/yearly'};"));
  assert.ok(html.includes("function periodFromLocation()"));
  assert.ok(html.includes("/rankings/weekly"));
  assert.ok(html.includes("/rankings/monthly"));
  assert.ok(html.includes("/rankings/yearly"));
  assert.match(html, /history\.pushState/);
  assert.match(html, /function track\(event,data=\{\}\)/);
  assert.match(html, /sendBeacon\('\/analytics'/);
  assert.match(html, /const gameUrl=id=>new URL\('\/game\/'/);
});

test("frontend analytics uses anonymous visitor/session context without sending search text", () => {
  const html = readFrontend();
  assert.ok(html.includes('<script src="/analytics-client.js"></script>'));
  assert.match(html, /visitorId:analyticsContext\.visitorId/);
  assert.match(html, /sessionId:analyticsContext\.sessionId/);
  assert.match(html, /sendBeacon\('\/analytics'/);
  assert.doesNotMatch(html, /search_used[^\n]*query/);

  const client = fs.readFileSync(path.resolve("frontend/analytics-client.js"), "utf8");
  assert.match(client, /window\.__BOBAKS_ANALYTICS__=\{context\};/);
  assert.match(client, /bobaks\.analytics\.visitor/);
  assert.match(client, /bobaks\.analytics\.session/);
  assert.match(client, /30\*24\*60\*60\*1000/);
  assert.match(client, /30\*60\*1000/);
  assert.match(client, /crypto\.randomUUID/);
  assert.match(client, /localStorage/);
  assert.match(client, /sessionStorage/);
});

test("frontend entrypoint exists and exposes Phase 5 gamer surfaces", () => {
  const html = readFrontend();
  assert.match(html, /<title>Bobaks Ranking \| Live Rankings & Historical Trends<\/title>/);
  assert.match(html, /const API='\/api';window\.__BOBAKS_API__=API;/);
  for (const period of ["live", "week", "month", "year"]) {
    assert.ok(html.includes("'" + period + "'") || html.includes('"' + period + '"'));
  }
  for (const feature of ["Rankings", "Saved", "Compare", "Share rank card", "Recorded Peak", "Rank History", "How Bobaks Rankings Work"]) {
    assert.match(html, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /\/api\/search\?q=/);
  assert.match(html, /\/api\/games\//);
  assert.match(html, /\/history\?days=365/);
  assert.match(html, /\/rank-history\?days=31/);
  assert.match(html, /\/peak/);
  assert.match(html, /previousRank/);
  assert.match(html, /rankChange/);
  assert.doesNotMatch(html, /bobaks-api-production\.up\.railway\.app/);
});

test("frontend application bundle parses as valid JavaScript", () => {
  const app = readApp();
  assert.doesNotThrow(() => new Function(app));
});

test("frontend exposes a social ranking share flow for every ranking period", () => {
  const html = readFrontend();
  assert.match(html, /function rankingShareText\(period,games\)/);
  assert.match(html, /id="shareRanking"/);
  assert.match(html, /rankingPath\(state\.period\)/);
  assert.match(html, /channel:'social_'\+kind/);
  assert.match(html, /Top 10/);
  assert.match(html, /navigator\.share/);
  assert.match(html, /navigator\.clipboard\.writeText/);
});

test("frontend uses the automation-ready social feed for ranking, trending, and peak sharing", () => {
  const html = readFrontend();
  assert.match(html, /function shareSocialPost\(kind\)/);
  assert.match(html, /\/api\/social\/feed\?period=/);
  assert.match(html, /id="shareTrending"/);
  assert.match(html, /id="sharePeaks"/);
  assert.match(html, /shareRanking\(\)/);
  assert.match(html, /shareSocialPost\('trending'\)/);
  assert.match(html, /shareSocialPost\('peaks'\)/);
});

test("frontend labels rank movement as trending and exposes peak-record sharing", () => {
  const html = readFrontend();
  assert.match(html, /Trending Games/);
  assert.match(html, /Share trending/);
  assert.match(html, /Peak Records/);
  assert.match(html, /Share peak records/);
});

test("frontend ranking share content includes game name, rank, players, and canonical ranking link", () => {
  const html = readFrontend();
  assert.match(html, /const lines=\(games\|\|\[\]\)\.slice\(0,10\)/);
  assert.match(html, /const rank=Number\(g\.rank\|\|index\+1\)/);
  assert.match(html, /const players=fmt\(g\.playing\)/);
  assert.match(html, /const url=new URL\(rankingPath\(period\),location\.origin\)\.toString\(\)/);
  assert.match(html, /Visit Bobaks Ranking:/);
});

test("privacy copy discloses anonymous product analytics identifiers", () => {
  const html = readFrontend();
  assert.ok(html.includes("Anonymous first-party visitor and session identifiers may be used"));
  assert.ok(html.includes("Visitor identifiers expire after 30 days"));
  assert.ok(html.includes("session identifiers use a 30-minute idle window"));
  assert.ok(html.includes("are not Roblox account IDs"));
  assert.ok(html.includes("do not include IP addresses or raw search text"));
});

test("frontend records direct-entry page views and loads the analytics client", () => {
  const html = readFrontend();
  assert.match(
    html,
    /if\(initialGame\)\{openGame\(initialGame\[1\],\{push:false\}\);track\('page_view',\{gameId:initialGame\[1\],period:state\.period\}\);\}/
  );
  assert.match(
    html,
    /else \{setPageMeta\(null\);render\(\);track\('page_view',\{period:state\.period\}\);loadRankings\(\);\}/
  );

  const client = fs.readFileSync(path.resolve("frontend/analytics-client.js"), "utf8");
  assert.doesNotThrow(() => new Function(client));
});

test("frontend uses a device-local watchlist and bounded comparison", () => {
  const html = readFrontend();
  assert.match(html, /bobaks\.watchlist/);
  assert.match(html, /state\.saved\.length<25/);
  assert.match(html, /state\.compare\.length<2/);
  assert.match(html, /navigator\.share/);
});

test("frontend refreshes from the server-supplied next collection time", () => {
  const html = readFrontend();
  assert.match(html, /function schedule\(\)/);
  assert.match(html, /state\.next=p\.nextCollectionAt\|\|fallbackNext\(\)/);
  assert.match(html, /state\.timer=setTimeout\(loadRankings,/);
});

test("search does not replace the input element while typing", () => {
  const html = readFrontend();

  assert.match(html, /function renderSearchResults\(\)/);
  assert.match(html, /query!==state\.query\.trim\(\)/);
  assert.match(html, /state\.results=\[\];renderSearchResults\(\)/);
  assert.match(html, /state\.results=\(p\.data\|\|\[\]\)\.map/);
  assert.doesNotMatch(
    html,
    /async function search\(q\)\{[^}]*render\(\);[^}]*state\.results=/
  );
  assert.doesNotMatch(
    html,
    /setInterval\(\(\)=>\{if\(state\.view==='home'\|\|state\.view==='detail'\)render\(\)\},1000\)/
  );
});

test("frontend references the Bobaks logo as its favicon and brand mark", () => {
  const html = fs.readFileSync(frontendPath, "utf8");
  assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/assets\/bobaks-logo\.png">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/bobaks-logo\.png">/);
  assert.match(html, /<img class="mark" src="\/assets\/bobaks-logo\.png" alt="">/);
});

test("data-driven rank card generator is wired for dynamic rank tiers and export", () => {
  const html = readFrontend();

  assert.match(html, /function cardTier\(rank\)/);
  assert.match(html, /LEGENDARY/);
  assert.match(html, /EPIC/);
  assert.match(html, /RARE/);
  assert.match(html, /DISCOVERED/);
  assert.match(html, /function cardMessage\(g,rank\)/);
  assert.match(html, /function generateRankCard\(g\)/);
  assert.match(html, /CURRENT PLAYERS/);
  assert.match(html, /RECORDED PEAK/);
  assert.ok(html.includes("Track this game on Bobaks Ranking"));
  assert.match(html, /location\.host/);
  assert.match(html, /canvas\.toBlob/);
  assert.match(html, /Download PNG/);
  assert.match(html, /navigator\.canShare/);
  assert.match(html, /files:\[file\]/);
  assert.match(html, /Bobaks Game Rank Card/);
});

test("rank card tiers match the Phase 5.5 rarity rules", () => {
  const html = readFrontend();

  const legendary = html.match(/if\(n===1\)return \{[\s\S]*?name:'LEGENDARY',[\s\S]*?family:'gold'/);
  const epic = html.match(/if\(n>=2&&n<=3\)return \{[\s\S]*?name:'EPIC',[\s\S]*?family:'purple'/);
  const rare = html.match(/if\(n>=4&&n<=10\)return \{[\s\S]*?name:'RARE',[\s\S]*?family:'blue'/);
  const uncommon = html.match(/if\(n>=11&&n<=25\)return \{[\s\S]*?name:'UNCOMMON',[\s\S]*?family:'green'/);
  const common = html.match(/if\(n>=26&&n<=100\)return \{[\s\S]*?name:'COMMON',[\s\S]*?family:'white'/);
  assert.ok(legendary && epic && rare && uncommon && common);
  assert.match(html, /name:'DISCOVERED',[\s\S]*?family:'discovered'/);
  assert.match(html, /accent:'#FFD34F'/);
  assert.match(html, /accent:'#A66CFF'/);
  assert.match(html, /accent:'#25C7FF'/);
  assert.match(html, /accent:'#45E28C'/);
  assert.match(html, /accent:'#E9F0F7'/);
});

test("rank card preview animates symbols and exports a still image", () => {
  const html = readFrontend();

  assert.match(html, /function drawRandomSymbols\(ctx,time,preview\)/);
  assert.match(html, /const step=500/);
  assert.match(html, /const types=\['block','circle','triangle','square','gamepad'\]/);
  assert.match(html, /requestAnimationFrame\(tick\)/);
  assert.match(html, /startAnimation\(\)/);
  assert.match(html, /result\.drawFrame\(performance\.now\(\),false\)/);
  assert.match(html, /canvas\.toBlob/);
  assert.match(html, /Download PNG/);
  assert.match(html, /Share Card/);
  assert.doesNotMatch(html, /const shimmer=ctx\.createLinearGradient/);
});

test("rank card contains gamer-facing encouragement and Bobaks CTA", () => {
  const html = readFrontend();

  assert.match(html, /Keep your crown shining/);
  assert.match(html, /flying up the leaderboard/);
  assert.ok(html.includes("Track this game on Bobaks Ranking"));
  assert.match(html, /location\.host/);
});

test("rank card preview uses randomized symbols with 0.5 second cross-fades and no white sweep export", () => {
  const html = readFrontend();

  assert.match(html, /function drawRandomSymbols\(ctx,time,preview\)/);
  assert.match(html, /const step=500/);
  assert.match(html, /const types=\['block','circle','triangle','square','gamepad'\]/);
  assert.match(html, /const fadeOut=/);
  assert.match(html, /const fadeIn=/);
  assert.match(html, /drawSymbol\(/);
  assert.doesNotMatch(html, /const shimmer=ctx\.createLinearGradient/);
  assert.doesNotMatch(html, /ctx\.fillStyle=shimmer/);
  assert.match(html, /if\(!preview\)return;/);
});

test("rank card sharing includes game name, rank, message, link, and PNG file", () => {
  const html = readFrontend();

  assert.match(html, /const gameLink=gameUrl\(g\.gameId\|\|g\.id\)/);
  assert.match(html, /Visit Bobaks Ranking:/);
  assert.match(html, /const shareText=\[/);
  assert.match(html, /text:caption/);
  assert.match(html, /url:link/);
  assert.match(html, /files:\[file\]/);
  assert.match(html, /title:String\(g\.name\|\|'Bobaks Game'\)/);
});

test("rank card share toolkit supports caption/link copy and major social platforms", () => {
  const html = readFrontend();

  for (const label of [
    "Copy caption",
    "Copy link",
    "Messenger",
    "Instagram",
    "TikTok",
    "WhatsApp",
    "Facebook",
    "Discord",
    "More apps"
  ]) {
    assert.match(html, new RegExp(label));
  }

  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /Visit Bobaks Ranking:/);
  assert.match(html, /key==='messenger'/);
  assert.match(html, /key==='instagram'/);
  assert.match(html, /key==='tiktok'/);
  assert.match(html, /key==='whatsapp'/);
  assert.match(html, /key==='facebook'/);
  assert.match(html, /key==='x'/);
  assert.match(html, /key==='discord'/);
  assert.match(html, /key==='native'/);
  assert.match(html, /twitter\.com\/intent\/tweet/);
  assert.match(html, /facebook\.com\/sharer\/sharer\.php/);
  assert.match(html, /instagram\.com/);
  assert.match(html, /tiktok\.com/);
  assert.match(html, /discord\.com\/app/);
});

test("Messenger helper prepares the image plus copied caption for apps that split media and text", () => {
  const html = readFrontend();

  assert.match(html, /if\(key==='messenger'\)/);
  assert.match(html, /await copyText\(caption\)/);
  assert.match(html, /files:\[file\]/);
  assert.match(html, /paste the copied caption/);
});

test("share helper communicates platform limitations instead of claiming guaranteed combined sharing", () => {
  const html = readFrontend();

  assert.ok(html.includes('If the selected app drops the caption, use Copy caption and paste it after sending the image.'));
  assert.ok(html.includes('PNG downloaded. Your caption is ready to copy for platforms that need it separately.'));
});

test("game rank cards use ordinal rank labels and rank-specific TOP badges", () => {
  const html = readFrontend();

  assert.match(html, /function ordinalRank\(rank\)/);
  assert.match(html, /const suffix=\(/);
  assert.match(html, /ctx\.fillText\(ord\.number/);
  assert.match(html, /ctx\.fillText\(ord\.suffix/);
  assert.match(html, /badge:'TOP 1'/);
  assert.match(html, /badge:'TOP 3'/);
  assert.match(html, /badge:'TOP 10'/);
  assert.match(html, /badge:'TOP 25'/);
  assert.match(html, /badge:'TOP 100'/);
  assert.match(html, /badge:'DISCOVERED'/);
  assert.match(html, /drawOrdinalRank\(ctx,rank,W\/2,315\)/);
});

test("game rank cards embed a self-contained QR code linked to the Bobaks website", () => {
  const html = readFrontend();

  assert.doesNotMatch(readHtml(), /<script[^>]+src="\/qrcode-generator\.js"/);
  assert.match(html, /function drawCardQr\(ctx,text,x,y,size,tier\)/);
  assert.match(html, /const qr=qrcode\(0,'M'\)/);
  assert.match(html, /qr\.addData\(text,'Byte'\)/);
  assert.ok(html.includes("drawCardQr(ctx,cardLink,945,1396,112,tier)"));
  assert.ok(html.includes("SCAN TO VISIT BOBAKS"));
});

test("social helper buttons use custom neutral share icons and a consistent stacked layout", () => {
  const html = readFrontend();

  assert.match(html, /function shareIconSvg\(key\)/);
  assert.match(html, /data-platform/);
  assert.match(html, /platform-icon/);
  assert.match(html, /\.map\(\(\[name,key,sub\]\)/);
  assert.match(html, /data-platform/);
  assert.match(html, /rank-card-platform-grid/);
});


test("frontend exposes a Community hub with the Phase 6.3 community actions", () => {
  const html = readFrontend();
  assert.ok(html.includes("Community"));
  assert.ok(html.includes("/community"));
  for (const label of [
    "Discord community",
    "Feedback",
    "Feature requests",
    "Bug reports",
    "Community polls",
    "Game discovery"
  ]) {
    assert.ok(html.includes(label), "missing community label: " + label);
  }
  assert.ok(html.includes("bobaksranking@gmail.com"));
  assert.ok(html.includes("DISCORD_INVITE_URL"));
});

test("frontend community page keeps the Discord destination configurable and gives email fallbacks", () => {
  const html = readFrontend();
  assert.ok(html.includes("const COMMUNITY_DISCORD_URL="));
  assert.ok(html.includes("mailto:bobaksranking@gmail.com"));
  assert.ok(html.includes("Feature request"));
  assert.ok(html.includes("Bug report"));
  assert.ok(html.includes("Community polls"));
  assert.ok(html.includes("Game discovery"));
});


test("frontend Community navigation uses a real route link so server configuration is loaded", () => {
  const html = readFrontend();
  assert.match(html, /<a id="communityNav"[^>]*href="\/community"[^>]*>Community<\/a>/);
  assert.doesNotMatch(html, /communityNav\.onclick=\(\)=>goCommunity\(\)/);
});

test("Phase 6.4 return-loop module is wired into the SPA and keeps watchlist alerts local", () => {
  const html = readFrontend();
  const module = readReturnLoops();
  assert.match(html, /window\.__BOBAKS_API__=API/);
  assert.match(html, /setTimeout\(\(\)=>import\('\/return-loops\.js'\)\.catch\(\(\)=>\{\}\),800\)/);
  assert.match(module, /bobaks\.return\.alert-preferences/);
  assert.match(module, /bobaks\.return\.observations/);
  assert.match(module, /bobaks\.return\.peaks/);
  assert.match(module, /bobaks\.return\.alert-feed/);
  assert.match(module, /data-return-alert/);
  assert.match(module, /Historical Milestones/);
  assert.match(module, /DAILY RANKINGS/);
  assert.match(module, /WEEKLY CHANGES/);
  assert.match(module, /BIGGEST MOVERS/);
  assert.match(module, /NEW PEAKS/);
  assert.match(module, /WATCHLIST/);
});

test("game detail exposes the selected game to the return-loop module without changing ranking routes", () => {
  const html = readFrontend();
  assert.match(html, /window\.__BOBAKS_SELECTED_GAME__=state\.selected/);
  assert.match(html, /function openGame\(id,\{push=true\}=\{\}\)/);
  assert.ok(html.includes("api('/api/games/'+encodeURIComponent(gameId)+'/history?days=365')"));
  assert.ok(html.includes("api('/api/games/'+encodeURIComponent(gameId)+'/rank-history?days=31')"));
});


test("return-loop decoration is guarded against stale homepage renders", () => {
  const module = readReturnLoops();
  assert.match(module, /isCurrentHomeDecoration/);
  assert.match(module, /capturedHost: host/);
  assert.match(module, /currentHost: document\.querySelector\("\.dashboard"\)/);
  assert.match(module, /capturedPath: pagePath/);
  assert.match(module, /currentPath: location\.pathname/);
  assert.match(module, /host\.dataset\.returnHubPending === "1"/);
  assert.match(module, /host\.dataset\.returnHubPending = "1"/);
});


test("frontend has a small HTML shell and keeps optional modules out of the critical path", () => {
  const html = readHtml();
  const app = readApp();
  assert.ok(Buffer.byteLength(html, "utf8") <= 70000);
  assert.ok(Buffer.byteLength(app, "utf8") <= 80000);
  assert.doesNotMatch(html, /<script[^>]+src="\/qrcode-generator\.js"/);
  assert.doesNotMatch(html, /<script[^>]+src="\/return-loops\.js"/);
  assert.match(app, /ensureQrCode/);
  assert.match(app, /setTimeout\(\(\)=>import\('\/return-loops\.js'\)\.catch\(\(\)=>\{\}\),800\)/);
});

test("frontend API cache deduplicates identical requests and bypasses cache on manual refresh", () => {
  const app = readApp();
  assert.match(app, /const API_CACHE=new Map()/);
  assert.match(app, /if\(hit&&hit\.expiresAt>now\)return hit\.promise/);
  assert.match(app, /cache:cache\?'default':'no-store'/);
  assert.match(app, /window\.__BOBAKS_API_REQUEST__=api/);
});

test("Cloudflare frontend routes API requests to the Worker before SPA fallback", () => {
  const config = fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8");
  const assets = config.match(/"assets"\s*:\s*\{([\s\S]*?)\n\s*\}\s*,\n\s*"vars"/);
  assert.ok(assets, "assets configuration must be present");
  assert.match(
    assets[1],
    /"run_worker_first"\s*:\s*\[[\s\S]*"\/api\/\*"/
  );
});

test("ranking data requests bypass browser cache to avoid stale SPA fallback responses", () => {
  const app = readApp();
  assert.match(
    app,
    /const p=await api\('\/api\/rankings\?period='\+encodeURIComponent\(state\.period\),\{cache:false\}\)/
  );
});

test("homepage uses an explicit app bundle version", () => {
  const html = readHtml();
  assert.match(html, /<script src="\/app\.js\?v=\d{8}-[a-z0-9-]+"><\/script>/);
});
test("frontend API helper avoids duplicating the /api prefix", () => {
  const app = readApp();
  assert.ok(app.includes("const requestPath=key.startsWith(API+'/')?key.slice(API.length):key;"));
  assert.ok(app.includes("fetch(API+requestPath,{headers:{accept:'application/json'},cache:cache?'default':'no-store'})"));
});


test("Phase 6.7 account foundation loads a browser auth module", () => {
  const html = readHtml();
  const account = fs.readFileSync(path.resolve("frontend/account.js"), "utf8");
  const core = fs.readFileSync(path.resolve("frontend/account-core.mjs"), "utf8");

  assert.match(html, /<script type="module" src="\/account\.js\?v=20261001-auth"><\/script>/);
  assert.match(account, /createAuthClient/);
  assert.match(account, /window\.__BOBAKS_AUTH__/);
  assert.match(account, /bobaks:auth-ready/);
  assert.match(core, /export const SESSION_STORAGE_KEY = "bobaks\.auth\.session\.v1"/);
  assert.match(core, /auth\/v1\/signup/);
  assert.match(core, /auth\/v1\/token\?grant_type=password/);
  assert.match(core, /rest\/v1/);
});

test("Cloudflare frontend exposes only public Supabase auth configuration", () => {
  const config = fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8");
  assert.match(config, /"SUPABASE_URL"\s*:/);
  assert.match(config, /"SUPABASE_PUBLISHABLE_KEY"\s*:\s*"sb_publishable_/);
  assert.doesNotMatch(config, /"SUPABASE_(?:SERVICE_ROLE_KEY|SECRET_KEY|SECRET_KEYS?)"/);
});


test("Phase 6.7 Account UX includes sign-in/sign-up, session-aware account area, profile, alerts, and synced watchlist surfaces", () => {
  const html = readFrontend();
  const app = readApp();
  const core = fs.readFileSync(path.resolve("frontend/account-core.mjs"), "utf8");
  const returnLoops = fs.readFileSync(path.resolve("frontend/return-loops.js"), "utf8");

  assert.match(html, /id="siteSidebar"/);
  assert.match(html, /id="accountArea"/);
  assert.match(html, /id="mobileMenu"/);
  assert.match(app, /function authPage()/);
  assert.match(app, /function accountPage()/);
  assert.match(app, /function hydrateAccount({migrateGuest=true,rerender=true}={})/);
  assert.match(app, /client.addWatchlistGame(id)/);
  assert.match(app, /client.removeWatchlistGame(id)/);
  assert.match(app, /function submitProfile()/);
  assert.match(app, /function submitAlertSettings()/);
  assert.match(app, /id="profileForm"/);
  assert.match(app, /id="alertForm"/);
  assert.match(app, /Persistent alerts/);
  assert.match(app, /Synced to your Bobaks account/);
  assert.match(app, /Sign in/);
  assert.match(app, /Create account/);
  assert.match(core, /recoverSessionFromUrl/);
  assert.match(returnLoops, /window\.__BOBAKS_ACCOUNT_ALERT_PREFS__/);
  assert.match(html, /responsive session-aware sidebar account UI/);
});

test("guest and account watchlist states are explicitly separated", () => {
  const app = readApp();
  const account = fs.readFileSync(path.resolve("frontend/account.js"), "utf8");
  assert.match(app, /Saved only on this device\. Sign in to sync across devices/);
  assert.match(account, /Synced to your Bobaks account across devices/);
  assert.match(account, /migrateGuest/);
});

test("account alert settings feed the existing return-loop alert checks", () => {
  const module = fs.readFileSync(path.resolve("frontend/return-loops.js"), "utf8");
  assert.match(module, /account.alerts_enabled && account.top10_enabled/);
  assert.match(module, /account.alerts_enabled && account.new_peak_enabled/);
  assert.match(module, /account.alerts_enabled && account.rank_jump_enabled/);
  assert.match(module, /Account-wide alert settings sync across devices/);
});
