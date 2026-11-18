var SK_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var SK_BASE = 'https://www.4kvm.tv';
// 站内 WASM 的签名常量（Kotlin 源里同名常量，原样移植；不是用户个人的 key/token）。
var SK_SIGN_KEY = 'nbmovie2024secretkey';

var SK_CATS = [
    { key: 'movie', name: '电影' },
    { key: 'tv', name: '电视剧' },
    { key: 'anime', name: '动漫' }
];

// 依次尝试的清晰度（q=1 为 4K，游客会被降级或锁住，只取未锁的）。
var SK_QUALITIES = ['1080', '720', '480', '1'];

// ---------- 小工具 ----------

function SK_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function SK_stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function SK_unesc(s) {
    return String(s || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// 同步 GET 文本：返回正文，非 2xx 抛错。
function SK_reqText(url, timeoutMs, referer) {
    var res = req(url, {
        headers: {
            'User-Agent': SK_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': referer || (SK_BASE + '/')
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function SK_reqJson(url, timeoutMs, referer) {
    var res = req(url, {
        headers: { 'User-Agent': SK_UA, 'Accept': 'application/json', 'Referer': referer || (SK_BASE + '/') },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return JSON.parse(res.content || '{}');
}

function SK_attr(attrs, name) {
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"').exec(attrs || '');
    return m ? SK_unesc(m[1]) : '';
}

// 遍历页面里所有 <a ...>...</a>：fn(attrs, inner)
function SK_eachAnchor(html, fn) {
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) fn(m[1], m[2]);
}

// <meta ...> 里按属性找 content（如 property="og:title"）。
function SK_metaContent(html, attrName, attrVal) {
    var re = /<meta\b[^>]*>/g, m;
    while ((m = re.exec(html)) !== null) {
        var tag = m[0];
        if (tag.indexOf(attrName + '="' + attrVal + '"') < 0) continue;
        var cm = /content\s*=\s*"([^"]*)"/.exec(tag);
        if (cm) return SK_unesc(cm[1]);
    }
    return '';
}

// ---------- 纯 JS：UTF-8 编码 / SHA-256 / HMAC-SHA256 / base64url ----------

function SK_utf8Bytes(s) {
    var out = [];
    s = String(s || '');
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
        else if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 < 0xE000) {
                var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                i++;
            } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return out;
}

var SK_SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function SK_rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

// SHA-256：输入字节数组，输出 32 字节数组。
function SK_sha256(bytes) {
    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var msg = bytes.slice();
    var bitLen = bytes.length * 8;
    msg.push(0x80);
    while ((msg.length % 64) !== 56) msg.push(0);
    // 64 位长度：高 32 位恒为 0（消息远小于 2^32 字节），低 32 位写 bitLen。
    msg.push(0, 0, 0, 0, (bitLen >>> 24) & 0xFF, (bitLen >>> 16) & 0xFF, (bitLen >>> 8) & 0xFF, bitLen & 0xFF);
    var w = new Array(64);
    for (var off = 0; off < msg.length; off += 64) {
        for (var i = 0; i < 16; i++) {
            w[i] = ((msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3]) | 0;
        }
        for (var j = 16; j < 64; j++) {
            var s0 = (SK_rotr(w[j - 15], 7) ^ SK_rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)) | 0;
            var s1 = (SK_rotr(w[j - 2], 17) ^ SK_rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10)) | 0;
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (var k = 0; k < 64; k++) {
            var S1 = (SK_rotr(e, 6) ^ SK_rotr(e, 11) ^ SK_rotr(e, 25)) | 0;
            var ch = ((e & f) ^ (~e & g)) | 0;
            var t1 = (h + S1 + ch + SK_SHA256_K[k] + w[k]) | 0;
            var S0 = (SK_rotr(a, 2) ^ SK_rotr(a, 13) ^ SK_rotr(a, 22)) | 0;
            var maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
            var t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    var out = [];
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach(function (x) {
        out.push((x >>> 24) & 0xFF, (x >>> 16) & 0xFF, (x >>> 8) & 0xFF, x & 0xFF);
    });
    return out;
}

function SK_bytesToHex(bytes) {
    var hex = '0123456789abcdef', out = '';
    for (var i = 0; i < bytes.length; i++) out += hex[(bytes[i] >> 4) & 0xF] + hex[bytes[i] & 0xF];
    return out;
}

// HMAC-SHA256 的 hex（小写）。
function SK_hmacSha256Hex(key, msg) {
    var kb = SK_utf8Bytes(key);
    if (kb.length > 64) kb = SK_sha256(kb);
    while (kb.length < 64) kb.push(0);
    var ipad = [], opad = [];
    for (var i = 0; i < 64; i++) { ipad.push(kb[i] ^ 0x36); opad.push(kb[i] ^ 0x5C); }
    var inner = SK_sha256(ipad.concat(SK_utf8Bytes(msg)));
    return SK_bytesToHex(SK_sha256(opad.concat(inner)));
}

// base64url 编码（带 = 补齐）。
function SK_base64UrlEncode(data) {
    var table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var out = '';
    for (var i = 0; i < data.length; i += 3) {
        var b0 = data[i] & 0xFF;
        var b1 = (i + 1 < data.length) ? data[i + 1] & 0xFF : 0;
        var b2 = (i + 2 < data.length) ? data[i + 2] & 0xFF : 0;
        out += table[(b0 >> 2) & 0x3F];
        out += table[((b0 << 4) | (b1 >> 4)) & 0x3F];
        out += (i + 1 < data.length) ? table[((b1 << 2) | (b2 >> 6)) & 0x3F] : '=';
        out += (i + 2 < data.length) ? table[b2 & 0x3F] : '=';
    }
    return out;
}

// k：play_key=="0" 直通，否则 UTF-8 字节与签名常量循环异或后 base64url。
function SK_encodeK(playKey) {
    if (playKey === '0') return '0';
    var src = SK_utf8Bytes(playKey);
    var key = SK_utf8Bytes(SK_SIGN_KEY);
    var out = [];
    for (var i = 0; i < src.length; i++) out.push(src[i] ^ key[i % key.length]);
    return SK_base64UrlEncode(out);
}

// ---------- 解析 ----------

// 搜索/分类卡片：a[href^=/play/]，封面 img[data-src]，标题 img alt 或 h3；按 secret 去重。
function SK_parseCards(html) {
    var list = [];
    var seen = {};
    SK_eachAnchor(html, function (attrs, inner) {
        var href = SK_attr(attrs, 'href');
        var m = /^\/play\/([^\/\s]+)$/.exec(href);
        if (!m) return;
        var secret = m[1];
        if (seen[secret]) return;
        seen[secret] = 1;
        var title = '';
        var im = /<img\b[^>]*>/.exec(inner);
        if (im) title = SK_attr(im[0], 'alt').trim();
        if (!title) {
            var hm = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(inner);
            if (hm) title = SK_stripTags(hm[1]);
        }
        if (!title) return;
        var cover = '';
        if (im) {
            cover = SK_attr(im[0], 'data-src') || SK_attr(im[0], 'src');
            if (cover.indexOf('placeholder-dark.svg') >= 0) cover = '';
        }
        list.push({ vod_id: '4kvm:' + secret, vod_name: title, vod_pic: cover, vod_remarks: '', vod_content: '' });
    });
    return list;
}

// 播放页即详情页：og:title 去掉“ - 第N集”得剧名；只列当前线的剧集。
function SK_parseDetail(html) {
    var title = SK_metaContent(html, 'property', 'og:title').trim();
    title = title.replace(/ - 第\d+集$/, '').trim();
    if (!title) {
        var tm = /<title>([\s\S]*?)<\/title>/.exec(html);
        if (tm) title = SK_stripTags(tm[1]).replace(/ - 第\d+集.*$/, '').trim();
    }
    var cover = SK_metaContent(html, 'property', 'og:image');
    var intro = SK_metaContent(html, 'name', 'description').trim();
    var mgr = /episodeManager\(\s*(\d+)\s*,\s*\d+\s*,\s*\[([\s\S]*?)\]\)/.exec(html);
    var currentLine = mgr ? (parseInt(mgr[1], 10) || 1) : 1;
    var lineCounts = {};
    if (mgr) {
        var lm = /lineName:\s*'([^']+)'\s*,\s*episodeCount:\s*(\d+)/g, mm;
        var idx = 1;
        while ((mm = lm.exec(mgr[2])) !== null) {
            lineCounts[idx] = parseInt(mm[2], 10) || 0;
            idx++;
        }
    }
    var byEp = {}; // ep -> {dataid, secret}
    SK_eachAnchor(html, function (attrs) {
        var line = parseInt(SK_attr(attrs, 'data-line'), 10);
        if (line !== currentLine) return;
        var ep = parseInt(SK_attr(attrs, 'data-episode'), 10);
        var dataid = SK_attr(attrs, 'dataid').trim();
        var href = SK_attr(attrs, 'href');
        var sec = href.indexOf('/play/') === 0 ? href.slice('/play/'.length).trim() : '';
        if (!ep || !dataid || !sec) return;
        byEp[ep] = { dataid: dataid, secret: sec };
    });
    var eps = Object.keys(byEp).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) { return a - b; });
    if (!eps.length) throw new Error('4K影视：详情里没有可播剧集');
    var total = lineCounts[currentLine] || eps.length;
    var episodes = eps.map(function (ep) {
        var name = eps.length === 1 ? '正片' : ('第' + ep + '集');
        return { name: name, url: '4kvm:' + byEp[ep].dataid + ':' + byEp[ep].secret };
    });
    return { title: title, cover: cover, intro: intro, total: total, episodes: episodes };
}

// 播放页里某集在各线路的 (dataid, secret)，按线路号排序，供解析换线用。
function SK_sameEpisodeCandidates(html, episode) {
    var byLine = {};
    SK_eachAnchor(html, function (attrs) {
        var ep = parseInt(SK_attr(attrs, 'data-episode'), 10);
        if (ep !== episode) return;
        var line = parseInt(SK_attr(attrs, 'data-line'), 10);
        if (!line || byLine[line]) return;
        var dataid = SK_attr(attrs, 'dataid').trim();
        var href = SK_attr(attrs, 'href');
        var sec = href.indexOf('/play/') === 0 ? href.slice('/play/'.length).trim() : '';
        if (!dataid || !sec) return;
        byLine[line] = { dataid: dataid, secret: sec };
    });
    return Object.keys(byLine).map(function (k) { return parseInt(k, 10); })
        .sort(function (a, b) { return a - b; })
        .map(function (k) { return byLine[k]; });
}

// 播放页里某 dataid 对应的集号。
function SK_episodeOf(html, dataid) {
    var found = null;
    SK_eachAnchor(html, function (attrs) {
        if (found !== null) return;
        if (SK_attr(attrs, 'dataid') === dataid) {
            var ep = parseInt(SK_attr(attrs, 'data-episode'), 10);
            if (ep) found = ep;
        }
    });
    return found;
}

// ---------- CatVod Spider ----------

function init(cfg) {
    // 无需配置。
}

function homeContent(filter) {
    return JSON.stringify({
        'class': SK_CATS.map(function (c) {
            return { type_id: c.key, type_name: c.name };
        })
    });
}

function homeVideoContent() {
    return JSON.stringify({ list: [] });
}

// 搜索：站内搜索无翻页（?page=2 返回与第 1 页相同的字节）。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = SK_reqText(SK_BASE + '/search?q=' + SK_enc(kw), 20000);
    var list = SK_parseCards(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

// 分类：/movie、/tv、/anime，均无翻页。
function categoryContent(tid, pg, filter, extend) {
    var key = String(tid || '');
    var page = parseInt(pg, 10) || 1;
    if (page > 1) return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    var ok = false;
    for (var i = 0; i < SK_CATS.length; i++) if (SK_CATS[i].key === key) ok = true;
    if (!ok) throw new Error('4K影视：不认识的分类 ' + key);
    var html = SK_reqText(SK_BASE + '/' + key, 20000);
    var list = SK_parseCards(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

// 详情：播放页即详情页，GET /play/{secret}。
function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    if (id.indexOf('4kvm:') !== 0) throw new Error('4K影视：不认识的书地址 ' + id);
    var secret = id.slice('4kvm:'.length);
    if (!secret || secret.indexOf(':') >= 0) throw new Error('4K影视：不认识的书地址 ' + id);
    var html = SK_reqText(SK_BASE + '/play/' + secret, 20000);
    var d = SK_parseDetail(html);
    var playUrl = d.episodes.map(function (ep) {
        return ep.name + '$' + ep.url;
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: d.title,
            vod_pic: d.cover,
            vod_content: d.intro,
            vod_play_from: '4K影视',
            vod_play_url: playUrl
        }]
    });
}

// 播放：章节地址 4kvm:{dataid}:{playSecret}，WASM 签名纯 JS 算，
// 先试本集本线，再按线路顺序换线（同集其他线路），只取未锁的 m3u8。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('4kvm:') !== 0) throw new Error('4K影视：不认识的章节地址 ' + ep);
    var parts = ep.slice('4kvm:'.length).split(':');
    if (parts.length < 2) throw new Error('4K影视：章节地址缺参数 ' + ep);
    var firstDataid = parts[0];
    var firstSecret = parts[1];
    var fetchStart = Date.now();
    var playUrl = SK_BASE + '/play/' + firstSecret;
    var playHtml = SK_reqText(playUrl, 20000, SK_BASE + '/');
    var userlink = '0';
    var um = /userlink\s*:\s*'([^']+)'/.exec(playHtml);
    if (um) userlink = um[1];
    var nbSt = null;
    var nm = /<meta id="nb-st" content="(\d+)"/.exec(playHtml);
    if (nm) nbSt = parseInt(nm[1], 10);
    var skew = nbSt !== null ? nbSt - fetchStart : 0;
    if (skew < -300000 || skew > 300000) skew = 0;
    var t = Date.now() + skew;
    var k = SK_encodeK(userlink);
    var candidates = [{ dataid: firstDataid, secret: firstSecret }];
    var epNo = SK_episodeOf(playHtml, firstDataid);
    if (epNo !== null) {
        var others = SK_sameEpisodeCandidates(playHtml, epNo);
        for (var i = 0; i < others.length; i++) {
            var dup = false;
            for (var j = 0; j < candidates.length; j++) {
                if (candidates[j].dataid === others[i].dataid && candidates[j].secret === others[i].secret) dup = true;
            }
            if (!dup) candidates.push(others[i]);
        }
    }
    var lastMsg = '';
    for (var c = 0; c < candidates.length; c++) {
        var dataid = candidates[c].dataid, secret = candidates[c].secret;
        var s = SK_hmacSha256Hex(secret, dataid + ':' + t + ':' + secret).substring(0, 32);
        for (var q = 0; q < SK_QUALITIES.length; q++) {
            var quality = SK_QUALITIES[q];
            try {
                var api = SK_BASE + '/video/play?p=' + dataid + '&v=' + secret + '&q=' + quality +
                    '&s=' + s + '&t=' + t + '&k=' + SK_enc(k);
                var resp = SK_reqJson(api, 20000, playUrl);
                if (resp.code !== 200) {
                    lastMsg = 'q=' + quality + ' code=' + resp.code;
                    continue;
                }
                var urls = (resp.data && resp.data.quality_urls) || [];
                var got = null;
                for (var u = 0; u < urls.length; u++) {
                    var e = urls[u] || {};
                    if (e.locked || e.isvip) continue;
                    var url = String(e.url || '');
                    if (url.indexOf('http') === 0) { got = url; break; }
                }
                if (got) return JSON.stringify({ parse: 0, url: got, header: { 'User-Agent': SK_UA, 'Referer': playUrl } });
                lastMsg = 'q=' + quality + ' 无未锁清晰度';
            } catch (e) {
                lastMsg = 'q=' + quality + '：' + String(e.message || e).slice(0, 100);
            }
        }
    }
    throw new Error('4K影视暂未返回可播地址：' + lastMsg);
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

// 承影用 spider.__jsEvalReturn()（或 spider.default）加载本插件。
function __jsEvalReturn() {
    return spider;
}