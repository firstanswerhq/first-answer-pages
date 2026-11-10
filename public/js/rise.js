// Optional file-picker enhancement for /rise. The form works without it.
const MAX_BYTES = 5242880;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const form = document.getElementById('rise-form');
const area = document.getElementById('imageBase64');
const status = document.getElementById('rise-status');

if (form && area) {
  const label = document.createElement('label');
  label.setAttribute('for', 'imageFile');
  label.textContent = 'Or pick a picture file';
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.id = 'imageFile';
  picker.accept = TYPES.join(',');
  form.insertBefore(picker, form.firstChild);
  form.insertBefore(label, picker);

  const say = text => { if (status) status.textContent = text; };

  picker.addEventListener('change', () => {
    const file = picker.files && picker.files[0];
    if (!file) { area.required = true; return; }
    if (!TYPES.includes(file.type)) {
      say('That file is not a JPEG, PNG, or WebP picture.');
      picker.value = '';
      area.required = true;
      return;
    }
    if (file.size > MAX_BYTES) {
      say('That picture is larger than 5 MiB.');
      picker.value = '';
      area.required = true;
      return;
    }
    say('');
    area.required = false; // the file is sent instead of the text
  });

  form.addEventListener('submit', async event => {
    const file = picker.files && picker.files[0];
    if (!file) return; // plain form post with the textarea
    event.preventDefault();
    say('Reading your ad...');
    try {
      const res = await fetch('/rise', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (res.redirected) {
        location.href = res.url;
        return;
      }
      say(res.ok ? 'Done.' : `The upload was refused (status ${res.status}).`);
    } catch {
      // Network trouble: fall back to the plain form with base64 text.
      say('Upload failed. Try again, or paste the image as base64 text.');
      area.required = true;
    }
  });
}
