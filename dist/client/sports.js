const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const zone='Africa/Lagos';
const dateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:zone});
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
const dayOf=v=>dateFormat.format(new Date(v));
const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const longDate=d=>new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:zone}).format(new Date(d+'T12:00:00Z'));
const link=(q,overrides)=>{const p=new URLSearchParams(q);for(const [k,v] of Object.entries(overrides)){if(v)p.set(k,v);else p.delete(k)}return '#sports/'+p.toString()};
const selectedFixtures=new Map();
let configs,active;const cache=new Map();
async function json(url,signal){const r=await fetch(url,{signal});if(!r.ok)throw Error();return r.json()}
function team(t,scores){
  const logo=String(t.logo||'').startsWith('https://')?'<img alt="" loading="lazy" src="'+escape(t.logo)+'">':'';
  return '<span class="fixture-team">'+logo+'<span>'+escape(t.name)+'</span>'+(scores?'<b>'+escape(t.score??'–')+'</b>':'')+'</span>';
}
function status(e){return e.state==='pre'?clock.format(new Date(e.date)):e.status||e.state}
function playerGroups(squad){
  const list=squad.players||[];const known=list.some(p=>p.starter===true);
  return '<section><h3>'+escape(squad.name)+'</h3>'+(squad.formation?'<p class="hint">Formation '+escape(squad.formation)+'</p>':'')+(known?['Starters','Bench']:['Players']).map(label=>{
    const rows=list.filter(p=>!known||(label==='Starters')===!!p.starter);
    return rows.length?'<h4>'+label+'</h4>'+rows.map(p=>'<div class="player-row"><small>'+escape(p.number||'')+'</small><span>'+escape(p.name)+'</span><small>'+escape(p.position||'')+'</small></div>').join(''):'';
  }).join('')+'</section>';
}
function clubBadge(t){
  const logo=String(t.logo||'');
  const badge=logo.startsWith('https://')?'<img src="'+escape(logo)+'" alt="">':'<b>'+escape((t.name||'').slice(0,2))+'</b>';
  return '<div class="report-team"><div class="crest">'+badge+'</div><strong>'+escape(t.name)+'</strong></div>';
}
function comparison(stats){
  const [home,away]=stats;
  const metrics=new Map();
  for(const side of stats)for(const item of side.values)metrics.set(item.key,item.label);
  return [...metrics].map(([key,label])=>{
    const value=t=>t?.values.find(s=>s.key===key)?.value;
    const a=value(home),b=value(away);
    const number=v=>/^\d+(\.\d+)?%?$/.test(String(v))?parseFloat(v):NaN;
    const total=number(a)+number(b);
    const bar=total>0?'<div class="compare-track" aria-hidden="true"><i style="width:'+100*number(a)/total+'%"></i></div>':'';
    return '<div class="metric"><div><strong>'+escape(a??'–')+'</strong><span>'+escape(label)+'</span><strong>'+escape(b??'–')+'</strong></div>'+bar+'</div>';
  }).join('');
}
function clubKey(team){
  const name=typeof team==='string'?team:team?.nameI18n?.en||team?.name;
  return String(name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/\bman\s+(city|united|utd)\b/g,'manchester $1').replace(/\butd\b/g,'united')
    .replace(/\b(fc|afc|cf)\b/g,'').replace(/[^a-z0-9]/g,'');
}
function fixtureCandidates(feed,event){
  const expected=event.teams.map(clubKey).sort().join('|'), found=new Map();
  function visit(row){
    if(!row||typeof row!=='object')return;
    const id=row.matchId||row.match_id||row.id;
    const sides=[row.team1||row.homeTeam||row.home,row.team2||row.awayTeam||row.away];
    if(id&&sides.every(Boolean)&&sides.map(clubKey).sort().join('|')===expected){
      const raw=row.startTime||row.extras?.startTime||row.kickoff;
      const time=/^\d+$/.test(raw)?Number(raw)*(String(raw).length<=10?1000:1):Date.parse(raw);
      if(!Number.isFinite(time)||Math.abs(time-Date.parse(event.date))<=3*3600000)found.set(String(id),row);
    }
    Object.values(row).forEach(visit);
  }
  visit(feed);return [...found.keys()];
}
function videoUrl(value){
  try{const url=new URL(value);if(['https:','http:'].includes(url.protocol))return url}catch{}
}
const providerFeed=(action,params,signal)=>json('/api/sports/feed?'+new URLSearchParams({action,...params}),signal);
function providerResult(m){
  if(m?.status==='MatchEnded'||m?.isEnded)return 'Full time';
  if(m?.status==='MatchIng'||m?.isLive)return 'LIVE';
  return null;
}
function followScoreboard(signal,read,apply){
  let timer;
  async function refresh(){
    try{const m=await read();if(!signal.aborted&&m)apply(m)}catch{}
    if(!signal.aborted)timer=setTimeout(refresh,30000);
  }
  signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
  void refresh();
}
async function matchVideo(panel,event,signal,providerId){
  const ended=event.state==='post';
  const heading=document.createElement('h2');heading.textContent=ended?'Match replay':'Watch match';
  const body=document.createElement('div');panel.append(heading,body);
  function message(text,retry){
    body.replaceChildren(document.createTextNode(text+' '));
    if(retry){const button=document.createElement('button');button.className='chip';button.textContent='Check again';button.onclick=lookup;body.append(button)}
  }
  let refreshed=false;
  async function lookup(click){
    if(click)refreshed=false;
    message('Checking match coverage…',false);
    try{
      let id=providerId;
      if(!id){
        const listing=await providerFeed(event.state==='in'?'live':'matches',{date:dayOf(event.date)},signal);
        let ids=fixtureCandidates(listing,event);
        if(!ids.length)ids=fixtureCandidates(await json('/api/sports',signal),event);
        if(ids.length!==1){message(ended?'No replay is listed for this match.':'No live feed is listed for this match yet.',true);return}
        id=ids[0];
      }
      const detail=await providerFeed('stream',{matchId:id},signal);
      if(signal.aborted)return;
      if(String(detail.match?.id)!==String(id))throw Error();
      const sources=ended?[...(detail.replays||[]),...(detail.highlights||[])]:[detail.primaryHls,...(detail.streams||[]).filter(x=>x.type==='hls'&&x.playable!==false)];
      const links=sources.map(x=>({url:videoUrl(typeof x==='string'?x:x?.path||x?.url),title:x?.title})).filter(x=>x.url);
      const feeds=[];
      for(const source of links){
        let url=source.url;
        // This player wrapper carries its signed media URL in the url parameter.
        if(url.hostname==='play.88player.top'&&url.pathname==='/m3u8.html'){
          const nested=videoUrl(url.searchParams.get('url'));
          if(!nested)continue;
          for(const key of ['txTime','txSecret'])if(url.searchParams.has(key)&&!nested.searchParams.has(key))nested.searchParams.set(key,url.searchParams.get(key));
          url=nested;
        }
        if(url.protocol==='https:'&&/\.(m3u8|mp4|webm)$/i.test(url.pathname)&&!feeds.some(f=>f.url.href===url.href))feeds.push({url,title:source.title});
      }
      if(!feeds.length){message(ended?'No replay is available to watch here yet.':'The provider has no feed available for playback on Setal Stream yet.',true);return}
      body.replaceChildren();
      const stage=document.createElement('div'),channels=document.createElement('div');
      body.append(stage,channels);
      let engine,video,selection=0;
      function stop(){
        selection++;
        engine?.destroy();engine=null;
        if(video){video.onerror=null;video.pause();video.removeAttribute('src');video.load();video=null}
      }
      signal.addEventListener('abort',stop,{once:true});
      async function select(index){
        stop();
        const ticket=selection,feed=feeds[index];
        for(const [i,button] of [...channels.children].entries())button.setAttribute('aria-pressed',String(i===index));
        video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.style.cssText='display:block;width:100%;aspect-ratio:16/9;background:#000;border-radius:12px;margin-bottom:12px';
        stage.replaceChildren(video);
        function failed(){
          if(ticket!==selection||signal.aborted)return;
          if(index+1<feeds.length){void select(index+1);return}
          stop();signal.removeEventListener('abort',stop);
          if(!ended&&!refreshed){refreshed=true;void lookup();return}
          message('This video feed is unavailable on Setal right now.',true);
        }
        video.onerror=failed;
        if(!/\.m3u8$/i.test(feed.url.pathname)||video.canPlayType('application/vnd.apple.mpegurl'))video.src=feed.url.href;
        else try{
          const {default:Hls}=await import('https://cdn.jsdelivr.net/npm/hls.js@1.6.13/+esm');
          if(ticket!==selection||signal.aborted)return;
          if(!Hls.isSupported())throw Error();
          engine=new Hls();
          engine.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)failed()});
          engine.loadSource(feed.url.href);engine.attachMedia(video);
        }catch{failed()}
      }
      if(feeds.length>1)feeds.forEach((feed,index)=>{
        const button=document.createElement('button');button.type='button';button.className='chip';
        button.textContent=feed.title||(index===0?'Main feed':'Channel '+(index+1));button.onclick=()=>select(index);channels.append(button);
      });
      await select(0);
    }catch{if(!signal.aborted)message('The video provider is unavailable right now.',true)}
  }
  await lookup();
}
async function report(root,q,league,signal){
  const back=link(q,{id:null,tab:null,competition:null});
  root.innerHTML='<section class="page sports-page"><a href="'+back+'">‹ Fixtures</a><div class="panel" role="status">Loading match centre…</div></section>';
  const competition=q.get('competition')||q.get('league'),id=q.get('id');
  const params=new URLSearchParams({date:q.get('date'),league:competition});
  const key=competition+'/'+id;
  const usable=e=>e?.teams?.length>=2&&e.teams.slice(0,2).every(t=>t?.name)&&Number.isFinite(Date.parse(e.date));
  let event=selectedFixtures.get(key);
  if(!usable(event))try{event=JSON.parse(sessionStorage.getItem('fixture:'+key))}catch{}
  let player,watching=false,currentEvent,confirmed;
  function applyProvider(m){
    const label=providerResult(m);
    if(!label||!currentEvent||currentEvent.state==='post'&&label==='LIVE'||providerResult(confirmed)==='Full time'&&label==='LIVE')return;
    confirmed=m;
    const result=root.querySelector('.scoreboard .result');
    if(!result)return;
    result.querySelector('span').textContent=label;
    const scores=String(m.score||'').match(/^\s*(\d+)\s*[-–:]\s*(\d+)\s*$/);
    if(scores){
      const ordered=clubKey(m.home)===clubKey(currentEvent.teams[0])?[scores[1],scores[2]]:[scores[2],scores[1]];
      result.querySelector('strong').textContent=ordered.join(' – ');
    }else if(currentEvent.state==='pre')result.querySelector('strong').textContent='–';
  }
  function startClock(e){
    currentEvent=e;
    if(confirmed)applyProvider(confirmed);
    if(watching||league[3]!=='soccer'||e.state==='post')return;
    watching=true;
    let providerId;
    followScoreboard(signal,async()=>{
      if(providerId)return (await providerFeed('stream',{matchId:providerId},signal)).match;
      let feed=await providerFeed('live',{},signal);
      let ids=fixtureCandidates(feed,e);
      if(!ids.length){feed=await providerFeed('matches',{date:dayOf(e.date)},signal);ids=fixtureCandidates(feed,e)}
      if(ids.length!==1)return;
      providerId=ids[0];return feed.matches?.find(m=>String(m.id)===providerId);
    },applyProvider);
  }
  function basic(e){return {event:e,venue:e.venue,plays:[],squads:[],stats:[],partial:true}}
  const painted=usable(event);
  if(painted)paintReport(basic(event));
  try{
    const full=await json('/api/fixtures?'+params+'&id='+encodeURIComponent(id),signal);
    if(signal.aborted)return;
    if(!usable(full.event))throw Error();
    paintReport({...full,plays:full.plays||[],stats:full.stats||[],squads:full.squads||[]});
  }catch{
    if(signal.aborted)return;
    if(!usable(event)){
      const schedule=await json('/api/fixtures?'+params,signal).catch(()=>null);
      event=schedule?.events?.find(e=>String(e.id)===id);
      if(!usable(event)){
        const stored=await json('/sports/snapshot.json',signal).catch(()=>null);
        event=stored?.scores?.[competition]?.find(e=>String(e.id)===id);
      }
    }
    if(signal.aborted)return;
    if(painted)return;
    if(usable(event))paintReport(basic(event));
    else root.innerHTML='<section class="page sports-page"><h1>'+escape(league[1])+'</h1><p>The provider could not load this fixture.</p><button class="chip" data-refresh>Retry match</button> <a href="'+back+'">Browse fixtures</a></section>';
    root.querySelector('[data-refresh]').onclick=()=>fixturesPage(root,q.toString());
  }
  function paintReport(d){
  const e=d.event,[home,away]=e.teams;
  const tabs={overview:'Overview',events:'Timeline',lineups:'Lineups & rosters',stats:'Team stats'};
  const chosen=q.get('tab'),tab=Object.hasOwn(tabs,chosen)?chosen:'overview';
  const score=e.state==='pre'?clock.format(new Date(e.date)):escape(e.teams.map(t=>t.score??'–').join(' – '));
  const matchState=e.state==='pre'?'Scheduled':e.state==='post'?'Full time':e.state==='in'?('LIVE'+(e.status?' · '+e.status:'')):status(e);
  const facts=[['Competition',league[1]],['Date',longDate(dayOf(e.date))],['Start time',clock.format(new Date(e.date))+' WAT'],['Venue',d.venue],['Attendance',d.attendance],['Officials',d.officials?.join(', ')]];
  const info='<dl class="match-facts">'+facts.filter(([,v])=>v!=null&&v!=='').map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+escape(v)+'</dd></div>').join('')+'</dl>';
  const empty=label=>'<p class="empty">'+label+(e.state==='pre'?' have yet to be published.':' are unavailable for this fixture.')+'</p>';
  const timeline=plays=>'<ol class="timeline">'+plays.map(p=>'<li><b>'+escape(p.time||'•')+'</b><span>'+escape(p.text)+'</span></li>').join('')+'</ol>';
  let content=info;
  if(tab==='overview'&&d.plays.length)content+='<h3>Latest events</h3>'+timeline(d.plays.slice(-3).reverse());
  if(tab==='events')content=d.plays.length?timeline(d.plays):empty('Match events');
  if(tab==='lineups')content=d.squads.some(t=>t.players.length)?'<div class="squad-grid">'+d.squads.map(playerGroups).join('')+'</div>':empty('Lineups');
  if(tab==='stats')content=d.stats.some(t=>t.values.length)?'<div class="compare-heading"><b>'+escape(d.stats[0].name)+'</b><b>'+escape(d.stats[1]?.name)+'</b></div>'+comparison(d.stats):empty('Stats');
  const layout=document.createElement('div');
  layout.innerHTML='<article class="page sports-page report"><a class="fixtures-back" href="'+back+'">‹ All fixtures</a><header class="scoreboard"><h1>'+escape(league[1])+'</h1><div class="score-line">'+clubBadge(home)+'<div class="result"><strong>'+score+'</strong><span>'+escape(matchState)+'</span></div>'+clubBadge(away)+'</div><p>'+escape(longDate(dayOf(e.date)))+(d.venue?' · '+escape(d.venue):'')+'</p></header><nav aria-label="Match sections" class="report-tabs">'+Object.entries(tabs).map(([k,name])=>'<a '+(tab===k?'aria-current="page"':'')+' href="'+link(q,{tab:k})+'">'+name+'</a>').join('')+'</nav><section class="report-body"><h2>'+tabs[tab]+'</h2>'+content+'</section>'+(d.saved?'<p class="hint">Archived match report</p>':'')+'</article>';
  if(player){
    root.querySelector('.scoreboard').replaceWith(layout.querySelector('.scoreboard'));
    player.nextElementSibling.replaceWith(layout.querySelector('.report-body'));
    startClock(e);
    return;
  }
  root.replaceChildren(layout.firstElementChild);
  startClock(e);
  if(d.partial){
    const note=document.createElement('p');note.className='hint';note.textContent='Showing the fixture listing. ';
    const retry=document.createElement('button');retry.className='chip';retry.dataset.refresh='';retry.textContent='Refresh match details';retry.onclick=()=>fixturesPage(root,q.toString());
    note.append(retry);root.querySelector('.report-body').prepend(note);
  }
  if(tab==='overview'&&league[3]==='soccer'){
    if(!player){player=document.createElement('section');player.className='report-body';void matchVideo(player,e,signal)}
    root.querySelector('.report-body').before(player);
  }
}
}
function sportsHub(panel,q,signal){
  const sections={live:'Live now',matches:'Matches',leagues:'Leagues',news:'Sports news',aggregate:'Highlights & replays'};
  const section=Object.hasOwn(sections,q.get('feed'))?q.get('feed'):'live';
  const page=Math.max(1,parseInt(q.get('p'),10)||1);
  panel.innerHTML='<nav class="report-tabs" aria-label="Sports coverage">'+Object.entries(sections).map(([key,label])=>'<a '+(key===section?'aria-current="page"':'')+' href="'+link(q,{feed:key,p:null,providerLeague:null})+'">'+label+'</a>').join('')+'</nav><section class="panel"><h2>'+sections[section]+'</h2><div data-results></div></section>';
  const results=panel.querySelector('[data-results]');
  async function refresh(){
    try{
      const params={page,perPage:20};
      if(section==='matches'){params.date=q.get('date');if(q.get('providerLeague'))params.leagueId=q.get('providerLeague')}
      const d=await providerFeed(section,params,signal);
      if(signal.aborted)return;
      let html='';
      if(section==='live'||section==='matches'){
        for(const m of d.matches||d.live||[]){
          if(!m.id)continue;
          html+='<a class="fixture-card" href="'+link(q,{provider:String(m.id)})+'"><span>'+escape(m.league)+'</span><strong>'+escape(m.home?.name||m.home)+' · '+escape(m.away?.name||m.away)+'</strong><span>'+escape(m.score||m.status)+'</span></a>';
        }
      }else if(section==='leagues'){
        for(const l of d.leagues||[])html+='<a class="chip" href="'+link(q,{feed:'matches',providerLeague:String(l.id||l.leagueId),p:null})+'">'+escape(l.name||l.league||l.title)+'</a> ';
      }else if(section==='news'){
        for(const n of d.news||d.items||[])html+='<article><h3>'+escape(n.title)+'</h3><p>'+escape(n.summary||n.description)+'</p></article>';
      }else{
        const clips=[...(d.highlights||[]),...(d.replays||[]),...(d.matches||[]).flatMap(m=>[...(m.highlights||[]),...(m.replays||[])])];
        const seen=new Set();
        for(const clip of clips){const u=videoUrl(clip.url||clip.path);if(u?.protocol!=='https:'||seen.has(u.href))continue;seen.add(u.href);
          html+='<article><h3>'+escape(clip.title||'Match video')+'</h3><video controls playsinline preload="none" style="width:100%;max-height:60vh" src="'+escape(u.href)+'"></video></article>'}
      }
      results.innerHTML=(html||'<p>No entries listed right now.</p>')+(page>1?'<a class="chip" href="'+link(q,{p:String(page-1)})+'">Previous</a> ':'')+(d.hasMore?'<a class="chip" href="'+link(q,{p:String(page+1)})+'">Next</a>':'');
    }catch{if(!signal.aborted&&!results.childElementCount)results.textContent='Sports coverage is temporarily unavailable.'}
    if(!signal.aborted&&section!=='aggregate'){const t=setTimeout(refresh,60000);signal.addEventListener('abort',()=>clearTimeout(t),{once:true})}
  }
  results.textContent='Loading…';void refresh();
}
export async function fixturesPage(root,arg){
  active?.abort();active=new AbortController();const signal=active.signal;
  const today=dayOf(Date.now()),q=new URLSearchParams(arg==='6213559394166621280'?'date=2026-04-21&competition=eng.1&id=740928':arg||'');
  const day=/^\d{4}-\d{2}-\d{2}$/.test(q.get('date'))?q.get('date'):today;q.set('date',day);
  root.innerHTML='<section class="page sports-page"><h1>Match centre</h1><p>Loading fixtures…</p></section>';
  try{
    configs??=await json('/sports/leagues.json',signal);const league=q.get('league'),sport=q.get('sport');
    if(q.has('provider')){
      const id=q.get('provider');
      const detail=await providerFeed('stream',{matchId:id},signal);
      if(signal.aborted)return;
      const m=detail.match;
      if(String(m?.id)!==id)throw Error();
      root.innerHTML='<article class="page sports-page"><a href="'+link(q,{provider:null})+'">Back to sports</a><header class="scoreboard"><p>'+escape(m.league)+'</p><h1>'+escape(m.home)+' · '+escape(m.away)+'</h1><div class="result"><strong>'+escape(m.score)+'</strong><span>'+escape(providerResult(m)||m.status)+'</span></div></header><section class="report-body"></section></article>';
      followScoreboard(signal,async()=>(await providerFeed('stream',{matchId:id},signal)).match,latest=>{
        if(String(latest.id)!==id)return;
        root.querySelector('.result span').textContent=providerResult(latest)||latest.status;
        root.querySelector('.result strong').textContent=latest.score??'–';
      });
      await matchVideo(root.querySelector('.report-body'),{state:m.isLive?'in':m.status==='MatchEnded'?'post':'pre'},signal,id);return;
    }
    if(q.has('id') && configs[q.get('competition')||league]){await report(root,q,configs[q.get('competition')||league],signal);return}
    const sports=[...new Set(Object.values(configs).map(v=>v[0]))];
    const entries=Object.entries(configs).filter(([k,v])=>(!sport||v[0]===sport)&&(!league||k===league));
    root.innerHTML='<section class="page sports-page"><div class="eyebrow">Setal Sports</div><h1>Match centre</h1><div class="sport-date">'+[-1,0,1].map((n,i)=>'<a class="chip '+(shift(today,n)===day?'active':'')+'" href="'+link(q,{date:shift(today,n)})+'">'+['Yesterday','Today','Tomorrow'][i]+'</a>').join('')+'<input aria-label="Fixture date" type="date" value="'+escape(day)+'"></div><h2>'+escape(longDate(day))+'</h2><p class="hint">Kickoff times in Lagos (WAT)</p><div class="sport-filters"><label>Sport<select id="sport">'+['',...sports].map(v=>'<option '+(sport===v?'selected':'')+' value="'+escape(v)+'">'+escape(v||'All sports')+'</option>').join('')+'</select></label><label>League<select id="league"><option value="">All covered leagues</option>'+Object.entries(configs).filter(([,v])=>!sport||sport===v[0]).map(([k,v])=>'<option '+(league===k?'selected':'')+' value="'+k+'">'+escape(v[1]+' · '+v[2])+'</option>').join('')+'</select></label></div><div id="schedule" aria-live="polite"></div><p class="hint">Fixtures and match data from ESPN. Coverage varies by competition.</p></section>';
    const hub=document.createElement('section');root.querySelector('.sport-date').before(hub);sportsHub(hub,q,signal);
    root.querySelector('input').onchange=e=>{if(e.target.value)location.hash=link(q,{date:e.target.value})};
    root.querySelector('#sport').onchange=e=>location.hash=link(q,{sport:e.target.value,league:null});
    root.querySelector('#league').onchange=e=>location.hash=link(q,{league:e.target.value});
    const container=root.querySelector('#schedule');const rows=new Map();let incomplete=0,done=0;
    function paint(){
      if(signal.aborted)return;
      let html='',count=0;
      for(const [k,v] of entries){const result=rows.get(k);const events=(result?.events||[]).filter(e=>dayOf(e.date)===day).sort((a,b)=>a.date.localeCompare(b.date));if(!events.length)continue;count+=events.length;
        html+='<section class="league-group"><div class="league-title"><div><small>'+escape(v[0]+' · '+v[2])+'</small><h3>'+escape(v[1])+'</h3></div><span>'+events.length+(result.saved?' · saved':'')+'</span></div>'+events.map(e=>'<a class="fixture-card" href="'+link(q,{competition:k,id:e.id,tab:'overview'})+'"><span class="fixture-time '+(e.state==='in'?'live':'')+'">'+escape(status(e))+'</span><span>'+e.teams.map(t=>team(t,e.state!=='pre')).join('')+'</span><span aria-hidden="true">›</span></a>').join('')+'</section>';
      }
      const note=done<entries.length?'Loading leagues…':incomplete?'Some league feeds are unavailable.':!count?'No fixtures listed for this selection.':'';
      for(const [competition,row] of rows)for(const e of row.events||[])selectedFixtures.set(competition+'/'+e.id,e);
      container.onclick=click=>{
        const href=click.target.closest('a.fixture-card')?.getAttribute('href');
        if(!href)return;
        const item=new URLSearchParams(href.slice('#sports/'.length)),key=item.get('competition')+'/'+item.get('id');
        try{sessionStorage.setItem('fixture:'+key,JSON.stringify(selectedFixtures.get(key)))}catch{}
      };
      container.innerHTML=(count?'<p class="hint">'+count+' fixtures</p>':'')+html+(note?'<p class="panel">'+note+'</p>':'');
    }
    paint();
    const stored=await json('/sports/snapshot.json',signal).catch(()=>null);
    if(stored&&day>=stored.from&&day<=stored.to)for(const [k] of entries)if(stored.scores[k])rows.set(k,{events:stored.scores[k],saved:true});
    paint();
    await Promise.all(entries.map(async([k])=>{const key=k+day;try{let slot=cache.get(key);if(!slot||Date.now()-slot.at>60000){const data=await json('/api/fixtures?'+new URLSearchParams({league:k,date:day}),signal);slot={at:Date.now(),data};cache.set(key,slot)}rows.set(k,slot.data);if(slot.data.partial)incomplete++}catch{incomplete++}done++;paint()}));
  }catch{if(!signal.aborted)root.innerHTML='<section class="page"><h1>Match centre</h1><p class="panel">Match data is temporarily unavailable.</p><a href="'+link(q,{id:null,tab:null,competition:null,provider:null})+'">Browse fixtures</a></section>'}
}
export function leaveFixtures(){active?.abort()}
