#!/usr/bin/env python3
"""Static dev server for the Metaworx site.

Serves the repository root over HTTP for local development. Because the site's
home page currently lives in a file literally named "Home Page" (no .html
extension), this server maps "/" to that file and returns text/html for HTML
content so browsers render pages instead of downloading them. The website's own
files are never modified.
"""
import functools
import http.server
import os
import socketserver
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME_PAGE_FILE = "Home Page"
PORT = int(os.environ.get("PORT", "8000"))


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Serve the home page file when the root is requested.
        if path in ("/", "/index.html"):
            return os.path.join(REPO_ROOT, HOME_PAGE_FILE)
        return super().translate_path(path)

    def guess_type(self, path):
        base = os.path.basename(path)
        # The extensionless home page is HTML; render it as such.
        if base == HOME_PAGE_FILE or path.endswith((".html", ".htm")):
            return "text/html; charset=utf-8"
        return super().guess_type(path)


def main():
    handler = functools.partial(SiteHandler, directory=REPO_ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"Serving Metaworx site from {REPO_ROOT} at http://0.0.0.0:{PORT}")
        sys.stdout.flush()
        httpd.serve_forever()


if __name__ == "__main__":
    main()
