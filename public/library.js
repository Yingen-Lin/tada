export function normalizeTags(tags) {
  const result=[];
  for(const tag of tags.map(t=>t.trim()).filter(Boolean))if(!result.some(t=>t.toLowerCase()===tag.toLowerCase()))result.push(tag);
  return result;
}
export function mergePhotos(existing,incoming) {
  const map=new Map(existing.map(p=>[p.id,p]));
  for(const p of incoming)map.set(p.id,{...p,tags:map.get(p.id)?.tags||[]});
  return [...map.values()];
}
export function getSourceViews(sources,collapsed=new Set()) {
  const roots=new Set(sources.map(s=>s.id)),seen=new Set();
  return sources.flatMap(s=>[s,...(collapsed.has(s.id)?[]:s.children||[]).filter(c=>!roots.has(c.id)).map(c=>({...c,child:true}))]).filter(s=>{
    if(seen.has(s.id))return false;
    seen.add(s.id);return true;
  });
}
