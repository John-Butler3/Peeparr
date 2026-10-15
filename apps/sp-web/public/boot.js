// Discreet logo (set in Settings > Content, per device), before the splash
// paints: the logo, the browser tab, and the icon used when the app is added
// to a home screen. Loaded from index.html's <head>, after the icon links.
try {
  if (localStorage.getItem('peeparr.discreetLogo') === '1') {
    document.documentElement.classList.add('discreet-logo');
    document.querySelector('link[rel="icon"][type="image/svg+xml"]').href = 'favicon-discreet.svg';
    document.querySelector('link[rel="manifest"]').href = 'manifest-discreet.webmanifest';
    document.querySelector('link[rel="apple-touch-icon"]').href = 'icons/apple-touch-icon-discreet.png';
  }
} catch (e) {}
