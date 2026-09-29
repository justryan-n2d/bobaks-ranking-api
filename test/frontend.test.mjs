import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const frontendPath = path.resolve("frontend/index.html");

function readHtml() {
  assert.ok(fs.existsSync(frontendPath));
  return fs.readFileSync(frontendPath, "utf8");
}

test("frontend entrypoint exists and exposes Phase 5 gamer surfaces", () => {
  const html = readHtml();
  assert.match(html, /<title>Bobaks Ranking \| Live Rankings & Historical Trends<\/title>/);
  assert.match(html, /const API='https:\/\/bobaks-ranking-api-service\.ryan-oledan0\.workers\.dev';/);
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

test("frontend script parses as valid JavaScript", () => {
  const html = readHtml();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "frontend must contain an inline script");
  assert.doesNotThrow(() => new Function(match[1]));
});

test("frontend uses a device-local watchlist and bounded comparison", () => {
  const html = readHtml();
  assert.match(html, /bobaks\.watchlist/);
  assert.match(html, /state\.saved\.length<25/);
  assert.match(html, /state\.compare\.length<2/);
  assert.match(html, /navigator\.share/);
});

test("frontend refreshes from the server-supplied next collection time", () => {
  const html = readHtml();
  assert.match(html, /function schedule\(\)/);
  assert.match(html, /state\.next=p\.nextCollectionAt\|\|fallbackNext\(\)/);
  assert.match(html, /state\.timer=setTimeout\(loadRankings,/);
});

test("search does not replace the input element while typing", () => {
  const html = fs.readFileSync(frontendPath, "utf8");

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
  const html = fs.readFileSync(frontendPath, "utf8");

  assert.match(html, /function cardTier\(rank\)/);
  assert.match(html, /LEGENDARY/);
  assert.match(html, /EPIC/);
  assert.match(html, /RARE/);
  assert.match(html, /DISCOVERED/);
  assert.match(html, /function cardMessage\(g,rank\)/);
  assert.match(html, /function generateRankCard\(g\)/);
  assert.match(html, /CURRENT PLAYERS/);
  assert.match(html, /RECORDED PEAK/);
  assert.match(html, /Track this game and discover more rankings at/);
  assert.match(html, /location\.host/);
  assert.match(html, /canvas\.toBlob/);
  assert.match(html, /Download PNG/);
  assert.match(html, /navigator\.canShare/);
  assert.match(html, /files:\[file\]/);
  assert.match(html, /Bobaks Game Rank Card/);
});

test("rank card tiers match the Phase 5.5 rarity rules", () => {
  const html = readHtml();

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
  const html = readHtml();

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
  const html = readHtml();

  assert.match(html, /Keep your crown shining/);
  assert.match(html, /flying up the leaderboard/);
  assert.match(html, /Track this game and discover more rankings at/);
  assert.match(html, /location\.host/);
});

test("rank card preview uses randomized symbols with 0.5 second cross-fades and no white sweep export", () => {
  const html = readHtml();

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
  const html = readHtml();

  assert.match(html, /const gameLink=location\.origin/);
  assert.match(html, /Visit Bobaks Ranking:/);
  assert.match(html, /const shareText=\[/);
  assert.match(html, /text:caption/);
  assert.match(html, /url:link/);
  assert.match(html, /files:\[file\]/);
  assert.match(html, /title:String\(g\.name\|\|'Bobaks Game'\)/);
});

test("rank card share toolkit supports caption/link copy and major social platforms", () => {
  const html = readHtml();

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
  const html = readHtml();

  assert.match(html, /if\(key==='messenger'\)/);
  assert.match(html, /await copyText\(caption\)/);
  assert.match(html, /files:\[file\]/);
  assert.match(html, /paste the copied caption/);
});

test("share helper communicates platform limitations instead of claiming guaranteed combined sharing", () => {
  const html = readHtml();

  assert.match(html, /Some apps accept an image and text together/);
  assert.match(html, /prepares the caption and image separately/);
});

test("game rank cards use ordinal rank labels and rank-specific TOP badges", () => {
  const html = readHtml();

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
  const html = readHtml();

  assert.match(html, /<script src="\/qrcode-generator\.js"><\/script>/);
  assert.match(html, /function drawCardQr\(ctx,text,x,y,size,tier\)/);
  assert.match(html, /const qr=qrcode\(0,'M'\)/);
  assert.match(html, /qr\.addData\(text,'Byte'\)/);
  assert.match(html, /drawCardQr\(ctx,cardLink,930,1430,150,tier\)/);
  assert.match(html, /Scan the QR code to visit Bobaks Ranking/);
});

test("social helper buttons use custom neutral share icons and a consistent stacked layout", () => {
  const html = readHtml();

  assert.match(html, /function shareIconSvg\(key\)/);
  assert.match(html, /data-platform/);
  assert.match(html, /platform-icon/);
  assert.match(html, /<strong>\$\{name\}<\/strong>/);
  assert.match(html, /<small>\$\{sub\}<\/small>/);
  assert.match(html, /rank-card-platform-grid/);
});
