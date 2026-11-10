// Optional file-picker enhancement for /rise. The Advanced text form works without it.
const MAX_BYTES = 5242880;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const form = document.getElementById('rise-form');
const area = document.getElementById('imageBase64');
const status = document.getElementById('rise-status');

if (form && area) {
  let picker = document.getElementById('imageFile');
  if (!picker) {
    picker = document.createElement('input');
    picker.type = 'file';
    picker.id = 'imageFile';
    picker.accept = TYPES.join(',');
    form.insertBefore(picker, form.firstChild);
  }

  const say = text => { if (status) status.textContent = text; };

  const GENERIC_ERROR = 'We could not read that photo. Please try again.';

  // The server's own message: the first heading/paragraph in section.message.
  function serverMessage(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const parts = [...doc.querySelectorAll('section.message h1, section.message p')]
        .map(el => el.textContent.trim())
        .filter(t => t !== '');
      // Prefer the sentence; the paragraph before the back link.
      const text = parts.length > 1 ? parts[1] : parts[0];
      return text || GENERIC_ERROR;
    } catch {
      return GENERIC_ERROR;
    }
  }

  async function send(file) {
    picker.disabled = true;
    say('Reading your photo\u2026 this takes about 10 seconds');
    let done = false;
    try {
      const res = await fetch('/rise', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (res.redirected) {
        done = true;
        location.href = res.url;
        return;
      }
      if (res.ok) {
        say('Done.');
      } else {
        say(serverMessage(await res.text()));
      }
    } catch {
      say(GENERIC_ERROR);
    } finally {
      if (!done) {
        picker.disabled = false;
        picker.value = '';
      }
    }
  }

  picker.addEventListener('change', () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    if (!TYPES.includes(file.type)) {
      say('That file is not a JPEG, PNG, or WebP picture.');
      picker.value = '';
      return;
    }
    if (file.size > MAX_BYTES) {
      say('That picture is larger than 5 MB.');
      picker.value = '';
      return;
    }
    say('');
    send(file);
  });
}
