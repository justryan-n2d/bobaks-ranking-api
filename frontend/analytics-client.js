(function(){
  const VISITOR_KEY='bobaks.analytics.visitor';
  const SESSION_KEY='bobaks.analytics.session';
  const VISITOR_TTL_MS=30*24*60*60*1000;
  const SESSION_IDLE_MS=30*60*1000;
  let memoryVisitor=null;
  let memorySession=null;

  function randomId(){
    try{
      if(window.crypto&&typeof window.crypto.randomUUID==='function'){
        return window.crypto.randomUUID().replaceAll('-','');
      }
      if(window.crypto&&typeof window.crypto.getRandomValues==='function'){
        const bytes=new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
      }
    }catch{}
    return Math.random().toString(36).slice(2)+Date.now().toString(36);
  }

  function read(storage,key){
    try{
      const raw=storage.getItem(key);
      return raw?JSON.parse(raw):null;
    }catch{
      return null;
    }
  }

  function write(storage,key,value){
    try{storage.setItem(key,JSON.stringify(value));}catch{}
  }

  function normalizedRandomId(){
    return randomId().replace(/[^a-f0-9]/gi,'').slice(0,32).padEnd(32,'0').toLowerCase();
  }

  function visitorId(now){
    if(memoryVisitor&&Number(memoryVisitor.expiresAt)>now&&typeof memoryVisitor.id==='string'){
      return memoryVisitor.id;
    }
    const saved=read(window.localStorage,VISITOR_KEY);
    if(saved&&typeof saved.id==='string'&&/^[a-f0-9]{32}$/i.test(saved.id)&&Number(saved.expiresAt)>now){
      return saved.id;
    }
    const id=normalizedRandomId();
    const next={id,expiresAt:now+VISITOR_TTL_MS};
    write(window.localStorage,VISITOR_KEY,next);
    memoryVisitor=next;
    return id;
  }

  function sessionId(now){
    if(memorySession&&Number(memorySession.lastSeenAt)>0&&now-Number(memorySession.lastSeenAt)<=SESSION_IDLE_MS){
      memorySession.lastSeenAt=now;
      return memorySession.id;
    }
    const saved=read(window.sessionStorage,SESSION_KEY);
    if(saved&&typeof saved.id==='string'&&/^[a-f0-9]{32}$/i.test(saved.id)&&Number(saved.lastSeenAt)>0&&now-Number(saved.lastSeenAt)<=SESSION_IDLE_MS){
      saved.lastSeenAt=now;
      write(window.sessionStorage,SESSION_KEY,saved);
      return saved.id;
    }
    const id=normalizedRandomId();
    const next={id,lastSeenAt:now};
    write(window.sessionStorage,SESSION_KEY,next);
    memorySession=next;
    return id;
  }

  function context(){
    const now=Date.now();
    let visitor='';
    let session='';
    try{visitor=visitorId(now);}catch{visitor=memoryVisitor?.id||'';}
    try{session=sessionId(now);}catch{session=memorySession?.id||'';}
    return {visitorId:visitor,sessionId:session};
  }

  window.__BOBAKS_ANALYTICS__={context};
})();
