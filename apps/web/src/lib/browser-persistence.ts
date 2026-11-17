// Owner report 2026-11-16, TEA H-2: iPhone Safari with Block All Cookies (and some embedded
// browsers) throws on every storage access. A bare read during render or start-up then crashed the
// whole web app ("Application error"), landing included. Every storage read goes through here and
// answers null where the browser refuses storage, which every caller already reads as signed out.
export function readStorage(area: 'local' | 'session', key: string): string | null {
  try {
    return (area === 'local' ? window.localStorage : window.sessionStorage).getItem(key)
  } catch {
    return null
  }
}

/**
 * The first head script. Where the browser refuses to read localStorage or sessionStorage, it
 * puts an in-memory store of the same shape in its place before any other script runs, so the
 * auth and analytics SDKs, which read storage while they load, start instead of crashing the app.
 * A person in that browser stays signed in for as long as the tab is open. Where reads work but
 * writes fail (a full store, TEA F4), the real store stays readable, so a stored session still
 * counts, and new writes go to memory on top of it.
 */
export function blockedStorageFallbackScript(): string {
  return "(function(){function memory(base){var m=Object.create(null);var gone=Object.create(null);function read(k){k=String(k);if(k in m)return m[k];if(k in gone||!base)return null;try{return base.getItem(k)}catch(e){return null}}return{getItem:read,setItem:function(k,v){k=String(k);try{if(base){base.setItem(k,String(v));delete m[k];delete gone[k];return}}catch(e){}m[k]=String(v);delete gone[k]},removeItem:function(k){k=String(k);delete m[k];gone[k]=1;try{if(base)base.removeItem(k)}catch(e){}},clear:function(){m=Object.create(null);gone=Object.create(null);try{if(base)base.clear()}catch(e){}},key:function(i){var keys=Object.keys(m);return i<keys.length?keys[i]:null},get length(){return Object.keys(m).length}}}function fallback(name){var s;try{s=window[name];s.getItem('__couturecast_probe__')}catch(e){try{Object.defineProperty(window,name,{value:memory(null),configurable:true})}catch(e2){}return}try{var k='__couturecast_probe__';s.setItem(k,k);s.removeItem(k)}catch(e){try{Object.defineProperty(window,name,{value:memory(s),configurable:true})}catch(e2){}}}fallback('localStorage');fallback('sessionStorage')})()"
}
