/* global self, caches, URL, fetch */
const CACHE_NAME="leme-familiar-v3";
const APP_SHELL=["/","/manifest.webmanifest","/icon.svg","/icon-maskable.svg"];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;

  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  const isDocument=event.request.mode==="navigate" || event.request.destination==="document";
  const isManifest=url.pathname==="/manifest.webmanifest";

  if(isDocument || isManifest){
    event.respondWith(
      fetch(event.request)
        .then(response=>{
          if(response.ok){
            const copy=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
          }
          return response;
        })
        .catch(()=>caches.match(event.request).then(cached=>cached||caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached=>cached||fetch(event.request).then(response=>{
        if(response.ok && url.pathname.startsWith("/assets/")){
          const copy=response.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
        }
        return response;
      }).catch(()=>cached))
  );
});
