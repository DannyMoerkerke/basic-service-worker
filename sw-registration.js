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

            await SWHelper.prepareCachesForUpdate();
            await SWHelper.skipWaiting();
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
    }
  };

  const updateServiceWorkerIfNeeded = async () => {
    if(window.swUpdate) {
      console.log('send skipWaiting');
      await SWHelper.skipWaiting();
    }
  }

  window.addEventListener('beforeunload', updateServiceWorkerIfNeeded);
  document.addEventListener('pagehide', updateServiceWorkerIfNeeded);
}
