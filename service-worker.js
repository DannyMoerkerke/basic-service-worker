// service worker version number
const SW_VERSION = 1;

// cache name including version number
const cacheName = `web-app-cache-${SW_VERSION}`;

// static files to cache
const staticFiles = [
  '/sw-registration.js',
  '/index.html',
  '/about/index.html',
  '/manifest.json',
  '/offline.html',
  '/src/img/icons/manifest-icon-192.maskable.png',
  '/src/img/icons/manifest-icon-512.maskable.png',
];

// routes to cache
const routes = [
  '/',
  '/about',
]

// combine static files and routes to cache
const filesToCache = [
  ...routes,
  ...staticFiles,
];

// get the names of the caches of the current Service Worker and any outdated ones
const getCacheStorageNames = async () => {
  const cacheNames = await caches.keys() || [];
  const outdatedCacheNames = cacheNames.filter(name => !name.includes(cacheName));
  const latestCacheName = cacheNames.find(name => name.includes(cacheName));

  return {latestCacheName, outdatedCacheNames};
};


// update outdated caches with the content of the latest one so new content is served immediately
// when the Service Worker is updated but it can't serve this new content yet on the first navigation or reload
const updateLastCache = async () => {
  const {latestCacheName, outdatedCacheNames} = await getCacheStorageNames();
  if(!latestCacheName || !outdatedCacheNames?.length) {
    return null;
  }

  const latestCache = await caches.open(latestCacheName);
  const latestCacheEntries = (await latestCache?.keys())?.map(c => c.url) || [];

  for(const outdatedCacheName of outdatedCacheNames) {
    const outdatedCache = await caches.open(outdatedCacheName);

    for(const entry of latestCacheEntries) {
      const latestCacheResponse = await latestCache.match(entry);

      await outdatedCache.put(entry, latestCacheResponse.clone());
    }
  }
};

// cache all files and routes when the Service Worker is installed
// add {cache: 'no-cache'} } to all requests to bypass the browser cache so content is always fetched from the server
const installHandler = e => {
  e.waitUntil(
    caches.open(cacheName)
    .then(cache => cache.addAll(filesToCache.map(file => new Request(file, {cache: 'no-cache'}))))
    .catch(err => console.error('cache error', err))
  );
};

// delete any outdated caches when the Service Worker is activated
const activateHandler = e => {
  e.waitUntil(
    caches.keys()
    .then(names => Promise.all(
      names
      .filter(name => name !== cacheName)
      .map(name => caches.delete(name))
    ))
  );
};

// in case the caches response is a redirect, we need to clone it to set its "redirected" property to false
// otherwise the Service Worker will throw an error since this is a security restriction
const cleanRedirect =  async (response) => {
  const clonedResponse = response.clone();

  return new Response(clonedResponse.body, {
    headers: clonedResponse.headers,
    status: clonedResponse.status,
    statusText: clonedResponse.statusText,
  });
}

// the fetch event handler for the Service Worker that is invoked for each request
const fetchHandler = async e => {
  const {request} = e;
  const {url} = request;

  e.respondWith(
    (async () => {
      try {
        // try to get the response from the cache
        const response = await caches.match(request, {ignoreVary: true, ignoreSearch: true});
        if (response) {
          return response.redirected ? cleanRedirect(response) : response;
        }

        // if not in the cache, try to fetch the response from the network
        const fetchResponse = await fetch(e.request);
        if (fetchResponse) {
          return fetchResponse;
        }
      }
      catch (err) {
        // a fetch error occurred, serve the offline page since we don't have a cached response
        const offlineResponse = await caches.match('/offline.html');
        if (offlineResponse) {
          return offlineResponse;
        }
      }
    })()
  );

};


// message handler for communication between the main thread and the Service Worker through postMessage
const messageHandler = async ({data}) => {
  const {type} = data;

  switch(type) {
    case 'SKIP_WAITING':
      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
      });

      // if the Service Worker is serving 1 client at most, it can be safely skip waiting to update immediately
      if(clients.length < 2) {
        await self.skipWaiting();
        await self.clients.claim();
      }

      break;

    // move the files of the new cache to the old one so when the user navigates to another page or reloads the
    // current one, the new content will be served immediately
    case 'PREPARE_CACHES_FOR_UPDATE':
      await updateLastCache();

      break;
  }
}

self.addEventListener('install', installHandler);
self.addEventListener('activate', activateHandler);
self.addEventListener('fetch', fetchHandler);
self.addEventListener('message', messageHandler);
