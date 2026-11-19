import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable,Readable} from 'node:stream';
import {handler} from '../src/server.js';
async function request(url,{method='GET',headers={},body=''}={}) {
 const req=Readable.from(body?[body]:[]);req.url=url;req.method=method;req.headers=headers;
 let output='';const res=new Writable({write(chunk,enc,done){output+=chunk.toString();done()}});res.headers={};res.statusCode=200;res.setHeader=(k,v)=>res.headers[k.toLowerCase()]=v;res.writeHead=(status,headers={})=>{res.statusCode=status;Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v))};
 await handler(req,res);return{status:res.statusCode,headers:res.headers,body:output};
}
test('serves the app with browser security headers',async()=>{const r=await request('/');assert.equal(r.status,200);assert.match(r.body,/TADA/);assert.equal(r.headers['x-frame-options'],'DENY');assert.match(r.headers['content-security-policy'],/frame-ancestors 'none'/)});
test('Drive access requires an authenticated session',async()=>{const r=await request('/api/drive/folders');assert.equal(r.status,401);assert.match(r.body,/Connect Google Drive/)});
test('mutations reject requests from another origin',async()=>{const r=await request('/api/drive/disconnect',{method:'POST',headers:{origin:'https://other.example'}});assert.equal(r.status,403)});
test('OAuth callback rejects missing state and does not create tokens',async()=>{const r=await request('/auth/google/callback?code=bad');assert.equal(r.status,400);assert.match(r.body,/Invalid or expired/)});
test('static files cannot escape the public directory',async()=>{const r=await request('/%2e%2e%2f.env');assert.equal(r.status,403);assert.doesNotMatch(r.body,/GOOGLE_CLIENT_SECRET/)});
test('disconnected status exposes no credentials',async()=>{const r=await request('/api/drive/status');assert.equal(r.status,200);const status=JSON.parse(r.body);assert.equal(status.connected,false);assert.ok(!('tokens'in status));assert.ok(!('clientSecret'in status))});
