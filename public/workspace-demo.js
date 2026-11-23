const folders = [
  {id:'demo-november',name:'November event',photos:[
    {id:'demo-entrance',name:'Entrance.jpg'},
    {id:'demo-keynote',name:'Keynote.jpg'}
  ]},
  {id:'demo-products',name:'Product photos',photos:[
    {id:'demo-product-front',name:'Product front.jpg'},
    {id:'demo-product-detail',name:'Product detail.jpg'}
  ]},
  {id:'demo-brand',name:'Brand assets',photos:[{id:'demo-brand-photo',name:'Brand team.jpg'}]}
];

export function createWorkspaceDemo() {
  const teams = new Map();
  const make = name => ({
    id:crypto.randomUUID(),name,role:'admin',ownerEmail:'bob@example.com',
    members:[],sources:[],collections:[],photos:[],unavailableSources:[]
  });
  const marketing = make('Marketing');
  marketing.members.push({email:'alice@example.com',role:'editor'},{email:'alex@example.com',role:'viewer'});
  marketing.sources.push({...folders[0],recursive:false,ids:folders[0].photos.map(photo => photo.id)});
  marketing.photos.push(...folders[0].photos.map(photo => ({...photo,tags:[]})));
  marketing.photos[0].tags.push('Social ready');
  marketing.collections.push({id:crypto.randomUUID(),name:'November campaign',ids:[marketing.photos[0].id]});
  teams.set(marketing.id,marketing);

  async function api(path,options) {
    if(path === '/api/drive/folders') return {files:folders};
    const id = path.split('/')[3];
    const input = options?.body && JSON.parse(options.body);
    if(!id) {
      if(!input) return [...teams.values()].map(({id,name,role,archived}) => ({id,name,role,...(archived ? {archived:true} : {})}));
      const next = make(input.name.trim());
      if(!next.name) throw new Error('Enter a workspace name.');
      teams.set(next.id,next);
      return {id:next.id};
    }
    const team = teams.get(id);
    if(!team || (team.archived && input?.action !== 'restore-workspace')) throw new Error('Workspace unavailable.');
    if(!input) return structuredClone(team);
    switch(input.action) {
      case 'rename-workspace':
        if(!input.name.trim()) throw new Error('Enter a workspace name.');
        team.name = input.name.trim();
        break;
      case 'archive-workspace':
        team.archived = true;
        break;
      case 'restore-workspace':
        delete team.archived;
        break;
      case 'add-source': {
        const folderId = input.folderId.trim().split('/').at(-1);
        const folder = folders.find(item => item.id === folderId);
        if(!folder) throw new Error('Choose a sample folder from the demo list.');
        if(team.sources.some(item => item.id === folder.id)) throw new Error('This folder is already connected.');
        team.sources.push({id:folder.id,name:folder.name,recursive:input.recursive,ids:folder.photos.map(photo => photo.id)});
        for(const photo of folder.photos) {
          if(!team.photos.some(item => item.id === photo.id)) team.photos.push({...photo,tags:[]});
        }
        break;
      }
      case 'remove-source':
        team.sources = team.sources.filter(item => item.id !== input.folderId);
        break;
      case 'set-member':
        team.members = team.members.filter(item => item.email !== input.email);
        if(input.role !== 'remove') team.members.push({email:input.email,role:input.role});
        break;
      case 'create-collection':
        if(!input.name.trim()) throw new Error('Enter a collection name.');
        team.collections.push({id:crypto.randomUUID(),name:input.name.trim(),ids:[]});
        break;
      case 'edit-photo': {
        const photo = team.photos.find(item => item.id === input.photoId);
        if(!photo) throw new Error('Photo unavailable.');
        if(!input.tag && !input.collectionId) throw new Error('Choose a tag or collection change.');
        if(input.tag && input.tagOperation === 'add') photo.tags = [...new Set([...photo.tags,input.tag])];
        if(input.tag && input.tagOperation === 'remove') photo.tags = photo.tags.filter(tag => tag !== input.tag);
        const collection = team.collections.find(item => item.id === input.collectionId);
        if(collection && input.collectionOperation === 'add') collection.ids = [...new Set([...collection.ids,photo.id])];
        if(collection && input.collectionOperation === 'remove') collection.ids = collection.ids.filter(id => id !== photo.id);
        break;
      }
      default: throw new Error('Choose a demo action.');
    }
    return {id};
  }

  async function visibleApi(path,options) {
    const result = await api(path,options);
    if(!result.photos) return result;
    const allowed = new Set(result.sources.flatMap(source => source.ids));
    result.photos = result.photos.filter(photo => allowed.has(photo.id));
    result.collections.forEach(collection => {collection.ids = collection.ids.filter(id => allowed.has(id));});
    return result;
  }

  return {api:visibleApi,marketingId:marketing.id};
}
