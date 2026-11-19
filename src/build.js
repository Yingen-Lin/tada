import {cp,mkdir,rm} from 'node:fs/promises';
const output=new URL('../dist/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(new URL('../public/',import.meta.url),new URL('public/',output),{recursive:true});
await cp(new URL('./',import.meta.url),new URL('src/',output),{recursive:true});
console.log('Validated and packaged public/ and src/ in dist/. Run with Node; do not use static hosting for Google OAuth.');
