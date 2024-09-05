const buildFiles = [];

const staticFiles = [];

const filesToCache = [
  ...buildFiles,
  ...staticFiles,
];


const version = 1;

const cacheName = `web-app-cache-${version}`;

const debug = false;

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

  const latestCache = await caches?.open(latestCacheName);
  const latestCacheKeys = (await latestCache?.keys())?.map(c => c.url) || [];
  const latestCacheMainKey = latestCacheKeys?.find(url => url.includes('/index.html'));
  const latestCacheMainKeyResponse = latestCacheMainKey ? await latestCache.match(latestCacheMainKey) : null;

  const latestCacheOtherKeys = latestCacheKeys.filter(url => url !== latestCacheMainKey) || [];

  const cachePromises = outdatedCacheNames.map(cacheName => {
    const getCacheDone = async () => {
      const cache = await caches?.open(cacheName);
      const cacheKeys = (await cache?.keys())?.map(c => c.url) || [];
      const cacheMainKey = cacheKeys?.find(url => url.includes('/index.html'));

      if(cacheMainKey && latestCacheMainKeyResponse) {
        await cache.put(cacheMainKey, latestCacheMainKeyResponse.clone());
      }

      return Promise.all(
        latestCacheOtherKeys
        .filter(key => !cacheKeys.includes(key))
        .map(url => cache.add(url).catch(r => console.error(r))),
      );
    };
    return getCacheDone();
  });

  return Promise.all(cachePromises);
};

const installHandler = e => {
  e.waitUntil(
    self.clients.matchAll({
      includeUncontrolled: true,
    })
    .then(clients => {
      caches.open(cacheName)
      .then(cache => cache.addAll(filesToCache.map(file => new Request(file, {cache: 'no-cache'}))))
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

const fetchHandler = async e => {
  const {request} = e;
  const {url, method, headers, mode, credentials, cache} = request;

  if(url.includes('google')) {
    return false;
  }

  log('[Service Worker] Fetch', url, request.method);

  e.respondWith(
    caches.match(request, {ignoreVary: true, ignoreSearch: true})
    .then(response => {
      if(response) {
        log('from cache', url, request);

        return response;
      }

      if(url.startsWith(location.origin) && !url.match(/\.[a-zA-Z]{2,4}$/)) {
        const indexUrl = url.endsWith('/') ? `${url}index.html` : `${url}/index.html`;

        log('trying index request:', indexUrl);

        const indexRequest = new Request(indexUrl, {method, headers, credentials, cache});
        return caches.match(indexRequest, {ignoreSearch: true})
      }

      return fetch(e.request);
    })
    .then(response => {
      if(response) {
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
    case 'clearBadges':
      self.numBadges = 0;
      if('clearAppBadge' in navigator) {
        navigator.clearAppBadge();
      }

      break;

    case 'SKIP_WAITING':
      const clients = await self.clients.matchAll({
        includeUncontrolled: true,
      });

      if(clients.length < 2) {
        self.skipWaiting();
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
