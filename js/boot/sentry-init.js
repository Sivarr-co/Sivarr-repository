// Sentry error monitoring + session replay. Loaded right after the Sentry loader
// script (Sentry.onLoad is defined by it).
Sentry.onLoad(function () {
  Sentry.init({
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
});
