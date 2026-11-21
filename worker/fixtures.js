function fixture(event){
  const contest=event.competitions?.[0];
  if(!contest)return null;
  return {id:event.id,date:event.date,state:event.status?.type?.state,status:event.status?.type?.shortDetail,venue:contest.venue?.fullName,teams:contest.competitors.map(t=>({name:t.team?.displayName||t.team?.name,logo:t.team?.logo||t.team?.logos?.[0]?.href,score:t.score?.displayValue??t.score,homeAway:t.homeAway}))};
}
function matchReport(data){
  const box=data.boxscore||{};
  const event=fixture({...data.header,date:data.header.competitions[0].date,status:data.header.competitions[0].status});
  let squads=(data.rosters||[]).map(r=>({name:r.team?.displayName,formation:r.formation,players:(r.roster||[]).map(p=>({name:p.athlete?.displayName,number:p.jersey,position:p.position?.abbreviation,starter:p.starter}))}));
  if(!squads.some(t=>t.players.length)){
    squads=(box.players||[]).map(t=>{const seen=new Set(),players=[];for(const group of t.statistics||[])for(const p of group.athletes||[]){if(!p.athlete?.id||seen.has(p.athlete.id))continue;seen.add(p.athlete.id);players.push({name:p.athlete.displayName,number:p.athlete.jersey,position:p.athlete.position?.abbreviation,starter:p.starter})}return {name:t.team?.displayName,players}});
  }
  const stats=(box.teams||[]).map(t=>({name:t.team?.shortDisplayName||t.team?.displayName,values:(t.statistics||[]).map(s=>({key:s.name,label:s.label||s.displayName||s.name,value:s.displayValue??s.value}))}));
  const plays=(data.keyEvents||data.scoringPlays||[]).map(p=>({time:p.clock?.displayValue||p.period?.displayValue,text:p.text||p.type?.text})).filter(p=>p.text);
  return {event,squads,stats,plays,attendance:data.gameInfo?.attendance,officials:(data.gameInfo?.officials||[]).map(o=>o.displayName||o.fullName).filter(Boolean),venue:data.gameInfo?.venue?.fullName||event.venue};
}
async function fixturesApi(url){
  const league=url.searchParams.get('league'),day=url.searchParams.get('date'),id=url.searchParams.get('id');
  if(!Object.hasOwn(leagueMap,league)||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||(id!==null&&!/^\d{1,16}$/.test(id)))return new Response(null,{status:400});
  const base='https://site.api.espn.com/apis/site/v2/sports/'+leagueMap[league][3]+'/'+league+'/';
  const shift=n=>new Date(Date.parse(day)+86400000*n).toISOString().slice(0,10).replaceAll('-','');
  const upstream=id?base+'summary?event='+id:base+'scoreboard?dates='+shift(0);
  try{
    async function load(address){
      const response=await fetch(address,{signal:AbortSignal.timeout(8500),cf:{cacheEverything:true,cacheTtl:60}});
      if(!response.ok)throw Error();
      return response.json();
    }
    if(id)return Response.json(matchReport(await load(upstream)),{headers:{'Cache-Control':'public, max-age=60'}});
    const days=[shift(-1),shift(0),shift(1)];
    const responses=await Promise.allSettled(days.map(day=>load(base+'scoreboard?dates='+day)));
    const events=new Map();let missing=false,saved=false,loaded=false;
    responses.forEach((res,index)=>{
      if(res.status==='fulfilled' && Array.isArray(res.value.events)){
        loaded=true;for(const event of res.value.events.map(fixture).filter(Boolean))events.set(event.id,event);
      }else if(sportsSnapshot.coverage?.[league]?.includes(days[index])){
        saved=true;loaded=true;for(const event of sportsSnapshot.scores[league])if(!events.has(event.id))events.set(event.id,event);
      }else missing=true;
    });
    if(!loaded)throw Error();
    return Response.json({events:[...events.values()],partial:missing,saved},{headers:{'Cache-Control':'public, max-age=45'}});
  }catch{
    if(id && league==='eng.1' && id==='740928' && archivedReport)return Response.json({...archivedReport,saved:true});
    if(!id && day>=sportsSnapshot.from && day<=sportsSnapshot.to && sportsSnapshot.coverage?.[league]?.includes(shift(0)))return Response.json({events:sportsSnapshot.scores[league],saved:true});
    return Response.json({error:'League data temporarily unavailable'},{status:503});
  }
}
