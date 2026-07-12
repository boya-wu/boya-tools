import yt_dlp
import json

ydl_opts = {
    'getcomments': True,
    'skip_download': True,
    'extractor_args': {
        'youtube': {
            'comment_items': ['top,1']
        }
    }
}

url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    try:
        info = ydl.extract_info(url, download=False)
        comments = info.get('comments', [])
        if comments:
            comment = comments[0]
            print("Comment keys:", list(comment.keys()))
            print("Sample comment data:", json.dumps(comment, indent=2, ensure_ascii=False))
        else:
            print("No comments found")
    except Exception as e:
        print(f"Error: {e}")
