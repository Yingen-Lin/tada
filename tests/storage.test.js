import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLibraryStore} from '../src/storage.js';
const sample=()=>({photos:[{id:'drive-a',filename:'photo.jpg',tags:['Favorites']}],collections:[{id:'post',name:'First post',ids:['drive-a']}],sources:[{id:'source',name:'Photos',ids:['drive-a']}],collapsedSources:['source']});
test('database survives reopen independently of browser storage and isolates accounts',()=>{
 const directory=mkdtempSync(join(tmpdir(),'studio-storage-'));const file=join(directory,'library.sqlite');let store=openLibraryStore(file);
 try{assert.equal(store.read('account-a').data,null);assert.equal(store.write('account-a',0,sample()).revision,1);store.close();store=openLibraryStore(file);assert.deepEqual(store.read('account-a').data,sample());assert.equal(store.read('other@example.com').data,null)}finally{store.close();rmSync(directory,{recursive:true,force:true})}
});
test('stale tabs cannot overwrite newer collections or tags',()=>{const store=openLibraryStore(':memory:');try{store.write('owner',0,sample());const updated=sample();updated.photos[0].tags.push('New');store.write('owner',1,updated);assert.throws(()=>store.write('owner',1,sample()),e=>e.status===409);assert.deepEqual(store.read('owner').data.photos[0].tags,['Favorites','New'])}finally{store.close()}});
test('invalid data and credentials are rejected without changing the saved library',()=>{const store=openLibraryStore(':memory:');try{store.write('owner',0,sample());const invalid=sample();invalid.photos[0].tags='broken';assert.throws(()=>store.write('owner',1,invalid));const secret=sample();secret.sources[0].tokens={access_token:'test'};assert.throws(()=>store.write('owner',1,secret),/Credentials/);assert.equal(store.read('owner').revision,1)}finally{store.close()}});
