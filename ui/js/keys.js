// Remote buttons → actions. On the Pi, the IR keymap for the TiVo peanut emits
// these same keys, so the keyboard is a stand-in for the remote during design.
export const KEYMAP = {
  // top of the peanut
  t: 'tivo', Home: 'tivo',
  o: 'power', Power: 'power', TV: 'livetv',
  l: 'livetv',
  v: 'input', TVInput: 'input',
  i: 'info', Info: 'info',
  w: 'window', ZoomToggle: 'window',
  g: 'guide', Guide: 'guide',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'select',
  u: 'thumbsup', d: 'thumbsdown',
  // volume, mute, record, channel
  "'": 'volup', ';': 'voldown', AudioVolumeUp: 'volup', AudioVolumeDown: 'voldown',
  m: 'mute', AudioVolumeMute: 'mute',
  r: 'record', MediaRecord: 'record',
  PageUp: 'chup', PageDown: 'chdown', '=': 'chup', '+': 'chup', '-': 'chdown',
  ChannelUp: 'chup', ChannelDown: 'chdown',
  // transport
  p: 'play', MediaPlay: 'play',
  ' ': 'pause', MediaPause: 'pause', MediaPlayPause: 'pause',
  '[': 'rew', MediaRewind: 'rew',
  ']': 'ff', MediaFastForward: 'ff',
  s: 'slow',
  ',': 'replay', MediaTrackPrevious: 'replay',
  '.': 'advance', MediaTrackNext: 'advance',
  // number pad
  0: '0', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  Delete: 'clear', Clear: 'clear',
  e: 'enter', Tab: 'enter',
  // keyboard-only: the peanut has no Back button (Left backs out of menus)
  Backspace: 'back', Escape: 'back', BrowserBack: 'back',
};

export const HELP = `TiVo peanut → keyboard
  TiVo ............ T          TV Power ........ O
  Live TV ......... L          TV Input ........ V
  Info ............ I          Window (zoom) ... W
  Guide ........... G          Select .......... Enter
  Arrows .......... arrow keys
  Thumbs Down/Up .. D / U      Mute ............ M
  Vol Up / Down ... ' / ;      Record .......... R
  Ch Up / Down .... PgUp PgDn  (= -)
  Play ............ P          Pause ........... Space
  Rewind / FF ..... [ / ]      Slow ............ S
  Replay / Advance  , / .      0-9 ............. digits
  Clear ........... Delete     Enter/Last ...... E / Tab
  Back (keyboard) . Esc / Backspace
  ─────────────────────────
  C  CRT preview    ?  this help`;
