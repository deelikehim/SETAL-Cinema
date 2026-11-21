import {fixturesPage,leaveFixtures} from '/sports.js';
const app=document.querySelector('#app'), nav=document.querySelector('#nav');
const icons={search:'<circle cx="10" cy="10" r="7"/><path d="m15.5 15.5 5 5"/>',play:'<path fill="currentColor" stroke="none" d="m6 3 15 9-15 9z"/>',plus:'<path d="M12 4v16M4 12h16"/>',check:'<path d="m4 12 5 5L20 6"/>'};
Object.assign(icons,{
  home:'<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>',
  movies:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M6 5l3 5m3-5 3 5"/>',
  series:'<rect x="2" y="4" width="20" height="14" rx="3"/><path d="M8 21h8"/>',
  sports:'<path d="M8 3h8v5c0 5-2 7-4 7s-4-2-4-7zM8 5H4v2c0 3 2 5 5 5m7-7h4v2c0 3-2 5-5 5m-3 3v5m-4 1h8"/>',
  watchlist:'<path d="M5 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-7-4-7 4z"/>'
});
const icon=k=>'<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">'+icons[k]+'</svg>';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)?u.href:''}catch{return ''}};
function read(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}
const cached=await fetch('/catalog.json').then(r=>r.json()), records=new Map(), library=[], history=[];
let home=cached.home,feature=0,genre='All',epoch=0,timer,results=[],lastQuery='',searchState='',lookup=0;
const remember=x=>{const recordKey=x?.catalogKey||x?.subjectId;if(!recordKey)return;let old=records.get(String(recordKey))||{};records.set(String(recordKey),{...old,...x,detailPath:x.detailPath||old.detailPath})};
[...cached.worldCinema,...cached.nollywood,...cached.bollywood,...cached.africa,...cached.asia,...cached.search,...home].forEach(remember);
const featured=['Zootopia 2','Wednesday','Stranger Things','The Lord of the Rings: The Rings of Power','Kingdom of the Planet of the Apes'].map(title=>home.find(x=>x.title===title)).filter(Boolean),synopses={'Kingdom of the Planet of the Apes':'Generations after Caesar, a young ape sets out on a journey that will reshape the future of apes and humans alike.','Wednesday':'At Nevermore Academy, Wednesday Addams follows a trail of strange murders while learning to master her psychic gifts.','Stranger Things':'In Hawkins, Indiana, a missing boy leads his friends into a mystery that reaches far beyond their quiet town.','The Lord of the Rings: The Rings of Power':'Across Middle-earth, an ancient evil begins to stir as unlikely allies face a rising darkness.'};
Object.assign(synopses,{
  'Zootopia 2':'Judy Hopps and Nick Wilde follow a mysterious reptile into unfamiliar corners of Zootopia.',
  'GOAT':'A young goat earns a shot at playing roarball alongside some of the fiercest animals in the sport.',
  'Wolf King':'A shepherd discovers he can transform into a wolf and gets drawn into a struggle for the throne.',
  'Super Cube':'An ordinary student gains extraordinary abilities after a mysterious cube enters his life.',
  'The Demon Hunter':'Meng Chuan trains to protect the people he loves in a world threatened by demons.',
  'Predator: Killer of Killers':'Three warriors from different eras face a hunter whose weapons outmatch their own.',
  "Ron's Gone Wrong":"A boy befriends a malfunctioning robot that has to learn what being a friend really means.",
  'A Working Man':'A construction worker draws on his military past when his employer’s daughter disappears.',
  'The Old Guard 2':'Andy and her fellow immortal warriors face a threat that forces them to reckon with their past.',
  'Thunderbolts*':'A group of outsiders caught in a deadly trap must decide whether they can trust one another.',
  'Mission: Impossible - The Final Reckoning':'Ethan Hunt and his team race to stop an artificial intelligence capable of turning nations against each other.'
});
const gateway=new URL('/api/movie/',location.origin);
async function request(action,params={},version='MovieBox-pro'){let u=new URL(version,gateway);u.search=new URLSearchParams({action,...params});let r=await fetch(u,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Provider unavailable');let j=await r.json();if(j.success===false||Number(j.statusCode)>=400)throw Error('Provider unavailable');return j}
function nodes(j){return [j,j?.data,j?.data?.data,j?.data?.data?.data].filter(Boolean)}
function arr(j,keys){for(let n of nodes(j))for(let k of keys)if(Array.isArray(n[k]))return n[k];return []}
const id=x=>String(x.catalogKey||x.subjectId),key=x=>encodeURIComponent(id(x)),kind=x=>x.subjectType===2?'Series':x.subjectType===1?'Movie':'Video',year=x=>(x.releaseDate||x.year||'').slice(0,4),tags=x=>(x.genre||'').split(',').filter(Boolean),pic=x=>x.poster||safe(x.cover?.url)||safe(x.thumbnail);
function detailLink(x,t='overview'){return '#title/'+key(x)+'/'+t}
function card(x){return '<div class="poster-item"><a class="card" data-title-id="'+esc(id(x))+'" href="'+detailLink(x)+'"><div class="frame"><img loading="lazy" src="'+esc(pic(x))+'" alt=""><span class="rate"><b>★</b> '+esc(+x.imdbRatingValue?x.imdbRatingValue:'—')+'</span></div><h3>'+esc(x.title)+'</h3><p>'+esc([year(x),tags(x)[0]].filter(Boolean).join(' · '))+'</p></a>'+watchBtn(x,true)+'</div>'}
const preview=document.createElement('a');
preview.className='title-preview';
preview.tabIndex=-1;
preview.hidden=true;
document.body.append(preview);
let previewCard,previewTimer;
const homeCard=target=>target?.closest?.('.discover-shelves .card');
function dismissPreview(){
  clearTimeout(previewTimer);
  previewCard?.removeAttribute('aria-describedby');
  previewCard=null;
  preview.hidden=true;
}
function showPreview(card){
  if(!card.isConnected)return;
  const x=records.get(card.dataset.titleId);
  if(!x)return;
  previewCard=card;
  const genres=tags(x).map(t=>t.trim()).slice(0,3);
  const runtime=Math.round(Number(x.duration)/60);
  const about=x.description?.trim()||synopses[x.title]||[genres.join(', '),kind(x).toLowerCase()].filter(Boolean).join(' ')+(x.countryName?' from '+x.countryName:'')+'.';
  const facts=[kind(x),year(x),runtime>0?runtime+' min':'',+x.imdbRatingValue?'★ '+x.imdbRatingValue:''].filter(Boolean);
  preview.href=card.href;
  preview.innerHTML='<img alt="" src="'+esc(pic(x))+'"><div><strong>'+esc(x.title)+'</strong><small>'+esc(facts.join(' · '))+'</small></div><p id="preview-about">'+esc(about)+'</p>';
  card.setAttribute('aria-describedby','preview-about');
  preview.hidden=false;
  const rect=card.getBoundingClientRect(),margin=8;
  preview.style.left=Math.max(margin,Math.min(rect.left,innerWidth-preview.offsetWidth-margin))+'px';
  preview.style.top=Math.max(margin,Math.min(rect.top+rect.height/2-preview.offsetHeight/2,innerHeight-preview.offsetHeight-margin))+'px';
}
function queuePreview(card,delay){
  dismissPreview();
  previewTimer=setTimeout(()=>showPreview(card),delay);
}
app.addEventListener('pointerover',e=>{
  const card=homeCard(e.target);
  if(e.pointerType==='mouse'&&card&&!card.contains(e.relatedTarget)&&e.relatedTarget!==preview&&!preview.contains(e.relatedTarget))queuePreview(card,280);
});
app.addEventListener('pointerout',e=>{
  const card=homeCard(e.target);
  if(card&&!card.contains(e.relatedTarget)&&!preview.contains(e.relatedTarget))dismissPreview();
});
preview.addEventListener('pointerleave',e=>{if(!previewCard?.contains(e.relatedTarget))dismissPreview()});
app.addEventListener('focusin',e=>{const card=homeCard(e.target);if(card&&card.matches(':focus-visible'))queuePreview(card,0)});
app.addEventListener('focusout',e=>{if(homeCard(e.target))dismissPreview()});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){dismissPreview();return}
  const card=homeCard(e.target);
  if(card&&['ArrowRight','ArrowLeft'].includes(e.key)){
    const item=card.closest('.poster-item');
    const next=(e.key==='ArrowRight'?item.nextElementSibling:item.previousElementSibling)?.querySelector('.card');
    if(next?.matches('.card')){e.preventDefault();next.focus()}
  }
});
window.addEventListener('resize',dismissPreview);
document.addEventListener('scroll',()=>{if(previewCard===document.activeElement&&previewCard?.matches(':focus-visible'))showPreview(previewCard);else dismissPreview()},true);
function grid(a,msg='No titles match this filter.'){return a.length?'<div class="grid">'+a.map(card).join('')+'</div>':'<p class="empty">'+esc(msg)+'</p>'}
const footer=`<footer class="home-footer">
  <div class="footer-browse"><h2>SETAL Cinema</h2><h3>Quick links</h3>
    <nav aria-label="Footer quick links">
      <a href="#trending">Trending now</a><a href="#movies">Movies</a><a href="#series">TV series</a><a href="#cartoons">Cartoons</a>
      <a href="#made-in-africa">Made in Africa</a><a href="#made-in-asia">Made in Asia</a><a href="#k-dramas">K-Dramas</a>
      <a href="#sports">Sports</a><a href="#watchlist">Watchlist</a>
    </nav>
  </div>
  <section class="studio-cta"><h2>SETAL Studio</h2><p>Need a website for your business?</p>
    <a class="btn primary" href="https://setalstudio.pages.dev/">Get a website designed</a>
  </section>
</footer>`;
function chips(){return '<div class="filters">'+['All','Action','Drama','Thriller','Comedy','Adventure'].map(g=>'<button class="chip '+(genre===g?'active':'')+'" data-genre="'+g+'">'+g+'</button>').join('')+'</div>'}
const match=x=>genre==='All'||tags(x).includes(genre);
function shelf(name,list,link,filters=false){return '<section class="shelf"><div class="sectionHead"><h2>'+name+'</h2>'+(link?'<div class="shelf-tools"><button data-scroll="-1" aria-label="Scroll '+name+' left">‹</button><button data-scroll="1" aria-label="Scroll '+name+' right">›</button><a href="#'+link+'">View all</a></div>':'')+'</div>'+(filters?chips():'')+grid(list)+'</section>'}
function watchBtn(x,compact=false){
  const saved=library.some(item=>id(item)===id(x));
  const label=(saved?'Remove from wishlist':'Save for later')+' · '+x.title;
  return '<button type="button" class="'+(compact?'poster-save':'btn')+'" data-save="'+esc(id(x))+'" aria-label="'+esc(label)+'" title="'+esc(label)+'" aria-pressed="'+saved+'">'+icon(saved?'check':'watchlist')+(compact?'':saved?'Saved to wishlist':'Save for later')+'</button>';
}
function meta(x){let m=Math.floor(Number(x.duration)/60);return '<div class="meta"><span class="star">★ '+esc(x.imdbRatingValue||'—')+'</span> · '+esc([year(x),m?Math.floor(m/60)+'h '+m%60+'m':'',tags(x).slice(0,2).join(', ')].filter(Boolean).join('　·　'))+' <span class="type">'+kind(x)+'</span></div>'}
const spotlightCast={
  'Zootopia 2':'Ginnifer Goodwin, Jason Bateman and Ke Huy Quan',
  'Wednesday':'Jenna Ortega, Emma Myers and Catherine Zeta-Jones',
  'Stranger Things':'Winona Ryder, David Harbour and Millie Bobby Brown',
  'The Lord of the Rings: The Rings of Power':'Morfydd Clark, Charlie Vickers and Robert Aramayo',
  'Kingdom of the Planet of the Apes':'Owen Teague, Freya Allan and Kevin Durand'
};
function burgundySpotlight(x,still){
  const series=x.subjectType===2;
  const chart=series?discovery.shows:trendingMovies();
  const rank=chart.findIndex(t=>id(t)===id(x))+1;
  const minutes=Math.round(x.duration/60);
  const facts=[tags(x).slice(0,2).join(' & '),year(x),minutes?Math.floor(minutes/60)+'h '+minutes%60+'m':'',x.imdbRatingValue?'★ '+x.imdbRatingValue:''].filter(Boolean);
  const badges=(rank>0&&rank<=10?'<span><b class="chart-mark">TOP<br>10</b> #'+rank+(series?' in local TV shows':' in Trending Movies')+'</span>':'')+(spotlightCast[x.title]?'<span>★ &nbsp;Starring '+esc(spotlightCast[x.title])+'</span>':'');
  return '<section class="hero glass-feature marquee"><div class="feature-stage"><img class="stage-image" src="'+esc(still)+'" alt=""></div><div class="dots glass-transport"><button class="rotation" data-rotation aria-label="'+(spotlightPaused?'Resume':'Pause')+' spotlight">'+(spotlightPaused?'▶':'Ⅱ')+'</button>'+featured.map((f,i)=>'<button data-feature="'+i+'" class="'+(i===feature?'sel':'')+'" aria-label="Feature '+esc(f.title)+'" aria-pressed="'+(i===feature)+'"></button>').join('')+'</div><div class="marquee-footer"><div class="marquee-title"><div class="marquee-kind"><strong>SC</strong> '+(series?'SERIES':'FILM')+'</div><h1><a href="'+detailLink(x)+'">'+esc(x.title)+'</a></h1><p>'+esc(facts.join('　·　'))+'</p></div><div class="marquee-badges">'+badges+'</div></div></section>';
}
function glassSpotlight(x){
  const still=x.back||safe(x.stills?.url)||pic(x);
  if(document.documentElement.dataset.theme==='burgundy')return burgundySpotlight(x,still);
  const next=featured[(feature+1)%featured.length];
  const copy=x.description||synopses[x.title]||'';
  return '<section class="hero glass-feature"><div class="feature-stage"><img class="stage-image" src="'+esc(still)+'" alt=""><div class="stage-label"><span></span>Spotlight</div><div class="dots glass-transport"><button class="rotation" data-rotation aria-label="'+(spotlightPaused?'Resume spotlight':'Pause spotlight')+'">'+(spotlightPaused?'▶':'Ⅱ')+'</button>'+featured.map((f,i)=>'<button data-feature="'+i+'" class="'+(i===feature?'sel':'')+'" aria-label="Feature '+esc(f.title)+'" aria-pressed="'+(i===feature)+'"></button>').join('')+'</div></div><div class="feature-panel"><div class="feature-tags">'+esc([kind(x),year(x),tags(x)[0]].filter(Boolean).join('  ·  '))+'<span>★ '+esc(x.imdbRatingValue)+'</span></div><h1>'+esc(x.title)+'</h1><p>'+esc(copy)+'</p><div class="actions"><a class="btn primary" href="'+detailLink(x)+'">Explore title</a>'+watchBtn(x)+'</div><button class="up-next" data-feature="'+((feature+1)%featured.length)+'"><img alt="" src="'+esc(pic(next))+'"><span><small>Up next</small>'+esc(next.title)+'</span><b aria-hidden="true">›</b></button></div></section>';
}
window.addEventListener('setal-theme-change',()=>{if(!location.hash||location.hash==='#home')landing()});
const phoneHome=matchMedia('(max-width:700px)');
phoneHome.addEventListener('change',()=>{if(app.querySelector('.discover-shelves'))landing()});
function mobileListButton(x){
  const saved=library.some(item=>id(item)===id(x));
  return '<button class="btn mobile-list" data-save="'+esc(id(x))+'" aria-label="'+esc((saved?'Remove from My List: ':'Add to My List: ')+x.title)+'" aria-pressed="'+saved+'">'+icon(saved?'check':'plus')+' My List</button>';
}
function mobileSpotlight(x){
  const position=featured.indexOf(x);
  const chips=featured.map((f,i)=>'<button type="button" data-feature="'+i+'" aria-label="Feature '+esc(f.title)+'" aria-pressed="'+(i===position)+'"></button>').join('');
  return '<section class="hero phone-poster"><img class="phone-art" src="'+esc(pic(x))+'" alt=""><div class="phone-stamp" aria-hidden="true">SC</div><div class="dots phone-dots"><button class="rotation" data-rotation aria-label="'+(spotlightPaused?'Resume':'Pause')+' spotlight">'+(spotlightPaused?'▶':'Ⅱ')+'</button>'+chips+'</div><div class="phone-caption"><h1><a href="'+detailLink(x)+'">'+esc(x.title)+'</a></h1><p>'+esc(tags(x).slice(0,3).join(' · '))+'</p><div class="phone-actions"><a class="btn primary" href="'+detailLink(x,'watch')+'">'+icon('play')+' Play</a>'+mobileListButton(x)+'</div></div></section>';
}
const phoneCategories='<div class="phone-categories" role="navigation" aria-label="Browse categories">'+[['series','Shows'],['movies','Movies'],['trending','Trending'],['cartoons','Cartoons'],['k-dramas','K-Dramas']].map(([page,label])=>'<a href="#'+page+'">'+label+'</a>').join('')+'</div>';
function hero(x,spot){if(spot&&phoneHome.matches)return mobileSpotlight(x);if(spot && document.documentElement.dataset.theme!=="classic")return glassSpotlight(x);let bg=x.back||safe(x.stills?.url)||pic(x);let title=esc(x.title);return '<section class="hero"><img class="heroPic" src="'+esc(bg)+'" alt=""><div class="heroContent"><div class="eyebrow">'+(spot?'In the spotlight':kind(x)+' details')+'</div><h1>'+title+'</h1>'+meta(x)+'<p class="summary">'+esc(x.description||synopses[x.title]||[x.countryName,tags(x).join(' · ')].filter(Boolean).join('　|　'))+'</p><div class="actions"><a class="btn primary" href="'+detailLink(x,spot?'overview':'watch')+'">'+icon('play')+(spot?'Explore title':'Playback options')+'</a>'+watchBtn(x)+'</div></div>'+(spot?'<div class="dots"><button class="rotation" data-rotation aria-label="'+(spotlightPaused?'Resume spotlight':'Pause spotlight')+'">'+(spotlightPaused?'▶':'Ⅱ')+'</button>'+featured.map((f,i)=>'<button data-feature="'+i+'" class="'+(i===feature?'sel':'')+'" aria-label="Feature '+esc(f.title)+'" aria-pressed="'+(i===feature)+'"><img alt="" src="'+esc(f.back||pic(f))+'"></button>').join('')+'</div>':'')+'</section>'}
const collectionNames={'made-in-africa':'Made in Africa','made-in-asia':'Made in Asia','k-dramas':'K-Dramas'};
const productionCountries={
  'made-in-africa':'Algeria|Angola|Benin|Botswana|Burkina Faso|Burundi|Cabo Verde|Cameroon|Central African Republic|Chad|Comoros|Democratic Republic of the Congo|Republic of the Congo|Côte d’Ivoire|Djibouti|Egypt|Equatorial Guinea|Eritrea|Eswatini|Ethiopia|Gabon|Gambia|Ghana|Guinea|Guinea-Bissau|Kenya|Lesotho|Liberia|Libya|Madagascar|Malawi|Mali|Mauritania|Mauritius|Morocco|Mozambique|Namibia|Niger|Nigeria|Rwanda|São Tomé and Príncipe|Senegal|Seychelles|Sierra Leone|Somalia|South Africa|South Sudan|Sudan|Tanzania|Togo|Tunisia|Uganda|Zambia|Zimbabwe|Western Sahara'.split('|'),
  'made-in-asia':'Afghanistan|Armenia|Azerbaijan|Bahrain|Bangladesh|Bhutan|Brunei|Cambodia|China|Cyprus|Georgia|Hong Kong|India|Indonesia|Iran|Iraq|Israel|Japan|Jordan|Kazakhstan|Kuwait|Kyrgyzstan|Laos|Lebanon|Macao|Malaysia|Maldives|Mongolia|Myanmar|Nepal|North Korea|Oman|Pakistan|Palestine|Philippines|Qatar|Saudi Arabia|Singapore|South Korea|Sri Lanka|Syria|Taiwan|Tajikistan|Thailand|Timor-Leste|Turkey|Turkmenistan|United Arab Emirates|Uzbekistan|Vietnam|Yemen'.split('|')
};
const productionCountry=x=>x.countryName==='Korea'?'South Korea':x.countryName;
function industryOf(x){
  const specific={'Sangaya':'Kannywood · Hausa cinema','Aníkúlápó':'Yoruba cinema','Azonto Ghost':'Kumawood','Who Killed Captain Alex?':'Wakaliwood'}[x.title];
  if(specific)return specific;
  if(cached.bollywood.some(t=>id(t)===id(x)))return 'Bollywood · Hindi cinema';
  const language={RRR:'Telugu cinema',Vikram:'Tamil cinema',Drishyam:'Malayalam cinema',Kantara:'Kannada cinema'}[x.title];
  if(productionCountry(x)==='India')return language||'Indian cinema';
  return ({Nigeria:'Nollywood',China:'Mainland Chinese cinema','Hong Kong':'Hong Kong cinema',Taiwan:'Taiwanese cinema',Ghana:'Ghanaian cinema',Egypt:'Egyptian cinema','South Africa':'South African cinema'})[productionCountry(x)]||('Cinema of '+productionCountry(x));
}
function collectionTitles(key){
  if(key==='anime')return animeTitles();
  if(key==='k-dramas')return [...new Map([...records.values()].filter(x=>!adultMovie(x)&&Number(x.subjectType)===2 && /^(South )?Korea$/i.test(x.countryName)).map(x=>[id(x),x])).values()];
  const pools=new Map(),seen=new Set();
  for(const x of [...cached.nollywood,...cached.bollywood,...cached.worldCinema,...records.values()]){
    const country=productionCountry(x),identity=x.title.toLowerCase()+'|'+year(x);
    if(adultMovie(x)||!productionCountries[key].includes(country)||Number(x.subjectType)!==1||seen.has(identity))continue;
    seen.add(identity);
    if(!pools.has(country))pools.set(country,[]);
    pools.get(country).push(x);
  }
  const all=[];
  for(let rank=0;all.length<seen.size;rank++)for(const films of pools.values())if(films[rank])all.push(films[rank]);
  return all;
}
function collectionShelf(key){return shelf(collectionNames[key],collectionTitles(key).slice(0,6),key)}
function collectionPage(key,params=''){
  const paramsState=new URLSearchParams(params),country=paramsState.get('country')||'',industry=paramsState.get('industry')||'';
  const genres=['All','Action','Drama','Thriller','Comedy','Adventure'];
  const selectedGenre=genres.includes(paramsState.get('genre'))?paramsState.get('genre'):'All';
  const countries=productionCountries[key],rev=epoch;
  const films=()=>collectionTitles(key).filter(x=>(!country||productionCountry(x)===country)&&(!industry||industryOf(x)===industry)&&(selectedGenre==='All'||tags(x).some(g=>g.trim().toLowerCase()===selectedGenre.toLowerCase())));
  const opts=(values,value)=>values.map(v=>'<option '+(v===value?'selected':'')+' value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  function href(c,i,g){const q=new URLSearchParams();if(c)q.set('country',c);if(i)q.set('industry',i);if(g!=='All')q.set('genre',g);return '#'+key+(q.size?'/'+q:'')}
  const chips=genres.map(g=>'<a class="chip '+(g===selectedGenre?'active':'')+'" '+(g===selectedGenre?'aria-current="true"':'')+' href="'+esc(href(country,industry,g))+'">'+g+'</a>').join('');
  const industryOptions=()=>opts([...new Set(collectionTitles(key).filter(x=>!country||productionCountry(x)===country).map(industryOf))].sort(),industry);
  app.innerHTML='<section class="page"><h1>'+ (collectionNames[key]||'Anime')+'</h1><div class="filters">'+chips+'</div>'+(countries?'<div class="sport-filters"><label>Country or market<select id="market"><option value="">All countries and markets</option>'+opts(countries,country)+'</select></label><label>Film industry<select id="industry"><option value="">All industries</option>'+industryOptions()+'</select></label></div>':'')+'<div id="market-grid"></div><button class="btn collection-more">LOAD MORE</button><p class="hint" role="status"></p></section>';
  if(countries){
    app.querySelector('#market').onchange=e=>location.hash=href(e.target.value,'',selectedGenre);
    app.querySelector('#industry').onchange=e=>location.hash=href(country,e.target.value,selectedGenre);
  }
  const button=app.querySelector('.collection-more'),status=button.nextElementSibling;
  const shown=new Map(),marketGrid=app.querySelector('#market-grid');
  const markets=country?[country]:countries?[...new Set([...collectionTitles(key).map(productionCountry),...countries])]:[key==='anime'?'Japan':'South Korea'];
  const feeds=markets.flatMap(region=>(key==='anime'?[1,2]:[key==='k-dramas'?2:1]).map(subjectType=>({region,subjectType,page:1,seen:new Set()})));
  function append(max){
    const batch=films().filter(x=>!shown.has(id(x))).slice(0,max);
    batch.forEach(x=>shown.set(id(x),x));
    const gridEl=marketGrid.querySelector('.grid');
    if(gridEl)gridEl.insertAdjacentHTML('beforeend',batch.map(card).join(''));
    else marketGrid.innerHTML=grid([...shown.values()],'No matching titles loaded yet.');
    return batch.length;
  }
  append(20);
  async function more(){
    button.disabled=true;status.textContent='Finding more titles…';
    let count=append(10),failed=false;
    for(let round=0;round<4&&feeds.length&&count<10&&!failed;round++){
      const group=feeds.splice(0,3);
      await Promise.all(group.map(async feed=>{
        try{
          const result=await request('filter',{region:feed.region,subjectType:feed.subjectType,page:feed.page,perPage:50});
          if(epoch!==rev)return;
          const list=arr(result,['subjectList','items','results']),signature=list.map(id).join('|');
          if(!list.length||feed.seen.has(signature))return;
          feed.seen.add(signature);feed.page++;feeds.push(feed);
          list.filter(x=>x.subjectId&&x.title&&!adultMovie(x)).forEach(remember);
        }catch{failed=true;feeds.push(feed)}
      }));
      if(epoch!==rev)return;
      count+=append(10-count);
    }
    if(countries)app.querySelector('#industry').innerHTML='<option value="">All industries</option>'+industryOptions();
    button.disabled=false;button.hidden=!feeds.length&&!films().some(x=>!shown.has(id(x)));
    status.textContent=button.hidden?'All available matches shown.':failed?'Some catalog pages could not be reached. Try again.':count?'':'No matches on these pages. Load more to keep browsing.';
  }
  button.onclick=more;
  if(!shown.size)more();
}
async function resolveCollectionMovie(x){
  if(x.subjectId)return;
  const result=await request('search',{keyword:x.title,page:1,perPage:40});
  const clean=t=>String(t||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const hit=arr(result,['items','subjectList','results']).find(t=>t.subjectId && Number(t.subjectType)===1 && clean(t.title)===clean(x.title) && year(t)===year(x) && (!t.countryName || t.countryName===x.countryName));
  if(!hit)throw Error('The provider has no matching copy of this film.');
  Object.assign(x,{subjectId:String(hit.subjectId),detailPath:hit.detailPath||'',trailer:hit.trailer||x.trailer});
  remember(x);
}
function adultMovie(movie){
  const flagged=[movie.isPornographic,movie.isAdult,movie.adult].some(value=>/^(true|1)$/i.test(String(value)));
  return flagged || /(?:^|[,;/|])\s*(?:adult|erotica|erotic|pornography|pornographic|xxx)\s*(?:$|[,;/|])/i.test(movie.genre||'');
}
function catalogByType(type){
  const titles=new Map();
  for(const item of [...home,...records.values()]){
    const movie=records.get(id(item))||item;
    if(Number(movie.subjectType)===type && (type!==1 || !adultMovie(movie)))titles.set(id(movie),movie);
  }
  return [...titles.values()];
}
let moviePage=1, moreMovies=true, movieRequest=null, movieError=false;
const movieSelections=new Map(), movieSignatures=new Set();
function browseSelection(){
  if(!movieSelections.has(genre))movieSelections.set(genre,catalogByType(1).filter(match).slice(0,30).map(id));
  return movieSelections.get(genre);
}
function movieControls(){
  const remaining=remainingMovies().length;
  if(!remaining && !moreMovies)return '<p class="hint">All available movies shown.</p>';
  return '<button class="btn" id="more-movies">'+('LOAD MORE')+'</button>';
}
function remainingMovies(){
  const shown=new Set(browseSelection());
  return catalogByType(1).filter(x=>match(x)&&!shown.has(id(x)));
}
function prefetchMovies(){
  if(movieRequest)return movieRequest;
  movieRequest=(async()=>{
    movieError=false;
    try{
      while(moreMovies && remainingMovies().length<20){
        const result=await request('filter',{subjectType:1,page:moviePage,perPage:50});
        const items=arr(result,['subjectList','items','results']);
        const signature=items.map(id).join(',');
        if(!items.length||movieSignatures.has(signature)){moreMovies=false;break}
        movieSignatures.add(signature);moviePage++;
        items.filter(x=>x.subjectId&&x.title&&Number(x.subjectType)===1).forEach(remember);
        if(remainingMovies().length>=10)break;
      }
    }catch{movieError=true}
  })().finally(()=>{movieRequest=null});
  return movieRequest;
}
async function showMoreMovies(button){
  const filter=genre;
  button.disabled=true;
  button.textContent='Loading movies…';
  while(remainingMovies().length<10 && moreMovies){
    await prefetchMovies();
    if(!button.isConnected || filter!==genre)return;
    if(movieError)break;
  }
  const batch=remainingMovies().slice(0,10);
  if(batch.length===10 || !moreMovies){
    browseSelection().push(...batch.map(id));
    const gridEl=document.querySelector('.movie-grid .grid');
    if(gridEl)gridEl.insertAdjacentHTML('beforeend',batch.map(card).join(''));
    else document.querySelector('.movie-grid').innerHTML=grid(batch);
  }
  button.parentElement.innerHTML=(movieError && batch.length<10?'<p class="hint">Could not load a full batch. Try again.</p>':'')+movieControls();
  if(!movieError && remainingMovies().length<20)prefetchMovies();
}
document.addEventListener('click',event=>{const button=event.target.closest('#more-movies');if(button)showMoreMovies(button)});
function animeTitles(){
  return [...catalogByType(1),...catalogByType(2)].filter(x=>{
    if(adultMovie(x))return false;
    const genres=tags(x).map(tag=>tag.trim().toLowerCase());
    return genres.includes('anime')||(genres.includes('animation')&&productionCountry(x)==='Japan');
  });
}
function cartoons(){
  return [...catalogByType(1),...catalogByType(2)].filter(x=>tags(x).some(tag=>/^(animation|animated|anime|cartoons?|donghua)$/i.test(tag.trim())));
}
function trendingMovies(){
  const byCountry=new Map();
  const seen=new Set();
  for(const movie of [...home,...cached.africa,...cached.asia]){
    if(adultMovie(movie) || Number(movie.subjectType)!==1 || !(Number(movie.imdbRatingValue)>=6.5) || seen.has(id(movie)))continue;
    seen.add(id(movie));
    const country=movie.countryName||'Unknown';
    if(!byCountry.has(country))byCountry.set(country,[]);
    byCountry.get(country).push(movie);
  }
  const movies=[];
  for(let rank=0;movies.length<seen.size;rank++){
    for(const titles of byCountry.values()){
      if(titles[rank])movies.push(titles[rank]);
    }
  }
  return movies;
}
let spotlightTimer;
let spotlightPaused=false;
function scheduleSpotlight(){
  clearTimeout(spotlightTimer);
  if(document.hidden || spotlightPaused || !app.querySelector('.dots'))return;
  spotlightTimer=setTimeout(()=>{
    const banner=app.querySelector('.hero');
    if(!banner || !banner.querySelector('.dots'))return;
    if(!banner.contains(document.activeElement) || document.activeElement.hasAttribute('data-rotation'))showFeature((feature+1)%featured.length);
    else scheduleSpotlight();
  },5000);
}
function showFeature(index){
  feature=index;
  const banner=app.querySelector('.hero');
  banner.outerHTML=hero(featured[feature],true);
  scheduleSpotlight();
}
document.addEventListener('visibilitychange',scheduleSpotlight);
let discovery={market:'',shows:[]};
function dailyPicks(){
  const preferences=new Map(),seen=new Set();
  for(const x of [...library,...watched.map(row=>row.item)]){
    seen.add(id(x));
    for(const tag of tags(records.get(id(x))||x))preferences.set(tag,(preferences.get(tag)||0)+1);
  }
  const today=new Date().toLocaleDateString('en-CA');
  function score(x){
    let hash=2166136261;
    for(const ch of today+id(x))hash=Math.imul(hash^ch.charCodeAt(0),16777619);
    return tags(x).reduce((n,t)=>n+Math.min(2,preferences.get(t)||0),0)+(hash>>>0)/4294967296*3+(Number(x.imdbRatingValue)||0)/10;
  }
  return [...records.values()].filter(x=>pic(x)&&!adultMovie(x)&&!seen.has(id(x))).sort((a,b)=>score(b)-score(a)).slice(0,12);
}
function homeRail(title,tiles){
  return '<section class="shelf cinema-rail"><div class="sectionHead"><h2>'+esc(title)+'</h2><div class="shelf-tools"><button data-scroll="-1" aria-label="Scroll left">‹</button><button data-scroll="1" aria-label="Scroll right">›</button></div></div><div class="grid">'+tiles.join('')+'</div></section>';
}
function picksRail(exclude){
  const picks=dailyPicks().filter(x=>!exclude||id(x)!==id(exclude));
  return homeRail('Today’s Picks for You',picks.map(x=>card({...x,poster:x.back||safe(x.stills?.url)||pic(x)})));
}
function titleRails(x){
  const related=catalogByType(x.subjectType).filter(y=>id(y)!==id(x)&&tags(y).some(tag=>tags(x).includes(tag))).slice(0,6);
  return '<div class="title-rails">'+picksRail(x)+'<div data-title-resume>'+resumeRail()+'</div>'+shelf('More like this',related,'')+'</div>';
}
function resumeRail(){
  const seen=new Set(),tiles=[];
  for(const row of watched){
    const x=records.get(id(row.item))||row.item;
    if(seen.has(id(x)))continue;
    seen.add(id(x));if(row.item.finished||row.item.resumeHidden)continue;
    const p=row.item.progress||{}, pct=p.duration?Math.min(100,100*p.time/p.duration):0;
    const label=row.season?'Season '+row.season+' · Episode '+row.episode:'Movie';
    tiles.push('<div class="resume-entry"><a class="resume-tile" href="'+detailLink(x,'watch')+'/'+row.season+'/'+row.episode+'"><img loading="lazy" src="'+esc(x.back||safe(x.stills?.url)||pic(x))+'" alt=""><div><small>'+label+'</small><strong>'+esc(x.title)+'</strong></div><progress aria-label="Playback progress" max="100" value="'+pct+'"></progress></a><button type="button" class="resume-remove" data-hide-resume="'+esc(id(x))+'" aria-label="Remove '+esc(x.title)+' from Continue Watching" title="Remove from Continue Watching">×</button></div>');
  }
  if(tiles.length)return homeRail('Continue Watching',tiles);
  return '<section class="resume-empty"><h2>Continue Watching</h2><p>'+(viewer?'Your next watch will appear here.':'<a href="#profile">Sign in</a> to pick up where you left off.')+'</p></section>';
}
function rankedRail(){
  let region='';
  try{if(discovery.market)region=new Intl.DisplayNames(undefined,{type:'region'}).of(discovery.market)}catch{}
  const local=discovery.shows.length>0;
  const shows=local?discovery.shows:catalogByType(2).filter(x=>!adultMovie(x)).sort((a,b)=>Number(b.imdbRatingValue||0)-Number(a.imdbRatingValue||0)).slice(0,10);
  const title=local?'Top '+shows.length+' TV Shows in '+region+' Today':'Top 10 TV Shows by Catalog Rating';
  return homeRail(title,shows.map((x,i)=>'<div class="rank-tile"><b aria-hidden="true">'+(i+1)+'</b>'+card(x)+'</div>'));
}
function landing(){
  app.innerHTML=phoneCategories+hero(featured[feature],true)+'<div class="body discover-shelves">'+
    shelf('Trending now',trendingMovies().filter(match).slice(0,18),'trending',true)+
    resumeRail()+picksRail()+rankedRail()+
    shelf('Movies',catalogByType(1),'movies')+
    shelf('TV series',catalogByType(2).slice(0,12),'series')+
    shelf('Cartoons',cartoons(),'cartoons')+
    collectionShelf('made-in-africa')+collectionShelf('made-in-asia')+collectionShelf('k-dramas')+shelf('Anime',animeTitles(),'anime')+footer+'</div>';
  scheduleSpotlight();
}
function searchPage(){app.innerHTML='<section class="page"><h1>Search</h1><input id="query" type="search" aria-label="Search movies and series" placeholder="Search movies and series…" value="'+esc(lastQuery)+'"><div id="results"></div></section>';paintResults();let q=document.querySelector('#query');q.focus();q.oninput=()=>{lastQuery=q.value;runSearch()}}
function paintResults(){let el=document.querySelector('#results');if(el)el.innerHTML=(searchState?'<p class="hint" style="margin-bottom:16px">'+esc(searchState)+'</p>':'')+grid(results,'No matching titles. Try another name.')}
function runSearch(){clearTimeout(timer);let ticket=++lookup,q=lastQuery.trim().toLowerCase();results=[...records.values()].filter(x=>!q||x.title.toLowerCase().includes(q)).slice(0,q?80:12);searchState=q?'Searching…':'Browse titles';paintResults();if(!q)return;timer=setTimeout(async()=>{try{let j=await request('search',{keyword:lastQuery.trim(),page:1,perPage:40});if(ticket!==lookup)return;let found=arr(j,['items','results','subjectList']);found.forEach(remember);results=[...new Map([...found,...results].map(x=>[id(x),records.get(id(x))])).values()];searchState=results.length+' results'}catch{if(ticket!==lookup)return;searchState='Live search is unavailable. Showing matches from the saved catalog.'}paintResults()},300)}
function mediaOptions(response,watch){
  const options=new Map();
  let preferred='';
  function add(item,kind){
    if(!item || item.vipLocked)return;
    const label=item.quality||item.resolution||item.name||'Default';
    const url=watch
      ? safe(item.streamUrl||(kind==='stream' && item.url)||item.proxyUrl)
      : safe(item.downloadUrl||(kind==='download' && item.url));
    if(url && !options.has(label))options.set(label,{label,url,relay:!!item.directUrl});
  }
  for(const node of nodes(response)){
    for(const item of node.qualities||[])add(item,'quality');
    for(const item of node.availableStreams||[])add(item,'stream');
    for(const item of node.downloads||[])add(item,'download');
    if(node.bestQuality && !node.bestQuality.vipLocked){
      add(node.bestQuality,'quality');
      preferred=node.bestQuality.quality||node.bestQuality.resolution;
    }
    if(watch && !options.size && !node.bestQuality?.vipLocked && safe(node.bestQualityUrl)){
      options.set('Default',{label:'Default',url:safe(node.bestQualityUrl)});
    }
  }
  const all=[...options.values()];
  if(watch && preferred)return all.sort((a,b)=>Number(b.label===preferred)-Number(a.label===preferred));
  return all;
}
function overview(x){
  const minutes=Math.floor(Number(x.duration)/60);
  const facts=[['Release date',x.releaseDate||year(x)],['Runtime',minutes?[Math.floor(minutes/60)?Math.floor(minutes/60)+'h':'',minutes%60?minutes%60+'m':''].filter(Boolean).join(' '):''],['Country',x.countryName],['Genre',tags(x).join(', ')],['Subtitles',String(x.subtitles||'').split(',').filter(Boolean).join(', ')]].filter(([,value])=>value);
  const description=x.description||synopses[x.title];
  const trailer=safe(x.trailer?.videoAddress?.url);
  const artwork=x.back||safe(x.stills?.url)||pic(x);
  const details=facts.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('');
  return '<section class="title-feature">'+(artwork?'<img class="title-backdrop" src="'+esc(artwork)+'" alt="">':'')+
    '<div class="title-copy"><div class="title-type">'+esc(kind(x))+(Number(x.imdbRatingValue)>0?' · ★ '+esc(x.imdbRatingValue):'')+'</div>'+
    '<h1>'+esc(x.title)+'</h1>'+(description?'<p class="title-description">'+esc(description)+'</p>':'')+
    '<dl class="title-facts">'+details+'</dl><div class="actions"><a class="btn primary" href="'+detailLink(x,'watch')+'">'+icon('play')+'Playback options</a>'+
    watchBtn(x)+'<a class="btn" href="'+detailLink(x,'downloads')+'">Download options</a>'+
    (trailer?'<button class="btn" data-trailer>'+icon('play')+'Play trailer</button>':'')+'</div></div></section>';
}
function titleOverview(x){
  app.innerHTML=overview(x)+'<section class="body"><div data-preview></div>'+titleRails(x)+'</section>';
  const button=app.querySelector('[data-trailer]');
  if(button)button.onclick=()=>{
    const preview=app.querySelector('[data-preview]');
    preview.innerHTML='<video class="trailer-player" controls playsinline autoplay src="'+esc(safe(x.trailer.videoAddress.url))+'"></video><p role="status"></p>';
    expandPlayer(preview.querySelector('video'));
    preview.querySelector('video').onerror=()=>{preview.querySelector('p').textContent='The trailer could not be loaded.'};
    preview.scrollIntoView({block:'nearest'});
  };
}
function mediaHeading(x){
  return '<section class="media-heading"><a href="'+detailLink(x)+'">‹ Title details</a><div class="eyebrow">'+kind(x)+'</div><h1>'+esc(x.title)+'</h1>'+meta(x)+'</section>';
}
let sleepTimer,sleepUntil=0;
function nextEpisode(seasons,season,episode){
  const current=seasons.find(row=>row.season===season);
  if(!current)return null;
  if(episode<current.episodes)return [season,episode+1];
  const next=seasons.find(row=>row.season>season);
  return next?[next.season,1]:null;
}
function viewingControls(video,title,seasons,season,episode){
  const wrap=video.closest('.cinema-player'),panel=document.createElement('details');
  panel.className='viewing-controls';
  panel.innerHTML='<summary>Playback controls</summary><div class="viewing-options"></div>';
  wrap.append(panel);
  const options=panel.lastElementChild;
  const qualities=wrap.parentElement.querySelectorAll('[data-quality]');
  options.append(...qualities);
  function button(label,act){
    const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.onclick=act;options.append(b);
  }
  function select(label,choices,value,change){
    const field=document.createElement('label'),input=document.createElement('select');
    field.append(label+' ',input);options.append(field);
    for(const [key,text] of choices)input.add(new Option(text,key));
    input.value=value;input.onchange=()=>change(input.value);return input;
  }
  function seek(seconds){
    if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+seconds));
  }
  button('↶ 10 sec',()=>seek(-10));button('10 sec ↷',()=>seek(10));
  button('Play from start',()=>{video.currentTime=0;video.play().catch(()=>{})});
  const rates=[0.5,0.75,1,1.25,1.5,2],rate=Number(read('sc-speed',1));
  function speed(n){video.defaultPlaybackRate=n;video.playbackRate=n}
  speed(rates.includes(rate)?rate:1);
  select('Speed',rates.map(n=>[n,n+'×']),video.playbackRate,v=>{speed(Number(v));localStorage.setItem('sc-speed',JSON.stringify(Number(v)))});
  const sizes={small:'0.9rem',medium:'1.2rem',large:'1.65rem'};
  function captionSize(k){wrap.style.setProperty('--caption-size',sizes[k]||sizes.medium)}
  const size=read('sc-caption-size','medium');captionSize(size);
  select('Caption size',Object.keys(sizes).map(k=>[k,k]),size,v=>{captionSize(v);localStorage.setItem('sc-caption-size',JSON.stringify(v))});
  const next=nextEpisode(seasons,season,episode);
  if(next){
    const advance=()=>{location.hash=detailLink(title,'watch')+'/'+next.join('/')};
    button('Next episode',advance);
    const field=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=read('sc-auto-next',false);
    toggle.onchange=()=>localStorage.setItem('sc-auto-next',JSON.stringify(toggle.checked));field.append(toggle,' Autoplay next episode');options.append(field);
    video.addEventListener('ended',()=>{if(toggle.checked&&video.isConnected)advance()});
  }
  const timerOptions=[[0,'Off'],[15,'15 min'],[30,'30 min'],[60,'60 min']];
  if(sleepUntil>Date.now())timerOptions.push([-1,'Active']);
  const timerSelect=select('Sleep timer',timerOptions,sleepUntil>Date.now()?-1:0,v=>{
    if(v==='-1')return;
    clearTimeout(sleepTimer);sleepUntil=Number(v)?Date.now()+Number(v)*60000:0;
    if(sleepUntil)sleepTimer=setTimeout(()=>{sleepUntil=0;document.querySelector('#sources video')?.pause();const current=document.querySelector('[data-sleep]');if(current)current.value=0},Number(v)*60000);
  });
  timerSelect.dataset.sleep='';
  if(document.pictureInPictureEnabled&&video.requestPictureInPicture){
    button('Picture in picture',async()=>{try{if(document.pictureInPictureElement===video)await document.exitPictureInPicture();else await video.requestPictureInPicture()}catch{announce('Picture in picture is unavailable for this video.')}});
  }
  wrap.tabIndex=0;wrap.setAttribute('aria-label','Player. Space to play or pause, left and right arrows to seek, M to mute.');
  wrap.addEventListener('keydown',e=>{
    if(![wrap,video].includes(e.target)||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='ArrowLeft')seek(-10);else if(e.key==='ArrowRight')seek(10);else if(e.key===' '){if(video.paused)video.play().catch(()=>{});else video.pause()}else if(e.key.toLowerCase()==='m')video.muted=!video.muted;else return;
    e.preventDefault();
  });
}
function announce(message,undo){
  document.querySelector('.cinema-notice')?.remove();
  const box=document.createElement('div');box.className='cinema-notice';box.setAttribute('role','status');box.textContent=message;
  if(undo){const b=document.createElement('button');b.type='button';b.textContent='Undo';b.onclick=async()=>{b.disabled=true;await undo()};box.append(b)}
  document.body.append(box);setTimeout(()=>box.remove(),12000);
}
async function changeResume(key,hide){
  const x=records.get(key);if(!x||!viewer)return;
  try{
    await writeEntry('resumeVisibility',x,hide);
    for(const row of watched)if(id(row.item)===key)row.item.resumeHidden=hide;
    if(!location.hash||location.hash==='#home')landing();
    const section=app.querySelector('[data-title-resume]');if(section)section.innerHTML=resumeRail();
    announce(hide?'Removed from Continue Watching.':'Restored to Continue Watching.',hide?()=>changeResume(key,false):null);
  }catch{announce('Could not update Continue Watching. Try again.')}
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-hide-resume]');if(!b)return;
  b.disabled=true;await changeResume(b.dataset.hideResume,true);b.disabled=false;
});
function expandPlayer(video){
  const wrap=document.createElement('div');
  wrap.className='cinema-player';
  video.replaceWith(wrap);wrap.append(video);
  const button=document.createElement('button');
  button.className='btn expand-player';button.textContent='Fullscreen';wrap.append(button);
  const exit=()=>{wrap.classList.remove('expanded');button.textContent='Fullscreen'};
  wrap.onfullscreenchange=()=>{button.textContent=document.fullscreenElement===wrap?'Exit fullscreen':'Fullscreen'};
  wrap.onkeydown=e=>{if(e.key==='Escape')exit()};
  button.onclick=async()=>{
    if(wrap.classList.contains('expanded')){exit();return}
    if(document.fullscreenElement===wrap){await document.exitFullscreen();return}
    if(wrap.requestFullscreen)try{await wrap.requestFullscreen();return}catch{}
    if(video.webkitEnterFullscreen)try{video.webkitEnterFullscreen();return}catch{}
    wrap.classList.add('expanded');button.textContent='Exit expanded view';button.focus();
  };
}
function subtitlePicker(options,onChange){
  const root=document.createElement('details'),summary=document.createElement('summary'),group=document.createElement('fieldset');
  root.className='subtitle-picker';
  const legend=document.createElement('legend');
  legend.textContent='Subtitle language';group.append(legend);
  root.append(summary,group);
  function sync(value){
    for(const button of group.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.value===value));
    const selected=options.find(o=>o.value===value)||options[0];
    summary.textContent='Subtitles · '+selected.label;
  }
  for(const option of options){
    const button=document.createElement('button');
    button.type='button';button.value=option.value;button.textContent=option.label;button.dir='auto';
    group.append(button);
    button.onclick=()=>{
      sync(option.value);root.open=false;summary.focus();onChange(option.value);
    };
  }
  root.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();root.open=false;summary.focus()}
  };
  sync(options[0].value);
  return {root,sync};
}

function parseCaptionCues(text){
  const cues=[];
  const timestamp=value=>value.replace(',','.').split(':').reduce((sum,part)=>sum*60+Number(part),0);
  for(const block of text.replace(/\r\n?/g,'\n').split(/\n[ \t]*\n/)){
    const lines=block.split('\n');
    const index=lines.findIndex(line=>line.includes('-->'));
    if(index<0)continue;
    const times=lines[index].trim().match(/^((?:\d+:)?\d{1,2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d+)/);
    if(!times)continue;
    const start=timestamp(times[1]),end=timestamp(times[2]);
    const body=lines.slice(index+1).join('\n').replace(/\\N/gi,'\n').trim();
    if(end>start&&body)cues.push({start,end,body});
  }
  return cues;
}
async function attachCaptions(video,query){
  const wrap=video.closest('.cinema-player');
  const notice=document.createElement('p');notice.className='hint';notice.setAttribute('role','status');
  wrap.after(notice);
  const url='/api/cinebase/subtitles?'+query;
  try{
    const response=await fetch(url);
    if(!response.ok)throw Error();
    const tracks=await response.json();
    if(!video.isConnected)return;
    if(!tracks.length){notice.textContent='No subtitles available for this title or episode.';return}
    const options=[{value:'',label:'Off'},...tracks.map(t=>({value:t.id,label:t.label||t.language}))];
    const captionLayer=document.createElement('div');
    captionLayer.className='stream-caption';captionLayer.hidden=true;video.after(captionLayer);
    const loaded=new Map();let selected=null,ticket=0;
    function render(){
      const nativeFullscreen=document.fullscreenElement===video||video.webkitDisplayingFullscreen;
      if(selected?.track)selected.track.mode=nativeFullscreen?'showing':'disabled';
      const text=(selected?.cues||[]).filter(c=>c.start<=video.currentTime && video.currentTime<c.end).map(c=>c.body.replace(/<[^>]*>/g,'')).join('\n');
      captionLayer.textContent=text;captionLayer.hidden=!text||nativeFullscreen;
    }
    for(const event of ['timeupdate','seeked','webkitbeginfullscreen','webkitendfullscreen','fullscreenchange'])video.addEventListener(event,render);
    const picker=subtitlePicker(options,async value=>{
      const current=++ticket;
      if(selected?.track)selected.track.mode='disabled';
      selected=null;render();notice.textContent='';
      if(!value)return;
      try{
        if(!loaded.has(value)){
          notice.textContent='Loading subtitles…';
          const file=await fetch(url+'&track='+encodeURIComponent(value));
          if(!file.ok)throw Error();
          const cues=parseCaptionCues(await file.text());
          if(current!==ticket||!video.isConnected)return;
          if(!cues.length)throw Error();
          const meta=tracks.find(t=>t.id===value);
          let track=null;
          try{
            track=video.addTextTrack('subtitles',meta.label,meta.language);
            track.mode='hidden';
            for(const cue of cues)track.addCue(new VTTCue(cue.start,cue.end,cue.body));
          }catch{track=null}
          loaded.set(value,{cues,track});
        }
        selected=loaded.get(value);notice.textContent='';render();
      }catch{
        if(current!==ticket)return;
        picker.sync('');notice.textContent='This subtitle track could not be loaded. Choose a language to try again.';
      }
    });
    wrap.querySelector('.viewing-options').prepend(picker.root);
  }catch{notice.textContent='Subtitle languages could not be loaded.'}
}
function fileSize(mb){
  if(!Number.isFinite(mb))return 'Size unavailable';
  const gb=mb>=1000;
  return (gb?mb/1000:mb).toLocaleString(undefined,{maximumFractionDigits:gb?2:1})+(gb?' GB':' MB');
}
function selectionSize(rows,quality){
  let sum=0,missing=0,pending=0,count=0;
  for(const row of rows){
    if(!row.check.checked||row.check.disabled)continue;
    count++;
    const mb=row.options?.sizesMB?.[quality];
    if(Number.isFinite(mb))sum+=mb;
    else if(row.options===undefined)pending++;
    else missing++;
  }
  const partial=pending+missing>0;
  const amount=partial?(count>pending+missing?fileSize(sum)+' known':''):'Estimated total '+fileSize(sum);
  return [count+' episode'+(count===1?'':'s')+' selected',amount,pending?'Checking '+pending+'…':'',missing?'Size unavailable for '+missing:''].filter(Boolean).join(' · ');
}
async function downloadSubtitles(el,query){
  const field=document.createElement('div');
  field.className='subtitle-download';
  field.innerHTML='<span data-picker>Loading subtitle languages…</span> <a hidden>Download subtitle</a><p class="hint" role="status"></p>';
  el.querySelector('h2').after(field);
  let language='';
  const slot=field.querySelector('[data-picker]'),fallback=field.querySelector('a'),note=field.querySelector('p');
  const subtitleURL=params=>{
    const q=new URLSearchParams(params);
    q.delete('quality');q.set('language',language);
    return '/api/cinebase/subtitles?'+q;
  };
  function update(value){
    language=value;fallback.textContent='Download subtitle';
    fallback.hidden=!language;
    if(language){
      fallback.href=subtitleURL(query);
      note.textContent='Your video and subtitle download as separate files. Allow multiple downloads if your browser asks.';
    }else note.textContent='';
  }

  // Capture both single-quality and season episode links before native navigation.
  el.subtitleListener?.abort();
  el.subtitleListener=new AbortController();
  el.addEventListener('click',event=>{
    if(!field.isConnected)return;
    const link=event.target.closest('a[href]');
    if(!language||!link)return;
    const url=new URL(link.href);
    if(url.origin!==location.origin||url.pathname!=='/api/cinebase/download')return;
    const q=url.searchParams;
    const a=document.createElement('a');
    a.href=subtitleURL(q);a.download='';field.append(a);a.click();a.remove();
    fallback.href=subtitleURL(q);
    fallback.textContent=Number(q.get('episode'))?'Download subtitle · Episode '+q.get('episode'):'Download subtitle';
  },{capture:true,signal:el.subtitleListener.signal});
  try{
    const r=await fetch('/api/cinebase/subtitles?'+query);
    if(!r.ok)throw Error();
    const tracks=await r.json();
    const options=[{value:'',label:'No subtitles'}];
    const languages=new Set();
    for(const t of tracks){
      if(!t.language||languages.has(t.language))continue;
      languages.add(t.language);options.push({label:t.label||t.language,value:t.language});
    }
    if(languages.size)slot.replaceWith(subtitlePicker(options,update).root);else slot.textContent='Subtitles';
    if(!languages.size)note.textContent='No subtitle tracks are available for this selection.';
  }catch{slot.textContent='Subtitles';note.textContent='Subtitle languages could not be loaded.'}
}

async function seasonDownloads(el,query,initial){
  const qualities=initial.qualities;
  const box=document.createElement('section');box.className='season-downloads';el.append(box);
  try{
    let count=initial.seasons?.find(row=>row.season===Number(query.get('season')))?.episodes;
    if(!count){
      const r=await fetch('/api/cinebase/season?'+query);
      if(!r.ok)throw Error();
      count=(await r.json()).count;
    }
    if(!box.isConnected)return;
    box.innerHTML='<h3>Download season '+esc(query.get('season'))+'</h3><label>Quality <select></select></label><label><input type="checkbox" data-all checked> All episodes</label><div class="episode-picks"></div><p class="bulk-total" aria-live="polite"></p><button class="btn primary" type="button">Download selected episodes</button><p class="hint">Your browser may ask to allow multiple downloads. You can also use the individual episode links.</p>';
    const select=box.querySelector('select'),all=box.querySelector('[data-all]'),list=box.querySelector('.episode-picks'),button=box.querySelector('button');
    for(const quality of qualities)select.add(new Option(quality,quality));
    const links=[];
    for(let n=1;n<=count;n++){
      const row=document.createElement('div'),check=document.createElement('input'),a=document.createElement('a');
      check.type='checkbox';check.checked=true;check.setAttribute('aria-label','Select episode '+n);
      a.textContent='Episode '+n;row.append(check,a);list.append(row);links.push({n,check,a,options:n===Number(query.get('episode'))?initial:undefined});
    }
    const refresh=()=>{
      for(const {n,a,check,options} of links){
        const params=new URLSearchParams(query);params.set('episode',n);params.set('quality',select.value);
        check.disabled=Boolean(options&&!options.qualities.includes(select.value));
        a.textContent='Episode '+n+' · '+(check.disabled?'Quality unavailable':options===undefined?'Checking…':fileSize(options?.sizesMB?.[select.value]));
        if(check.disabled)a.removeAttribute('href');
        else a.href='/api/cinebase/download?'+params;
        a.download='';
      }
      const eligible=links.filter(x=>!x.check.disabled);
      const chosen=eligible.filter(x=>x.check.checked).length;
      button.disabled=!chosen;all.checked=chosen>0&&chosen===eligible.length;
      all.indeterminate=chosen>0&&chosen<eligible.length;
      box.querySelector('.bulk-total').textContent=selectionSize(links,select.value);
    };
    all.onchange=()=>{for(const {check} of links)check.checked=all.checked;refresh()};
    list.onchange=refresh;select.onchange=refresh;refresh();
    button.onclick=()=>{for(const {check,a} of links)if(check.checked&&!check.disabled)a.click()};
    const waiting=links.filter(row=>!row.options);
    let cursor=0;
    async function loadSizes(){
      while(box.isConnected&&cursor<waiting.length){
        const row=waiting[cursor++],params=new URLSearchParams(query);
        params.set('episode',row.n);
        try{
          const response=await fetch('/api/cinebase/options?'+params);
          if(!response.ok)throw Error();
          row.options=await response.json();
        }catch{row.options=null}
        if(box.isConnected)refresh();
      }
    }
    await Promise.all(Array.from({length:Math.min(3,waiting.length)},loadSizes));
  }catch{box.textContent='The episode list for this season is unavailable.'}
}

function startingQuality(sources){
  // Prefer 480p, then the closest lower resolution, then the smallest higher one.
  let selected=0,best=Infinity;
  sources.forEach(({label},index)=>{
    const match=/^(\d+)p?$/i.exec(String(label).trim());
    if(!match)return;
    const height=Number(match[1]);
    const rank=height<=480?480-height:480+height;
    if(rank<best){selected=index;best=rank}
  });
  return selected;
}
function startPlayer(video,status){
  video.onplaying=()=>{status.textContent=''};
  video.play().catch(error=>{
    if(error.name==='NotAllowedError')status.textContent='Tap Play to start watching.';
  });
}
function detail(x,tab,rev){if(tab==='overview'){titleOverview(x);return}const series=x.subjectType===2;app.innerHTML=mediaHeading(x)+'<section class="body"><div class="pageTabs">'+['overview','watch','downloads'].map(t=>'<a href="'+detailLink(x,t)+'" class="'+(tab===t?'on':'')+'">'+t[0].toUpperCase()+t.slice(1)+'</a>').join('')+'</div><div class="panel">'+(series?'<div id="episode"><p class="hint" data-season-count aria-live="polite">Checking available seasons…</p><label>Season <select id="season" disabled><option value="1">Season 1</option></select></label><label>Episode <select id="ep" disabled><option value="1">Episode 1</option></select></label></div>':'')+'<div id="sources">Checking availability…</div></div>'+titleRails(x)+'</section>';if(series && tab==='watch'){
  const parts=location.hash.split('/'),form=app.querySelector('#episode');
  for(const [sel,value] of [['#season',parts[3]],['#ep',parts[4]]]){
    if(/^[1-9]\d{0,3}$/.test(value||''))form.querySelector(sel).replaceChildren(new Option(value,value,true,true));
  }
}let current=0;async function load(){let token=++current,se=series?document.querySelector('#season').value:0,ep=series?document.querySelector('#ep').value:0,el=document.querySelector('#sources');el.innerHTML='<p>Checking availability…</p>';try{if(!x.subjectId)await resolveCollectionMovie(x);if(!x.detailPath){let d=await request('detail',{subjectId:String(x.subjectId)});let rec=nodes(d).flatMap(n=>[n.subject,n.detail,n]).find(y=>y?.detailPath&&(!y.subjectId||String(y.subjectId)===String(x.subjectId)));if(!rec)throw Error('This title’s detail path is unavailable.');x.detailPath=rec.detailPath;remember(x)}const query=new URLSearchParams({detailPath:x.detailPath,season:se,episode:ep});
const response=await fetch('/api/cinebase/options?'+query);
if(!response.ok)throw Error('CineBase is unavailable.');
const data=await response.json();
if(epoch!==rev||current!==token)return;
if(series){
  const form=document.querySelector('#episode'),season=form.querySelector('#season'),episode=form.querySelector('#ep');
  const seasons=data.seasons||[];
  if(seasons.length){
    const count=seasons.length;
    form.querySelector('[data-season-count]').textContent=count+' available season'+(count===1?'':'s');
    season.replaceChildren(...seasons.map(row=>new Option('Season '+row.season,row.season)));
    const row=seasons.find(row=>row.season===Number(se))||seasons[0];
    season.value=String(row.season);season.disabled=false;
    function setEpisodes(row,selected){
      episode.replaceChildren(...Array.from({length:row.episodes},(_,i)=>new Option('Episode '+(i+1),i+1)));
      episode.value=String(Math.min(selected,row.episodes));episode.disabled=false;
    }
    setEpisodes(row,Number(ep));
    season.onchange=()=>{setEpisodes(seasons.find(row=>String(row.season)===season.value),1);load()};
    episode.onchange=load;
    if(season.value!==String(se)||episode.value!==String(ep)){load();return}
  }else{
    form.querySelector('[data-season-count]').textContent='Season count unavailable.';
  }
}
const sources=data.qualities.map(label=>({label,url:(tab==='downloads'?'/api/cinebase/download?':'/api/cinebase/stream?')+new URLSearchParams([...query,['quality',label]])}));
if(tab==='downloads'&&viewer){
  el.downloadTracking?.abort();
  el.downloadTracking=new AbortController();
  el.addEventListener('click',event=>{
    const a=event.target.closest('a[href]');if(!a)return;
    const url=new URL(a.href);if(url.pathname!=='/api/cinebase/download')return;
    const q=url.searchParams,season=Number(q.get('season')),episode=Number(q.get('episode')),quality=q.get('quality');
    writeEntry('downloaded',x,false,season,episode,quality).then(()=>{
      const i=history.findIndex(v=>id(v)===id(x)&&v.season===season&&v.episode===episode);
      if(i>=0)history.splice(i,1);history.unshift({...titleSnapshot(x),season,episode,label:quality});
    }).catch(()=>{const msg=el.querySelector('[data-download-status]');if(msg)msg.textContent='Could not save this request to download history.'});
  },{signal:el.downloadTracking.signal});
}
const initialQuality=startingQuality(sources);

el.innerHTML='<h2>'+(tab==='downloads'?'Download options':tab==='watch'?'Player':'Title overview')+'</h2>'+(tab==='overview'?'<p>'+esc([x.title,year(x),x.countryName,tags(x).join(', ')].filter(Boolean).join(' · '))+'</p>':'')+(sources.length?(tab==='watch'?'<video preload="auto" controls playsinline src="'+esc(sources[initialQuality].url)+'">'+'</video>':'')+sources.map((v,i)=>tab==='watch'?'<button class="btn" data-quality="'+i+'" aria-pressed="'+(i===initialQuality)+'">'+esc(v.label)+'</button>':'<a class="btn" href="'+esc(v.url)+'" data-dl="'+i+'">Download · '+esc(v.label)+' · '+esc(fileSize(data.sizesMB?.[v.label]))+'</a>').join(''):'<p>No stream or download links are available for this selection.</p>');el.insertAdjacentHTML('beforeend','<p role="status" data-download-status></p>');const player=el.querySelector('video');if(player){if(viewer)trackProgress(player,x,Number(se),Number(ep));expandPlayer(player);viewingControls(player,x,data.seasons||[],Number(se),Number(ep));startPlayer(player,el.querySelector("[data-download-status]"));attachCaptions(player,query)}if(tab==='downloads')downloadSubtitles(el,query);if(series&&tab==='downloads'&&sources.length)seasonDownloads(el,query,data);if(player)player.onerror=()=>{el.querySelector('[data-download-status]').textContent='Playback failed for this quality. The provider may be unavailable or rate-limiting this video.'};el.onclick=e=>{let k=e.target.closest('[data-quality],[data-dl]');if(!k)return;if(k.dataset.quality!==undefined){const video=el.querySelector('video');
  if(k.getAttribute('aria-pressed')!=='true'){
    const position=video.currentTime;
    video.onloadedmetadata=()=>{if(position>0&&Number.isFinite(video.duration))video.currentTime=Math.min(position,video.duration)};
    video.src=sources[k.dataset.quality].url;
    for(const choice of el.querySelectorAll('[data-quality]'))choice.setAttribute('aria-pressed',String(choice===k));
  }
  startPlayer(video,el.querySelector('[data-download-status]'));}}}catch(e){if(epoch!==rev||current!==token)return;if(series && !document.querySelector('#season')?.onchange)document.querySelector('[data-season-count]').textContent='Season list unavailable.';
el.innerHTML='<p>'+esc((e.message.includes('detail path')||e.message.includes('matching copy'))?e.message:'The provider could not return playback or download links.')+'</p><button class="btn" id="retry">Try again</button>';document.querySelector('#retry').onclick=load}let trailer=safe(x.trailer?.videoAddress?.url);if(trailer&&epoch===rev&&current===token){let b=document.createElement('button');b.className='btn';b.textContent='Play trailer';b.onclick=()=>{el.innerHTML='<video controls playsinline autoplay src="'+esc(trailer)+'"></video>';expandPlayer(el.querySelector('video'))};el.append(b)}}load();}
const watched=[];
const accountButton=document.querySelector('.user');
let viewer=null,accountError=false;
function titleSnapshot(x){
  const item={};
  for(const k of ['catalogKey','subjectId','detailPath','title','subjectType','genre','countryName','releaseDate','duration','imdbRatingValue','poster','back'])if(x[k]!=null)item[k]=x[k];
  if(item.subjectId)item.subjectId=String(item.subjectId);
  if(!item.poster)item.poster=pic(x);
  return item;
}
async function loadViewer(){
  try{
    const r=await fetch('/api/library',{cache:'no-store'});
    if(r.status===401){accountError=false;return}
    if(!r.ok)throw Error();
    const data=await r.json();
    viewer=data;accountError=false;library.length=0;watched.length=0;history.length=0;
    for(const row of data.entries){
      if(!records.has(id(row.item)))remember(row.item);
      if(row.kind==='saved')library.push(records.get(id(row.item)));else if(row.kind==='watched')watched.push(row);else if(row.kind==='downloaded')history.push({...row.item,season:row.season,episode:row.episode,label:row.item.quality});
    }
  }catch{accountError=true}
}
function trackProgress(video,x,season,episode){
  const matches=row=>id(row.item)===id(x)&&row.season===season&&row.episode===episode;
  const prior=watched.find(matches)?.item;
  const restore=()=>{if(!prior?.finished&&prior?.progress?.time>0&&prior.progress.time<video.duration)video.currentTime=prior.progress.time};
  if(video.readyState>=1)restore();else video.addEventListener('loadedmetadata',restore,{once:true});
  let last=-1,chain=Promise.resolve();
  function save(){
    if(!Number.isFinite(video.duration)||!video.currentTime)return;
    const time=Math.floor(video.currentTime);
    if(time===last&&!video.ended)return;
    last=time;
    const extra={progress:{time,duration:Math.round(video.duration)},finished:video.ended};
    const index=watched.findIndex(matches);if(index>=0)watched.splice(index,1);
    watched.unshift({item:{...x,...extra},season,episode});
    chain=chain.then(()=>writeEntry('watched',x,false,season,episode,'',extra)).catch(()=>{});
  }
  video.addEventListener('timeupdate',()=>{if(last<0||Math.abs(video.currentTime-last)>=10)save()});
  for(const event of ['pause','ended','seeked'])video.addEventListener(event,save);
}
async function writeEntry(kind,x,remove=false,season=0,episode=0,quality='',extra={}){
  const r=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:kind!=='saved',body:JSON.stringify({kind,item:{...titleSnapshot(x),quality,...extra},remove,season:Number(season),episode:Number(episode)})});
  if(!r.ok)throw Error('Your library could not be updated. Please try again.');
}
function paintAccount(){
  accountButton.title=viewer?'My profile':'Sign up or log in';
  accountButton.setAttribute('aria-label',accountButton.title);
  accountButton.replaceChildren();
  if(viewer?.photo){
    const img=new Image();img.alt='';img.src=viewer.photo;accountButton.append(img);
  }else if(viewer)accountButton.textContent=(viewer.email||'S')[0].toUpperCase();
  else accountButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
}
async function uploadPhoto(input){
  const status=app.querySelector('[data-photo-status]'),file=input.files[0];
  if(!file)return;
  input.disabled=true;status.textContent='Saving photo…';
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=160;
    const side=Math.min(img.naturalWidth,img.naturalHeight);
    canvas.getContext('2d').drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,160,160);
    const photo=canvas.toDataURL('image/jpeg',0.82);
    const r=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'photo',photo})});
    if(!r.ok)throw Error();
    viewer.photo=photo;paintAccount();status.textContent='Photo saved.';
  }catch{status.textContent='Could not save this photo. Try a JPG, PNG or WebP image.'}
  finally{URL.revokeObjectURL(url);input.disabled=false;input.value=''}
}

function sortedWatchlist(){
  const order=read('sc-list-order','saved');
  const titles=[...library];
  if(order==='name')titles.sort((a,b)=>a.title.localeCompare(b.title));
  if(order==='rating')titles.sort((a,b)=>Number(b.imdbRatingValue||0)-Number(a.imdbRatingValue||0));
  return '<label class="watch-order">Sort by <select id="watch-order">'+[['saved','Recently saved'],['name','Title A–Z'],['rating','Highest rated']].map(([k,label])=>'<option value="'+k+'" '+(k===order?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+grid(titles,'Select a bookmark to save a title here.');
}
document.addEventListener('change',event=>{
  if(event.target.id==='watch-order'){localStorage.setItem('sc-list-order',JSON.stringify(event.target.value));accountPage('watchlist');document.querySelector('#watch-order')?.focus()}
});
function accountPage(page){
  const shell='<section class="page"><h1>'+(page==='profile'?'My profile':'My library')+'</h1>';
  if(accountError){app.innerHTML=shell+'<p>Could not load your account.</p><button class="btn" data-library-retry>Try again</button></section>';return}
  if(!viewer){app.innerHTML=shell+'<p>Sign in to save titles for later and view your watch and download history.</p><a class="btn primary" target="_top" href="/account/login">Sign in</a></section>';return}
  const tabs=[['watchlist','Saved for later'],['watched','Watch history'],['downloads','Download history']];
  const links=tabs.map(([key,name])=>'<a class="'+(page===key?'on':'')+'" href="#'+key+'">'+name+'</a>').join('');
  const legacy=read('setal-list',[]);
  const content=page==='profile'?'<div class="panel"><label>Profile picture <input data-photo type="file" accept="image/jpeg,image/png,image/webp"></label><p data-photo-status role="status"></p></div>':page==='watchlist'?sortedWatchlist():page==='watched'?(watched.length?'<div class="grid">'+watched.map(row=>'<div>'+card(records.get(id(row.item))||row.item)+(row.season?'<small>Season '+esc(row.season)+' · Episode '+esc(row.episode)+'</small>':'')+'</div>').join('')+'</div>':'<p class="empty">Movies and episodes appear here when playback starts.</p>'):(history.length?history.map(y=>'<p class="panel">'+esc(y.title)+(y.episode?' · S'+esc(y.season)+' E'+esc(y.episode):'')+' · '+esc(y.label)+'</p>').join(''):'<p class="empty">Your download requests appear here.</p>');
  app.innerHTML=shell+'<p>'+esc(viewer.email||'Signed in')+' · <a target="_top" href="/cdn-cgi/access/logout">Log out</a></p><div class="pageTabs">'+links+'</div>'+(page==='watchlist'&&legacy.length?'<button class="btn" data-import-saved>Import bookmarks from this browser</button>':'')+content+'</section>';
  const photo=app.querySelector('[data-photo]');if(photo)photo.onchange=()=>uploadPhoto(photo);
}

function route(){dismissPreview();leaveFixtures();clearTimeout(spotlightTimer);let [page='home',arg,tab='overview']=location.hash.slice(1).split('/');page=page||'home';let rev=++epoch;nav.innerHTML=[['home','Discover'],['search','Search'],['series','TV Series'],['sports','Sports'],['watchlist','Watchlist']].map(([k,t])=>'<a class="'+(k===page?'on':'')+'" href="#'+k+'">'+icon(k)+'<span>'+t+'</span></a>').join('');if(page==='home')landing();else if(page==='anime')collectionPage(page,arg);else if(page==='cartoons')app.innerHTML='<section class="page"><h1>Cartoons</h1>'+grid(cartoons())+'</section>';else if(page==='sports')fixturesPage(app,arg);else if(Object.hasOwn(collectionNames,page))collectionPage(page,arg);else if(['africa','asia','nollywood','bollywood'].includes(page))location.replace(({africa:'#made-in-africa',asia:'#made-in-asia',nollywood:'#made-in-africa/country=Nigeria',bollywood:'#made-in-asia/country=India&industry=Bollywood+%C2%B7+Hindi+cinema'})[page]);else if(page==='search'){runSearch();searchPage()}else if(page==='title'&&records.has(arg)){let x=records.get(arg);detail(x,tab,rev)}else if(['profile','watchlist','watched','downloads'].includes(page)){accountPage(page)}else if(page==='movies'){app.innerHTML='<section class="page" id="movie-browse"><h1>Movies</h1>'+chips()+'<div class="movie-grid">'+grid(browseSelection().map(key=>records.get(key)))+'</div><div class="movie-controls">'+movieControls()+'</div></section>'}else if(['series','trending'].includes(page)){app.innerHTML='<div class="page"><h1>'+({movies:'Movies',series:'TV series',trending:'Trending now'})[page]+'</h1>'+chips()+grid((page==='trending'?trendingMovies():catalogByType(page==='movies'?1:2)).filter(match))+'</div>'}else app.innerHTML='<div class="page"><h1>Title unavailable</h1><a href="#search">Search the catalog</a></div>'}
app.onclick=async e=>{let b=e.target.closest('button');if(!b)return;if(b.dataset.scroll){const rail=b.closest('.shelf').querySelector('.grid');rail?.scrollBy({left:Number(b.dataset.scroll)*rail.clientWidth*.9,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return}if(b.dataset.feature!==undefined){showFeature(Number(b.dataset.feature))}if(b.hasAttribute('data-rotation')){spotlightPaused=!spotlightPaused;b.setAttribute('aria-label',spotlightPaused?'Resume spotlight':'Pause spotlight');b.textContent=spotlightPaused?'▶':'Ⅱ';scheduleSpotlight()}if(b.dataset.genre){genre=b.dataset.genre;route()}if(b.hasAttribute('data-library-retry')){await loadViewer();route();return}
if(b.hasAttribute('data-import-saved')){
  b.disabled=true;
  try{for(const x of read('setal-list',[]))await writeEntry('saved',x);localStorage.removeItem('setal-list');await loadViewer();route()}catch(error){b.disabled=false;alert(error.message)}return;
}
if(b.dataset.save){
  if(!viewer){location.hash='profile';return}
  const x=records.get(b.dataset.save),i=library.findIndex(y=>id(y)===id(x));b.disabled=true;
  try{await writeEntry('saved',x,i!==-1)}catch(error){b.disabled=false;alert(error.message);return}
  if(i===-1)library.unshift(x);else {const at=library.findIndex(y=>id(y)===id(x));if(at>=0)library.splice(at,1)}
if(location.hash==='#watchlist'){route();return}for(const button of app.querySelectorAll('[data-save]')){if(button.dataset.save===b.dataset.save)button.outerHTML=button.classList.contains('mobile-list')?mobileListButton(x):watchBtn(x,button.classList.contains('poster-save'))}}};
await loadViewer();
paintAccount();
if(viewer){
  const local=read('sc-downloads-'+(viewer.email||'guest'),[]);
  for(const entry of local)if(!history.some(h=>h.title===entry.title&&h.label===entry.label))history.push(entry);
}
window.onhashchange=()=>{genre='All';window.scrollTo(0,0);route()};route();
let catalogBusy=false,lastCatalogCheck=0;
async function refreshProviderCatalog(){
  if(document.hidden||catalogBusy||Date.now()-lastCatalogCheck<300000)return;
  catalogBusy=true;lastCatalogCheck=Date.now();
  try{
    const feeds=await Promise.allSettled([
      request('trending',{page:1,perPage:40}),
      request('filter',{subjectType:1,page:1,perPage:50})
    ]);
    const live=feeds.flatMap(feed=>feed.status==='fulfilled'?arr(feed.value,['subjectList','items','results']):[])
      .filter(x=>x?.subjectId && x.title && !adultMovie(x));
    if(!live.length)return;
    live.forEach(remember);
    home=[...new Map([...live,...home].map(x=>[id(x),records.get(id(x))||x])).values()];
    if(!location.hash||location.hash==='#home')landing();
    else if(['#series','#trending'].includes(location.hash))route();
  }finally{catalogBusy=false}
}
refreshProviderCatalog();
setInterval(refreshProviderCatalog,300000);
document.addEventListener('visibilitychange',refreshProviderCatalog);



fetch('/api/discover?offset='+new Date().getTimezoneOffset()).then(r=>r.json()).then(data=>{
  if(!Array.isArray(data.shows))return;
  discovery=data;data.shows.forEach(remember);
  if(!location.hash||location.hash==='#home')landing();
}).catch(()=>{});

