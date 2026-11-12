(function () {
  "use strict";

  // Image Prompt endpoint
  const API_IMAGE = 'https://crimson-math-fbe6.pradeepchugani123.workers.dev/api/image-prompt';

  // --- DOM refs ---
  const shopifyUrlInput = document.getElementById('shopifyUrl');
  const modelCountSelect = document.getElementById('modelCount');
  const ethnicity1Select = document.getElementById('ethnicity1');
  const ethnicity2Select = document.getElementById('ethnicity2');
  const ageCategorySelect = document.getElementById('ageCategory');
  const showMovementCheckbox = document.getElementById('showMovement');
  const addSneakersCheckbox = document.getElementById('addSneakers');
  const addSocksCheckbox = document.getElementById('addSocks');
  const addShoesCheckbox = document.getElementById('addShoes');
  const addWorkBootsCheckbox = document.getElementById('addWorkBoots');
  const generateBtn = document.getElementById('generateBtn');
  const copyBtn = document.getElementById('copyBtn');
  const downloadRefBtn = document.getElementById('downloadRefBtn');
  const jsonOutput = document.getElementById('jsonOutput');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');
  const outputSection = document.getElementById('outputSection');

  let currentPrompt = null;

  function showError(message){ if(!errorMessage) return; errorMessage.textContent = message; errorMessage.style.display='block'; }
  function hideError(){ if(errorMessage) errorMessage.style.display='none'; }
  function showSuccess(message){ if(!successMessage) return; successMessage.textContent = message; successMessage.style.display='block'; setTimeout(()=>successMessage.style.display='none',3000); }

  async function generatePrompt() {
    const url = (shopifyUrlInput?.value || '').trim();
    if (!url || !url.includes('/products/')) { showError('Enter a valid product URL (must contain /products/)'); return; }
    generateBtn.disabled = true; loader && (loader.style.display='inline-block'); hideError(); outputSection && (outputSection.style.display='none');

    try {
      const body = {
        product_url: url,
        ethnicity1: ethnicity1Select.value,
        ethnicity2: ethnicity2Select.value,
        model_count: parseInt(modelCountSelect.value || '1', 10),
      };
      if (ageCategorySelect.value) body.age_category = ageCategorySelect.value;
      if (addSneakersCheckbox.checked) body.add_sneakers = true;
      if (addSocksCheckbox.checked) body.add_socks = true;
      if (addShoesCheckbox.checked) body.add_shoes = true;
      if (addWorkBootsCheckbox.checked) body.add_work_boots = true;
      if (showMovementCheckbox.checked) body.show_movement = true;

      const res = await fetch(API_IMAGE, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.ok && data.prompt) {
        currentPrompt = data.prompt;
        jsonOutput.value = JSON.stringify(data.prompt, null, 2);
        outputSection.style.display = 'block';
      } else {
        throw new Error(data.message || data.error || 'Failed to generate prompt');
      }
    } catch (err) {
      showError('Error: ' + err.message);
    } finally {
      generateBtn.disabled = false; if (loader) loader.style.display='none';
    }
  }

  async function copyToClipboard(){
    const text = jsonOutput?.value || '';
    if (!text) { showError('No prompt to copy'); return; }
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Copied to clipboard!');
    } catch { showError('Copy failed.'); }
  }

  async function downloadReferenceImage() {
    if (!currentPrompt?.reference_image) { showError('No reference image available'); return; }
    const imageUrl = currentPrompt.reference_image;
    const name = (imageUrl.split('/').pop() || 'reference.jpg').split('?')[0];
    try {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = blobUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=> URL.revokeObjectURL(blobUrl), 100);
      showSuccess('Reference image downloaded!');
    } catch { showError('Download failed.'); }
  }

  if (generateBtn) generateBtn.addEventListener('click', generatePrompt);
  if (copyBtn) copyBtn.addEventListener('click', copyToClipboard);
  if (downloadRefBtn) downloadRefBtn.addEventListener('click', downloadReferenceImage);
  if (shopifyUrlInput) shopifyUrlInput.addEventListener('keypress', e => { if (e.key === 'Enter') generatePrompt(); });
})();
