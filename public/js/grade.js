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

// Update progress bar without touching the DOM heavily.
function updateProgressBar(doneSteps, totalSteps, isDone) {
  var bar = document.querySelector('.scan-progress-fill');
  var glow = document.querySelector('.scan-progress-glow');
  var label = document.querySelector('.scan-progress-label');
  var wrap = document.querySelector('.scan-progress-bar');
  if (!bar || !label || !wrap) return;
  var pct = Math.round((doneSteps / totalSteps) * 100);
  // Never show 100% until the check is truly done — all steps can be
  // recorded before the grade status flips from running to done
  if (!isDone) pct = Math.min(pct, 95);
  bar.style.width = pct + '%';
  wrap.style.setProperty('--pct', pct + '%');
  wrap.setAttribute('aria-valuenow', pct);
  if (glow) glow.style.left = 'calc(' + pct + '% - 2rem)';
  label.textContent = pct + '%';
}

// Update step list items in place instead of swapping the whole page.
function updateSteps(steps, totalSteps) {
  var items = document.querySelectorAll('.grade-step');
  if (!items.length) return;
  var doneSet = {};
  for (var i = 0; i < steps.length; i++) {
    doneSet[steps[i].name] = steps[i];
  }
  var firstOpen = -1;
  for (var j = 0; j < items.length; j++) {
    var nameEl = items[j].querySelector('.step-name');
    if (!nameEl) continue;
    var name = nameEl.textContent;
    var step = doneSet[name];
    var findingEl = items[j].querySelector('.finding');
    if (step) {
      var cls = step.state === 'skipped' ? 'done skipped' : step.state === 'failed' ? 'done failed' : 'done';
      var mark = step.state === 'skipped' ? 'Skipped' : step.state === 'failed' ? 'Problem' : 'Done';
      items[j].className = 'grade-step ' + cls;
      var markEl = items[j].querySelector('.step-mark');
      if (markEl) markEl.textContent = mark;
      if (step.finding) {
        if (!findingEl) {
          findingEl = document.createElement('span');
          findingEl.className = 'finding';
          items[j].appendChild(findingEl);
        }
        findingEl.textContent = step.finding;
      }
    } else if (firstOpen === -1) {
      firstOpen = j;
      items[j].className = 'grade-step running';
      var markEl2 = items[j].querySelector('.step-mark');
      if (markEl2) markEl2.textContent = 'Working';
    }
  }
}

// Replace the page's <main> with the one the server renders now (no full reload).
async function swapInPage() {
  var res = await fetch(window.location.href, { headers: { Accept: 'text/html' }, credentials: 'same-origin' });
  if (!res.ok) return false;
  var doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  var fresh = doc.querySelector('main');
  var current = document.querySelector('main');
  if (!fresh || !current) return false;
  current.replaceChildren.apply(current, Array.from(fresh.childNodes).map(function(n) { return document.importNode(n, true); }));
  if (doc.title) document.title = doc.title;
  setupCopyButtons(current);
  return true;
}

function watchScan(scan) {
  var url = scan.dataset.statusUrl;
  if (!url) return;
  var totalSteps = parseInt(scan.dataset.totalSteps, 10) || 5;
  var seenSteps = -1;
  var tries = 0;
  var poll = async function() {
    tries += 1;
    try {
      var res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (res.ok) {
        var status = await res.json();
        var newSteps = status.steps ? status.steps.length : 0;
        // Update progress bar — only show 100% when status.done is true,
        // not just when all steps are recorded (there's a gap between the
        // last step recording and the grade status flipping to done)
        updateProgressBar(newSteps, totalSteps, status.done === true);
        // Update step text in place (lightweight)
        if (status.steps && newSteps !== seenSteps) {
          updateSteps(status.steps, totalSteps);
        }
        seenSteps = newSteps;
        // When the check is done, just reload — let Chrome handle the report
        // page natively instead of parsing and swapping the DOM in JavaScript
        if (status.done) {
          window.location.reload();
          return;
        }
      }
    } catch (e) {
      // Keep going: the next poll may work.
    }
    // Poll every 2 seconds instead of 1 — easier on Chrome
    if (tries < 150) setTimeout(poll, 2000);
  };
  setTimeout(poll, 2000);
}

// After "Check again": reload the report every few seconds until the notice is gone.
function watchRecheck() {
  var tries = 0;
  var tick = async function() {
    tries += 1;
    try {
      // Check if recheck is done via a lightweight JSON fetch, then reload
      var res = await fetch(window.location.href, { headers: { Accept: 'text/html' }, credentials: 'same-origin' });
      if (res.ok) {
        var text = await res.text();
        if (text.indexOf('data-grade-rechecking') === -1) {
          window.location.reload();
          return;
        }
      }
    } catch (e) {
      // Try again on the next tick.
    }
    if (tries < 60) setTimeout(tick, 5000);
  };
  setTimeout(tick, 5000);
}

setupCopyButtons(document);
var scan = document.querySelector('[data-grade-scan]');
if (scan) watchScan(scan);
if (document.querySelector('[data-grade-rechecking]')) watchRecheck();

// The "report is open" note shows once: drop ?opened=1 so a reload does not bring it back.
(function () {
  if (typeof history === 'undefined' || !history.replaceState) return;
  if (!/[?&]opened=1/.test(location.search)) return;
  history.replaceState(null, '', location.pathname + location.hash);
})();
