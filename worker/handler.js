const actions=new Set(['trending','search','filter','detail','download']);
const params=new Set(['action','subjectId','detailPath','season','episode','se','ep','page','perPage','keyword','region','subjectType']);
const quotaMessage="The file host has reached its download quota for this copy. Try a different quality or check back later.";
function fileError(message,status){
  return new Response(message,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
// Reuse the fresh result that populated the quality picker on this Worker instance.
const recentSources=new Map();
function sourceKey(query){
  return JSON.stringify(['subjectId','detailPath','se','ep','season','episode'].map(key=>query.get(key)||''));
}
function rememberSources(query,data){
  if(!data.success || !data.qualities?.length)return;
  const key=sourceKey(query);
  recentSources.delete(key);
  if(recentSources.size>=64)recentSources.delete(recentSources.keys().next().value);
  recentSources.set(key,{data,until:Date.now()+60000});
}
async function downloadFile(params,request,watch){
  const query=new URLSearchParams({action:'download'});
  for(const key of ['subjectId','detailPath','se','ep','season','episode']){
    const value=params.get(key);
    if(value!==null)query.set(key,value);
  }
  const quality=params.get('quality');
  if(!/^\d+$/.test(query.get('subjectId')||'') || !query.get('detailPath') || !quality)return fileError('Select a title and quality again.',400);
  let stage='download provider';
  try{
    const entry=recentSources.get(sourceKey(query));
    let data=entry && entry.until>Date.now()?entry.data:null;
    if(!data){
      const metadata=await fetch('https://api.omegatech.app/api/movie/MovieBox-pro2?'+query,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
      if(!metadata.ok)return fileError('The download provider could not refresh this link (HTTP '+metadata.status+'). Reopen Downloads and try again later.',502);
      data=await metadata.json();
      if(data.success===false)return fileError('The download provider could not issue a fresh link for this title.',502);
      rememberSources(query,data);
    }
    stage='file host';
    const rows=[...(data.qualities||[]),...(data.availableStreams||[]),...(data.downloads||[])];
    const source=rows.find(row=>!row.vipLocked && (row.quality||row.resolution)===quality && (row.directUrl || (watch?row.streamUrl||row.url:row.downloadUrl)));
    if(!source)return fileError('This quality is currently unavailable. Select another quality.',404);
    let target=new URL(watch?source.streamUrl||source.url||source.directUrl:source.downloadUrl||source.directUrl);
    if(source.directUrl){
      const media=new URL(source.directUrl);
      if(media.protocol==='https:' && !media.username && !media.password && !media.port && /^(?:[a-z0-9-]+\.)+hakunaymatata\.com$/i.test(media.hostname)){
        target=new URL('https://api.omegatech.app/api/movie/MovieBox-pro2');
        target.search=new URLSearchParams({action:'video',url:media.href});
      }
    }
    for(let hop=0;hop<8;hop++){
      if(target.protocol!=='https:' || target.port || target.username || target.password || !/^(?:api\.omegatech\.app|mbx-core-gateway-v2\.mymovieroom\.workers\.dev|proxy\.cinemind\.name\.ng|(?:[a-z0-9-]+\.)*(?:googleapis\.com|googleusercontent\.com|googlevideo\.com|usercontent\.google\.com|hakunaymatata\.com)|drive\.google\.com)$/i.test(target.hostname))return fileError('This provider link uses a file host Setal does not currently support.',502);
      const abort=new AbortController();
      const timeout=setTimeout(()=>abort.abort(),20000);
      let file;
      try{file=await fetch(target,{method:request.method,headers:request.headers.has('Range')?{Range:request.headers.get('Range')}:{},redirect:'manual',signal:abort.signal})}finally{clearTimeout(timeout)}
      if([301,302,303,307,308].includes(file.status)&&file.headers.has('Location')){
        await file.body?.cancel();
        target=new URL(file.headers.get('Location'),target);
        continue;
      }
      const type=file.headers.get('Content-Type')||'';
      if(file.ok && /^(video\/|application\/(?:octet-stream|force-download|mp4|x-download))/.test(type)){
        const name=(query.get('detailPath')+'-'+quality).replace(/[^a-z0-9_-]/gi,'_').slice(0,160);
        const headers={'Content-Type':type,'Content-Disposition':(watch?'inline':'attachment')+'; filename="'+name+'.mp4"','Cache-Control':'no-store'};
        if(file.headers.has('Content-Length')&&!file.headers.has('Content-Encoding'))headers['Content-Length']=file.headers.get('Content-Length');
        for(const key of ['Content-Range','Accept-Ranges'])if(file.headers.has(key))headers[key]=file.headers.get(key);
        return new Response(file.body,{status:file.status,headers});
      }
      const reader=file.body?.getReader();
      let errorText='';
      if(reader){
        const decoder=new TextDecoder();
        try{while(errorText.length<8192){const {value,done}=await reader.read();if(done)break;errorText+=decoder.decode(value.subarray(0,8192),{stream:true})}}finally{await reader.cancel()}
      }
      if(/downloadQuotaExceeded|download quota.{0,60}exceeded/i.test(errorText))return fileError(quotaMessage,429);
      if(file.status===429)return fileError('The provider is rate-limiting this video (HTTP 429). Try again later.',429);
      return fileError('The file host could not provide this download. Try another quality or check back later.',502);
    }
    return fileError('The file host redirected the request too many times.',502);
  }catch(error){
    if(['AbortError','TimeoutError'].includes(error?.name))return fileError('The '+stage+' timed out. Try the download again later.',504);
    return fileError('Setal could not complete the request to the '+stage+'. Try again later.',502);
  }
}
const captionCache=new Map();
let captionCatalog;
async function subtitleTracks(slug,season,episode,subject,key){
  if(!subject){
    captionCatalog??=new Map(Object.values(JSON.parse(pages['/catalog.json'].body)).flat().filter(x=>x.detailPath&&x.subjectId).map(x=>[x.detailPath,String(x.subjectId)]));
    subject=captionCatalog.get(slug)||'';
  }
  const cacheKey=JSON.stringify([slug,season,episode,subject]),cached=captionCache.get(cacheKey);
  if(cached&&cached.until>Date.now())return cached.list;
  const params=new URLSearchParams({id:slug});
  if(season){params.set('season',season);params.set('episode',episode)}
  const base='https://api.globalmovie.site/proxy-api/api/';
  const feeds=[];
  if(key)feeds.push([new URL('subtitles?'+new URLSearchParams([...params,['apikey',key]]),base),'GlobalMovie subtitles']);
  feeds.push([new URL((season?'tv?':'movie?')+params,base),'GlobalMovie title']);
  if(/^\d+$/.test(subject))feeds.push([new URL('https://api.omegatech.app/api/movie/MovieBox-pro2?'+new URLSearchParams({action:'download',subjectId:subject,detailPath:slug,season,episode,se:season,ep:episode})),'MovieBox subtitles']);
  let empty=false;
  const failures=[];
  for(const [url,label] of feeds){
    try{
      const res=await fetch(url,{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)});
      if(!res.ok){failures.push(label+' returned HTTP '+res.status);continue}
      const data=await res.json();
      if(data.error||data.success===false||Number(data.statusCode)>=400){failures.push(label+' reported a provider error');continue}
      if(data.detailPath&&data.detailPath!==slug||data.season!=null&&Number(data.season)!==season||data.episode!=null&&Number(data.episode)!==episode){failures.push(label+' returned a different title or episode');continue}
      const list=[data.captions,data.subtitles,data.data?.captions,data.data?.subtitles,data.data,data].find(v=>Array.isArray(v)&&v.length)||[];
      if(!list.length){empty=true;continue}
      const tracks=list.filter(t=>typeof t?.url==='string'&&t.url.startsWith('https://')).map((t,i)=>({
        id:String(t.id??i),url:t.url,lan:t.lan||t.lang||t.language||'und',lanName:t.lanName||t.langName||t.label||t.language
      }));
      if(!tracks.length){failures.push(label+' returned no readable track URLs');continue}
      if(captionCache.size>=64)captionCache.delete(captionCache.keys().next().value);
      captionCache.set(cacheKey,{list:tracks,until:Date.now()+60000});return tracks;
    }catch(error){failures.push(label+(['AbortError','TimeoutError'].includes(error.name)?' timed out':' could not return readable track data'))}
  }
  if(empty&&!failures.length)return [];
  return fileError('Subtitle lookup: '+failures.join('. ')+(empty?'. The remaining source supplied no tracks.':'.'),502);
}

async function mediaExtras(url,env){
  const q=url.searchParams,slug=q.get('detailPath')||'',season=Number(q.get('season')),episode=Number(q.get('episode'));
  if(!/^[\w-]{1,300}$/.test(slug)||![season,episode].every(n=>Number.isSafeInteger(n)&&n>=0))return fileError('Invalid title.',400);
  const listing=url.pathname.endsWith('/season');
  try{
    if(listing){
      const u=new URL('https://api.globalmovie.site/proxy-api/api/episode-matrix');
      u.search=new URLSearchParams({id:slug,season,episode:1});
      const r=await fetch(u,{signal:AbortSignal.timeout(15000)});
      if(!r.ok)return fileError('Season provider returned HTTP '+r.status+'.',502);
      const d=await r.json();
      const info=d.seasonInfo;
      if(Number(info?.season)!==season||!Number.isSafeInteger(Number(info.maxEp))||Number(info.maxEp)<1)return fileError('Season unavailable.',404);
      return Response.json({count:Number(info.maxEp)});
    }
    const tracks=await subtitleTracks(slug,season,episode,q.get('subjectId')||'',env.CINEBASE_API_KEY);
    if(tracks instanceof Response)return tracks;
    const language=q.get('language');
    if(!language&&!q.has('track'))return Response.json(tracks.map(t=>({id:String(t.id),language:t.lan==='in_id'?'id':t.lan,label:t.lanName||t.lan})));
    const track=language?tracks.find(t=>(t.lan==='in_id'?'id':t.lan)===language):tracks.find(t=>String(t.id)===q.get('track'));
    if(!track)return fileError('Subtitle unavailable.',404);
    const file=new URL(track.url);
    if(file.protocol!=='https:'||file.hostname!=='cacdn.hakunaymatata.com')return fileError('Subtitle host unavailable.',502);
    const sub=await fetch(file,{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!sub.ok)return fileError('Subtitle file host returned HTTP '+sub.status+'.',502);
    const raw=(await sub.text()).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
    if(!raw.includes('-->'))return fileError('The subtitle file contains no timed captions.',502);
    if(language){
      const ext=raw.startsWith('WEBVTT')?'vtt':'srt';
      const name=slug+(season?'-S'+season+'E'+episode:'')+'.'+language.replace(/[^a-z0-9_-]/gi,'')+'.'+ext;
      return new Response(raw,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'private, max-age=1800'}});
    }
    const vtt=raw.startsWith('WEBVTT')?raw:'WEBVTT\n\n'+raw.replace(/^(\d+:\d{2}:\d{2}),(\d{3}) --> (\d+:\d{2}:\d{2}),(\d{3})/gm,'$1.$2 --> $3.$4');
    return new Response(vtt,{headers:{'Content-Type':'text/vtt; charset=utf-8','Cache-Control':'private, max-age=1800'}});
  }catch{return fileError('The provider could not return this information.',502)}
}

async function cinebase(url,request,env){
  const q=url.searchParams, slug=q.get('detailPath')||'';
  const season=Number(q.get('season')||0),episode=Number(q.get('episode')||0);
  if(!/^[a-zA-Z0-9_-]{1,300}$/.test(slug)||![season,episode].every(v=>Number.isSafeInteger(v)&&v>=0)||Boolean(season)!==Boolean(episode))return fileError('Invalid title or episode.',400);
  const base='https://api.globalmovie.site/proxy-api/';
  try{
    const details=new URL(season?'api/tv':'api/movie',base);
    details.searchParams.set('id',slug);
    if(season){details.searchParams.set('season',season);details.searchParams.set('episode',episode)}
    const metadata=await fetch(details,{signal:AbortSignal.timeout(20000)});
    if(!metadata.ok)return fileError('CineBase could not load this title.',502);
    const data=await metadata.json();
    if(data.error||data.detailPath&&data.detailPath!==slug)return fileError('CineBase could not resolve this title.',404);
    const qualities=new Map(),sizesMB={};
    for(const item of [...(data.qualities||[]),data.best_free]){
      if(!item||item.vipLocked||!/^https:\/\//i.test(item.url||''))continue;
      const label=item.resolution?String(item.resolution).replace(/p$/,'')+'p':'Default';
      if(!qualities.has(label)){
        qualities.set(label,item.url);
        const size=Number(item.size_mb);
        if(Number.isFinite(size)&&size>0)sizesMB[label]=size;
      }
    }
    if(url.pathname==='/api/cinebase/options'){
      const seasons=(Array.isArray(data.available_seasons)?data.available_seasons:[])
        .map(row=>({season:Number(row.season),episodes:Number(row.maxEp)}))
        .filter(row=>Number.isSafeInteger(row.season)&&row.season>0&&Number.isSafeInteger(row.episodes)&&row.episodes>0)
        .sort((a,b)=>a.season-b.season);
      return Response.json({qualities:[...qualities.keys()],sizesMB,seasons});
    }
    const raw=qualities.get(q.get('quality'));
    if(!raw)return fileError('This quality is unavailable.',404);
    if(!env.CINEBASE_API_KEY)return fileError('The media provider key is missing.',503);
    const downloading=url.pathname.endsWith('/download');
    const target=new URL(downloading?'dl':'stream',base);
    target.searchParams.set('url',raw);target.searchParams.set('dp',slug);
    target.searchParams.set('apikey',env.CINEBASE_API_KEY);
    if(downloading)target.searchParams.set('name',slug+'.mp4');
    const headers=new Headers();
    if(request.headers.has('Range'))headers.set('Range',request.headers.get('Range'));
    const media=await fetch(target,{method:request.method,headers,signal:request.signal,redirect:'follow'});
    if(!media.ok||! /^(video\/|application\/(octet-stream|mp4|force-download|x-download))/i.test(media.headers.get('Content-Type')||'')){
      await media.body?.cancel();
      return fileError(media.status===402?'CineBase streaming credit is exhausted.':media.status===401||media.status===403?'CineBase denied access to this file.':'CineBase could not deliver this video.',media.ok?502:media.status);
    }
    const out=new Headers({'Cache-Control':'private, no-store','Content-Type':'video/mp4','Content-Disposition':downloading?'attachment; filename="'+slug+(season?'-S'+season+'E'+episode:'')+'.mp4"':'inline'});
    for(const k of ['Content-Length','Content-Range','Accept-Ranges'])if(media.headers.has(k))out.set(k,media.headers.get(k));
    return new Response(media.body,{status:media.status,headers:out});
  }catch{return fileError('CineBase is temporarily unavailable.',502)}
}

const sessionCookie='__Host-sc-session';
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async text=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
function cookieValue(request,key){return (request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1)||''}
function cookie(key,value,age){return key+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age}
let authSchema;
async function initAuth(db){
  if(!authSchema)authSchema=db.batch([
    'CREATE TABLE IF NOT EXISTS sc_login_accounts (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,method TEXT NOT NULL,login TEXT NOT NULL,salt TEXT,hash TEXT,UNIQUE(method,login))',
    "CREATE TABLE IF NOT EXISTS sc_memberships (account TEXT PRIMARY KEY,plan TEXT NOT NULL CHECK(plan IN ('Free','Pro')),changed_by TEXT NOT NULL,changed_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS sc_notices (account TEXT NOT NULL,kind TEXT NOT NULL,seen INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,kind))",
    "CREATE TRIGGER IF NOT EXISTS sc_welcome AFTER INSERT ON sc_login_accounts BEGIN INSERT OR IGNORE INTO sc_notices(account,kind) VALUES(NEW.id,'welcome'); END",
    'CREATE TABLE IF NOT EXISTS sc_login_sessions (token TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sc_legacy_claims (token TEXT PRIMARY KEY,owner TEXT NOT NULL,email TEXT NOT NULL,expires INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sc_owner_links (account TEXT PRIMARY KEY,owner TEXT UNIQUE NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sc_signin_links (digest TEXT PRIMARY KEY,account TEXT NOT NULL,expires INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sc_login_attempts (bucket TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL)'
  ].map(sql=>db.prepare(sql))).catch(e=>{authSchema=null;throw e});
  await authSchema;
}
function sessionToken(request){
  return request.headers.get('X-SCinema-Session')||cookieValue(request,sessionCookie);
}
async function sessionIdentity(request,env){
  const token=sessionToken(request);
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  await initAuth(env.DB);
  return env.DB.prepare('SELECT COALESCE(l.owner,a.id) AS id,a.id AS accountId,a.email,a.name FROM sc_login_sessions s JOIN sc_login_accounts a ON a.id=s.owner LEFT JOIN sc_owner_links l ON l.account=a.id WHERE s.token=? AND s.expires>?').bind(await digest(token),Date.now()).first();
}
async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:100000,salt:new TextEncoder().encode(salt)},key,256));
}
function authJson(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
async function issueSession(request,db,account){
  const token=randomToken(),now=Date.now(),age=30*86400;
  await db.batch([db.prepare('DELETE FROM sc_login_sessions WHERE expires<=? OR token=?').bind(now,await digest(sessionToken(request))),db.prepare('INSERT INTO sc_login_sessions VALUES(?,?,?)').bind(await digest(token),account.id,now+age*1000)]);
  const proof=cookieValue(request,'__Host-sc-claim');
  if(proof){
    const key=await digest(proof);
    await db.batch([db.prepare('INSERT OR IGNORE INTO sc_owner_links(account,owner) SELECT a.id,c.owner FROM sc_login_accounts a JOIN sc_legacy_claims c ON lower(a.email)=lower(c.email) WHERE a.id=? AND c.token=? AND c.expires>?').bind(account.id,key,now),db.prepare('DELETE FROM sc_legacy_claims WHERE token=? OR expires<=?').bind(key,now)]);
  }
  const tab=request.method==='POST'&&request.headers.get('X-SCinema-Client')==='tab';
  const res=authJson(tab?{ok:true,tabSession:token}:{ok:true});res.headers.append('Set-Cookie',cookie(sessionCookie,token,age));return res;
}
async function authRoute(request,env,path){
  const url=new URL(request.url),db=env.DB;
  try{
    if(path==='options'&&request.method==='GET')return authJson({google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)});
    await initAuth(db);
    if(path==='google'&&request.method==='GET'){
      if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return new Response('Google sign-in is awaiting setup. Return to SCinema to sign in with email.',{status:503});
      const state=randomToken(),target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      target.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,response_type:'code',scope:'openid email profile',redirect_uri:url.origin+'/api/auth/google/callback',state,prompt:'select_account'}).toString();
      return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'no-store','Set-Cookie':cookie('__Host-sc-oauth',state,600)}});
    }
    if(path==='google/callback'&&request.method==='GET'){
      const state=cookieValue(request,'__Host-sc-oauth'),back=(ok)=>new Response(null,{status:303,headers:{Location:url.origin+(ok?'/#profile':'/?signin=failed#profile'),'Cache-Control':'no-store','Set-Cookie':cookie('__Host-sc-oauth','',0)}});
      if(!state||state!==url.searchParams.get('state')||!url.searchParams.get('code'))return back(false);
      const exchange=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:url.origin+'/api/auth/google/callback'})});
      if(!exchange.ok)return back(false);
      const token=await exchange.json(),info=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});
      if(!info.ok)return back(false);
      const user=await info.json();
      if(!user.sub||!user.email||user.email_verified!==true)return back(false);
      await db.prepare("INSERT INTO sc_login_accounts(id,name,email,method,login) VALUES(?,?,?,'google',?) ON CONFLICT(method,login) DO UPDATE SET name=excluded.name,email=excluded.email").bind(crypto.randomUUID(),String(user.name||user.email).slice(0,80),user.email,user.sub).run();
      const account=await db.prepare("SELECT id FROM sc_login_accounts WHERE method='google' AND login=?").bind(user.sub).first();
      const session=await issueSession(request,db,account),res=back(true);res.headers.append('Set-Cookie',session.headers.get('Set-Cookie'));return res;
    }
    if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return authJson({},403);
    if(path==='logout'){
      await db.prepare('DELETE FROM sc_login_sessions WHERE token=?').bind(await digest(sessionToken(request))).run();
      const res=authJson({ok:true});res.headers.append('Set-Cookie',cookie(sessionCookie,'',0));return res;
    }
    if(path==='find'){
      const text=await request.text();if(text.length>1024)return authJson({},413);
      const {email}=JSON.parse(text),identity=await sessionIdentity(request,env);
      if(typeof email!=='string'||email.length>254)return authJson({},400);
      const address=email.trim().toLowerCase();
      if(identity&&identity.email.toLowerCase()===address)return authJson({canContinue:true});
      if(!env.RESEND_API_KEY||!env.SIGNIN_EMAIL_FROM)return authJson({canContinue:false});
      const now=Date.now();
      const bucket='mail-'+await digest((request.headers.get('CF-Connecting-IP')||'shared')+'|'+Math.floor(now/600000));
      const throttle=await db.prepare('INSERT INTO sc_login_attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind(bucket,now+600000).first();
      if(throttle.n>10)return authJson({error:'Please wait before requesting another sign-in link.'},429);
      const user=await db.prepare("SELECT id FROM sc_login_accounts WHERE lower(email)=? ORDER BY (method='google') DESC LIMIT 1").bind(address).first();
      if(user){
        const token=randomToken(),key=await digest(token);
        await db.batch([db.prepare('DELETE FROM sc_signin_links WHERE expires<=? OR account=?').bind(now,user.id),db.prepare('INSERT INTO sc_signin_links VALUES(?,?,?)').bind(key,user.id,now+600000)]);
        const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.SIGNIN_EMAIL_FROM,to:[address],subject:'Your SCinema sign-in link',text:'Open this link within 10 minutes to sign in to SCinema. If you did not request it, you can ignore this email.\n\n'+url.origin+'/#email-signin/'+token})});
        if(!result.ok)await db.prepare('DELETE FROM sc_signin_links WHERE digest=?').bind(key).run();
      }
      return authJson({canContinue:false,emailLink:true});
    }
    if(path==='redeem'){
      const raw=await request.text();if(raw.length>200)return authJson({},400);
      const {token}=JSON.parse(raw);
      if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))return authJson({},400);
      const link=await db.prepare('DELETE FROM sc_signin_links WHERE digest=? AND expires>? RETURNING account').bind(await digest(token),Date.now()).first();
      if(!link)return authJson({error:'This link has expired or was already used. Request another link.'},401);
      return issueSession(request,db,{id:link.account});
    }
    if(!['register','login'].includes(path))return authJson({},404);
    const now=Date.now(),bucket=await digest((request.headers.get('CF-Connecting-IP')||'shared')+'|'+Math.floor(now/600000));
    const attempts=await db.prepare('INSERT INTO sc_login_attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET n=n+1 RETURNING n').bind(bucket,now+600000).first();
    if(attempts.n===1)await db.prepare('DELETE FROM sc_login_attempts WHERE expires<?').bind(now).run();
    if(attempts.n>40)return authJson({error:'Too many attempts. Try again in ten minutes.'},429);
    const raw=await request.text();if(raw.length>2000)return authJson({},413);
    let body;try{body=JSON.parse(raw)}catch{return authJson({},400)}
    const email=String(body.email||'').trim().toLowerCase(),name=String(body.name||'').trim(),password=body.password;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||!password.length||password.length>256)return authJson({error:'Enter a valid email and password.'},400);
    if(path==='register'){
      if(!name||name.length>80||password.length<12)return authJson({error:'Enter a name and a password of at least 12 characters.'},400);
      const salt=randomToken(),id=crypto.randomUUID(),hash=await passwordHash(password,salt);
      const result=await db.prepare("INSERT INTO sc_login_accounts VALUES(?,?,?,'password',?,?,?) ON CONFLICT(method,login) DO NOTHING").bind(id,name,email,email,salt,hash).run();
      if(!result.meta.changes)return authJson({error:'Could not create this account. Try signing in.'},409);
      return issueSession(request,db,{id});
    }
    const account=await db.prepare("SELECT * FROM sc_login_accounts WHERE method='password' AND login=?").bind(email).first();
    const hash=await passwordHash(password,account?.salt||'missing-account');
    if(!account||hash!==account.hash)return authJson({error:'Email or password is incorrect.'},401);
    return issueSession(request,db,account);
  }catch{return authJson({error:'Sign-in is temporarily unavailable. Please try again.'},503)}
}

function isManager(identity,env){
  return !!identity?.accountId&&identity.accountId===env.SETAL_MANAGER_ACCOUNT_ID;
}
async function accountSupport(request,env,url){
  const user=await sessionIdentity(request,env);
  if(!user)return authJson({error:'Sign in to continue.'},401);
  const db=env.DB;
  const post=request.method==='POST';
  if(post&&(request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json')))return authJson({},403);
  if(url.pathname==='/api/notifications'&&post){
    await db.prepare('UPDATE sc_notices SET seen=1 WHERE account=?').bind(user.accountId).run();
    return authJson({ok:true});
  }
  if(url.pathname!=='/api/manage'||!isManager(user,env))return authJson({},403);
  if(request.method==='GET'){
    const email=(url.searchParams.get('email')||'').trim();
    const rows=await db.prepare("SELECT a.id,a.email,a.name,a.method,COALESCE(m.plan,'Free') AS plan FROM sc_login_accounts a LEFT JOIN sc_memberships m ON m.account=a.id WHERE lower(a.email)=lower(?) LIMIT 10").bind(email).all();
    return authJson({accounts:rows.results});
  }
  if(!post)return authJson({},405);
  const input=await request.json().catch(()=>null);
  if(!input||typeof input.account!=='string'||!['Free','Pro'].includes(input.plan))return authJson({error:'Choose an account and plan.'},400);
  const result=await db.prepare('INSERT INTO sc_memberships(account,plan,changed_by,changed_at) SELECT id,?,?,? FROM sc_login_accounts WHERE id=? ON CONFLICT(account) DO UPDATE SET plan=excluded.plan,changed_by=excluded.changed_by,changed_at=excluded.changed_at').bind(input.plan,user.accountId,Date.now(),input.account).run();
  return authJson({ok:!!result.meta.changes},result.meta.changes?200:404);
}
async function viewerLibrary(request,env){
  const identity=await sessionIdentity(request,env);
  const account=identity?.id;
  const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
  if(!account){
    const res=reply({signedIn:false},401);
    const old=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
    if(request.method==='GET'&&old&&email&&!cookieValue(request,'__Host-sc-claim')){
      await initAuth(env.DB);const proof=randomToken();
      await env.DB.prepare('INSERT INTO sc_legacy_claims VALUES(?,?,?,?)').bind(await digest(proof),old,email,Date.now()+600000).run();
      res.headers.append('Set-Cookie',cookie('__Host-sc-claim',proof,600));
    }
    return res;
  }
  try{
    const profileId=new URL(request.url).searchParams.get('profile')||'main';
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS cinema_profiles(account TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL, PRIMARY KEY(account,id))').run();
    await env.DB.prepare("INSERT OR IGNORE INTO cinema_profiles VALUES(?,'main','My profile','fox')").bind(account).run();
    const active=await env.DB.prepare('SELECT id,name,avatar FROM cinema_profiles WHERE account=? AND id=?').bind(account,profileId).first();
    if(!active)return reply({error:'Profile no longer available.'},404);
    const owner=profileId==='main'?account:JSON.stringify(['cinema-profile',account,profileId]);
    if(request.method==='GET'){
      const {results}=await env.DB.prepare('SELECT kind,item,season,episode FROM viewer_library WHERE owner=? ORDER BY updated_at DESC').bind(owner).all();
      const profile=await env.DB.prepare('SELECT photo FROM viewer_profile WHERE owner=?').bind(owner).first();
      const profiles=await env.DB.prepare("SELECT id,name,avatar FROM cinema_profiles WHERE account=? ORDER BY (id='main') DESC,rowid").bind(account).all();
      const membership=await env.DB.prepare('SELECT plan FROM sc_memberships WHERE account=?').bind(identity.accountId).first();
      const notices=await env.DB.prepare('SELECT kind,seen FROM sc_notices WHERE account=?').bind(identity.accountId).all();
      return reply({signedIn:true,accountId:identity.accountId,canManage:isManager(identity,env),plan:membership?.plan||'Free',notices:notices.results,active,profiles:profiles.results,photo:profile?.photo||null,email:identity.email,name:identity.name,entries:results.map(row=>({...row,item:JSON.parse(row.item)}))});
    }
    if(request.method!=='POST')return reply({},405);
    if(request.headers.get('Origin')!==new URL(request.url).origin)return reply({},403);
    const raw=await request.text();
    if(raw.length>90000)return reply({},413);
    const {kind,item,remove,photo,season=0,episode=0}=JSON.parse(raw);
    if(['createProfile','editProfile','deleteProfile'].includes(kind)){
      const {name,avatar}=JSON.parse(raw);
      if(kind==='deleteProfile'){
        if(profileId==='main')return reply({error:'Keep the main profile for this account.'},400);
        await env.DB.batch([
          env.DB.prepare('DELETE FROM cinema_profiles WHERE account=? AND id=?').bind(account,profileId),
          env.DB.prepare('DELETE FROM viewer_library WHERE owner=?').bind(owner),
          env.DB.prepare('DELETE FROM viewer_profile WHERE owner=?').bind(owner)
        ]);
        return reply({id:'main'});
      }
      if(typeof name!=='string'||!name.trim()||name.trim().length>40||!['fox','panda','frog','lion','koala','penguin','owl','tiger'].includes(avatar))return reply({error:'Choose a name and avatar.'},400);
      if(kind==='createProfile'){
        const id=crypto.randomUUID();
        await env.DB.prepare('INSERT INTO cinema_profiles(account,id,name,avatar) VALUES(?,?,?,?)').bind(account,id,name.trim(),avatar).run();
        return reply({id});
      }
      const updates=[env.DB.prepare('UPDATE cinema_profiles SET name=?,avatar=? WHERE account=? AND id=?').bind(name.trim(),avatar,account,profileId)];
      if(JSON.parse(raw).useAvatar)updates.push(env.DB.prepare('DELETE FROM viewer_profile WHERE owner=?').bind(owner));
      await env.DB.batch(updates);
      return reply({id:profileId});
    }
    if(kind==='photo'){
      if(typeof photo!=='string'||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(photo))return reply({},400);
      await env.DB.prepare('INSERT INTO viewer_profile(owner,photo) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET photo=excluded.photo').bind(owner,photo).run();
      return reply({ok:true});
    }
    if(raw.length>24000)return reply({},413);
    const key=item?.catalogKey||item?.subjectId;
    if(kind==='resumeVisibility'){
      if(typeof key!=='string'||!key||key.length>256||typeof remove!=='boolean')return reply({},400);
      await env.DB.prepare("UPDATE viewer_library SET item=json_set(item,'$.resumeHidden',?) WHERE owner=? AND kind='watched' AND title_id=?").bind(remove?1:0,owner,key).run();
      return reply({ok:true});
    }
    if(!['saved','watched','downloaded'].includes(kind)||typeof key!=='string'||key.length>256||!key||typeof item.title!=='string'||![season,episode].every(n=>Number.isSafeInteger(n)&&n>=0)||(kind==='saved'&&(season||episode)))return reply({},400);
    if(kind==='watched')item.market=request.cf?.country||request.headers.get('cf-ipcountry')||'';
    if(remove)await env.DB.prepare('DELETE FROM viewer_library WHERE owner=? AND kind=? AND title_id=? AND season=? AND episode=?').bind(owner,kind,key,season,episode).run();
    else await env.DB.prepare('INSERT INTO viewer_library(owner,kind,title_id,season,episode,item,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,kind,title_id,season,episode) DO UPDATE SET item=excluded.item,updated_at=excluded.updated_at').bind(owner,kind,key,season,episode,JSON.stringify(item),Date.now()).run();
    return reply({ok:true});
  }catch{return reply({error:'Library temporarily unavailable.'},503)}
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(['/api/manage','/api/notifications'].includes(url.pathname))return accountSupport(request,env,url);
    if(url.pathname.startsWith('/api/auth/'))return authRoute(request,env,url.pathname.slice(10));
    if(url.pathname==='/api/discover' && request.method==='GET'){
      const market=request.cf?.country||request.headers.get('cf-ipcountry')||'';
      const offset=Math.max(-840,Math.min(840,Number(url.searchParams.get('offset'))||0))*60000;
      const start=Math.floor((Date.now()-offset)/86400000)*86400000+offset;
      let shows=[],historical=[];
      if(/^[A-Z]{2}$/.test(market)){
        const rows=await env.DB.prepare(`SELECT title_id,MAX(item) AS item,COUNT(DISTINCT owner) AS viewers FROM viewer_library
          WHERE kind='watched' AND updated_at>=? AND updated_at<? AND json_extract(item,'$.market')=? AND json_extract(item,'$.subjectType')=2
          GROUP BY title_id ORDER BY viewers DESC,MAX(updated_at) DESC LIMIT 10`).bind(start,start+86400000,market).all();
        shows=rows.results.map(row=>{const {market,progress,finished,...title}=JSON.parse(row.item);return title});
        if(shows.length<10){
          const archive=await env.DB.prepare(`SELECT title_id,MAX(item) AS item,COUNT(DISTINCT owner) AS viewers FROM viewer_library
            WHERE kind='watched' AND json_extract(item,'$.market')=? AND json_extract(item,'$.subjectType')=2
            GROUP BY title_id ORDER BY viewers DESC,MAX(updated_at) DESC LIMIT 10`).bind(market).all();
          historical=archive.results.map(row=>{const {market,progress,finished,resumeHidden,...title}=JSON.parse(row.item);return title});
        }
      }
      return Response.json({market,shows,historical},{headers:{'Cache-Control':'private, no-store'}});
    }
    if(url.pathname==='/api/library')return viewerLibrary(request,env);
    if(request.method!=='GET' && request.method!=='HEAD')return new Response(null,{status:405});
    if(['/api/cinebase/subtitles','/api/cinebase/season'].includes(url.pathname))return mediaExtras(url,env);
    if(['/api/cinebase/options','/api/cinebase/stream','/api/cinebase/download'].includes(url.pathname))return cinebase(url,request,env);
    if(url.pathname==='/api/fixtures')return fixturesApi(url);
    if(url.pathname==='/api/sports/feed'){
      const action=url.searchParams.get('action');
      if(!['leagues','matches','live','stream','news','aggregate','info'].includes(action))return fileError('Unknown sports action.',400);
      const api=new URL('https://api.omegatech.app/api/Sport/Sport');
      api.searchParams.set('action',action);
      for(const key of ['matchId','leagueId','status','date','page','perPage']){
        const value=url.searchParams.get(key);
        if(value&&value.length<=40)api.searchParams.set(key,value);
      }
      if(action==='stream'&&!/^\d{1,24}$/.test(api.searchParams.get('matchId')||''))return fileError('Invalid fixture.',400);
      try{
        const result=await fetch(api,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'},cache:'no-store'});
        if(!result.ok)return fileError('Sports feed unavailable.',502);
        const data=JSON.parse((await result.text()).replace(/("(?:id|matchId|leagueId)"\s*:\s*)(\d{16,})(?=\s*[,}])/g,'$1"$2"'));
        if(data.success===false||!data.data)return fileError('Sports feed unavailable.',502);
        return Response.json(data.data,{headers:{'Cache-Control':action==='stream'?'no-store':'public, max-age=20'}});
      }catch{return fileError('Sports feed unavailable.',502)}
    }
    if(url.pathname==='/api/sports' || url.pathname==='/api/sports/match'){
      const detail=url.pathname.endsWith('/match');
      const id=url.searchParams.get('id');
      if(detail && (!id || id.length>128))return fileError('Enter a match ID.',400);
      const upstream=new URL(detail?'match-detail':'sport-feeds','https://api.omegatech.app/api/Sport/');
      upstream.searchParams.set(detail?'id':'leagueId',detail?id:'0');
      try{
        const response=await fetch(upstream,{signal:AbortSignal.timeout(15000)});
        if(!response.ok)return fileError('Sports provider returned HTTP '+response.status+'.',502);
        const raw=await response.text();
        // Protect large numeric IDs before the browser parses them.
        const json=raw.replace(/("(?:id|matchId|match_id)"\s*:\s*)(\d{16,})(?=\s*[,}])/gi,'$1"$2"');
        JSON.parse(json);
        return new Response(json,{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }catch{return fileError('Sports provider is unavailable.',502)}
    }
    if(url.pathname==='/api/file'||url.pathname==='/api/watch')return downloadFile(url.searchParams,request,url.pathname==='/api/watch');
    if(/^\/api\/movie\/MovieBox-pro2?$/.test(url.pathname)){
      if(!actions.has(url.searchParams.get('action')))return new Response(null,{status:400});
      const upstream=new URL(url.pathname,'https://api.omegatech.app');
      for(const [key,value] of url.searchParams)if(params.has(key))upstream.searchParams.set(key,value);
      try{
        const result=await fetch(upstream,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
        if(result.ok && url.pathname.endsWith('MovieBox-pro2') && url.searchParams.get('action')==='download'){
          const data=await result.json();
          rememberSources(url.searchParams,data);
          return Response.json(data,{headers:{'Cache-Control':'no-store'}});
        }
        return new Response(result.body,{status:result.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }catch{
        return Response.json({success:false,error:'Provider unavailable'},{status:502});
      }
    }
    if(env?.ASSETS){
      const asset=await env.ASSETS.fetch(request);
      if(asset.status!==404)return asset;
    }
    const page=pages[url.pathname==='/'?'/index.html':url.pathname];
    if(page)return new Response(page.body,{headers:{'Content-Type':page.type}});
    const image=images[url.pathname];
    if(image)return Response.redirect(image,302);
    return new Response(null,{status:404});
  }
};
