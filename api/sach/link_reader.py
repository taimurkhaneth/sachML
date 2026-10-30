"""
Reads a news link: downloads the page and takes the headline and first lines.

Safety: only http/https, and never private/internal addresses, so a message
cannot make our server open its own internal services.
"""
import ipaddress
import re
import socket
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

URL_RE = re.compile(r'(https?://[^\s<>"\']+|www\.[^\s<>"\']+)', re.IGNORECASE)
HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
    'Accept-Language': 'ur,en;q=0.8',
}
MAX_BYTES = 2_000_000
URDU_RE = re.compile(r'[؀-ۿ]')


def find_urls(text):
    urls = []
    for u in URL_RE.findall(text or ''):
        u = u.rstrip('.,);!؟۔')
        if not u.lower().startswith('http'):
            u = 'https://' + u
        urls.append(u)
    return urls


def remove_urls(text):
    return URL_RE.sub(' ', text or '').strip()


def _is_public_host(host):
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified):
            return False
    return True


def _meta(soup, *names):
    for name in names:
        tag = soup.find('meta', attrs={'property': name}) or soup.find('meta', attrs={'name': name})
        if tag and tag.get('content'):
            return tag['content'].strip()
    return ''


def read_link(url, timeout=8):
    """Returns {'ok': bool, 'title': str, 'snippet': str, 'site': str, 'error': str}."""
    result = {'ok': False, 'title': '', 'snippet': '', 'site': '', 'error': ''}
    try:
        current = url
        for _ in range(5):                               # follow redirects ourselves, checking each hop
            parsed = urlparse(current)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname:
                result['error'] = 'bad_url'
                return result
            if not _is_public_host(parsed.hostname):
                result['error'] = 'blocked_host'
                return result
            resp = requests.get(current, headers=HEADERS, timeout=timeout,
                                allow_redirects=False, stream=True)
            if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                current = requests.compat.urljoin(current, resp.headers.get('Location', ''))
                resp.close()
                continue
            break
        else:
            result['error'] = 'too_many_redirects'
            return result

        result['site'] = urlparse(current).hostname or ''
        if resp.status_code != 200:
            result['error'] = f'http_{resp.status_code}'
            return result

        raw = resp.raw.read(MAX_BYTES, decode_content=True)
        resp.close()
        soup = BeautifulSoup(raw, 'html.parser')

        title = (_meta(soup, 'og:title', 'twitter:title')
                 or (soup.title.string.strip() if soup.title and soup.title.string else '')
                 or (soup.h1.get_text(' ', strip=True) if soup.h1 else ''))

        # First paragraphs that are actually Urdu
        paras = []
        for p in soup.find_all('p'):
            t = p.get_text(' ', strip=True)
            if len(t) > 40 and URDU_RE.search(t):
                paras.append(t)
            if len(' '.join(paras)) > 600:
                break
        snippet = ' '.join(paras) or _meta(soup, 'og:description', 'description')

        result.update(title=title[:300], snippet=snippet[:800])
        result['ok'] = bool(title or snippet)
        if not result['ok']:
            result['error'] = 'no_text'
    except requests.RequestException as e:
        result['error'] = type(e).__name__
    except Exception as e:                               # never crash the API because of one page
        result['error'] = 'parse_error:' + type(e).__name__
    return result
