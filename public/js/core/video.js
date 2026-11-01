/* Turns a YouTube or Google Drive link into an address that can play inside Altidian. Anything else returns null. */
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{15,80}$/;

export function embedOf(link) {
  let u; try { u = new URL(String(link || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase(); const parts = u.pathname.split('/').filter(Boolean);
  let id = '';
  if (host === 'youtu.be') id = parts[0] || '';
  else if (YT_HOSTS.has(host)) {
    if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1] || '';
  }
  if (YT_ID.test(id)) return { kind: 'youtube', label: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&playsinline=1' };
  if (host === 'drive.google.com') {
    let d = '';
    if (parts[0] === 'file' && parts[1] === 'd') d = parts[2] || '';
    else if (parts[0] === 'open' || parts[0] === 'uc') d = u.searchParams.get('id') || '';
    if (DRIVE_ID.test(d)) return { kind: 'drive', label: 'Google Drive', src: 'https://drive.google.com/file/d/' + d + '/preview' };
  }
  return null;
}
