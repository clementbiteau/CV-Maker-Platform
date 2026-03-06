/* ============================================================
   CV-Maker — Application Logic
   ============================================================ */

'use strict';

// ---- Constants -------------------------------------------
const STORAGE_KEY = 'cvmaker_api_key';
const CLAUDE_API  = 'https://api.anthropic.com/v1/messages';
const MODEL       = 'claude-haiku-4-5-20251001';
const MAX_FILE_MB = 10;

// ---- State -----------------------------------------------
let cvData = null;

// ---- DOM Refs --------------------------------------------
const $ = id => document.getElementById(id);

const settingsBtn    = $('settingsBtn');
const settingsPanel  = $('settingsPanel');
const apiKeyInput    = $('apiKey');
const saveKeyBtn     = $('saveKey');
const apiKeyStatus   = $('apiKeyStatus');

const dropZone       = $('dropZone');
const fileInput      = $('fileInput');

const uploadSection  = $('uploadSection');
const statusSection  = $('statusSection');
const errorSection   = $('errorSection');
const previewSection = $('previewSection');

const statusTitle    = $('statusTitle');
const statusText     = $('statusText');
const errorText      = $('errorText');
const errorRetryBtn  = $('errorRetryBtn');

const resetBtn       = $('resetBtn');
const downloadBtn    = $('downloadBtn');

// CV template fields
const cvInitials   = $('cvInitials');
const cvName       = $('cvName');
const cvJobTitle   = $('cvJobTitle');
const cvContacts   = $('cvContacts');
const cvSummary    = $('cvSummary');
const cvExperience = $('cvExperience');
const cvSkills     = $('cvSkills');
const cvEducation  = $('cvEducation');
const cvLanguages  = $('cvLanguages');
const cvCerts      = $('cvCertifications');

// ---- Init ------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  // Load saved API key
  const savedKey = localStorage.getItem(STORAGE_KEY) || '';
  if (savedKey) {
    apiKeyInput.value = savedKey;
    setKeyStatus('ok', 'Clé enregistrée ✓');
  } else {
    openSettings();
  }

  // Wire events
  settingsBtn.addEventListener('click', toggleSettings);
  saveKeyBtn.addEventListener('click', saveApiKey);
  apiKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveApiKey(); });

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  resetBtn.addEventListener('click', resetApp);
  errorRetryBtn.addEventListener('click', resetApp);
  downloadBtn.addEventListener('click', downloadPDF);
  window.addEventListener('resize', scaleCVWrapper);
});

// ---- Settings --------------------------------------------
function toggleSettings() {
  settingsPanel.classList.toggle('open');
}
function openSettings() {
  settingsPanel.classList.add('open');
}

function saveApiKey() {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setKeyStatus('err', 'Veuillez entrer une clé API.');
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    setKeyStatus('err', 'La clé doit commencer par "sk-ant-".');
    return;
  }
  localStorage.setItem(STORAGE_KEY, key);
  setKeyStatus('ok', 'Clé enregistrée ✓');
  settingsPanel.classList.remove('open');
}

function setKeyStatus(type, msg) {
  apiKeyStatus.textContent = msg;
  apiKeyStatus.className = 'api-key-status ' + type;
}

function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) || apiKeyInput.value.trim();
}

// ---- UI State Helpers ------------------------------------
function showSection(id) {
  [uploadSection, statusSection, errorSection, previewSection].forEach(s => {
    s.hidden = (s.id !== id);
  });
}

function setStatus(title, text) {
  statusTitle.textContent = title;
  statusText.textContent  = text;
}

function showError(msg) {
  errorText.textContent = msg;
  showSection('errorSection');
}

function resetApp() {
  cvData = null;
  fileInput.value = '';
  showSection('uploadSection');
}

// ---- File Handling ---------------------------------------
async function handleFile(file) {
  // Validate
  if (!file.name.match(/\.(pdf|docx)$/i)) {
    alert('Format non supporté. Veuillez utiliser un fichier PDF ou DOCX.');
    return;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    alert(`Fichier trop volumineux. Taille maximale : ${MAX_FILE_MB} Mo.`);
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    openSettings();
    alert('Veuillez d\'abord entrer votre clé API Claude.');
    return;
  }

  showSection('statusSection');
  setStatus('Traitement en cours…', 'Lecture du fichier…');

  try {
    // 1. Extract text
    let rawText;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      rawText = await extractPDF(file);
    } else {
      rawText = await extractDOCX(file);
    }

    if (!rawText || rawText.trim().length < 50) {
      throw new Error('Impossible d\'extraire le texte du fichier. Vérifiez que le fichier n\'est pas scanné ou protégé.');
    }

    setStatus('Traitement en cours…', 'Analyse et structuration du CV par l\'IA…');

    // 2. Call Claude API
    const data = await parseCVWithClaude(rawText, apiKey);

    // 3. Render
    setStatus('Finalisation…', 'Mise en page du CV…');
    renderCV(data);
    showSection('previewSection');
    scaleCVWrapper();

  } catch (err) {
    console.error(err);
    showError(err.message || 'Une erreur inattendue est survenue.');
  }
}

// ---- PDF Text Extraction ---------------------------------
async function extractPDF(file) {
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => item.str)
      .join(' ')
      .replace(/\s{2,}/g, ' ');
    fullText += pageText + '\n\n';
  }

  return fullText.trim();
}

// ---- DOCX Text Extraction --------------------------------
async function extractDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

// ---- Claude API Call -------------------------------------
async function parseCVWithClaude(rawText, apiKey) {
  const prompt = `You are an expert CV parser. Extract all relevant information from the following CV text and return a single valid JSON object — nothing else, no markdown, no explanation.

Use this exact structure:
{
  "name": "Full name of the person",
  "title": "Professional title or headline (infer from their most recent role if not explicit)",
  "email": "email or empty string",
  "phone": "phone number or empty string",
  "location": "City, Country or empty string",
  "linkedin": "LinkedIn URL, handle, or empty string",
  "website": "personal website or empty string",
  "summary": "2-3 sentence professional summary (use the one in the CV, or write a concise one based on their background)",
  "experience": [
    {
      "role": "Job title",
      "company": "Company name",
      "location": "City, Country or empty string",
      "startDate": "Month Year or just Year",
      "endDate": "Month Year, Year, or 'Présent'",
      "bullets": ["Concise achievement or responsibility", "..."]
    }
  ],
  "education": [
    {
      "degree": "Degree and field of study",
      "institution": "School or university name",
      "location": "City, Country or empty string",
      "year": "Graduation year or date range"
    }
  ],
  "skills": ["Skill 1", "Skill 2"],
  "languages": [
    { "language": "Language name", "level": "Native / Fluent / Advanced / Intermediate / Basic" }
  ],
  "certifications": [
    { "name": "Certification name", "issuer": "Issuing body", "year": "Year or empty string" }
  ]
}

Rules:
- Experience: sorted most recent first. Extract or synthesize 2-5 bullets per role, focused on impact.
- Skills: max 14 items, keep them concise (no full sentences).
- Languages: if none found, return an empty array.
- Certifications: if none found, return an empty array.
- Keep the original language of the CV for all content (French stays French, English stays English).
- Return ONLY the JSON object.

CV text:
---
${rawText.substring(0, 12000)}
---`;

  const response = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-calls': 'true'
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Clé API invalide. Vérifiez votre clé dans les paramètres.');
    if (response.status === 429) throw new Error('Limite de requêtes atteinte. Réessayez dans quelques secondes.');
    throw new Error(err.error?.message || `Erreur API (${response.status})`);
  }

  const result = await response.json();
  const raw    = result.content?.[0]?.text || '';

  // Extract JSON from response (handle potential wrapping)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Réponse IA invalide. Réessayez.');

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Impossible de parser la réponse IA. Réessayez.');
  }
}

// ---- CV Rendering ----------------------------------------
function renderCV(data) {
  cvData = data;

  // Initials
  const nameParts = (data.name || 'CV').trim().split(/\s+/);
  cvInitials.textContent = nameParts.length >= 2
    ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
    : (data.name || 'CV').substring(0, 2).toUpperCase();

  // Name & Title
  cvName.textContent     = data.name     || '';
  cvJobTitle.textContent = data.title    || '';

  // Contact info
  cvContacts.innerHTML = '';
  const contacts = [
    { icon: '✉', value: data.email    },
    { icon: '📞', value: data.phone    },
    { icon: '📍', value: data.location },
    { icon: '🔗', value: data.linkedin },
    { icon: '🌐', value: data.website  },
  ];
  contacts.forEach(({ icon, value }) => {
    if (!value) return;
    const div = document.createElement('div');
    div.className = 'cv-contact-item';
    // Shorten LinkedIn URLs
    let display = value;
    if (value.includes('linkedin.com/in/')) {
      display = 'linkedin.com/in/' + value.split('linkedin.com/in/')[1].replace(/\/$/, '');
    }
    div.innerHTML = `<span>${icon}</span>${escapeHtml(display)}`;
    cvContacts.appendChild(div);
  });

  // Summary
  cvSummary.textContent = data.summary || '';
  $('sec-summary').style.display = data.summary ? '' : 'none';

  // Experience
  cvExperience.innerHTML = '';
  (data.experience || []).forEach(exp => {
    const div = document.createElement('div');
    div.className = 'cv-exp-item';

    const bullets = (exp.bullets || [])
      .map(b => `<li>${escapeHtml(b)}</li>`)
      .join('');

    const dates = [exp.startDate, exp.endDate].filter(Boolean).join(' – ');
    const companyLine = [exp.company, exp.location].filter(Boolean).join(' · ');

    div.innerHTML = `
      <div class="cv-exp-header">
        <div class="cv-exp-role">${escapeHtml(exp.role || '')}</div>
        ${dates ? `<div class="cv-exp-dates">${escapeHtml(dates)}</div>` : ''}
      </div>
      ${companyLine ? `<div class="cv-exp-company">${escapeHtml(companyLine)}</div>` : ''}
      ${bullets ? `<ul class="cv-exp-bullets">${bullets}</ul>` : ''}
    `;
    cvExperience.appendChild(div);
  });
  $('sec-experience').style.display = (data.experience?.length) ? '' : 'none';

  // Skills
  cvSkills.innerHTML = '';
  (data.skills || []).forEach(skill => {
    const li = document.createElement('li');
    li.textContent = skill;
    cvSkills.appendChild(li);
  });
  $('sec-skills').style.display = (data.skills?.length) ? '' : 'none';

  // Education
  cvEducation.innerHTML = '';
  (data.education || []).forEach(edu => {
    const div = document.createElement('div');
    div.className = 'cv-edu-item';
    const schoolLine = [edu.institution, edu.location].filter(Boolean).join(', ');
    div.innerHTML = `
      <div class="cv-edu-degree">${escapeHtml(edu.degree || '')}</div>
      ${schoolLine ? `<div class="cv-edu-school">${escapeHtml(schoolLine)}</div>` : ''}
      ${edu.year ? `<div class="cv-edu-year">${escapeHtml(edu.year)}</div>` : ''}
    `;
    cvEducation.appendChild(div);
  });
  $('sec-education').style.display = (data.education?.length) ? '' : 'none';

  // Languages
  cvLanguages.innerHTML = '';
  (data.languages || []).forEach(lang => {
    const div = document.createElement('div');
    div.className = 'cv-lang-item';
    div.innerHTML = `
      <span class="cv-lang-name">${escapeHtml(lang.language || '')}</span>
      ${lang.level ? `<span class="cv-lang-level">${escapeHtml(lang.level)}</span>` : ''}
    `;
    cvLanguages.appendChild(div);
  });
  $('sec-languages').style.display = (data.languages?.length) ? '' : 'none';

  // Certifications
  cvCerts.innerHTML = '';
  if (data.certifications?.length) {
    $('sec-certifications').style.display = '';
    data.certifications.forEach(cert => {
      const div = document.createElement('div');
      div.className = 'cv-cert-item';
      const meta = [cert.issuer, cert.year].filter(Boolean).join(' · ');
      div.innerHTML = `
        <div class="cv-cert-name">${escapeHtml(cert.name || '')}</div>
        ${meta ? `<div class="cv-cert-meta">${escapeHtml(meta)}</div>` : ''}
      `;
      cvCerts.appendChild(div);
    });
  }
}

// ---- PDF Download ----------------------------------------
async function downloadPDF() {
  const btn = downloadBtn;
  btn.disabled = true;
  btn.textContent = 'Génération…';

  try {
    const cvPage = $('cvPage');
    const { jsPDF } = window.jspdf;

    const canvas = await html2canvas(cvPage, {
      scale:      2,
      useCORS:    true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging:    false
    });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    const pdfW = 210;  // A4 width in mm
    const pdfH = 297;  // A4 height in mm

    const canvasW = canvas.width;
    const canvasH = canvas.height;

    // Page height in canvas pixels
    const pageHeightPx = Math.floor(canvasW * pdfH / pdfW);

    let yOffset = 0;
    let page    = 0;

    while (yOffset < canvasH) {
      const sliceH = Math.min(pageHeightPx, canvasH - yOffset);

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = canvasW;
      sliceCanvas.height = sliceH;

      const ctx = sliceCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, sliceH);
      ctx.drawImage(canvas, 0, yOffset, canvasW, sliceH, 0, 0, canvasW, sliceH);

      if (page > 0) pdf.addPage();
      pdf.addImage(
        sliceCanvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        0, 0,
        pdfW,
        sliceH * pdfW / canvasW
      );

      yOffset += pageHeightPx;
      page++;
    }

    const filename = cvData?.name
      ? 'CV_' + cvData.name.trim().replace(/\s+/g, '_') + '.pdf'
      : 'CV.pdf';

    pdf.save(filename);

  } catch (err) {
    console.error(err);
    alert('Erreur lors de la génération du PDF : ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Télécharger le PDF`;
  }
}

// ---- CV Wrapper Scaling ----------------------------------
function scaleCVWrapper() {
  const wrapper = document.querySelector('.cv-wrapper');
  if (!wrapper) return;
  const available = window.innerWidth - 48; // 24px padding each side
  const cvWidth   = 794;
  if (available < cvWidth) {
    const scale = available / cvWidth;
    wrapper.style.transform       = `scale(${scale})`;
    wrapper.style.transformOrigin = 'top center';
    wrapper.style.marginBottom    = `${(cvWidth * scale) - cvWidth}px`;
  } else {
    wrapper.style.transform    = '';
    wrapper.style.marginBottom = '';
  }
}

// ---- Utilities -------------------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g, '&#39;');
}
