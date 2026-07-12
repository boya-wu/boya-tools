import os
import sys
import json
import queue
import time
import threading
import logging
from flask import Flask, request, jsonify, send_file, send_from_directory, Response, stream_with_context
from flask_cors import CORS
import yt_dlp
from concurrent.futures import ThreadPoolExecutor, as_completed

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# Ensure downloads directory exists
DOWNLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# YouTube rate limiting (avoid 429 / IP throttling)
MAX_YOUTUBE_CONCURRENT = 6
MIN_YOUTUBE_REQUEST_INTERVAL = 0.3
BATCH_SUBTITLE_CHUNK_SIZE = 10
BATCH_SUBTITLE_CHUNK_DELAY = 0.5

youtube_semaphore = threading.Semaphore(MAX_YOUTUBE_CONCURRENT)
_youtube_request_lock = threading.Lock()
_last_youtube_request_at = 0.0

# Thread Pool for subtitle check and parallel processing
executor = ThreadPoolExecutor(max_workers=MAX_YOUTUBE_CONCURRENT)

def youtube_rate_limit():
    global _last_youtube_request_at
    with _youtube_request_lock:
        elapsed = time.time() - _last_youtube_request_at
        if elapsed < MIN_YOUTUBE_REQUEST_INTERVAL:
            time.sleep(MIN_YOUTUBE_REQUEST_INTERVAL - elapsed)
        _last_youtube_request_at = time.time()

def extract_info_rate_limited(ydl, url_or_query):
    youtube_rate_limit()
    with youtube_semaphore:
        return ydl.extract_info(url_or_query, download=False)

def format_video_entry(entry, uploader_fallback=None):
    upload_date = entry.get('upload_date')
    timestamp = entry.get('timestamp') or entry.get('release_timestamp')
    if not upload_date and timestamp:
        upload_date = time.strftime('%Y%m%d', time.localtime(timestamp))
    thumbnails = entry.get('thumbnails') or []
    thumbnail_url = thumbnails[0].get('url') if thumbnails else None
    return {
        'id': entry.get('id'),
        'title': entry.get('title'),
        'url': f"https://www.youtube.com/watch?v={entry.get('id')}",
        'duration': entry.get('duration'),
        'view_count': entry.get('view_count'),
        'uploader': entry.get('uploader') or uploader_fallback,
        'thumbnail': thumbnail_url,
        'upload_date': upload_date,
        'timestamp': timestamp,
        'is_live': bool(entry.get('is_live') or entry.get('live_status') == 'is_live'),
    }

def enrich_upload_date(video_id, cookies_browser):
    url = f"https://www.youtube.com/watch?v={video_id}"
    opts = get_ydl_opts(cookies_browser, {'skip_download': True})
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = extract_info_rate_limited(ydl, url)
            upload_date = info.get('upload_date')
            timestamp = info.get('timestamp') or info.get('release_timestamp')
            if not upload_date and timestamp:
                upload_date = time.strftime('%Y%m%d', time.localtime(timestamp))
            return upload_date, timestamp
    except Exception as e:
        logger.warning(f"Failed to enrich upload_date for {video_id}: {e}")
        return None, None

def get_ydl_opts(cookies_browser=None, extra_opts=None):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'logger': logger,
        'remote_components': ['ejs:github'],
        'js_runtimes': {'node': {}},
    }
    if cookies_browser and cookies_browser != 'none':
        if cookies_browser == 'cookies.txt':
            cookies_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cookies.txt')
            if os.path.exists(cookies_file):
                opts['cookiefile'] = cookies_file
        else:
            opts['cookiesfrombrowser'] = (cookies_browser,)
    if extra_opts:
        opts.update(extra_opts)
    return opts

_ydl_local = threading.local()

def get_thread_ydl(cookies_browser):
    key = f"ydl_{cookies_browser}"
    if not hasattr(_ydl_local, key):
        opts = get_ydl_opts(cookies_browser, {'skip_download': True})
        setattr(_ydl_local, key, yt_dlp.YoutubeDL(opts))
    return getattr(_ydl_local, key)

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/search', methods=['GET'])
def api_search():
    """
    Search endpoint supporting global search, search in channel, or listing channel uploads.
    """
    search_type = request.args.get('type', 'global') # 'global', 'channel', 'playlist'
    query = request.args.get('query', '').strip()
    target_url = request.args.get('url', '').strip()
    limit = int(request.args.get('limit', 20))
    cookies_browser = request.args.get('cookies_browser', 'none')
    
    if limit < 1:
        limit = 100
    # Safeguard to prevent server crash/timeout from extremely large queries
    if limit > 1000:
        limit = 1000

    results = []
    
    try:
        if search_type == 'global':
            if not query:
                return jsonify({'error': 'Search query is required for global search'}), 400
            
            # Global YouTube search
            opts = get_ydl_opts(cookies_browser, {'extract_flat': True})
            with yt_dlp.YoutubeDL(opts) as ydl:
                # Use ytsearchN:query pattern
                search_query = f"ytsearch{limit}:{query}"
                info = extract_info_rate_limited(ydl, search_query)
                if 'entries' in info:
                    for entry in info['entries']:
                        if entry:
                            results.append(format_video_entry(entry))

        elif search_type == 'channel' or search_type == 'playlist':
            if not target_url:
                return jsonify({'error': 'Channel or Playlist URL/Name is required'}), 400
            
            # yt-dlp can resolve channel handle or name. Let's do flat extraction
            opts = get_ydl_opts(cookies_browser, {'extract_flat': True})
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = extract_info_rate_limited(ydl, target_url)
                
                # If we got a list/playlist back
                entries = []
                if 'entries' in info:
                    entries = list(info['entries'])
                else:
                    # Single video maybe?
                    entries = [info]
                
                # Filter by keyword if query is provided
                filtered_entries = []
                for entry in entries:
                    if not entry:
                        continue
                    
                    title = entry.get('title', '')
                    description = entry.get('description', '')
                    
                    # If querying within channel/playlist
                    if query:
                        q = query.lower()
                        if q not in title.lower() and q not in description.lower():
                            continue
                            
                    filtered_entries.append(entry)
                
                # Limit the results
                for entry in filtered_entries[:limit]:
                    results.append(format_video_entry(entry, info.get('title')))

        enrich_dates = request.args.get('enrich_dates', 'false').lower() == 'true'
        if enrich_dates and results:
            missing = [r for r in results if not r.get('upload_date') and r.get('id')]
            if missing:
                futures = {
                    executor.submit(enrich_upload_date, r['id'], cookies_browser): r
                    for r in missing
                }
                for future in as_completed(futures):
                    row = futures[future]
                    upload_date, timestamp = future.result()
                    if upload_date:
                        row['upload_date'] = upload_date
                    if timestamp:
                        row['timestamp'] = timestamp
                    
        return jsonify({
            'success': True,
            'count': len(results),
            'results': results
        })

    except Exception as e:
        logger.error(f"Search failed: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/playlists', methods=['GET'])
def api_playlists():
    """
    Get playlists from a channel URL
    """
    channel_url = request.args.get('url', '').strip()
    cookies_browser = request.args.get('cookies_browser', 'none')
    if not channel_url:
        return jsonify({'error': 'Channel URL is required'}), 400
        
    try:
        # We append /playlists to the channel URL to specifically target playlists tab if possible,
        # or let yt-dlp handle it.
        # Let's extract the playlists tab. We extract flat and filter for playlists.
        opts = get_ydl_opts(cookies_browser, {'extract_flat': True})
        
        # If the URL doesn't contain "/playlists", we can try to construct it or let user provide it.
        # But yt-dlp usually extracts tabs automatically. Let's query the channel URL directly first.
        target = channel_url
        if 'youtube.com' in channel_url and '/playlists' not in channel_url:
            # Try to fetch playlists by adding /playlists
            if channel_url.endswith('/'):
                target = channel_url + 'playlists'
            else:
                target = channel_url + '/playlists'
                
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = extract_info_rate_limited(ydl, target)
            playlists = []
            
            if 'entries' in info:
                for entry in info['entries']:
                    if entry and entry.get('_type') == 'playlist' or entry.get('playlist'):
                        playlists.append({
                            'id': entry.get('id'),
                            'title': entry.get('title'),
                            'url': entry.get('url') or f"https://www.youtube.com/playlist?list={entry.get('id')}",
                            'video_count': entry.get('playlist_count'),
                        })
            
            # If no playlists found directly via /playlists, try original URL
            if not playlists:
                with yt_dlp.YoutubeDL(opts) as ydl_orig:
                    info_orig = extract_info_rate_limited(ydl_orig, channel_url)
                    if 'entries' in info_orig:
                        for entry in info_orig['entries']:
                            if entry and (entry.get('_type') == 'playlist' or 'playlist' in entry.get('url', '')):
                                playlists.append({
                                    'id': entry.get('id'),
                                    'title': entry.get('title'),
                                    'url': entry.get('url') or f"https://www.youtube.com/playlist?list={entry.get('id')}",
                                    'video_count': entry.get('playlist_count'),
                                })
            
            return jsonify({
                'success': True,
                'count': len(playlists),
                'playlists': playlists
            })
            
    except Exception as e:
        logger.error(f"Failed to fetch playlists: {str(e)}")
        return jsonify({'error': str(e)}), 500

def check_subtitle_single(video_id, cookies_browser=None):
    """
    Worker task to check subtitles for a single video.
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        ydl = get_thread_ydl(cookies_browser or 'none')
        info = extract_info_rate_limited(ydl, url)
        subtitles = info.get('subtitles', {}) or {}
        auto_subs = info.get('automatic_captions', {}) or {}
        
        has_manual = bool(subtitles and len(subtitles) > 0)
        has_auto = bool(auto_subs and len(auto_subs) > 0)
        
        return {
            'id': video_id,
            'has_subtitles': has_manual or has_auto,
            'subtitles': {
                'manual': list(subtitles.keys()) if has_manual else [],
                'auto': list(auto_subs.keys()) if has_auto else []
            }
        }
    except Exception as e:
        return {
            'id': video_id,
            'has_subtitles': False,
            'error': str(e)
        }

@app.route('/api/batch-info', methods=['POST'])
def api_batch_info():
    """
    Post a list of video IDs to perform multi-threaded subtitle checks.
    """
    data = request.get_json() or {}
    video_ids = data.get('video_ids', [])
    cookies_browser = data.get('cookies_browser', 'none')
    
    if not video_ids:
        return jsonify({'error': 'No video IDs provided'}), 400

    chunk_size = int(data.get('chunk_size', BATCH_SUBTITLE_CHUNK_SIZE))
    chunk_delay = float(data.get('chunk_delay', BATCH_SUBTITLE_CHUNK_DELAY))
    if chunk_size < 1:
        chunk_size = BATCH_SUBTITLE_CHUNK_SIZE
    if chunk_size > 10:
        chunk_size = 10

    results = []
    for i in range(0, len(video_ids), chunk_size):
        chunk = video_ids[i:i + chunk_size]
        futures = [executor.submit(check_subtitle_single, vid, cookies_browser) for vid in chunk]
        results.extend(f.result() for f in futures)
        if i + chunk_size < len(video_ids) and chunk_delay > 0:
            time.sleep(chunk_delay)
        
    # Format results
    results_map = {res['id']: res for res in results}
    
    return jsonify({
        'success': True,
        'results': results_map
    })

@app.route('/api/batch-info-stream', methods=['POST'])
def api_batch_info_stream():
    """
    Post a list of video IDs to perform multi-threaded subtitle checks and stream the results back.
    """
    data = request.get_json() or {}
    video_ids = data.get('video_ids', [])
    cookies_browser = data.get('cookies_browser', 'none')
    
    if not video_ids:
        return jsonify({'error': 'No video IDs provided'}), 400

    def generate():
        result_queue = queue.Queue()
        total = len(video_ids)
        completed = 0

        def worker(vid):
            res = check_subtitle_single(vid, cookies_browser)
            result_queue.put(res)

        for vid in video_ids:
            executor.submit(worker, vid)

        while completed < total:
            res = result_queue.get()
            completed += 1
            payload = {
                'result': res,
                'completed': completed,
                'total': total
            }
            yield f"{json.dumps(payload, ensure_ascii=False)}\n"

    return Response(stream_with_context(generate()), mimetype='application/x-ndjson')

@app.route('/api/download-mp3', methods=['GET'])
def api_download_mp3():
    """
    Download a video and convert it to MP3.
    """
    video_id = request.args.get('id', '').strip()
    cookies_browser = request.args.get('cookies_browser', 'none')
    keyword = request.args.get('keyword', '').strip()
    title = request.args.get('title', '').strip()
    if not video_id:
        return jsonify({'error': 'Video ID is required'}), 400
        
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    
    if keyword:
        safe_dir = sanitize_name(keyword)
        target_dir = os.path.join(DOWNLOADS_DIR, safe_dir)
        os.makedirs(target_dir, exist_ok=True)
        if title:
            safe_title = sanitize_name(title)
            output_filename = f"{safe_title}.mp3"
        else:
            output_filename = f"{video_id}.mp3"
        output_path = os.path.join(target_dir, output_filename)
    else:
        output_filename = f"{video_id}.mp3"
        output_path = os.path.join(DOWNLOADS_DIR, output_filename)
    
    # If already downloaded, return it directly
    if os.path.exists(output_path):
        if keyword:
            return jsonify({'success': True, 'filename': output_filename, 'path': output_path})
        return send_file(output_path, as_attachment=True, download_name=output_filename)
        
    try:
        # Download and convert
        ydl_opts = get_ydl_opts(cookies_browser, {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(os.path.dirname(output_path), '%(id)s.%(ext)s') if not title else output_path.replace('.mp3', '.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
            
        if not title:
            default_out = os.path.join(os.path.dirname(output_path), f"{video_id}.mp3")
            if default_out != output_path and os.path.exists(default_out):
                os.rename(default_out, output_path)
            
        if os.path.exists(output_path):
            if keyword:
                return jsonify({'success': True, 'filename': output_filename, 'path': output_path})
            return send_file(output_path, as_attachment=True, download_name=output_filename)
        else:
            return jsonify({'error': 'Audio conversion failed'}), 500
            
    except Exception as e:
        logger.error(f"Download/conversion failed: {str(e)}")
        return jsonify({'error': str(e)}), 500

AUDIO_EXTS = ('m4a', 'webm', 'opus', 'ogg', 'mp4', 'mp3')

# 一般書籍最低頁數門檻（過濾預覽頁、登入頁等假 PDF）
MIN_BOOK_PAGES = 50

def validate_pdf_file(path):
    """驗證 PDF 可開啟且頁數達書籍最低標準。"""
    try:
        with open(path, 'rb') as f:
            header = f.read(8)
        if not header.startswith(b'%PDF'):
            return False, 0, '下載內容不是有效的 PDF 檔案（可能是網頁或錯誤頁）'

        from pypdf import PdfReader
        reader = PdfReader(path, strict=False)
        page_count = len(reader.pages)
        if page_count < MIN_BOOK_PAGES:
            return False, page_count, f'PDF 僅有 {page_count} 頁，少於書籍最低頁數（{MIN_BOOK_PAGES} 頁）'
        return True, page_count, None
    except Exception as e:
        return False, 0, f'無法開啟 PDF 檔案：{e}'

def audio_target_dir(video_id, keyword):
    if keyword:
        safe_dir = sanitize_name(keyword)
        target_dir = os.path.join(DOWNLOADS_DIR, safe_dir)
        os.makedirs(target_dir, exist_ok=True)
        return target_dir
    return DOWNLOADS_DIR

def audio_base_name(video_id, title):
    return sanitize_name(title) if title else video_id

def find_existing_audio(video_id, keyword='', title=''):
    target_dir = audio_target_dir(video_id, keyword)
    base = audio_base_name(video_id, title)
    for ext in AUDIO_EXTS:
        path = os.path.join(target_dir, f"{base}.{ext}")
        if os.path.exists(path):
            return path, f"{base}.{ext}"
    return None, None

def download_audio(video_id, cookies_browser, keyword='', title='', progress_queue=None):
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    output_path, output_filename = find_existing_audio(video_id, keyword, title)
    if output_path:
        return output_path, output_filename, None

    target_dir = audio_target_dir(video_id, keyword)
    base = audio_base_name(video_id, title)
    outtmpl = os.path.join(target_dir, f"{base}.%(ext)s")

    def progress_hook(d):
        if progress_queue is None:
            return
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes') or 0
            percent = int(downloaded * 100 / total) if total else 0
            progress_queue.put({'status': 'downloading', 'percent': percent})

    try:
        ydl_opts = get_ydl_opts(cookies_browser, {
            'format': 'bestaudio[ext=m4a]/bestaudio/best',
            'outtmpl': outtmpl,
            'progress_hooks': [progress_hook],
        })

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)

        ext = info.get('ext') or 'm4a'
        output_filename = f"{base}.{ext}"
        output_path = os.path.join(target_dir, output_filename)

        if not os.path.exists(output_path):
            output_path, output_filename = find_existing_audio(video_id, keyword, title)
            if not output_path:
                return None, output_filename, 'Audio download failed'

        return output_path, output_filename, None
    except Exception as e:
        logger.error(f"Audio download failed: {str(e)}")
        return None, f"{base}.m4a", str(e)

@app.route('/api/download-audio-stream', methods=['GET'])
def api_download_audio_stream():
    video_id = request.args.get('id', '').strip()
    cookies_browser = request.args.get('cookies_browser', 'none')
    keyword = request.args.get('keyword', '').strip()
    title = request.args.get('title', '').strip()
    if not video_id:
        return jsonify({'error': 'Video ID is required'}), 400

    def generate():
        progress_queue = queue.Queue()

        def run(progress_queue):
            output_path, output_filename, err = download_audio(
                video_id, cookies_browser, keyword, title, progress_queue
            )
            if err:
                progress_queue.put({'status': 'error', 'message': err})
            elif not os.path.exists(output_path):
                progress_queue.put({'status': 'error', 'message': 'Audio download failed'})
            else:
                progress_queue.put({'status': 'finished', 'filename': output_filename})
            progress_queue.put(None)

        threading.Thread(target=run, args=(progress_queue,), daemon=True).start()

        while True:
            msg = progress_queue.get()
            if msg is None:
                break
            yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/download-audio', methods=['GET'])
def api_download_audio():
    video_id = request.args.get('id', '').strip()
    cookies_browser = request.args.get('cookies_browser', 'none')
    keyword = request.args.get('keyword', '').strip()
    title = request.args.get('title', '').strip()
    if not video_id:
        return jsonify({'error': 'Video ID is required'}), 400

    output_path, output_filename = find_existing_audio(video_id, keyword, title)
    if output_path:
        if keyword:
            return jsonify({'success': True, 'filename': output_filename, 'path': output_path})
        return send_file(output_path, as_attachment=True, download_name=output_filename)

    output_path, output_filename, err = download_audio(video_id, cookies_browser, keyword, title)
    if err:
        return jsonify({'error': err}), 500
    if keyword:
        return jsonify({'success': True, 'filename': output_filename, 'path': output_path})
    return send_file(output_path, as_attachment=True, download_name=output_filename)

def download_pdf_to_path(url, title, keyword, progress_queue=None):
    if not title:
        title = "downloaded_book"
    download_url = resolve_pdf_url(url)
    safe_filename = sanitize_filename(title)
    if keyword:
        safe_dir = sanitize_name(keyword)
        target_dir = os.path.join(DOWNLOADS_DIR, safe_dir)
        os.makedirs(target_dir, exist_ok=True)
        output_path = os.path.join(target_dir, safe_filename)
    else:
        output_path = os.path.join(DOWNLOADS_DIR, safe_filename)

    if os.path.exists(output_path):
        valid, page_count, err = validate_pdf_file(output_path)
        if valid:
            return output_path, safe_filename, None
        os.remove(output_path)

    import urllib.request
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    try:
        req = urllib.request.Request(download_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            total = int(response.headers.get('Content-Length') or 0)
            downloaded = 0
            chunks = []
            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                chunks.append(chunk)
                downloaded += len(chunk)
                if progress_queue is not None and total:
                    progress_queue.put({
                        'status': 'downloading',
                        'percent': int(downloaded * 100 / total),
                    })
            with open(output_path, 'wb') as f:
                f.write(b''.join(chunks))

        if os.path.exists(output_path):
            valid, page_count, err = validate_pdf_file(output_path)
            if valid:
                logger.info(f"PDF validated: {safe_filename} ({page_count} pages)")
                return output_path, safe_filename, None
            os.remove(output_path)
            return None, safe_filename, err
        return None, safe_filename, 'Failed to save downloaded PDF'
    except Exception as e:
        logger.error(f"PDF download failed for {download_url} (original: {url}): {str(e)}")
        return None, safe_filename, str(e)

@app.route('/api/download-pdf-stream', methods=['GET'])
def api_download_pdf_stream():
    url = request.args.get('url', '').strip()
    title = request.args.get('title', '').strip()
    keyword = request.args.get('keyword', '').strip()
    if not url:
        return jsonify({'error': 'URL is required'}), 400

    def generate():
        progress_queue = queue.Queue()

        def run(progress_queue):
            output_path, output_filename, err = download_pdf_to_path(url, title, keyword, progress_queue)
            if err:
                progress_queue.put({'status': 'error', 'message': err})
            elif not os.path.exists(output_path):
                progress_queue.put({'status': 'error', 'message': 'Failed to save downloaded PDF'})
            else:
                progress_queue.put({'status': 'finished', 'filename': output_filename})
            progress_queue.put(None)

        threading.Thread(target=run, args=(progress_queue,), daemon=True).start()

        while True:
            msg = progress_queue.get()
            if msg is None:
                break
            yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

def sanitize_name(name):
    import re
    # Remove characters that are unsafe for filenames
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = cleaned.strip()
    return cleaned


def sanitize_filename(name):
    import re
    # Remove characters that are unsafe for filenames
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    cleaned = cleaned.strip()
    if not cleaned:
        cleaned = "downloaded_book"
    if not cleaned.lower().endswith('.pdf'):
        cleaned += '.pdf'
    return cleaned

def resolve_pdf_url(url):
    import urllib.parse
    import re
    try:
        parsed = urllib.parse.urlparse(url)
        domain = parsed.netloc.lower()
        path = parsed.path
        
        # 1. Google Drive
        if 'drive.google.com' in domain:
            match = re.search(r'/d/([a-zA-Z0-9_-]+)', path)
            if match:
                doc_id = match.group(1)
                return f"https://drive.google.com/uc?export=download&id={doc_id}"
                
        # 2. Archive.org
        if 'archive.org' in domain:
            if '/details/' in path:
                item_id = path.split('/details/')[-1].strip('/')
                return f"https://archive.org/download/{item_id}/{item_id}.pdf"
                
        # 3. GitHub
        if 'github.com' in domain:
            if '/blob/' in path:
                return url.replace('/blob/', '/raw/')
    except Exception as e:
        logger.error(f"Error resolving URL {url}: {str(e)}")
    return url

def search_pdfs(query):
    import urllib.request
    import urllib.parse
    import re
    import html
    
    # Use standard search by adding "pdf" instead of "filetype:pdf" to get same results as browser
    full_query = f"{query} pdf"
    encoded_query = urllib.parse.quote_plus(full_query)
    url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            html_content = response.read().decode('utf-8')
            
        results = []
        matches = re.finditer(r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html_content, re.DOTALL)
        for match in matches:
            link = match.group(1)
            title_html = match.group(2)
            
            title = re.sub(r'<span[^>]*>.*?</span>', '', title_html, flags=re.DOTALL)
            title = re.sub(r'<[^>]+>', '', title)
            title = html.unescape(title).strip()
            
            real_url = link
            if 'uddg=' in link:
                parsed_url = urllib.parse.urlparse(link)
                query_params = urllib.parse.parse_qs(parsed_url.query)
                if 'uddg' in query_params:
                    real_url = query_params['uddg'][0]
            
            domain = urllib.parse.urlparse(real_url).netloc
            results.append({
                'title': title,
                'url': real_url,
                'domain': domain
            })
        return results
    except Exception as e:
        logger.error(f"Error crawling PDFs: {str(e)}")
        return []

@app.route('/api/search-pdf', methods=['GET'])
def api_search_pdf():
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify({'error': 'Search query is required'}), 400
    
    results = search_pdfs(query)
    return jsonify({
        'success': True,
        'count': len(results),
        'results': results
    })

@app.route('/api/download-pdf', methods=['GET'])
def api_download_pdf():
    url = request.args.get('url', '').strip()
    title = request.args.get('title', '').strip()
    keyword = request.args.get('keyword', '').strip()
    
    if not url:
        return jsonify({'error': 'URL is required'}), 400
        
    if not title:
        title = "downloaded_book"
        
    # Resolve Drive, Archive, and GitHub URLs to direct download links
    download_url = resolve_pdf_url(url)
    
    safe_filename = sanitize_filename(title)
    if keyword:
        safe_dir = sanitize_name(keyword)
        target_dir = os.path.join(DOWNLOADS_DIR, safe_dir)
        os.makedirs(target_dir, exist_ok=True)
        output_path = os.path.join(target_dir, safe_filename)
    else:
        output_path = os.path.join(DOWNLOADS_DIR, safe_filename)
    
    # Return directly if cached and still valid
    if os.path.exists(output_path):
        valid, page_count, err = validate_pdf_file(output_path)
        if valid:
            if keyword:
                return jsonify({'success': True, 'filename': safe_filename, 'path': output_path, 'pages': page_count})
            return send_file(output_path, as_attachment=True, download_name=safe_filename)
        os.remove(output_path)
        
    try:
        import urllib.request
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
        
        req = urllib.request.Request(download_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            # Verify we got a PDF or valid content (if it's html page, might fail but let's write what we got)
            content = response.read()
            with open(output_path, 'wb') as f:
                f.write(content)
                
        if os.path.exists(output_path):
            valid, page_count, err = validate_pdf_file(output_path)
            if valid:
                logger.info(f"PDF validated: {safe_filename} ({page_count} pages)")
                if keyword:
                    return jsonify({'success': True, 'filename': safe_filename, 'path': output_path, 'pages': page_count})
                return send_file(output_path, as_attachment=True, download_name=safe_filename)
            os.remove(output_path)
            return jsonify({'error': err}), 422
        else:
            return jsonify({'error': 'Failed to save downloaded PDF'}), 500
            
    except Exception as e:
        logger.error(f"PDF download failed for {download_url} (original: {url}): {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/create-folder', methods=['POST'])
def api_create_folder():
    data = request.get_json() or {}
    keyword = data.get('keyword', '').strip()
    if not keyword:
        return jsonify({'error': 'Keyword is required'}), 400
    safe_dir = sanitize_name(keyword)
    target_dir = os.path.join(DOWNLOADS_DIR, safe_dir)
    os.makedirs(target_dir, exist_ok=True)
    return jsonify({'success': True, 'path': target_dir})

@app.route('/api/save-urls', methods=['POST'])
def api_save_urls():
    data = request.get_json() or {}
    keyword = data.get('keyword', '').strip()
    urls = data.get('urls', [])
    if not keyword:
        return jsonify({'error': 'Keyword is required'}), 400
        
    safe_dir = sanitize_name(keyword)
    target_dir = os.path.join(DOWNLOADS_DIR, safe_dir)
    os.makedirs(target_dir, exist_ok=True)
    
    filename = f"{safe_dir}_yt-url.txt"
    file_path = os.path.join(target_dir, filename)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(urls) + '\n')
    return jsonify({'success': True, 'filename': filename, 'path': file_path})


_cached_video_encoder = None
_cached_audio_encoders = {}

def detect_best_video_encoder():
    global _cached_video_encoder
    if _cached_video_encoder is not None:
        return _cached_video_encoder
        
    import subprocess
    import os
    
    # We will try to encode a 1-frame dummy video
    encoders_to_test = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_mf']
    
    for encoder in encoders_to_test:
        test_cmd = [
            'ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=0.04',
            '-c:v', encoder, '-f', 'null', '-'
        ]
        try:
            res = subprocess.run(
                test_cmd, 
                capture_output=True, 
                creationflags=0x08000000 if os.name == 'nt' else 0
            )
            if res.returncode == 0:
                logger.info(f"偵測到 GPU 加速影片編碼器: {encoder}")
                _cached_video_encoder = encoder
                return encoder
        except Exception:
            pass
            
    logger.info("未偵測到相容的 GPU 加速影片編碼器，使用 CPU (libx264)")
    _cached_video_encoder = 'libx264'
    return 'libx264'


def check_audio_encoder_available(encoder_name):
    global _cached_audio_encoders
    if encoder_name in _cached_audio_encoders:
        return _cached_audio_encoders[encoder_name]
    import subprocess
    import os
    try:
        test_cmd = ['ffmpeg', '-y', '-f', 'lavfi', '-i', 'sine=d=0.1', '-c:a', encoder_name, '-f', 'null', '-']
        res = subprocess.run(test_cmd, capture_output=True, creationflags=0x08000000 if os.name == 'nt' else 0)
        available = (res.returncode == 0)
    except Exception:
        available = False
    _cached_audio_encoders[encoder_name] = available
    return available


def extract_and_constrain_audio(input_path, output_dir, target_format="auto", max_size_mb=None, use_gpu=True):
    import subprocess
    import json
    import os
    
    probe_cmd = [
        'ffprobe', '-v', 'error', 
        '-show_format', '-show_streams', 
        '-of', 'json', input_path
    ]
    res = subprocess.run(probe_cmd, capture_output=True, text=True, encoding='utf-8', creationflags=0x08000000 if os.name == 'nt' else 0)
    if res.returncode != 0:
        raise Exception(f"無法讀取影片資訊: {res.stderr}")
        
    info = json.loads(res.stdout)
    
    audio_stream = None
    for stream in info.get('streams', []):
        if stream.get('codec_type') == 'audio':
            audio_stream = stream
            break
            
    if not audio_stream:
        raise Exception("該影片檔中未偵測到任何音軌。")
        
    codec = audio_stream.get('codec_name', '').lower()
    duration_str = audio_stream.get('duration') or info.get('format', {}).get('duration')
    if not duration_str:
        raise Exception("無法偵測音軌長度。")
    duration = float(duration_str)
    
    if 'pcm' in codec or codec == 'wav':
        native_ext = 'wav'
    elif codec == 'mp3':
        native_ext = 'mp3'
    elif codec in ('aac', 'm4a'):
        native_ext = 'm4a'
    else:
        native_ext = 'mp3'
        
    if target_format == 'auto':
        if native_ext in ('mp3', 'wav', 'm4a'):
            final_format = native_ext
        else:
            final_format = 'mp3'
    else:
        final_format = target_format
        
    do_transcode = False
    target_bitrate_kbps = None
    
    if max_size_mb and max_size_mb > 0:
        max_bytes = max_size_mb * 1024 * 1024
        
        if final_format == 'wav':
            sample_rate = int(audio_stream.get('sample_rate', 44100))
            channels = int(audio_stream.get('channels', 2))
            estimated_wav_size = sample_rate * channels * 2 * duration
            
            if estimated_wav_size > max_bytes:
                downsampled_size = 16000 * 1 * 2 * duration
                if downsampled_size <= max_bytes:
                    do_transcode = True
                else:
                    final_format = 'mp3'
                    do_transcode = True
                    
        if final_format in ('mp3', 'm4a'):
            native_bitrate = int(audio_stream.get('bit_rate') or info.get('format', {}).get('bit_rate') or 128000)
            estimated_size = (native_bitrate / 8) * duration
            
            allowed_bitrate_bps = (max_bytes * 8) / duration
            allowed_kbps = int(allowed_bitrate_bps / 1000)
            
            if estimated_size > max_bytes or native_ext != final_format:
                do_transcode = True
                target_bitrate_kbps = min(320, max(32, allowed_kbps))
    else:
        if final_format != native_ext:
            do_transcode = True
            
    import uuid
    out_filename = f"extracted_{uuid.uuid4().hex}.{final_format}"
    out_path = os.path.join(output_dir, out_filename)
    
    # Check GPU encoders if requested
    use_audio_gpu = False
    if use_gpu:
        # Check if MF encoders are supported
        if final_format == 'm4a' and check_audio_encoder_available('aac_mf'):
            use_audio_gpu = True
        elif final_format == 'mp3' and check_audio_encoder_available('mp3_mf'):
            use_audio_gpu = True
            
    if not do_transcode:
        cmd = ['ffmpeg', '-y', '-i', input_path, '-vn', '-c:a', 'copy', out_path]
    else:
        cmd = ['ffmpeg', '-y', '-i', input_path, '-vn']
        if final_format == 'mp3':
            if use_audio_gpu:
                cmd.extend(['-c:a', 'mp3_mf'])
            else:
                cmd.extend(['-c:a', 'libmp3lame'])
            if target_bitrate_kbps:
                cmd.extend(['-b:a', f'{target_bitrate_kbps}k'])
                if target_bitrate_kbps < 64:
                    cmd.extend(['-ac', '1'])
            else:
                cmd.extend(['-b:a', '128k'])
        elif final_format == 'wav':
            if max_size_mb and max_size_mb > 0:
                cmd.extend(['-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1'])
            else:
                cmd.extend(['-c:a', 'pcm_s16le'])
        elif final_format == 'm4a':
            if use_audio_gpu:
                cmd.extend(['-c:a', 'aac_mf'])
            else:
                cmd.extend(['-c:a', 'aac'])
            if target_bitrate_kbps:
                cmd.extend(['-b:a', f'{target_bitrate_kbps}k'])
            else:
                cmd.extend(['-b:a', '128k'])
        cmd.append(out_path)
        
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', creationflags=0x08000000 if os.name == 'nt' else 0)
    if res.returncode != 0:
        raise Exception(f"音訊萃取失敗: {res.stderr}")
        
    return out_path, final_format, os.path.getsize(out_path)


@app.route('/api/extract-audio', methods=['POST'])
def api_extract_audio():
    if 'file' not in request.files:
        return jsonify({'error': '未提供檔案'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '未選擇檔案'}), 400
        
    target_format = request.form.get('target_format', 'auto')
    max_size_mb_str = request.form.get('max_size_mb', 'none')
    use_gpu = request.form.get('use_gpu', 'true').lower() == 'true'
    
    max_size_mb = None
    if max_size_mb_str != 'none':
        try:
            max_size_mb = float(max_size_mb_str)
        except ValueError:
            pass
            
    import uuid
    temp_filename = f"upload_{uuid.uuid4().hex}.mp4"
    temp_dir = os.path.join(DOWNLOADS_DIR, 'temp_upload')
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, temp_filename)
    
    try:
        file.save(temp_path)
        
        out_path, final_format, file_size = extract_and_constrain_audio(temp_path, temp_dir, target_format, max_size_mb, use_gpu)
        
        original_name, _ = os.path.splitext(file.filename)
        download_name = f"{original_name}_extracted.{final_format}"
        
        with open(out_path, 'rb') as f:
            data = f.read()
            
        try:
            os.remove(temp_path)
            os.remove(out_path)
        except Exception as cleanup_err:
            logger.warning(f"清理暫存檔失敗: {cleanup_err}")
            
        from io import BytesIO
        return send_file(
            BytesIO(data),
            as_attachment=True,
            download_name=download_name,
            mimetype=f'audio/{final_format}' if final_format != 'm4a' else 'audio/mp4'
        )
        
    except Exception as e:
        logger.error(f"萃取音訊出錯: {str(e)}")
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass
        return jsonify({'error': str(e)}), 500


@app.route('/api/gpu-status', methods=['GET'])
def api_gpu_status():
    encoder = detect_best_video_encoder()
    has_gpu = (encoder != 'libx264')
    return jsonify({
        'gpu_available': has_gpu,
        'encoder': encoder
    })


def compress_video_file(input_path, output_dir, max_size_mb=190, use_gpu=True, mode="ai_optimal"):
    import subprocess
    import json
    import os
    import uuid
    
    probe_cmd = [
        'ffprobe', '-v', 'error', 
        '-show_format', '-show_streams', 
        '-of', 'json', input_path
    ]
    res = subprocess.run(probe_cmd, capture_output=True, text=True, encoding='utf-8', creationflags=0x08000000 if os.name == 'nt' else 0)
    if res.returncode != 0:
        raise Exception(f"無法讀取影片資訊: {res.stderr}")
    info = json.loads(res.stdout)
    
    duration_str = info.get('format', {}).get('duration')
    if not duration_str:
        for s in info.get('streams', []):
            if s.get('duration'):
                duration_str = s.get('duration')
                break
    if not duration_str:
        raise Exception("無法偵測影片長度。")
    duration = float(duration_str)
    
    # Calculate bitrates to guarantee it stays strictly under the limit
    target_bytes = max_size_mb * 1024 * 1024
    target_bitrate_bps = (target_bytes * 8) / duration
    
    audio_bitrate_bps = 128000
    if target_bitrate_bps < 256000:
        audio_bitrate_bps = 64000
        
    video_bitrate_bps = target_bitrate_bps - audio_bitrate_bps
    if video_bitrate_bps < 100000:
        video_bitrate_bps = 100000
        
    encoder = 'libx264'
    audio_encoder = 'aac'
    
    if use_gpu:
        best_gpu_enc = detect_best_video_encoder()
        if best_gpu_enc != 'libx264':
            encoder = best_gpu_enc
            if check_audio_encoder_available('aac_mf'):
                audio_encoder = 'aac_mf'
                
    out_filename = f"compressed_{uuid.uuid4().hex}.mp4"
    out_path = os.path.join(output_dir, out_filename)
    
    vf_filters = []
    r_fps = "24"
    
    if mode == "ai_optimal":
        if video_bitrate_bps < 400000:
            vf_filters.append("scale='min(854,iw)':-2")
            r_fps = "15"
        else:
            vf_filters.append("scale='min(1280,iw)':-2")
            r_fps = "24"
    else:
        vf_filters.append("scale='min(1920,iw)':-2")
        r_fps = "30"
        
    cmd = ['ffmpeg', '-y', '-i', input_path]
    cmd.extend(['-c:v', encoder])
    
    if encoder == 'libx264':
        cmd.extend(['-preset', 'medium', '-pix_fmt', 'yuv420p'])
    elif encoder == 'h264_nvenc':
        cmd.extend(['-preset', 'p4', '-pix_fmt', 'yuv420p'])
    elif encoder == 'h264_mf':
        cmd.extend(['-pix_fmt', 'yuv420p'])
    elif encoder == 'h264_amf':
        cmd.extend(['-pix_fmt', 'yuv420p'])
    elif encoder == 'h264_qsv':
        cmd.extend(['-pix_fmt', 'yuv420p'])
        
    cmd.extend(['-b:v', f'{int(video_bitrate_bps)}'])
    
    if vf_filters:
        cmd.extend(['-vf', ','.join(vf_filters)])
    cmd.extend(['-r', r_fps])
    
    cmd.extend(['-c:a', audio_encoder, '-b:a', f'{int(audio_bitrate_bps)}'])
    cmd.append(out_path)
    
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', creationflags=0x08000000 if os.name == 'nt' else 0)
    if res.returncode != 0:
        raise Exception(f"影片壓縮失敗: {res.stderr}")
        
    return out_path, os.path.getsize(out_path)


@app.route('/api/compress-video', methods=['POST'])
def api_compress_video():
    if 'file' not in request.files:
        return jsonify({'error': '未提供檔案'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '未選擇檔案'}), 400
        
    mode = request.form.get('mode', 'ai_optimal')
    use_gpu = request.form.get('use_gpu', 'true').lower() == 'true'
    
    # We strictly enforce under 200MB, so target 190MB limit as safe ceiling
    max_size_mb = 190.0
    
    import uuid
    temp_filename = f"upload_{uuid.uuid4().hex}.mp4"
    temp_dir = os.path.join(DOWNLOADS_DIR, 'temp_upload')
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, temp_filename)
    
    try:
        file.save(temp_path)
        
        out_path, file_size = compress_video_file(temp_path, temp_dir, max_size_mb, use_gpu, mode)
        
        original_name, _ = os.path.splitext(file.filename)
        download_name = f"{original_name}_compressed.mp4"
        
        with open(out_path, 'rb') as f:
            data = f.read()
            
        try:
            os.remove(temp_path)
            os.remove(out_path)
        except Exception as cleanup_err:
            logger.warning(f"清理暫存檔失敗: {cleanup_err}")
            
        from io import BytesIO
        return send_file(
            BytesIO(data),
            as_attachment=True,
            download_name=download_name,
            mimetype='video/mp4'
        )
        
        
    except Exception as e:
        logger.error(f"壓縮影片出錯: {str(e)}")
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass
        return jsonify({'error': str(e)}), 500


def get_video_duration(input_path):
    import subprocess
    import json
    probe_cmd = [
        'ffprobe', '-v', 'error', 
        '-show_format', '-show_streams', 
        '-of', 'json', input_path
    ]
    try:
        res = subprocess.run(probe_cmd, capture_output=True, text=True, encoding='utf-8', creationflags=0x08000000 if os.name == 'nt' else 0)
        if res.returncode == 0:
            info = json.loads(res.stdout)
            duration_str = info.get('format', {}).get('duration')
            if not duration_str:
                for s in info.get('streams', []):
                    if s.get('duration'):
                        duration_str = s.get('duration')
                        break
            if duration_str:
                return float(duration_str)
    except Exception:
        pass
    return None

@app.route('/api/upload', methods=['POST'])
def api_upload():
    if 'file' not in request.files:
        return jsonify({'error': '未提供檔案'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '未選擇檔案'}), 400
    
    import uuid
    ext = os.path.splitext(file.filename)[1].lower()
    temp_filename = f"upload_{uuid.uuid4().hex}{ext}"
    temp_dir = os.path.join(DOWNLOADS_DIR, 'temp_upload')
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, temp_filename)
    
    file.save(temp_path)
    return jsonify({
        'success': True,
        'temp_path': temp_path,
        'filename': file.filename
    })

@app.route('/api/compress-video-stream', methods=['GET'])
def api_compress_video_stream():
    temp_path = request.args.get('temp_path', '').strip()
    mode = request.args.get('mode', 'ai_optimal')
    use_gpu = request.args.get('use_gpu', 'true').lower() == 'true'
    
    if not temp_path or not os.path.exists(temp_path):
        return Response("data: " + json.dumps({'status': 'error', 'message': '檔案不存在'}, ensure_ascii=False) + "\n\n", mimetype='text/event-stream')
        
    def generate():
        import subprocess
        import json
        import uuid
        
        duration = get_video_duration(temp_path)
        if not duration:
            yield f"data: {json.dumps({'status': 'error', 'message': '無法讀取影片長度資訊'})}\n\n"
            return
            
        max_size_mb = 190.0
        target_bytes = max_size_mb * 1024 * 1024
        target_bitrate_bps = (target_bytes * 8) / duration
        
        audio_bitrate_bps = 128000
        if target_bitrate_bps < 256000:
            audio_bitrate_bps = 64000
            
        video_bitrate_bps = target_bitrate_bps - audio_bitrate_bps
        if video_bitrate_bps < 100000:
            video_bitrate_bps = 100000
            
        encoder = 'libx264'
        audio_encoder = 'aac'
        
        if use_gpu:
            best_gpu_enc = detect_best_video_encoder()
            if best_gpu_enc != 'libx264':
                encoder = best_gpu_enc
                if check_audio_encoder_available('aac_mf'):
                    audio_encoder = 'aac_mf'
                    
        temp_dir = os.path.dirname(temp_path)
        out_filename = f"compressed_{uuid.uuid4().hex}.mp4"
        out_path = os.path.join(temp_dir, out_filename)
        
        vf_filters = []
        r_fps = "24"
        
        if mode == "ai_optimal":
            if video_bitrate_bps < 400000:
                vf_filters.append("scale='min(854,iw)':-2")
                r_fps = "15"
            else:
                vf_filters.append("scale='min(1280,iw)':-2")
                r_fps = "24"
        else:
            vf_filters.append("scale='min(1920,iw)':-2")
            r_fps = "30"
            
        cmd = ['ffmpeg', '-y', '-progress', '-', '-i', temp_path]
        cmd.extend(['-c:v', encoder])
        
        if encoder == 'libx264':
            cmd.extend(['-preset', 'medium', '-pix_fmt', 'yuv420p'])
        elif encoder == 'h264_nvenc':
            cmd.extend(['-preset', 'p4', '-pix_fmt', 'yuv420p'])
        elif encoder == 'h264_mf':
            cmd.extend(['-pix_fmt', 'yuv420p'])
        elif encoder == 'h264_amf':
            cmd.extend(['-pix_fmt', 'yuv420p'])
        elif encoder == 'h264_qsv':
            cmd.extend(['-pix_fmt', 'yuv420p'])
            
        cmd.extend(['-b:v', f'{int(video_bitrate_bps)}'])
        
        if vf_filters:
            cmd.extend(['-vf', ','.join(vf_filters)])
        cmd.extend(['-r', r_fps])
        
        cmd.extend(['-c:a', audio_encoder, '-b:a', f'{int(audio_bitrate_bps)}'])
        cmd.append(out_path)
        
        try:
            process = subprocess.Popen(
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.DEVNULL, 
                text=True, 
                encoding='utf-8', 
                creationflags=0x08000000 if os.name == 'nt' else 0
            )
            
            last_percent = 0
            yield f"data: {json.dumps({'status': 'processing', 'percent': 0})}\n\n"
            
            while True:
                line = process.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if line.startswith('out_time_us='):
                    try:
                       us = int(line.split('=')[1])
                       percent = int(us / (duration * 1000000) * 100)
                       percent = min(99, max(0, percent))
                       if percent > last_percent:
                           last_percent = percent
                           yield f"data: {json.dumps({'status': 'processing', 'percent': percent})}\n\n"
                    except Exception:
                        pass
                        
            process.wait()
            
            if process.returncode != 0:
                yield f"data: {json.dumps({'status': 'error', 'message': 'FFmpeg 執行錯誤'})}\n\n"
            else:
                try:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                except Exception as cleanup_err:
                    logger.warning(f"清理壓縮前原檔失敗 {temp_path}: {cleanup_err}")
                    
                yield f"data: {json.dumps({'status': 'finished', 'percent': 100, 'path': out_path, 'filename': out_filename})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"
            
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/extract-audio-stream', methods=['GET'])
def api_extract_audio_stream():
    temp_path = request.args.get('temp_path', '').strip()
    target_format = request.args.get('target_format', 'auto')
    max_size_mb_str = request.args.get('max_size_mb', 'none')
    use_gpu = request.args.get('use_gpu', 'true').lower() == 'true'
    
    max_size_mb = None
    if max_size_mb_str != 'none':
        try:
            max_size_mb = float(max_size_mb_str)
        except ValueError:
            pass
            
    if not temp_path or not os.path.exists(temp_path):
        return Response("data: " + json.dumps({'status': 'error', 'message': '檔案不存在'}, ensure_ascii=False) + "\n\n", mimetype='text/event-stream')
        
    def generate():
        import subprocess
        import json
        import uuid
        
        probe_cmd = [
            'ffprobe', '-v', 'error', 
            '-show_format', '-show_streams', 
            '-of', 'json', temp_path
        ]
        res = subprocess.run(probe_cmd, capture_output=True, text=True, encoding='utf-8', creationflags=0x08000000 if os.name == 'nt' else 0)
        if res.returncode != 0:
            yield f"data: {json.dumps({'status': 'error', 'message': '無法讀取影片資訊'})}\n\n"
            return
            
        info = json.loads(res.stdout)
        
        audio_stream = None
        for stream in info.get('streams', []):
            if stream.get('codec_type') == 'audio':
                audio_stream = stream
                break
                
        if not audio_stream:
            yield f"data: {json.dumps({'status': 'error', 'message': '該影片檔中未偵測到任何音軌。'})}\n\n"
            return
            
        codec = audio_stream.get('codec_name', '').lower()
        duration_str = audio_stream.get('duration') or info.get('format', {}).get('duration')
        if not duration_str:
            yield f"data: {json.dumps({'status': 'error', 'message': '無法偵測音軌長度。'})}\n\n"
            return
        duration = float(duration_str)
        
        if 'pcm' in codec or codec == 'wav':
            native_ext = 'wav'
        elif codec == 'mp3':
            native_ext = 'mp3'
        elif codec in ('aac', 'm4a'):
            native_ext = 'm4a'
        else:
            native_ext = 'mp3'
            
        if target_format == 'auto':
            if native_ext in ('mp3', 'wav', 'm4a'):
                final_format = native_ext
            else:
                final_format = 'mp3'
        else:
            final_format = target_format
            
        do_transcode = False
        target_bitrate_kbps = None
        
        if max_size_mb and max_size_mb > 0:
            max_bytes = max_size_mb * 1024 * 1024
            
            if final_format == 'wav':
                sample_rate = int(audio_stream.get('sample_rate', 44100))
                channels = int(audio_stream.get('channels', 2))
                estimated_wav_size = sample_rate * channels * 2 * duration
                
                if estimated_wav_size > max_bytes:
                    downsampled_size = 16000 * 1 * 2 * duration
                    if downsampled_size <= max_bytes:
                        do_transcode = True
                    else:
                        final_format = 'mp3'
                        do_transcode = True
                        
            if final_format in ('mp3', 'm4a'):
                native_bitrate = int(audio_stream.get('bit_rate') or info.get('format', {}).get('bit_rate') or 128000)
                estimated_size = (native_bitrate / 8) * duration
                
                allowed_bitrate_bps = (max_bytes * 8) / duration
                allowed_kbps = int(allowed_bitrate_bps / 1000)
                
                if estimated_size > max_bytes or native_ext != final_format:
                    do_transcode = True
                    target_bitrate_kbps = min(320, max(32, allowed_kbps))
        else:
            if final_format != native_ext:
                do_transcode = True
                
        temp_dir = os.path.dirname(temp_path)
        out_filename = f"extracted_{uuid.uuid4().hex}.{final_format}"
        out_path = os.path.join(temp_dir, out_filename)
        
        use_audio_gpu = False
        if use_gpu:
            if final_format == 'm4a' and check_audio_encoder_available('aac_mf'):
                use_audio_gpu = True
            elif final_format == 'mp3' and check_audio_encoder_available('mp3_mf'):
                use_audio_gpu = True
                
        if not do_transcode:
            cmd = ['ffmpeg', '-y', '-progress', '-', '-i', temp_path, '-vn', '-c:a', 'copy', out_path]
        else:
            cmd = ['ffmpeg', '-y', '-progress', '-', '-i', temp_path, '-vn']
            if final_format == 'mp3':
                if use_audio_gpu:
                    cmd.extend(['-c:a', 'mp3_mf'])
                else:
                    cmd.extend(['-c:a', 'libmp3lame'])
                if target_bitrate_kbps:
                    cmd.extend(['-b:a', f'{target_bitrate_kbps}k'])
                    if target_bitrate_kbps < 64:
                        cmd.extend(['-ac', '1'])
                else:
                    cmd.extend(['-b:a', '128k'])
            elif final_format == 'wav':
                if max_size_mb and max_size_mb > 0:
                    cmd.extend(['-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1'])
                else:
                    cmd.extend(['-c:a', 'pcm_s16le'])
            elif final_format == 'm4a':
                if use_audio_gpu:
                    cmd.extend(['-c:a', 'aac_mf'])
                else:
                    cmd.extend(['-c:a', 'aac'])
                if target_bitrate_kbps:
                    cmd.extend(['-b:a', f'{target_bitrate_kbps}k'])
                else:
                    cmd.extend(['-b:a', '128k'])
            cmd.append(out_path)
            
        try:
            process = subprocess.Popen(
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.DEVNULL, 
                text=True, 
                encoding='utf-8', 
                creationflags=0x08000000 if os.name == 'nt' else 0
            )
            
            last_percent = 0
            yield f"data: {json.dumps({'status': 'processing', 'percent': 0})}\n\n"
            
            while True:
                line = process.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if line.startswith('out_time_us='):
                    try:
                       us = int(line.split('=')[1])
                       percent = int(us / (duration * 1000000) * 100)
                       percent = min(99, max(0, percent))
                       if percent > last_percent:
                           last_percent = percent
                           yield f"data: {json.dumps({'status': 'processing', 'percent': percent})}\n\n"
                    except Exception:
                        pass
                        
            process.wait()
            
            if process.returncode != 0:
                yield f"data: {json.dumps({'status': 'error', 'message': 'FFmpeg 執行錯誤'})}\n\n"
            else:
                try:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
                except Exception as cleanup_err:
                    logger.warning(f"清理萃取前原檔失敗 {temp_path}: {cleanup_err}")
                    
                yield f"data: {json.dumps({'status': 'finished', 'percent': 100, 'path': out_path, 'filename': out_filename, 'final_format': final_format})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"
            
    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/download-processed', methods=['GET'])
def api_download_processed():
    path = request.args.get('path', '').strip()
    download_name = request.args.get('download_name', '').strip()
    mimetype = request.args.get('mimetype', 'application/octet-stream').strip()
    
    import urllib.parse
    if not path or not os.path.exists(path):
        return jsonify({'error': '檔案不存在'}), 404
        
    def generate_and_cleanup(filepath):
        try:
            with open(filepath, 'rb') as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            try:
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception as e:
                logger.warning(f"清理處理後檔案失敗 {filepath}: {e}")
                
    return Response(
        stream_with_context(generate_and_cleanup(path)),
        mimetype=mimetype,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{urllib.parse.quote(download_name)}"}
    )


@app.route('/api/convert-word-folder-stream', methods=['GET'])
def api_convert_word_folder_stream():
    folder_path = request.args.get('folder_path', '').strip()
    if not folder_path:
        return Response("data: " + json.dumps({'status': 'error', 'message': '請提供資料夾路徑'}, ensure_ascii=False) + "\n\n", mimetype='text/event-stream')

    if not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        return Response("data: " + json.dumps({'status': 'error', 'message': '指定的資料夾不存在或不是目錄'}, ensure_ascii=False) + "\n\n", mimetype='text/event-stream')

    def generate():
        import shutil
        import mammoth
        from markdownify import markdownify

        dest_dir = folder_path.rstrip('\\/') + "_converted"
        yield f"data: {json.dumps({'status': 'start', 'message': f'開始轉換資料夾，目標：{dest_dir}', 'dest_dir': dest_dir}, ensure_ascii=False)}\n\n"
        
        try:
            os.makedirs(dest_dir, exist_ok=True)
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': f'無法建立目標資料夾：{str(e)}'}, ensure_ascii=False)}\n\n"
            return

        # Scan folder recursively
        all_files = []
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                if file.startswith("~$"):  # Skip Word temp files
                    continue
                full_path = os.path.join(root, file)
                all_files.append(full_path)

        total_files = len(all_files)
        yield f"data: {json.dumps({'status': 'scanned', 'total': total_files, 'message': f'偵測到 {total_files} 個檔案（排除 Word 暫存檔）'}, ensure_ascii=False)}\n\n"

        converted_count = 0
        copied_count = 0
        failed_files = []

        for idx, src_file in enumerate(all_files):
            rel_path = os.path.relpath(src_file, folder_path)
            
            # Determine if it is a Word file to be converted
            if rel_path.lower().endswith('.docx'):
                base, _ = os.path.splitext(rel_path)
                dest_rel = base + ".md"
                is_convert = True
            else:
                dest_rel = rel_path
                is_convert = False

            dest_file = os.path.join(dest_dir, dest_rel)
            
            # Ensure subdirectory exists
            os.makedirs(os.path.dirname(dest_file), exist_ok=True)

            percent = int((idx + 1) * 100 / total_files) if total_files > 0 else 100
            
            if is_convert:
                yield f"data: {json.dumps({'status': 'processing', 'rel_path': rel_path, 'action': 'convert', 'percent': percent, 'message': f'正在轉換 ({idx+1}/{total_files}): {rel_path}'}, ensure_ascii=False)}\n\n"
                
                try:
                    with open(src_file, "rb") as docx_f:
                        result = mammoth.convert_to_html(docx_f)
                        html = result.value
                    
                    md_content = markdownify(html)
                    
                    with open(dest_file, "w", encoding="utf-8") as md_f:
                        md_f.write(md_content)
                    
                    converted_count += 1
                except Exception as e:
                    logger.error(f"Failed to convert {rel_path}: {e}")
                    failed_files.append({'file': rel_path, 'error': str(e)})
                    # Fallback copy docx if convert fails (to ensure other files are retained)
                    try:
                        shutil.copy2(src_file, os.path.join(dest_dir, rel_path))
                        copied_count += 1
                        yield f"data: {json.dumps({'status': 'warning', 'rel_path': rel_path, 'message': f'⚠️ 轉換失敗 ({str(e)})，已複製原檔作備份'}, ensure_ascii=False)}\n\n"
                    except Exception as copy_err:
                        yield f"data: {json.dumps({'status': 'warning', 'rel_path': rel_path, 'message': f'❌ 轉換與複製皆失敗：{str(copy_err)}'}, ensure_ascii=False)}\n\n"
            else:
                yield f"data: {json.dumps({'status': 'processing', 'rel_path': rel_path, 'action': 'copy', 'percent': percent, 'message': f'正在複製 ({idx+1}/{total_files}): {rel_path}'}, ensure_ascii=False)}\n\n"
                
                try:
                    shutil.copy2(src_file, dest_file)
                    copied_count += 1
                except Exception as e:
                    logger.error(f"Failed to copy {rel_path}: {e}")
                    failed_files.append({'file': rel_path, 'error': str(e)})
                    yield f"data: {json.dumps({'status': 'warning', 'rel_path': rel_path, 'message': f'⚠️ 複製失敗：{str(e)}'}, ensure_ascii=False)}\n\n"

        # Final summary
        summary = {
            'status': 'finished',
            'total': total_files,
            'converted': converted_count,
            'copied': copied_count,
            'failed_count': len(failed_files),
            'failed_files': failed_files,
            'dest_dir': dest_dir,
            'message': f'轉換結束！共處理 {total_files} 個檔案。轉換 Word：{converted_count}，複製其餘：{copied_count}，失敗：{len(failed_files)}。'
        }
        yield f"data: {json.dumps(summary, ensure_ascii=False)}\n\n"

def compress_single_image(filepath, max_edge=1568, quality=85, convert_png_to_jpeg=False):
    from PIL import Image
    import os
    
    original_size = os.path.getsize(filepath)
    img = Image.open(filepath)
    
    orig_format = img.format or 'JPEG'
    ext = os.path.splitext(filepath)[1].lower()
    
    should_convert_to_jpeg = False
    if convert_png_to_jpeg and ext in ('.png', '.bmp', '.tiff'):
        should_convert_to_jpeg = True
        
    w, h = img.size
    
    resized = False
    if w > max_edge or h > max_edge:
        if w > h:
            new_w = max_edge
            new_h = int(h * (max_edge / w))
        else:
            new_h = max_edge
            new_w = int(w * (max_edge / h))
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        resized = True
        
    target_path = filepath
    if should_convert_to_jpeg:
        target_path = os.path.splitext(filepath)[0] + '.jpg'
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            background = Image.new('RGB', img.size, (255, 255, 255))
            # If PNG has alpha channel, use it as mask, otherwise convert and paste
            if 'A' in img.mode:
                background.paste(img, mask=img.split()[3])
            else:
                background.paste(img.convert('RGBA'), mask=img.convert('RGBA').split()[3])
            img = background
        else:
            img = img.convert('RGB')
            
    if should_convert_to_jpeg or ext in ('.jpg', '.jpeg'):
        img.save(target_path, 'JPEG', quality=quality, optimize=True)
    elif ext == '.png':
        img.save(target_path, 'PNG', optimize=True)
    elif ext == '.webp':
        img.save(target_path, 'WEBP', quality=quality)
    else:
        img.save(target_path, orig_format)
        
    new_size = os.path.getsize(target_path)
    
    if should_convert_to_jpeg and target_path != filepath:
        try:
            os.remove(filepath)
        except Exception as e:
            logger.warning(f"Failed to remove original file: {e}")
            
    return target_path, original_size, new_size, resized


@app.route('/api/compress-image-folder-stream', methods=['GET'])
def api_compress_image_folder_stream():
    folder_path = request.args.get('folder_path', '').strip()
    convert_png = request.args.get('convert_png', 'false').lower() == 'true'
    max_edge_str = request.args.get('max_edge', '1568')
    quality_str = request.args.get('quality', '85')
    
    try:
        max_edge = int(max_edge_str)
        quality = int(quality_str)
    except ValueError:
        max_edge = 1568
        quality = 85

    if not folder_path:
        return Response("data: " + json.dumps({'status': 'error', 'message': '請提供資料夾路徑'}, ensure_ascii=False) + "\n\n", mimetype='text/event-stream')

    if not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        return Response("data: " + json.dumps({'status': 'error', 'message': '指定的資料夾不存在或不是目錄'}, ensure_ascii=False) + "\n\n", mimetype='text/event-stream')

    def generate():
        IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff')
        yield f"data: {json.dumps({'status': 'start', 'message': f'開始掃描資料夾：{folder_path}'}, ensure_ascii=False)}\n\n"
        
        all_files = []
        for root, dirs, files in os.walk(folder_path):
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in IMAGE_EXTS:
                    full_path = os.path.join(root, file)
                    all_files.append(full_path)

        total_files = len(all_files)
        yield f"data: {json.dumps({'status': 'scanned', 'total': total_files, 'message': f'偵測到 {total_files} 個圖片檔案'}, ensure_ascii=False)}\n\n"

        if total_files == 0:
            yield f"data: {json.dumps({'status': 'finished', 'total': 0, 'converted': 0, 'failed_count': 0, 'message': '未找到任何圖片檔案！'}, ensure_ascii=False)}\n\n"
            return

        success_count = 0
        failed_count = 0
        total_original_size = 0
        total_new_size = 0
        failed_files = []

        for idx, src_file in enumerate(all_files):
            rel_path = os.path.relpath(src_file, folder_path)
            percent = int((idx + 1) * 100 / total_files)
            
            yield f"data: {json.dumps({'status': 'processing', 'rel_path': rel_path, 'percent': percent, 'message': f'正在壓縮 ({idx+1}/{total_files}): {rel_path}'}, ensure_ascii=False)}\n\n"
            
            try:
                target_path, orig_sz, new_sz, resized = compress_single_image(src_file, max_edge, quality, convert_png)
                success_count += 1
                total_original_size += orig_sz
                total_new_size += new_sz
                
                ratio = (1 - (new_sz / orig_sz)) * 100 if orig_sz > 0 else 0
                yield f"data: {json.dumps({
                    'status': 'file_success',
                    'rel_path': rel_path,
                    'orig_size': orig_sz,
                    'new_size': new_sz,
                    'ratio': ratio,
                    'resized': resized,
                    'message': f'✅ 成功: {rel_path} ({orig_sz/1024:.1f}KB -> {new_sz/1024:.1f}KB, 壓縮率: {ratio:.1f}%)'
                }, ensure_ascii=False)}\n\n"
            except Exception as e:
                logger.error(f"Failed to compress {rel_path}: {e}")
                failed_count += 1
                failed_files.append({'file': rel_path, 'error': str(e)})
                yield f"data: {json.dumps({'status': 'warning', 'rel_path': rel_path, 'message': f'❌ 失敗: {rel_path} ({str(e)})'}, ensure_ascii=False)}\n\n"

        saved_total_bytes = total_original_size - total_new_size
        saved_ratio = (saved_total_bytes / total_original_size * 100) if total_original_size > 0 else 0
        
        summary = {
            'status': 'finished',
            'total': total_files,
            'converted': success_count,
            'failed_count': failed_count,
            'failed_files': failed_files,
            'orig_size': total_original_size,
            'new_size': total_new_size,
            'saved_bytes': saved_total_bytes,
            'saved_ratio': saved_ratio,
            'message': f'處理完成！共處理 {total_files} 個檔案。成功：{success_count}，失敗：{failed_count}。節省空間：{saved_total_bytes/(1024*1024):.2f} MB ({saved_ratio:.1f}%)'
        }
        yield f"data: {json.dumps(summary, ensure_ascii=False)}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')


if __name__ == '__main__':
    # Clean downloads on start
    try:
        for f in os.listdir(DOWNLOADS_DIR):
            os.remove(os.path.join(DOWNLOADS_DIR, f))
    except Exception:
        pass
    app.run(host='0.0.0.0', port=5001, debug=True)
