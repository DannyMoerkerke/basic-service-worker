const SWHelper = {
  async getWaitingWorker() {
    const registrations = await navigator.serviceWorker?.getRegistrations() || [];
    const registrationWithWaiting = registrations.find(reg => reg.waiting);
    return registrationWithWaiting?.waiting;
  },

  async skipWaiting() {
    return (await SWHelper.getWaitingWorker())?.postMessage({type: 'SKIP_WAITING'});
  },

  async prepareCachesForUpdate() {
    return (await SWHelper.getWaitingWorker())?.postMessage({type: 'PREPARE_CACHES_FOR_UPDATE'});
  }
};

const updateServiceWorkerIfNeeded = async () => {
  if(window.swUpdate) {
    console.log('send skipWaiting');

    await SWHelper.skipWaiting();
  }
};

window.addEventListener('load', async () => {
  if('serviceWorker' in navigator) {
    const registerServiceWorker = async () => {
      await navigator.serviceWorker.register('/service-worker.js');
      const registration = await navigator.serviceWorker.ready;
      const newServiceWorkerWaiting = registration.waiting && registration.active;

      // if there is already a new Service Worker waiting when the page is loaded, skip waiting to update immediately
      if(newServiceWorkerWaiting) {
        console.log('new sw waiting');
        window.swUpdate = true;
        await SWHelper.skipWaiting();
      }

      // listen for service worker updates
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;

        // installing Service Worker found
        if(installingWorker) {
          console.log('installing sw found');
          installingWorker.addEventListener('statechange', async () => {
            // the new Service Worker is installed and waiting to be activated
            // the outdated caches can be updated and the Service Worker will be activated on the next navigation or reload
            if(installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('new sw installed');

              window.swUpdate = true;

              setTimeout(async () => {

                // move the files of the new cache to the old one so when the user navigates to another page or reloads the
                // current one, the new version will be served immediately. At the same time, this navigation or reload will
                // cause the waiting service worker to be activated.
                await SWHelper.prepareCachesForUpdate();
              }, 500);
            }
          });
        }
      });
    };

    registerServiceWorker();

    // set window.swUpdate to false when the new service worker is activated
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('new sw activated');
      window.swUpdate = false;
    });

    const retryRequests = () => navigator.serviceWorker.controller?.postMessage({type: 'retry-requests'});

    // check if the Service Worker needs to be updated on page navigation or reload
    // beforeunload is reliably triggered on desktop, pagehide is more reliable on mobile and is the only event that is
    // fired when the user closes the app from the app switcher.
    // NOTE: on iOS, the pagehide event is only fired when the app is added to the Home Screen and the user closes it
    // from the app switcher.
    window.addEventListener('beforeunload', updateServiceWorkerIfNeeded);
    window.addEventListener('pagehide', updateServiceWorkerIfNeeded);

    // send a message to the Service Worker to retry any requests that were stored
    // when the user was offline
    // in browsers that support Background Sync, this will be handled by the Sync event
    window.addEventListener('online', retryRequests);

    // event handler to load the SPA route
    navigation.addEventListener('navigate', (e) => {
      if(e.destination.url.endsWith('/spa-route')) {

        // skip handling of the navigation which updates the DOM with the template for the SPA route when there is a
        // new service worker waiting to be activated (window.swUpdate === true). In that case, the browser will handle
        // the navigation (page reload) and the newly installed service worker will be activated
        if(window.swUpdate) {
          console.log('reloading SPA route to update service worker');
          return;
        }

        e.intercept({
          async handler() {
            // update the DOM with the template for the SPA route
            const {template} = await import('./src/js/spa-route.js');
            document.body.innerHTML = template;
          }
        })
      }
    });

    // retry any requests that were stored in IndexedDB when the app was offline
    // we need to run this function when the page is loaded otherwise it will only be triggered when the app
    // comes back online
    // if the app is closed while offline and reopened when online, the online event will not be triggered,
    // so we need to manually call this function
    retryRequests();
  }
});
