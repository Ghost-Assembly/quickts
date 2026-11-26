// GNOME 51 opens a menu with an options object; GNOME 50 took a
// BoxPointer.PopupAnimation (a boolean, for a submenu) and reads an object as
// "animate". Neither reads the other's argument correctly, so pick by version.

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

const OPTIONS = Number.parseInt(Config.PACKAGE_VERSION, 10) >= 51;

/** Argument to menu.open() for the full open animation. */
export const ANIMATE = OPTIONS ? { animate: true } : BoxPointer.PopupAnimation.FULL;

/** Argument to menu.open() for no animation. */
export const NO_ANIMATE = OPTIONS ? { animate: false } : BoxPointer.PopupAnimation.NONE;
