import sharp from 'sharp';
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

test('team workspaces share edits without granting Drive access or changing personal libraries',async()=>{
 const original=globalThis.fetch;
 const origin='http://127.0.0.1:4180';
 const folderA='shared-folder-a';
 const folderB='shared-folder-b';
 const childFolder='shared-folder-child';
 const photoA='shared-photo-aa';
 const photoB='shared-photo-bb';
 const newPhoto='shared-photo-cc';
 const largePhoto='shared-photo-large';
 const largeFixture=await sharp({create:{width:1200,height:600,channels:3,background:'#778899'}}).jpeg().toBuffer();
 const folderMime='application/vnd.google-apps.folder';
 const driveAccess={
  owner:new Set([folderA,folderB]),
  editor:new Set([folderA,folderB]),
  viewer:new Set([folderA]),
  outsider:new Set([folderA,folderB])
 };
 let refreshed=false;
 const image=(id,parent)=>({
  id,name:id+'.jpg',parents:[parent],mimeType:'image/jpeg',
  ...(id===photoA ? {thumbnailLink:'https://lh3.googleusercontent.com/'+id} : {}),
  size:id===largePhoto?'8000000':'100',capabilities:{canDownload:[photoB,largePhoto].includes(id)}
 });
 globalThis.fetch=async(resource,options)=>{
  const url=new URL(resource);
  if(url.hostname==='oauth2.googleapis.com'){
   const code=new URLSearchParams(options.body).get('code');
   return Response.json({access_token:code,expires_in:3600,scope:'openid email https://www.googleapis.com/auth/drive.readonly'});
  }
  const account=options.headers.Authorization.slice('Bearer '.length);
  if(url.hostname==='openidconnect.googleapis.com')return Response.json({sub:'team-'+account,email:account+'@example.com',email_verified:true});
  if(url.hostname==='lh3.googleusercontent.com')return new Response('team photo',{headers:{'Content-Type':'image/jpeg'}});
  const id=url.pathname.split('/').at(-1);
  const allowed=driveAccess[account];
  if([folderA,folderB].includes(id)&&allowed.has(id))return Response.json({id,name:id,mimeType:folderMime});
  if(id===childFolder&&allowed.has(folderA))return Response.json({id,name:'Nested',mimeType:folderMime,parents:[folderA]});
  const files=[image(photoA,folderA),image(photoB,folderB),...(refreshed?[image(newPhoto,folderA),image(largePhoto,childFolder)]:[])];
  if(id==='files'){
   const parent=url.searchParams.get('q').match(/^'([^']+)' in parents/)?.[1];
   if(allowed.has(parent)||parent===childFolder&&allowed.has(folderA)){
    const found=files.filter(file=>file.parents[0]===parent);
    if(parent===folderA)found.push({id:childFolder,name:'Nested',mimeType:folderMime});
    return Response.json({files:found});
   }
  }
  const file=files.find(item=>item.id===id&&(allowed.has(item.parents[0])||item.parents[0]===childFolder&&allowed.has(folderA)));
  if(file&&url.searchParams.get('alt')==='media'){
   assert.equal(file.capabilities.canDownload,true);
   return new Response(id===largePhoto?largeFixture:'original photo',{headers:{'Content-Type':'image/jpeg'}});
  }
  if(file&&account==='viewer'&&id===photoA){
   const {parents,...withoutParents}=file;
   return Response.json(withoutParents);
  }
  return file ? Response.json(file) : new Response(null,{status:404});
 };

 const requestJson=async(path,cookie,payload)=>{
  const response=await request(path,{cookie,origin},payload?'POST':'GET',payload&&JSON.stringify(payload));
  return {status:response.status,data:JSON.parse(response.body)};
 };
 async function login(account){
  const start=await request('/auth/google');
  const state=new URL(start.headers.location).searchParams.get('state');
  const pending=start.headers['set-cookie'].split(';')[0];
  const callback=await request(`/auth/google/callback?code=${account}&state=${state}`,{cookie:pending});
  assert.equal(callback.status,303);
  return callback.headers['set-cookie'].split(';')[0];
 }
 try{
  const owner=await login('owner'),editor=await login('editor');
  const viewer=await login('viewer'),outsider=await login('outsider');
  assert.equal((await request('/api/workspaces')).status,401);
  const created=await requestJson('/api/workspaces',owner,{name:'Marketing'});
  assert.equal(created.status,201);
  const path='/api/workspaces/'+created.data.id;
  const apply=(cookie,payload)=>requestJson(path,cookie,payload);
  const view=cookie=>requestJson(path,cookie);
  assert.equal((await view(outsider)).status,404);
  assert.deepEqual((await requestJson('/api/workspaces',outsider)).data,[]);
  for(const [email,role] of [['EDITOR@example.com','editor'],['viewer@example.com','viewer']]){
   assert.equal((await apply(owner,{action:'set-member',email,role})).status,200);
  }
  assert.equal((await requestJson('/api/workspaces',editor)).data[0].role,'editor');
  assert.equal((await apply(editor,{action:'add-source',folderId:folderA})).status,403);
  for(const folderId of [folderA,folderB]){
   assert.equal((await apply(owner,{action:'add-source',folderId,recursive:folderId===folderA})).status,200);
  }
  assert.equal((await apply(editor,{action:'create-collection',name:'November'})).status,200);
  const collectionId=(await view(owner)).data.collections[0].id;
  const results=await Promise.all([
   apply(owner,{action:'edit-photo',photoId:photoA,tag:'Social',tagOperation:'add'}),
   apply(editor,{action:'edit-photo',photoId:photoA,collectionId,collectionOperation:'add'}),
   apply(editor,{action:'edit-photo',photoId:photoA,tag:'Selected',tagOperation:'add'})
  ]);
  assert.deepEqual(results.map(result=>result.status),[200,200,200]);
  assert.equal((await apply(owner,{action:'edit-photo',photoId:photoB,tag:'Restricted',tagOperation:'add',collectionId,collectionOperation:'add'})).status,200);
  const restored=(await view(await login('editor'))).data;
  assert.deepEqual(new Set(restored.photos.find(photo=>photo.id===photoA).tags),new Set(['Social','Selected']));
  assert.deepEqual(new Set(restored.collections[0].ids),new Set([photoA,photoB]));
  const restricted=(await view(viewer)).data;
  assert.equal(restricted.unavailableSources,1);
  assert.deepEqual(restricted.collections[0].ids,[photoA]);
  assert.doesNotMatch(JSON.stringify(restricted),/Restricted|shared-photo-bb|shared-folder-b/);
  assert.equal((await apply(viewer,{action:'edit-photo',photoId:photoA,tag:'Blocked',tagOperation:'add'})).status,403);
  assert.equal((await request(path+'/files/'+photoB+'/thumbnail',{cookie:viewer})).status,404);
  const preview=await request(path+'/files/'+photoA+'/thumbnail',{cookie:viewer});
  assert.equal(preview.status,200);assert.equal(preview.body,'team photo');
  const fallback=await request(path+'/files/'+photoB+'/thumbnail',{cookie:editor});
  assert.equal(fallback.status,200);assert.equal(fallback.body,'original photo');
  assert.equal((await request(path+'/files/'+photoA+'/thumbnail',{cookie:outsider})).status,404);
  assert.equal((await requestJson('/api/library',owner)).data.data,null);
  refreshed=true;
  const restrictedPreview=await request(path+'/files/'+newPhoto+'/thumbnail',{cookie:viewer});
  assert.match(restrictedPreview.body,/Preview unavailable/);
  const resized=await request(path+'/files/'+largePhoto+'/thumbnail',{cookie:viewer});
  assert.equal(resized.status,200);
  assert.equal(resized.headers['content-type'],'image/jpeg');
  const team=(await view(editor)).data;
  assert.ok(team.photos.some(photo=>photo.id===newPhoto));
  assert.deepEqual(team.sources.find(source=>source.id===folderA).children.map(({name,ids})=>({name,ids})),[{name:'Nested',ids:[largePhoto]}]);
  assert.equal(team.photos.find(photo=>photo.id===largePhoto).sourceFolderId,childFolder);
  driveAccess.editor.delete(folderA);
  assert.equal((await apply(editor,{action:'edit-photo',photoId:photoA,tag:'Blocked',tagOperation:'add'})).status,404);
  assert.equal((await apply(owner,{action:'set-member',email:'viewer@example.com',role:'remove'})).status,200);
  assert.equal((await view(viewer)).status,404);
  assert.deepEqual((await requestJson('/api/workspaces',viewer)).data,[]);
  const rename={action:'rename-workspace',name:'Studio'};
  const archive={action:'archive-workspace'};
  const restore={action:'restore-workspace'};
  assert.equal((await apply(editor,rename)).status,403);
  assert.equal((await apply(editor,archive)).status,403);
  assert.equal((await apply(owner,rename)).status,200);
  assert.equal((await view(editor)).data.name,'Studio');
  const beforeArchive=(await view(owner)).data;
  assert.equal((await apply(owner,archive)).status,200);
  assert.equal((await view(owner)).status,404);
  assert.equal((await view(editor)).status,404);
  assert.equal((await request(path+'/files/'+photoB+'/thumbnail',{cookie:editor})).status,404);
  assert.deepEqual((await requestJson('/api/workspaces',editor)).data,[]);
  assert.deepEqual((await requestJson('/api/workspaces',owner)).data,[{id:created.data.id,name:'Studio',role:'admin',archived:true}]);
  assert.equal((await apply(editor,restore)).status,404);
  assert.equal((await apply(owner,restore)).status,200);
  assert.deepEqual((await view(owner)).data,beforeArchive);
  assert.equal((await view(editor)).status,200);
 }finally{globalThis.fetch=original}
});
