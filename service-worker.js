// service worker version number
const SW_VERSION = 1;
const IDB_VERSION = 1;

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
];

// combine static files and routes to cache
const filesToCache = [
  ...routes,
  ...staticFiles,
];

const requestsToRetryWhenOffline = [];

const IDBConfig = {
  name: 'web-app-db',
  version: IDB_VERSION,
  stores: {
    requestStore: {
      name: `request-store`,
      keyPath: 'timestamp'
    }
  }
};

// returns if the app is offline
const isOffline = () => !self.navigator.onLine;

// return if a request should be retried when offline, in this example, all POST, PUT, DELETE requests
// and requests that are listed in the requestsToRetryWhenOffline array
// you can adapt this function to your specific needs
const isRequestEligibleForRetry = ({url, method}) => {
  return ['POST', 'PUT', 'DELETE'].includes(method) || requestsToRetryWhenOffline.includes(url);
};

const createIndexedDB = ({name, stores}) => {
  const request = self.indexedDB.open(name, 1);

  return new Promise((resolve, reject) => {
    request.onupgradeneeded = e => {
      const db = e.target.result;

      Object.keys(stores).forEach((store) => {
        const {name, keyPath} = stores[store];

        if(!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, {keyPath});
          console.log('create objectstore', name);
        }
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getStoreFactory = (dbName) => ({name}, mode = 'readonly') => {
  return new Promise((resolve, reject) => {

    const request = self.indexedDB.open(dbName, IDB_VERSION);

    request.onsuccess = e => {
      const db = request.result;
      const transaction = db.transaction(name, mode);
      const store = transaction.objectStore(name);

      // return a proxy object for the IDBObjectStore, allowing for promise-based access to methods
      const storeProxy = new Proxy(store, {
        get(target, prop) {
          if(typeof target[prop] === 'function') {
            return (...args) => new Promise((resolve, reject) => {
              const req = target[prop].apply(target, args);

              req.onsuccess = () => resolve(req.result);
              req.onerror = err => reject(err);
            });
          }

          return target[prop];
        },
      });

      return resolve(storeProxy);
    };

    request.onerror = e => reject(request.error);
  });
};

const openStore = getStoreFactory(IDBConfig.name);

// serialize request headers for storage in IndexedDB
const serializeHeaders = (headers) => [...headers.entries()].reduce((acc, [key, value]) => ({
  ...acc,
  [key]: value
}), {});

// store the request in IndexedDB
const storeRequest = async ({url, method, body, headers, mode, credentials}) => {
  const serializedHeaders = serializeHeaders(headers);

  try {
    // Read the body stream and convert it to text or ArrayBuffer
    let storedBody = body;

    if(body && body instanceof ReadableStream) {
      const clonedBody = body.tee()[0];
      storedBody = await new Response(clonedBody).arrayBuffer();
    }

    const timestamp = Date.now();
    const store = await openStore(IDBConfig.stores.requestStore, 'readwrite');

    await store.add({
      timestamp,
      url,
      method,
      ...(storedBody && {body: storedBody}),
      headers: serializedHeaders,
      mode,
      credentials
    });

    // register a sync event for retrying failed requests if Background Sync is supported
    if('sync' in self.registration) {
      console.log('register sync for retry request');
      await self.registration.sync.register(`retry-request`);
    }
  }
  catch(error) {
    console.log('idb error', error);
  }
};

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

// get all requests from IndexedDB that were stored when the app was offline
const getRequests = async () => {
  try {
    const store = await openStore(IDBConfig.stores.requestStore, 'readwrite');
    return await store.getAll();
  }
  catch(err) {
    return err;
  }
};

// retry failed requests that were stored in IndexedDB when the app was offline
const retryRequests = async () => {
  const reqs = await getRequests();
  const requests = reqs.map(({url, method, headers: serializedHeaders, body, mode, credentials}) => {
    const headers = new Headers(serializedHeaders);

    return fetch(url, {method, headers, body, mode, credentials});
  });

  const responses = await Promise.allSettled(requests);
  const requestStore = await openStore(IDBConfig.stores.requestStore, 'readwrite');
  const {keyPath} = IDBConfig.stores.requestStore;

  responses.forEach((response, index) => {
    const key = reqs[index][keyPath];

    // remove the request from IndexedDB if the response was successful
    if(response.status === 'fulfilled') {
      requestStore.delete(key);
    }
    else {
      console.log(`retrying response with ${keyPath} ${key} failed: ${response.reason}`);
    }
  });
};

// cache all files and routes when the Service Worker is installed
// add {cache: 'no-cache'} } to all requests to bypass the browser cache so content is always fetched from the server
const installHandler = e => {
  e.waitUntil(
    caches.open(cacheName)
    .then((cache) => Promise.all([
      cache.addAll(filesToCache.map(file => new Request(file, {cache: 'no-cache'}))),
      createIndexedDB(IDBConfig)
    ]))
    .catch(err => console.error('install error', err))
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
const cleanRedirect = async (response) => {
  const clonedResponse = response.clone();
  const {headers, status, statusText} = clonedResponse;

  return new Response(clonedResponse.body, {
    headers,
    status,
    statusText,
  });
};

// the fetch event handler for the Service Worker that is invoked for each request
const fetchHandler = async e => {
  const {request} = e;

  e.respondWith(
    (async () => {
      try {
        // store requests to IndexedDB that are eligible for retry when offline and return the offline page
        // as response so no error is logged
        if(isOffline() && isRequestEligibleForRetry(request)) {
          console.log('storing request', request);
          await storeRequest(request);

          return await caches.match('/offline.html');
        }

        // try to get the response from the cache
        const response = await caches.match(request, {ignoreVary: true, ignoreSearch: true});
        if(response) {
          return response.redirected ? cleanRedirect(response) : response;
        }

        // if not in the cache, try to fetch the response from the network
        const fetchResponse = await fetch(e.request);
        if(fetchResponse) {
          return fetchResponse;
        }
      }
      catch(err) {
        // a fetch error occurred, serve the offline page since we don't have a cached response
        return await caches.match('/offline.html');
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

    // retry any requests that were stored in IndexedDB when the app was offline in browsers that don't
    // support Background Sync
    case 'retry-requests':
      if(!('sync' in self.registration)) {
        console.log('retry requests when Background Sync is not supported');
        await retryRequests();
      }

      break;
  }
};

const syncHandler = async e => {
  console.log('sync event with tag:', e.tag);

  const {tag} = e;

  switch(tag) {
    case 'retry-request':
      e.waitUntil(retryRequests());

      break;
  }
};

self.addEventListener('install', installHandler);
self.addEventListener('activate', activateHandler);
self.addEventListener('fetch', fetchHandler);
self.addEventListener('message', messageHandler);
self.addEventListener('sync', syncHandler);
