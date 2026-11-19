export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink,capabilities(canDownload),imageMediaMetadata(width,height)';
export function fileId(value) {
  if (typeof value !== 'string') throw new Error('Enter a Google Drive folder link or ID.');
  let id = value.trim();
  if (id.startsWith('https://')) {
    const url = new URL(id);
    if (url.hostname !== 'drive.google.com') throw new Error('Use a drive.google.com folder link.');
    id = url.pathname.match(/\/folders\/([\w-]+)/)?.[1] || '';
  }
  if (!/^[\w-]{10,200}$/.test(id)) throw new Error('Invalid Google Drive folder ID.');
  return id;
}
export function parentQuery(id) { return `'${fileId(id)}' in parents and trashed = false`; }
export function mergePhotos(existing, incoming) {
  const map = new Map(existing.map(p => [p.id, p]));
  for (const p of incoming) map.set(p.id, {...p, tags: map.get(p.id)?.tags || []});
  return [...map.values()];
}
export async function indexFolder({rootId, recursive, get, maxFiles=10000, maxFolders=500}) {
  const root = await get(`files/${fileId(rootId)}`, {fields:'id,name,mimeType',supportsAllDrives:'true'});
  if (root.mimeType !== FOLDER_MIME) throw new Error('Choose a folder, not a file.');
  const pending=[{id:root.id,name:root.name,path:root.name}], visited=new Set(), files=new Map(), folders=[];
  while(pending.length) {
    const folder=pending.shift(); if(visited.has(folder.id))continue;
    visited.add(folder.id);
    folders.push(folder);
    if(visited.size>maxFolders)throw new Error('This source has too many subfolders. Add a smaller folder.');
    let token;
    do {
      const page=await get('files',{q:parentQuery(folder.id),fields:`nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,pageSize:'1000',includeItemsFromAllDrives:'true',supportsAllDrives:'true',...(token?{pageToken:token}:{})});
      if(page.incompleteSearch)throw new Error('Google returned an incomplete search. Choose a smaller folder and try again.');
      for(const file of page.files||[]) {
        if(file.mimeType===FOLDER_MIME&&recursive)pending.push({id:file.id,name:file.name,path:`${folder.path} / ${file.name}`});
        if(file.mimeType?.startsWith('image/'))files.set(file.id,{...file,sourcePath:folder.path,sourceFolderId:folder.id});
        if(files.size>maxFiles)throw new Error('This source exceeds 10,000 photos. Add smaller folders.');
      }
      token=page.nextPageToken;
    } while(token);
  }
  return {folder:root,folders,files:[...files.values()]};
}
