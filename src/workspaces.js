import {randomUUID} from 'node:crypto';
import {FILE_FIELDS,FOLDER_MIME,fileId,indexFolder} from './drive.js';

const workspaceKey = id => 'workspace:' + id;
const membershipKey = email => 'workspace-index:' + email;
const fail = (status,message) => Object.assign(new Error(message),{status});
const absent = () => fail(404,'Workspace unavailable.');
const driveDenied = error => [403,404].includes(error.status);
const sameName = (a,b) => a.toLowerCase() === b.toLowerCase();
const validateInternalRecord = data => data;
const text = (value,limit,label) => {
  if(typeof value !== 'string' || !value.trim() || value.trim().length > limit) {
    throw fail(400,`Enter a ${label} up to ${limit} characters.`);
  }
  return value.trim();
};

function roleFor(workspace,user) {
  if(workspace?.owner.accountId === user.accountId) return 'admin';
  return workspace?.members.find(member => member.email === user.email)?.role;
}

function requireRole(workspace,user,allowed) {
  const role = roleFor(workspace,user);
  if(!role) throw absent();
  if(allowed && !allowed.includes(role)) throw fail(403,'Your workspace role cannot make this change.');
  return role;
}

// Retry against the latest record so disjoint edits survive concurrent saves.
async function update(store,key,change) {
  for(let attempt=0;attempt<8;attempt++) {
    const {data,revision} = await store.read(key);
    const next = change(data);
    if(next === undefined) return data;
    try {
      await store.write(key,revision,next,validateInternalRecord);
      return next;
    } catch(error) {
      if(error.status !== 409) throw error;
    }
  }
  throw fail(409,'The workspace is busy. Please try again.');
}

async function addToIndex(store,email,id) {
  await update(store,membershipKey(email),data => {
    const ids = data?.ids || [];
    if(ids.includes(id)) return;
    if(ids.length >= 100) throw fail(409,'This account has reached the workspace limit.');
    return {ids:[...ids,id]};
  });
}

async function removeFromIndex(store,email,id) {
  await update(store,membershipKey(email),data => {
    if(data?.ids.includes(id)) return {ids:data.ids.filter(value => value !== id)};
  });
}

const folderMetadata = (get,id) => get(`files/${id}`,{
  fields:'id,name,mimeType,trashed,parents',
  supportsAllDrives:'true'
});

async function visibleSources(workspace,get) {
  const sources = [];
  for(const binding of workspace.sources) {
    try {
      const result = await indexFolder({rootId:binding.id,recursive:binding.recursive,get});
      sources.push({binding,name:result.folder.name,files:result.files});
    } catch(error) {
      if(!driveDenied(error)) throw error;
    }
  }
  return sources;
}

// Verify the current user's access to the file and its route to a bound
// folder. A Drive ID alone conveys no workspace or Drive permission.
const pendingProofScans = new Map();

function sharedProofScan(workspace,user,get) {
  const key = JSON.stringify([workspace.id,user.accountId,workspace.sources]);
  let pending = pendingProofScans.get(key);
  if(!pending) {
    pending = visibleSources(workspace,get).finally(() => pendingProofScans.delete(key));
    pendingProofScans.set(key,pending);
  }
  return pending;
}

async function authorizedPhoto(workspace,user,get,id) {
  id = fileId(id);
  try {
    const photo = await get(`files/${id}`,{
      fields:`${FILE_FIELDS},parents,trashed`,
      supportsAllDrives:'true'
    });
    if(photo.trashed || !photo.mimeType?.startsWith('image/')) throw absent();
    const parents = (photo.parents || []).map(parent => ({id:parent,direct:true}));
    const visited = new Set();
    const matches = [];
    while(parents.length && visited.size < 64) {
      const parent = parents.shift();
      if(visited.has(parent.id)) continue;
      visited.add(parent.id);
      try {
        const folder = await folderMetadata(get,parent.id);
        if(folder.trashed || folder.mimeType !== FOLDER_MIME) continue;
        if(workspace.sources.some(source => source.id === folder.id && (source.recursive || parent.direct))) {
          matches.push({id:folder.id,direct:parent.direct});
        }
        if(workspace.sources.some(source => source.recursive)) {
          parents.push(...(folder.parents || []).map(id => ({id,direct:false})));
        }
      } catch(error) {
        if(!driveDenied(error)) throw error;
      }
    }
    if(matches.length) return {photo,matches};
  } catch(error) {
    if(!driveDenied(error)) throw error;
  }
  // A shared item can appear in an authorized listing even when Drive omits
  // parents or rejects a direct lookup. Verify membership via the same listing
  // used by the gallery and use Drive's metadata from that listing.
  let photo;
  const matches = [];
  for(const {binding,files} of await sharedProofScan(workspace,user,get)){
    const found=files.find(file => file.id===id);
    if(found){
      photo ||= found;
      matches.push({id:binding.id,direct:found.sourceFolderId===binding.id});
    }
  }
  if(photo)return {photo,matches};
  throw fail(404,'This photo is unavailable in the workspace.');
}

function teamView(workspace,user,indexed) {
  const role = requireRole(workspace,user);
  const photoMap = new Map();
  const sources = indexed.filter(({binding}) => workspace.sources.some(
    source => source.id === binding.id && source.recursive === binding.recursive
  )).map(({binding,name,files}) => {
    for(const file of files) {
      const tags = Object.hasOwn(workspace.tags,file.id) ? workspace.tags[file.id] : [];
      photoMap.set(file.id,{id:file.id,name:file.name,modifiedTime:file.modifiedTime,tags});
    }
    return {id:binding.id,name,recursive:binding.recursive,ids:files.map(file => file.id)};
  });
  return {
    id:workspace.id,name:workspace.name,role,
    ...(role === 'admin' ? {members:workspace.members,ownerEmail:workspace.owner.email} : {}),
    sources,
    unavailableSources:missingSources(workspace,sources,role),
    photos:[...photoMap.values()],
    collections:workspace.collections.map(({ids,...collection}) => ({
      ...collection,ids:ids.filter(id => photoMap.has(id))
    }))
  };
}

function missingSources(workspace,sources,role) {
  const missing = workspace.sources.filter(binding => !sources.some(source => source.id === binding.id));
  return role === 'admin' ? missing.map(binding => binding.id) : missing.length;
}

const writeRoles = ['admin','editor'];
const admin = ['admin'];

export function workspaceService(store,user,get) {
  user = {...user,email:user.email.toLowerCase()};
  const ownerIndex = 'account:' + user.accountId;
  const read = async id => (await store.read(workspaceKey(id))).data;

  return {
    async list() {
      const indexes = await Promise.all([ownerIndex,user.email].map(key => store.read(membershipKey(key))));
      const ids = new Set(indexes.flatMap(({data}) => data?.ids || []));
      const records = await Promise.all([...ids].map(read));
      return records.flatMap(workspace => {
        const role = roleFor(workspace,user);
        return role ? [{id:workspace.id,name:workspace.name,role}] : [];
      });
    },

    async create(input) {
      const name = text(input?.name,80,'workspace name');
      const id = randomUUID();
      await addToIndex(store,ownerIndex,id);
      await store.write(workspaceKey(id),0,{
        id,name,owner:{accountId:user.accountId,email:user.email},
        members:[],sources:[],tags:{},collections:[]
      },validateInternalRecord);
      return {id,name,role:'admin'};
    },

    async view(id) {
      const workspace = await read(id);
      requireRole(workspace,user);
      const indexed = await visibleSources(workspace,get);
      return teamView(await read(id),user,indexed);
    },

    async photo(id,photoId) {
      const workspace = await read(id);
      requireRole(workspace,user);
      const proof = await authorizedPhoto(workspace,user,get,photoId);
      const current = await read(id);
      requireRole(current,user);
      if(!boundPhoto(current,proof)) throw fail(404,'This photo is unavailable in the workspace.');
      return proof.photo;
    },

    async change(id,input) {
      const workspace = await read(id);
      const action = input?.action;
      const manage = ['set-member','add-source','remove-source'].includes(action);
      const allowed = manage ? admin : writeRoles;
      requireRole(workspace,user,allowed);
      const operation = await prepareOperation(workspace,user,input,get,store);
      const updated = await update(store,workspaceKey(id),current => {
        requireRole(current,user,allowed);
        operation(current);
        return current;
      });
      if(action === 'set-member' && input.role === 'remove') {
        const email = input.email.trim().toLowerCase();
        await removeFromIndex(store,email,id);
        // Repair the discovery index if another administrator re-added access.
        if((await read(id)).members.some(member => member.email === email)) {
          await addToIndex(store,email,id);
        }
      }
      if(action === 'set-member' && input.role !== 'remove' && (await read(id)).members.some(member => member.email === input.email.trim().toLowerCase())) {
        await addToIndex(store,input.email.trim().toLowerCase(),id);
      }
      return {id:updated.id};
    }
  };
}

function boundPhoto(workspace,proof) {
  return proof.matches.some(match => workspace.sources.some(
    source => source.id === match.id && (source.recursive || match.direct)
  ));
}

async function prepareOperation(workspace,user,input,get,store) {
  switch(input?.action) {
    case 'set-member': {
      const email = text(input.email,254,'Google account email').toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email === workspace.owner.email) {
        throw fail(400,'Enter a member’s Google account email.');
      }
      if(!['editor','viewer','remove'].includes(input.role)) throw fail(400,'Choose a member role.');
      if(input.role !== 'remove') await addToIndex(store,email,workspace.id);
      return current => {
        current.members = current.members.filter(member => member.email !== email);
        if(input.role === 'remove') return;
        if(current.members.length >= 50) throw fail(409,'This workspace has reached the member limit.');
        current.members.push({email,role:input.role});
      };
    }
    case 'add-source': {
      const id = fileId(input.folderId);
      const folder = await folderMetadata(get,id);
      if(folder.trashed || folder.mimeType !== FOLDER_MIME) throw fail(400,'Choose an accessible Drive folder.');
      return current => {
        if(current.sources.some(source => source.id === id)) throw fail(409,'This folder is already connected.');
        if(current.sources.length >= 20) throw fail(409,'This workspace has reached the folder limit.');
        current.sources.push({id,recursive:input.recursive === true});
      };
    }
    case 'remove-source': {
      const id = fileId(input.folderId);
      return current => {current.sources = current.sources.filter(source => source.id !== id);};
    }
    case 'create-collection': {
      const name = text(input.name,80,'collection name');
      const id = randomUUID();
      return current => {
        if(current.collections.some(collection => sameName(collection.name,name))) throw fail(409,'A collection with this name already exists.');
        if(current.collections.length >= 200) throw fail(409,'This workspace has reached the collection limit.');
        current.collections.push({id,name,ids:[]});
      };
    }
    case 'edit-photo': {
      const id = fileId(input.photoId);
      const tag = input.tag === undefined ? null : text(input.tag,80,'tag');
      const tagOperation = input.tagOperation;
      const collectionId = input.collectionId;
      const collectionOperation = input.collectionOperation;
      if(!tag && !collectionId || tag && !['add','remove'].includes(tagOperation) ||
          collectionId && !['add','remove'].includes(collectionOperation)) {
        throw fail(400,'Choose a tag or collection change.');
      }
      const proof = await authorizedPhoto(workspace,user,get,id);
      return current => {
        if(!boundPhoto(current,proof)) throw fail(404,'This photo is unavailable in the workspace.');
        if(tag) {
          const before = Object.hasOwn(current.tags,id) ? current.tags[id] : [];
          const existing = before.some(value => sameName(value,tag));
          const after = tagOperation === 'remove' ? before.filter(value => !sameName(value,tag))
            : existing ? before : [...before,tag];
          if(after.length > 50 || !before.length && after.length && Object.keys(current.tags).length >= 10000) {
            throw fail(409,'This workspace has reached its tag limit.');
          }
          if(after.length) Object.defineProperty(current.tags,id,{value:after,enumerable:true,configurable:true,writable:true});
          else delete current.tags[id];
        }
        if(collectionId) {
          const collection = current.collections.find(item => item.id === collectionId);
          if(!collection) throw fail(404,'That collection is unavailable.');
          if(collectionOperation === 'remove') collection.ids = collection.ids.filter(value => value !== id);
          else if(!collection.ids.includes(id)) {
            if(collection.ids.length >= 10000) throw fail(409,'This collection has reached its photo limit.');
            collection.ids.push(id);
          }
        }
      };
    }
    default: throw fail(400,'Unknown workspace action.');
  }
}
