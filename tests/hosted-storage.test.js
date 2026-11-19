import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sessionCodec,hostedSessions,hostedLibraryStore,redisClient} from '../src/hosted-storage.js';
test('hosted sessions survive store recreation and never save readable Google credentials',async()=>{
 const records=new Map();const command=async(op,key,value)=>{if(op==='SET'){records.set(key,value);return'OK'}if(op==='GET')return records.get(key)||null;if(op==='DEL')records.delete(key)};
 const key=randomBytes(32).toString('base64url'),first=hostedSessions(command,key);
 const session={indexing:true,expires:Date.now()+86400000,email:'owner@example.com',tokens:{access_token:'secret-access',refresh_token:'secret-refresh'},files:new Map([['photo',true]])};
 await first.set('unguessable-cookie',session);
 const saved=JSON.stringify([...records]);assert.doesNotMatch(saved,/secret-access|secret-refresh|unguessable-cookie|owner@example.com/);
 const restored=await hostedSessions(command,key).get('unguessable-cookie');assert.equal(restored.tokens.refresh_token,'secret-refresh');assert.equal(restored.files.has('photo'),true);assert.equal(restored.indexing,undefined);
 const codec=sessionCodec(key),sealed=codec.seal(session);assert.throws(()=>sessionCodec(randomBytes(32).toString('base64url')).open(sealed));
 await first.delete('unguessable-cookie');assert.equal(await first.get('unguessable-cookie'),undefined);
});
test('hosted library writes use one atomic revision check and isolate accounts',async()=>{
 const records=new Map();let scripts=0;
 const command=async(op,...args)=>{if(op==='GET')return records.get(args[0])||null;if(op==='EVAL'){scripts++;const[,count,key,expected,value]=args;assert.equal(count,1);const old=records.get(key);if((old?JSON.parse(old).revision:0)!==expected)return 0;records.set(key,value);return 1}};
 const a=hostedLibraryStore(command),b=hostedLibraryStore(command),data={photos:[{id:'one',filename:'one.jpg',tags:['Summer']}],collections:[{id:'post',name:'Post',ids:['one']}],sources:[]};
 await a.write('account-a',0,data);assert.equal((await b.read('account-a')).data.collections[0].name,'Post');assert.equal((await b.read('another@example.com')).data,null);
 await assert.rejects(b.write('account-a',0,data),e=>e.status===409);assert.equal(scripts,2);
});
test('database errors do not expose connection credentials',async()=>{
 const client=redisClient({KV_REST_API_URL:'https://database.example',KV_REST_API_TOKEN:'private-database-token'},async()=>Response.json({error:'private-database-token internal error'}));
 await assert.rejects(client('GET','x'),e=>e.status===503&&!e.message.includes('private-database-token'));
});
