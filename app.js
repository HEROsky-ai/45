/* ============================================================
   app.js — 症狀圖片資料庫核心邏輯
   Supabase (永久儲存) + Tesseract.js (OCR) + 症狀標籤搜尋
   ============================================================ */

'use strict';

// ─── State ──────────────────────────────────────────────────
let sbClient       = null;   // Supabase client instance
let allImages      = [];     // 全部圖片快取
let currentTags    = [];     // 正在編輯的標籤
let currentEditTags = [];    // 正在編輯已有圖片的標籤
let selectedFile   = null;   // 已選擇的圖片 File
let lightboxImage  = null;   // 目前 lightbox 顯示的圖片物件
let ocrCollapsed   = false;  // OCR 文字是否收合

const TABLE  = 'symptom_images';
const BUCKET = 'symptom-images';

// ─── DOM refs ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ─── 預設連線設定（自動綁定，無需手動輸入）────────────────────
const DEFAULT_URL = 'https://yfttffzcispszjaoxqiw.supabase.co';
const DEFAULT_KEY = 'sb_publishable_IY6O3rUMszZikO6qTVSxkA_DywSiC3i';

// ─── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 永遠先掛上設定視窗的按鈕
  $('saveConfigBtn').addEventListener('click', saveConfig);
  $('settingsBtn').addEventListener('click', () => {
    const url = localStorage.getItem('sb_url') || DEFAULT_URL;
    const key = localStorage.getItem('sb_key') || DEFAULT_KEY;
    $('sbUrlInput').value = url;
    $('sbKeyInput').value = key;
    showSetupModal();
  });

  // Enter 鍵也能送出設定
  [$('sbUrlInput'), $('sbKeyInput')].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') saveConfig(); })
  );

  // 讀取並驗證 localStorage 中的設定
  let url = localStorage.getItem('sb_url');
  let key = localStorage.getItem('sb_key');

  // 如果沒有設定，或者設定是空的、無效的，就強制重設為預設的自動綁定金鑰
  if (!url || url.trim() === '' || url === 'undefined' || !key || key.trim() === '' || key === 'undefined') {
    url = DEFAULT_URL;
    key = DEFAULT_KEY;
    localStorage.setItem('sb_url', url);
    localStorage.setItem('sb_key', key);
  }

  // 直接連線，隱藏設定視窗並初始化
  $('setupModal').style.display = 'none';
  initSupabase(url, key);
  setupEventListeners();
  loadImages();
});

// ─── Supabase ───────────────────────────────────────────────
function initSupabase(url, key) {
  sbClient = supabase.createClient(url, key);
}

async function loadImages(query = '') {
  $('loadingState').style.display = 'block';
  $('gallery').innerHTML = '';
  $('emptyState').style.display = 'none';

  try {
    const { data, error } = await sbClient
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    allImages = data || [];
    const filtered = query ? filterImages(allImages, query) : allImages;
    renderGallery(filtered, query);
    renderTagCloud(allImages);
    updateTagSuggestions();
    updateStats(filtered.length, allImages.length, query);

  } catch (err) {
    console.error('loadImages error:', err);
    showToast('⚠️ 無法連線 Supabase，請確認設定', 'error');
    $('loadingState').style.display = 'none';
    $('emptyState').style.display = 'block';
    $('emptyMsg').textContent = '無法載入資料，請檢查 Supabase 設定';
  }
}

function filterImages(images, query) {
  const q = query.trim().toLowerCase();
  if (!q) return images;
  return images.filter(img =>
    img.symptoms?.some(s => s.toLowerCase().includes(q)) ||
    img.ocr_text?.toLowerCase().includes(q) ||
    img.title?.toLowerCase().includes(q) ||
    img.notes?.toLowerCase().includes(q)
  );
}

async function uploadToStorage(file) {
  const ext  = file.name.split('.').pop();
  const name = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { data, error } = await sbClient.storage
    .from(BUCKET)
    .upload(name, file, { cacheControl: '3600', upsert: false });

  if (error) throw error;

  const { data: urlData } = sbClient.storage.from(BUCKET).getPublicUrl(data.path);
  return urlData.publicUrl;
}

async function insertImage({ title, imageUrl, symptoms, ocrText, notes }) {
  const { data, error } = await sbClient
    .from(TABLE)
    .insert([{
      title:    title || '學員',
      image_url: imageUrl,
      symptoms:  symptoms,
      ocr_text:  ocrText,
      notes:     notes || '',
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteImageById(id, imageUrl) {
  // Delete from DB
  const { error: dbErr } = await sbClient.from(TABLE).delete().eq('id', id);
  if (dbErr) throw dbErr;

  // Delete from Storage
  try {
    const path = imageUrl.split(`/${BUCKET}/`)[1];
    if (path) await sbClient.storage.from(BUCKET).remove([path]);
  } catch (e) {
    console.warn('Storage delete warning:', e);
  }
}



// ─── Render ──────────────────────────────────────────────────
function renderGallery(images, query = '') {
  $('loadingState').style.display = 'none';
  const gallery = $('gallery');
  gallery.innerHTML = '';

  if (images.length === 0) {
    $('emptyState').style.display = 'block';
    $('emptyMsg').textContent = query
      ? `找不到包含「${query}」的圖片，請嘗試其他關鍵字`
      : '尚未上傳任何圖片，點擊右下角「＋」開始新增';
    return;
  }

  $('emptyState').style.display = 'none';

  images.forEach((img, i) => {
    const card = buildCard(img, i, query);
    gallery.appendChild(card);
  });
}

function buildCard(img, index, query = '') {
  const card = document.createElement('div');
  card.className = 'img-card';
  card.setAttribute('role', 'listitem');
  card.style.animationDelay = `${Math.min(index * 40, 400)}ms`;

  const date = new Date(img.created_at).toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'short', day: 'numeric'
  });

  const tags = (img.symptoms || []).slice(0, 6);
  const tagsHtml = tags.map(t =>
    `<span class="tag-chip">${highlightText(escHtml(t), query)}</span>`
  ).join('');

  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${escHtml(img.image_url)}" alt="${escHtml(img.title)}" loading="lazy">
      <div class="card-overlay"></div>
    </div>
    <div class="card-body">
      <div class="card-title">${highlightText(escHtml(img.title || '未命名'), query)}</div>
      <div class="card-tags">${tagsHtml}</div>
      <div class="card-date">📅 ${date}</div>
    </div>
  `;

  card.addEventListener('click', () => openLightbox(img));
  return card;
}

function highlightText(text, query) {
  if (!query) return text;
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${q})`, 'gi'),
    '<mark style="background:rgba(129,140,248,0.3);color:inherit;border-radius:3px;padding:0 2px;">$1</mark>'
  );
}

function renderTagCloud(images) {
  const tagCount = {};
  images.forEach(img => {
    (img.symptoms || []).forEach(t => {
      tagCount[t] = (tagCount[t] || 0) + 1;
    });
  });

  // Top 15 most common tags
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);

  const cloud = $('tagCloud');
  cloud.innerHTML = topTags.map(tag =>
    `<button class="tag-chip-filter" data-tag="${escHtml(tag)}">${escHtml(tag)}</button>`
  ).join('');

  cloud.querySelectorAll('.tag-chip-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const input = $('searchInput');
      input.value = tag;
      input.dispatchEvent(new Event('input'));
      triggerSearch(tag);
      toggleSearchClear(tag);
    });
  });
}

function getAllUniqueTags() {
  const tags = new Set();
  allImages.forEach(img => {
    (img.symptoms || []).forEach(t => {
      if (t) tags.add(t.trim());
    });
  });
  return Array.from(tags).sort();
}

function updateTagSuggestions() {
  const uniqueTags = getAllUniqueTags();
  const datalist = $('existingTags');
  if (datalist) {
    datalist.innerHTML = uniqueTags.map(tag =>
      `<option value="${escHtml(tag)}">`
    ).join('');
  }
}

function updateStats(shown, total, query) {
  const text = query
    ? `搜尋「${query}」：共找到 ${shown} 張圖片 （資料庫共 ${total} 張）`
    : `資料庫共 ${total} 張圖片`;
  $('statsText').textContent = text;
}

// ─── Lightbox ────────────────────────────────────────────────
function openLightbox(img, pushState = true) {
  lightboxImage = img;
  currentEditTags = [...(img.symptoms || [])];

  // 預設切換回檢視模式
  $('lightboxViewMode').style.display = 'block';
  $('lightboxEditMode').style.display = 'none';

  $('lightboxImg').src = img.image_url;
  $('lightboxImg').alt = img.title || '症狀圖片';
  $('lightboxTitle').textContent = img.title || '未命名';

  const date = new Date(img.created_at).toLocaleString('zh-TW');
  $('lightboxMeta').textContent = `📅 上傳於 ${date}`;

  const tags = (img.symptoms || []);
  $('lightboxTags').innerHTML = tags.map(t =>
    `<span class="tag-chip">${escHtml(t)}</span>`
  ).join('') || '<span style="color:var(--text-3);font-size:13px">尚無症狀標籤</span>';

  $('lightboxNotes').textContent = img.notes || '（無備註說明）';

  $('lightbox').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  if (pushState) {
    window.history.pushState({ modal: 'lightbox' }, '');
  }
}

function closeLightbox(popState = true) {
  if (popState && window.history.state && window.history.state.modal === 'lightbox') {
    window.history.back();
  } else {
    $('lightbox').style.display = 'none';
    document.body.style.overflow = '';
    lightboxImage = null;
    currentEditTags = [];
  }
}

// ─── Image Fullscreen Zoom ──────────────────────────────────
function openZoom(pushState = true) {
  if (!lightboxImage) return;
  $('zoomedImg').src = lightboxImage.image_url;
  $('zoomModal').style.display = 'flex';

  if (pushState) {
    window.history.pushState({ modal: 'zoom' }, '');
  }
}

function closeZoom(popState = true) {
  if (popState && window.history.state && window.history.state.modal === 'zoom') {
    window.history.back();
  } else {
    $('zoomModal').style.display = 'none';
    $('zoomedImg').src = '';
  }
}

function openEditMode() {
  if (!lightboxImage) return;

  $('lightboxViewMode').style.display = 'none';
  $('lightboxEditMode').style.display = 'block';

  $('editTitleInput').value = lightboxImage.title || '';
  $('editNotesInput').value = lightboxImage.notes || '';
  renderEditTags();
}

function closeEditMode() {
  $('lightboxViewMode').style.display = 'block';
  $('lightboxEditMode').style.display = 'none';
  currentEditTags = [...(lightboxImage.symptoms || [])];
}

function renderEditTags() {
  const container = $('editTagsContainer');
  container.innerHTML = '';
  currentEditTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-editable';
    chip.innerHTML = `${escHtml(tag)}<button class="tag-remove-edit" data-idx="${i}" title="移除標籤">✕</button>`;
    container.appendChild(chip);
  });

  container.querySelectorAll('.tag-remove-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.idx);
      currentEditTags.splice(idx, 1);
      renderEditTags();
    });
  });
}

function addEditTag(tagText) {
  const tag = tagText.trim();
  if (!tag) return;
  if (currentEditTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
    showToast('標籤已存在', 'error');
    return;
  }
  currentEditTags.push(tag);
  renderEditTags();
  $('editTagInput').value = '';
  $('editTagInput').focus();
}

async function saveEditImage() {
  if (!lightboxImage) return;

  const newTitle = $('editTitleInput').value.trim() || '學員';
  const newNotes = $('editNotesInput').value.trim() || '';

  $('editSaveBtn').disabled = true;
  $('editSaveBtnText').textContent = '儲存中…';
  $('editSaveSpinner').style.display = 'block';

  try {
    const { data, error } = await sbClient
      .from(TABLE)
      .update({
        title: newTitle,
        symptoms: currentEditTags,
        notes: newNotes
      })
      .eq('id', lightboxImage.id)
      .select()
      .single();

    if (error) throw error;

    // 更新本地快取
    const index = allImages.findIndex(img => img.id === lightboxImage.id);
    if (index !== -1) {
      allImages[index] = data;
    }

    // 重新更新 Lightbox 的內容
    lightboxImage = data;
    $('lightboxTitle').textContent = data.title || '學員';
    $('lightboxTags').innerHTML = currentEditTags.map(t =>
      `<span class="tag-chip">${escHtml(t)}</span>`
    ).join('') || '<span style="color:var(--text-3);font-size:13px">尚無症狀標籤</span>';
    $('lightboxNotes').textContent = data.notes || '（無備註說明）';

    // 重新渲染主畫面的 Gallery 和標籤雲
    const query = $('searchInput').value.trim();
    renderGallery(filterImages(allImages, query), query);
    renderTagCloud(allImages);
    updateTagSuggestions();
    updateStats(filterImages(allImages, query).length, allImages.length, query);

    showToast('✅ 資料已成功更新！', 'success');
    closeEditMode();

  } catch (err) {
    console.error('saveEditImage error:', err);
    showToast('❌ 儲存失敗：' + (err.message || '未知錯誤'), 'error');
  } finally {
    $('editSaveBtn').disabled = false;
    $('editSaveBtnText').textContent = '儲存';
    $('editSaveSpinner').style.display = 'none';
  }
}

// ─── Upload flow ─────────────────────────────────────────────
function openUploadModal(pushState = true) {
  resetUploadModal();
  $('uploadModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  if (pushState) {
    window.history.pushState({ modal: 'upload' }, '');
  }
}

function closeUploadModal(popState = true) {
  if (popState && window.history.state && window.history.state.modal === 'upload') {
    window.history.back();
  } else {
    $('uploadModal').style.display = 'none';
    document.body.style.overflow = '';
    selectedFile = null;
    currentTags = [];
  }
}

function resetUploadModal() {
  selectedFile = null;
  currentTags = [];
  $('dropZone').style.display = 'block';
  $('previewSection').style.display = 'none';
  $('uploadFooter').style.display = 'none';
  $('tagsContainer').innerHTML = '';
  $('titleInput').value = '';
  $('tagInput').value = '';
  $('notesInput').value = '';
  $('saveBtn').disabled = true;
  $('saveBtnText').textContent = '儲存圖片';
  $('saveSpinner').style.display = 'none';
  $('previewImg').src = '';
}

async function handleFileSelected(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('⚠️ 請選擇圖片檔案', 'error');
    return;
  }

  selectedFile = file;

  // Show preview
  const reader = new FileReader();
  reader.onload = e => { $('previewImg').src = e.target.result; };
  reader.readAsDataURL(file);

  $('dropZone').style.display = 'none';
  $('previewSection').style.display = 'block';
  $('uploadFooter').style.display = 'flex';

  // 預設填入名稱「學員」
  $('titleInput').value = '學員';

  // 初始化空白標籤列表以供手動新增
  currentTags = [];
  renderEditableTags();

  $('saveBtn').disabled = false;
}

function renderEditableTags() {
  const container = $('tagsContainer');
  container.innerHTML = '';
  currentTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-editable';
    chip.innerHTML = `${escHtml(tag)}<button class="tag-remove" data-idx="${i}" title="移除標籤">✕</button>`;
    container.appendChild(chip);
  });

  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(e.target.dataset.idx);
      currentTags.splice(idx, 1);
      renderEditableTags();
    });
  });
}

function addTag(tagText) {
  const tag = tagText.trim();
  if (!tag) return;
  if (currentTags.some(t => t.toLowerCase() === tag.toLowerCase())) {
    showToast('標籤已存在', 'error');
    return;
  }
  currentTags.push(tag);
  renderEditableTags();
  $('tagInput').value = '';
  $('tagInput').focus();
}

async function saveImage() {
  if (!selectedFile) return;

  const title = $('titleInput').value.trim() || '學員';
  const ocrText = ''; // 移除 OCR 功能，直接帶入空值
  const notes = $('notesInput').value.trim() || '';

  $('saveBtn').disabled = true;
  $('saveBtnText').textContent = '上傳中…';
  $('saveSpinner').style.display = 'block';

  try {
    // 1. Upload image to Supabase Storage
    showToast('正在上傳圖片…');
    const imageUrl = await uploadToStorage(selectedFile);

    // 2. Save metadata to Supabase DB
    showToast('正在儲存資料…');
    const newImg = await insertImage({
      title,
      imageUrl,
      symptoms: currentTags,
      ocrText,
      notes,
    });

    // 3. Update local state
    allImages.unshift(newImg);
    const query = $('searchInput').value.trim();
    renderGallery(filterImages(allImages, query), query);
    renderTagCloud(allImages);
    updateTagSuggestions();
    updateStats(filterImages(allImages, query).length, allImages.length, query);

    showToast('✅ 圖片已成功儲存！', 'success');
    closeUploadModal();

  } catch (err) {
    console.error('saveImage error:', err);
    showToast('❌ 儲存失敗：' + (err.message || '未知錯誤'), 'error');
    $('saveBtn').disabled = false;
    $('saveBtnText').textContent = '儲存圖片';
    $('saveSpinner').style.display = 'none';
  }
}

async function deleteCurrentImage() {
  if (!lightboxImage) return;

  const confirmed = confirm(`確定要刪除「${lightboxImage.title || '此圖片'}」嗎？\n此操作無法復原。`);
  if (!confirmed) return;

  try {
    await deleteImageById(lightboxImage.id, lightboxImage.image_url);

    allImages = allImages.filter(i => i.id !== lightboxImage.id);
    const query = $('searchInput').value.trim();
    renderGallery(filterImages(allImages, query), query);
    renderTagCloud(allImages);
    updateTagSuggestions();
    updateStats(filterImages(allImages, query).length, allImages.length, query);

    closeLightbox();
    showToast('🗑️ 圖片已刪除', 'success');
  } catch (err) {
    console.error('delete error:', err);
    showToast('❌ 刪除失敗：' + (err.message || '未知錯誤'), 'error');
  }
}

// ─── Search ──────────────────────────────────────────────────
let searchTimer = null;

function triggerSearch(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const filtered = filterImages(allImages, query);
    renderGallery(filtered, query);
    updateStats(filtered.length, allImages.length, query);

    // Highlight active tag in cloud
    document.querySelectorAll('.tag-chip-filter').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tag === query);
    });
  }, 150);
}

function toggleSearchClear(value) {
  const btn = $('searchClear');
  btn.classList.toggle('visible', value.length > 0);
}

// ─── Setup Modal ─────────────────────────────────────────────
function showSetupModal() {
  $('setupModal').style.display = 'flex';
}

function saveConfig() {
  const url = $('sbUrlInput').value.trim();
  const key = $('sbKeyInput').value.trim();

  if (!url || !key) {
    showToast('⚠️ 請填寫完整的 Supabase URL 和 Key', 'error');
    return;
  }

  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    showToast('⚠️ URL 格式不正確', 'error');
    return;
  }

  localStorage.setItem('sb_url', url);
  localStorage.setItem('sb_key', key);
  $('setupModal').style.display = 'none';

  initSupabase(url, key);
  setupEventListeners();
  loadImages();
}

// ─── Toast ───────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, type = '') {
  const toast = $('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ─── Helpers ─────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Event Listeners ─────────────────────────────────────────
function setupEventListeners() {

  // ── Search ──
  $('searchInput').addEventListener('input', e => {
    const q = e.target.value;
    toggleSearchClear(q);
    triggerSearch(q);
  });

  $('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.target.value = '';
      toggleSearchClear('');
      triggerSearch('');
    }
  });

  $('searchClear').addEventListener('click', () => {
    $('searchInput').value = '';
    toggleSearchClear('');
    triggerSearch('');
    $('searchInput').focus();
  });

  // ── Upload FAB ──
  $('fab').addEventListener('click', openUploadModal);
  $('uploadHeaderBtn').addEventListener('click', openUploadModal);

  // ── Upload Modal close ──
  $('closeUploadBtn').addEventListener('click', closeUploadModal);
  $('cancelUploadBtn').addEventListener('click', closeUploadModal);

  // ── File selection ──
  $('selectFileBtn').addEventListener('click', () => $('fileInput').click());
  $('reselectBtn').addEventListener('click', () => {
    $('fileInput').click();
  });

  $('fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFileSelected(file);
    e.target.value = '';
  });

  // ── Drag and drop ──
  const dropZone = $('dropZone');

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });

  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') $('fileInput').click();
  });

  dropZone.addEventListener('click', e => {
    // Only click file input when clicking drop zone background, not the button
    if (e.target === dropZone || e.target.classList.contains('drop-content') ||
        e.target.classList.contains('drop-icon') || e.target.classList.contains('drop-title') ||
        e.target.classList.contains('drop-sub') || e.target.classList.contains('drop-formats')) {
      $('fileInput').click();
    }
  });

  // ── Tag input ──
  $('addTagBtn').addEventListener('click', () => addTag($('tagInput').value));
  $('tagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag($('tagInput').value);
    }
  });

  const handleAutocompleteSelect = (inputEl, addFn) => {
    inputEl.addEventListener('input', (e) => {
      const val = inputEl.value.trim();
      if (!val) return;
      
      const typingTypes = ['insertText', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward'];
      // 當使用者從下拉選單點選標籤時，觸發自動新增功能
      if (!typingTypes.includes(e.inputType)) {
        const uniqueTags = getAllUniqueTags();
        if (uniqueTags.includes(val)) {
          addFn(val);
        }
      }
    });
  };

  handleAutocompleteSelect($('tagInput'), addTag);

  // ── Save ──
  $('saveBtn').addEventListener('click', saveImage);

  // ── Lightbox ──
  $('lightboxBg').addEventListener('click', () => closeLightbox());
  $('lightboxClose').addEventListener('click', () => closeLightbox());
  $('deleteBtn').addEventListener('click', deleteCurrentImage);
  $('lightboxBackBtn').addEventListener('click', () => closeLightbox());
  $('lightboxImg').addEventListener('click', () => openZoom());

  // ── Image Zoom Modal ──
  $('zoomContent').addEventListener('click', () => closeZoom());
  $('zoomClose').addEventListener('click', (e) => {
    e.stopPropagation();
    closeZoom();
  });

  // ── Lightbox Edit Mode ──
  $('editBtn').addEventListener('click', openEditMode);
  $('editCancelBtn').addEventListener('click', closeEditMode);
  $('editSaveBtn').addEventListener('click', saveEditImage);
  $('editAddTagBtn').addEventListener('click', () => addEditTag($('editTagInput').value));
  $('editTagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEditTag($('editTagInput').value);
    }
  });

  handleAutocompleteSelect($('editTagInput'), addEditTag);

  // ── Browser History popstate (實作瀏覽器/手機返回鍵關閉視窗) ──
  window.addEventListener('popstate', (e) => {
    const state = e.state || {};
    
    // 1. 處理放大模式 (Zoom Modal)
    if (state.modal === 'zoom') {
      $('zoomModal').style.display = 'flex';
    } else {
      $('zoomModal').style.display = 'none';
      $('zoomedImg').src = '';
    }

    // 2. 處理詳情模式 (Lightbox Modal)
    if (state.modal === 'lightbox') {
      $('lightbox').style.display = 'flex';
      document.body.style.overflow = 'hidden';
    } else {
      $('lightbox').style.display = 'none';
      lightboxImage = null;
      currentEditTags = [];
    }

    // 3. 處理上傳模式 (Upload Modal)
    if (state.modal === 'upload') {
      $('uploadModal').style.display = 'flex';
      document.body.style.overflow = 'hidden';
    } else {
      $('uploadModal').style.display = 'none';
      selectedFile = null;
      currentTags = [];
    }

    // 如果沒有任何開著的 Modal，就還原 body 滾輪
    if (!state.modal) {
      document.body.style.overflow = '';
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('zoomModal').style.display !== 'none') {
        closeZoom();
      } else if ($('lightbox').style.display !== 'none') {
        // 如果在編輯模式下按 ESC，先退回唯讀檢視模式；若在檢視模式下則關閉 lightbox
        if ($('lightboxEditMode').style.display !== 'none') {
          closeEditMode();
        } else {
          closeLightbox();
        }
      }
      if ($('uploadModal').style.display !== 'none') closeUploadModal();
    }
  });

  // ── Settings ── 已移至 DOMContentLoaded 處理，勿重複綁定

  // ── Logo (go back to all) ──
  $('logoBtn').addEventListener('click', () => {
    $('searchInput').value = '';
    toggleSearchClear('');
    triggerSearch('');
  });

  // ── Paste image from clipboard ──
  document.addEventListener('paste', e => {
    if ($('uploadModal').style.display === 'none') return;
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) handleFileSelected(file);
    }
  });
}
