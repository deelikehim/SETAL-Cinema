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
async function mediaExtras(url,env){
  const q=url.searchParams,slug=q.get('detailPath')||'',season=Number(q.get('season')),episode=Number(q.get('episode'));
  if(!/^[\w-]{1,300}$/.test(slug)||![season,episode].every(n=>Number.isSafeInteger(n)&&n>=0))return fileError('Invalid title.',400);
  const listing=url.pathname.endsWith('/season');
  const u=new URL(listing?'episode-matrix':'subtitles','https://api.globalmovie.site/proxy-api/api/');
  u.searchParams.set('id',slug);
  if(!listing){
    if(!env.CINEBASE_API_KEY)return fileError('The subtitle provider key is missing.',503);
    u.searchParams.set('apikey',env.CINEBASE_API_KEY);
  }
  if(season){u.searchParams.set('season',season);u.searchParams.set('episode',listing?1:episode)}
  try{
    const r=await fetch(u,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw Error();
    const d=await r.json();
    if(listing){
      const info=d.seasonInfo;
      if(Number(info?.season)!==season||!Number.isSafeInteger(Number(info.maxEp))||Number(info.maxEp)<1)return fileError('Season unavailable.',404);
      return Response.json({count:Number(info.maxEp)});
    }
    const list=[d.captions,d.subtitles,d.data?.captions,d.data?.subtitles].find(items=>Array.isArray(items)&&items.length)||[];
    const tracks=list.filter(t=>t?.url).map((t,i)=>({
      id:String(t.id??i),url:t.url,lan:t.lan||t.lang||t.language||'und',
      lanName:t.lanName||t.langName||t.label||t.language
    }));
    const language=q.get('language');
    if(!language&&!q.has('track'))return Response.json(tracks.map(t=>({id:String(t.id),language:t.lan==='in_id'?'id':t.lan,label:t.lanName||t.lan})));
    const track=language?tracks.find(t=>(t.lan==='in_id'?'id':t.lan)===language):tracks.find(t=>String(t.id)===q.get('track'));
    if(!track)return fileError('Subtitle unavailable.',404);
    const file=new URL(track.url);
    if(file.protocol!=='https:'||file.hostname!=='cacdn.hakunaymatata.com')return fileError('Subtitle host unavailable.',502);
    const sub=await fetch(file,{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!sub.ok)throw Error();
    const raw=(await sub.text()).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
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

async function viewerLibrary(request,env){
  const owner=request.headers.get('oai-authenticated-user-id');
  const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
  if(!owner)return reply({signedIn:false},401);
  try{
    if(request.method==='GET'){
      const {results}=await env.DB.prepare('SELECT kind,item,season,episode FROM viewer_library WHERE owner=? ORDER BY updated_at DESC').bind(owner).all();
      const profile=await env.DB.prepare('SELECT photo FROM viewer_profile WHERE owner=?').bind(owner).first();
      return reply({signedIn:true,photo:profile?.photo||null,email:request.headers.get('oai-authenticated-user-email'),entries:results.map(row=>({...row,item:JSON.parse(row.item)}))});
    }
    if(request.method!=='POST')return reply({},405);
    if(request.headers.get('Origin')!==new URL(request.url).origin)return reply({},403);
    const raw=await request.text();
    if(raw.length>90000)return reply({},413);
    const {kind,item,remove,photo,season=0,episode=0}=JSON.parse(raw);
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
    if(url.pathname==='/api/discover' && request.method==='GET'){
      const market=request.cf?.country||request.headers.get('cf-ipcountry')||'';
      const offset=Math.max(-840,Math.min(840,Number(url.searchParams.get('offset'))||0))*60000;
      const start=Math.floor((Date.now()-offset)/86400000)*86400000+offset;
      let shows=[];
      if(/^[A-Z]{2}$/.test(market)){
        const rows=await env.DB.prepare(`SELECT title_id,MAX(item) AS item,COUNT(DISTINCT owner) AS viewers FROM viewer_library
          WHERE kind='watched' AND updated_at>=? AND updated_at<? AND json_extract(item,'$.market')=? AND json_extract(item,'$.subjectType')=2
          GROUP BY title_id ORDER BY viewers DESC,MAX(updated_at) DESC LIMIT 10`).bind(start,start+86400000,market).all();
        shows=rows.results.map(row=>{const {market,progress,finished,...title}=JSON.parse(row.item);return title});
      }
      return Response.json({market,shows},{headers:{'Cache-Control':'private, no-store'}});
    }
    if(url.pathname==='/api/library')return viewerLibrary(request,env);
    if(request.method!=='GET' && request.method!=='HEAD')return new Response(null,{status:405});
    if(['/api/cinebase/subtitles','/api/cinebase/season'].includes(url.pathname))return mediaExtras(url,env);
    if(['/api/cinebase/options','/api/cinebase/stream','/api/cinebase/download'].includes(url.pathname))return cinebase(url,request,env);
    if(url.pathname==='/api/fixtures')return fixturesApi(url);
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
