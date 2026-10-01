export function randomUrlSafeToken(length=32, cryptoImpl=globalThis.crypto){
  if(!cryptoImpl?.getRandomValues)throw new Error("Secure randomness is unavailable.");
  const bytes=new Uint8Array(length);
  cryptoImpl.getRandomValues(bytes);
  let value="";
  for(const byte of bytes)value+=byte.toString(16).padStart(2,"0");
  return value;
}

export async function createPkceChallenge(verifier,cryptoImpl=globalThis.crypto){
  const value=String(verifier||"");
  if(value.length<43)throw new Error("PKCE verifier is too short.");
  if(!cryptoImpl?.subtle?.digest)throw new Error("Web Crypto is unavailable.");
  const encoded=new TextEncoder().encode(value);
  const digest=await cryptoImpl.subtle.digest("SHA-256",encoded);
  let binary="";
  for(const byte of new Uint8Array(digest))binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

export function buildRobloxAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  nonce,
  scopes=["openid","profile"]
}={}){
  const client=String(clientId||"").trim();
  const redirect=String(redirectUri||"").trim();
  if(!client||!redirect||!state||!codeChallenge)throw new Error("Roblox OAuth configuration is incomplete.");
  const url=new URL("https://apis.roblox.com/oauth/v1/authorize");
  url.searchParams.set("client_id",client);
  url.searchParams.set("redirect_uri",redirect);
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope",scopes.join(" "));
  url.searchParams.set("state",String(state));
  url.searchParams.set("code_challenge",String(codeChallenge));
  url.searchParams.set("code_challenge_method","S256");
  if(nonce)url.searchParams.set("nonce",String(nonce));
  return url.toString();
}
