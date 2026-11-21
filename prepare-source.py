"""Materialize and configure the original Sites project for Cloudflare Workers."""
from pathlib import Path
import zipfile
archive=Path('SETAL-Cinema-source.zip')
if archive.exists():
    with zipfile.ZipFile(archive) as src:
        src.extractall('.')
app=Path('dist/client/app.js')
code=app.read_text()
a=code.find("request('trending',{page:1,perPage:40}).then")
if a>=0:
    b=code.index('\n',a)
    code=code[:a]+"""let catalogBusy=false,lastCatalogCheck=0;
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
document.addEventListener('visibilitychange',refreshProviderCatalog);"""+code[b:]
code=code.replace('/signin-with-chatgpt?return_to=%2F%23profile','/account/login').replace('Sign up or log in with ChatGPT','Sign in').replace('/signout-with-chatgpt?return_to=%2F','/cdn-cgi/access/logout')
app.write_text(code)
Path('schema.sql').write_text('\n'.join(p.read_text().replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ') for p in sorted(Path('drizzle').glob('*.sql'))))
