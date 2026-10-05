export interface ShortcutActions {
  toggle(): void;
}

/**
 * The only keyboard shortcut: Space plays or pauses. Ignored while typing in a
 * field, on a focused button (it already reacts to Space), in menus and in open dialogs.
 */
export function bindShortcuts(actions: ShortcutActions): void {
  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"], button, [role="button"], dialog[open], [role="menu"]')) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    actions.toggle();
  });
}
