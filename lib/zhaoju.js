var ZJ_BASE = 'https://zhaoju4.com';
var ZJ_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
// 签名密钥来自站方前端 JS（movie-card-runtime-*.js，公开的客户端密钥）。
// 注意：这是网站前端公开的客户端签名 key，不是用户个人的 key/token；
// 不带它请求一律 401，源无法工作。站方换前端 JS 后 key 可能失效，届时要重新从前端 JS 里找。
var ZJ_SIGN_SECRET = '8f18c8e472a9fefbab7108f5c447f69b48a4b5d34f662ed83163167fc10fb3b8';
var ZJ_PAGE_SIZE = 20;

// ---------- 小工具 ----------

function ZJ_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function ZJ_utf8Bytes(s) {
    var bytes = [];
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) bytes.push(c);
        else if (c < 0x800) { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                i++;
            } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return bytes;
}

// ---------- SHA-256（纯 JS，输入字节数组，返回小写 hex） ----------

var ZJ_SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function ZJ_sha256Hex(inputBytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = inputBytes.slice();
    var l = bytes.length;
    var bitLenHi = Math.floor(l / 0x20000000);
    var bitLenLo = (l << 3) >>> 0;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push((bitLenHi >>> 24) & 0xFF, (bitLenHi >>> 16) & 0xFF, (bitLenHi >>> 8) & 0xFF, bitLenHi & 0xFF,
               (bitLenLo >>> 24) & 0xFF, (bitLenLo >>> 16) & 0xFF, (bitLenLo >>> 8) & 0xFF, bitLenLo & 0xFF);
    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
    for (var off = 0; off < bytes.length; off += 64) {
        var w = [];
        for (var i = 0; i < 16; i++) {
            w.push(((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0);
        }
        for (var t = 16; t < 64; t++) {
            var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
            var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (var r = 0; r < 64; r++) {
            var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
            var ch = ((e & f) ^ (~e & g)) >>> 0;
            var t1 = (h + S1 + ch + ZJ_SHA_K[r] + w[r]) >>> 0;
            var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
            var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
            var t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = '';
    for (var k = 0; k < 8; k++) {
        for (var j = 3; j >= 0; j--) out += ('0' + ((H[k] >>> (j * 8)) & 0xFF).toString(16)).slice(-2);
    }
    return out;
}

function ZJ_sha256Bytes(inputBytes) {
    var hex = ZJ_sha256Hex(inputBytes);
    var out = [];
    for (var i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
}

// HMAC-SHA256(secret, msg)：返回小写 hex。
function ZJ_hmacSha256Hex(secret, msg) {
    var key = ZJ_utf8Bytes(secret);
    if (key.length > 64) key = ZJ_sha256Bytes(key);
    while (key.length < 64) key.push(0);
    var ipad = [], opad = [];
    for (var i = 0; i < 64; i++) {
        ipad.push(key[i] ^ 0x36);
        opad.push(key[i] ^ 0x5c);
    }
    var inner = ZJ_sha256Bytes(ipad.concat(ZJ_utf8Bytes(msg)));
    return ZJ_sha256Hex(opad.concat(inner));
}

function ZJ_randomNonceHex() {
    var s = '';
    for (var i = 0; i < 16; i++) {
        s += ('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2);
    }
    return s;
}

// ---------- 带签名的 GET ----------

function ZJ_reqJson(path) {
    var ts = String(Date.now());
    var nonce = ZJ_randomNonceHex();
    var sig = ZJ_hmacSha256Hex(ZJ_SIGN_SECRET, 'GET\n' + path + '\n' + ts + '\n' + nonce);
    var res = req(ZJ_BASE + path, {
        headers: {
            'User-Agent': ZJ_UA,
            'Accept': 'application/json',
            'x-ai-movie-timestamp': ts,
            'x-ai-movie-nonce': nonce,
            'x-ai-movie-signature': sig,
            'x-ai-movie-client-name': 'movie-search-frontend',
            'x-ai-movie-client-version': '1.0.0',
            'x-ai-movie-build-version': 'zhaoju-ai-v2026.11.12.3-worker-flag-fix-df2856e4fb54-web',
            'x-ai-movie-protocol-version': '2026-07-05.library-v2.playback-v1'
        },
        timeout: 20000
    });
    if (!res) throw new Error('无响应: ' + path);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + '：' + (res.content || '').slice(0, 200));
    return JSON.parse(res.content || '{}');
}

// ---------- 解析 ----------

function ZJ_parseCards(json) {
    var list = [];
    var cards = (json && json.cards) || [];
    for (var i = 0; i < cards.length; i++) {
        var c = cards[i] || {};
        var id = c.id || '';
        if (!id) continue;
        var title = String(c.title || '').trim();
        if (!title) continue;
        list.push({
            vod_id: 'zhaoju:' + id,
            vod_name: title,
            vod_pic: String(c.poster_url || '').replace(/&amp;/g, '&'),
            vod_remarks: String(c.remarks || '').trim()
        });
    }
    return list;
}

function ZJ_parseTotalPage(json) {
    var pg = (json && json.pagination) || null;
    if (!pg) return 1;
    var total = pg.total || 0;
    if (total <= 0) return pg.has_more ? 2 : 1;
    var limit = Math.max(1, pg.limit || ZJ_PAGE_SIZE);
    return Math.ceil(total / limit);
}

// ---------- CatVod Spider ----------

function init(cfg) { /* 无配置 */ }

function homeContent(filter) {
    return JSON.stringify({
        'class': [
            { type_id: 'series', type_name: '电视剧' },
            { type_id: 'movie', type_name: '电影' },
            { type_id: 'anime', type_name: '动漫' },
            { type_id: 'variety', type_name: '综艺' },
            { type_id: 'short_drama', type_name: '短剧' }
        ]
    });
}

function homeVideoContent() {
    try {
        return categoryContent('series', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var json = ZJ_reqJson('/v1/browse/catalog?q=' + ZJ_enc(kw) + '&page=1&limit=' + ZJ_PAGE_SIZE);
    var list = ZJ_parseCards(json);
    var totalPage = ZJ_parseTotalPage(json);
    var total = (json.pagination && json.pagination.total) || list.length;
    return JSON.stringify({ page: 1, pagecount: totalPage, limit: 20, total: total, list: list });
}

function categoryContent(tid, pg, filter, extend) {
    var kind = String(tid || 'series');
    var kinds = { series: 1, movie: 1, anime: 1, variety: 1, short_drama: 1 };
    if (!kinds[kind]) throw new Error('找剧AI：不认识的分类 ' + kind);
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    var json = ZJ_reqJson('/v1/browse/catalog?kind=' + kind + '&page=' + page + '&limit=' + ZJ_PAGE_SIZE);
    var list = ZJ_parseCards(json);
    var totalPage = ZJ_parseTotalPage(json);
    var total = (json.pagination && json.pagination.total) || list.length;
    return JSON.stringify({ page: page, pagecount: totalPage, limit: 20, total: total, list: list });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '').replace(/^zhaoju:/, '');
    if (!id || id.indexOf(':') >= 0) throw new Error('找剧AI：不认识的书地址');
    var json = ZJ_reqJson('/v1/catalog/' + id);
    var cover = String(json.poster_url || '').replace(/&amp;/g, '&');
    var intro = String(json.description || '').trim();
    var actors = json.actors || [];
    var actor = [];
    for (var i = 0; i < actors.length; i++) if (actors[i]) actor.push(actors[i]);
    var eps = json.episodes || [];
    var playUrl = [];
    for (var j = 0; j < eps.length; j++) {
        var e = eps[j] || {};
        var token = e.token || '';
        if (!token) continue;
        var num = e.number || (j + 1);
        var name = String(e.title || '').trim() || ('第' + num + '集');
        playUrl.push(name + '$zhaoju:ep:' + token);
    }
    if (!playUrl.length) throw new Error('找剧AI：详情里没有可播剧集');
    return JSON.stringify({
        list: [{
            vod_id: 'zhaoju:' + id,
            vod_name: String(json.title || ''),
            vod_pic: cover,
            vod_content: intro,
            vod_remarks: actor.join('、'),
            vod_play_from: '找剧AI',
            vod_play_url: playUrl.join('#')
        }]
    });
}

function playerContent(flag, id, vipFlags) {
    var url = ZJ_resolvePlayUrl(String(id || ''));
    return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': ZJ_UA } });
}

// 章节地址 zhaoju:ep:{episodeToken} 解析成最终可播地址。
function ZJ_resolvePlayUrl(episodeUrl) {
    if (episodeUrl.indexOf('zhaoju:ep:') !== 0) throw new Error('找剧AI：不认识的章节地址');
    var token = episodeUrl.slice('zhaoju:ep:'.length);
    if (!token) throw new Error('找剧AI：章节地址缺 token');
    var json = ZJ_reqJson('/v1/playback/resolve/' + token);
    var options = json.line_options || null;
    if (!options) throw new Error('找剧AI：解析结果里没有线路');
    var bestUrl = '', bestWeight = -Infinity;
    for (var i = 0; i < options.length; i++) {
        var o = options[i] || {};
        var url = o.url || '';
        if (url.indexOf('http') !== 0) continue;
        if (o.url_kind !== 'm3u8') continue;
        if (!o.resolved) continue;
        var w = o.preference_weight == null ? 0 : o.preference_weight;
        if (w > bestWeight) { bestWeight = w; bestUrl = url; }
    }
    if (!bestUrl) throw new Error('找剧AI：没有可直接播放的 m3u8 线路');
    return bestUrl;
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