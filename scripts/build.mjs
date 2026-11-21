import fs from 'node:fs';
const client='dist/client/';
const pages={};
for(const [name,type] of Object.entries({'index.html':'text/html','app.js':'text/javascript','sports.js':'text/javascript','style.css':'text/css','catalog.json':'application/json'})){
  pages['/'+name]={type,body:fs.readFileSync(client+name,'utf8')};
}
const leagueMap=fs.readFileSync('sports/leagues.json','utf8');
const sportsSnapshot=fs.readFileSync('sports/snapshot.json','utf8');
const archivedReport=fs.readFileSync('sports/archive.json','utf8');
pages['/sports/leagues.json']={type:'application/json',body:leagueMap};
pages['/sports/snapshot.json']={type:'application/json',body:sportsSnapshot};
const images={};
for(const list of Object.values(JSON.parse(pages['/catalog.json'].body))){
  for(const title of list){
    if(title.poster && title.cover?.url)images['/'+title.poster]=title.cover.url;
    const backdrop=title.stills?.url || title.trailer?.cover?.url;
    if(title.back && backdrop)images['/'+title.back]=backdrop;
  }
}
fs.mkdirSync('dist/server',{recursive:true});
fs.mkdirSync('dist/.openai',{recursive:true});
fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
fs.writeFileSync('dist/server/index.js','const pages='+JSON.stringify(pages)+';\nconst images='+JSON.stringify(images)+';\n'+'const leagueMap='+leagueMap+'; const sportsSnapshot='+sportsSnapshot+'; const archivedReport='+archivedReport+';\n'+fs.readFileSync('worker/fixtures.js','utf8')+'\n'+fs.readFileSync('worker/handler.js','utf8'));

fs.mkdirSync(client+'sports',{recursive:true});
for(const name of ['leagues','snapshot'])fs.copyFileSync('sports/'+name+'.json',client+'sports/'+name+'.json');
