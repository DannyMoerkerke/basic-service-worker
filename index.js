const getTime = () => new Date().toTimeString().split(' ').shift()

const init = async () => {
  const registration = await navigator.serviceWorker.ready;
  const updateButton = document.querySelector('#update');

  updateButton.addEventListener('click', async () => {
    await registration.update();
    console.log(registration);
  });

  window.addEventListener('beforeunload', (e) => {
    console.log('beforeunload', e);
    localStorage.setItem('beforeunload', getTime());
  });

  window.addEventListener('pagehide', (e) => {
    console.log('pagehide', e);
    localStorage.setItem('pagehide', getTime());
  });

  document.addEventListener('visibilitychange', () => {
    localStorage.setItem(document.visibilityState, getTime());
  })
}

init();
