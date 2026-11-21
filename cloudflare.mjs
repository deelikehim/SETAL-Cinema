import app from './dist/server/index.js';
import {createRemoteJWKSet, jwtVerify} from 'jose';
import schema from './schema.sql';
let schemaReady, jwks, issuer;
async function identity(request,env){
  const token=request.headers.get('Cf-Access-Jwt-Assertion') || /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie')||'')?.[1];
  if(!token||!env.TEAM_DOMAIN||!env.POLICY_AUD)return null;
  try{
    const domain=new URL(env.TEAM_DOMAIN).origin;
    if(issuer!==domain){jwks=createRemoteJWKSet(new URL('/cdn-cgi/access/certs',domain));issuer=domain}
    const {payload}=await jwtVerify(token,jwks,{issuer:domain,audience:env.POLICY_AUD,algorithms:['RS256']});
    return typeof payload.sub==='string' && typeof payload.email==='string'?payload:null;
  }catch{return null}
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/account/login'){
      if(!await identity(request,env))return new Response('Account sign-in requires Cloudflare Access. You can still browse and play titles.',{status:401});
      return Response.redirect(url.origin+'/#profile',302);
    }
    if(['/api/library','/api/discover'].includes(url.pathname)){
      if(!schemaReady)schemaReady=env.DB.batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>env.DB.prepare(s))).catch(e=>{schemaReady=null;throw e});
      await schemaReady;
    }
    if(url.pathname==='/api/library'){
      const user=await identity(request,env);
      const headers=new Headers(request.headers);
      headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');
      if(user){headers.set('oai-authenticated-user-id',user.sub);headers.set('oai-authenticated-user-email',user.email)}
      request=new Request(request,{headers});
    }
    return app.fetch(request,env);
  }
};
