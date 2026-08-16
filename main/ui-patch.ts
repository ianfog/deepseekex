'use strict'
/**
 * UI patch layer (mechanism A): applies the Endfield field-engineering visual
 * language to the dsh UI itself — not just the shell. The patch is a
 * stylesheet injected into the dsh iframe's document on every load, so it
 * survives kernel updates automatically (the shell owns the injection; the
 * kernel files stay pristine).
 *
 * Strategy (Endfield · complex depth):
 *  1. Remap the dsh design-token aliases (`--dsw-alias-*`, `--dsw-specific-*`,
 *     `--dsw-static-*`) toward the Endfield palette — ink #191919, paper
 *     #f2f2f0, signal yellow #fffa00 (single dominant accent), verified green
 *     #00ffa2 (online/verified state only), danger #d64545. Nearly the whole
 *     alias surface is covered so panels, buttons, menus, bubbles, markdown
 *     and state colors all follow the family.
 *  2. Add restrained component rules keyed on the dsh CSS-module class
 *     suffixes (verified live: `*_sidebarCol`, `*_newSession`,
 *     `*_composerSeat`, `*_composerStack`, `*_listArea`, `*_sectionLabel`,
 *     `*_trigger`, `*_workspace`, `*_bubble`, `*_dialog`, `*_menu`, ...):
 *     square geometry (2px), 1px rules, clipped wedge on the one primary CTA,
 *     signal focus, square scrollbars, condensed technical labels.
 *  Light values land on `body`, dark values under `body[data-ds-dark-theme]` —
 *  with `:not()` qualifiers that beat both the base theme's rules and its
 *  lazy injection order. Per the Endfield contract: monochrome dominant,
 *  yellow only as state/action accent, green only for verified/online.
 * @module deepseekex/ui-patch
 */

/** Endfield light palette mapped onto the dsh token aliases. */
const LIGHT_TOKENS = {
  // surfaces
  '--dsw-alias-bg-base': '#f2f2f0',
  '--dsw-alias-bg-layer-1': '#eaeae6',
  '--dsw-alias-bg-layer-2': '#e2e2de',
  '--dsw-alias-bg-layer-3': '#d8d8d3',
  '--dsw-alias-bg-overlay': '#e2e2de',
  '--dsw-alias-bg-module-platform': '#e8e8e4',
  '--dsw-alias-bg-mask-1': 'rgba(0,0,0,.22)',
  '--dsw-alias-bg-mask-2': 'rgba(0,0,0,.38)',
  '--dsw-alias-bg-mask-3': 'rgba(0,0,0,.55)',
  '--dsw-alias-bg-mask-drop': 'rgba(0,0,0,.6)',
  '--dsw-alias-bg-mask-photo': 'rgba(0,0,0,.28)',
  '--dsw-alias-bg-skeleton': '#d8d8d3',
  '--dsw-alias-bg-multi-select': 'rgba(122,107,0,.12)',
  // rules
  '--dsw-alias-border-l1': 'rgba(0,0,0,.06)',
  '--dsw-alias-border-l2': 'rgba(0,0,0,.12)',
  '--dsw-alias-border-l3': 'rgba(0,0,0,.18)',
  '--dsw-alias-border-l4': 'rgba(0,0,0,.24)',
  '--dsw-alias-border-inverted': 'rgba(255,255,255,.14)',
  '--dsw-alias-border-inverted2': 'rgba(255,255,255,.2)',
  '--dsw-alias-border-l2-darkmode-thin': 'rgba(0,0,0,.08)',
  // labels
  '--dsw-alias-label-primary': '#191919',
  '--dsw-alias-label-primary-bluish': '#191919',
  '--dsw-alias-label-primary-dimmed': 'rgba(25,25,25,.62)',
  // `label-primary-foreground` is text ON solid fills: the light primary
  // button is ink (#191919), so its label is paper (#f2f2f0).
  '--dsw-alias-label-primary-foreground': '#f2f2f0',
  '--dsw-alias-label-primary-inverted': '#f2f2f0',
  '--dsw-alias-label-secondary': '#4f4f4a',
  '--dsw-alias-label-tertiary': '#6f6f6a',
  '--dsw-alias-label-caption': '#888883',
  '--dsw-alias-label-dimmed': '#9a9a95',
  // brand: olive-signal on paper (readable yellow)
  '--dsw-alias-brand-primary': '#7a6b00',
  '--dsw-alias-brand-primary-invert': '#fffa00',
  '--dsw-alias-brand-primary-new-colorprimary-new-color': '#7a6b00',
  '--dsw-alias-brand-text': '#7a6b00',
  // interactive
  '--dsw-alias-interactive-bg-hover': 'rgba(0,0,0,.05)',
  '--dsw-alias-interactive-bg-active': 'rgba(0,0,0,.09)',
  '--dsw-alias-interactive-bg-hover-accent': 'rgba(122,107,0,.12)',
  '--dsw-alias-interactive-bg-hover-danger': 'rgba(197,53,48,.1)',
  '--dsw-alias-interactive-bg-hover-solid': '#e2e2de',
  // buttons
  '--dsw-alias-button-primary-fill': '#191919',
  '--dsw-alias-button-primary-hover': '#2e2e2e',
  '--dsw-alias-button-primary-dimmed': 'rgba(25,25,25,.6)',
  '--dsw-alias-button-contrast-fill': '#f2f2f0',
  '--dsw-alias-button-elevated-fill': '#eaeae6',
  '--dsw-alias-button-floating-fill': '#eaeae6',
  '--dsw-alias-button-floating-hover': '#e2e2de',
  '--dsw-alias-button-info-fill': '#e8e8e4',
  '--dsw-alias-button-info-hover': '#e2e2de',
  '--dsw-alias-button-tool-bar-fill': 'transparent',
  '--dsw-alias-button-tool-bar-fill-invisible': 'transparent',
  '--dsw-alias-button-tool-bar-hover': 'rgba(0,0,0,.05)',
  '--dsw-alias-button-ghost-active-fill': 'rgba(0,0,0,.05)',
  '--dsw-alias-button-ghost-active-hover': 'rgba(0,0,0,.08)',
  '--dsw-alias-button-ghost-active-border': 'rgba(0,0,0,.2)',
  // states
  '--dsw-alias-state-success-primary': '#00a37a',
  '--dsw-alias-state-success-secondary': 'rgba(0,163,122,.14)',
  '--dsw-alias-state-success-tertiary': 'rgba(0,163,122,.09)',
  '--dsw-alias-state-warn-primary': '#7a6b00',
  '--dsw-alias-state-warn-label': '#191919',
  '--dsw-alias-state-warn-secondary': 'rgba(122,107,0,.16)',
  '--dsw-alias-state-warn-tertiary': 'rgba(122,107,0,.1)',
  '--dsw-alias-state-error-primary': '#c53530',
  '--dsw-alias-state-error-secondary': 'rgba(197,53,48,.12)',
  '--dsw-alias-state-business-primary': '#7a6b00',
  '--dsw-alias-state-business-tertiary': 'rgba(122,107,0,.1)',
  // surfaces & overlays
  '--dsw-alias-toast-bg': '#e8e8e4',
  '--dsw-alias-tooltip-bg': '#e2e2de',
  '--dsw-specific-bubble': '#eaeae6',
  '--dsw-specific-bubble-highlight': '#e2e2de',
  '--dsw-specific-input-major': '#eaeae6',
  '--dsw-specific-login-input': '#eaeae6',
  '--dsw-specific-menu': '#e8e8e4',
  '--dsw-specific-selector': '#e8e8e4',
  '--dsw-specific-tip': '#e8e8e4',
  '--dsw-specific-sidebar-fill': '#f2f2f0',
  '--dsw-specific-sidebar-nav-item-active': '#e2e2de',
  '--dsw-specific-sidebar-nav-item-active-accent': '#7a6b00',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(0,0,0,.04)',
  // markdown
  '--dsw-alias-markdown-code-block': '#e6e6e1',
  '--dsw-alias-markdown-code-block-banner': '#dddcd6',
  '--dsw-alias-markdown-code-segment-selected': 'rgba(122,107,0,.18)',
  '--dsw-alias-markdown-code-segment-unselected': 'rgba(0,0,0,.04)',
  '--dsw-alias-markdown-inline-code': 'rgba(122,107,0,.12)',
  '--dsw-alias-markdown-placeholder': 'rgba(25,25,25,.4)',
  '--dsw-alias-markdown-tag': 'rgba(122,107,0,.1)',
  '--dsw-alias-markdown-citation': 'rgba(122,107,0,.08)',
  // scrollbars
  '--dsw-alias-scrollbar-bg-l1': '#d8d8d3',
  '--dsw-alias-scrollbar-bg-l2': '#cecec8',
  '--dsw-alias-scrollbar-hover-l1': '#7a6b00',
  '--dsw-alias-scrollbar-hover-l2': '#7a6b00',
  // fonts
  '--dsw-font-family': '"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
  // thinking sweep: restrained olive shimmer
  '--dsw-linear-gradient-think': 'linear-gradient(90deg,transparent,rgba(122,107,0,.14),transparent)',
  '--dsw-linear-think-select': 'rgba(122,107,0,.22)',
}

/** Endfield dark palette mapped onto the dsh token aliases. */
const DARK_TOKENS = {
  // surfaces
  '--dsw-alias-bg-base': '#191919',
  '--dsw-alias-bg-layer-1': '#232323',
  '--dsw-alias-bg-layer-2': '#2c2c2c',
  '--dsw-alias-bg-layer-3': '#363636',
  '--dsw-alias-bg-overlay': '#2c2c2c',
  '--dsw-alias-bg-module-platform': '#282828',
  '--dsw-alias-bg-mask-1': 'rgba(0,0,0,.3)',
  '--dsw-alias-bg-mask-2': 'rgba(0,0,0,.45)',
  '--dsw-alias-bg-mask-3': 'rgba(0,0,0,.6)',
  '--dsw-alias-bg-mask-drop': 'rgba(0,0,0,.62)',
  '--dsw-alias-bg-mask-photo': 'rgba(0,0,0,.35)',
  '--dsw-alias-bg-skeleton': '#363636',
  '--dsw-alias-bg-multi-select': 'rgba(255,250,0,.12)',
  // rules
  '--dsw-alias-border-l1': 'rgba(255,255,255,.07)',
  '--dsw-alias-border-l2': 'rgba(255,255,255,.13)',
  '--dsw-alias-border-l3': 'rgba(255,255,255,.18)',
  '--dsw-alias-border-l4': 'rgba(255,255,255,.24)',
  '--dsw-alias-border-inverted': 'rgba(0,0,0,.14)',
  '--dsw-alias-border-inverted2': 'rgba(0,0,0,.2)',
  '--dsw-alias-border-l2-darkmode-thin': 'rgba(255,255,255,.08)',
  // labels
  '--dsw-alias-label-primary': '#f2f2f0',
  '--dsw-alias-label-primary-bluish': '#f2f2f0',
  '--dsw-alias-label-primary-dimmed': 'rgba(242,242,240,.62)',
  // `label-primary-foreground` is text ON solid fills: the dark primary
  // button is signal yellow, so its label must be ink (#191919) to stay
  // legible — never paper/white on yellow.
  '--dsw-alias-label-primary-foreground': '#191919',
  '--dsw-alias-label-primary-inverted': '#191919',
  '--dsw-alias-label-secondary': '#c9c9c4',
  '--dsw-alias-label-tertiary': '#a8a8a2',
  '--dsw-alias-label-caption': '#8f8f8a',
  '--dsw-alias-label-dimmed': '#70706c',
  // brand: signal yellow
  '--dsw-alias-brand-primary': '#fffa00',
  '--dsw-alias-brand-primary-invert': '#191919',
  '--dsw-alias-brand-primary-new-colorprimary-new-color': '#fffa00',
  '--dsw-alias-brand-text': '#fffa00',
  // interactive
  '--dsw-alias-interactive-bg-hover': 'rgba(255,255,255,.07)',
  '--dsw-alias-interactive-bg-active': 'rgba(255,255,255,.12)',
  '--dsw-alias-interactive-bg-hover-accent': 'rgba(255,250,0,.13)',
  '--dsw-alias-interactive-bg-hover-danger': 'rgba(214,69,69,.14)',
  '--dsw-alias-interactive-bg-hover-solid': '#3a3a3a',
  // buttons: ink dock; one signal CTA
  '--dsw-alias-button-primary-fill': '#fffa00',
  '--dsw-alias-button-primary-hover': '#e6e100',
  '--dsw-alias-button-primary-dimmed': 'rgba(255,250,0,.5)',
  '--dsw-alias-button-contrast-fill': '#191919',
  '--dsw-alias-button-elevated-fill': '#2c2c2c',
  '--dsw-alias-button-floating-fill': '#282828',
  '--dsw-alias-button-floating-hover': '#323232',
  '--dsw-alias-button-info-fill': '#2a2a2a',
  '--dsw-alias-button-info-hover': '#343434',
  '--dsw-alias-button-tool-bar-fill': 'transparent',
  '--dsw-alias-button-tool-bar-fill-invisible': 'transparent',
  '--dsw-alias-button-tool-bar-hover': 'rgba(255,255,255,.06)',
  '--dsw-alias-button-ghost-active-fill': 'rgba(255,255,255,.06)',
  '--dsw-alias-button-ghost-active-hover': 'rgba(255,255,255,.1)',
  '--dsw-alias-button-ghost-active-border': 'rgba(255,255,255,.22)',
  // states
  '--dsw-alias-state-success-primary': '#00ffa2',
  '--dsw-alias-state-success-secondary': 'rgba(0,255,162,.14)',
  '--dsw-alias-state-success-tertiary': 'rgba(0,255,162,.09)',
  '--dsw-alias-state-warn-primary': '#fffa00',
  '--dsw-alias-state-warn-label': '#191919',
  '--dsw-alias-state-warn-secondary': 'rgba(255,250,0,.16)',
  '--dsw-alias-state-warn-tertiary': 'rgba(255,250,0,.1)',
  '--dsw-alias-state-error-primary': '#d64545',
  '--dsw-alias-state-error-secondary': 'rgba(214,69,69,.14)',
  '--dsw-alias-state-business-primary': '#fffa00',
  '--dsw-alias-state-business-tertiary': 'rgba(255,250,0,.1)',
  // surfaces & overlays
  '--dsw-alias-toast-bg': '#282828',
  '--dsw-alias-tooltip-bg': '#2c2c2c',
  '--dsw-specific-bubble': '#232323',
  '--dsw-specific-bubble-highlight': '#2c2c2c',
  '--dsw-specific-input-major': '#1e1e1e',
  '--dsw-specific-login-input': '#1e1e1e',
  '--dsw-specific-menu': '#282828',
  '--dsw-specific-selector': '#282828',
  '--dsw-specific-tip': '#282828',
  '--dsw-specific-sidebar-fill': '#1e1e1e',
  '--dsw-specific-sidebar-nav-item-active': '#2c2c2c',
  '--dsw-specific-sidebar-nav-item-active-accent': '#fffa00',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(255,255,255,.05)',
  // markdown
  '--dsw-alias-markdown-code-block': '#101010',
  '--dsw-alias-markdown-code-block-banner': '#1a1a1a',
  '--dsw-alias-markdown-code-segment-selected': 'rgba(255,250,0,.2)',
  '--dsw-alias-markdown-code-segment-unselected': 'rgba(255,255,255,.04)',
  '--dsw-alias-markdown-inline-code': 'rgba(255,250,0,.12)',
  '--dsw-alias-markdown-placeholder': 'rgba(242,242,240,.4)',
  '--dsw-alias-markdown-tag': 'rgba(255,250,0,.1)',
  '--dsw-alias-markdown-citation': 'rgba(255,250,0,.08)',
  // scrollbars
  '--dsw-alias-scrollbar-bg-l1': '#363636',
  '--dsw-alias-scrollbar-bg-l2': '#3f3f3f',
  '--dsw-alias-scrollbar-hover-l1': '#fffa00',
  '--dsw-alias-scrollbar-hover-l2': '#fffa00',
  // fonts
  '--dsw-font-family': '"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
  // thinking sweep: restrained signal shimmer
  '--dsw-linear-gradient-think': 'linear-gradient(90deg,transparent,rgba(255,250,0,.14),transparent)',
  '--dsw-linear-think-select': 'rgba(255,250,0,.25)',
}

/**
 * Serialize a token map into a themed selector block.
 * Light lands on `body:not(#__dsh_patch__)`; dark on
 * `body[data-ds-dark-theme]:not(#__dsh_patch__)`. The `:not()` qualifier
 * out-specifies both the base theme's rules and its lazy injection order.
 * @param {string} selector - CSS selector for the theme block.
 * @param {Record<string,string>} tokens - token name → value map.
 */
function tokensToCss(selector: string, tokens: Record<string, string>) {
  const body = Object.entries(tokens)
    .map(([k, v]) => `${k}:${v};`)
    .join('')
  return `${selector}{${body}}`
}

/** Component rules keyed on real dsh CSS-module class suffixes. */
const COMPONENT_CSS = `
/* calibration grid overlay: the boot scene's grid carried into the app UI,
   clipped to the left workspace (sidebar) column only — the conversation
   area stays clean. A fixed, pointer-transparent sheet — pure CSS, zero cost. */
body:not(#__dsh_patch__)::before{
  content:"";
  position:fixed;
  inset:0;
  z-index:9990;
  pointer-events:none;
  /* keep the grid inside the 280px sidebar column */
  clip-path:inset(0 calc(100% - 280px) 0 0);
  background-image:
    linear-gradient(rgba(25,25,25,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(25,25,25,.045) 1px, transparent 1px);
  background-size:44px 44px;
}
body[data-ds-dark-theme]:not(#__dsh_patch__)::before{
  background-image:
    linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
  background-size:44px 44px;
}

/* selection: signal fill, ink text */
body:not(#__dsh_patch__) ::selection{background:#fffa00;color:#111}
body[data-ds-dark-theme]:not(#__dsh_patch__) ::selection{background:#fffa00;color:#111}

/* scrollbars: square, structural */
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l1);border-radius:0}
::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l1)}
::-webkit-scrollbar-corner{background:transparent}

/* ---- typography: Endfield stacks; technical metadata in condensed ---- */
body:not(#__dsh_patch__){
  font-family:"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif !important;
}
[class*="timestamp"],[class*="meta"],[class*="caption"],[class*="badge"],
[class*="chip"],[class*="kicker"],[class*="count"],[class*="index"],
[class*="date"],[class*="version"],[class*="time"],[class*="sectionLabel"],
[class*="label"],[class*="status"],[class*="runStateLabel"]{
  font-family:"Arial Narrow","Roboto Condensed","DIN Condensed","Segoe UI",sans-serif;
  letter-spacing:.08em;
  font-variant-numeric:tabular-nums;
}
[class*="sectionLabel"],[class*="sectionHeader"],[class*="kicker"]{
  text-transform:uppercase;
}

/* ---- geometry: square controls, 1px rules ---- */
button,[role="button"]{
  border-radius:2px !important;
  transition:background 240ms cubic-bezier(.22,.8,.2,1),color 240ms cubic-bezier(.22,.8,.2,1),transform 240ms cubic-bezier(.22,.8,.2,1),box-shadow 240ms cubic-bezier(.22,.8,.2,1);
}
button:focus-visible,[role="button"]:focus-visible,input:focus-visible,textarea:focus-visible,[contenteditable="true"]:focus-visible{
  outline:2px solid #fffa00;
  outline-offset:2px;
}
textarea:focus,input:focus,[contenteditable="true"]:focus{
  outline:none;
  border-color:#fffa00 !important;
  box-shadow:inset 0 0 0 1px #fffa00;
}

/* ---- shell zones ---- */
/* sidebar: hairline right edge; active nav gets a signal index rail */
[class*="sidebarCol"]{border-right:1px solid var(--dsw-alias-border-l2)}
[class*="sidebarCol"] [class*="sectionHeader"],
[class*="sidebarCol"] > [class*="title"]:first-child{
  font-size:10px;
  letter-spacing:.16em;
}
/* the ONE crucial CTA: new session — signal fill, ink label, clipped wedge */
[class*="newSession"]{
  background:#fffa00 !important;
  color:#111 !important;
  border:1px solid #fffa00;
  font-weight:800 !important;
  clip-path:polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
}
[class*="newSession"]:hover{filter:brightness(.94);transform:translateY(-1px)}
[class*="newSession"]:active{transform:translateY(0)}

/* composer: hairline top rule; structural radius */
[class*="composerSeat"],[class*="composerStack"]{
  border-top:1px solid var(--dsw-alias-border-l2);
}
[class*="composerStack"] textarea,[class*="composerStack"] input{
  border-radius:2px;
  border:1px solid var(--dsw-alias-border-l2);
}
/* composer hero: long guide line under the headline */
[class*="composerHero"]{
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
[class*="composerHero"] [class*="headline"]{
  font-family:"Arial Narrow","Roboto Condensed","DIN Condensed","Segoe UI",sans-serif;
  letter-spacing:-.02em;
}

/* outline controls: model trigger, tool chips, preview toggles.
   !important: the dsh settings/other modules inject their CSS lazily, AFTER
   the patch's last re-application, and equal-specificity rules would then win
   (settings modal falls back to the stock rounded look). Important keeps the
   Endfield shape order-independent. */
[class*="trigger"],[class*="triggerLabel"],[class*="previewBadge"]{
  background:transparent;
  border:1px solid var(--dsw-alias-border-l2) !important;
  border-radius:2px !important;
  font-weight:600;
}
[class*="trigger"]:hover,[class*="triggerLabel"]:hover{
  background:var(--dsw-alias-interactive-bg-hover);
  box-shadow:inset 2px 0 0 #fffa00;
}

/* workspace rows: hover reveals signal left rail */
[class*="workspace"]:hover{
  background:var(--dsw-alias-interactive-bg-hover);
  box-shadow:inset 3px 0 0 #fffa00;
}
[class*="workspaceLabel"]{
  font-weight:700;
}

/* panels & bubbles: square, hairline, restrained (!important, see above) */
[class*="bubble"],[class*="card"],[class*="panel"],[class*="dialog"],[class*="menu"],[class*="tooltip"],[class*="toast"]{
  border-radius:2px !important;
}
[class*="bubble"]{
  border:1px solid var(--dsw-alias-border-l1) !important;
}
[class*="dialog"],[class*="menu"],[class*="toast"],[class*="tooltip"]{
  border:1px solid var(--dsw-alias-border-l2) !important;
  box-shadow:0 8px 30px rgba(0,0,0,.3) !important;
}
[class*="backdrop"]{background:rgba(0,0,0,.55) !important}
/* settings modal internals: nav cells, header actions, close — square even
   when the settings chunk CSS lands after the patch */
[class*="navCell"],[class*="navItem"]{
  border-radius:2px !important;
}
[class*="close"],[class*="closeButton"]{
  border-radius:2px !important;
}
[class*="input"],[class*="select"],[class*="textarea"]{
  border-radius:2px !important;
}

/* list rows: square hover */
[class*="list"] [class*="row"]:hover,
[class*="treeBody"] [class*="row"]:hover{
  background:var(--dsw-alias-interactive-bg-hover);
}

/* markdown code blocks: square, deep ink on dark / paper on light */
[class*="md-code-block"],[class*="codeBlock"]{
  border-radius:2px;
}

/* conversation panels: hairline top edge */
[class*="conversation"] [class*="panel"],[class*="conversation"] [class*="card"]{
  border-top:2px solid var(--dsw-alias-border-l2);
}
`

/**
 * Patch JS executed inside the dsh document after CSS injection.
 * Forces the Endfield ink shell when the user's 配色 preference is not an
 * explicit light choice: the industrial look is dark by design, and a
 * system-light desktop would otherwise keep the stock near-identical light UI.
 * @param {boolean} forceDark
 */
function patchJs(forceDark: boolean) {
  return `(() => {
    if (${forceDark}) {
      document.body.toggleAttribute('data-ds-dark-theme', true);
      document.documentElement.style.colorScheme = 'dark';
    }
    return true;
  })()`
}

/** Full patch stylesheet (both palettes; scheme chosen by the theme attribute). */
function buildUiPatchCss() {
  const light = tokensToCss('body:not(#__dsh_patch__)', LIGHT_TOKENS)
  const dark = tokensToCss('body[data-ds-dark-theme]:not(#__dsh_patch__)', DARK_TOKENS)
  return light + dark + COMPONENT_CSS
}

/** The dsh UI's render frame inside the chrome page's iframe, when loaded. */
function findSurfaceFrame(win: import('electron').BrowserWindow) {
  try {
    return win.webContents.mainFrame.frames.find((f) => /^https?:\/\/127\.0\.0\.1:\d+/.test(f.url))
  } catch {
    return null
  }
}

/**
 * Inject (or refresh) the patch into the dsh UI document.
 * A fixed `#__dsh_patch__` style element is overwritten on each call, so
 * re-applying is idempotent. Best-effort: failures only warn.
 * @param {import('electron').BrowserWindow} win
 * @param {{ forceDark?: boolean }} [opts] - forceDark forces the ink shell
 *   (used when the persisted 配色 preference is not an explicit light choice).
 * @returns {Promise<void>}
 */
async function applyUiPatches(win: import('electron').BrowserWindow, { forceDark = false }: { forceDark?: boolean } = {}) {
  if (!win || win.isDestroyed()) return
  const frame = findSurfaceFrame(win)
  if (!frame) {
    require('./log.ts').warn('ui patch: surface frame not found')
    return
  }
  const css = buildUiPatchCss()
  // Semicolon between the two IIFEs: without it the second '(' parses as a
  // call on the first IIFE's return value (`true(...) is not a function`).
  const script = `${patchJs(forceDark)};\n(() => {
    const id = '__dsh_patch__';
    let s = document.getElementById(id);
    if (!s) { s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
    s.textContent = ${JSON.stringify(css)};
    return true;
  })()`
  try {
    await frame.executeJavaScript(script)
  } catch (err: any) {
    require('./log.ts').warn(`ui patch inject failed: ${err.message}`)
  }
}

module.exports = { buildUiPatchCss, applyUiPatches, patchJs }
