'use strict';

const STORAGE_KEY  = 'cvmaker_api_key';
const CLAUDE_API   = 'https://api.anthropic.com/v1/messages';
const MODEL        = 'claude-haiku-4-5-20251001';

// ---- DOM refs -------------------------------------------
const $ = id => document.getElementById(id);

const dropZone      = $('dropZone');
const fileInput     = $('fileInput');

const uploadSection  = $('uploadSection');
const statusSection  = $('statusSection');
const errorSection   = $('errorSection');
const editSection    = $('editSection');
const previewSection = $('previewSection');

const statusTitle = $('statusTitle');
const statusText  = $('statusText');
const errorText   = $('errorText');

// ---- Init -----------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  // API key
  const saved = localStorage.getItem(STORAGE_KEY) || '';
  if (saved) { $('apiKey').value = saved; setKeyStatus('ok', 'Clé enregistrée ✓'); }
  else openSettings();
  $('settingsBtn').addEventListener('click', toggleSettings);
  $('saveKey').addEventListener('click', saveApiKey);
  $('apiKey').addEventListener('keydown', e => { if (e.key === 'Enter') saveApiKey(); });

  // File input
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  // Edit form
  $('editBackBtn').addEventListener('click', () => showSection('uploadSection'));
  $('generateBtn').addEventListener('click', generateCV);

  // Add buttons
  $('addFormationBtn').addEventListener('click',  () => addFormationRow());
  $('addCertBtn').addEventListener('click',       () => addCertRow());
  $('addTechSkillBtn').addEventListener('click',  () => addTechSkillRow());
  $('addLangBtn').addEventListener('click',       () => addLangRow());
  $('addExpBtn').addEventListener('click',        () => addExpEntry());

  // Preview
  $('previewBackBtn').addEventListener('click', () => showSection('editSection'));
  $('downloadBtn').addEventListener('click', downloadPDF);
  window.addEventListener('resize', scaleCVWrapper);
});

// ---- API Key --------------------------------------------
function toggleSettings() { $('settingsPanel').classList.toggle('open'); }
function openSettings()   { $('settingsPanel').classList.add('open'); }

function saveApiKey() {
  const key = $('apiKey').value.trim();
  if (!key.startsWith('sk-ant-')) { setKeyStatus('err', 'La clé doit commencer par "sk-ant-"'); return; }
  localStorage.setItem(STORAGE_KEY, key);
  setKeyStatus('ok', 'Clé enregistrée ✓');
  $('settingsPanel').classList.remove('open');
}
function setKeyStatus(type, msg) {
  const el = $('apiKeyStatus');
  el.textContent  = msg;
  el.className    = 'api-key-status ' + type;
}
function getApiKey() { return localStorage.getItem(STORAGE_KEY) || $('apiKey').value.trim(); }

// ---- Section visibility ---------------------------------
function showSection(id) {
  [uploadSection, statusSection, errorSection, editSection, previewSection]
    .forEach(s => { s.hidden = s.id !== id; });
}

function setStatus(title, text) {
  statusTitle.textContent = title;
  statusText.textContent  = text;
}

function showError(msg) {
  errorText.textContent = msg;
  $('errorRetryBtn').onclick = () => showSection('uploadSection');
  showSection('errorSection');
}

// ---- File handling --------------------------------------
async function handleFile(file) {
  if (!file.name.match(/\.(pdf|docx)$/i)) { alert('Formats acceptés : PDF ou DOCX.'); return; }
  if (file.size > 10 * 1024 * 1024) { alert('Fichier trop volumineux (max 10 Mo).'); return; }

  const apiKey = getApiKey();
  if (!apiKey) { openSettings(); alert('Veuillez d\'abord enregistrer votre clé API Claude.'); return; }

  showSection('statusSection');
  setStatus('Extraction du texte…', 'Lecture du fichier…');

  try {
    let text;
    if (file.name.toLowerCase().endsWith('.pdf')) {
      text = await extractPDF(file);
    } else {
      text = await extractDOCX(file);
    }

    if (!text || text.trim().length < 20) {
      throw new Error('Impossible d\'extraire le texte. Le fichier est peut-être scanné ou protégé.');
    }

    setStatus('Analyse par l\'IA…', 'Claude structure le CV…');
    const data = await parseCVWithClaude(text, apiKey);

    populateForm(data);
    showSection('editSection');

  } catch (err) {
    console.error(err);
    showError(err.message || 'Erreur inattendue.');
  }
}

// ---- PDF extraction -------------------------------------
async function extractPDF(file) {
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines using y-position grouping
    const items = content.items;
    const byY = {};
    items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!byY[y]) byY[y] = [];
      byY[y].push(item.str);
    });
    const sortedYs = Object.keys(byY).map(Number).sort((a, b) => b - a);
    sortedYs.forEach(y => { out += byY[y].join(' ').trim() + '\n'; });
    out += '\n';
  }
  return out.trim();
}

// ---- DOCX extraction ------------------------------------
async function extractDOCX(file) {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value.trim();
}

// ============================================================
// CLAUDE API PARSER
// ============================================================
async function parseCVWithClaude(text, apiKey) {
  const prompt = `Tu es un expert en parsing de CV pour un cabinet de conseil en IT (AVA2i).
Extrais toutes les informations du CV suivant et retourne UNIQUEMENT un objet JSON valide, sans markdown, sans explication.

Structure exacte requise :
{
  "name": "Nom ou initiales du candidat",
  "title": "Titre du poste / intitulé principal",
  "formation": [
    { "year": "2016", "description": "Diplôme – École" }
  ],
  "certifications": [
    { "year": "2022", "name": "Nom de la certification" }
  ],
  "techSkills": [
    { "category": "Langages", "items": "Java, Scala, Python, SQL" },
    { "category": "Big Data", "items": "Spark, Hadoop, Kafka, Hive" }
  ],
  "funcSkills": [
    "Analyser et concevoir des besoins utilisateurs.",
    "Rédiger les spécifications fonctionnelles."
  ],
  "languages": [
    { "language": "Anglais", "level": "Niveau avancé" }
  ],
  "experience": [
    {
      "dateRange": "Octobre 2023 – Présent",
      "company": "NOM ENTREPRISE",
      "role": "Titre du poste",
      "workEnv": "Anglophone",
      "project": "Description du projet en quelques phrases.",
      "tasks": [
        "Tâche ou réalisation 1",
        "Tâche ou réalisation 2"
      ],
      "techEnv": "Java 17, Spark 3, Docker, Kubernetes, AWS…"
    }
  ]
}

Règles :
- Retourne UNIQUEMENT le JSON, rien d'autre
- Garde la langue d'origine du CV (français reste français, anglais reste anglais)
- Pour techSkills : regroupe par catégorie logique (Langages, Big Data, Cloud, Frameworks, SGBD, Outils, Méthodologie, etc.)
- Les expériences doivent être triées de la plus récente à la plus ancienne
- Si une information est absente, utilise "" pour les strings et [] pour les tableaux

CV :
---
${text.substring(0, 14000)}
---`;

  const response = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-calls': 'true'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
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
  const match  = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Réponse IA invalide. Réessayez.');
  try { return JSON.parse(match[0]); }
  catch { throw new Error('JSON invalide dans la réponse. Réessayez.'); }
}

// ============================================================
// HEURISTIC FALLBACK (kept for reference, not used when API key present)
// ============================================================
function parseCVText(text) {
  const data = {
    name: '', title: '',
    formation: [],
    certifications: [],
    techSkills: [],
    funcSkills: [],
    languages: [],
    experience: []
  };

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // ---- Section boundaries ----
  const SECTIONS = {
    formation:       /^FORMATION$/i,
    certifications:  /^CERTIFICATIONS?$/i,
    techSkills:      /^COMP[ÉE]TENCES?\s+TECHNIQUES?$/i,
    funcSkills:      /^COMP[ÉE]TENCES?\s+FONCTIONNELLES?$/i,
    languages:       /^LANGUES?$/i,
    experience:      /^EXP[ÉE]RIENCES?\s+PROFESSIONNELLES?$/i,
  };

  const sectionContent = { header: [] };
  let currentSection = 'header';

  for (const line of lines) {
    let matched = false;
    for (const [sec, re] of Object.entries(SECTIONS)) {
      if (re.test(line)) {
        currentSection = sec;
        if (!sectionContent[sec]) sectionContent[sec] = [];
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!sectionContent[currentSection]) sectionContent[currentSection] = [];
      sectionContent[currentSection].push(line);
    }
  }

  // ---- Header: name + title ----
  const headerLines = sectionContent.header || [];
  for (let i = 0; i < Math.min(headerLines.length, 6); i++) {
    const l = headerLines[i];
    if (l.includes('@') || /^\+?\d/.test(l)) continue;
    if (!data.name && l.length <= 60) { data.name = l; continue; }
    if (!data.title && l.length <= 120) { data.title = l; break; }
  }

  // ---- Formation ----
  (sectionContent.formation || []).forEach(line => {
    const m = line.match(/^(\d{4})\s+(.+)/);
    if (m) { data.formation.push({ year: m[1], description: m[2].trim() }); }
    else if (line.match(/^\d{4}$/) && data.formation.length) {
      // year on its own line followed by description
    }
  });
  // fallback: pair lines
  if (!data.formation.length) {
    const fl = sectionContent.formation || [];
    for (let i = 0; i < fl.length; i++) {
      if (/^\d{4}$/.test(fl[i]) && fl[i + 1]) {
        data.formation.push({ year: fl[i], description: fl[i + 1] });
        i++;
      }
    }
  }

  // ---- Certifications ----
  (sectionContent.certifications || []).forEach(line => {
    const m = line.match(/^(\d{4})\s+(.+)/);
    if (m) { data.certifications.push({ year: m[1], name: m[2].trim() }); }
  });
  if (!data.certifications.length) {
    const cl = sectionContent.certifications || [];
    for (let i = 0; i < cl.length; i++) {
      if (/^\d{4}$/.test(cl[i]) && cl[i + 1]) {
        data.certifications.push({ year: cl[i], name: cl[i + 1] });
        i++;
      }
    }
  }

  // ---- Technical skills ----
  // Lines like: "Langages   Java, Scala, Python"
  // or two consecutive lines: "Langages" then "Java, Scala"
  const techLines = sectionContent.techSkills || [];
  const KNOWN_CATS = /^(Comp[eé]tences?\s+principales?|Langages?|Big Data|Cloud|Plateforme\s+JEE|Technologies?\s+WEB|SGBD|Webservices?|Design\s+patterns?|Paradigms?|Versioning|Syst[eè]mes?|Outils\s+Devops?|Outils\s+de\s+d[eé]veloppement|M[eé]thodologie)/i;
  let pendingCat = null;
  techLines.forEach(line => {
    const catMatch = line.match(KNOWN_CATS);
    if (catMatch) {
      // Check if same line has items after the category
      const rest = line.slice(catMatch[0].length).replace(/^\s*/, '');
      if (rest.length > 2) {
        data.techSkills.push({ category: catMatch[0].trim(), items: rest });
        pendingCat = null;
      } else {
        pendingCat = catMatch[0].trim();
      }
    } else if (pendingCat) {
      data.techSkills.push({ category: pendingCat, items: line });
      pendingCat = null;
    } else {
      // Generic: try to split on first long whitespace gap
      const m = line.match(/^(.{3,30})\s{2,}(.+)/);
      if (m) {
        data.techSkills.push({ category: m[1].trim(), items: m[2].trim() });
      }
    }
  });

  // ---- Functional skills ----
  data.funcSkills = (sectionContent.funcSkills || []).filter(l => l.length > 3);

  // ---- Languages ----
  (sectionContent.languages || []).forEach(line => {
    const LEVELS = /(natif|maternell?e?|courant|fluent|bilingue|bilingual|avanc[eé]|advanced|interm[eé]diaire|intermediate|notions?|basic|d[eé]butant|niveau\s+\w+)/i;
    const lvlM = line.match(LEVELS);
    const level = lvlM ? lvlM[0].trim() : '';
    const lang = line.replace(LEVELS, '').replace(/[:–\-,|]/g, '').trim();
    if (lang && lang.length > 1 && lang.length < 40) {
      data.languages.push({ language: lang, level });
    }
  });

  // ---- Experience ----
  data.experience = parseExperiences(sectionContent.experience || []);

  return data;
}

function parseExperiences(lines) {
  const entries = [];
  let cur = null;
  let phase = null; // 'company'|'role'|'project'|'tasks'|'techenv'

  // Date pattern: "October 2023 - Present" or "Juillet 2022 - Octobre 2023" or "juin 2019 - Juin 2020"
  const DATE_RE = /^(jan|fév|feb|mar|avr|apr|mai|may|juin|jun|juil|jul|août|aug|sep|oct|nov|déc|dec|janvier|février|mars|avril|juillet|août|septembre|octobre|novembre|décembre)\w*\s+\d{4}(\s*[-–]\s*(\w+\s+)?\d{4}|\s*[-–]\s*(present|présent|actuel|aujourd'hui|current|now))/i;

  for (const line of lines) {
    if (DATE_RE.test(line)) {
      if (cur) entries.push(cur);
      cur = { dateRange: line, company: '', role: '', workEnv: '', project: '', tasks: [], techEnv: '' };
      phase = 'company';
      continue;
    }

    if (!cur) continue;

    // Detect sub-labels
    if (/^Environnement de travail\s*:/i.test(line)) {
      cur.workEnv = line.replace(/^[^:]+:\s*/, '').trim();
      phase = 'meta';
    } else if (/^Projet\s*:/i.test(line)) {
      phase = 'project';
      const rest = line.replace(/^[^:]+:\s*/, '').trim();
      if (rest) cur.project += rest + ' ';
    } else if (/^Principales?\s+T[aâ]ches?\s*:/i.test(line)) {
      phase = 'tasks';
    } else if (/^Environnement technique\s*:/i.test(line)) {
      phase = 'techenv';
      const rest = line.replace(/^[^:]+:\s*/, '').trim();
      if (rest) cur.techEnv += rest + ' ';
    } else {
      // Assign based on phase
      if (phase === 'company' && !cur.company) {
        cur.company = line;
        phase = 'role';
      } else if (phase === 'role' && !cur.role) {
        cur.role = line;
        phase = 'none';
      } else if (phase === 'project') {
        cur.project += line + ' ';
      } else if (phase === 'tasks') {
        const clean = line.replace(/^[•·\-\*▪◦]+\s*/, '').trim();
        if (clean) cur.tasks.push(clean);
      } else if (phase === 'techenv') {
        cur.techEnv += line + ' ';
      }
    }
  }
  if (cur) entries.push(cur);

  // Clean up
  return entries.map(e => ({
    ...e,
    project: e.project.trim(),
    techEnv: e.techEnv.trim()
  }));
}

// ============================================================
// FORM POPULATION
// ============================================================
function populateForm(data) {
  $('fName').value  = data.name  || '';
  $('fTitle').value = data.title || '';

  // Formation
  $('formationList').innerHTML = '';
  if (data.formation.length) {
    data.formation.forEach(f => addFormationRow(f.year, f.description));
  } else {
    addFormationRow();
  }

  // Certifications
  $('certList').innerHTML = '';
  if (data.certifications.length) {
    data.certifications.forEach(c => addCertRow(c.year, c.name));
  } else {
    addCertRow();
  }

  // Tech skills
  $('techSkillList').innerHTML = '';
  if (data.techSkills.length) {
    data.techSkills.forEach(s => addTechSkillRow(s.category, s.items));
  } else {
    addTechSkillRow();
  }

  // Functional skills
  $('fFuncSkills').value = data.funcSkills.join('\n');

  // Languages
  $('langList').innerHTML = '';
  if (data.languages.length) {
    data.languages.forEach(l => addLangRow(l.language, l.level));
  } else {
    addLangRow();
  }

  // Experience
  $('expList').innerHTML = '';
  if (data.experience.length) {
    data.experience.forEach(e => addExpEntry(e));
  } else {
    addExpEntry();
  }
}

// ---- Dynamic form row builders --------------------------

function addFormationRow(year = '', description = '') {
  const row = makeEntryRow('Formation', `
    <div class="form-row-2">
      <div class="form-field"><label>Année</label><input type="text" class="f-year" value="${esc(year)}" placeholder="2016"></div>
      <div class="form-field"><label>Diplôme / École</label><input type="text" class="f-desc" value="${esc(description)}" placeholder="Diplôme d'ingénieur – École Polytechnique"></div>
    </div>
  `);
  $('formationList').appendChild(row);
}

function addCertRow(year = '', name = '') {
  const row = makeEntryRow('Certification', `
    <div class="form-row-2">
      <div class="form-field"><label>Année</label><input type="text" class="c-year" value="${esc(year)}" placeholder="2022"></div>
      <div class="form-field"><label>Intitulé</label><input type="text" class="c-name" value="${esc(name)}" placeholder="Certified Data Engineer – Databricks"></div>
    </div>
  `);
  $('certList').appendChild(row);
}

function addTechSkillRow(category = '', items = '') {
  const row = makeEntryRow('Catégorie', `
    <div class="form-row-2">
      <div class="form-field"><label>Catégorie</label><input type="text" class="ts-cat" value="${esc(category)}" placeholder="Langages"></div>
      <div class="form-field"><label>Éléments</label><input type="text" class="ts-items" value="${esc(items)}" placeholder="Java, Scala, Python, SQL…"></div>
    </div>
  `);
  $('techSkillList').appendChild(row);
}

function addLangRow(language = '', level = '') {
  const row = makeEntryRow('Langue', `
    <div class="form-row-2">
      <div class="form-field"><label>Langue</label><input type="text" class="l-lang" value="${esc(language)}" placeholder="Anglais"></div>
      <div class="form-field"><label>Niveau</label><input type="text" class="l-level" value="${esc(level)}" placeholder="Niveau avancé"></div>
    </div>
  `);
  $('langList').appendChild(row);
}

function addExpEntry(e = {}) {
  const row = makeEntryRow('Expérience', `
    <div class="form-row-2" style="margin-bottom:10px">
      <div class="form-field"><label>Période (ex : Oct 2023 – Présent)</label><input type="text" class="e-date" value="${esc(e.dateRange||'')}" placeholder="Octobre 2023 – Présent"></div>
      <div class="form-field"><label>Entreprise</label><input type="text" class="e-company" value="${esc(e.company||'')}" placeholder="ENEDIS"></div>
    </div>
    <div class="form-row-2" style="margin-bottom:10px">
      <div class="form-field"><label>Rôle / Poste</label><input type="text" class="e-role" value="${esc(e.role||'')}" placeholder="Data Engineer"></div>
      <div class="form-field"><label>Environnement de travail</label><input type="text" class="e-env" value="${esc(e.workEnv||'')}" placeholder="Anglophone"></div>
    </div>
    <div class="form-field" style="margin-bottom:10px">
      <label>Projet (description libre)</label>
      <textarea class="e-project" rows="3" placeholder="Description du projet…">${esc(e.project||'')}</textarea>
    </div>
    <div class="form-field" style="margin-bottom:10px">
      <label>Principales Tâches <span class="form-hint-inline">(une par ligne)</span></label>
      <textarea class="e-tasks" rows="5" placeholder="Conception et développement de jobs Spark…&#10;Mise en place de pipelines CI/CD…">${esc((e.tasks||[]).join('\n'))}</textarea>
    </div>
    <div class="form-field">
      <label>Environnement technique</label>
      <input type="text" class="e-techenv" value="${esc(e.techEnv||'')}" placeholder="Java 17, Spark 3, Hadoop, Kafka, Docker…">
    </div>
  `);
  $('expList').appendChild(row);
}

function makeEntryRow(label, innerHtml) {
  const div = document.createElement('div');
  div.className = 'entry-row';
  div.innerHTML = `
    <div class="entry-header">
      <span class="entry-label">${label}</span>
      <button class="btn-remove" title="Supprimer">×</button>
    </div>
    ${innerHtml}
  `;
  div.querySelector('.btn-remove').addEventListener('click', () => div.remove());
  return div;
}

// ---- Collect form data ----------------------------------
function collectFormData() {
  const data = {
    name:  $('fName').value.trim(),
    title: $('fTitle').value.trim(),
    formation: [],
    certifications: [],
    techSkills: [],
    funcSkills: [],
    languages: [],
    experience: []
  };

  document.querySelectorAll('#formationList .entry-row').forEach(r => {
    const year = r.querySelector('.f-year')?.value.trim();
    const desc = r.querySelector('.f-desc')?.value.trim();
    if (desc) data.formation.push({ year: year || '', description: desc });
  });

  document.querySelectorAll('#certList .entry-row').forEach(r => {
    const year = r.querySelector('.c-year')?.value.trim();
    const name = r.querySelector('.c-name')?.value.trim();
    if (name) data.certifications.push({ year: year || '', name });
  });

  document.querySelectorAll('#techSkillList .entry-row').forEach(r => {
    const cat   = r.querySelector('.ts-cat')?.value.trim();
    const items = r.querySelector('.ts-items')?.value.trim();
    if (cat || items) data.techSkills.push({ category: cat || '', items: items || '' });
  });

  data.funcSkills = $('fFuncSkills').value.split('\n').map(l => l.trim()).filter(Boolean);

  document.querySelectorAll('#langList .entry-row').forEach(r => {
    const lang  = r.querySelector('.l-lang')?.value.trim();
    const level = r.querySelector('.l-level')?.value.trim();
    if (lang) data.languages.push({ language: lang, level: level || '' });
  });

  document.querySelectorAll('#expList .entry-row').forEach(r => {
    const tasks = (r.querySelector('.e-tasks')?.value || '')
      .split('\n').map(l => l.replace(/^[•·\-\*]+\s*/, '').trim()).filter(Boolean);
    data.experience.push({
      dateRange: r.querySelector('.e-date')?.value.trim()    || '',
      company:   r.querySelector('.e-company')?.value.trim() || '',
      role:      r.querySelector('.e-role')?.value.trim()    || '',
      workEnv:   r.querySelector('.e-env')?.value.trim()     || '',
      project:   r.querySelector('.e-project')?.value.trim() || '',
      tasks,
      techEnv:   r.querySelector('.e-techenv')?.value.trim() || ''
    });
  });

  return data;
}

// ---- Generate & render CV -------------------------------
function generateCV() {
  const data = collectFormData();
  renderCV(data);
  showSection('previewSection');
  scaleCVWrapper();
}

function renderCV(data) {
  $('cvName').textContent  = data.name  || '';
  $('cvTitle').textContent = data.title || '';

  // Formation
  renderTable('cvFormation', data.formation, f =>
    `<tr><td>${escHtml(f.year)}</td><td>${escHtml(f.description)}</td></tr>`
  );
  $('sec-formation').style.display = data.formation.length ? '' : 'none';

  // Certifications
  renderTable('cvCertifications', data.certifications, c =>
    `<tr><td>${escHtml(c.year)}</td><td>${escHtml(c.name)}</td></tr>`
  );
  $('sec-certifications').style.display = data.certifications.length ? '' : 'none';

  // Tech skills
  renderTable('cvTechSkills', data.techSkills, s =>
    `<tr><td>${escHtml(s.category)}</td><td>${escHtml(s.items)}</td></tr>`
  );
  $('sec-techskills').style.display = data.techSkills.length ? '' : 'none';

  // Functional skills
  const funcEl = $('cvFuncSkills');
  funcEl.innerHTML = data.funcSkills.map(s => `<p>${escHtml(s)}</p>`).join('');
  $('sec-funcskills').style.display = data.funcSkills.length ? '' : 'none';

  // Languages
  renderTable('cvLanguages', data.languages, l =>
    `<tr><td>${escHtml(l.language)}</td><td>${escHtml(l.level)}</td></tr>`
  );
  $('sec-languages').style.display = data.languages.length ? '' : 'none';

  // Experience
  const expEl = $('cvExperience');
  expEl.innerHTML = '';
  data.experience.forEach(e => {
    if (!e.company && !e.role && !e.dateRange) return;
    const tr = document.createElement('tr');

    // Left cell: date
    const tdDate = document.createElement('td');
    tdDate.textContent = e.dateRange;
    tr.appendChild(tdDate);

    // Right cell: content
    const tdContent = document.createElement('td');
    let html = '';
    html += `<div class="cv-exp-company">${escHtml(e.company)}</div>`;
    html += `<div class="cv-exp-role">${escHtml(e.role)}</div>`;
    if (e.workEnv) html += `<div class="cv-exp-meta">Environnement de travail : ${escHtml(e.workEnv)}</div>`;
    if (e.project) {
      html += `<div class="cv-exp-section-label">Projet :</div>`;
      html += `<div class="cv-exp-meta">${escHtml(e.project)}</div>`;
    }
    if (e.tasks.length) {
      html += `<div class="cv-exp-section-label">Principales Tâches :</div>`;
      html += `<ul class="cv-exp-bullets">${e.tasks.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>`;
    }
    if (e.techEnv) {
      html += `<div class="cv-exp-section-label">Environnement technique :</div>`;
      html += `<div class="cv-exp-techenv">${escHtml(e.techEnv)}</div>`;
    }
    tdContent.innerHTML = html;
    tr.appendChild(tdContent);
    expEl.appendChild(tr);
  });
  $('sec-experience').style.display = data.experience.length ? '' : 'none';
}

function renderTable(id, items, rowFn) {
  const el = $(id);
  el.innerHTML = items.map(rowFn).join('');
}

// ---- PDF download ---------------------------------------
async function downloadPDF() {
  const btn = $('downloadBtn');
  btn.disabled = true;
  const origText = btn.innerHTML;
  btn.textContent = 'Génération…';

  // Temporarily remove scaling so we capture at full 794px
  const wrapper = document.querySelector('.cv-wrapper');
  const prevTransform = wrapper.style.transform;
  const prevMargin    = wrapper.style.marginBottom;
  wrapper.style.transform    = '';
  wrapper.style.marginBottom = '';

  try {
    const cvPage = $('cvPage');
    const canvas = await html2canvas(cvPage, {
      scale: 2, useCORS: true, allowTaint: false,
      backgroundColor: '#ffffff', logging: false
    });

    wrapper.style.transform    = prevTransform;
    wrapper.style.marginBottom = prevMargin;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

    const pdfW = 210, pdfH = 297;
    const pageHeightPx = Math.floor(canvas.width * pdfH / pdfW);
    let yOffset = 0, page = 0;

    while (yOffset < canvas.height) {
      const sliceH = Math.min(pageHeightPx, canvas.height - yOffset);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, slice.width, sliceH);
      ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      if (page > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, sliceH * pdfW / canvas.width);
      yOffset += pageHeightPx;
      page++;
    }

    const filename = `CV_${($('cvName').textContent || 'cv').trim().replace(/\s+/g, '_')}.pdf`;
    pdf.save(filename);

  } catch (err) {
    wrapper.style.transform    = prevTransform;
    wrapper.style.marginBottom = prevMargin;
    alert('Erreur PDF : ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

// ---- CV scaling for narrow screens ----------------------
function scaleCVWrapper() {
  const wrapper = document.querySelector('.cv-wrapper');
  if (!wrapper) return;
  const available = window.innerWidth - 48;
  const cvWidth = 794;
  if (available < cvWidth) {
    const scale = available / cvWidth;
    wrapper.style.transform    = `scale(${scale})`;
    wrapper.style.transformOrigin = 'top center';
    wrapper.style.marginBottom = `${(cvWidth * scale) - cvWidth}px`;
  } else {
    wrapper.style.transform    = '';
    wrapper.style.marginBottom = '';
  }
}

// ---- Utilities ------------------------------------------
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function esc(str) { return escHtml(str); }
