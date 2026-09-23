/**
 * Point-and-click copy editing, inside the storefront page itself.
 *
 * Runs only on edit-mode renders (see components/EditClient.astro). Every
 * piece of copy the page shows is wrapped in `[data-edit]` by <T />; anything
 * without that attribute is data from Swell and gets no affordance at all.
 *
 * One click on copy selects it and opens its editor. A second click on the
 * same copy commits the edit and goes through to whatever the copy sits in:
 * a link navigates (or opens in a new tab when it would leave the editor),
 * a submit button submits its form, the cart link opens the drawer. Links
 * and buttons with no editable copy in them behave as they do for a shopper.
 *
 * The page normally sits in the editor shell's iframe. The two talk over
 * postMessage, same origin only:
 *
 *   shell → page  { type: 'outfitter:edit', id, value }      show this text
 *   page → shell  { type: 'outfitter:edited', id, value }    this was saved
 *   page → shell  { type: 'outfitter:page', url, locale,     this page is shown,
 *                    sections }                              in this locale, with
 *                                                            these section ids
 *   both ways     { type: 'outfitter:section-hover', id }    this home page
 *                                                            section is under
 *                                                            the pointer (null:
 *                                                            none is)
 *   shell → page  { type: 'outfitter:sections', hidden }     legacy: a hidden section
 *                                                            is no longer rendered at
 *                                                            all, so this is accepted
 *                                                            and ignored
 *   page → shell  { type: 'outfitter:section-move',          this section was dragged;
 *                    id, order }                             the page now shows
 *                                                            this order — of the
 *                                                            sections it renders
 *   page → shell  { type: 'outfitter:section-hide',          hide (true) or show
 *                    id, hidden }                            (false) this section
 *   page → shell  { type: 'outfitter:section-delete', id }   delete this section —
 *                                                            the shell asks first
 *   page → shell  { type: 'outfitter:section-select', id }   the merchant clicked
 *                                                            this section
 *   shell → page  { type: 'outfitter:section-select', id }   this section is the
 *                                                            selected one (null:
 *                                                            none is)
 *   page → shell  { type: 'outfitter:section-settings',      open its settings, and
 *                    id }                                    focus them
 *   shell → page  { type: 'outfitter:section-reveal', id }   scroll to this section —
 *                                                            asked for by the list,
 *                                                            never implied by
 *                                                            selecting one
 *
 * Opened on its own, the page still edits and saves; it just has nobody to
 * tell.
 */

import { SECTION_LABELS, type SectionType } from '@/lib/sections';

const EDIT_PARAM = '__edit';
const API = '/editor/api/content';
const SECTION_HOVER = 'outfitter:section-hover';
const SECTIONS = 'outfitter:sections';
const SECTION_MOVE = 'outfitter:section-move';
const SECTION_HIDE = 'outfitter:section-hide';
const SECTION_DELETE = 'outfitter:section-delete';
const SECTION_SELECT = 'outfitter:section-select';
const SECTION_SETTINGS = 'outfitter:section-settings';
const SECTION_REVEAL = 'outfitter:section-reveal';
/** Where the page was scrolled before the shell reloaded it. */
const SCROLL_KEY = 'outfitter:edit-scroll';
/** Narrowest the popover gets; wide enough for both hints and "Follow link" on one row. */
const POP_MIN_WIDTH = 320;
/** Pointer travel before a press on a chip becomes a drag. */
const DRAG_THRESHOLD = 6;
/** Viewport band at each end of the page where a drag scrolls on its own. */
const SCROLL_BAND = 48;
/** Fastest the page moves under a drag, per frame. */
const SCROLL_MAX = 24;
/**
 * How far past a neighbour's middle a section must travel to swap with it.
 *
 * Without it the two directions share one line: a section resting on it flips
 * order on every frame of an ordinary hand tremor, and a drop posts whichever
 * order the release frame happened to land on. Wide enough to swallow a tremor
 * and one full scroll step, narrow enough that a deliberate drag never notices.
 */
const SWAP_MARGIN = 24;
/** Pointer travel that settles whether a press inside a band meant to be there. */
const BAND_BREAK = 16;
/** How long a section takes to slide into a new place. */
const MOVE_MS = 220;
/** Air left under the sticky header by a section the shell's list scrolled to. */
const REVEAL_GAP = 8;

const STYLES = `
  [data-edit] {
    cursor: text;
    outline: 1px dashed transparent;
    outline-offset: 3px;
    transition: outline-color var(--dur-ui, 150ms) var(--ease, ease);
  }
  [data-edit]:hover {
    outline-color: color-mix(in srgb, var(--color-primary) 60%, transparent);
  }
  [data-edit].is-editing,
  [data-edit]:focus-visible {
    outline: 2px solid var(--color-primary);
  }
  /* Selected copy in a link or a submit button: the next click goes through. */
  a[href] [data-edit].is-editing,
  button [data-edit].is-editing {
    cursor: pointer;
  }
  [data-section] {
    position: relative;
    /* Own stacking context, so the frame and label below sit above every
       child no matter what z-index or compositing the child brings. */
    isolation: isolate;
  }
  /* Drawn as an overlay rather than an outline: an outline paints in the
     section's own layer, so cards with their own layers cover it. Inset by
     a pixel because the home page is flush against the sticky header. */
  [data-section]::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2147483646;
    border: 1px dashed transparent;
    pointer-events: none;
    transition: border-color var(--dur-ui, 150ms) var(--ease, ease);
  }
  [data-section]:hover::after,
  [data-section].is-hover::after {
    border-color: color-mix(in srgb, var(--color-muted) 70%, transparent);
  }
  /* The one the shell's settings panel is showing. It keeps the dashed frame
     every section gets and separates itself by colour alone — a solid border
     read as a different kind of thing rather than a stronger version of the
     same one. */
  [data-section].is-selected::after {
    border-color: var(--color-primary);
  }
  [data-section].is-dragging {
    z-index: 30; /* above the sticky header (20) while it travels */
    background: var(--color-background);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.35);
    will-change: transform;
  }
  [data-section].is-dragging::after {
    border-color: var(--color-primary);
    border-style: solid;
  }
  html.edit-dragging {
    user-select: none;
    -webkit-user-select: none;
    /* A swap moves the DOM under the pointer; scroll anchoring would follow
       the anchor node and jump the page at the moment of the swap. */
    overflow-anchor: none;
  }
  html.edit-dragging,
  html.edit-dragging * {
    cursor: grabbing !important;
  }
  /* Only the dragged section keeps its frame and chip while a drag is on. */
  html.edit-dragging [data-section]:not(.is-dragging)::after {
    border-color: transparent;
  }
  html.edit-dragging [data-section]:not(.is-dragging) > .edit-sec {
    opacity: 0;
  }
  /* The corner chip: label, drag grip, settings, hide, delete. A real element,
     so it can be pressed; above the ::after frame. Not hit-testable while unseen. */
  .edit-sec {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2147483647;
    display: flex;
    align-items: stretch;
    background: var(--color-muted);
    color: var(--color-background);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    line-height: 1.4;
    opacity: 0;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
    transition: opacity var(--dur-ui, 150ms) var(--ease, ease);
  }
  [data-section]:hover > .edit-sec,
  [data-section]:focus-within > .edit-sec,
  [data-section].is-hover > .edit-sec,
  [data-section].is-dragging > .edit-sec,
  [data-section].is-selected > .edit-sec {
    opacity: 1;
    pointer-events: auto;
  }
  /* No hover on a touch screen: the chip is always there to find. */
  @media (hover: none) {
    .edit-sec {
      opacity: 1;
      pointer-events: auto;
    }
  }
  /* The category anchor has no padding of its own — the page reads as it did
     before it was a section — so its eyebrow is exactly where the chip lands,
     and covered copy cannot be clicked to edit. Every other section's own top
     padding already leaves the chip a row to itself. Edit mode only. */
  [data-section-type="category_products"] {
    padding-top: 1.5rem;
  }
  .edit-sec__grip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 1.5rem;
    padding: 0.125rem 0.375rem;
    cursor: grab;
    touch-action: none;
  }
  .edit-sec__grip:focus {
    outline: none;
  }
  .edit-sec__dots {
    font-size: 0.75rem;
    line-height: 1;
    opacity: 0.7;
  }
  .edit-sec__btn {
    display: inline-flex;
    align-items: center;
    min-height: 1.5rem;
    margin: 0;
    padding: 0.125rem 0.375rem;
    border: 0;
    border-left: 1px solid color-mix(in srgb, var(--color-background) 30%, transparent);
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    line-height: inherit;
    cursor: pointer;
  }
  .edit-sec__btn:hover,
  .edit-sec__btn:focus-visible {
    background: var(--color-primary);
    color: var(--color-secondary);
    outline: none;
  }
  .edit-pop {
    position: absolute;
    z-index: 1000;
    box-sizing: border-box;
    display: grid;
    gap: 0.5rem;
    min-width: 20rem;
    max-width: calc(100vw - 2rem);
    padding: 0.5rem;
    border: 1px solid var(--color-primary);
    background: var(--color-background);
    color: var(--color-text);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
    font-family: var(--font-sans);
    letter-spacing: 0;
  }
  .edit-pop__field {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: 0.4375rem 0.625rem;
    border: 1px solid color-mix(in srgb, var(--color-border) 65%, var(--color-text));
    border-radius: 0;
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: 0.9375rem;
    line-height: 1.4;
    letter-spacing: 0;
    resize: none;
    overflow: hidden;
  }
  /* The whole value is selected on open; the storefront's solid ::selection
     made the field look filled in. */
  .edit-pop__field::selection {
    background: color-mix(in srgb, var(--color-primary) 30%, transparent);
    color: inherit;
  }
  .edit-pop__field:focus {
    border-color: var(--color-primary);
    outline: none;
  }
  /* One row: the two key hints on the left, the action (if any) on the right;
     28px tall with or without the action, so the popover never jumps. Padded
     on the left by the field's border + padding, so the hints line up with
     the typed text and the action sits flush with the field's right edge. */
  .edit-pop__hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem 0.875rem;
    min-height: 1.75rem;
    padding: 0 0 0 0.6875rem;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    line-height: 1;
    white-space: nowrap;
    color: var(--color-muted);
  }
  .edit-pop__hint > span {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }
  .edit-pop__hint kbd {
    font: inherit;
    color: var(--color-text);
  }
  .edit-pop__act {
    display: inline-flex;
    align-items: center;
    height: 1.75rem;
    margin: 0 0 0 auto;
    padding: 0 0.625rem;
    border: 1px solid var(--color-primary);
    border-radius: 0;
    background: transparent;
    color: var(--color-primary);
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .edit-pop__act:hover,
  .edit-pop__act:focus-visible {
    background: var(--color-primary);
    color: var(--color-secondary);
  }
  .edit-toast {
    position: absolute;
    z-index: 1001;
    max-width: 24rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-primary);
    color: var(--color-secondary);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    line-height: 1.4;
    pointer-events: none;
  }
`;

interface Session {
  el: HTMLElement;
  id: string;
  original: string;
  /** The copy's own tooltip, swapped for "Click again…" while it is selected. */
  title: string;
  pop: HTMLElement;
  field: HTMLInputElement | HTMLTextAreaElement;
  closed: boolean;
}

interface Drag {
  el: HTMLElement; // the section under the pointer
  grip: HTMLElement; // the chip's grip the press landed on
  capture: HTMLElement; // document.body: holds the pointer capture, never moves in the DOM
  pointerId: number;
  startClientY: number;
  startScrollY: number;
  lastClientY: number;
  startTop: number; // page-coordinate top of `el` at pointerdown
  startOrder: string[];
  startBefore: HTMLElement | null; // the section `el` sat before (null: it was last), for Escape
  headerBottom: number; // viewport y the sticky header ends at; no autoscroll zone above it
  bandFrom: 1 | -1 | 0; // band the press landed in, suppressed until the merchant means it
  bandFromY: number; // where the pointer was when it landed there
  pressY: number; // the pointerdown itself, before the drag threshold moved it
  started: boolean;
  raf: number;
  /** Where every section sits with no transform on it, in page coordinates. */
  natural: Map<HTMLElement, { top: number; height: number }>;
}

/** The page this document is, as its rendered sections declare it. */
function sectionsPage(): string | null {
  return (
    document.querySelector<HTMLElement>('[data-sections-page]')?.dataset.sectionsPage ?? null
  );
}

export function startEditClient(): void {
  const root = document.documentElement;
  const locale = root.dataset.editLocale || '';
  const origin = location.origin;
  const shell = window.parent !== window ? window.parent : null;
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  let session: Session | null = null;
  let drag: Drag | null = null;

  // The selected copy the pointer went down on. Pressing it moves focus off
  // the field, which commits and closes the editor before the click arrives —
  // so by click time `session` is gone, and this is how a second click is
  // told from a first.
  let pressed: HTMLElement | null = null;

  // A press that went through the drag machinery has just ended, so the click
  // that closes it belongs to the drag and must not select a section.
  let justDragged = false;

  // The one form a second click (or the popover's Submit) has just let
  // through. The submit handler passes it once and forgets it.
  let armed: HTMLFormElement | null = null;

  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.append(style);

  function tell(message: Record<string, unknown>): void {
    shell?.postMessage(message, origin);
  }

  function editables(id: string): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(`[data-edit="${CSS.escape(id)}"]`),
    );
  }

  function setText(id: string, value: string): void {
    for (const el of editables(id)) {
      el.textContent = value;
    }
  }

  function humanize(id: string): string {
    return id.replace(/_/g, ' ');
  }

  /**
   * The copy a click lands on. To a pointer, a button is its label: a click
   * on the padding around an editable label counts as a click on the label,
   * so the button never submits on a first click wherever it is hit. A click
   * the keyboard made — Enter in a field, submitting through the form's
   * button — is not on the label, and goes on to the submit handler.
   */
  function editableAt(
    target: EventTarget | null,
    pointer: boolean,
  ): HTMLElement | null {
    const node = target as Element | null;
    const own = node?.closest<HTMLElement>('[data-edit]') ?? null;

    if (own || !pointer) {
      return own;
    }

    return node?.closest('button')?.querySelector<HTMLElement>('[data-edit]') ?? null;
  }

  /** The submit button this copy is the label of, if it is one. */
  function submitButtonOf(el: HTMLElement): HTMLButtonElement | null {
    const button = el.closest('button');

    return button?.type === 'submit' && button.form ? button : null;
  }

  // Anything that leaves the store — the hosted checkout, mailto:, logging
  // out — is opened in a new tab, so the editor is not lost.
  function leavesEditor(anchor: HTMLAnchorElement): boolean {
    const url = new URL(anchor.href, location.href);

    return (
      url.origin !== origin ||
      anchor.target === '_blank' ||
      url.pathname === '/account/logout'
    );
  }

  // ---- affordances ---------------------------------------------------------

  document.querySelectorAll<HTMLElement>('[data-edit]').forEach((el) => {
    el.tabIndex = 0;
    el.title = `Edit: ${humanize(el.dataset.edit ?? '')}`;
  });

  // Home page sections: an outline, and a chip in the corner that names the
  // section, drags it up or down the page, opens its settings, hides it or
  // deletes it. The shell is told which one is under the pointer, so its list
  // shows the same.
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => {
    const type = el.dataset.sectionType as SectionType | undefined;
    const label = (type && SECTION_LABELS[type]) || type || '';

    const chip = document.createElement('div');
    chip.className = 'edit-sec';
    chip.setAttribute('role', 'group');
    chip.setAttribute('aria-label', `${label} section`);

    const grip = document.createElement('span');
    grip.className = 'edit-sec__grip';
    grip.title = 'Drag to move';
    // Focusable by script only: a drag moves focus here so Escape reaches this
    // document (see beginDrag), not the shell's.
    grip.tabIndex = -1;
    const dots = document.createElement('span');
    dots.className = 'edit-sec__dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.textContent = '⠿';
    const name = document.createElement('span');
    name.className = 'edit-sec__label';
    name.textContent = label;
    grip.append(dots, name);

    chip.append(grip);

    // Settings, moving, hiding and deleting are the shell's: on its own the
    // page only shows the label.
    if (shell) {
      const settings = chipButton('Settings', `Settings for the ${label} section`, () => {
        tell({ type: SECTION_SETTINGS, id: el.dataset.section });
      });
      // A rendered section is by definition a shown one: hiding it is the
      // only thing this button can mean. Showing again is the shell's list.
      const hide = chipButton('Hide', `Hide ${label} section from shoppers`, () => {
        tell({ type: SECTION_HIDE, id: el.dataset.section, hidden: true });
      });
      const del = chipButton('Delete', `Delete ${label} section`, () => {
        tell({ type: SECTION_DELETE, id: el.dataset.section });
      });
      del.setAttribute('aria-haspopup', 'dialog');

      // The page's required section keeps its settings and its grip — it can be
      // moved, and what it says is the merchant's — but offers no way to hide
      // or delete it, because the page cannot do its job without it.
      if (el.hasAttribute('data-section-required')) {
        chip.append(settings);
      } else {
        chip.append(settings, hide, del);
      }

      grip.addEventListener('pointerdown', (event) => startDrag(event, el, grip));
    }

    el.append(chip);

    el.addEventListener('mouseenter', () => {
      if (!drag) tell({ type: SECTION_HOVER, id: el.dataset.section ?? null });
    });
    el.addEventListener('mouseleave', () => {
      if (!drag) tell({ type: SECTION_HOVER, id: null });
    });
  });

  function chipButton(text: string, label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'edit-sec__btn';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', action);
    return button;
  }

  /**
   * A click on a blank part of a section — not its copy, not a control, not
   * the chip — selects it in the shell and opens its settings. Nothing is
   * prevented here: a plain link with no editable copy in it still follows.
   */
  function selectSection(event: MouseEvent): void {
    if (!shell || drag) return;

    // Releasing a text selection fires a click too. Selecting a product name
    // or price (Swell data, no [data-edit]) is not asking for the panel.
    if (!window.getSelection()?.isCollapsed) return;

    const target = event.target;

    if (!(target instanceof Element)) return;

    // The chip is a child of the section, so its own buttons land here too.
    if (target.closest('.edit-sec')) return;
    if (
      target.closest(
        'a[href], button, input, select, textarea, label, summary, [role="button"], [data-edit]',
      )
    ) {
      return;
    }

    const section = target.closest<HTMLElement>('[data-section]');

    if (!section?.dataset.section) return;

    tell({ type: SECTION_SELECT, id: section.dataset.section });
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      // A fresh press: whatever the last one left behind is spent. A gesture
      // that ends in pointercancel never produces a click, so its flag must
      // not swallow the next real one.
      justDragged = false;

      const el = editableAt(event.target, true);
      pressed = el && session?.el === el ? el : null;
    },
    true,
  );

  // Capture phase, so a first click never reaches the link or button the
  // copy sits in — a "Browse" label opens its editor rather than navigating.
  // A second click on the selected copy commits and is left alone, so the
  // link or button gets it.
  document.addEventListener(
    'click',
    (event) => {
      // The click that closes a drag belongs to the drag: consumed here, in
      // the first handler that sees it, rather than cleared on a timer.
      const dragged = justDragged;
      justDragged = false;

      const el = editableAt(event.target, event.detail > 0);

      if (!el) {
        if (!dragged) selectSection(event);
        return;
      }

      if (el === pressed || session?.el === el) {
        pressed = null;

        if (session) {
          commit(session);
        }

        armed = submitButtonOf(el)?.form ?? null;
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const state = open(el);
      const anchor = el.closest<HTMLAnchorElement>('a[href]');

      // Every link, not only the ones that leave the editor: a first click
      // on "Shop" opens its editor, and the merchant is told why nothing
      // else happened — the same as a button's label says.
      if (anchor) {
        toast(state.pop, 'Click again to open');
      } else if (submitButtonOf(el)) {
        toast(state.pop, 'Click again to submit');
      }
    },
    true,
  );

  document.addEventListener('keydown', (event) => {
    // Mid-drag the page is under transforms; a popover placed now would drift.
    if (drag) return;

    const el = event.target as HTMLElement | null;

    if (!el?.matches?.('[data-edit]')) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(el);
    }
  });

  // ---- inline editor -------------------------------------------------------

  function open(el: HTMLElement): Session {
    if (session) {
      if (session.el === el) {
        return session;
      }

      commit(session);
    }

    const id = el.dataset.edit ?? '';
    const long = el.dataset.editType === 'long_text';
    const original = el.textContent ?? '';

    const pop = document.createElement('div');
    pop.className = 'edit-pop';

    const field = document.createElement(long ? 'textarea' : 'input');
    field.className = 'edit-pop__field';
    field.value = original;
    field.setAttribute('aria-label', humanize(id));

    if (field instanceof HTMLTextAreaElement) {
      field.rows = 2;
    } else {
      field.type = 'text';
    }

    const hint = document.createElement('div');
    hint.className = 'edit-pop__hint';
    hint.append(
      keys(long ? `${mac ? '⌘' : 'Ctrl'}+Enter` : 'Enter', 'save'),
      keys('Esc', 'cancel'),
    );

    pop.append(field, hint);
    document.body.append(pop);

    const state: Session = { el, id, original, title: el.title, pop, field, closed: false };
    session = state;

    // Keyboard parity with the second click: the same action, from the
    // popover, for copy that sits in a link or a submit button.
    const anchor = el.closest('a[href]');
    const button = submitButtonOf(el);

    if (anchor || button) {
      const act = document.createElement('button');
      act.type = 'button';
      act.className = 'edit-pop__act';
      act.textContent = anchor ? 'Follow link ↗' : 'Submit';
      // Pressing it must not move focus off the field: that would commit and
      // remove the popover before the click lands.
      act.addEventListener('mousedown', (event) => event.preventDefault());
      act.addEventListener('click', () => {
        commit(state);
        proceed(el);
      });
      hint.append(act);
    }

    el.classList.add('is-editing');
    // The pointer says the next click goes through; the tooltip must not
    // still say "Edit".
    el.title = anchor ? 'Click again to open' : button ? 'Click again to submit' : el.title;
    place(pop, el);
    grow(field);

    field.addEventListener('input', () => grow(field));
    field.addEventListener('keydown', (raw) => {
      const event = raw as KeyboardEvent;

      if (event.key === 'Escape') {
        // Stop here: the drawer closes on Escape too, and a cancelled edit
        // inside it should leave it open.
        event.preventDefault();
        event.stopPropagation();
        cancel(state);
        return;
      }

      const save = long
        ? event.key === 'Enter' && (event.metaKey || event.ctrlKey)
        : event.key === 'Enter';

      if (save) {
        event.preventDefault();
        commit(state);
      }
    });
    // Focus leaving the popover commits; moving between the field and its
    // button does not.
    pop.addEventListener('focusout', (event) => {
      if (!pop.contains(event.relatedTarget as Node | null)) {
        commit(state);
      }
    });

    field.focus();

    if (!long) {
      field.select();
    }

    return state;
  }

  /** What a second click on this copy does, for the popover's button. */
  function proceed(el: HTMLElement): void {
    const anchor = el.closest<HTMLAnchorElement>('a[href]');

    if (anchor) {
      // A real click, so the link's own handlers run — the cart link opens
      // the drawer — and the navigation handler below does the rest.
      anchor.click();
      return;
    }

    const button = submitButtonOf(el);

    if (button?.form) {
      armed = button.form;
      button.form.requestSubmit(button);
    }
  }

  function keys(key: string, action: string): HTMLElement {
    const span = document.createElement('span');
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    span.append(kbd, ` ${action}`);
    return span;
  }

  function place(pop: HTMLElement, el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, POP_MIN_WIDTH),
      window.innerWidth - 32,
    );
    const left = Math.max(
      16,
      Math.min(rect.left, window.innerWidth - width - 16),
    );

    pop.style.width = `${width}px`;
    pop.style.left = `${left + window.scrollX}px`;
    pop.style.top = `${rect.bottom + 6 + window.scrollY}px`;
  }

  function grow(field: HTMLInputElement | HTMLTextAreaElement): void {
    if (field instanceof HTMLTextAreaElement) {
      field.style.height = 'auto';
      field.style.height = `${field.scrollHeight + 2}px`;
    }
  }

  function teardown(state: Session): void {
    state.closed = true;
    state.pop.remove();
    state.el.classList.remove('is-editing');
    state.el.title = state.title;

    if (session === state) {
      session = null;
    }
  }

  function cancel(state: Session): void {
    if (state.closed) {
      return;
    }

    teardown(state);
    state.el.focus();
  }

  async function commit(state: Session): Promise<void> {
    if (state.closed) {
      return;
    }

    const value = state.field.value;
    teardown(state);

    if (value === state.original) {
      return;
    }

    // Optimistic: the page shows the new copy before the save lands, and only
    // goes back if it does not.
    setText(state.id, value);

    try {
      const res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ id: state.id, locale, value, page: sectionsPage() }),
        // A second click on a link commits and navigates in one go; the
        // save must outlive the page it was made on.
        keepalive: true,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }

      tell({ type: 'outfitter:edited', id: state.id, value });
    } catch (err) {
      setText(state.id, state.original);
      toast(state.el, `Not saved — ${(err as Error).message}`);
    }
  }

  function toast(anchor: Element, text: string): void {
    const note = document.createElement('div');
    note.className = 'edit-toast';
    note.setAttribute('role', 'status');
    note.textContent = text;
    document.body.append(note);

    const rect = anchor.getBoundingClientRect();
    note.style.left = `${Math.max(16, rect.left) + window.scrollX}px`;
    note.style.top = `${rect.bottom + 6 + window.scrollY}px`;

    window.setTimeout(() => note.remove(), 4000);
  }

  // ---- navigation and forms ------------------------------------------------

  // Links keep the page in edit mode; the ones that would leave it open in a
  // new tab instead. Only clicks that got this far — a second click on copy,
  // or a first click on anything with no copy to edit.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');

    if (!anchor) {
      return;
    }

    const url = new URL(anchor.href, location.href);

    if (url.origin === origin && url.pathname === location.pathname && url.hash) {
      return;
    }

    event.preventDefault();

    if (leavesEditor(anchor)) {
      window.open(url.toString(), '_blank', 'noopener');
      return;
    }

    url.searchParams.set(EDIT_PARAM, '1');
    location.assign(url.toString());
  });

  // The merchant is editing, not shopping: a form submits only when a second
  // click on its button's copy armed it, or when it says so itself with
  // `data-edit-allow` — the header's language and currency control, which a
  // merchant switching to edit another language is not "shopping" with.
  // Capture phase, so the drawer's own add-to-cart handler never sees a
  // submit that was held back.
  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target as HTMLFormElement;

      if (form === armed) {
        armed = null;
        return;
      }

      if (form.hasAttribute('data-edit-allow')) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      toast(event.submitter ?? form, 'Click again to submit');
    },
    true,
  );

  // ---- moving sections -----------------------------------------------------

  function sections(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-section]'));
  }

  function nextSection(el: Element): HTMLElement | null {
    let node = el.nextElementSibling;
    while (node && !(node instanceof HTMLElement && node.hasAttribute('data-section'))) {
      node = node.nextElementSibling;
    }
    return node as HTMLElement | null;
  }

  function prevSection(el: Element): HTMLElement | null {
    let node = el.previousElementSibling;
    while (node && !(node instanceof HTMLElement && node.hasAttribute('data-section'))) {
      node = node.previousElementSibling;
    }
    return node as HTMLElement | null;
  }

  function startDrag(event: PointerEvent, el: HTMLElement, grip: HTMLElement): void {
    if (event.button !== 0 || drag) {
      return;
    }

    // No text selection and no focus change from the press. Focus staying put
    // means the popover's focusout never fires, so an open edit is committed
    // here — it is placed in page coordinates and would drift under transforms.
    event.preventDefault();

    if (session) {
      commit(session);
    }

    const rect = el.getBoundingClientRect();
    const header = document.querySelector('.site-header')?.getBoundingClientRect();
    // The body holds the capture: moving the section in the DOM would release
    // a capture held by anything inside it.
    const capture = document.body;

    drag = {
      el,
      grip,
      capture,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startScrollY: window.scrollY,
      lastClientY: event.clientY,
      startTop: rect.top + window.scrollY,
      startOrder: sections().map((s) => s.dataset.section ?? ''),
      startBefore: nextSection(el),
      headerBottom: Math.max(0, header?.bottom ?? 0),
      bandFrom: 0,
      bandFromY: event.clientY,
      pressY: event.clientY,
      started: false,
      raf: 0,
      natural: new Map(),
    };

    capture.setPointerCapture(event.pointerId);
    capture.addEventListener('pointermove', onDragMove);
    capture.addEventListener('pointerup', onDragEnd);
    capture.addEventListener('pointercancel', onDragEnd);
    capture.addEventListener('lostpointercapture', onDragEnd);
  }

  function onDragMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    drag.lastClientY = event.clientY;

    if (!drag.started) {
      if (Math.abs(event.clientY - drag.startClientY) < DRAG_THRESHOLD) {
        return;
      }
      beginDrag(drag);
    }

    followPointer(drag);
  }

  function onDragEnd(event: Event): void {
    if (!drag) {
      return;
    }
    if (event instanceof PointerEvent && event.pointerId !== drag.pointerId) {
      return;
    }
    // A gesture the browser cut short (a palm, an edge swipe) was never a
    // drop: the section goes back, as it does on Escape.
    finishDrag(drag, event.type !== 'pointercancel');
  }

  function beginDrag(d: Drag): void {
    d.started = true;
    root.classList.add('edit-dragging');
    d.el.classList.add('is-dragging');
    d.el.style.transition = 'none';
    // Focus into this document: after a click in the shell's rail the shell
    // has it, and Escape would never arrive here. preventDefault on the press
    // kept focus where it was, so it is moved by hand.
    d.grip.focus({ preventScroll: true });
    // The list highlights the row that is moving, and nothing else until the drop.
    tell({ type: SECTION_HOVER, id: d.el.dataset.section ?? null });
    // A grab right after a drop finds sections still sliding home: they are
    // put there now, and their settle's cleanup retired — its seq no longer
    // matches — so it cannot strip `is-dragging` from this drag later.
    for (const s of sections()) {
      if (settling.has(s)) {
        settling.delete(s);
        s.style.transition = 'none';
        s.style.transform = '';
        // Its cleanup is retired with it, and that cleanup was what would have
        // taken the class off. The section being dragged keeps the one it was
        // just given.
        if (s !== d.el) s.classList.remove('is-dragging');
      }
    }

    // A grip near the top or bottom of the window puts the press inside a band.
    // Scrolling the moment a section is picked up is the band armed by where
    // the merchant happened to grab rather than by what they asked for, so it
    // stays quiet until the pointer leaves that band once.
    d.bandFrom =
      d.lastClientY < d.headerBottom + SCROLL_BAND
        ? -1
        : d.lastClientY > window.innerHeight - SCROLL_BAND
          ? 1
          : 0;
    // From the press, not from here: a drag begins DRAG_THRESHOLD away from
    // where the hand went down, so measuring from here hands the toll most of
    // its distance for free.
    d.bandFromY = d.pressY;
    d.startTop = d.el.getBoundingClientRect().top + window.scrollY;
    // The grab point is where the pointer is now, not where the press was:
    // the first painted frame starts from rest instead of a threshold's hop.
    d.startClientY = d.lastClientY;
    d.startScrollY = window.scrollY;
    measure(d);
    d.raf = requestAnimationFrame(() => autoscroll(d));
  }

  /** Where the dragged section's top is meant to be, in page coordinates. */
  function visualTopOf(d: Drag): number {
    return d.startTop + (d.lastClientY + window.scrollY) - (d.startClientY + d.startScrollY);
  }

  /** Records every section's transform-free position. Call only while no transform is applied. */
  function measure(d: Drag): void {
    d.natural.clear();
    for (const s of sections()) {
      const r = s.getBoundingClientRect();
      d.natural.set(s, { top: r.top + window.scrollY, height: r.height });
    }
  }

  /**
   * Keeps the dragged section under the pointer and swaps it past a neighbour
   * once its leading edge crosses that neighbour's middle: its bottom edge
   * going down, its top edge going up. Neighbours are measured where they
   * settle, not where they are mid-slide, so a swap never flips straight back.
   */
  function followPointer(d: Drag): void {
    const visualTop = visualTopOf(d);

    for (let guard = 0; guard < 40; guard += 1) {
      const own = d.natural.get(d.el);
      if (!own) break;

      const next = nextSection(d.el);
      const prev = prevSection(d.el);
      const nextNat = next ? d.natural.get(next) : undefined;
      const prevNat = prev ? d.natural.get(prev) : undefined;

      // Each direction has its own line, SWAP_MARGIN either side of the
      // neighbour's middle. One shared line has no deadband at all: a section
      // resting on it swaps back and forth with every tremor.
      if (next && nextNat && visualTop + own.height > nextNat.top + nextNat.height / 2 + SWAP_MARGIN) {
        moveDragged(d, next.nextElementSibling, visualTop);
        continue;
      }
      if (prev && prevNat && visualTop < prevNat.top + prevNat.height / 2 - SWAP_MARGIN) {
        moveDragged(d, prev, visualTop);
        continue;
      }
      break;
    }

    const own = d.natural.get(d.el);
    d.el.style.transform = `translateY(${visualTop - (own?.top ?? visualTop)}px)`;
  }

  /**
   * Puts the dragged section before `before` (null: last) and slides the
   * sections that moved to make room — FLIP: First (where they are, mid-slide
   * included), Last (where they land, transforms cleared), Invert, Play.
   */
  function moveDragged(d: Drag, before: Element | null, visualTop: number): void {
    const others = sections().filter((s) => s !== d.el);
    const first = new Map(
      others.map((s): [HTMLElement, number] => [s, s.getBoundingClientRect().top]),
    );

    for (const s of others) {
      s.style.transition = 'none';
      s.style.transform = '';
    }

    d.el.parentNode?.insertBefore(d.el, before);
    // Rects include transforms: the dragged section is measured with none on
    // it, or its natural top would be off by the last translate.
    d.el.style.transform = '';
    measure(d);

    const moved: HTMLElement[] = [];
    for (const [s, top] of first) {
      const delta = top - ((d.natural.get(s)?.top ?? 0) - window.scrollY);
      if (Math.abs(delta) > 0.5) {
        s.style.transform = `translateY(${delta}px)`;
        moved.push(s);
      }
    }

    const own = d.natural.get(d.el);
    d.el.style.transform = `translateY(${visualTop - (own?.top ?? visualTop)}px)`;

    // The inverted positions must be laid out before they become the start
    // of a transition.
    void document.body.offsetHeight;

    for (const s of moved) {
      settle(s);
    }
  }

  // Each element's newest slide; an older slide's cleanup must not cut a
  // newer one short.
  const settling = new WeakMap<HTMLElement, number>();
  let settleSeq = 0;

  /** Slides a section from its current transform to none, then clears the inline styles. */
  function settle(s: HTMLElement, done?: () => void): void {
    const seq = ++settleSeq;
    settling.set(s, seq);
    s.style.transition = `transform ${MOVE_MS}ms var(--ease, ease)`;
    s.style.transform = '';

    const finish = (): void => {
      // Always let go of the listener: a slide cut short by a newer one
      // would otherwise leave its listener on the section for good.
      s.removeEventListener('transitionend', onEnd);
      if (settling.get(s) !== seq) return;
      settling.delete(s);
      s.style.transition = '';
      done?.();
    };
    const onEnd = (event: Event): void => {
      if (event.target === s && (event as TransitionEvent).propertyName === 'transform') finish();
    };

    s.addEventListener('transitionend', onEnd);
    // Reduced motion makes the transition near-instant; a detached element
    // never fires transitionend at all.
    window.setTimeout(finish, MOVE_MS + 80);
  }

  /** Scrolls the page while the pointer sits near the top (below the sticky header) or bottom. */
  function autoscroll(d: Drag): void {
    if (drag !== d) {
      return;
    }

    const top = d.headerBottom + SCROLL_BAND;
    const bottom = window.innerHeight - SCROLL_BAND;
    let step = 0;

    if (d.lastClientY < top) {
      step = -Math.min(SCROLL_MAX, Math.ceil((top - d.lastClientY) / 3));
    } else if (d.lastClientY > bottom) {
      step = Math.min(SCROLL_MAX, Math.ceil((d.lastClientY - bottom) / 3));
    }

    // Two ways out of the suppression, because a press inside a band says
    // nothing either way. Leaving the band settles it, and so does pushing
    // deeper in: a drag heading for the edge wants the edge. Both ask for real
    // travel, so the tremor of a held hand is neither — and clearing it on any
    // frame the band happened to read zero was exactly that mistake, while
    // waiting only for an exit stranded every gesture already pointed inward.
    if (d.bandFrom !== 0) {
      const away =
        d.bandFrom === 1
          ? d.lastClientY <= bottom - BAND_BREAK
          : d.lastClientY >= top + BAND_BREAK;
      const deeper =
        d.bandFrom === 1
          ? d.lastClientY - d.bandFromY >= BAND_BREAK
          : d.bandFromY - d.lastClientY >= BAND_BREAK;
      if (away || deeper) d.bandFrom = 0;
    }

    if (Math.sign(step) === d.bandFrom) step = 0;

    if (step) {
      const before = window.scrollY;
      window.scrollBy(0, step);
      if (window.scrollY !== before) followPointer(d);
    }

    d.raf = requestAnimationFrame(() => autoscroll(d));
  }

  /** Release (keep = true) or Escape (keep = false, back where it started). */
  function finishDrag(d: Drag, keep: boolean): void {
    // Before the `started` guard: a press on the grip that never passed the
    // threshold still ends in a click, and that click is the grip's, not a
    // request to select the section it sits on.
    justDragged = true;
    drag = null;
    cancelAnimationFrame(d.raf);
    d.capture.removeEventListener('pointermove', onDragMove);
    d.capture.removeEventListener('pointerup', onDragEnd);
    d.capture.removeEventListener('pointercancel', onDragEnd);
    d.capture.removeEventListener('lostpointercapture', onDragEnd);
    if (d.capture.hasPointerCapture(d.pointerId)) {
      d.capture.releasePointerCapture(d.pointerId);
    }
    root.classList.remove('edit-dragging');

    if (!d.started) {
      return;
    }

    d.grip.blur();

    if (!keep) {
      moveDragged(d, d.startBefore, visualTopOf(d));
    }

    // The dragged section slides into its slot, still on top; the rest lose
    // the `transition: none` they were given while the drag was on.
    settle(d.el, () => d.el.classList.remove('is-dragging'));
    for (const s of sections()) {
      if (!settling.has(s)) s.style.transition = '';
    }
    // The section followed the pointer, so it is still under it: the list
    // keeps its row lit until the pointer leaves (mouseleave says so).
    tell({ type: SECTION_HOVER, id: d.el.dataset.section ?? null });

    const order = sections().map((s) => s.dataset.section ?? '');
    const id = d.el.dataset.section ?? '';

    if (order.join('\n') !== d.startOrder.join('\n')) {
      tell({ type: SECTION_MOVE, id, order });
    }
  }

  // Escape while dragging: the section goes back and nothing is told. Stopped
  // here so nothing else on the document (the drawer's own Escape) acts on it.
  document.addEventListener('keydown', (event) => {
    if (drag && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishDrag(drag, false);
    }
  });

  // ---- the shell -----------------------------------------------------------

  /**
   * Scrolls a section the merchant picked in the shell's list to the top of
   * the page, unless it is already all on screen.
   *
   * On a message of its own rather than on the select, because from here every
   * select looks alike and most of them must leave the page where it is: the
   * echo of the merchant's own click on a section, which is under their
   * pointer already; the outline redrawn after a drop; and the one redrawn
   * after a reload, which arrives just as this file is putting the merchant
   * back where they were. Only the shell knows a scroll was asked for, so only
   * the shell says so.
   */
  function revealSection(id: string): void {
    // A drag owns the scroll position — autoscroll() is steering it, and
    // visualTopOf() reads a scroll it did not make as pointer travel, so the
    // section being carried would come along with the page.
    if (drag) {
      return;
    }

    // The drawer's backdrop covers the page, and the `overflow: hidden` it
    // puts on the body stops the header sticking, so there is nothing to see
    // and nothing left to measure the top of the page against.
    if (document.body.classList.contains('drawer-open')) {
      return;
    }

    const el = document.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`);

    // A hidden section is not rendered at all, and another page has other
    // sections: the list can name one this page does not show.
    if (!el) {
      return;
    }

    // Rects include transforms, so a section still sliding into place is
    // measured where it is rather than where it lands. A drop and a click in
    // the list are an ordinary two-gesture sequence, so this waits out the
    // slide instead of dropping the merchant's click.
    if (sections().some((s) => settling.has(s))) {
      window.setTimeout(() => revealSection(id), MOVE_MS);
      return;
    }

    // Measured rather than read from --header-h: below 899px the header takes
    // a second row, which is both of the narrow widths the preview can be set
    // to. Sticky, so the rect is right at any scroll position.
    const header = document.querySelector('.site-header')?.getBoundingClientRect();
    const top = Math.max(0, header?.bottom ?? 0);
    const rect = el.getBoundingClientRect();

    // Behind the sticky header counts as not displayed, even at rect.top > 0.
    // A pixel of slack keeps a fractional layout from reading as off screen.
    if (rect.top >= top - 1 && rect.bottom <= window.innerHeight + 1) {
      return;
    }

    // A section taller than the room under the header is never all on screen,
    // so picking one always comes here — to its top, which is where someone
    // navigating to it wants to be, and where it already is on a second pick.
    //
    // Instant, like every other scroll in this file: openRail flushes a
    // pending field first, so a save can tear the page down moments later, and
    // pagehide would hand the next one a smooth scroll's halfway point as the
    // place to come back to.
    window.scrollTo(0, Math.max(0, window.scrollY + rect.top - top - REVEAL_GAP));
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== origin || !shell || event.source !== shell) {
      return;
    }

    const data = event.data;

    if (!data || typeof data.type !== 'string') {
      return;
    }

    if (data.type === SECTION_HOVER) {
      document
        .querySelectorAll<HTMLElement>('[data-section].is-hover')
        .forEach((el) => el.classList.remove('is-hover'));

      if (typeof data.id === 'string') {
        document
          .querySelector<HTMLElement>(`[data-section="${CSS.escape(data.id)}"]`)
          ?.classList.add('is-hover');
      }

      return;
    }

    if (data.type === SECTION_SELECT) {
      document
        .querySelectorAll<HTMLElement>('[data-section].is-selected')
        .forEach((el) => el.classList.remove('is-selected'));

      if (typeof data.id === 'string') {
        document
          .querySelector<HTMLElement>(`[data-section="${CSS.escape(data.id)}"]`)
          ?.classList.add('is-selected');
      }

      return;
    }

    if (data.type === SECTION_REVEAL && typeof data.id === 'string') {
      revealSection(data.id);
      return;
    }

    if (data.type === SECTIONS) {
      // Legacy: a hidden section is not rendered at all now, so there is
      // nothing here to dim. Still accepted so the message type keeps working.
      return;
    }

    if (
      data.type === 'outfitter:edit' &&
      typeof data.id === 'string' &&
      typeof data.value === 'string'
    ) {
      setText(data.id, data.value);
    }
  });

  // ---- scroll across reloads -----------------------------------------------

  // The shell reloads the page after a save that changed its sections; the
  // page comes back where the merchant was, not at the top. sessionStorage is
  // the tab's, shared with the shell (same origin); private windows may refuse it.
  window.addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ path: location.pathname, y: window.scrollY }));
    } catch {
      // Not remembered; the top it is.
    }
  });

  // Only the shell's post-save reloads carry __v (see editUrl in the shell).
  if (new URLSearchParams(location.search).has('__v')) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null') as {
        path?: unknown;
        y?: unknown;
      } | null;
      if (saved && saved.path === location.pathname && typeof saved.y === 'number') {
        const y = saved.y;
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
    } catch {
      // Nothing to go back to.
    }
  }

  const shown = new URL(location.href);
  shown.searchParams.delete(EDIT_PARAM);

  // The page's section ids, in order, so the shell can tell a render that
  // missed a save it has just made — and which page this is, which only the
  // rendered page knows for certain.
  tell({
    type: 'outfitter:page',
    url: `${shown.pathname}${shown.search}`,
    locale,
    page: sectionsPage(),
    sections: Array.from(
      document.querySelectorAll<HTMLElement>('[data-section]'),
      (el) => el.dataset.section ?? '',
    ),
  });
}
