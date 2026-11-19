import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {validateLibrary} from './storage.js';

export function redisClient(env=process.env,request=fetch){
 const url=env.KV_REST_API_URL||env.UPSTASH_REDIS_REST_URL;
 const token=env.KV_REST_API_TOKEN||env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)throw new Error('Hosted database is not configured.');
 return async(...command)=>{
  const response=await request(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Object.assign(new Error('The database is temporarily unavailable. Please try again.'),{status:503});
  const output=await response.json();if(output.error)throw Object.assign(new Error('The database could not complete this request.'),{status:503});return output.result;
 };
}
export const hostedConfigured=()=>!!(process.env.KV_REST_API_URL||process.env.UPSTASH_REDIS_REST_URL);
const accountKey=accountId=>'tada:library:'+createHash('sha256').update(accountId).digest('hex');
const empty=()=>({revision:0,data:null,updatedAt:null});
const writeScript=`local current = redis.call('GET', KEYS[1]); local revision = 0; if current then revision = cjson.decode(current).revision end; if revision ~= tonumber(ARGV[1]) then return 0 end; redis.call('SET', KEYS[1], ARGV[2]); return 1`;
export function hostedLibraryStore(command=redisClient()){
 return {
  async read(accountId){const data=await command('GET',accountKey(accountId));return data?JSON.parse(data):empty()},
  async write(accountId,expectedRevision,value){
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Object.assign(new Error('Invalid library revision.'),{status:400});
   const data=validateLibrary(value),revision=expectedRevision+1,updatedAt=new Date().toISOString();
   const result=await command('EVAL',writeScript,1,accountKey(accountId),expectedRevision,JSON.stringify({revision,data,updatedAt}));
   if(!result)throw Object.assign(new Error('This library was changed in another tab. Reload from the database before saving again.'),{status:409});
   return{revision,updatedAt};
  }
 };
}
export function sessionCodec(secret){
 const key=Buffer.from(secret||'','base64url');if(key.length!==32)throw new Error('A 32-byte session encryption key is required.');
 return {
  seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const {indexing,...persistent}=value;const payload=JSON.stringify({...persistent,files:[...value.files.keys()]});const encrypted=Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url')},
  open(value){const input=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',key,input.subarray(0,12));decipher.setAuthTag(input.subarray(12,28));const data=JSON.parse(Buffer.concat([decipher.update(input.subarray(28)),decipher.final()]).toString());delete data.indexing;data.files=new Map((data.files||[]).map(id=>[id,true]));return data}
 };
}
export function hostedSessions(command=redisClient(),secret=process.env.SESSION_ENCRYPTION_KEY){
 const codec=sessionCodec(secret),key=id=>'tada:session:'+createHash('sha256').update(id).digest('hex');
 return {
  async get(id){if(!id)return;const data=await command('GET',key(id));return data?codec.open(data):undefined},
  async set(id,value){await command('SET',key(id),codec.seal(value),'EX',Math.max(1,Math.ceil((value.expires-Date.now())/1000)))},
  async delete(id){if(id)await command('DEL',key(id))}
 };
}
