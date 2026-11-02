// AUREN v3.21 — per-account IndexedDB, no cross-account shared records.
const DB_VERSION=1;
export const STORES={memories:'memories',projects:'projects',messages:'messages'};
let dbPromise=null;let openedName='';
function accountDatabaseName(){
 const uid=sessionStorage.getItem('auren_account_uid_v321');
 if(!uid||!/^[\w-]{3,128}$/.test(uid))throw new Error('Sign in before opening personal data.');
 return 'auren_user_'+uid;
}
export function uid(){
 const c=globalThis.crypto;
 if(c?.randomUUID)return c.randomUUID();
 const b=new Uint8Array(16);
 if(c?.getRandomValues)c.getRandomValues(b);else for(let i=0;i<16;i++)b[i]=Math.floor(Math.random()*256);
 return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
}
export function friendlyError(e){
 const name=e?.name||'';
 let msg;
 if(name==='QuotaExceededError')msg='Storage is full on this device. Export a backup, free some space, and try again.';
 else if(name==='InvalidStateError')msg='The browser closed AUREN\'s database. Reload and try again.';
 else if(name==='SecurityError'||name==='NotAllowedError')msg='The browser is blocking local storage.';
 else if(name==='VersionError')msg='This browser has newer AUREN database data. Update AUREN.';
 else msg=e?.message||'Unknown storage problem.';
 const err=new Error(msg);err.name='StorageError';err.cause=e;return err;
}
async function copyOwnedLegacyRecords(db,account){
 // Only migrate shared legacy database if the existing owner was this UID.
 // If ownership cannot be established, leave legacy data untouched.
 const marker='auren_legacy_idb_imported_v321_'+account;
 if(localStorage.getItem(marker)==='yes')return;
 const legacyOwner=localStorage.getItem('auren_account_legacy_idb_owner_v321')||localStorage.getItem('auren_legacy_idb_owner_v321');
 if(legacyOwner!==account)return;
 const legacy=await new Promise((res,rej)=>{
   const r=indexedDB.open('auren',1);
   r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
   r.onupgradeneeded=()=>{r.transaction.abort();rej(new Error('No legacy database'));};
 }).catch(()=>null);
 if(!legacy)return;
 try{
  for(const store of Object.values(STORES)){
   if(!legacy.objectStoreNames.contains(store))continue;
   const records=await new Promise((res,rej)=>{const t=legacy.transaction(store,'readonly');const r=t.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
   for(const record of records){await new Promise((res,rej)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).put(record);t.oncomplete=res;t.onerror=()=>rej(t.error);});}
  }
  localStorage.setItem(marker,'yes');
 }finally{legacy.close();}
}
export function openDB(){
 let name;
 try{name=accountDatabaseName();}catch(e){return Promise.reject(friendlyError(e));}
 if(dbPromise&&openedName===name)return dbPromise;
 if(dbPromise&&openedName!==name)return Promise.reject(new Error('Account switched. Reload AUREN.'));
 openedName=name;
 dbPromise=new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined')return reject(friendlyError({name:'SecurityError'}));
  const req=indexedDB.open(name,DB_VERSION);
  req.onupgradeneeded=()=>{const d=req.result;for(const store of Object.values(STORES))if(!d.objectStoreNames.contains(store))d.createObjectStore(store,{keyPath:'id'});};
  req.onsuccess=()=>{const d=req.result;d.onversionchange=()=>{d.close();dbPromise=null;};d.onclose=()=>{dbPromise=null;};resolve(d);};
  req.onblocked=()=>reject(friendlyError({message:'Close other AUREN tabs and reload.'}));
  req.onerror=()=>reject(friendlyError(req.error));
 }).then(async d=>{await copyOwnedLegacyRecords(d,sessionStorage.getItem('auren_account_uid_v321'));return d;}).catch(e=>{dbPromise=null;throw e?.name==='StorageError'?e:friendlyError(e);});
 return dbPromise;
}
function tx(store,mode,fn){return openDB().then(db=>new Promise((resolve,reject)=>{
 let t;try{t=db.transaction(store,mode);}catch(e){dbPromise=null;return reject(friendlyError(e));}
 let result;const r=fn(t.objectStore(store));if(r)r.onsuccess=()=>{result=r.result;};
 t.oncomplete=()=>resolve(result);t.onerror=()=>reject(friendlyError(t.error));t.onabort=()=>reject(friendlyError(t.error||{name:'QuotaExceededError'}));
}));}
export const put=(store,value)=>tx(store,'readwrite',s=>s.put(value));
export const get=(store,id)=>tx(store,'readonly',s=>s.get(id));
export const getAll=store=>tx(store,'readonly',s=>s.getAll());
export const del=(store,id)=>tx(store,'readwrite',s=>s.delete(id));
export const clear=store=>tx(store,'readwrite',s=>s.clear());
export async function saveVerified(store,record){await put(store,record);const back=await get(store,record.id);if(!back||JSON.stringify(back)!==JSON.stringify(record))throw Error('Save could not be verified in database.');return back;}
export async function deleteVerified(store,id){await del(store,id);if(await get(store,id))throw Error('Delete could not be verified.');return true;}
export async function healthCheck(){const id='__probe__';await put(STORES.messages,{id,role:'probe',text:'',at:new Date().toISOString()});const back=await get(STORES.messages,id);await del(STORES.messages,id);if(!back)throw Error('Storage test failed.');return true;}
export async function storageEstimate(){try{return await globalThis.navigator?.storage?.estimate?.()||null;}catch{return null;}}
