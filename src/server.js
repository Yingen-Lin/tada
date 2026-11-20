import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {FOLDER_MIME,FILE_FIELDS,fileId,indexFolder} from './drive.js';
import {workspaceService} from './workspaces.js';
import {openLibraryStore} from './storage.js';
import {hostedConfigured,hostedLibraryStore,hostedSessions} from './hosted-storage.js';

const root=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const sessions=hostedConfigured()?hostedSessions():new Map();
let libraryStore;
const storage=()=>{
  if(process.env.VERCEL&&!hostedConfigured())throw Object.assign(new Error('Configure the TADA database first.'),{status:503});
  return libraryStore||(libraryStore=hostedConfigured()?hostedLibraryStore():openLibraryStore(process.env.LIBRARY_DB_PATH||resolve('.local/tada.sqlite')));
};
const port=Number(process.env.PORT||4180);
const origin=process.env.APP_ORIGIN||(process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:null)||`http://127.0.0.1:${port}`;
const redirect=process.env.GOOGLE_REDIRECT_URI||`${origin}/auth/google/callback`;
const configured=!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&(!process.env.VERCEL||hostedConfigured()));
const secure=new URL(origin).protocol==='https:';
const random=()=>randomBytes(32).toString('base64url');
async function session(req,res,create=false) {
  const id=req.headers.cookie?.match(/(?:^|;\s*)tada_session=([\w-]+)/)?.[1];
  let value=await sessions.get(id);
  if(value&&value.expires<Date.now()){await sessions.delete(id);value=null}
  if(!value&&create){const key=random();value={expires:Date.now()+86400000,files:new Map()};Object.defineProperty(value,'key',{value:key});await sessions.set(key,value);res.setHeader('Set-Cookie',`tada_session=${key}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure?'; Secure':''}`)}
  if(value&&!value.key)Object.defineProperty(value,'key',{value:id});
  return value;
}
async function saveSession(value){if(value?.key)await sessions.set(value.key,value)}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function go(res,path){res.writeHead(303,{Location:path});res.end()}
async function body(req,maxBytes=16384){let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>maxBytes)throw new Error('Request too large.')}return JSON.parse(text||'{}')}
async function tokenRequest(params){const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Google sign-in expired or could not be completed. Connect again.');return response.json()}
async function access(s){if(!s?.tokens)throw Object.assign(new Error('Connect Google Drive first.'),{status:401});if(s.tokens.expires<Date.now()+60000){if(!s.tokens.refresh_token)throw Object.assign(new Error('Reconnect Google Drive to continue.'),{status:401});const next=await tokenRequest({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:s.tokens.refresh_token});s.tokens={...s.tokens,...next,expires:Date.now()+next.expires_in*1000};await saveSession(s)}return s.tokens.access_token}
async function google(s,path,params={}){const url=new URL(`https://www.googleapis.com/drive/v3/${path}`);url.search=new URLSearchParams(params);const response=await fetch(url,{headers:{Authorization:`Bearer ${await access(s)}`},signal:AbortSignal.timeout(30000)});if(!response.ok){const status=response.status;throw Object.assign(new Error(status===403?'Google Drive denied access. Check folder permissions and download restrictions.':status===404?'That folder or photo is unavailable. Check the link and your Google account.':'Google Drive request failed. Please try again.'),{status:[401,403,404].includes(status)?status:502})}return response.json()}
async function sendPhoto(s,res,id,kind,file){
  let target=`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
  if(kind==='thumbnail') {
    if(!file.thumbnailLink){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'private, no-store'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#eeedf2"/><text x="200" y="150" text-anchor="middle" fill="#85808c" font-family="sans-serif" font-size="14">Preview unavailable</text></svg>')}
    const thumb=new URL(file.thumbnailLink);if(thumb.protocol!=='https:'||!/(^|\.)(googleusercontent\.com|googleapis\.com|google\.com)$/.test(thumb.hostname))throw new Error('Invalid preview URL.');target=thumb.href;
  }else if(file.capabilities?.canDownload===false)return json(res,403,{error:'The owner has disabled downloads for this photo.'});
  const stream=await fetch(target,{headers:{Authorization:`Bearer ${await access(s)}`},signal:AbortSignal.timeout(120000)});
  if(!stream.ok)throw new Error('The photo could not be loaded. Refresh the source and try again.');
  res.setHeader('Content-Type',stream.headers.get('content-type')||'application/octet-stream');res.setHeader('Cache-Control','private, no-store');
  if(kind==='download')res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}`);
  res.writeHead(200);await pipeline(Readable.fromWeb(stream.body),res);return;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};

export async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url=new URL(req.url,origin),path=url.pathname;
    if(!['GET','HEAD','POST'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
    if(req.method==='POST'&&req.headers.origin!==origin)return json(res,403,{error:'This request must come from TADA.'});
    const s=await session(req,res);
    if(req.headers['x-tada-account']&&req.headers['x-tada-account']!==s?.accountId)return json(res,409,{error:'The signed-in account changed. Reload TADA to continue.'});
    if(path==='/api/library'||path==='/api/library/export') {
      await access(s);
      if(req.method==='GET'){
        const result=await storage().read(s.accountId);
        if(path.endsWith('/export'))res.setHeader('Content-Disposition','attachment; filename="tada-backup.json"');
        return json(res,200,path.endsWith('/export')?{schemaVersion:1,...result}:result);
      }
      if(path==='/api/library'&&req.method==='POST'){const input=await body(req,8*1024*1024);return json(res,200,await storage().write(s.accountId,input.revision,input.data))}
      return json(res,405,{error:'Method not allowed.'});
    }
    if(path==='/api/drive/status')return json(res,200,{configured,workspaceDemo:!configured&&process.env.VERCEL_ENV==='preview',storage:hostedConfigured()?'hosted':'local',connected:!!s?.tokens,email:s?.email||null,accountId:s?.accountId||null});
    if(path==='/auth/google') {
      if(!configured)return go(res,'/#settings/connections');
      const pending=await session(req,res,true);pending.oauth={state:random(),verifier:random(),expires:Date.now()+600000};
      const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid email https://www.googleapis.com/auth/drive.readonly',access_type:'offline',prompt:'consent select_account',state:pending.oauth.state,code_challenge:createHash('sha256').update(pending.oauth.verifier).digest('base64url'),code_challenge_method:'S256'});
      await saveSession(pending);return go(res,auth.href);
    }
    if(path==='/auth/google/callback') {
      const state=url.searchParams.get('state')||'',expected=s?.oauth?.state||'';
      if(!expected||s.oauth.expires<Date.now()||state.length!==expected.length||!timingSafeEqual(Buffer.from(state),Buffer.from(expected)))return json(res,400,{error:'Invalid or expired sign-in. Start again from Settings.'});
      const oauth=s.oauth;delete s.oauth;await saveSession(s);
      if(url.searchParams.has('error'))return go(res,'/?auth=cancelled#settings/connections');
      const tokens=await tokenRequest({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,grant_type:'authorization_code',code:url.searchParams.get('code')||'',redirect_uri:redirect,code_verifier:oauth.verifier});
      if(!tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/drive.readonly'))return json(res,403,{error:'Read-only Drive access is required to browse source folders.'});
      const info=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(15000)});if(!info.ok)throw new Error('Unable to verify your Google account.');const user=await info.json();
      if(user.email_verified!==true||typeof user.email!=='string'||typeof user.sub!=='string'||!user.sub)return json(res,403,{error:'This Google account is not allowed for this workspace.'});
      // Rotate the session after authentication. Tokens never leave the server.
      const old=req.headers.cookie?.match(/(?:^|;\s*)tada_session=([\w-]+)/)?.[1];if(old)await sessions.delete(old);
      const authenticated=await session({...req,headers:{}},res,true);authenticated.tokens={...tokens,expires:Date.now()+tokens.expires_in*1000};authenticated.email=user.email;authenticated.accountId=user.sub;await saveSession(authenticated);
      return go(res,'/#settings/connections');
    }
    if(path==='/api/drive/disconnect'&&req.method==='POST'){if(s){const id=req.headers.cookie?.match(/(?:^|;\s*)tada_session=([\w-]+)/)?.[1];await sessions.delete(id)}res.setHeader('Set-Cookie',`tada_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure?'; Secure':''}`);return json(res,200,{connected:false})}
    if(path === '/api/workspaces' || path.startsWith('/api/workspaces/')) {
      await access(s);
      if(!s.accountId || !s.email) return json(res,401,{error:'Sign in to TADA first.'});
      const service = workspaceService(storage(),s,(p,q) => google(s,p,q));
      if(path === '/api/workspaces') {
        if(req.method === 'GET') return json(res,200,await service.list());
        if(req.method === 'POST') return json(res,201,await service.create(await body(req)));
      }
      const match = path.match(/^\/api\/workspaces\/([a-f0-9-]{36})(?:\/files\/([\w-]+)\/(thumbnail|download))?$/);
      if(!match) return json(res,404,{error:'Workspace unavailable.'});
      const [,id,photoId,kind] = match;
      if(photoId && req.method === 'GET') {
        const photo = await service.photo(id,photoId);
        return await sendPhoto(s,res,photoId,kind,photo);
      }
      if(!photoId && req.method === 'GET') return json(res,200,await service.view(id));
      if(!photoId && req.method === 'POST') return json(res,200,await service.change(id,await body(req)));
      return json(res,405,{error:'Method not allowed.'});
    }
    if(path.startsWith('/api/drive/')) {
      await access(s);
      if(path==='/api/drive/folders'&&req.method==='GET') {
        const parent=url.searchParams.get('parent');const q=`mimeType = '${FOLDER_MIME}' and trashed = false${parent?` and '${fileId(parent)}' in parents`:''}`;
        return json(res,200,await google(s,'files',{q,fields:'nextPageToken,files(id,name)',orderBy:'name',pageSize:'100',includeItemsFromAllDrives:'true',supportsAllDrives:'true',...(url.searchParams.get('pageToken')?{pageToken:url.searchParams.get('pageToken')}:{})}));
      }
      if(path==='/api/drive/index'&&req.method==='POST') {
        if(s.indexing)return json(res,409,{error:'A folder is already loading. Please wait.'});
        const input=await body(req);s.indexing=true;
        try{const result=await indexFolder({rootId:input.folderId,recursive:input.recursive===true,get:(p,q)=>google(s,p,q)});result.files.forEach(f=>s.files.set(f.id,true));await saveSession(s);return json(res,200,{folder:result.folder,folders:result.folders,files:result.files.map(({thumbnailLink,...file})=>file),syncedAt:new Date().toISOString()})}finally{s.indexing=false}
      }
      const match=path.match(/^\/api\/drive\/files\/([\w-]+)\/(thumbnail|download)$/);
      if(match&&req.method==='GET') {
        const [,id,kind]=match;
        if(!s.files.has(id))return json(res,403,{error:'Refresh this source folder before opening its photos.'});
        const file=await google(s,`files/${id}`,{fields:FILE_FIELDS,supportsAllDrives:'true'});
        return await sendPhoto(s,res,id,kind,file);
      }
      return json(res,404,{error:'Unknown Drive endpoint.'});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed.'});
    const filename=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!filename.startsWith(root+sep))return json(res,403,{error:'Forbidden'});
    const data=await readFile(filename);res.writeHead(200,{'Content-Type':mime[extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){if(res.headersSent){res.destroy();return}json(res,error.status||400,{error:error.message||'Something went wrong.'})}
}
if(process.argv[1]===fileURLToPath(import.meta.url))http.createServer(handler).listen(port,'127.0.0.1',()=>console.log(`TADA: ${origin}`));
if(sessions instanceof Map)setInterval(()=>{for(const [id,s]of sessions)if(s.expires<Date.now())sessions.delete(id)},600000).unref();
