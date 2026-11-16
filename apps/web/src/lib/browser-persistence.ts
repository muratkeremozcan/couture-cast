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
 * The first head script. Where the browser refuses localStorage or sessionStorage, it puts an
 * in-memory store of the same shape in its place before any other script runs, so the auth and
 * analytics SDKs, which read storage while they load, start instead of crashing the app. A
 * person in that browser stays signed in for as long as the tab is open.
 */
export function blockedStorageFallbackScript(): string {
  return "(function(){function fallback(name){try{var s=window[name];var k='__couturecast_probe__';s.setItem(k,k);s.getItem(k);s.removeItem(k)}catch(e){var m=Object.create(null);var store={getItem:function(k){k=String(k);return k in m?m[k]:null},setItem:function(k,v){m[String(k)]=String(v)},removeItem:function(k){delete m[String(k)]},clear:function(){m=Object.create(null)},key:function(i){var keys=Object.keys(m);return i<keys.length?keys[i]:null},get length(){return Object.keys(m).length}};try{Object.defineProperty(window,name,{value:store,configurable:true})}catch(e2){}}}fallback('localStorage');fallback('sessionStorage')})()"
}
