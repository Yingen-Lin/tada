import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable,Writable} from 'node:stream';
process.env.LIBRARY_DB_PATH=':memory:';process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';
const {handler}=await import('../src/server.js');
async function request(url,headers={},method='GET',payload=''){const req=Readable.from(payload?[payload]:[]);req.url=url;req.method=method;req.headers=headers;let body='';const res=new Writable({write(part,enc,done){body+=part;done()}});res.headers={};res.setHeader=(k,v)=>res.headers[k.toLowerCase()]=v;res.writeHead=(s,h={})=>{res.statusCode=s;Object.entries(h).forEach(([k,v])=>res.setHeader(k,v))};await handler(req,res);return{status:res.statusCode,headers:res.headers,body}}
test('OAuth binds state and PKCE to a cookie, rotates the session, and keeps tokens server-side',async()=>{
 const original=globalThis.fetch;
 const start=await request('/auth/google');assert.equal(start.status,303);
 const auth=new URL(start.headers.location);assert.equal(auth.hostname,'accounts.google.com');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.match(auth.searchParams.get('scope'),/drive.readonly/);
 const cookie=start.headers['set-cookie'].split(';')[0];assert.match(start.headers['set-cookie'],/HttpOnly; SameSite=Lax/);
 let exchanges=0;
 globalThis.fetch=async(url,options)=>{if(String(url).includes('/token')){exchanges++;assert.ok(new URLSearchParams(options.body).get('code_verifier'));return Response.json({access_token:'private-test-token',refresh_token:'private-refresh',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/drive.readonly'})}return Response.json({sub:'account-a',email:'owner@example.com',email_verified:true})};
 try{
  const rejected=await request('/auth/google/callback?code=test&state=wrong',{cookie});assert.equal(rejected.status,400);assert.equal(exchanges,0);
  const callback=`/auth/google/callback?code=test&state=${auth.searchParams.get('state')}`;
  const accepted=await request(callback,{cookie});assert.equal(accepted.status,303);const next=accepted.headers['set-cookie'].split(';')[0];assert.notEqual(next,cookie);assert.doesNotMatch(JSON.stringify(accepted),/private-test-token|private-refresh/);
  const status=await request('/api/drive/status',{cookie:next});assert.equal(JSON.parse(status.body).connected,true);assert.doesNotMatch(status.body,/private-test-token|private-refresh/);
  const replay=await request(callback,{cookie});assert.equal(replay.status,400);assert.equal(exchanges,1);
  const unindexed=await request('/api/drive/files/some_private_file/download',{cookie:next});assert.equal(unindexed.status,403);
  const library={photos:[{id:'drive-a',filename:'one.jpg',tags:['Saved']}],collections:[{id:'post',name:'A post',ids:['drive-a']}],sources:[],collapsedSources:[]};
  const saved=await request('/api/library',{cookie:next,origin:'http://127.0.0.1:4180'},'POST',JSON.stringify({revision:0,data:library}));assert.equal(saved.status,200);
  const data=await request('/api/library',{cookie:next});assert.deepEqual(JSON.parse(data.body).data,library);
  const stale=await request('/api/library',{cookie:next,origin:'http://127.0.0.1:4180'},'POST',JSON.stringify({revision:0,data:library}));assert.equal(stale.status,409);
  const noLogin=await request('/api/library');assert.equal(noLogin.status,401);
  const backup=await request('/api/library/export',{cookie:next});assert.match(backup.headers['content-disposition'],/attachment/);assert.doesNotMatch(backup.body,/private-test-token|private-refresh/);
  const secondStart=await request('/auth/google');const secondAuth=new URL(secondStart.headers.location),secondCookie=secondStart.headers['set-cookie'].split(';')[0];
  const secondCallback=await request(`/auth/google/callback?code=test&state=${secondAuth.searchParams.get('state')}`,{cookie:secondCookie});const freshCookie=secondCallback.headers['set-cookie'].split(';')[0];
  const restored=await request('/api/library',{cookie:freshCookie});assert.deepEqual(JSON.parse(restored.body).data,library);

 }finally{globalThis.fetch=original}
});

test('two Google accounts can refresh and restore private libraries independently',async()=>{
 const original=globalThis.fetch;
 const origin='http://127.0.0.1:4180';
 const folder=account=>`private-folder-${account}`;
 const photo=account=>`private-photo-${account}`;
 let added=false;
 globalThis.fetch=async(resource,options)=>{
  const url=new URL(resource);
  if(url.hostname==='oauth2.googleapis.com'){
   const code=new URLSearchParams(options.body).get('code');
   return Response.json({access_token:code,expires_in:3600,scope:'openid email https://www.googleapis.com/auth/drive.readonly'});
  }
  const account=options.headers.Authorization.slice('Bearer '.length);
  if(url.hostname==='openidconnect.googleapis.com')return Response.json({sub:account,email:`${account}@example.com`,email_verified:true});
  const pathname=url.pathname;
  const file=id=>({id,name:`${id}.jpg`,mimeType:'image/jpeg',thumbnailLink:`https://lh3.googleusercontent.com/${id}`});
  if(url.hostname==='lh3.googleusercontent.com')return new Response('photo bytes',{headers:{'Content-Type':'image/jpeg'}});
  if(pathname.endsWith('/'+folder(account)))return Response.json({id:folder(account),name:folder(account),mimeType:'application/vnd.google-apps.folder'});
  if(pathname.endsWith('/'+photo(account)))return Response.json(file(photo(account)));
  if(pathname.endsWith('/files')&&url.searchParams.get('q').includes(folder(account)))return Response.json({files:[file(photo(account)),...(account==='alpha'&&added?[file('new-photo-alpha')]:[])]});
  return new Response(null,{status:404});
 };
 async function login(account){
  const start=await request('/auth/google');
  const auth=new URL(start.headers.location);
  assert.equal(auth.searchParams.has('login_hint'),false);
  const pending=start.headers['set-cookie'].split(';')[0];
  const callback=await request(`/auth/google/callback?code=${account}&state=${auth.searchParams.get('state')}`,{cookie:pending});
  assert.equal(callback.status,303);
  return callback.headers['set-cookie'].split(';')[0];
 }
 const index=(cookie,account)=>request('/api/drive/index',{cookie,origin},'POST',JSON.stringify({folderId:folder(account)}));
 const read=async cookie=>JSON.parse((await request('/api/library',{cookie})).body);
 try{
  const alpha=await login('alpha'), beta=await login('beta');
  for(const [account,cookie] of [['alpha',alpha],['beta',beta]]){
   assert.equal((await read(cookie)).data,null);
   const indexed=await index(cookie,account);
   assert.equal(indexed.status,200);
   const {files}=JSON.parse(indexed.body);
   assert.deepEqual(files.map(f=>f.id),[photo(account)]);
   const preview=await request(`/api/drive/files/${photo(account)}/thumbnail`,{cookie});
   assert.equal(preview.status,200);
   assert.equal(preview.body,'photo bytes');
   const data={photos:[{id:photo(account),filename:files[0].name,tags:[`tag-${account}`]}],collections:[{id:'post',name:`collection-${account}`,ids:[photo(account)]}],sources:[{id:folder(account),name:folder(account),ids:[photo(account)]}],collapsedSources:[]};
   const save=await request('/api/library',{cookie,origin,'x-tada-account':account},'POST',JSON.stringify({revision:0,data}));
   assert.equal(save.status,200);
   assert.deepEqual((await read(await login(account))).data,data);
  }
  assert.equal((await index(beta,'alpha')).status,404);
  assert.equal((await request(`/api/drive/files/${photo('alpha')}/thumbnail`,{cookie:beta})).status,403);
  const staleTab=await request('/api/library',{cookie:beta,origin,'x-tada-account':'alpha'},'POST','{}');
  assert.equal(staleTab.status,409);
  added=true;
  assert.equal(JSON.parse((await index(alpha,'alpha')).body).files.length,2);
  assert.equal(JSON.parse((await index(beta,'beta')).body).files.length,1);
 }finally{globalThis.fetch=original}
});
