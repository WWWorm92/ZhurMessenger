(function () {
  var ua = navigator.userAgent || "";
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  if (!isIOS || !("serviceWorker" in navigator)) {
    return;
  }

  var key = "ios-sw-reset-v2";
  try {
    if (sessionStorage.getItem(key)) {
      return;
    }
    sessionStorage.setItem(key, "1");
  } catch (error) {
    // ignore storage issues
  }

  navigator.serviceWorker.getRegistrations()
    .then(function (registrations) {
      return Promise.all(
        registrations.map(function (registration) {
          return registration.unregister();
        })
      );
    })
    .then(function () {
      if (window.caches && caches.keys) {
        return caches.keys().then(function (keys) {
          return Promise.all(
            keys.map(function (key) {
              return caches.delete(key);
            })
          );
        });
      }
    })
    .finally(function () {
      setTimeout(function () {
        window.location.reload();
      }, 50);
    });
})();
