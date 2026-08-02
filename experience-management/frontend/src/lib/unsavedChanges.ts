const unsavedChangeSources = new Set<symbol>();
let allowNextUnload = false;

export function setUnsavedChangeSource(source: symbol, dirty: boolean) {
  if (dirty) unsavedChangeSources.add(source);
  else unsavedChangeSources.delete(source);
}

export function clearUnsavedChangeSource(source: symbol) {
  unsavedChangeSources.delete(source);
}

export function hasUnsavedChanges() {
  return unsavedChangeSources.size > 0;
}

export function confirmDiscardForSpaceSwitch() {
  return !hasUnsavedChanges() || window.confirm('Switch spaces and discard your unsaved changes?');
}

export function allowConfirmedSpaceSwitchUnload() {
  allowNextUnload = true;
}

export function shouldBlockBeforeUnload() {
  if (!hasUnsavedChanges()) return false;
  if (allowNextUnload) {
    allowNextUnload = false;
    return false;
  }
  return true;
}
