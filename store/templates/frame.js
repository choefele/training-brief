// Scrolls each framed page to the part a screenshot should show: data-scroll is a selector inside the page.
for (const frame of document.querySelectorAll('iframe[data-scroll]')) {
  frame.addEventListener('load', () => setTimeout(() => {
    const doc = frame.contentDocument;
    doc.documentElement.style.scrollbarWidth = 'none';
    const target = doc.querySelector(frame.dataset.scroll);
    const offset = Number(frame.dataset.offset || 0);
    if (target) frame.contentWindow.scrollTo(0, target.getBoundingClientRect().top + frame.contentWindow.scrollY - offset);
  }, 800));
}
