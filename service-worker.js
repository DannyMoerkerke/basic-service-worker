const buildFiles = [];
const staticFiles = [
  '/sw-registration.js',
  '/index.js',
  '/index.html',
  '/about/index.html',
  '/manifest.json',
];
const routes = [
  '/',
  '/about',
  '/about/'
]
const filesToCache = [
  ...routes,
  ...buildFiles,
  ...staticFiles,
];


const version = 175;

const cacheName = `web-app-cache-${version}`;

const debug = true;

const log = debug ? console.log.bind(console) : () => {};

const getCacheStorageNames = async () => {
  const cacheNames = await caches.keys() || [];
  const outdatedCacheNames = cacheNames.filter(name => !name.includes(cacheName));
  const latestCacheName = cacheNames.find(name => name.includes(cacheName));

  return {latestCacheName, outdatedCacheNames};
};

const prepareCachesForUpdate = async () => {
  const {latestCacheName, outdatedCacheNames} = await getCacheStorageNames();
  if(!latestCacheName || !outdatedCacheNames?.length) {
    return null;
  }

  console.log('latestCacheName', latestCacheName);
  console.log('outdatedCacheNames', outdatedCacheNames);

  const latestCache = await caches.open(latestCacheName);

  console.log('latestCache', latestCache);

  const latestCacheEntries = (await latestCache?.keys())?.map(c => c.url) || [];

  console.log('latestCacheEntries', await latestCache?.keys());

  const latestCacheIndexEntry = latestCacheEntries?.find(url => {
    console.log('entry', url, new URL(url));
    return new URL(url).pathname === '/';
  });
  console.log('latestCacheIndexEntry', latestCacheIndexEntry);

  const latestCacheIndexResponse = latestCacheIndexEntry ? await latestCache.match(latestCacheIndexEntry) : null;

  const latestCacheOtherEntries = latestCacheEntries.filter(url => url !== latestCacheIndexEntry) || [];

  const promises = outdatedCacheNames.map(outdatedCacheName => {
    const updateOutdatedCache = async () => {
      const outdatedCache = await caches.open(outdatedCacheName);
      const outdatedCacheEntries = (await outdatedCache?.keys())?.map(c => c.url) || [];
      const outdatedCacheIndexEntry = outdatedCacheEntries?.find(url => new URL(url).pathname === '/');

      if(outdatedCacheIndexEntry && latestCacheIndexResponse) {
        console.log('put new version of the index.html in the cache', outdatedCacheName);
        await outdatedCache.put(outdatedCacheIndexEntry, latestCacheIndexResponse.clone());
      }

      return Promise.all(
        latestCacheOtherEntries
        // .filter(key => !outdatedCacheEntries.includes(key))
        .map(url => outdatedCache.add(url).catch(r => console.error(r))),
      );
    };
    return updateOutdatedCache();
  });

  return Promise.all(promises);
};

const installHandler = e => {
  e.waitUntil(
    self.clients.matchAll({
      includeUncontrolled: true,
    })
    .then(clients => {
      caches.open(cacheName)
      // .then(cache => cache.addAll(filesToCache.map(file => new Request(file, {cache: 'no-cache'}))))
      .then(async (cache) => {
        for(const file of filesToCache) {
          try {
            console.log('cache file', file);
            await cache.add(new Request(file, {cache: 'no-cache'}))
          }
          catch(error) {
            console.error('Failed to cache file', file, error);
          }
        }
      })
    })
    .catch(err => console.error('cache error', err))
  );
};

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

const cleanRedirect =  async (response) => {
  const clonedResponse = response.clone();

  return new Response(clonedResponse.body, {
    headers: clonedResponse.headers,
    status: clonedResponse.status,
    statusText: clonedResponse.statusText,
  });
}

const fetchHandler = async e => {
  const {request} = e;
  const {url, method, headers, mode, credentials, cache} = request;

  log('[Service Worker] Fetch', url, request.method);

  e.respondWith(
    caches.match(request, {ignoreVary: true, ignoreSearch: true})
    .then(async response => {
      if(response) {
        log('from cache', url);

        return response.redirected ? cleanRedirect(response) : response;
      }

      if(url.startsWith(location.origin) && !url.match(/\.[a-zA-Z]{2,4}$/)) {
        const indexUrl = url.endsWith('/') ? `${url}index.html` : `${url}/index.html`;

        log('trying index request:', indexUrl);

        const indexRequest = new Request(indexUrl, {method, headers, credentials, cache});
        return caches.match(indexRequest, {ignoreSearch: true})
      }

      log('fetching from network:', url);

      return fetch(e.request);
    })
    .then(response => {
      if(response) {
        log('response from network:', url, response);
        return response;
      }

      console.log('no response for url:', url);
      return fetch(e.request);
    })
    .catch(err => console.error('fetch error:', 'url:', url, 'error:', err))
  );

};

const getClients = async () => await self.clients.matchAll({
  includeUncontrolled: true,
});

const hasActiveClients = async () => {
  const clients = await getClients();

  return clients.some(({visibilityState}) => visibilityState === 'visible');
};

const sendMessage = async message => {
  const clients = await getClients();

  clients.forEach((client) => client.postMessage({type: 'message', message}));
}

const messageHandler = async ({data}) => {
  const {type} = data;

  switch(type) {
    case 'SKIP_WAITING':
      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
      });

      log('skip waiting', clients, self.registration);

      if(clients.length < 2) {
        await self.skipWaiting();
        await self.clients.claim();
      }

      break;

    case 'PREPARE_CACHES_FOR_UPDATE':
      await prepareCachesForUpdate();

      break;
  }
}

self.addEventListener('install', installHandler);
self.addEventListener('activate', activateHandler);
self.addEventListener('fetch', fetchHandler);
self.addEventListener('message', messageHandler);
