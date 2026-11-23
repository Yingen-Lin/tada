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
        teams.map(team => option(team.id,team.name,roleLabel(team.role),workspace?.id === team.id)).join('') +
        '<button type="button" class="workspace-menu-create" data-destination="create">Create team workspace</button>';
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
      '<label class="field-label" for="team-name">Workspace name</label><input class="modal-input" id="team-name" maxlength="80" required autofocus>',
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
  const navButton = (id,label,iconName,count) => `<button type="button" class="nav-item ${view === id ? 'active' : ''}" data-team-view="${esc(id)}" ${view === id ? 'aria-current="page"' : ''}>${icon(iconName)}<span class="nav-text">${esc(label)}</span>${count === undefined ? '' : `<b>${count}</b>`}</button>`;
  const media = (id,kind) => isDemo() ? '/placeholder.svg' : `/api/workspaces/${encodeURIComponent(workspace.id)}/files/${encodeURIComponent(id)}/${kind}`;

  function render() {
    const active = Boolean(workspace);
    get('.sidebar-scroll').hidden = active;
    get('.sidebar-bottom').hidden = active;
    sidebar.hidden = !active;
    section.hidden = !active;
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
    get('#mode-switch').textContent = isDemo() ? 'DEMO SETTINGS' : 'TEAM WORKSPACE';
    const source = workspace.sources.find(item => 'folder:' + item.id === view);
    const collection = workspace.collections.find(item => 'collection:' + item.id === view);
    const title = view === 'settings' ? 'Workspace settings' : source?.name || collection?.name || 'All photos';
    get('#breadcrumb').textContent = `${workspace.name} / ${title}`;

    sidebar.innerHTML = `<div class="section-label">LIBRARY</div>
      ${navButton('photos','All photos','grid',workspace.photos.length)}
      <div class="section-label folder-label">SOURCE FOLDERS</div>
      ${workspace.sources.map(item => navButton('folder:'+item.id,item.name,'folder',item.ids.length)).join('')}
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

  function galleryMarkup(filter) {
    const ids = filter ? new Set(filter.ids) : null;
    const candidates = ids ? workspace.photos.filter(photo => ids.has(photo.id)) : workspace.photos;
    const term = search.trim().toLowerCase();
    const photos = candidates.filter(photo => [photo.name,...photo.tags].some(value => value.toLowerCase().includes(term)));
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
      <section class="storage-card team-settings-card"><div><h2>Folder connections</h2><p class="settings-note">Google Drive · Read only</p>
      ${sources}${unavailable}
      ${isAdmin() ? '<button type="button" class="primary" data-team-action="add-folder">Add folder</button>' : ''}
      </div></section>${members}</section>`;
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
    modal(current ? 'Edit member access' : 'Invite member',`This gives access to ${workspace.name} in TADA. Share the folders with this email in Google Drive separately.`,
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

  function openPhoto(id) {
    const photo = workspace.photos.find(item => item.id === id);
    if(!photo) return;
    const edit = canEdit();
    modal(photo.name,edit ? destination() : `${workspace.name} · Viewer`,
      `<div class="team-preview"><img src="${media(id,'thumbnail')}" alt="${esc(photo.name)}">
      ${isDemo() ? '' : `<a class="text-button" href="https://drive.google.com/file/d/${encodeURIComponent(id)}/view" target="_blank" rel="noopener noreferrer">Open in Google Drive</a> · <a class="text-button" href="${media(id,'download')}" download>Download original</a>`}</div>
      <div class="photo-tags">${photo.tags.map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
      ${edit ? `<label class="field-label" for="team-tag">Tag</label><div class="team-tag-controls">
        <input class="modal-input" id="team-tag" maxlength="80" placeholder="Enter a tag">
        <select class="modal-input" id="team-tag-operation" aria-label="Tag change"><option value="add">Add tag</option><option value="remove">Remove tag</option></select></div>
        ${workspace.collections.length ? `<label class="field-label" for="team-collection">Collection</label>
        <select class="modal-input" id="team-collection"><option value="">No collection change</option>
        ${workspace.collections.map(item => `<option value="${esc(item.id)}">${item.ids.includes(id) ? 'Remove from ' : 'Add to '}${esc(item.name)}</option>`).join('')}</select>` : ''}` : ''}`,
      edit ? 'Save changes' : 'Done',edit ? modalTask(async () => {
        const tag = get('#team-tag').value.trim();
        const collectionId = get('#team-collection')?.value;
        const collection = workspace.collections.find(item => item.id === collectionId);
        await change({action:'edit-photo',photoId:id,tag:tag || undefined,tagOperation:get('#team-tag-operation').value,
          collectionId:collection?.id,collectionOperation:collection?.ids.includes(id) ? 'remove' : 'add'});
        closeModal();
      }) : closeModal,{wide:true});
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
