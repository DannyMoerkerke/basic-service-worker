window.addEventListener('load', async () => {
  if('serviceWorker' in navigator) {
    const registerServiceWorker = async () => {
      await navigator.serviceWorker.register('/service-worker.js');
      const registration = await navigator.serviceWorker.ready;
      const newServiceWorkerWaiting = registration.waiting && registration.active

      if(newServiceWorkerWaiting) {
        console.log('new sw waiting');
        window.swUpdate = true;
      }

      registration.onupdatefound = () => {
        const installingWorker = registration.installing;

      if(installingWorker) {
        console.log('installing sw found');
        installingWorker.onstatechange = async () => {
          if(installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('new sw installed');
            window.swUpdate = true;

            setTimeout(async () => {

            // move the files of the new cache to the old one so when the user navigates to another page or reloads the
            // current one, the new version will be served immediately. At the same time, this navigation or reload will
            // cause the waiting service worker to be activated.
            await SWHelper.prepareCachesForUpdate();
            }, 250)
          }
        };
      }

      };
    };

    registerServiceWorker();

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
      },

      async checkForUpdates() {
        const registration = await navigator.serviceWorker.ready;
        await registration.update();
      }
    };

    const updateServiceWorkerIfNeeded = async () => {
      if(window.swUpdate) {
        console.log('send skipWaiting');

        // set swUpdate to false to avoid multiple calls to skipWaiting which can cause the service worker
        // to stay in the waiting state
        window.swUpdate = false;
        await SWHelper.skipWaiting();
      }
    }

    window.addEventListener('beforeunload', updateServiceWorkerIfNeeded);
    document.addEventListener('pagehide', updateServiceWorkerIfNeeded);
  }
});
