export const COLORS = {
  // Backgrounds
  bg:      '#111110',
  bg2:     '#1a1a18',
  bg3:     '#222220',
  card:    '#1e1e1c',
  border:  '#2e2e2c',

  // Brand — matches the web app's current dark-mode tokens (css/base.css),
  // not the light-mode hex, since this app is dark-only (userInterfaceStyle
  // in app.json). The web's light-mode purple (#41076B) is a deep, low
  // -contrast tone that would barely read against this app's near-black
  // backgrounds — its dark-mode --accent/--accent2 pairing is the one
  // actually meant to render on a dark surface. Purple-only (no teal) —
  // the web app's dark-mode --accent used to be a genuinely different
  // teal-green (#0fdbad); that's the pre-rebrand colour, since removed.
  accent:  '#8b80f0',
  accent2: '#6458cc',
  teal:    '#8b80f0',
  purple:  '#8b80f0',

  // Text
  text1:   '#f2f2ef',
  text2:   '#b0b0a8',
  muted:   '#6a6a62',

  // Status
  red:     '#ef4444',
  green:   '#22c55e',
  amber:   '#f59e0b',
};

export const FONTS = {
  heading: 'System',
  body:    'System',
};
