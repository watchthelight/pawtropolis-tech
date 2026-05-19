/** Reactive viewport detection — initialise once, read anywhere. */

let _isMobile = $state(false);

export function initViewport() {
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(max-width: 767px)");
  _isMobile = mq.matches;
  mq.addEventListener("change", (e) => {
    _isMobile = e.matches;
  });
}

export function getIsMobile(): boolean {
  return _isMobile;
}
