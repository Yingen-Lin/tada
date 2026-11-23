import {getSourceViews,normalizeTags} from './library.js';
import {icon,hydrateIcons} from './icons.js';

export function createWorkspaceUI({api,isDemo,esc,modal,closeModal,toast,renderPersonal}) {
  const get = selector => document.querySelector(selector);
  const chooser = get('#workspace-switcher');
  const section = get('#team-page');
  const sidebar = get('#team-nav');
  let workspace = null;
  let opening = 0;
  let view = 'photos';
  let visibleLimit = 48;
  let search = '';
  let collapsed = new Set();
  let previewIds = [];

  function apiWorkspace(id,action) {
    return api('/api/workspaces' + (id ? '/' + encodeURIComponent(id) : ''), action && {
      method:'POST',body:JSON.stringify(action)
    });
  }

  function modalTask(task) {
    return async () => {
      const button = get('#modal-form button[type=submit]');
      const error = get('#modal-error');
      if(button) button.disabled = true;
      error.textContent = '';
      try {
        await task();
      } catch(problem) {
        error.textContent = problem.message;
      } finally {
        if(button) button.disabled = false;
      }
    };
  }

  async function openWorkspace(id) {
    const request = ++opening;
    const next = await apiWorkspace(id);
    if(request !== opening) return;
    workspace = next;
    view = 'photos';
    visibleLimit = 48;
    search = '';
    collapsed = new Set();
    render();
  }

  async function refreshWorkspace(id = workspace.id) {
    const request = ++opening;
    const next = await apiWorkspace(id);
    if(request !== opening) return;
    workspace = next;
    render();
  }

  async function change(action) {
    const id = workspace.id;
    await apiWorkspace(id,action);
    if(workspace?.id === id) await refreshWorkspace(id);
  }

  const menu = get('#workspace-menu');

  function closeMenu(restoreFocus = false) {
    menu.hidden = true;
    chooser.setAttribute('aria-expanded','false');
    if(restoreFocus) chooser.focus();
  }

  async function choose() {
    if(!menu.hidden) return closeMenu(true);
    chooser.disabled = true;
    try {
      const teams = await apiWorkspace();
      const option = (id,label,subtitle,selected) =>
        `<button type="button" data-destination="${esc(id)}" ${selected ? 'aria-current="true"' : ''}>
          <span><strong>${esc(label)}</strong><small>${esc(subtitle)}</small></span>${selected ? icon('check') : ''}
        </button>`;
      menu.innerHTML = option('personal','Personal library','Only you',!workspace) +
        teams.filter(team => !team.archived).map(team => option(team.id,team.name,roleLabel(team.role),workspace?.id === team.id)).join('') +
        '<button type="button" class="workspace-menu-create" data-destination="create">Create team workspace</button>' +
        teams.filter(team => team.archived).map(team => option('restore:'+team.id,team.name,'Archived · Restore workspace',false)).join('');
      menu.hidden = false;
      chooser.setAttribute('aria-expanded','true');
      menu.querySelector('button').focus();
    } catch(error) {
      toast(error.message);
    } finally {
      chooser.disabled = false;
    }
  }

  menu.onclick = async event => {
    const destination = event.target.closest('[data-destination]')?.dataset.destination;
    if(!destination) return;
    closeMenu(true);
    if(destination === 'create') return create();
    if(destination === 'personal') {
      opening++;
      workspace = null;
      renderPersonal();
      return;
    }
    if(destination.startsWith('restore:')) return restoreWorkspace(destination.slice('restore:'.length));
    try {await openWorkspace(destination);}
    catch(error) {toast(error.message);}
  };
  menu.onkeydown = event => {
    if(event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };
  document.addEventListener('click',event => {
    if(!event.target.closest('#workspace-menu-root')) closeMenu();
  });
  get('#workspace-menu-root').addEventListener('focusout',event => {
    if(event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) closeMenu();
  });

  function create() {
    modal('Create team workspace','Invite people and connect shared Google Drive folders after creating the workspace.',
      '<label class="field-label" for="team-name">Workspace name</label><input class="modal-input" id="team-name" autocomplete="off" maxlength="80" required autofocus>',
      'Create workspace',modalTask(async () => {
        const result = await apiWorkspace('',{name:get('#team-name').value});
        await openWorkspace(result.id);
        view = 'settings';
        closeModal();
        render();
        addFolder();
      }));
  }

  const roleLabel = role => ({admin:'Administrator',editor:'Editor',viewer:'Viewer'})[role];
  const canEdit = () => workspace.role !== 'viewer';
  const isAdmin = () => workspace.role === 'admin';
  const destination = () => `Save to ${workspace.name} · Team members`;
  const navButton = (id,label,iconName,count,folder) => `<button type="button" class="nav-item ${folder?.child ? 'child-folder' : ''} ${view === id ? 'active' : ''}" data-team-view="${esc(id)}" ${folder?.children?.length ? `data-team-toggle="${esc(folder.id)}" aria-expanded="${!collapsed.has(folder.id)}"` : ''} ${view === id ? 'aria-current="page"' : ''}>${icon(folder?.children?.length?(collapsed.has(folder.id)?'chevron-right':'chevron-down'):iconName)}<span class="nav-text">${esc(label)}</span>${count === undefined ? '' : `<b>${count}</b>`}</button>`;
  const media = (id,kind) => isDemo() ? '/placeholder.svg' : `/api/workspaces/${encodeURIComponent(workspace.id)}/files/${encodeURIComponent(id)}/${kind}`;

  function render() {
    const active = Boolean(workspace);
    get('.sidebar-scroll').hidden = active;
    get('.sidebar-bottom').hidden = active;
    sidebar.hidden = !active;
    section.hidden = !active;
    get('#mode-switch').hidden = active;
    get('#team-context').hidden = !active;
    const demoButton = get('#start-workspace-demo');
    if(isDemo()) demoButton.hidden = active;
    get('#workspace-title').textContent = workspace?.name || 'Personal library';
    get('#workspace-subtitle').textContent = active ? roleLabel(workspace.role) : 'Only you';
    get('#workspace-initial').textContent = active ? workspace.name.slice(0,1).toUpperCase() : 'P';
    if(!active) return false;

    get('#library-page').hidden = true;
    get('#settings-page').hidden = true;
    get('#selection-bar').hidden = true;
    get('#save-status').hidden = true;
    const source = getSourceViews(workspace.sources).find(item => 'folder:' + item.id === view);
    const collection = workspace.collections.find(item => 'collection:' + item.id === view);
    const title = view === 'settings' ? 'Workspace settings' : source?.name || collection?.name || 'All photos';
    get('#breadcrumb').textContent = `${workspace.name} / ${title}`;

    sidebar.innerHTML = `<div class="section-label">LIBRARY</div>
      ${navButton('photos','All photos','grid',workspace.photos.length)}
      <div class="section-label folder-label">SOURCE FOLDERS</div>
      ${getSourceViews(workspace.sources,collapsed).map(item => navButton('folder:'+item.id,item.name,'folder',item.ids.length,item)).join('')}
      <div class="section-label collection-label">POST COLLECTIONS</div>
      ${workspace.collections.map(item => navButton('collection:'+item.id,item.name,'collection',item.ids.length)).join('')}
      ${navButton('settings','Workspace settings','settings')}`;

    const isSettings = view === 'settings';
    section.innerHTML = `${isDemo() ? '<p class="team-demo-note">Demo · Sample data. Changes reset when you reload the page.</p>' : ''}<section class="page-heading"><div><div class="eyebrow">TEAM WORKSPACE</div><h1>${esc(title)}</h1>
      <p>${esc(workspace.name)} · ${esc(roleLabel(workspace.role))}</p></div></section>
      ${isSettings ? settingsMarkup() : galleryMarkup(source || collection)}`;
    hydrateIcons(section);
    hydrateIcons(sidebar);
    return true;
  }

  function galleryPhotos(filter) {
    const ids = filter ? new Set(filter.ids) : null;
    const candidates = ids ? workspace.photos.filter(photo => ids.has(photo.id)) : workspace.photos;
    const term = search.trim().toLowerCase();
    const photos = candidates.filter(photo => [photo.name,...photo.tags].some(value => value.toLowerCase().includes(term)));
    return {photos,candidates};
  }

  function galleryMarkup(filter) {
    const {photos,candidates}=galleryPhotos(filter);
    const hiddenCount = Array.isArray(workspace.unavailableSources) ? workspace.unavailableSources.length : workspace.unavailableSources;
    return `<form class="team-toolbar" id="team-search-form"><label class="search">${icon('search')}<input type="search" name="query" value="${esc(search)}" placeholder="Search photos or tags" aria-label="Search team photos or tags"></label><button type="submit" class="filter-button">Search</button>
      <button type="button" data-team-action="refresh" class="filter-button">${icon('refresh')} Refresh folders</button>
      ${canEdit() ? '<button type="button" data-team-action="collection" class="filter-button">New collection</button>' : ''}
      <span>${photos.length} photos · Shared tags and collections</span></form>
      ${hiddenCount ? '<p class="settings-note">Some folders are unavailable to your Google account. Ask for access in Drive.</p>' : ''}
      <div class="gallery">${photos.slice(0,visibleLimit).map(photo => `<article class="photo-card">
        <button type="button" class="photo-frame team-photo" data-team-photo="${esc(photo.id)}" aria-label="Open ${esc(photo.name)}"><img src="${media(photo.id,'thumbnail')}" alt="" loading="lazy"></button>
        <div class="photo-info"><div class="photo-title-row"><strong>${esc(photo.name)}</strong></div><div class="photo-tags">${photo.tags.map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}</div></div>
        </article>`).join('')}</div>
      ${photos.length > visibleLimit ? '<button type="button" data-team-action="more" class="filter-button">Load more photos</button>' : ''}
      ${photos.length ? '' : `<div class="empty"><h3>${candidates.length ? 'No matching photos' : 'No photos here yet'}</h3></div>`}`;
  }

  function settingsMarkup() {
    const sources = workspace.sources.map(source => `<div class="team-row"><div><strong>${esc(source.name)}</strong><small>${source.recursive ? 'Includes subfolders' : 'This folder only'}</small></div>
      ${isAdmin() ? `<button type="button" class="filter-button" data-team-remove-source="${esc(source.id)}">Remove</button>` : ''}</div>`).join('');
    const unavailable = isAdmin() ? workspace.unavailableSources.map(id => `<div class="team-row"><span>Drive folder unavailable to your account</span>
      <button type="button" class="filter-button" data-team-remove-source="${esc(id)}">Remove</button></div>`).join('') : '';
    const members = !isAdmin() ? '' : `<section class="storage-card team-settings-card"><div>
      <h2>Members & roles</h2><p class="settings-note">Roles control access to this TADA workspace. Share each folder with members in Google Drive so they can see its photos.</p>
      <div class="team-row"><span>${esc(workspace.ownerEmail)}</span><strong>Administrator</strong></div>
      ${workspace.members.map(member => `<div class="team-row"><span>${esc(member.email)}<small>${esc(roleLabel(member.role))}</small></span>
        <button type="button" class="filter-button" data-team-member="${esc(member.email)}">Edit access</button></div>`).join('')}
      <button type="button" class="primary" data-team-action="invite">Invite member</button>
      </div></section>`;
    return `<section class="settings-content">
      ${isAdmin() ? `<section class="storage-card team-settings-card"><div>
        <h2>General</h2>
        <div class="team-row"><div><small>Workspace name</small><strong>${esc(workspace.name)}</strong></div>
          <button type="button" class="filter-button" data-team-action="rename">Rename</button></div>
        <button type="button" class="filter-button" data-team-action="archive">Archive workspace</button>
      </div></section>` : ''}
      <section class="storage-card team-settings-card"><div><h2>Folder connections</h2><p class="settings-note">Google Drive · Read only</p>
      ${sources}${unavailable}
      ${isAdmin() ? '<button type="button" class="primary" data-team-action="add-folder">Add folder</button>' : ''}
      </div></section>${members}</section>`;
  }

  function renameWorkspace() {
    modal('Rename workspace','',
      `<label class="field-label" for="team-rename">Workspace name</label><input class="modal-input" id="team-rename" autocomplete="off" maxlength="80" required autofocus value="${esc(workspace.name)}">`,
      'Save name',modalTask(async () => {
        await change({action:'rename-workspace',name:get('#team-rename').value});
        closeModal();
      }));
  }

  function archiveWorkspace() {
    const {id,name} = workspace;
    modal('Archive workspace',`Archiving ${name} hides it from members. Your Drive connections, tags and collections are saved so you can restore it from the workspace switcher.`,
      '', 'Archive workspace',modalTask(async () => {
        await apiWorkspace(id,{action:'archive-workspace'});
        closeModal();
        if(workspace?.id === id) {
          opening++;
          workspace = null;
          renderPersonal();
        }
        toast('Workspace archived.');
      }));
  }

  function restoreWorkspace(id) {
    modal('Restore workspace','Members will regain access to the workspace when you restore it.',
      '', 'Restore workspace',modalTask(async () => {
        await apiWorkspace(id,{action:'restore-workspace'});
        await openWorkspace(id);
        view = 'settings';
        closeModal();
        render();
        toast('Workspace restored.');
      }));
  }

  async function loadDriveChoices(pageToken = '') {
    const list = get('#team-drive-choices');
    const more = get('#team-more-drive');
    if(!list || !more) return;
    more.disabled = true;
    try {
      const result = await api('/api/drive/folders' + (pageToken ? '?pageToken=' + encodeURIComponent(pageToken) : ''));
      if(list !== get('#team-drive-choices')) return;
      list.insertAdjacentHTML('beforeend',(result.files || []).map(folder =>
        `<button type="button" class="drive-folder-option" data-team-drive-choice="${esc(folder.id)}">${esc(folder.name)}</button>`
      ).join(''));
      more.hidden = !result.nextPageToken;
      more.onclick = () => loadDriveChoices(result.nextPageToken);
    } catch(error) {
      const message = get('#modal-error');
      if(message && list === get('#team-drive-choices')) message.textContent = error.message;
    } finally {more.disabled = false;}
  }

  function addFolder() {
    modal('Add Drive folder',`Add to ${workspace.name}. Members need access to the same folder in Google Drive.`,
      '<label class="field-label" for="team-drive-folder">Google Drive folder link or ID</label><input class="modal-input" id="team-drive-folder" required autofocus><label class="team-check"><input type="checkbox" id="team-recursive" checked> Include subfolders</label><button type="button" class="filter-button" id="team-more-drive">Choose from Drive</button><div class="team-drive-choices" id="team-drive-choices"></div>',
      'Add to workspace',modalTask(async () => {
        await change({action:'add-source',folderId:get('#team-drive-folder').value,recursive:get('#team-recursive').checked});
        closeModal();
      }));
    get('#team-more-drive').onclick = () => loadDriveChoices();
    if(isDemo()) void loadDriveChoices();
    get('#team-drive-choices').onclick = event => {
      const choice = event.target.closest('[data-team-drive-choice]');
      if(choice) get('#team-drive-folder').value = choice.dataset.teamDriveChoice;
    };
  }

  function memberForm(email) {
    const current = workspace.members.find(item => item.email === email);
    modal(current ? 'Edit member access' : 'Invite member',`Members will find ${workspace.name} in their workspace switcher when they sign in with this Google account. Share the folders with them separately in Drive.`,
      `<label class="field-label" for="team-member-email">Google account email</label>
       <input class="modal-input" id="team-member-email" type="email" required value="${esc(email || '')}" ${current ? 'readonly' : 'autofocus'}>
       <label class="field-label" for="team-member-role">Role</label>
       <div class="choice-list" id="team-member-role">
       <label class="collection-choice"><input type="radio" name="member-role" value="editor" ${current?.role !== 'viewer' ? 'checked' : ''}> Editor · Tags and collections</label>
       <label class="collection-choice"><input type="radio" name="member-role" value="viewer" ${current?.role === 'viewer' ? 'checked' : ''}> Viewer · Browse library</label>
       ${current ? '<label class="collection-choice"><input type="radio" name="member-role" value="remove"> Remove access</label>' : ''}</div>`,
      current ? 'Save access' : 'Add to workspace',modalTask(async () => {
        await change({action:'set-member',email:get('#team-member-email').value,role:get('#team-member-role input:checked').value});
        closeModal();
        if(!current) toast('Member added. They can find this workspace next time they sign in.');
      }));
  }

  function createCollection() {
    modal('Create a collection',destination(),
      '<label class="field-label" for="team-collection-name">Collection name</label><input class="modal-input" id="team-collection-name" maxlength="80" required autofocus>',
      'Create collection',modalTask(async () => {
        await change({action:'create-collection',name:get('#team-collection-name').value});
        closeModal();
      }));
  }

  function openPhoto(id,keepSequence=false) {
    const photo = workspace.photos.find(item => item.id === id);
    if(!photo) return;
    if(!keepSequence){
      const filter=getSourceViews(workspace.sources).find(folder => 'folder:'+folder.id===view)
        || workspace.collections.find(collection => 'collection:'+collection.id===view);
      previewIds=galleryPhotos(filter).photos.map(item => item.id);
    }
    if(!previewIds.includes(id))previewIds=[id];
    const index=previewIds.indexOf(id);
    const edit=canEdit();
    const focus=get('#modal').open?document.activeElement?.id:null;
    const known=normalizeTags(workspace.photos.flatMap(item => item.tags));
    const suggestions=known.filter(tag => !photo.tags.some(value => value.toLowerCase()===tag.toLowerCase())).slice(0,8);
    const size=Number(photo.size);
    const info=[photo.modifiedTime?.slice(0,10),size>0?`${(size/1048576).toFixed(1)} MB`:null].filter(Boolean).join(' · ');
    const disabled=previewIds.length<2?'disabled':'';
    modal(photo.name,edit ? destination() : `${workspace.name} · Viewer`,
      `<div class="preview-navigation" aria-label="Photo navigation">
        <button type="button" id="team-previous" ${disabled}>← Previous</button>
        <span aria-live="polite">${index+1} of ${previewIds.length}</span>
        <button type="button" id="team-next" ${disabled}>Next →</button></div>
      <img class="detail-image" src="${media(id,'thumbnail')}" alt="${esc(photo.name)}">
      <div class="detail-meta"><span>${esc(info)}</span><span>${photo.width&&photo.height?`${esc(photo.width)} × ${esc(photo.height)}`:'Original photo'}</span></div>
      ${isDemo()?'':`<div class="detail-drive-links">
        <a href="https://drive.google.com/file/d/${encodeURIComponent(id)}/view" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right',16)} Open original in Google Drive</a>
        ${photo.sourceFolderId?`<a href="https://drive.google.com/drive/folders/${encodeURIComponent(photo.sourceFolderId)}" target="_blank" rel="noopener noreferrer">${icon('folder',16)} Open source folder</a>`:''}
        <a href="${media(id,'download')}" download>Download original</a></div>`}
      <section class="quick-tags" aria-label="Photo tags">
        ${edit?'<label class="field-label" for="team-quick-tag">Tags</label>':'<div class="field-label">Tags</div>'}
        <div class="quick-current-tags">${photo.tags.map(tag => edit
          ?`<button type="button" class="tag" data-team-remove-tag="${esc(tag)}" aria-label="Remove tag ${esc(tag)}">${esc(tag)} <span aria-hidden="true">×</span></button>`
          :`<span class="tag">${esc(tag)}</span>`).join('')||'<span class="quick-tags-empty">No tags yet</span>'}</div>
        ${edit?`<div class="quick-tag-entry"><input class="modal-input" id="team-quick-tag" maxlength="250" placeholder="Add tags, separated by commas" autocomplete="off"><button type="button" class="primary" id="team-add-tag">Add</button></div>
        <div class="quick-tag-suggestions">${suggestions.map(tag => `<button type="button" data-team-add-tag="${esc(tag)}">+ ${esc(tag)}</button>`).join('')}</div>
        <span class="quick-tag-help">Enter to add · Click × to remove · Changes save automatically</span>`:''}
      </section>
      <div class="detail-collections">Collections: ${workspace.collections.filter(item => item.ids.includes(id)).map(item => esc(item.name)).join(', ')||'Not in a collection yet'}</div>
      ${edit&&workspace.collections.length?`<details class="team-collection-menu"><summary class="filter-button">Manage collections</summary><div class="choice-list">
        ${workspace.collections.map(item => `<label class="collection-choice"><input type="checkbox" data-team-photo-collection="${esc(item.id)}" ${item.ids.includes(id)?'checked':''}><span>${esc(item.name)}</span></label>`).join('')}
      </div></details>`:''}`,
      'Done',closeModal,{wide:true});
    const dialog=get('#modal');
    dialog.dataset.teamPreviewId=id;
    let saving=false;
    const move=step => {
      if(!saving&&previewIds.length>1)openPhoto(previewIds[(index+step+previewIds.length)%previewIds.length],true);
    };
    get('#team-previous').onclick=()=>move(-1);
    get('#team-next').onclick=()=>move(1);
    dialog.onkeydown=event => {
      if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
      event.preventDefault();
      move(event.key==='ArrowRight'?1:-1);
    };

    async function persist(changes,focusTag=false) {
      if(saving||!changes.length)return;
      const error=get('#modal-error');
      if(changes.some(action=>action.tag?.length>80)){
        error.textContent='Each tag must be 80 characters or fewer.';
        return;
      }
      saving=true;
      const workspaceId=workspace.id;
      const collectionsOpen=get('.team-collection-menu')?.open;
      const controls=[...dialog.querySelectorAll('button,input')].filter(item => !item.disabled);
      controls.forEach(item => {item.disabled=true;});
      try{
        for(const action of changes)await apiWorkspace(workspaceId,{action:'edit-photo',photoId:id,...action});
        if(workspace?.id===workspaceId)await refreshWorkspace(workspaceId);
        if(dialog.open&&dialog.dataset.teamPreviewId===id){
          openPhoto(id,true);
          if(collectionsOpen&&get('.team-collection-menu'))get('.team-collection-menu').open=true;
          if(focusTag)get('#team-quick-tag')?.focus();
        }
      }catch(problem){
        if(error.isConnected)error.textContent=problem.message;
      }finally{
        saving=false;
        controls.forEach(item => {item.disabled=false;});
      }
    }
    if(edit){
      const input=get('#team-quick-tag');
      const add=()=>void persist(normalizeTags(input.value.split(',')).map(tag => ({tag,tagOperation:'add'})),true);
      get('#team-add-tag').onclick=add;
      input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();add();}};
      dialog.querySelectorAll('[data-team-add-tag]').forEach(button => {
        button.onclick=()=>void persist([{tag:button.dataset.teamAddTag,tagOperation:'add'}]);
      });
      dialog.querySelectorAll('[data-team-remove-tag]').forEach(button => {
        button.onclick=()=>void persist([{tag:button.dataset.teamRemoveTag,tagOperation:'remove'}]);
      });
      dialog.querySelectorAll('[data-team-photo-collection]').forEach(input => {
        input.onchange=()=>{
          const added=input.checked;
          input.checked=!added;
          void persist([{collectionId:input.dataset.teamPhotoCollection,collectionOperation:added?'add':'remove'}]);
        };
      });
    }
    if(['team-previous','team-next'].includes(focus))get('#'+focus)?.focus();
  }

  function removeSource(id) {
    const source = workspace.sources.find(item => item.id === id);
    modal('Remove folder',`Remove ${source?.name || 'this folder'} from ${workspace.name}. Originals stay in Google Drive.`,'',
      'Remove folder',modalTask(async () => {
        await change({action:'remove-source',folderId:id});
        closeModal();
      }),{danger:true});
  }

  chooser.onclick = choose;
  chooser.onkeydown = event => {if(event.key === 'ArrowDown'){event.preventDefault();void choose();}};
  sidebar.onclick = event => {
    const target = event.target.closest('[data-team-view]');
    if(!target) return;
    const folderId=target.dataset.teamToggle;
    if(folderId&&view===target.dataset.teamView){
      if(collapsed.has(folderId))collapsed.delete(folderId);
      else collapsed.add(folderId);
    }
    view = target.dataset.teamView;
    visibleLimit = 48;
    render();
    get('main').scrollTo({top:0});
  };
  const actions = {
    refresh: async target => {
      target.disabled = true;
      try {await refreshWorkspace(); toast('Folders refreshed.');}
      catch(error) {toast(error.message);}
      finally {target.disabled = false;}
    },
    collection:createCollection,
    'add-folder':addFolder,
    rename:renameWorkspace,
    archive:archiveWorkspace,
    invite:() => memberForm(),
    more:() => {visibleLimit += 48; render();}
  };
  section.addEventListener('submit',event => {
    if(event.target.id !== 'team-search-form') return;
    event.preventDefault();
    search = event.target.elements.query.value;
    visibleLimit = 48;
    render();
  });
  section.onclick = event => {
    const button = event.target.closest('button');
    if(!button || button.disabled) return;
    const {teamAction,teamPhoto,teamMember,teamRemoveSource} = button.dataset;
    if(teamAction) actions[teamAction]?.(button);
    if(teamPhoto) openPhoto(teamPhoto);
    if(teamMember) memberForm(teamMember);
    if(teamRemoveSource) removeSource(teamRemoveSource);
  };

  async function openDemo(id) {
    await openWorkspace(id);
    view = 'settings';
    render();
  }

  return {render,openDemo,showSwitcher:() => {chooser.hidden = false;},settings:() => {
    if(!workspace) return false;
    view = 'settings';
    render();
    return true;
  }};
}
