#!/usr/bin/env node

import fs from "node:fs/promises";

const FRONTEND_ORIGIN=(process.env.BOBAKS_FRONTEND_ORIGIN||"https://bobaks-ranking-api.ryan-oledan0.workers.dev").replace(/\/$/,"");
const API_ORIGIN=(process.env.BOBAKS_API_ORIGIN||"https://bobaks-ranking-api-service.ryan-oledan0.workers.dev").replace(/\/$/,"");
const SAMPLES=Math.max(3,Math.min(9,Number(process.env.BOBAKS_PERF_SAMPLES||5)));
const BUDGETS={htmlBytes:70000,appJsBytes:80000,qrcodeBytes:60000,p95TtfbMs:1500,p95TotalMs:3000};

async function fetchTrace(url){
  const start=performance.now();
  const response=await fetch(url,{redirect:"follow"});
  const headersAt=performance.now();
  const body=await response.arrayBuffer();
  const end=performance.now();
  return {url,status:response.status,ttfbMs:Number((headersAt-start).toFixed(2)),totalMs:Number((end-start).toFixed(2)),bodyBytes:body.byteLength,cacheStatus:response.headers.get("cf-cache-status"),cacheControl:response.headers.get("cache-control"),serverTiming:response.headers.get("server-timing")};
}

function percentile(values,p){
  const sorted=[...values].sort((a,b)=>a-b);
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil((p/100)*sorted.length)-1));
  return sorted[index];
}

async function trace(label,origin,path){
  const samples=[];
  for(let i=0;i<SAMPLES;i++) samples.push(await fetchTrace(origin+path));
  return {label,path,samples,summary:{
    p50TtfbMs:percentile(samples.map(x=>x.ttfbMs),50),
    p95TtfbMs:percentile(samples.map(x=>x.ttfbMs),95),
    p50TotalMs:percentile(samples.map(x=>x.totalMs),50),
    p95TotalMs:percentile(samples.map(x=>x.totalMs),95),
    maxBodyBytes:Math.max(...samples.map(x=>x.bodyBytes)),
    cacheStatuses:[...new Set(samples.map(x=>x.cacheStatus).filter(Boolean))]
  }};
}

async function discoverAppPath() {
  const response = await fetch(FRONTEND_ORIGIN + "/");
  if (!response.ok) throw new Error("Production homepage discovery failed with HTTP " + response.status);
  const html = await response.text();
  const match = html.match(/<script src="([^"]*app\.js[^"]*)"><\/script>/);
  if (!match) throw new Error("Could not discover deployed app.js URL");
  return match[1];
}
async function main(){
  const gameListResponse=await fetch(API_ORIGIN+"/api/games?limit=1&offset=0");
  if(!gameListResponse.ok) throw new Error("Production API discovery failed with HTTP "+gameListResponse.status);
  const gameList=await gameListResponse.json();
  const gameId=String(gameList?.data?.[0]?.id||"");
  if(!/^\d+$/.test(gameId)) throw new Error("Could not discover a production game ID");
  const traces=[];
  traces.push(await trace("homepage",FRONTEND_ORIGIN,"/"));
  traces.push(await trace("weekly-page",FRONTEND_ORIGIN,"/rankings/weekly"));
  traces.push(await trace("live-ranking-api",API_ORIGIN,"/api/rankings?period=live"));
  traces.push(await trace("game-page","/game/"+encodeURIComponent(gameId)));
  const appPath=await discoverAppPath();
  traces.push(await trace("app-js",FRONTEND_ORIGIN,appPath);
  traces.push(await trace("qr-js",FRONTEND_ORIGIN,"/qrcode-generator.js"));
  const violations=[];
  for(const t of traces){
    if(t.summary.p95TtfbMs>BUDGETS.p95TtfbMs)violations.push(t.label+" p95 TTFB "+t.summary.p95TtfbMs+"ms > "+BUDGETS.p95TtfbMs+"ms");
    if(t.summary.p95TotalMs>BUDGETS.p95TotalMs)violations.push(t.label+" p95 total "+t.summary.p95TotalMs+"ms > "+BUDGETS.p95TotalMs+"ms");
  }
  const byLabel=label=>traces.find(x=>x.label===label).summary.maxBodyBytes;
  if(byLabel("homepage")>BUDGETS.htmlBytes)violations.push("homepage body exceeds 70 KB");
  if(byLabel("app-js")>BUDGETS.appJsBytes)violations.push("app.js exceeds 80 KB");
  if(byLabel("qr-js")>BUDGETS.qrcodeBytes)violations.push("QR library exceeds 60 KB");
  const report={generatedAt:new Date().toISOString(),frontendOrigin:FRONTEND_ORIGIN,apiOrigin:API_ORIGIN,samplesPerTarget:SAMPLES,budgets:BUDGETS,traces};
  await fs.mkdir("performance-output",{recursive:true});
  await fs.writeFile("performance-output/production-performance.json",JSON.stringify(report,null,2)+"\n");
  const md=[
    "# Bobaks production performance trace",
    "",
    "Generated: "+report.generatedAt,
    "Frontend origin: "+FRONTEND_ORIGIN,
    "API origin: "+API_ORIGIN,
    "Samples per target: "+SAMPLES,
    "",
    "| Target | p50 TTFB | p95 TTFB | p50 total | p95 total | Max body | Cache |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...traces.map(t=>"| "+t.label+" | "+t.summary.p50TtfbMs+" ms | "+t.summary.p95TtfbMs+" ms | "+t.summary.p50TotalMs+" ms | "+t.summary.p95TotalMs+" ms | "+t.summary.maxBodyBytes+" B | "+(t.summary.cacheStatuses.join(", ")||"-")+" |")
  ].join("\n")+"\n";
  await fs.writeFile("performance-output/production-performance.md",md);
  console.log(md);
  if(violations.length){console.error("Performance budget violations:\n- "+violations.join("\n- "));process.exitCode=1;}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
