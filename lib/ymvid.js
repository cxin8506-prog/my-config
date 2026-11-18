var YM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var YM_BASE = 'https://www.ymvid.com';
var YM_NS = 'ymvid';
var YM_SEARCH_PAGE_SIZE = 20;
var YM_LIST_PAGE_SIZE = 24;
var YM_CATS = [
    { id: 0, name: '全部' }, { id: 1, name: '粤语动画' }, { id: 2, name: '国语动画' }
];
var YM_xxteaKey = null; // 运行时取到的密钥字数组（Int32），不写死

function YM_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function YM_localGet(key) {
    try {
        if (typeof local === 'undefined') return '';
        var v = local.get(YM_NS, key);
        return v ? String(v) : '';
    } catch (e) { return ''; }
}

function YM_localSet(key, val) {
    try {
        if (typeof local === 'undefined') return;
        local.set(YM_NS, key, val);
    } catch (e) { /* 忽略 */ }
}

function YM_stripTags(s) {
    return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

function YM_fixCover(url) {
    return String(url || '').replace('/public/thumbs/', '/thumbs/');
}

function YM_header(res, name) {
    if (!res || !res.headers) return '';
    var h = res.headers;
    var want = name.toLowerCase();
    for (var k in h) {
        if (k.toLowerCase() === want) {
            var v = h[k];
            if (v instanceof Array) return v.length ? String(v[0]) : '';
            return String(v);
        }
    }
    return '';
}

function YM_resolveUrl(base, rel) {
    if (rel.indexOf('http') === 0) return rel;
    if (rel.indexOf('//') === 0) return 'https:' + rel;
    var origin = base.split('/').slice(0, 3).join('/');
    if (rel.charAt(0) === '/') return origin + rel;
    var dir = base.slice(0, base.lastIndexOf('/'));
    return dir + '/' + rel;
}

// 桌面 Chrome UA + 全套浏览器头（WAF 按头打分，缺了就 403）。
function YM_docHeaders(referer) {
    return {
        'User-Agent': YM_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': referer || (YM_BASE + '/')
    };
}

// GET 文本，手动跟随 3xx 跳转（最多 8 跳，如 /play/{id} 301 到第一集）。
function YM_getText(url, extraHeaders, timeoutMs) {
    var current = url;
    for (var hop = 0; hop < 8; hop++) {
        var headers = YM_docHeaders(current === url ? (YM_BASE + '/') : current);
        if (extraHeaders) {
            for (var k in extraHeaders) headers[k] = extraHeaders[k];
        }
        var res = req(current, { headers: headers, timeout: timeoutMs || 20000 });
        if (!res) throw new Error('无响应: ' + current);
        if (res.error) throw new Error('请求失败: ' + res.error);
        if (res.code >= 300 && res.code < 400) {
            var loc = YM_header(res, 'location');
            if (!loc) throw new Error('跳转无 Location：' + current);
            current = YM_resolveUrl(current, loc);
            continue;
        }
        if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + current);
        return res.content || '';
    }
    throw new Error('跳转太多：' + url);
}

// ---------------- XXTEA（站内 xxtea.js 的原样移植） ----------------
var YM_DELTA = 0x9e3779b9 | 0;

function YM_bytesToWords(data, includeLength) {
    var n = (data.length % 4 === 0) ? (data.length / 4) : Math.floor(data.length / 4) + 1;
    var out = [];
    var size = includeLength ? n + 1 : n;
    for (var i = 0; i < size; i++) out.push(0);
    if (includeLength) out[n] = data.length;
    for (var j = 0; j < data.length; j++) {
        out[j >> 2] = out[j >> 2] | ((data[j] & 0xFF) << ((j & 3) << 3));
        out[j >> 2] = out[j >> 2] | 0;
    }
    return out;
}

function YM_wordsToBytes(data, includeLength) {
    var len = data.length << 2;
    if (includeLength) {
        var m = data[data.length - 1];
        len -= 4;
        if (m < len - 3 || m > len) return null;
        len = m;
    }
    var out = [];
    for (var i = 0; i < len; i++) {
        out.push((data[i >> 2] >> ((i & 3) << 3)) & 0xFF);
    }
    return out;
}

function YM_mx(sum, y, z, p, e, k) {
    var a = (((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) | 0;
    var b = ((sum ^ y) + (k[(p & 3) ^ e] ^ z)) | 0;
    return (a ^ b) | 0;
}

function YM_encryptWords(v, k) {
    var n = v.length - 1;
    if (n < 1) return v;
    var z = v[n] | 0;
    var sum = 0;
    var q = 6 + Math.floor(52 / (n + 1));
    while (q-- > 0) {
        sum = (sum + YM_DELTA) | 0;
        var e = (sum >>> 2) & 3;
        for (var p = 0; p < n; p++) {
            var y = v[p + 1] | 0;
            v[p] = (v[p] + YM_mx(sum, y, z, p, e, k)) | 0;
            z = v[p];
        }
        var y0 = v[0] | 0;
        v[n] = (v[n] + YM_mx(sum, y0, z, n, e, k)) | 0;
        z = v[n];
    }
    return v;
}

function YM_decryptWords(v, k) {
    var n = v.length - 1;
    if (n < 1) return v;
    var y = v[0] | 0;
    var sum = ((6 + Math.floor(52 / (n + 1))) * YM_DELTA) | 0;
    while (sum !== 0) {
        var e = (sum >>> 2) & 3;
        for (var p = n; p >= 1; p--) {
            var z = v[p - 1] | 0;
            v[p] = (v[p] - YM_mx(sum, y, z, p, e, k)) | 0;
            y = v[p];
        }
        var z2 = v[n] | 0;
        v[0] = (v[0] - YM_mx(sum, y, z2, 0, e, k)) | 0;
        y = v[0];
        sum = (sum - YM_DELTA) | 0;
    }
    return v;
}

var YM_B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function YM_b64UrlEncode(data) {
    var out = '';
    for (var i = 0; i < data.length; i += 3) {
        var b0 = data[i] & 0xFF;
        var b1 = (i + 1 < data.length) ? (data[i + 1] & 0xFF) : 0;
        var b2 = (i + 2 < data.length) ? (data[i + 2] & 0xFF) : 0;
        out += YM_B64URL[b0 >> 2];
        out += YM_B64URL[((b0 & 3) << 4) | (b1 >> 4)];
        if (i + 1 < data.length) out += YM_B64URL[((b1 & 15) << 2) | (b2 >> 6)];
        if (i + 2 < data.length) out += YM_B64URL[b2 & 63];
    }
    return out;
}

function YM_b64UrlDecode(s) {
    var pad = (4 - s.length % 4) % 4;
    var padded = s;
    for (var p = 0; p < pad; p++) padded += '=';
    var out = [];
    for (var i = 0; i < padded.length; i += 4) {
        var c0 = YM_B64URL.indexOf(padded.charAt(i));
        var c1 = YM_B64URL.indexOf(padded.charAt(i + 1));
        var c2 = padded.charAt(i + 2) === '=' ? -1 : YM_B64URL.indexOf(padded.charAt(i + 2));
        var c3 = padded.charAt(i + 3) === '=' ? -1 : YM_B64URL.indexOf(padded.charAt(i + 3));
        var triple = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
        out.push((triple >> 16) & 0xFF);
        if (c2 >= 0) out.push((triple >> 8) & 0xFF);
        if (c3 >= 0) out.push(triple & 0xFF);
    }
    return out;
}

function YM_strToBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
    return out;
}

function YM_bytesToStr(bytes) {
    var chars = [];
    for (var i = 0; i < bytes.length; i++) chars.push(String.fromCharCode(bytes[i] & 0xFF));
    return chars.join('');
}

function YM_utf8Bytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xC0 | (c >> 6)); out.push(0x80 | (c & 0x3F)); }
        else { out.push(0xE0 | (c >> 12)); out.push(0x80 | ((c >> 6) & 0x3F)); out.push(0x80 | (c & 0x3F)); }
    }
    return out;
}

function YM_base64Encode(bytes) {
    var table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i] & 0xFF;
        var b1 = (i + 1 < bytes.length) ? (bytes[i + 1] & 0xFF) : 0;
        var b2 = (i + 2 < bytes.length) ? (bytes[i + 2] & 0xFF) : 0;
        out += table[b0 >> 2];
        out += table[((b0 & 0x03) << 4) | (b1 >> 4)];
        out += (i + 1 < bytes.length) ? table[((b1 & 0x0F) << 2) | (b2 >> 6)] : '=';
        out += (i + 2 < bytes.length) ? table[b2 & 0x3F] : '=';
    }
    return out;
}

// 从站自己的 xxtea.js 里现取密钥（前 16 字节），取到后只存本插件 local。
function YM_keyWords() {
    if (YM_xxteaKey) return YM_xxteaKey;
    var cached = YM_localGet('xxtea_key');
    if (cached) {
        var kb0 = YM_strToBytes(cached).slice(0, 16);
        while (kb0.length < 16) kb0.push(0);
        YM_xxteaKey = YM_bytesToWords(kb0, false);
        return YM_xxteaKey;
    }
    var keyStr = null;
    var paths = [YM_BASE + '/js/xxtea.js', YM_BASE + '/static/js/xxtea.js'];
    for (var i = 0; i < paths.length && !keyStr; i++) {
        try {
            var js = YM_getText(paths[i], { 'Accept': '*/*' }, 15000);
            var m = /RuoYi_[A-Za-z0-9_]+/.exec(js);
            if (m) keyStr = m[0];
            else {
                var m2 = /["']([A-Za-z0-9_]{16})["']/.exec(js);
                if (m2) keyStr = m2[1];
                else {
                    var m2b = /["']([A-Za-z0-9_]{8,32})["']/.exec(js);
                    if (m2b) keyStr = m2b[1];
                }
            }
        } catch (e) { /* 换下一个路径 */ }
    }
    if (!keyStr) {
        // 再在首页 HTML 里找一遍（密钥有时内联在页面脚本里）。
        try {
            var html = YM_getText(YM_BASE + '/', null, 15000);
            var m3 = /RuoYi_[A-Za-z0-9_]+/.exec(html);
            if (m3) keyStr = m3[0];
        } catch (e) { /* 忽略 */ }
    }
    if (!keyStr) throw new Error('粤漫之家：取不到站内 XXTEA 密钥（请确认能打开 www.ymvid.com 后重试）');
    YM_localSet('xxtea_key', keyStr);
    var kb = YM_strToBytes(keyStr).slice(0, 16);
    while (kb.length < 16) kb.push(0);
    YM_xxteaKey = YM_bytesToWords(kb, false);
    return YM_xxteaKey;
}

function YM_xxteaEncrypt(plain) {
    var words = YM_bytesToWords(YM_utf8Bytes(plain), true);
    var encrypted = YM_encryptWords(words, YM_keyWords());
    var bytes = YM_wordsToBytes(encrypted, false);
    return YM_b64UrlEncode(bytes || []);
}

function YM_xxteaDecrypt(cipher) {
    if (!cipher) return null;
    try {
        var bytes = YM_b64UrlDecode(cipher);
        var words = YM_bytesToWords(bytes, false);
        var decrypted = YM_decryptWords(words, YM_keyWords());
        var plain = YM_wordsToBytes(decrypted, true);
        if (!plain) return null;
        return YM_bytesToStr(plain);
    } catch (e) {
        return null;
    }
}

function YM_todayUtc() {
    try {
        return new Date().toISOString().slice(0, 10);
    } catch (e) {
        var d = new Date();
        var mm = String(d.getUTCMonth() + 1);
        var dd = String(d.getUTCDate());
        return d.getUTCFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd);
    }
}

function YM_randomHex32() {
    var hex = '0123456789abcdef';
    var out = '';
    for (var i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)];
    return out;
}

function YM_browserCode() {
    return YM_xxteaEncrypt(YM_randomHex32() + '_' + YM_todayUtc());
}

function YM_fetchSecureKey(code, cookie, referer) {
    var lastErr = null;
    for (var attempt = 1; attempt <= 4; attempt++) {
        try {
            return YM_getText(YM_BASE + '/allocate/secure_key', {
                'Referer': referer,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Client-Type': 'web',
                'Browser-Code': code,
                'Cookie': cookie
            }, 20000);
        } catch (e) {
            lastErr = e;
        }
    }
    throw new Error('粤漫之家取 secure_key 失败（4 次重试）：' + String(lastErr && lastErr.message || '').slice(0, 120));
}

function YM_parseTotal(html) {
    var m = /data-total="(\d+)"/.exec(html);
    return m ? (parseInt(m[1], 10) || 0) : 0;
}

function YM_parseSearchCards(html) {
    var list = [];
    var re = /<a class="item-thumb" href="https:\/\/www\.ymvid\.com\/play\/(\d+)">[\s\S]*?<img src="([^"]+)" alt="([^"]*)">[\s\S]*?<em>([^<]*)<\/em>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var title = YM_stripTags(m[3]);
        if (!m[1] || !title) continue;
        list.push({
            vod_id: 'ymvid:' + m[1], vod_name: title,
            vod_pic: YM_fixCover(m[2]), vod_remarks: (m[4] || '').trim()
        });
    }
    return list;
}

function YM_parseListCards(html) {
    var list = [];
    var re = /<a href="https:\/\/www\.ymvid\.com\/play\/(\d+)">[\s\S]*?<img src="([^"]+)" alt="([^"]*)">[\s\S]*?<span class="tips">([^<]*)<\/span>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var title = YM_stripTags(m[3]);
        if (!m[1] || !title) continue;
        list.push({
            vod_id: 'ymvid:' + m[1], vod_name: title,
            vod_pic: YM_fixCover(m[2]), vod_remarks: (m[4] || '').trim()
        });
    }
    return list;
}

function init(cfg) { /* 无配置，无登录 */ }

function homeContent(filter) {
    var cls = [];
    for (var i = 0; i < YM_CATS.length; i++) {
        cls.push({ type_id: String(YM_CATS[i].id), type_name: YM_CATS[i].name });
    }
    return JSON.stringify({ 'class': cls });
}

function homeVideoContent() {
    try {
        return categoryContent('0', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var catId = parseInt(tid, 10);
    if (isNaN(catId)) catId = 0;
    var page = parseInt(pg, 10) || 1;
    try {
        var html = YM_getText(YM_BASE + '/list/' + page + '/c' + catId + '-s0-v0-l0-t0-y0/time_desc', null, 20000);
        var list = YM_parseListCards(html);
        var total = YM_parseTotal(html);
        var totalPage = total > 0 ? Math.ceil(total / YM_LIST_PAGE_SIZE) : 1;
        return JSON.stringify({
            page: page, pagecount: totalPage, limit: YM_LIST_PAGE_SIZE, total: total, list: list
        });
    } catch (e) {
        return JSON.stringify({ page: page, pagecount: 1, limit: YM_LIST_PAGE_SIZE, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: YM_SEARCH_PAGE_SIZE, total: 0, list: [] });
    var p = 1;
    try {
        var html = YM_getText(YM_BASE + '/search?keyword=' + YM_enc(kw) + '&p=' + p, null, 20000);
        var list = YM_parseSearchCards(html);
        var total = YM_parseTotal(html);
        var pages = total > 0 ? Math.ceil(total / YM_SEARCH_PAGE_SIZE) : 1;
        return JSON.stringify({
            page: 1, pagecount: pages, limit: YM_SEARCH_PAGE_SIZE, total: total, list: list
        });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: YM_SEARCH_PAGE_SIZE, total: 0, list: [] });
    }
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var seriesId = id.indexOf('ymvid:') === 0 ? id.slice(6) : id;
    if (!seriesId || seriesId.indexOf(':') >= 0) throw new Error('粤漫之家：不认识的书地址');
    var html = YM_getText(YM_BASE + '/play/' + seriesId, null, 20000);
    var titleM = /<title>([^<]+)<\/title>/.exec(html);
    // 详情页 301 到第一集，标题常带【第01集】，去掉站名后缀和末尾的【…】段。
    // <title> 尾部常带换行，先 trim 再 strip，否则 $ 锚点对不上。
    var title = titleM ? titleM[1].trim().replace(/ \| 粤漫之家$/, '').replace(/【[^】]*】?\s*$/, '').trim() : '';
    var introM = /<meta name="description" content="([^"]*)"/.exec(html);
    var intro = introM ? YM_stripTags(introM[1]) : '';
    var coverM = /og:image" content="([^"]+)"/.exec(html);
    var cover = coverM ? YM_fixCover(coverM[1]) : '';
    var episodes = [];
    var seen = {};
    var liRe = /<li class="item[^"]*"[^>]*data-series-id="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
    var m;
    while ((m = liRe.exec(html)) !== null) {
        var epId = m[1];
        if (!epId || epId === '0' || seen[epId]) continue;
        seen[epId] = 1;
        var block = m[2];
        var emM = /<em>(\d+)<\/em>/.exec(block);
        var dataNumM = /data-num="(\d+)"/.exec(block);
        var num = emM ? parseInt(emM[1], 10) : (dataNumM ? (parseInt(dataNumM[1], 10) + 1) : (episodes.length + 1));
        var name = num === 0 ? '正片' : ('第' + num + '集');
        episodes.push({ epId: epId, name: name });
    }
    episodes.sort(function (a, b) { return parseInt(a.epId, 10) - parseInt(b.epId, 10); });
    if (!episodes.length) throw new Error('粤漫之家：详情里没有剧集');
    var playUrl = [];
    for (var i = 0; i < episodes.length; i++) {
        playUrl.push(episodes[i].name + '$ymvid:' + seriesId + ':' + episodes[i].epId);
    }
    return JSON.stringify({
        list: [{
            vod_id: id, vod_name: title, vod_pic: cover, vod_content: intro,
            vod_play_from: '粤漫之家', vod_play_url: playUrl.join('#')
        }]
    });
}

// 播放：data-play-url 解密 → secure_key 换会话 key → 取 m3u8 → data: URI。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('ymvid:') !== 0) throw new Error('粤漫之家：不认识的章节地址');
    var parts = ep.slice(6).split(':');
    if (parts.length < 2) throw new Error('粤漫之家：章节地址缺参数');
    var seriesId = parts[0];
    var episodeId = parts[1];
    var playUrl = YM_BASE + '/play/' + seriesId + '/' + episodeId;
    var html = YM_getText(playUrl, null, 20000);
    var encPlayUrl = null;
    var activeM = /<li class="item active"[^>]*?data-play-url="([^"]+)"/.exec(html);
    if (activeM) encPlayUrl = activeM[1];
    if (!encPlayUrl) {
        var anyM = /data-play-url="([^"]+)"/.exec(html);
        if (anyM) encPlayUrl = anyM[1];
    }
    if (!encPlayUrl) throw new Error('粤漫之家：播放页里没找到 data-play-url');
    var mainM = /id="main"[^>]*?data-id="(\d+)"/.exec(html);
    var seriesIdFromPage = mainM ? mainM[1] : seriesId;
    var decrypted = YM_xxteaDecrypt(encPlayUrl);
    if (!decrypted) throw new Error('粤漫之家：data-play-url 解密失败');
    var base = decrypted.split('?t=')[0];
    if (base.indexOf('/allocate/playlist/') !== 0) {
        throw new Error('粤漫之家：data-play-url 解出地址不对：' + decrypted.slice(0, 80));
    }
    var code = YM_browserCode();
    var cookie = 'browser-code-v1=' + YM_enc(code);
    var keyJson = YM_fetchSecureKey(code, cookie, playUrl);
    var keyData = '';
    try { keyData = JSON.parse(keyJson).data || ''; } catch (e) { keyData = ''; }
    var secureKey = YM_xxteaDecrypt(keyData);
    if (!secureKey) throw new Error('粤漫之家：secure_key 解密失败');
    var finalUrl = YM_BASE + base + '?t=' + YM_enc(secureKey) + '&vId=' + seriesIdFromPage;
    var playlist = YM_getText(finalUrl, { 'Referer': playUrl, 'Cookie': cookie }, 20000);
    if (playlist.indexOf('#EXTM3U') !== 0) {
        throw new Error('粤漫之家：playlist 不是 m3u8（' + playlist.slice(0, 80) + '）');
    }
    var dataUri = 'data:application/vnd.apple.mpegurl;base64,' + YM_base64Encode(YM_utf8Bytes(playlist));
    return JSON.stringify({ parse: 0, url: dataUri, header: { 'User-Agent': YM_UA, 'Referer': playUrl } });
}

var spider = {
    init: init,
    homeContent: homeContent,
    homeVideoContent: homeVideoContent,
    categoryContent: categoryContent,
    detailContent: detailContent,
    searchContent: searchContent,
    playerContent: playerContent
};

function __jsEvalReturn() {
    return spider;
}