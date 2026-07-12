// App State
let allVideos = [];
let filteredVideos = [];
let isBatchDownloading = false;

// DOM Elements
const searchTypeSelect = document.getElementById('search-type');
const cookiesBrowserSelect = document.getElementById('cookies-browser');
const urlInputGroup = document.getElementById('url-input-group');
const urlLabel = document.getElementById('url-label');
const targetUrlInput = document.getElementById('target-url');
const searchQueryInput = document.getElementById('search-query');
const resultsLimitSelect = document.getElementById('results-limit');
const btnSearch = document.getElementById('btn-search');
const btnPlaylists = document.getElementById('btn-playlists');

const filterDurationMin = document.getElementById('filter-duration-min');
const filterDurationMax = document.getElementById('filter-duration-max');
const filterDateFrom = document.getElementById('filter-date-from');
const filterDateTo = document.getElementById('filter-date-to');
const filterDateSelect = document.getElementById('filter-date-select');
const customDateRangeContainer = document.getElementById('custom-date-range-container');
const filterViewsMin = document.getElementById('filter-views-min');
const filterViewsMax = document.getElementById('filter-views-max');
const filterLiveSelect = document.getElementById('filter-live');
const sortBySelect = document.getElementById('sort-by');
const btnApplyFilters = document.getElementById('btn-apply-filters');

const playlistsContainer = document.getElementById('playlists-container');
const playlistListUl = document.getElementById('playlist-list-ul');

const statTotal = document.getElementById('stat-total');
const statFiltered = document.getElementById('stat-filtered');
const btnDetectSubs = document.getElementById('btn-detect-subs');
const btnBatchDownload = document.getElementById('btn-batch-download');
const btnSelectSubUrls = document.getElementById('btn-select-sub-urls');
const btnSelectAllUrls = document.getElementById('btn-select-all-urls');
const btnCopySelectedUrls = document.getElementById('btn-copy-selected-urls');
const loadingSpinner = document.getElementById('loading-spinner');
const videoListContainer = document.getElementById('video-list-container');
const toast = document.getElementById('toast');

// Batch Progress Elements
const batchProgressContainer = document.getElementById('batch-progress-container');
const batchProgressText = document.getElementById('batch-progress-text');
const batchProgressCount = document.getElementById('batch-progress-count');
const batchProgressBar = document.getElementById('batch-progress-bar');

// Event Listeners
searchTypeSelect.addEventListener('change', handleSearchTypeChange);
btnSearch.addEventListener('click', performSearch);
btnPlaylists.addEventListener('click', fetchPlaylists);
btnApplyFilters.addEventListener('click', applyFiltersAndSort);
filterDateSelect.addEventListener('change', () => {
    if (filterDateSelect.value === 'custom') {
        customDateRangeContainer.style.display = 'flex';
    } else {
        customDateRangeContainer.style.display = 'none';
    }
});
btnDetectSubs.addEventListener('click', detectSubtitlesInBatch);
btnBatchDownload.addEventListener('click', performBatchDownload);
btnSelectSubUrls.addEventListener('click', selectSubVideos);
btnSelectAllUrls.addEventListener('click', selectAllVideos);
btnCopySelectedUrls.addEventListener('click', copySelectedUrls);

// Initialize Cookie browser and saved filters/search inputs from localStorage
if (localStorage.getItem('cookies-browser')) {
    cookiesBrowserSelect.value = localStorage.getItem('cookies-browser');
}
cookiesBrowserSelect.addEventListener('change', () => {
    localStorage.setItem('cookies-browser', cookiesBrowserSelect.value);
});

// Handle Search Type UI Changes
function handleSearchTypeChange() {
    const val = searchTypeSelect.value;
    if (val === 'global') {
        urlInputGroup.style.display = 'none';
        btnPlaylists.style.display = 'none';
        searchQueryInput.placeholder = '請輸入搜尋關鍵字...';
    } else if (val === 'channel') {
        urlInputGroup.style.display = 'flex';
        btnPlaylists.style.display = 'inline-flex';
        urlLabel.textContent = '頻道網址 / 名稱';
        targetUrlInput.placeholder = '例如: https://www.youtube.com/@GoogleDevs 或 GoogleDevs';
        searchQueryInput.placeholder = '在頻道內搜尋關鍵字（選填，留空顯示最新影片）...';
    } else if (val === 'playlist') {
        urlInputGroup.style.display = 'flex';
        btnPlaylists.style.display = 'none';
        urlLabel.textContent = '播放清單網址';
        targetUrlInput.placeholder = '例如: https://www.youtube.com/playlist?list=...';
        searchQueryInput.placeholder = '在播放清單內搜尋關鍵字（選填）...';
    }
}

// Fetch Channel Playlists
async function fetchPlaylists() {
    const channelUrl = targetUrlInput.value.trim();
    if (!channelUrl) {
        alert('請先輸入頻道網址或名稱！');
        return;
    }
    
    playlistsContainer.style.display = 'none';
    playlistListUl.innerHTML = '';
    
    showLoading(true);
    try {
        const cookiesBrowser = cookiesBrowserSelect.value;
        const res = await fetch(`/api/playlists?url=${encodeURIComponent(channelUrl)}&cookies_browser=${cookiesBrowser}`);
        const data = await res.json();
        
        if (data.success && data.playlists.length > 0) {
            playlistsContainer.style.display = 'block';
            data.playlists.forEach(pl => {
                const li = document.createElement('li');
                li.className = 'playlist-item';
                li.innerHTML = `
                    <span><i data-lucide="folder"></i> ${pl.title || '未命名播放清單'}</span>
                    <span class="playlist-badge">${pl.video_count || 0}</span>
                `;
                li.addEventListener('click', () => {
                    // Switch to playlist mode and fill URL
                    searchTypeSelect.value = 'playlist';
                    handleSearchTypeChange();
                    targetUrlInput.value = pl.url;
                    
                    // Highlight selected playlist
                    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'));
                    li.classList.add('active');
                    
                    // Trigger search
                    performSearch();
                });
                playlistListUl.appendChild(li);
            });
            lucide.createIcons();
        } else {
            alert('未找到任何播放清單，或該頻道不支援列表獲取');
        }
    } catch (err) {
        console.error(err);
        alert('獲取播放清單失敗，請確認網址是否正確');
    } finally {
        showLoading(false);
    }
}

// Perform Search API Call
async function performSearch() {
    const type = searchTypeSelect.value;
    const query = searchQueryInput.value.trim();
    const url = targetUrlInput.value.trim();
    const limit = resultsLimitSelect.value;

    // Save search inputs
    localStorage.setItem('search-type', type);
    localStorage.setItem('target-url', url);
    localStorage.setItem('search-query', query);
    localStorage.setItem('results-limit', limit);

    if (type !== 'global' && !url) {
        alert('請先輸入網址或搜尋目標！');
        return;
    }
    if (type === 'global' && !query) {
        alert('請輸入全域搜尋關鍵字！');
        return;
    }

    showLoading(true);
    videoListContainer.innerHTML = '';
    btnDetectSubs.disabled = true;
    btnBatchDownload.disabled = true;
    btnSelectSubUrls.disabled = true;
    btnSelectAllUrls.disabled = true;
    btnCopySelectedUrls.disabled = true;
    batchProgressContainer.style.display = 'none';
    allVideos = [];
    filteredVideos = [];
    statTotal.textContent = '0';
    statFiltered.textContent = '0';

    try {
        const cookiesBrowser = cookiesBrowserSelect.value;
        const dateRange = getCalculatedDateRange();
        const needsDateEnrich = !!(dateRange.from || dateRange.to);
        const apiUrl = `/api/search?type=${type}&query=${encodeURIComponent(query)}&url=${encodeURIComponent(url)}&limit=${limit}&cookies_browser=${cookiesBrowser}&enrich_dates=${needsDateEnrich}`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (data.success) {
            allVideos = data.results.map(v => ({
                ...v,
                subtitleStatus: 'unchecked', // 'unchecked', 'checking', 'yes', 'no'
                subtitles: null,
                checked: false
            }));
            
            statTotal.textContent = allVideos.length;
            applyFiltersAndSort();
            
            if (allVideos.length > 0) {
                btnDetectSubs.disabled = false;
            }
        } else {
            videoListContainer.innerHTML = `<div class="no-results"><p>搜尋出錯：${data.error || '未知錯誤'}</p></div>`;
        }
    } catch (err) {
        console.error(err);
        videoListContainer.innerHTML = `<div class="no-results"><p>連線伺服器失敗，請確認後端是否正常啟動</p></div>`;
    } finally {
        showLoading(false);
    }
}

// Helper to get calculated date range based on select dropdown
function getCalculatedDateRange() {
    const val = filterDateSelect.value;
    if (val === 'all') {
        return { from: '', to: '' };
    }
    if (val === 'custom') {
        return { from: filterDateFrom.value, to: filterDateTo.value };
    }
    
    const now = new Date();
    let fromDate = new Date();
    
    if (val === '1-week') {
        fromDate.setDate(now.getDate() - 7);
    } else if (val === '1-month') {
        fromDate.setMonth(now.getMonth() - 1);
    } else if (val === '3-months') {
        fromDate.setMonth(now.getMonth() - 3);
    } else if (val === '6-months') {
        fromDate.setMonth(now.getMonth() - 6);
    } else if (val === '1-year') {
        fromDate.setFullYear(now.getFullYear() - 1);
    } else if (val === '2-years') {
        fromDate.setFullYear(now.getFullYear() - 2);
    }
    
    const yyyy = fromDate.getFullYear();
    const mm = String(fromDate.getMonth() + 1).padStart(2, '0');
    const dd = String(fromDate.getDate()).padStart(2, '0');
    
    return { from: `${yyyy}-${mm}-${dd}`, to: '' };
}

// Helper to apply sidebar filters and sorting to any list of videos
function filterAndSortVideos(videosList) {
    const dateRange = getCalculatedDateRange();
    const dateFrom = dateRange.from;
    const dateTo = dateRange.to;
    const durMin = parseFloat(filterDurationMin.value) || 0;
    const durMax = parseFloat(filterDurationMax.value) || Infinity;
    const viewsMin = (parseFloat(filterViewsMin.value) || 0) * 10000;
    const viewsMax = (parseFloat(filterViewsMax.value) || Infinity) * 10000;
    const liveFilter = filterLiveSelect.value;
    const sortBy = sortBySelect.value;

    let filtered = videosList.filter(v => {
        const durationMinVal = v.duration ? v.duration / 60 : 0;
        const viewCountVal = v.view_count || 0;
        const isLiveVal = v.is_live || false;
        
        let passLive = true;
        if (liveFilter === 'video') {
            passLive = !isLiveVal;
        } else if (liveFilter === 'live') {
            passLive = isLiveVal;
        }

        let passDate = true;
        if (dateFrom || dateTo) {
            const videoDate = getVideoDateString(v);
            if (!videoDate) {
                passDate = false;
            } else {
                if (dateFrom && videoDate < dateFrom) passDate = false;
                if (dateTo && videoDate > dateTo) passDate = false;
            }
        }

        return durationMinVal >= durMin && 
               durationMinVal <= durMax && 
               viewCountVal >= viewsMin && 
               viewCountVal <= viewsMax &&
               passLive &&
               passDate;
    });

    if (sortBy === 'views-desc') {
        filtered.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    } else if (sortBy === 'views-asc') {
        filtered.sort((a, b) => (a.view_count || 0) - (b.view_count || 0));
    } else if (sortBy === 'duration-desc') {
        filtered.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else if (sortBy === 'duration-asc') {
        filtered.sort((a, b) => (a.duration || 0) - (b.duration || 0));
    } else if (sortBy === 'date-desc') {
        filtered.sort((a, b) => getVideoSortTimestamp(b) - getVideoSortTimestamp(a));
    } else if (sortBy === 'date-asc') {
        filtered.sort((a, b) => getVideoSortTimestamp(a) - getVideoSortTimestamp(b));
    }

    return filtered;
}

function getVideoDateString(video) {
    if (video.upload_date && video.upload_date.length === 8) {
        const s = video.upload_date;
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    if (video.timestamp) {
        const d = new Date(video.timestamp * 1000);
        return d.toISOString().slice(0, 10);
    }
    return null;
}

function getVideoSortTimestamp(video) {
    if (video.timestamp) return video.timestamp;
    if (video.upload_date && video.upload_date.length === 8) {
        const s = video.upload_date;
        return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`).getTime() / 1000;
    }
    return 0;
}

// Apply Filters and Sorting locally
function applyFiltersAndSort() {
    // Save filter parameters
    localStorage.setItem('filter-duration-min', filterDurationMin.value);
    localStorage.setItem('filter-duration-max', filterDurationMax.value);
    localStorage.setItem('filter-date-select', filterDateSelect.value);
    localStorage.setItem('filter-date-from', filterDateFrom.value);
    localStorage.setItem('filter-date-to', filterDateTo.value);
    localStorage.setItem('filter-views-min', filterViewsMin.value);
    localStorage.setItem('filter-views-max', filterViewsMax.value);
    localStorage.setItem('filter-live', filterLiveSelect.value);
    localStorage.setItem('sort-by', sortBySelect.value);

    filteredVideos = filterAndSortVideos(allVideos);

    statFiltered.textContent = filteredVideos.length;
    renderVideos();
    updateBatchControlsState();
}

// Update batch controls state
function updateBatchControlsState() {
    const noSubVideos = filteredVideos.filter(v => v.subtitleStatus === 'no');
    const hasSubVideos = filteredVideos.some(v => v.subtitleStatus === 'yes');
    const hasCheckedVideos = filteredVideos.some(v => v.checked);
    
    if (noSubVideos.length > 0 && !isBatchDownloading) {
        btnBatchDownload.disabled = false;
    } else {
        btnBatchDownload.disabled = true;
    }

    if (filteredVideos.length > 0 && !isBatchDownloading) {
        btnSelectAllUrls.disabled = false;
    } else {
        btnSelectAllUrls.disabled = true;
    }

    if (hasSubVideos && !isBatchDownloading) {
        btnSelectSubUrls.disabled = false;
    } else {
        btnSelectSubUrls.disabled = true;
    }

    if (hasCheckedVideos && !isBatchDownloading) {
        btnCopySelectedUrls.disabled = false;
    } else {
        btnCopySelectedUrls.disabled = true;
    }
}

// Render video cards
function renderVideos() {
    if (filteredVideos.length === 0) {
        videoListContainer.innerHTML = '<div class="no-results"><p>沒有符合當前篩選條件的影片</p></div>';
        return;
    }

    videoListContainer.innerHTML = '';
    filteredVideos.forEach(v => {
        const card = document.createElement('div');
        card.className = 'video-card';
        card.setAttribute('data-id', v.id);

        const durationStr = formatDuration(v.duration);
        const viewsStr = formatViews(v.view_count);
        const uploadDateStr = formatUploadDate(v);

        let subBadgeHtml = '';
        if (v.subtitleStatus === 'unchecked') {
            subBadgeHtml = '<span class="subtitle-badge loading">未偵測</span>';
        } else if (v.subtitleStatus === 'checking') {
            subBadgeHtml = '<span class="subtitle-badge loading">偵測中...</span>';
        } else if (v.subtitleStatus === 'yes') {
            subBadgeHtml = '<span class="subtitle-badge yes">有字幕</span>';
        } else if (v.subtitleStatus === 'no') {
            subBadgeHtml = '<span class="subtitle-badge no">無字幕</span>';
        }

        const isNoSub = v.subtitleStatus === 'no';
        const downloadBtnText = isNoSub ? '<i data-lucide="music"></i> 下載音訊 (無字幕推薦)' : '<i data-lucide="music"></i> 下載音訊';
        const downloadBtnClass = isNoSub ? 'btn-primary' : 'btn-secondary';

        // Wrap thumbnail and title inside <a> tag to directly navigate to YouTube
        card.innerHTML = `
            <div class="video-checkbox-wrapper">
                <input type="checkbox" class="video-checkbox" data-id="${v.id}" ${v.checked ? 'checked' : ''}>
            </div>
            <a href="${v.url}" target="_blank" class="video-thumbnail-wrapper" style="display: block; text-decoration: none;">
                <img class="video-thumbnail" src="${v.thumbnail || 'https://via.placeholder.com/180x101?text=No+Thumbnail'}" alt="${v.title}">
                <span class="video-duration">${durationStr}</span>
            </a>
            <div class="video-info">
                <a href="${v.url}" target="_blank" style="text-decoration: none; color: inherit;">
                    <h3 class="video-title" title="${v.title}">${v.title}</h3>
                </a>
                <div class="video-meta">
                    <span><i data-lucide="user"></i> ${v.uploader || '未知'}</span>
                    <span><i data-lucide="eye"></i> ${viewsStr}</span>
                    ${uploadDateStr ? `<span><i data-lucide="calendar"></i> ${uploadDateStr}</span>` : ''}
                    <span>字幕: ${subBadgeHtml}</span>
                    ${v.is_live ? '<span class="subtitle-badge yes" style="background-color: rgba(225, 29, 72, 0.1); color: var(--brand-primary);"><i data-lucide="radio"></i> 直播</span>' : ''}
                </div>
                <div class="video-actions">
                    <button class="btn btn-secondary btn-sm btn-copy" data-url="${v.url}"><i data-lucide="copy"></i> 複製網址</button>
                    <button class="btn ${downloadBtnClass} btn-sm btn-download" data-id="${v.id}">${downloadBtnText}</button>
                </div>
            </div>
        `;

        // Checkbox listener
        card.querySelector('.video-checkbox').addEventListener('change', (e) => {
            v.checked = e.target.checked;
            updateBatchControlsState();
        });

        // Copy button listener
        card.querySelector('.btn-copy').addEventListener('click', (e) => {
            const url = e.target.getAttribute('data-url');
            copyToClipboard(url);
        });

        // Download button listener
        card.querySelector('.btn-download').addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            downloadAudio(id, e.target);
        });

        videoListContainer.appendChild(card);
    });
    lucide.createIcons();
}

// Multi-threaded subtitle detection (Batch) with streaming updates
async function detectSubtitlesInBatch() {
    if (filteredVideos.length === 0) return;
    
    btnDetectSubs.disabled = true;
    btnBatchDownload.disabled = true;
    btnSelectSubUrls.disabled = true;
    btnSelectAllUrls.disabled = true;
    btnCopySelectedUrls.disabled = true;
    
    // Mark all visible as checking
    const ids = filteredVideos.map(v => v.id);
    filteredVideos.forEach(v => {
        v.subtitleStatus = 'checking';
    });
    renderVideos();

    try {
        const cookiesBrowser = cookiesBrowserSelect.value;
        const response = await fetch('/api/batch-info-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_ids: ids, cookies_browser: cookiesBrowser })
        });

        if (!response.ok) {
            throw new Error('伺服器回傳錯誤: ' + response.statusText);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line

            for (const line of lines) {
                if (line.trim() === '') continue;
                try {
                    const data = JSON.parse(line);
                    if (data.result) {
                        const resObj = data.result;
                        const video = allVideos.find(v => v.id === resObj.id);
                        if (video) {
                            video.subtitleStatus = resObj.has_subtitles ? 'yes' : 'no';
                            video.subtitles = resObj.subtitles;
                            
                            // Update badge directly in the DOM for real-time visual feedback
                            const card = document.querySelector(`.video-card[data-id="${resObj.id}"]`);
                            if (card) {
                                const badgeContainer = card.querySelector('.subtitle-badge');
                                if (badgeContainer) {
                                    if (resObj.has_subtitles) {
                                        badgeContainer.className = 'subtitle-badge yes';
                                        badgeContainer.textContent = '有字幕';
                                    } else {
                                        badgeContainer.className = 'subtitle-badge no';
                                        badgeContainer.textContent = '無字幕';
                                        
                                        // Also update download button style for recommended offline backup
                                        const downloadBtn = card.querySelector('.btn-download');
                                        if (downloadBtn) {
                                            downloadBtn.innerHTML = '<i data-lucide="music"></i> 下載音訊 (無字幕推薦)';
                                            downloadBtn.className = 'btn btn-primary btn-sm btn-download';
                                            lucide.createIcons();
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('解析串流資料行失敗:', e, line);
                }
            }
        }

        applyFiltersAndSort();
    } catch (err) {
        console.error(err);
        alert('字幕偵測連線異常: ' + err.message);
        allVideos.forEach(v => {
            if (v.subtitleStatus === 'checking') v.subtitleStatus = 'unchecked';
        });
        applyFiltersAndSort();
    } finally {
        btnDetectSubs.disabled = false;
        updateBatchControlsState();
    }
}

// Helper to download audio using SSE stream for progress tracking
async function downloadAudioStreamHelper(videoId, cookiesBrowser, keyword, title, onProgress) {
    return new Promise((resolve) => {
        const queryParams = new URLSearchParams({
            id: videoId,
            cookies_browser: cookiesBrowser,
            keyword: keyword,
            title: title
        }).toString();
        
        const eventSource = new EventSource(`/api/download-audio-stream?${queryParams}`);
        
        eventSource.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.status === 'downloading') {
                if (onProgress) onProgress('downloading', data.percent);
            } else if (data.status === 'processing') {
                if (onProgress) onProgress('processing', 0);
            } else if (data.status === 'finished') {
                eventSource.close();
                if (onProgress) onProgress('saving', 100);
                
                try {
                    const fileUrl = `/api/download-audio?${queryParams}`;
                    const response = await fetch(fileUrl);
                    if (!response.ok) {
                        resolve({ success: false, error: '檔案下載請求失敗' });
                        return;
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    
                    const disposition = response.headers.get('content-disposition');
                    let filename = data.filename || videoId;
                    if (disposition) {
                        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                        if (matches != null && matches[1]) {
                            filename = matches[1].replace(/['"]/g, '');
                        }
                    }
                    resolve({ success: true, blob, url, filename });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            } else if (data.status === 'error') {
                eventSource.close();
                resolve({ success: false, error: data.message });
            }
        };
        
        eventSource.onerror = () => {
            eventSource.close();
            if (onProgress) onProgress('fallback', 0);
            fetch(`/api/download-audio?${queryParams}`)
                .then(async (response) => {
                    if (!response.ok) {
                        let msg = 'Direct download fallback failed';
                        try {
                            const data = await response.json();
                            if (data.error) msg = data.error;
                        } catch (_) {}
                        throw new Error(msg);
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    resolve({ success: true, blob, url, filename: videoId });
                })
                .catch((e) => {
                    resolve({ success: false, error: e.message });
                });
        };
    });
}

// Helper to download PDF using SSE stream for progress tracking
async function downloadPdfStreamHelper(pdfUrl, title, keyword, onProgress) {
    return new Promise((resolve) => {
        const queryParams = new URLSearchParams({
            url: pdfUrl,
            title: title,
            keyword: keyword
        }).toString();
        
        const eventSource = new EventSource(`/api/download-pdf-stream?${queryParams}`);
        
        eventSource.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.status === 'downloading') {
                if (onProgress) onProgress('downloading', data.percent);
            } else if (data.status === 'finished') {
                eventSource.close();
                if (onProgress) onProgress('saving', 100);
                
                try {
                    const fileUrl = `/api/download-pdf?${queryParams}`;
                    const response = await fetch(fileUrl);
                    if (!response.ok) {
                        resolve({ success: false, error: 'PDF 下載請求失敗' });
                        return;
                    }
                    const blob = await response.blob();
                    const blobUrl = window.URL.createObjectURL(blob);
                    const filename = title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`;
                    resolve({ success: true, blob, url: blobUrl, filename });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            } else if (data.status === 'error') {
                eventSource.close();
                resolve({ success: false, error: data.message });
            }
        };
        
        eventSource.onerror = () => {
            eventSource.close();
            if (onProgress) onProgress('fallback', 0);
            fetch(`/api/download-pdf?${queryParams}`)
                .then(async (response) => {
                    if (!response.ok) {
                        let msg = 'Direct download fallback failed';
                        try {
                            const data = await response.json();
                            if (data.error) msg = data.error;
                        } catch (_) {}
                        throw new Error(msg);
                    }
                    const blob = await response.blob();
                    const blobUrl = window.URL.createObjectURL(blob);
                    const filename = title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`;
                    resolve({ success: true, blob, url: blobUrl, filename });
                })
                .catch((e) => {
                    resolve({ success: false, error: e.message });
                });
        };
    });
}

// Download native audio (no transcode) with JSON error interception
async function downloadAudio(videoId, buttonEl, keyword = '', title = '') {
    const originalHtml = buttonEl.innerHTML;
    buttonEl.disabled = true;
    buttonEl.innerHTML = '<i data-lucide="loader-2" class="spin"></i> 下載音訊中 (0%)';
    lucide.createIcons();
    
    const cookiesBrowser = cookiesBrowserSelect.value;
    const res = await downloadAudioStreamHelper(videoId, cookiesBrowser, keyword, title, (status, percent) => {
        if (status === 'downloading') {
            buttonEl.innerHTML = `<i data-lucide="loader-2" class="spin"></i> 下載中 (${percent}%)`;
            lucide.createIcons();
        } else if (status === 'saving') {
            buttonEl.innerHTML = `<i data-lucide="save"></i> 瀏覽器存檔中...`;
            lucide.createIcons();
        } else if (status === 'fallback') {
            buttonEl.innerHTML = `<i data-lucide="loader-2" class="spin"></i> 嘗試直連下載...`;
            lucide.createIcons();
        }
    });
    
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalHtml;
    lucide.createIcons();
    
    if (res.success) {
        const a = document.createElement('a');
        a.href = res.url;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(res.url);
        return true;
    } else {
        alert(`下載失敗: ${res.error || '未知錯誤'}`);
        return false;
    }
}

// Perform Sequential Batch Download of No-Subtitle Videos
async function performBatchDownload() {
    const noSubVideos = filteredVideos.filter(v => v.subtitleStatus === 'no');
    if (noSubVideos.length === 0) {
        alert('當前顯示清單中沒有無字幕影片');
        return;
    }

    if (!confirm(`確定要批次下載這 ${noSubVideos.length} 部無字幕影片嗎？`)) {
        return;
    }

    isBatchDownloading = true;
    btnBatchDownload.disabled = true;
    btnSelectSubUrls.disabled = true;
    btnSelectAllUrls.disabled = true;
    btnCopySelectedUrls.disabled = true;
    
    batchProgressContainer.style.display = 'block';
    batchProgressBar.style.width = '0%';
    batchProgressCount.textContent = `0 / ${noSubVideos.length}`;

    let completed = 0;
    const errors = [];

    for (let i = 0; i < noSubVideos.length; i++) {
        const v = noSubVideos[i];
        batchProgressText.textContent = `正在下載 (${i+1}/${noSubVideos.length}): ${v.title}`;
        
        // Target download button on card
        const cardBtn = document.querySelector(`.video-card[data-id="${v.id}"] .btn-download`);
        const success = await downloadAudio(v.id, cardBtn || document.createElement('button'));
        
        if (!success) {
            errors.push(v.title);
        }
        
        completed++;
        const pct = Math.round((completed / noSubVideos.length) * 100);
        batchProgressBar.style.width = `${pct}%`;
        batchProgressCount.textContent = `${completed} / ${noSubVideos.length}`;
    }

    isBatchDownloading = false;
    batchProgressText.textContent = '批次下載完成！';
    updateBatchControlsState();

    if (errors.length > 0) {
        alert(`批次下載結束。其中有 ${errors.length} 部影片下載失敗：\n` + errors.map((t, idx) => `${idx+1}. ${t}`).join('\n'));
    } else {
        alert('所有無字幕影片下載成功！');
    }
}

// Select all subtitle videos
function selectSubVideos() {
    filteredVideos.forEach(v => {
        v.checked = (v.subtitleStatus === 'yes');
    });
    renderVideos();
    updateBatchControlsState();
}

// Select all videos
function selectAllVideos() {
    filteredVideos.forEach(v => {
        v.checked = true;
    });
    renderVideos();
    updateBatchControlsState();
}

// Copy selected video URLs
function copySelectedUrls() {
    const selectedVideos = filteredVideos.filter(v => v.checked);
    if (selectedVideos.length === 0) {
        alert('無已勾選的影片網址');
        return;
    }

    const urls = selectedVideos.map(v => v.url).join('\n');
    copyToClipboard(urls, `已複製 ${selectedVideos.length} 個影片網址！`);
}

// Utility: copy text to clipboard with legacy fallback for non-HTTPS or non-secure contexts
function copyToClipboard(text, customSuccessMsg = '') {
    // If we have custom success msg, temporarily change toast text
    const originalText = toast.textContent;
    if (customSuccessMsg) {
        toast.textContent = customSuccessMsg;
    }

    function doShowToast() {
        showToast();
        if (customSuccessMsg) {
            setTimeout(() => {
                toast.textContent = originalText;
            }, 2000);
        }
    }

    // Try modern Clipboard API first (requires secure contexts HTTPS/localhost)
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            doShowToast();
        }).catch(err => {
            console.error('Modern clipboard write failed, trying fallback: ', err);
            fallbackCopyToClipboard(text, doShowToast);
        });
    } else {
        fallbackCopyToClipboard(text, doShowToast);
    }
}

// Fallback legacy method
function fallbackCopyToClipboard(text, successCallback) {
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        
        // Avoid scrolling to bottom
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
            successCallback();
        } else {
            console.error('Fallback execCommand copy was unsuccessful');
            alert('複製失敗，請嘗試手動複製，或改在安全連線 (HTTPS/localhost) 下使用');
        }
    } catch (err) {
        console.error('Fallback copy error: ', err);
        alert('複製失敗，請嘗試手動複製。原因: ' + err.message);
    }
}

function showToast() {
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// Utility: format duration (seconds to HH:MM:SS / MM:SS)
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Utility: format upload date
function formatUploadDate(video) {
    const dateStr = getVideoDateString(video);
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-');
    return `${y}/${m}/${d}`;
}

// Utility: format views count
function formatViews(views) {
    if (views === undefined || views === null) return '無點閱資料';
    if (views >= 100000000) {
        return `${(views / 100000000).toFixed(1)} 億次點閱`;
    }
    if (views >= 10000) {
        return `${(views / 10000).toFixed(1)} 萬次點閱`;
    }
    return `${views} 次點閱`;
}

// Show/Hide global loading
function showLoading(visible) {
    loadingSpinner.style.display = visible ? 'block' : 'none';
}

// ==========================================
// PDF Search and Downloader Module
// ==========================================

// State
let allPdfs = [];
let isPdfBatchDownloading = false;

// DOM Elements
const tabYoutube = document.getElementById('tab-youtube');
const tabPdf = document.getElementById('tab-pdf');
const tabBatch = document.getElementById('tab-batch');
const tabWord2md = document.getElementById('tab-word2md');
const tabExtractAudio = document.getElementById('tab-extract-audio');
const tabCompressVideo = document.getElementById('tab-compress-video');
const tabCompressImage = document.getElementById('tab-compress-image');

const youtubeSectionContainer = document.getElementById('youtube-section-container');
const pdfSectionContainer = document.getElementById('pdf-section-container');
const batchSectionContainer = document.getElementById('batch-section-container');
const word2mdSectionContainer = document.getElementById('word2md-section-container');
const extractAudioSectionContainer = document.getElementById('extract-audio-section-container');
const compressVideoSectionContainer = document.getElementById('compress-video-section-container');
const compressImageSectionContainer = document.getElementById('compress-image-section-container');

const pdfSearchQueryInput = document.getElementById('pdf-search-query');
const btnPdfSearch = document.getElementById('btn-pdf-search');
const pdfStatTotal = document.getElementById('pdf-stat-total');
const btnPdfBatchDownload = document.getElementById('btn-pdf-batch-download');
const pdfToggleAll = document.getElementById('pdf-toggle-all');

const pdfBatchProgressContainer = document.getElementById('pdf-batch-progress-container');
const pdfBatchProgressText = document.getElementById('pdf-batch-progress-text');
const pdfBatchProgressCount = document.getElementById('pdf-batch-progress-count');
const pdfBatchProgressBar = document.getElementById('pdf-batch-progress-bar');
const pdfLoadingSpinner = document.getElementById('pdf-loading-spinner');
const pdfListContainer = document.getElementById('pdf-list-container');

// Batch Page Elements
const batchKeywordsInput = document.getElementById('batch-keywords');
const batchOptSaveUrls = document.getElementById('batch-opt-save-urls');
const batchOptDownloadMp3 = document.getElementById('batch-opt-download-mp3');
const batchOptDownloadPdf = document.getElementById('batch-opt-download-pdf');
const batchResultsLimitInput = document.getElementById('batch-results-limit');
const batchConcurrencyInput = document.getElementById('batch-concurrency');
const batchCookiesBrowserSelect = document.getElementById('batch-cookies-browser');
const btnBatchStart = document.getElementById('btn-batch-start');
const btnBatchStop = document.getElementById('btn-batch-stop');
const batchStatProgress = document.getElementById('batch-stat-progress');
const batchOverallProgressBar = document.getElementById('batch-overall-progress-bar');
const batchTaskListContainer = document.getElementById('batch-task-list-container');
const batchConsoleOutput = document.getElementById('batch-console-output');
const btnClearConsole = document.getElementById('btn-clear-console');

// Word to Markdown DOM Elements
const word2mdFolderPathInput = document.getElementById('word2md-folder-path');
const btnWord2mdStart = document.getElementById('btn-word2md-start');
const btnWord2mdStop = document.getElementById('btn-word2md-stop');
const word2mdStatProgress = document.getElementById('word2md-stat-progress');
const word2mdOverallProgressBar = document.getElementById('word2md-overall-progress-bar');
const word2mdStatTotal = document.getElementById('word2md-stat-total');
const word2mdStatConverted = document.getElementById('word2md-stat-converted');
const word2mdStatCopied = document.getElementById('word2md-stat-copied');
const word2mdStatFailed = document.getElementById('word2md-stat-failed');
const word2mdConsoleOutput = document.getElementById('word2md-console-output');
const btnWord2mdClearConsole = document.getElementById('btn-word2md-clear-console');

// Image Compression DOM Elements
const compressImageFolderPathInput = document.getElementById('compress-image-folder-path');
const compressImageMaxEdgeSelect = document.getElementById('compress-image-max-edge');
const compressImageQualitySelect = document.getElementById('compress-image-quality');
const compressImageConvertPngCheckbox = document.getElementById('compress-image-convert-png');
const btnCompressImageStart = document.getElementById('btn-compress-image-start');
const btnCompressImageStop = document.getElementById('btn-compress-image-stop');
const compressImageStatProgress = document.getElementById('compress-image-stat-progress');
const compressImageOverallProgressBar = document.getElementById('compress-image-overall-progress-bar');
const compressImageStatTotal = document.getElementById('compress-image-stat-total');
const compressImageStatConverted = document.getElementById('compress-image-stat-converted');
const compressImageStatSaved = document.getElementById('compress-image-stat-saved');
const compressImageStatFailed = document.getElementById('compress-image-stat-failed');
const compressImageConsoleOutput = document.getElementById('compress-image-console-output');
const btnCompressImageClearConsole = document.getElementById('btn-compress-image-clear-console');

// Tab Switching Helper
function setTabActive(tabName) {
    tabYoutube.classList.remove('active');
    tabPdf.classList.remove('active');
    tabBatch.classList.remove('active');
    tabWord2md.classList.remove('active');
    tabExtractAudio.classList.remove('active');
    tabCompressVideo.classList.remove('active');
    tabCompressImage.classList.remove('active');
    
    youtubeSectionContainer.style.display = 'none';
    pdfSectionContainer.style.display = 'none';
    batchSectionContainer.style.display = 'none';
    word2mdSectionContainer.style.display = 'none';
    extractAudioSectionContainer.style.display = 'none';
    compressVideoSectionContainer.style.display = 'none';
    compressImageSectionContainer.style.display = 'none';
    
    if (tabName === 'youtube') {
        tabYoutube.classList.add('active');
        youtubeSectionContainer.style.display = 'block';
    } else if (tabName === 'pdf') {
        tabPdf.classList.add('active');
        pdfSectionContainer.style.display = 'block';
    } else if (tabName === 'batch') {
        tabBatch.classList.add('active');
        batchSectionContainer.style.display = 'block';
    } else if (tabName === 'word2md') {
        tabWord2md.classList.add('active');
        word2mdSectionContainer.style.display = 'block';
    } else if (tabName === 'extract-audio') {
        tabExtractAudio.classList.add('active');
        extractAudioSectionContainer.style.display = 'block';
    } else if (tabName === 'compress-video') {
        tabCompressVideo.classList.add('active');
        compressVideoSectionContainer.style.display = 'block';
    } else if (tabName === 'compress-image') {
        tabCompressImage.classList.add('active');
        compressImageSectionContainer.style.display = 'block';
    }
    localStorage.setItem('active-tab', tabName);
}

// Tab Switching Listeners
tabYoutube.addEventListener('click', () => setTabActive('youtube'));
tabPdf.addEventListener('click', () => setTabActive('pdf'));
tabBatch.addEventListener('click', () => setTabActive('batch'));
tabWord2md.addEventListener('click', () => setTabActive('word2md'));
tabExtractAudio.addEventListener('click', () => setTabActive('extract-audio'));
tabCompressVideo.addEventListener('click', () => setTabActive('compress-video'));
tabCompressImage.addEventListener('click', () => setTabActive('compress-image'));

// Bind PDF Event Listeners
btnPdfSearch.addEventListener('click', performPdfSearch);
pdfSearchQueryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        performPdfSearch();
    }
});
btnPdfBatchDownload.addEventListener('click', performPdfBatchDownload);

pdfToggleAll.addEventListener('change', (e) => {
    const checked = e.target.checked;
    allPdfs.forEach(pdf => {
        pdf.checked = checked;
    });
    // Re-render to update checkboxes in cards
    renderPdfs();
    updatePdfBatchButtonState();
});

// Helper: Determine URL PDF access difficulty
function getPdfAccessType(url) {
    const urlLower = url.toLowerCase();
    const domainsForLogin = ['scribd.com', 'academia.edu', 'researchgate.net', 'springer.com', 'link.springer.com', 'momo.com', 'books.com.tw', 'kobo.com', 'readmoo.com'];
    
    if (domainsForLogin.some(domain => urlLower.includes(domain))) {
        return {
            text: '<i data-lucide="key" style="width: 14px; height: 14px; margin-right: 4px; vertical-align: middle; display: inline-block;"></i> 需要登入/付費',
            style: 'background-color: rgba(245, 158, 11, 0.1); color: var(--status-warning); font-weight: 600;'
        };
    }
    if (urlLower.includes('drive.google.com') || urlLower.includes('archive.org') || urlLower.includes('github.com') || urlLower.endsWith('.pdf') || urlLower.includes('.pdf?')) {
        return {
            text: '<i data-lucide="download" style="width: 14px; height: 14px; margin-right: 4px; vertical-align: middle; display: inline-block;"></i> 支援直連下載',
            style: 'background-color: rgba(16, 185, 129, 0.1); color: var(--status-success); font-weight: 600;'
        };
    }
    return {
        text: '<i data-lucide="globe" style="width: 14px; height: 14px; margin-right: 4px; vertical-align: middle; display: inline-block;"></i> 外部網頁/下載',
        style: 'background-color: rgba(6, 182, 212, 0.1); color: var(--status-info); font-weight: 600;'
    };
}

// PDF Search Action
async function performPdfSearch() {
    const query = pdfSearchQueryInput.value.trim();
    if (!query) {
        alert('請輸入搜尋書籍的關鍵字！');
        return;
    }

    // Reset view
    allPdfs = [];
    pdfListContainer.innerHTML = '';
    pdfStatTotal.textContent = '0';
    btnPdfBatchDownload.disabled = true;
    pdfToggleAll.checked = true;
    pdfBatchProgressContainer.style.display = 'none';
    pdfLoadingSpinner.style.display = 'block';
    btnPdfSearch.disabled = true;

    try {
        const res = await fetch(`/api/search-pdf?query=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (data.success && data.results.length > 0) {
            allPdfs = data.results.map((pdf, idx) => ({
                id: `pdf-${idx}`,
                title: pdf.title,
                url: pdf.url,
                domain: pdf.domain,
                downloadStatus: 'idle', // 'idle', 'downloading', 'success', 'failed'
                checked: true // Checked by default
            }));

            pdfStatTotal.textContent = allPdfs.length;
            renderPdfs();
            updatePdfBatchButtonState();
        } else {
            pdfListContainer.innerHTML = `
                <div class="no-results">
                    <p>沒有找到任何相關的 PDF 書籍，請更換關鍵字再試一次</p>
                </div>
            `;
        }
    } catch (err) {
        console.error(err);
        pdfListContainer.innerHTML = `
            <div class="no-results">
                <p>搜尋連線失敗，請確認後端伺服器運作正常</p>
            </div>
        `;
    } finally {
        pdfLoadingSpinner.style.display = 'none';
        btnPdfSearch.disabled = false;
    }
}

// Render PDF Cards
function renderPdfs() {
    if (allPdfs.length === 0) return;

    pdfListContainer.innerHTML = '';
    allPdfs.forEach(pdf => {
        const card = document.createElement('div');
        card.className = 'pdf-card';
        card.setAttribute('data-id', pdf.id);

        let statusBadgeHtml = '';
        if (pdf.downloadStatus === 'idle') {
            statusBadgeHtml = '<span class="pdf-badge" style="background-color: #f1f5f9; color: var(--text-muted);">待下載</span>';
        } else if (pdf.downloadStatus === 'downloading') {
            statusBadgeHtml = '<span class="pdf-badge" style="background-color: rgba(37, 99, 235, 0.1); color: var(--brand-secondary);">下載中...</span>';
        } else if (pdf.downloadStatus === 'success') {
            statusBadgeHtml = '<span class="pdf-badge" style="background-color: rgba(16, 185, 129, 0.1); color: var(--status-success);">已下載</span>';
        } else if (pdf.downloadStatus === 'failed') {
            statusBadgeHtml = '<span class="pdf-badge" style="background-color: rgba(225, 29, 72, 0.1); color: var(--brand-primary);">下載失敗</span>';
        }

        const accessInfo = getPdfAccessType(pdf.url);
        const accessBadgeHtml = `<span class="pdf-badge" style="${accessInfo.style}">${accessInfo.text}</span>`;

        card.innerHTML = `
            <div class="pdf-checkbox-wrapper">
                <input type="checkbox" class="pdf-checkbox" data-id="${pdf.id}" ${pdf.checked ? 'checked' : ''}>
            </div>
            <div class="pdf-info">
                <h3 class="pdf-title">
                    <a href="${pdf.url}" target="_blank" style="text-decoration: none; color: inherit; border-bottom: 1px dashed var(--brand-secondary);" title="點選直接前往書籍網頁">${pdf.title}</a>
                </h3>
                <div class="pdf-meta">
                    <span class="pdf-domain"><i data-lucide="globe"></i> ${pdf.domain}</span>
                    ${accessBadgeHtml}
                    <span>下載狀態: ${statusBadgeHtml}</span>
                </div>
            </div>
            <div class="pdf-actions">
                <button class="btn btn-secondary btn-sm btn-pdf-copy" data-url="${pdf.url}"><i data-lucide="copy"></i> 複製網址</button>
                <button class="btn btn-primary btn-sm btn-pdf-download" data-id="${pdf.id}"><i data-lucide="download"></i> 下載 PDF</button>
            </div>
        `;

        // Checkbox interaction
        const checkbox = card.querySelector('.pdf-checkbox');
        checkbox.addEventListener('change', (e) => {
            pdf.checked = e.target.checked;
            
            // If any item is unchecked, uncheck the header toggle-all checkbox
            if (!pdf.checked) {
                pdfToggleAll.checked = false;
            } else {
                // If all items are checked, check the header toggle-all checkbox
                const allChecked = allPdfs.every(p => p.checked);
                pdfToggleAll.checked = allChecked;
            }
            
            updatePdfBatchButtonState();
        });

        // Copy url interaction
        card.querySelector('.btn-pdf-copy').addEventListener('click', () => {
            copyToClipboard(pdf.url);
        });

        // Download interaction
        card.querySelector('.btn-pdf-download').addEventListener('click', (e) => {
            downloadSinglePdf(pdf, e.target, card.querySelector('.pdf-badge:last-child'));
        });

        pdfListContainer.appendChild(card);
    });
    lucide.createIcons();
}

// Update Pdf Batch Button State
function updatePdfBatchButtonState() {
    const checkedCount = allPdfs.filter(p => p.checked && p.downloadStatus !== 'success').length;
    btnPdfBatchDownload.disabled = (checkedCount === 0 || isPdfBatchDownloading);
}

// Download Single PDF
async function downloadSinglePdf(pdf, buttonEl, badgeEl, keyword = '') {
    const originalHtml = buttonEl.innerHTML;
    buttonEl.disabled = true;
    buttonEl.innerHTML = '<i data-lucide="loader-2" class="spin"></i> 下載中 (0%)';
    lucide.createIcons();
    
    pdf.downloadStatus = 'downloading';
    if (badgeEl) {
        badgeEl.innerHTML = '<i data-lucide="loader-2" class="spin"></i> 下載中 (0%)';
        badgeEl.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
        badgeEl.style.color = 'var(--brand-secondary)';
        lucide.createIcons();
    }
    
    const res = await downloadPdfStreamHelper(pdf.url, pdf.title, keyword, (status, percent) => {
        if (status === 'downloading') {
            buttonEl.innerHTML = `<i data-lucide="loader-2" class="spin"></i> 下載中 (${percent}%)`;
            if (badgeEl) badgeEl.innerHTML = `<i data-lucide="loader-2" class="spin"></i> 下載中 (${percent}%)`;
            lucide.createIcons();
        } else if (status === 'saving') {
            buttonEl.innerHTML = `<i data-lucide="save"></i> 瀏覽器存檔中...`;
            if (badgeEl) badgeEl.innerHTML = `<i data-lucide="save"></i> 瀏覽器存檔中...`;
            lucide.createIcons();
        } else if (status === 'fallback') {
            buttonEl.innerHTML = `<i data-lucide="loader-2" class="spin"></i> 嘗試直連下載...`;
            if (badgeEl) badgeEl.innerHTML = `<i data-lucide="loader-2" class="spin"></i> 嘗試直連...`;
            lucide.createIcons();
        }
    });
    
    buttonEl.disabled = false;
    buttonEl.innerHTML = originalHtml;
    lucide.createIcons();
    
    if (res.success) {
        const a = document.createElement('a');
        a.href = res.url;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(res.url);
        
        pdf.downloadStatus = 'success';
        if (badgeEl) {
            badgeEl.textContent = '已下載';
            badgeEl.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            badgeEl.style.color = 'var(--status-success)';
        }
        updatePdfBatchButtonState();
        return true;
    } else {
        pdf.downloadStatus = 'failed';
        if (badgeEl) {
            badgeEl.textContent = '下載失敗';
            badgeEl.style.backgroundColor = 'rgba(225, 29, 72, 0.1)';
            badgeEl.style.color = 'var(--brand-primary)';
        }
        alert(`下載失敗: ${res.error || '未知錯誤'}`);
        updatePdfBatchButtonState();
        return false;
    }
}

// Batch download checked PDFs
async function performPdfBatchDownload() {
    const checkedPdfs = allPdfs.filter(p => p.checked && p.downloadStatus !== 'success');
    if (checkedPdfs.length === 0) return;

    if (!confirm(`確定要批次自動下載這 ${checkedPdfs.length} 本書籍 PDF 檔案嗎？`)) {
        return;
    }

    isPdfBatchDownloading = true;
    btnPdfBatchDownload.disabled = true;
    btnPdfSearch.disabled = true;

    pdfBatchProgressContainer.style.display = 'block';
    pdfBatchProgressBar.style.width = '0%';
    pdfBatchProgressCount.textContent = `0 / ${checkedPdfs.length}`;

    let completed = 0;
    const failedTitles = [];

    for (let i = 0; i < checkedPdfs.length; i++) {
        const pdf = checkedPdfs[i];
        pdfBatchProgressText.textContent = `正在下載 (${i+1}/${checkedPdfs.length}): ${pdf.title}`;

        const card = document.querySelector(`.pdf-card[data-id="${pdf.id}"]`);
        const btn = card ? card.querySelector('.btn-pdf-download') : document.createElement('button');
        const badge = card ? card.querySelector('.pdf-badge:last-child') : null;

        const success = await downloadSinglePdf(pdf, btn, badge);
        if (!success) {
            failedTitles.push(pdf.title);
        }

        completed++;
        const pct = Math.round((completed / checkedPdfs.length) * 100);
        pdfBatchProgressBar.style.width = `${pct}%`;
        pdfBatchProgressCount.textContent = `${completed} / ${checkedPdfs.length}`;
    }

    isPdfBatchDownloading = false;
    btnPdfSearch.disabled = false;
    pdfBatchProgressText.textContent = '批次下載 PDF 完畢！';
    updatePdfBatchButtonState();

    if (failedTitles.length > 0) {
        alert(`批次下載結束。有些檔案下載失敗：\n` + failedTitles.map((t, idx) => `${idx+1}. ${t}`).join('\n'));
    } else {
        alert('所有選取的書籍 PDF 下載完成！');
    }
}


// ==========================================
// Batch and Automation Module
// ==========================================

let isBatchRunning = false;
let shouldStopBatch = false;

// Event Listeners for Batch Section
btnBatchStart.addEventListener('click', startBatchAutomation);
btnBatchStop.addEventListener('click', () => {
    shouldStopBatch = true;
    logToConsole('[系統] 正在停止批次任務...');
    btnBatchStop.disabled = true;
});
btnClearConsole.addEventListener('click', () => {
    batchConsoleOutput.innerHTML = '[系統] 日誌已清除。\n';
});

// Helper: Log message to the console area
function logToConsole(text) {
    const timeStr = new Date().toLocaleTimeString();
    batchConsoleOutput.innerHTML += `[${timeStr}] ${text}\n`;
    batchConsoleOutput.scrollTop = batchConsoleOutput.scrollHeight;
}

// Core Batch Automation Execution
async function startBatchAutomation() {
    if (isBatchRunning) return;

    // Get and parse keywords
    const keywords = batchKeywordsInput.value
        .split('\n')
        .map(kw => kw.trim())
        .filter(kw => kw.length > 0);

    if (keywords.length === 0) {
        alert('請先輸入至少一個搜尋關鍵字！');
        return;
    }

    const runSaveUrls = batchOptSaveUrls.checked;
    const runDownloadMp3 = batchOptDownloadMp3.checked;
    const runDownloadPdf = batchOptDownloadPdf.checked;

    if (!runSaveUrls && !runDownloadMp3 && !runDownloadPdf) {
        alert('請至少選擇一項自動化執行項目！');
        return;
    }

    // Set state
    isBatchRunning = true;
    shouldStopBatch = false;
    btnBatchStart.disabled = true;
    btnBatchStop.disabled = false;
    batchKeywordsInput.disabled = true;
    batchOptSaveUrls.disabled = true;
    batchOptDownloadMp3.disabled = true;
    batchOptDownloadPdf.disabled = true;
    batchResultsLimitInput.disabled = true;
    batchConcurrencyInput.disabled = true;
    batchCookiesBrowserSelect.disabled = true;

    batchStatProgress.textContent = `準備執行 (0 / ${keywords.length})`;
    batchOverallProgressBar.style.width = '0%';
    batchConsoleOutput.innerHTML = '[系統] 啟動批次自動化任務...\n';

    // Initialize Dashboard Task Cards
    batchTaskListContainer.innerHTML = '';
    const taskStates = keywords.map((kw, index) => {
        const id = `batch-task-${index}`;
        const card = document.createElement('div');
        card.className = 'batch-task-card';
        card.id = id;
        
        card.innerHTML = `
            <div class="batch-task-header">
                <span class="batch-task-title">${kw}</span>
                <span class="batch-task-status-text waiting">等待中</span>
            </div>
            <div class="batch-task-steps">
                <div class="batch-task-step step-pdf ${runDownloadPdf ? '' : 'skipped'}">
                    <span class="batch-task-step-name">PDF 下載</span>
                    <span class="batch-task-step-status">${runDownloadPdf ? '待執行' : '已跳過'}</span>
                </div>
                <div class="batch-task-step step-yt-search ${(runSaveUrls || runDownloadMp3) ? '' : 'skipped'}">
                    <span class="batch-task-step-name">YT 影片搜尋</span>
                    <span class="batch-task-step-status">${(runSaveUrls || runDownloadMp3) ? '待執行' : '已跳過'}</span>
                </div>
                <div class="batch-task-step step-yt-sub ${(runSaveUrls || runDownloadMp3) ? '' : 'skipped'}">
                    <span class="batch-task-step-name">字幕狀態偵測</span>
                    <span class="batch-task-step-status">${(runSaveUrls || runDownloadMp3) ? '待執行' : '已跳過'}</span>
                </div>
                <div class="batch-task-step step-yt-action ${(runSaveUrls || runDownloadMp3) ? '' : 'skipped'}">
                    <span class="batch-task-step-name">YT 後續執行</span>
                    <span class="batch-task-step-status">${(runSaveUrls || runDownloadMp3) ? '待執行' : '已跳過'}</span>
                </div>
            </div>
        `;
        
        batchTaskListContainer.appendChild(card);
        return {
            id,
            keyword: kw,
            cardEl: card,
            stepPdf: card.querySelector('.step-pdf'),
            stepYtSearch: card.querySelector('.step-yt-search'),
            stepYtSub: card.querySelector('.step-yt-sub'),
            stepYtAction: card.querySelector('.step-yt-action')
        };
    });

    // Execute keywords with controlled concurrency
    let completedCount = 0;
    const limit = batchResultsLimitInput.value;
    const cookiesBrowser = batchCookiesBrowserSelect.value;
    const concurrency = Math.min(5, Math.max(1, parseInt(batchConcurrencyInput.value, 10) || 2));
    logToConsole(`[系統] 並行關鍵字數: ${concurrency}（後端已啟用 YouTube 流量節流）`);

    let nextIndex = 0;
    async function worker() {
        while (nextIndex < taskStates.length && !shouldStopBatch) {
            const i = nextIndex++;
            await processBatchKeyword(taskStates[i], i, taskStates.length, {
                runSaveUrls,
                runDownloadMp3,
                runDownloadPdf,
                limit,
                cookiesBrowser,
                onComplete: () => {
                    completedCount++;
                    batchStatProgress.textContent = `正在執行 (${completedCount} / ${keywords.length})`;
                    batchOverallProgressBar.style.width = `${Math.round((completedCount / keywords.length) * 100)}%`;
                }
            });
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, taskStates.length) }, () => worker());
    await Promise.all(workers);

    // Wrap up
    isBatchRunning = false;
    btnBatchStart.disabled = false;
    btnBatchStop.disabled = true;
    batchKeywordsInput.disabled = false;
    batchOptSaveUrls.disabled = false;
    batchOptDownloadMp3.disabled = false;
    batchOptDownloadPdf.disabled = false;
    batchResultsLimitInput.disabled = false;
    batchConcurrencyInput.disabled = false;
    batchCookiesBrowserSelect.disabled = false;

    batchStatProgress.textContent = shouldStopBatch ? '已停止' : '全數執行完畢';
    logToConsole(shouldStopBatch ? '[系統] ⚠️ 批次自動化任務已手動停止。' : '[系統] 🎉 批次自動化任務已全部結束！');
}

async function processBatchKeyword(task, index, total, opts) {
    const { runSaveUrls, runDownloadMp3, runDownloadPdf, limit, cookiesBrowser, onComplete } = opts;
    const kw = task.keyword;

    if (shouldStopBatch) return;

    logToConsole(`👉 開始處理關鍵字: "${kw}" (${index + 1}/${total})`);
    task.cardEl.classList.add('active');
    const badgeStatus = task.cardEl.querySelector('.batch-task-status-text');
    badgeStatus.className = 'batch-task-status-text running';
    badgeStatus.textContent = '執行中';

    let successOverall = true;
    const dateRange = getCalculatedDateRange();
    const needsDateEnrich = !!(dateRange.from || dateRange.to);

    if (runDownloadPdf && !shouldStopBatch) {
        updateStepState(task.stepPdf, 'active', '搜尋中...');
        logToConsole(`[PDF] 正在搜尋: "${kw}"`);
        try {
            const res = await fetch(`/api/search-pdf?query=${encodeURIComponent(kw)}`);
            const data = await res.json();

            if (data.success && data.results && data.results.length > 0) {
                logToConsole(`[PDF] 搜尋到 ${data.results.length} 本書籍，開始嘗試下載 (直到成功一本)...`);
                let pdfSuccess = false;
                for (let j = 0; j < data.results.length; j++) {
                    if (shouldStopBatch) break;
                    const book = data.results[j];
                    logToConsole(`[PDF] 嘗試下載第 ${j + 1} 本: "${book.title}"...`);
                    try {
                        updateStepState(task.stepPdf, 'active', '下載中 (0%)...');
                        const dlRes = await downloadPdfStreamHelper(book.url, book.title, kw, (status, percent) => {
                            if (status === 'downloading') {
                                updateStepState(task.stepPdf, 'active', `下載中 (${percent}%)...`);
                            } else if (status === 'saving') {
                                updateStepState(task.stepPdf, 'active', '存檔中...');
                            }
                        });
                        if (dlRes.success) {
                            logToConsole(`[PDF] ✅ 成功下載 PDF: "${dlRes.filename}"`);
                            pdfSuccess = true;
                            break;
                        }
                        logToConsole(`[PDF] ❌ 下載失敗: ${book.title} - ${dlRes.error}`);
                    } catch (e) {
                        logToConsole(`[PDF] ❌ 下載發生異常: ${book.title} - ${e.message}`);
                    }
                }
                if (pdfSuccess) {
                    updateStepState(task.stepPdf, 'completed', '已下載首本');
                } else {
                    logToConsole(`[PDF] ❌ 嘗試了所有 PDF 資源，但皆下載失敗。`);
                    updateStepState(task.stepPdf, 'failed', '下載失敗');
                    successOverall = false;
                }
            } else {
                logToConsole(`[PDF] ❌ 未搜尋到任何 PDF 資源。`);
                updateStepState(task.stepPdf, 'failed', '無搜尋結果');
                successOverall = false;
            }
        } catch (err) {
            logToConsole(`[PDF] ❌ 搜尋連線異常: ${err.message}`);
            updateStepState(task.stepPdf, 'failed', '搜尋異常');
            successOverall = false;
        }
    }

    let videos = [];
    if ((runSaveUrls || runDownloadMp3) && !shouldStopBatch) {
        updateStepState(task.stepYtSearch, 'active', '搜尋中...');
        logToConsole(`[YT] 正在搜尋 YouTube 影片: "${kw}" (限制: ${limit})`);
        try {
            const searchRes = await fetch(`/api/search?type=global&query=${encodeURIComponent(kw)}&limit=${limit}&cookies_browser=${cookiesBrowser}&enrich_dates=${needsDateEnrich}`);
            const searchData = await searchRes.json();

            if (searchData.success && searchData.results && searchData.results.length > 0) {
                videos = filterAndSortVideos(searchData.results);
                logToConsole(`[YT] 成功找到 ${searchData.results.length} 部影片 (篩選後符合條件: ${videos.length} 部)。`);
                if (videos.length > 0) {
                    updateStepState(task.stepYtSearch, 'completed', `篩選後 ${videos.length} 部`);
                } else {
                    logToConsole(`[YT] ⚠️ 篩選後無剩餘符合條件之影片。`);
                    updateStepState(task.stepYtSearch, 'completed', '無符合條件影片');
                    updateStepState(task.stepYtSub, 'skipped', '已跳過');
                    updateStepState(task.stepYtAction, 'skipped', '已跳過');
                }
            } else {
                logToConsole(`[YT] ❌ 未搜尋到任何影片或搜尋失敗。`);
                updateStepState(task.stepYtSearch, 'failed', '無搜尋結果');
                updateStepState(task.stepYtSub, 'skipped', '已跳過');
                updateStepState(task.stepYtAction, 'skipped', '已跳過');
                successOverall = false;
            }
        } catch (err) {
            logToConsole(`[YT] ❌ 搜尋連線異常: ${err.message}`);
            updateStepState(task.stepYtSearch, 'failed', '搜尋異常');
            updateStepState(task.stepYtSub, 'skipped', '已跳過');
            updateStepState(task.stepYtAction, 'skipped', '已跳過');
            successOverall = false;
        }
    }

    let subResults = {};
    if (videos.length > 0 && !shouldStopBatch) {
        updateStepState(task.stepYtSub, 'active', '偵測中...');
        logToConsole(`[YT] 正在批次偵測字幕狀態 (${videos.length} 部)...`);
        try {
            const ids = videos.map(v => v.id);
            const subRes = await fetch('/api/batch-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_ids: ids, cookies_browser: cookiesBrowser })
            });
            const subData = await subRes.json();

            if (subData.success) {
                subResults = subData.results;
                logToConsole(`[YT] 字幕偵測完成。`);
                updateStepState(task.stepYtSub, 'completed', '完成偵測');
            } else {
                logToConsole(`[YT] ❌ 批次字幕偵測失敗。`);
                updateStepState(task.stepYtSub, 'failed', '偵測失敗');
                updateStepState(task.stepYtAction, 'failed', '中斷');
                successOverall = false;
            }
        } catch (err) {
            logToConsole(`[YT] ❌ 字幕偵測連線異常: ${err.message}`);
            updateStepState(task.stepYtSub, 'failed', '連線異常');
            updateStepState(task.stepYtAction, 'failed', '中斷');
            successOverall = false;
        }
    }

    if (Object.keys(subResults).length > 0 && !shouldStopBatch) {
        updateStepState(task.stepYtAction, 'active', '執行中...');
        const subUrls = [];
        const noSubVideos = [];

        videos.forEach(v => {
            const info = subResults[v.id];
            if (info) {
                if (info.has_subtitles) subUrls.push(v.url);
                else noSubVideos.push(v);
            }
        });

        if (runSaveUrls) {
            if (subUrls.length > 0) {
                logToConsole(`[YT] 正在儲存 ${subUrls.length} 個有字幕的網址至文字檔...`);
                try {
                    const saveRes = await fetch('/api/save-urls', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ keyword: kw, urls: subUrls })
                    });
                    const saveData = await saveRes.json();
                    if (saveData.success) {
                        logToConsole(`[YT] ✅ 已存檔: "${saveData.filename}"`);
                    } else {
                        logToConsole(`[YT] ❌ 儲存網址文字檔失敗: ${saveData.error}`);
                        successOverall = false;
                    }
                } catch (err) {
                    logToConsole(`[YT] ❌ 儲存網址連線錯誤: ${err.message}`);
                    successOverall = false;
                }
            } else {
                logToConsole(`[YT] ℹ️ 無任何有字幕網址，跳過存檔。`);
            }
        }

        if (runDownloadMp3) {
            if (noSubVideos.length > 0) {
                logToConsole(`[YT] 正在下載 ${noSubVideos.length} 部無字幕影片音訊（原生格式）...`);
                let mp3FailedCount = 0;
                for (let j = 0; j < noSubVideos.length; j++) {
                    if (shouldStopBatch) break;
                    const v = noSubVideos[j];
                    logToConsole(`[YT] 正在下載音訊 (${j + 1}/${noSubVideos.length}): "${v.title}"`);
                    try {
                        updateStepState(task.stepYtAction, 'active', `下載音訊 (${j + 1}/${noSubVideos.length})...`);
                        const res = await downloadAudioStreamHelper(v.id, cookiesBrowser, kw, v.title, (status, percent) => {
                            if (status === 'downloading') {
                                updateStepState(task.stepYtAction, 'active', `下載中 (${percent}%)...`);
                            } else if (status === 'saving') {
                                updateStepState(task.stepYtAction, 'active', '存檔中...');
                            }
                        });
                        if (res.success) {
                            logToConsole(`[YT] ✅ 下載成功: "${res.filename}"`);
                        } else {
                            mp3FailedCount++;
                            logToConsole(`[YT] ❌ 下載失敗: ${v.title} - ${res.error}`);
                        }
                    } catch (e) {
                        mp3FailedCount++;
                        logToConsole(`[YT] ❌ 下載發生異常: ${e.message}`);
                    }
                }
                if (mp3FailedCount > 0) {
                    logToConsole(`[YT] ⚠️ 下載完成，但有 ${mp3FailedCount} 部影片下載失敗。`);
                    successOverall = false;
                } else {
                    logToConsole(`[YT] ✅ 所有無字幕音訊下載完成。`);
                }
            } else {
                logToConsole(`[YT] ℹ️ 無任何無字幕影片，跳過音訊下載。`);
            }
        }

        updateStepState(task.stepYtAction, successOverall ? 'completed' : 'failed', successOverall ? '全部完成' : '部分失敗');
    }

    task.cardEl.classList.remove('active');
    badgeStatus.className = `batch-task-status-text ${successOverall ? 'completed' : 'failed'}`;
    badgeStatus.textContent = successOverall ? '已完成' : '有錯誤';
    onComplete();
}

// Helper: Update step visual state in card
function updateStepState(stepEl, state, statusText) {
    if (!stepEl) return;
    stepEl.className = `batch-task-step ${stepEl.classList.contains('step-pdf') ? 'step-pdf' : stepEl.classList.contains('step-yt-search') ? 'step-yt-search' : stepEl.classList.contains('step-yt-sub') ? 'step-yt-sub' : 'step-yt-action'} ${state}`;
    const statusEl = stepEl.querySelector('.batch-task-step-status');
    if (statusEl) {
        statusEl.textContent = statusText;
    }
}

// ==========================================
// Persistent Search Records & Settings
// ==========================================

function loadSavedFiltersAndSearch() {
    // YouTube Page
    if (localStorage.getItem('search-type')) {
        searchTypeSelect.value = localStorage.getItem('search-type');
    }
    handleSearchTypeChange();

    if (localStorage.getItem('target-url')) {
        targetUrlInput.value = localStorage.getItem('target-url');
    }
    if (localStorage.getItem('search-query')) {
        searchQueryInput.value = localStorage.getItem('search-query');
    }
    if (localStorage.getItem('results-limit')) {
        resultsLimitSelect.value = localStorage.getItem('results-limit');
    }

    if (localStorage.getItem('filter-duration-min') !== null) {
        filterDurationMin.value = localStorage.getItem('filter-duration-min');
    }
    if (localStorage.getItem('filter-duration-max') !== null) {
        filterDurationMax.value = localStorage.getItem('filter-duration-max');
    }
    if (localStorage.getItem('filter-date-select')) {
        filterDateSelect.value = localStorage.getItem('filter-date-select');
    }
    if (filterDateSelect.value === 'custom') {
        customDateRangeContainer.style.display = 'flex';
    } else {
        customDateRangeContainer.style.display = 'none';
    }
    if (localStorage.getItem('filter-date-from') !== null) {
        filterDateFrom.value = localStorage.getItem('filter-date-from');
    }
    if (localStorage.getItem('filter-date-to') !== null) {
        filterDateTo.value = localStorage.getItem('filter-date-to');
    }
    if (localStorage.getItem('filter-views-min') !== null) {
        filterViewsMin.value = localStorage.getItem('filter-views-min');
    }
    if (localStorage.getItem('filter-views-max') !== null) {
        filterViewsMax.value = localStorage.getItem('filter-views-max');
    }
    if (localStorage.getItem('filter-live')) {
        filterLiveSelect.value = localStorage.getItem('filter-live');
    }
    if (localStorage.getItem('sort-by')) {
        sortBySelect.value = localStorage.getItem('sort-by');
    }

    // PDF Page
    if (localStorage.getItem('pdf-search-query')) {
        pdfSearchQueryInput.value = localStorage.getItem('pdf-search-query');
    }

    // Batch Page
    if (localStorage.getItem('batch-keywords')) {
        batchKeywordsInput.value = localStorage.getItem('batch-keywords');
    }
    if (localStorage.getItem('batch-opt-save-urls') !== null) {
        batchOptSaveUrls.checked = localStorage.getItem('batch-opt-save-urls') === 'true';
    }
    if (localStorage.getItem('batch-opt-download-mp3') !== null) {
        batchOptDownloadMp3.checked = localStorage.getItem('batch-opt-download-mp3') === 'true';
    }
    if (localStorage.getItem('batch-opt-download-pdf') !== null) {
        batchOptDownloadPdf.checked = localStorage.getItem('batch-opt-download-pdf') === 'true';
    }
    if (localStorage.getItem('batch-results-limit')) {
        batchResultsLimitInput.value = localStorage.getItem('batch-results-limit');
    }
    if (localStorage.getItem('batch-concurrency')) {
        batchConcurrencyInput.value = localStorage.getItem('batch-concurrency');
    }
    if (localStorage.getItem('batch-cookies-browser')) {
        batchCookiesBrowserSelect.value = localStorage.getItem('batch-cookies-browser');
    }

    // Word2MD Page
    if (localStorage.getItem('word2md-folder-path')) {
        word2mdFolderPathInput.value = localStorage.getItem('word2md-folder-path');
    }

    // Compress Image Page
    if (localStorage.getItem('compress-image-folder-path')) {
        compressImageFolderPathInput.value = localStorage.getItem('compress-image-folder-path');
    }
    if (localStorage.getItem('compress-image-max-edge')) {
        compressImageMaxEdgeSelect.value = localStorage.getItem('compress-image-max-edge');
    }
    if (localStorage.getItem('compress-image-quality')) {
        compressImageQualitySelect.value = localStorage.getItem('compress-image-quality');
    }
    if (localStorage.getItem('compress-image-convert-png')) {
        compressImageConvertPngCheckbox.checked = localStorage.getItem('compress-image-convert-png') === 'true';
    }

    // Restore active tab
    const activeTab = localStorage.getItem('active-tab');
    if (activeTab === 'pdf') {
        setTabActive('pdf');
    } else if (activeTab === 'batch') {
        setTabActive('batch');
    } else if (activeTab === 'word2md') {
        setTabActive('word2md');
    } else if (activeTab === 'extract-audio') {
        setTabActive('extract-audio');
    } else if (activeTab === 'compress-video') {
        setTabActive('compress-video');
    } else if (activeTab === 'compress-image') {
        setTabActive('compress-image');
    } else {
        setTabActive('youtube');
    }
}

// Attach input/change event listeners to save settings as they are modified
pdfSearchQueryInput.addEventListener('input', () => {
    localStorage.setItem('pdf-search-query', pdfSearchQueryInput.value);
});

batchKeywordsInput.addEventListener('input', () => {
    localStorage.setItem('batch-keywords', batchKeywordsInput.value);
});
batchOptSaveUrls.addEventListener('change', () => {
    localStorage.setItem('batch-opt-save-urls', batchOptSaveUrls.checked);
});
batchOptDownloadMp3.addEventListener('change', () => {
    localStorage.setItem('batch-opt-download-mp3', batchOptDownloadMp3.checked);
});
batchOptDownloadPdf.addEventListener('change', () => {
    localStorage.setItem('batch-opt-download-pdf', batchOptDownloadPdf.checked);
});
batchResultsLimitInput.addEventListener('input', () => {
    localStorage.setItem('batch-results-limit', batchResultsLimitInput.value);
});
batchConcurrencyInput.addEventListener('input', () => {
    localStorage.setItem('batch-concurrency', batchConcurrencyInput.value);
});
batchCookiesBrowserSelect.addEventListener('change', () => {
    localStorage.setItem('batch-cookies-browser', batchCookiesBrowserSelect.value);
});

word2mdFolderPathInput.addEventListener('input', () => {
    localStorage.setItem('word2md-folder-path', word2mdFolderPathInput.value);
});

compressImageFolderPathInput.addEventListener('input', () => {
    localStorage.setItem('compress-image-folder-path', compressImageFolderPathInput.value);
});
compressImageMaxEdgeSelect.addEventListener('change', () => {
    localStorage.setItem('compress-image-max-edge', compressImageMaxEdgeSelect.value);
});
compressImageQualitySelect.addEventListener('change', () => {
    localStorage.setItem('compress-image-quality', compressImageQualitySelect.value);
});
compressImageConvertPngCheckbox.addEventListener('change', () => {
    localStorage.setItem('compress-image-convert-png', compressImageConvertPngCheckbox.checked);
});


// ==========================================
// Word to Markdown Conversion Module
// ==========================================

let isWord2mdRunning = false;
let word2mdEventSource = null;

// Console Logger helper
function logToWord2mdConsole(text) {
    const timeStr = new Date().toLocaleTimeString();
    word2mdConsoleOutput.innerHTML += `[${timeStr}] ${text}\n`;
    word2mdConsoleOutput.scrollTop = word2mdConsoleOutput.scrollHeight;
}

// Start conversion action
async function startWord2mdConversion() {
    if (isWord2mdRunning) return;

    const folderPath = word2mdFolderPathInput.value.trim();
    if (!folderPath) {
        alert('請先輸入本機資料夾路徑！');
        return;
    }

    isWord2mdRunning = true;
    btnWord2mdStart.disabled = true;
    btnWord2mdStop.disabled = false;
    word2mdFolderPathInput.disabled = true;

    word2mdStatProgress.textContent = '初始化中...';
    word2mdOverallProgressBar.style.width = '0%';
    word2mdStatTotal.textContent = '0';
    word2mdStatConverted.textContent = '0';
    word2mdStatCopied.textContent = '0';
    word2mdStatFailed.textContent = '0';
    word2mdConsoleOutput.innerHTML = '[系統] 啟動 Word 轉 Markdown 資料夾轉換任務...\n';

    const queryParams = new URLSearchParams({ folder_path: folderPath }).toString();
    word2mdEventSource = new EventSource(`/api/convert-word-folder-stream?${queryParams}`);

    word2mdEventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.status === 'start') {
                logToWord2mdConsole(data.message);
                word2mdStatProgress.textContent = '正在建立目標目錄...';
            } else if (data.status === 'scanned') {
                logToWord2mdConsole(data.message);
                word2mdStatTotal.textContent = data.total;
                word2mdStatProgress.textContent = `已準備就緒，共 ${data.total} 個檔案`;
            } else if (data.status === 'processing') {
                word2mdStatProgress.textContent = `處理中 (${data.percent}%)`;
                word2mdOverallProgressBar.style.width = `${data.percent}%`;
                
                if (data.action === 'convert') {
                    const currentConverted = parseInt(word2mdStatConverted.textContent, 10);
                    word2mdStatConverted.textContent = currentConverted + 1;
                } else if (data.action === 'copy') {
                    const currentCopied = parseInt(word2mdStatCopied.textContent, 10);
                    word2mdStatCopied.textContent = currentCopied + 1;
                }
                logToWord2mdConsole(data.message);
            } else if (data.status === 'warning') {
                logToWord2mdConsole(data.message);
                const currentFailed = parseInt(word2mdStatFailed.textContent, 10);
                word2mdStatFailed.textContent = currentFailed + 1;
            } else if (data.status === 'finished') {
                word2mdEventSource.close();
                logToWord2mdConsole(`[系統] ${data.message}`);
                word2mdStatProgress.textContent = '轉換結束';
                word2mdOverallProgressBar.style.width = '100%';
                
                word2mdStatConverted.textContent = data.converted;
                word2mdStatCopied.textContent = data.copied;
                word2mdStatFailed.textContent = data.failed_count;
                
                alert(`轉換完成！\n目標資料夾：${data.dest_dir}\n總檔案數：${data.total}\n轉換 Word：${data.converted}\n複製其餘：${data.copied}\n失敗：${data.failed_count}`);
                stopWord2mdUIState();
            } else if (data.status === 'error') {
                word2mdEventSource.close();
                logToWord2mdConsole(`[錯誤] ${data.message}`);
                word2mdStatProgress.textContent = '轉換失敗';
                alert(`轉換出錯：${data.message}`);
                stopWord2mdUIState();
            }
        } catch (e) {
            console.error('Error parsing SSE event data:', e);
        }
    };

    word2mdEventSource.onerror = (e) => {
        console.error('SSE Error:', e);
        word2mdEventSource.close();
        logToWord2mdConsole('[系統] ❌ 連線中斷或伺服器異常');
        word2mdStatProgress.textContent = '連線中斷';
        alert('與伺服器的連線已中斷');
        stopWord2mdUIState();
    };
}

function stopWord2mdConversion() {
    if (word2mdEventSource) {
        word2mdEventSource.close();
    }
    logToWord2mdConsole('[系統] ⏹️ 使用者手動停止轉換。');
    word2mdStatProgress.textContent = '已手動停止';
    stopWord2mdUIState();
}

function stopWord2mdUIState() {
    isWord2mdRunning = false;
    btnWord2mdStart.disabled = false;
    btnWord2mdStop.disabled = true;
    word2mdFolderPathInput.disabled = false;
}

// Bind Word2MD Event Listeners
btnWord2mdStart.addEventListener('click', startWord2mdConversion);
btnWord2mdStop.addEventListener('click', stopWord2mdConversion);
btnWord2mdClearConsole.addEventListener('click', () => {
    word2mdConsoleOutput.innerHTML = '[系統] 日誌已清除。\n';
});

// ==========================================
// MP4 Audio Extraction Module
// ==========================================

const extractTargetFormatSelect = document.getElementById('extract-target-format');
const extractMaxSizeSelect = document.getElementById('extract-max-size');
const customSizeInputContainer = document.getElementById('custom-size-input-container');
const extractCustomSizeInput = document.getElementById('extract-custom-size');
const btnExtractStart = document.getElementById('btn-extract-start');
const dropZone = document.getElementById('drop-zone');
const btnSelectFile = document.getElementById('btn-select-file');
const fileInput = document.getElementById('file-input');
const selectedFileInfo = document.getElementById('selected-file-info');
const selectedFileName = document.getElementById('selected-file-name');
const selectedFileSize = document.getElementById('selected-file-size');
const extractProgressContainer = document.getElementById('extract-progress-container');
const extractProgressText = document.getElementById('extract-progress-text');
const extractProgressBar = document.getElementById('extract-progress-bar');

let selectedFile = null;

// Size limit select change listener
extractMaxSizeSelect.addEventListener('change', () => {
    if (extractMaxSizeSelect.value === 'custom') {
        customSizeInputContainer.style.display = 'block';
    } else {
        customSizeInputContainer.style.display = 'none';
    }
    localStorage.setItem('extract-max-size', extractMaxSizeSelect.value);
});

extractTargetFormatSelect.addEventListener('change', () => {
    localStorage.setItem('extract-target-format', extractTargetFormatSelect.value);
});

extractCustomSizeInput.addEventListener('input', () => {
    localStorage.setItem('extract-custom-size', extractCustomSizeInput.value);
});

// File selection triggering
btnSelectFile.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelection(e.target.files[0]);
    }
});

// Drag and drop events
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--brand-secondary)';
    dropZone.style.backgroundColor = 'rgba(37, 99, 235, 0.05)';
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#cbd5e1';
    dropZone.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#cbd5e1';
    dropZone.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
    
    if (e.dataTransfer.files.length > 0) {
        handleFileSelection(e.dataTransfer.files[0]);
    }
});

dropZone.addEventListener('click', () => {
    fileInput.click();
});

function handleFileSelection(file) {
    if (!file.name.toLowerCase().endsWith('.mp4') && !file.name.toLowerCase().endsWith('.m4a') && !file.type.startsWith('video/mp4') && !file.type.startsWith('audio/mp4')) {
        alert('請選擇有效的 MP4 檔案！');
        return;
    }
    
    selectedFile = file;
    selectedFileName.textContent = file.name;
    
    const sizeInMB = file.size / (1024 * 1024);
    selectedFileSize.textContent = `${sizeInMB.toFixed(2)} MB`;
    
    selectedFileInfo.style.display = 'block';
    btnExtractStart.disabled = false;
}

btnExtractStart.addEventListener('click', startAudioExtraction);

async function uploadFileHelper(file, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload', true);
        
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                if (onProgress) onProgress(percent, e.loaded, e.total);
            }
        });
        
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data);
                } catch (e) {
                    reject(new Error('解析上傳回應失敗'));
                }
            } else {
                let errMsg = '上傳失敗';
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (data.error) errMsg = data.error;
                } catch (_) {}
                reject(new Error(errMsg));
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('網路連線錯誤，上傳失敗'));
        };
        
        xhr.send(formData);
    });
}

async function startAudioExtraction() {
    if (!selectedFile) return;
    
    btnExtractStart.disabled = true;
    extractProgressContainer.style.display = 'block';
    extractProgressBar.style.width = '0%';
    extractProgressBar.style.backgroundColor = 'var(--brand-secondary)';
    extractProgressText.textContent = '正在準備上傳影片檔案...';
    
    let maxSize = extractMaxSizeSelect.value;
    if (maxSize === 'custom') {
        maxSize = extractCustomSizeInput.value.trim();
        if (!maxSize || isNaN(maxSize) || parseFloat(maxSize) <= 0) {
            alert('請輸入有效的自訂限制大小 (MB)！');
            btnExtractStart.disabled = false;
            return;
        }
    }
    
    try {
        const uploadResult = await uploadFileHelper(selectedFile, (percent, loaded, total) => {
            extractProgressBar.style.width = `${Math.round(percent * 0.4)}%`;
            extractProgressText.textContent = `正在上傳影片檔案: ${percent}% (已上傳 ${(loaded / (1024*1024)).toFixed(1)}MB / ${(total / (1024*1024)).toFixed(1)}MB)`;
        });
        
        if (!uploadResult.success) {
            throw new Error(uploadResult.error || '上傳失敗');
        }
        
        extractProgressBar.style.width = '40%';
        extractProgressText.textContent = '上傳完成，伺服器準備進行音訊萃取...';
        
        const queryParams = new URLSearchParams({
            temp_path: uploadResult.temp_path,
            target_format: extractTargetFormatSelect.value,
            max_size_mb: maxSize,
            use_gpu: isGpuAvailable ? 'true' : 'false'
        }).toString();
        
        const eventSource = new EventSource(`/api/extract-audio-stream?${queryParams}`);
        
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.status === 'processing') {
                const ffmpegPercent = data.percent || 0;
                const overallPercent = 40 + Math.round(ffmpegPercent * 0.6);
                extractProgressBar.style.width = `${overallPercent}%`;
                extractProgressText.textContent = `正在進行音軌萃取與大小限制處理: ${ffmpegPercent}%`;
            } else if (data.status === 'finished') {
                eventSource.close();
                extractProgressBar.style.width = '100%';
                extractProgressText.textContent = '音軌萃取成功！正在傳送檔案至瀏覽器...';
                
                const originalName = selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.'));
                const dlName = `${originalName}_extracted.${data.final_format}`;
                const mimetype = data.final_format === 'm4a' ? 'audio/mp4' : `audio/${data.final_format}`;
                
                const dlParams = new URLSearchParams({
                    path: data.path,
                    download_name: dlName,
                    mimetype: mimetype
                }).toString();
                
                const downloadUrl = `/api/download-processed?${dlParams}`;
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = dlName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                
                setTimeout(() => {
                    extractProgressContainer.style.display = 'none';
                    btnExtractStart.disabled = false;
                    alert(`🎉 音軌萃取成功！已儲存為：${dlName}`);
                }, 1000);
            } else if (data.status === 'error') {
                eventSource.close();
                throw new Error(data.message || '伺服器端萃取錯誤');
            }
        };
        
        eventSource.onerror = () => {
            eventSource.close();
            extractProgressText.textContent = '連線進度串流失敗';
            btnExtractStart.disabled = false;
            alert('與伺服器的進度連線發生錯誤。');
        };
        
    } catch (err) {
        extractProgressText.textContent = `錯誤: ${err.message}`;
        extractProgressBar.style.backgroundColor = 'var(--brand-primary)';
        btnExtractStart.disabled = false;
        alert(err.message);
    }
}

// Load saved extraction settings
function loadExtractionSettings() {
    if (localStorage.getItem('extract-target-format')) {
        extractTargetFormatSelect.value = localStorage.getItem('extract-target-format');
    }
    if (localStorage.getItem('extract-max-size')) {
        extractMaxSizeSelect.value = localStorage.getItem('extract-max-size');
        if (extractMaxSizeSelect.value === 'custom') {
            customSizeInputContainer.style.display = 'block';
        }
    }
    if (localStorage.getItem('extract-custom-size')) {
        extractCustomSizeInput.value = localStorage.getItem('extract-custom-size');
    }
}

loadExtractionSettings();

// GPU acceleration detection and display
let isGpuAvailable = false;
let currentGpuEncoder = 'libx264';

async function checkGpuStatus() {
    try {
        const res = await fetch('/api/gpu-status');
        const data = await res.json();
        isGpuAvailable = data.gpu_available;
        currentGpuEncoder = data.encoder;
        
        // Update GPU badges in UI
        const dotAudio = document.getElementById('gpu-status-dot-audio');
        const textAudio = document.getElementById('gpu-status-text-audio');
        const dotVideo = document.getElementById('gpu-status-dot-video');
        const textVideo = document.getElementById('gpu-status-text-video');
        
        const color = isGpuAvailable ? 'var(--status-success)' : 'var(--text-muted)';
        const text = isGpuAvailable ? `已啟用 (${currentGpuEncoder})` : '未啟用 (使用 CPU)';
        
        if (dotAudio) dotAudio.style.backgroundColor = color;
        if (textAudio) textAudio.textContent = text;
        if (dotVideo) dotVideo.style.backgroundColor = color;
        if (textVideo) textVideo.textContent = text;
    } catch (e) {
        console.error('Failed to check GPU status', e);
    }
}

checkGpuStatus();

// ==========================================
// MP4 Video Compression Module
// ==========================================

const compressModeSelect = document.getElementById('compress-mode');
const btnCompressStart = document.getElementById('btn-compress-start');
const dropZoneVideo = document.getElementById('drop-zone-video');
const btnSelectFileVideo = document.getElementById('btn-select-file-video');
const fileInputVideo = document.getElementById('file-input-video');
const selectedFileInfoVideo = document.getElementById('selected-file-info-video');
const selectedFileNameVideo = document.getElementById('selected-file-name-video');
const selectedFileSizeVideo = document.getElementById('selected-file-size-video');
const compressProgressContainer = document.getElementById('compress-progress-container');
const compressProgressText = document.getElementById('compress-progress-text');
const compressProgressBar = document.getElementById('compress-progress-bar');

let selectedVideoFile = null;

// File selection trigger
btnSelectFileVideo.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInputVideo.click();
});

fileInputVideo.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleVideoFileSelection(e.target.files[0]);
    }
});

// Drag and drop events for video
dropZoneVideo.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZoneVideo.style.borderColor = 'var(--brand-secondary)';
    dropZoneVideo.style.backgroundColor = 'rgba(37, 99, 235, 0.05)';
});

dropZoneVideo.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZoneVideo.style.borderColor = '#cbd5e1';
    dropZoneVideo.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
});

dropZoneVideo.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZoneVideo.style.borderColor = '#cbd5e1';
    dropZoneVideo.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
    
    if (e.dataTransfer.files.length > 0) {
        handleVideoFileSelection(e.dataTransfer.files[0]);
    }
});

dropZoneVideo.addEventListener('click', () => {
    fileInputVideo.click();
});

function handleVideoFileSelection(file) {
    const nameLower = file.name.toLowerCase();
    if (!nameLower.endsWith('.mp4') && !nameLower.endsWith('.mkv') && !nameLower.endsWith('.mov')) {
        alert('請選擇有效的 MP4、MKV 或 MOV 影片檔案！');
        return;
    }
    
    selectedVideoFile = file;
    selectedFileNameVideo.textContent = file.name;
    
    const sizeInMB = file.size / (1024 * 1024);
    selectedFileSizeVideo.textContent = `${sizeInMB.toFixed(2)} MB`;
    
    selectedFileInfoVideo.style.display = 'block';
    btnCompressStart.disabled = false;
}

btnCompressStart.addEventListener('click', startVideoCompression);

async function startVideoCompression() {
    if (!selectedVideoFile) return;
    
    btnCompressStart.disabled = true;
    compressProgressContainer.style.display = 'block';
    compressProgressBar.style.width = '0%';
    compressProgressBar.style.backgroundColor = 'var(--brand-secondary)';
    compressProgressText.textContent = '正在準備上傳影片檔案...';
    
    try {
        const uploadResult = await uploadFileHelper(selectedVideoFile, (percent, loaded, total) => {
            compressProgressBar.style.width = `${Math.round(percent * 0.4)}%`;
            compressProgressText.textContent = `正在上傳影片檔案: ${percent}% (已上傳 ${(loaded / (1024*1024)).toFixed(1)}MB / ${(total / (1024*1024)).toFixed(1)}MB)`;
        });
        
        if (!uploadResult.success) {
            throw new Error(uploadResult.error || '上傳失敗');
        }
        
        compressProgressBar.style.width = '40%';
        compressProgressText.textContent = '上傳完成，伺服器準備進行影片壓縮與 GPU 硬體加速編碼...';
        
        const queryParams = new URLSearchParams({
            temp_path: uploadResult.temp_path,
            mode: compressModeSelect.value,
            use_gpu: isGpuAvailable ? 'true' : 'false'
        }).toString();
        
        const eventSource = new EventSource(`/api/compress-video-stream?${queryParams}`);
        
        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.status === 'processing') {
                const ffmpegPercent = data.percent || 0;
                const overallPercent = 40 + Math.round(ffmpegPercent * 0.6);
                compressProgressBar.style.width = `${overallPercent}%`;
                compressProgressText.textContent = `正在進行影片壓縮與 GPU 硬體加速編碼: ${ffmpegPercent}%`;
            } else if (data.status === 'finished') {
                eventSource.close();
                compressProgressBar.style.width = '100%';
                compressProgressText.textContent = '影片壓縮成功！正在傳送檔案至瀏覽器...';
                
                const originalName = selectedVideoFile.name.substring(0, selectedVideoFile.name.lastIndexOf('.'));
                const dlName = `${originalName}_compressed.mp4`;
                
                const dlParams = new URLSearchParams({
                    path: data.path,
                    download_name: dlName,
                    mimetype: 'video/mp4'
                }).toString();
                
                const downloadUrl = `/api/download-processed?${dlParams}`;
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = dlName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                
                setTimeout(() => {
                    compressProgressContainer.style.display = 'none';
                    btnCompressStart.disabled = false;
                    alert(`🎉 影片壓縮成功！已儲存為：${dlName}\n檔案大小已嚴格控制在 200MB 以內！`);
                }, 1000);
            } else if (data.status === 'error') {
                eventSource.close();
                throw new Error(data.message || '伺服器端壓縮錯誤');
            }
        };
        
        eventSource.onerror = () => {
            eventSource.close();
            compressProgressText.textContent = '連線進度串流失敗';
            btnCompressStart.disabled = false;
            alert('與伺服器的進度連線發生錯誤。');
        };
        
    } catch (err) {
        compressProgressText.textContent = `錯誤: ${err.message}`;
        compressProgressBar.style.backgroundColor = 'var(--brand-primary)';
        btnCompressStart.disabled = false;
        alert(err.message);
    }
}

// ==========================================
// Image Batch Compression Module
// ==========================================

let isCompressImageRunning = false;
let compressImageEventSource = null;

// Console logger helper
function logToCompressImageConsole(text) {
    const timeStr = new Date().toLocaleTimeString();
    compressImageConsoleOutput.innerHTML += `[${timeStr}] ${text}\n`;
    compressImageConsoleOutput.scrollTop = compressImageConsoleOutput.scrollHeight;
}

// Start image compression action
async function startImageCompression() {
    if (isCompressImageRunning) return;

    const folderPath = compressImageFolderPathInput.value.trim();
    if (!folderPath) {
        alert('請先輸入本機資料夾路徑！');
        return;
    }

    if (!confirm('⚠️ 警告：這將會直接取代/覆寫您的原始圖片檔案。確定已備份並要開始壓縮嗎？')) {
        return;
    }

    isCompressImageRunning = true;
    btnCompressImageStart.disabled = true;
    btnCompressImageStop.disabled = false;
    compressImageFolderPathInput.disabled = true;

    compressImageStatProgress.textContent = '初始化中...';
    compressImageOverallProgressBar.style.width = '0%';
    compressImageStatTotal.textContent = '0';
    compressImageStatConverted.textContent = '0';
    compressImageStatSaved.textContent = '0.00 MB';
    compressImageStatFailed.textContent = '0';
    compressImageConsoleOutput.innerHTML = '[系統] 啟動圖片批次壓縮任務...\n';

    const queryParams = new URLSearchParams({
        folder_path: folderPath,
        convert_png: compressImageConvertPngCheckbox.checked ? 'true' : 'false',
        max_edge: compressImageMaxEdgeSelect.value,
        quality: compressImageQualitySelect.value
    }).toString();

    compressImageEventSource = new EventSource(`/api/compress-image-folder-stream?${queryParams}`);

    compressImageEventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.status === 'start') {
                logToCompressImageConsole(data.message);
                compressImageStatProgress.textContent = '掃描目錄中...';
            } else if (data.status === 'scanned') {
                logToCompressImageConsole(data.message);
                compressImageStatTotal.textContent = data.total;
                compressImageStatProgress.textContent = `已準備就緒，共 ${data.total} 個檔案`;
            } else if (data.status === 'processing') {
                compressImageStatProgress.textContent = `處理中 (${data.percent}%)`;
                compressImageOverallProgressBar.style.width = `${data.percent}%`;
                logToCompressImageConsole(data.message);
            } else if (data.status === 'file_success') {
                const currentConverted = parseInt(compressImageStatConverted.textContent, 10);
                compressImageStatConverted.textContent = currentConverted + 1;
                logToCompressImageConsole(data.message);
            } else if (data.status === 'warning') {
                logToCompressImageConsole(data.message);
                const currentFailed = parseInt(compressImageStatFailed.textContent, 10);
                compressImageStatFailed.textContent = currentFailed + 1;
            } else if (data.status === 'finished') {
                compressImageEventSource.close();
                logToCompressImageConsole(`[系統] ${data.message}`);
                compressImageStatProgress.textContent = '處理完成';
                compressImageOverallProgressBar.style.width = '100%';
                
                compressImageStatConverted.textContent = data.converted;
                compressImageStatFailed.textContent = data.failed_count;
                compressImageStatSaved.textContent = `${(data.saved_bytes / (1024 * 1024)).toFixed(2)} MB`;
                
                alert(`圖片壓縮完成！\n總圖片數：${data.total}\n成功壓縮：${data.converted}\n失敗：${data.failed_count}\n節省空間：${(data.saved_bytes / (1024 * 1024)).toFixed(2)} MB (${data.saved_ratio.toFixed(1)}%)`);
                stopCompressImageUIState();
            } else if (data.status === 'error') {
                compressImageEventSource.close();
                logToCompressImageConsole(`[錯誤] ${data.message}`);
                compressImageStatProgress.textContent = '處理失敗';
                alert(`處理出錯：${data.message}`);
                stopCompressImageUIState();
            }
        } catch (e) {
            console.error('Error parsing SSE event data:', e);
        }
    };

    compressImageEventSource.onerror = (e) => {
        console.error('SSE Error:', e);
        compressImageEventSource.close();
        logToCompressImageConsole('[系統] ❌ 連線中斷或伺服器異常');
        compressImageStatProgress.textContent = '連線中斷';
        alert('與伺服器的連線已中斷');
        stopCompressImageUIState();
    };
}

function stopImageCompression() {
    if (compressImageEventSource) {
        compressImageEventSource.close();
    }
    logToCompressImageConsole('[系統] ⏹️ 使用者手動停止壓縮。');
    compressImageStatProgress.textContent = '已手動停止';
    stopCompressImageUIState();
}

function stopCompressImageUIState() {
    isCompressImageRunning = false;
    btnCompressImageStart.disabled = false;
    btnCompressImageStop.disabled = true;
    compressImageFolderPathInput.disabled = false;
}

// Bind Events
btnCompressImageStart.addEventListener('click', startImageCompression);
btnCompressImageStop.addEventListener('click', stopImageCompression);
btnCompressImageClearConsole.addEventListener('click', () => {
    compressImageConsoleOutput.innerHTML = '[系統] 日誌已清除。\n';
});

// Load saved inputs on load
loadSavedFiltersAndSearch();
lucide.createIcons();


