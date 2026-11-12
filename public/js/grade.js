// Optional progress and copy buttons for /grade pages. Every page works without this file.

function setupCopyButtons(root) {
  for (const button of root.querySelectorAll('.copy-btn[data-copy]')) {
    const target = document.getElementById(button.dataset.copy);
    if (!target) continue;
    button.hidden = false;
    button.addEventListener('click', async () => {
      const text = target.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
      } catch {
        // No clipboard access: select the text so the visitor can copy it.
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = 'Text selected. Copy it.';
      }
    });
  }
}

// Replace the page's <main> with the one the server renders now (no full reload).
async function swapInPage() {
  const res = await fetch(window.location.href, { headers: { Accept: 'text/html' }, credentials: 'same-origin' });
  if (!res.ok) return false;
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const fresh = doc.querySelector('main');
  const current = document.querySelector('main');
  if (!fresh || !current) return false;
  current.replaceChildren(...Array.from(fresh.childNodes).map(n => document.importNode(n, true)));
  if (doc.title) document.title = doc.title;
  setupCopyButtons(current);
  return true;
}

function watchScan(scan) {
  const url = scan.dataset.statusUrl;
  if (!url) return;
  let seenSteps = -1;
  let tries = 0;
  const poll = async () => {
    tries += 1;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (res.ok) {
        const status = await res.json();
        const changed = status.done || status.steps.length !== seenSteps;
        seenSteps = status.steps.length;
        if (changed && (await swapInPage())) {
          if (status.done) return; // the report is showing now
          const next = document.querySelector('[data-grade-scan]');
          if (!next) return;
        }
      }
    } catch {
      // Keep going: the next poll may work, and the page also refreshes without this script.
    }
    if (tries < 300) setTimeout(poll, 1000); // at most one request per second, about five minutes
  };
  setTimeout(poll, 1000);
}

// After "Check again": reload the report every few seconds until the notice is gone.
function watchRecheck() {
  let tries = 0;
  const tick = async () => {
    tries += 1;
    try {
      await swapInPage();
    } catch {
      // Try again on the next tick.
    }
    if (document.querySelector('[data-grade-rechecking]') && tries < 60) setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

setupCopyButtons(document);
const scan = document.querySelector('[data-grade-scan]');
if (scan) watchScan(scan);
if (document.querySelector('[data-grade-rechecking]')) watchRecheck();
