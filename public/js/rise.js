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

  async function send(file) {
    say('Reading your photo...');
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
      say('Upload failed. Try again, or open Advanced and paste the image as text.');
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
