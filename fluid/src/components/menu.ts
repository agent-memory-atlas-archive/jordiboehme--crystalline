/**
 * The classes every dropdown in this app is drawn with: the menu face of the
 * overhaul (spec 5.6), 12px radius, raised, a soft shadow, 34px rows (44 on
 * a phone) and section labels in small caps.
 *
 * One definition rather than one per menu: the editor's toolbar menus, the
 * page actions, the theme and account menu and the domain switcher are the
 * same control in many places, and a reader who has learned what one looks
 * like should not have to learn the others. The face itself is the
 * `menu-face` and `menu-row` utilities in `index.css`, which the switcher and
 * the avatar menu build on too.
 */

/** The surface a menu opens onto. */
export const MENU_CLASSES = "menu-face min-w-52";

/** One row inside it. */
export const ITEM_CLASSES = "menu-row";

/** A section label: small caps, muted. */
export const MENU_LABEL =
  "px-2.5 pt-2 pb-1 text-[11.5px] font-semibold tracking-[0.04em] text-muted uppercase";

/** A line between groups. */
export const MENU_SEPARATOR = "mx-1 my-1.5 h-px bg-hair";
