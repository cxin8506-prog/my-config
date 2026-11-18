var KJ_BASE = 'https://kanju.ai';
var KJ_MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var KJ_NS = 'kanju';
var KJ_KINDS = ['movie', 'series', 'anime', 'variety', 'short_drama'];

// HMAC 签名密钥：来自 kanju 公开 JS（movie-card-runtime 里的常量），不是服务端秘密。
// 服务端随时可能换密钥，换了之后旧版会全站 401，需要发新版更新密钥。
var KJ_SIGN_KEY_HEX = '557d0e4ae929f438da6bd84412374e6086b8af09b3fed54bf22601d5bf8c54a0';

var KJ_EXTRA_HEADERS = {
    'x-ai-movie-build-version': 'dianyingtiantang-v2026.11.12.3-worker-flag-fix-46f791897b69-web',
    'x-ai-movie-protocol-version': '2026-07-05.library-v2.playback-v1',
    'x-ai-movie-client-version': '1.0.0',
    'x-ai-movie-client-name': 'dianyingtiantang-frontend'
};

// ---------- 小工具 ----------

function KJ_enc(s) {
    return encodeURIComponent(s);
}

function KJ_localGet(key) {
    try {
        if (typeof local === 'undefined') return '';
        var v = local.get(KJ_NS, key);
        return v ? String(v) : '';
    } catch (e) { return ''; }
}

function KJ_localSet(key, val) {
    try {
        if (typeof local === 'undefined') return false;
        local.set(KJ_NS, key, val);
        return true;
    } catch (e) { return false; }
}

function KJ_hexBytes(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
        var h = (bytes[i] & 0xFF).toString(16);
        s += h.length === 1 ? '0' + h : h;
    }
    return s;
}

function KJ_utf8Bytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) {
            out.push(c);
        } else if (c < 0x800) {
            out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
        } else if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 < 0xE000) {
                var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                i++;
            } else {
                out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
            }
        } else {
            out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        }
    }
    return out;
}

// ---------- SHA-256 / HMAC-SHA256（纯 JS） ----------

// 初始值和轮常量按标准定义从素数算出来（H 是前 8 个素数平方根的小数部分，
// K 是前 64 个素数立方根的小数部分，各乘 2^32 取整），不硬抄表。
var KJ_SHA256_PRIMES = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53,
    59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131,
    137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223,
    227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311
];
var KJ_SHA256_H = [];
var KJ_SHA256_K = [];
(function () {
    for (var i = 0; i < 8; i++) {
        KJ_SHA256_H.push(Math.floor((Math.sqrt(KJ_SHA256_PRIMES[i]) % 1) * 4294967296));
    }
    for (var j = 0; j < 64; j++) {
        KJ_SHA256_K.push(Math.floor((Math.cbrt(KJ_SHA256_PRIMES[j]) % 1) * 4294967296));
    }
})();

function KJ_rotr32(x, n) {
    return ((x >>> n) | (x << (32 - n))) | 0;
}

function KJ_sha256Bytes(bytes) {
    var msg = bytes.slice();
    var bitLen = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var high = Math.floor(bitLen / 4294967296);
    var low = bitLen >>> 0;
    msg.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255,
             (low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);

    var H = KJ_SHA256_H.slice();
    var K = KJ_SHA256_K;
    for (var off = 0; off < msg.length; off += 64) {
        var w = new Array(64);
        for (var i = 0; i < 16; i++) {
            w[i] = (((msg[off + i * 4] & 0xFF) << 24) | ((msg[off + i * 4 + 1] & 0xFF) << 16) |
                ((msg[off + i * 4 + 2] & 0xFF) << 8) | (msg[off + i * 4 + 3] & 0xFF)) | 0;
        }
        for (var j = 16; j < 64; j++) {
            var s0 = (KJ_rotr32(w[j - 15], 7) ^ KJ_rotr32(w[j - 15], 18) ^ (w[j - 15] >>> 3)) | 0;
            var s1 = (KJ_rotr32(w[j - 2], 17) ^ KJ_rotr32(w[j - 2], 19) ^ (w[j - 2] >>> 10)) | 0;
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
        }
        var a = H[0], b = H[1], c = H[2], d = H[3];
        var e = H[4], f = H[5], g = H[6], h = H[7];
        for (var t = 0; t < 64; t++) {
            var S1 = (KJ_rotr32(e, 6) ^ KJ_rotr32(e, 11) ^ KJ_rotr32(e, 25)) | 0;
            var ch = ((e & f) ^ ((~e) & g)) | 0;
            var temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
            var S0 = (KJ_rotr32(a, 2) ^ KJ_rotr32(a, 13) ^ KJ_rotr32(a, 22)) | 0;
            var maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
            var temp2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + temp1) | 0;
            d = c; c = b; b = a; a = (temp1 + temp2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
        H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
        H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    for (var m = 0; m < 8; m++) {
        out.push((H[m] >>> 24) & 255, (H[m] >>> 16) & 255, (H[m] >>> 8) & 255, H[m] & 255);
    }
    return out;
}

function KJ_sha256Hex(bytes) {
    return KJ_hexBytes(KJ_sha256Bytes(bytes));
}

function KJ_hmacSha256Hex(keyBytes, msgBytes) {
    var key = keyBytes.slice();
    if (key.length > 64) key = KJ_sha256Bytes(key);
    while (key.length < 64) key.push(0);
    var oPad = [], iPad = [];
    for (var i = 0; i < 64; i++) {
        oPad.push(key[i] ^ 0x5C);
        iPad.push(key[i] ^ 0x36);
    }
    var inner = KJ_sha256Bytes(iPad.concat(msgBytes));
    return KJ_hexBytes(KJ_sha256Bytes(oPad.concat(inner)));
}

// ---------- 签名请求 ----------

function KJ_randomHexBytes(n) {
    var s = '';
    var hex = '0123456789abcdef';
    for (var i = 0; i < n; i++) s += hex[Math.floor(Math.random() * 16)] + hex[Math.floor(Math.random() * 16)];
    return s;
}

function KJ_signHeaders(method, pathWithQuery) {
    var timestamp = String(Date.now());
    var nonce = KJ_randomHexBytes(16);
    var message = method + '\n' + pathWithQuery + '\n' + timestamp + '\n' + nonce;
    var signature = KJ_hmacSha256Hex(KJ_utf8Bytes(KJ_SIGN_KEY_HEX), KJ_utf8Bytes(message));
    return {
        'x-ai-movie-timestamp': timestamp,
        'x-ai-movie-nonce': nonce,
        'x-ai-movie-signature': signature
    };
}

// ---------- 匿名会话 ----------

// 当前有效的会话：存在本源 local 里（匿名会话，无需账号）。
function KJ_effectiveSessionCookie() {
    return KJ_localGet('anon_session') || null;
}

function KJ_isSessionRequired401(e) {
    var m = (e && e.message) || '';
    return m.indexOf('401') >= 0 &&
        (m.indexOf('playback_user_session_required') >= 0 ||
         m.indexOf('login_required') >= 0 || m.indexOf('需要登录') >= 0);
}

// 从响应头里取 Set-Cookie（承影 req 返回的 headers 可能是对象，也可能是数组/字符串）。
function KJ_pickSessionCookie(headers) {
    var values = [];
    if (!headers) return null;
    if (typeof headers === 'string') {
        values = headers.split('\n');
    } else if (Array.isArray(headers)) {
        values = headers;
    } else if (typeof headers === 'object') {
        for (var k in headers) {
            if (String(k).toLowerCase() === 'set-cookie') {
                var v = headers[k];
                if (Array.isArray(v)) values = values.concat(v);
                else values.push(String(v));
            }
        }
    }
    for (var i = 0; i < values.length; i++) {
        var line = String(values[i]).trim();
        // 响应里同时会带几条清空 cookie（ai_movie_session=; Max-Age=0），只取 ums_ 开头的那条。
        if (line.indexOf('ai_movie_session=ums_') === 0) {
            return line.split(';')[0];
        }
    }
    return null;
}

// ---------- HTTP ----------

// 带签名的 POST，返回 {json, cookies}；非 2xx 抛错。
function KJ_postJson(path, bodyObj) {
    var headers = {
        'User-Agent': KJ_MOBILE_UA,
        'Accept': 'application/json',
        'Referer': 'https://kanju.ai/',
        'Content-Type': 'application/json'
    };
    var sess = KJ_effectiveSessionCookie();
    if (sess) headers['Cookie'] = sess;
    var sign = KJ_signHeaders('POST', path);
    for (var k in sign) headers[k] = sign[k];
    for (var e in KJ_EXTRA_HEADERS) headers[e] = KJ_EXTRA_HEADERS[e];
    var res = req(KJ_BASE + path, {
        method: 'POST',
        body: JSON.stringify(bodyObj || {}),
        headers: headers,
        timeout: 20000
    });
    if (!res) throw new Error('无响应: ' + path);
    if (res.error) throw new Error('请求失败: ' + res.error);
    var body = res.content || '';
    var code = res.code || 0;
    if (code < 200 || code >= 300) {
        var errObj = null;
        try { errObj = JSON.parse(body); } catch (ex) { /* 不是 JSON */ }
        var msg = (errObj && errObj.message) || '';
        var errCode = (errObj && errObj.code) || '';
        throw new Error('HTTP ' + code + (errCode ? ' ' + errCode : '') + (msg ? '：' + msg : ''));
    }
    var json = {};
    try { json = JSON.parse(body); } catch (ex) { /* 空正文 */ }
    return { json: json, cookies: KJ_pickSessionCookie(res.headers) ? [KJ_pickSessionCookie(res.headers)] : [] };
}

// 带签名的 GET，返回 JSONObject；非 2xx 抛错（原因会显示给用户）。
function KJ_getJson(path, signed) {
    var headers = {
        'User-Agent': KJ_MOBILE_UA,
        'Accept': 'application/json',
        'Referer': 'https://kanju.ai/'
    };
    var sess = KJ_effectiveSessionCookie();
    if (sess) headers['Cookie'] = sess;
    if (signed !== false) {
        var sign = KJ_signHeaders('GET', path);
        for (var k in sign) headers[k] = sign[k];
        for (var e in KJ_EXTRA_HEADERS) headers[e] = KJ_EXTRA_HEADERS[e];
    }
    var res = req(KJ_BASE + path, { headers: headers, timeout: 20000 });
    if (!res) throw new Error('无响应: ' + path);
    if (res.error) throw new Error('请求失败: ' + res.error);
    var body = res.content || '';
    var code = res.code || 0;
    if (code < 200 || code >= 300) {
        throw new Error('看剧请求失败（HTTP ' + code + '）：' + body.slice(0, 200));
    }
    return JSON.parse(body || '{}');
}

// 懒取匿名会话：没有才拿一次；拿不到也不抛错——免费剧集不用会话也能播，401 时会再刷新一次。
function KJ_ensureAnonSession() {
    if (KJ_effectiveSessionCookie()) return;
    try {
        KJ_fetchAnonSession();
    } catch (e) {
        // 拿不到就保持无会话，不致命。
    }
}

// 401 后刷新：清掉旧匿名会话，重新拿一个。
function KJ_refreshAnonSession(failedCookie) {
    var cur = KJ_effectiveSessionCookie();
    if (cur && cur !== failedCookie) return;
    KJ_localSet('anon_session', '');
    try {
        KJ_fetchAnonSession();
    } catch (e) {
        // 刷新失败：保持无会话，调用方按原错抛错，不编造地址。
    }
}

function KJ_fetchAnonSession() {
    var r = KJ_postJson('/v1/users/anonymous', {});
    if (r.cookies && r.cookies.length) {
        KJ_localSet('anon_session', r.cookies[0]);
    }
}

// ---------- JSON 解析小工具 ----------

function KJ_optStr(o, key) {
    if (!o || o[key] == null) return '';
    return String(o[key]);
}

function KJ_jsonArrayToStringList(arr) {
    if (!arr) return '';
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var s = String(arr[i] || '');
        if (s) out.push(s);
    }
    return out.join('、');
}

function KJ_cardToVod(card) {
    var id = KJ_optStr(card, 'id');
    var title = KJ_optStr(card, 'title');
    var cover = KJ_optStr(card, 'poster_url');
    var directors = KJ_jsonArrayToStringList(card.directors);
    var actors = KJ_jsonArrayToStringList(card.actors);
    var year = card.year || 0;
    var area = KJ_optStr(card, 'area');
    var remarks = KJ_optStr(card, 'remarks');
    var author = [directors, year > 0 ? String(year) : '', area].filter(function (x) { return x; }).join(' · ');
    return {
        vod_id: 'kanju:catalog:' + id,
        vod_name: title,
        vod_pic: cover,
        vod_remarks: remarks,
        vod_content: KJ_optStr(card, 'description')
    };
}

function KJ_cardsToVods(arr) {
    var list = [];
    if (!arr) return list;
    for (var i = 0; i < arr.length; i++) {
        var card = arr[i] || {};
        if (!KJ_optStr(card, 'id') || !KJ_optStr(card, 'title')) continue;
        list.push(KJ_cardToVod(card));
    }
    return list;
}

function KJ_totalPagesOf(root, limit) {
    var pagination = root.pagination;
    if (!pagination) return 1;
    var total = pagination.total || 0;
    if (total <= 0) return pagination.has_more ? 2 : 1;
    return Math.ceil(total / limit);
}

// ---------- 搜索 ----------

function KJ_searchImpl(keywords, page) {
    var q = KJ_enc(keywords);
    // 先问 suggest 拿计划里的 kind（实测：suggestions[0].plan.kind，如 "movie"）。
    var kind = 'movie';
    try {
        var suggest = KJ_getJson('/v1/suggest?q=' + q);
        var suggestions = suggest.suggestions;
        if (suggestions && suggestions.length > 0) {
            var plan = suggestions[0].plan;
            var k = (plan && KJ_optStr(plan, 'kind')) || '';
            if (KJ_KINDS.indexOf(k) >= 0) kind = k;
        }
    } catch (e) {
        // suggest 失败不致命，下面按 kind 逐个试。
    }
    var tryKinds = [kind];
    for (var i = 0; i < KJ_KINDS.length; i++) {
        if (KJ_KINDS[i] !== kind) tryKinds.push(KJ_KINDS[i]);
    }
    for (var j = 0; j < tryKinds.length; j++) {
        var root = KJ_getJson('/v1/browse/catalog?kind=' + tryKinds[j] + '&q=' + q + '&limit=20&page=' + page);
        var list = KJ_cardsToVods(root.cards);
        if (list.length) {
            return { list: list, totalPage: KJ_totalPagesOf(root, 20) };
        }
    }
    return { list: [], totalPage: 1 };
}

// ---------- 播放解析 ----------

// 线路标识：provider_id + play_from + label；前两项都没有就只用 label。
function KJ_lineKey(line) {
    var provider = KJ_optStr(line, 'provider_id');
    var playFrom = KJ_optStr(line, 'play_from');
    var label = KJ_optStr(line, 'label');
    if (provider || playFrom) return provider + '|' + playFrom + '|' + label;
    return label || KJ_optStr(line, 'playback_source_id');
}

// 从地址本身推断媒体类型：.m3u8 / .mp4（去掉 ? 后的查询串再看后缀）。
function KJ_kindOfUrl(url) {
    var path = url.split('?')[0].split('#')[0].toLowerCase();
    if (path.slice(-5) === '.m3u8') return 'm3u8';
    if (path.slice(-4) === '.mp4') return 'mp4';
    return '';
}

// 图片地址绝不能当播放地址。
var KJ_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
function KJ_isImageUrl(url) {
    var lower = url.toLowerCase();
    if (lower.indexOf('~tplv') >= 0 || lower.indexOf('/tplv') >= 0) return true;
    var path = lower.split('?')[0].split('#')[0];
    if (path.slice(-6) === '.image') return true;
    for (var i = 0; i < KJ_IMAGE_EXTENSIONS.length; i++) {
        if (path.slice(-KJ_IMAGE_EXTENSIONS[i].length) === KJ_IMAGE_EXTENSIONS[i]) return true;
    }
    return false;
}

// 解析单条线路：url 是 http 直链就直接用；是 resolve 票据就调 resolve-line 换直链。
// 成功返回 {label, url, key, urlKind}，失败返回 null。
function KJ_resolveOneLine(line) {
    var label = KJ_optStr(line, 'label') || KJ_optStr(line, 'playback_source_id');
    var key = KJ_lineKey(line);
    var rawUrl = KJ_optStr(line, 'url');
    if (rawUrl.indexOf('http') === 0) {
        var kind = KJ_optStr(line, 'url_kind') || KJ_kindOfUrl(rawUrl);
        return { label: label, url: rawUrl, key: key, urlKind: kind };
    }
    var ticket = KJ_optStr(line, 'resolve_ticket') ||
        (rawUrl.indexOf('resolve://') === 0 ? rawUrl.slice('resolve://'.length) : '');
    if (!ticket || ticket === rawUrl) return null;
    var root;
    try {
        root = KJ_postJson('/v1/playback/resolve-line?view=compact', { ticket: ticket }).json;
    } catch (e) {
        // 401 需要会话（某集起设门）：刷新匿名会话后只重试一次；再 401 就如实抛错。
        if (KJ_isSessionRequired401(e)) {
            KJ_refreshAnonSession(KJ_effectiveSessionCookie());
            root = KJ_postJson('/v1/playback/resolve-line?view=compact', { ticket: ticket }).json;
        } else throw e;
    }
    var lineObj = (root && root.line) || {};
    var resolvedUrl = KJ_optStr(lineObj, 'url');
    if (resolvedUrl.indexOf('http') !== 0) return null;
    var kind2 = KJ_optStr(lineObj, 'url_kind') || KJ_kindOfUrl(resolvedUrl);
    return { label: label, url: resolvedUrl, key: key, urlKind: kind2 };
}

// 第一次点播的胜出线路（只记内存），之后各集直接用它，不再逐条试。
var KJ_rememberedWinnerKey = null;
// 第一次点播解析出的线路顺序（m3u8 在前），供之后换线时按这个顺序试。
var KJ_probeRankedKeys = [];
// 同一集内已试过的线路（只记内存，最多 32 集），退出重进就是手动换线。
var KJ_triedLinesByEpisode = {};
var KJ_MAX_TRIED_EPISODES = 32;

function KJ_markLineTried(token, key) {
    if (!key) return;
    var set = KJ_triedLinesByEpisode[token];
    if (!set) {
        var keys = Object.keys(KJ_triedLinesByEpisode);
        if (keys.length >= KJ_MAX_TRIED_EPISODES) delete KJ_triedLinesByEpisode[keys[0]];
        set = {};
        KJ_triedLinesByEpisode[token] = set;
    }
    set[key] = true;
}

function KJ_triedKeysFor(token) {
    return KJ_triedLinesByEpisode[token] || {};
}

function KJ_resetTriedIfAllTried(token, allKeys) {
    if (!allKeys.length) return;
    var set = KJ_triedLinesByEpisode[token];
    if (!set) return;
    var all = true;
    for (var i = 0; i < allKeys.length; i++) {
        if (!set[allKeys[i]]) { all = false; break; }
    }
    if (all) KJ_triedLinesByEpisode[token] = {};
}

function KJ_rankCandidates(candidates) {
    var rank = KJ_probeRankedKeys;
    if (!rank.length) return candidates;
    var indexOf = {};
    for (var i = 0; i < rank.length; i++) indexOf[rank[i]] = i;
    return candidates.slice().sort(function (a, b) {
        var ia = indexOf[KJ_lineKey(a)];
        var ib = indexOf[KJ_lineKey(b)];
        if (ia == null) ia = 1000000;
        if (ib == null) ib = 1000000;
        return ia - ib;
    });
}

// 兜底：去详情/章节接口里找旧的 playback_groups 直链，顺序 yjm3u8 → yjplayer → yjapi；
// JSON 里带 url_kind 的，m3u8 的直链优先，mp4 其次。找不到返回 null。
function KJ_fallbackDetailUrls(variantId) {
    var groupOrder = ['yjm3u8', 'yjplayer', 'yjapi'];
    var found = {};
    var foundM3u8 = {};
    var foundMp4 = {};
    function collectHttp(obj, group) {
        if (obj == null) return;
        if (typeof obj === 'string') {
            if (obj.indexOf('http') === 0 && group && !KJ_isImageUrl(obj)) {
                if (!found[group]) found[group] = [];
                found[group].push(obj);
            }
            return;
        }
        if (Array.isArray(obj)) {
            for (var i = 0; i < obj.length; i++) collectHttp(obj[i], group);
            return;
        }
        if (typeof obj === 'object') {
            var u = obj.url;
            var kind = KJ_optStr(obj, 'url_kind');
            if (typeof u === 'string' && u.indexOf('http') === 0 && !KJ_isImageUrl(u)) {
                var target = kind === 'm3u8' ? foundM3u8 : (kind === 'mp4' ? foundMp4 : null);
                if (target) {
                    var g = group || '__urls__';
                    if (!target[g]) target[g] = [];
                    target[g].push(u);
                }
            }
            for (var k in obj) {
                var v = obj[k];
                if (groupOrder.indexOf(k) >= 0 && v && typeof v === 'object') collectHttp(v, k);
                else if (k === 'urls' && v && typeof v === 'object') collectHttp(v, group || '__urls__');
                else collectHttp(v, group);
            }
        }
    }
    var roots = [
        function () { return KJ_getJson('/v1/catalog/' + variantId + '/detail'); },
        function () { return KJ_getJson('/v1/catalog/' + variantId); },
        function () { return KJ_getJson('/v1/catalog/' + variantId + '/episodes?limit=48&offset=0'); }
    ];
    for (var i = 0; i < roots.length; i++) {
        try { collectHttp(roots[i](), null); } catch (e) { /* 这个接口失败就试下一个，不致命 */ }
    }
    for (var j = 0; j < groupOrder.length; j++) {
        var g = groupOrder[j];
        if (foundM3u8[g] && foundM3u8[g].length) return foundM3u8[g][0];
        if (foundMp4[g] && foundMp4[g].length) return foundMp4[g][0];
        if (found[g] && found[g].length) return found[g][0];
    }
    if (foundM3u8['__urls__'] && foundM3u8['__urls__'].length) return foundM3u8['__urls__'][0];
    if (foundMp4['__urls__'] && foundMp4['__urls__'].length) return foundMp4['__urls__'][0];
    if (found['__urls__'] && found['__urls__'].length) return found['__urls__'][0];
    return null;
}

// 把章节地址解析成最终可播地址。
// 章节地址格式：kanju:episode:{variantId}:{episodeToken}（token 只是凭证，不是播放地址）。
function KJ_resolvePlayUrl(episodeUrl) {
    if (episodeUrl.indexOf('kanju:episode:') !== 0) {
        throw new Error('看剧：不认识的章节地址');
    }
    var rest = episodeUrl.slice('kanju:episode:'.length);
    var parts = rest.split(':');
    if (parts.length < 2 || !parts[0] || !parts[1]) {
        throw new Error('看剧：章节地址缺 token');
    }
    var variantId = parts[0];
    var token = parts[1];

    // 1) 取线路列表。先懒取匿名会话（只在第一次取流前拿一次，之后一直用存着的）；
    //    某集起可能要求会话，resolve 本身 401 时也刷新一次再重试一次。
    var resolve;
    try {
        KJ_ensureAnonSession();
        resolve = KJ_getJson('/v1/playback/resolve/' + KJ_enc(token) + '?view=compact');
    } catch (e) {
        if (KJ_isSessionRequired401(e)) {
            KJ_refreshAnonSession(KJ_effectiveSessionCookie());
            resolve = KJ_getJson('/v1/playback/resolve/' + KJ_enc(token) + '?view=compact');
        } else throw e;
    }
    var lines = (resolve && resolve.line_options) || [];
    if (!lines.length) {
        throw new Error('看剧：取流返回里没有线路（line_options 为空）');
    }
    // 线路选择：selected=true 优先，其次 default_priority=true，
    // 再按 preference_weight 从大到小；其余保持服务端返回顺序。
    var indexed = [];
    for (var i = 0; i < lines.length; i++) {
        if (lines[i]) indexed.push({ idx: i, line: lines[i] });
    }
    indexed.sort(function (x, y) {
        var a = x.line, b = y.line;
        if (!!b.selected !== !!a.selected) return b.selected ? 1 : -1;
        if (!!b.default_priority !== !!a.default_priority) return b.default_priority ? 1 : -1;
        var wa = a.preference_weight || 0, wb = b.preference_weight || 0;
        if (wb !== wa) return wb - wa;
        return x.idx - y.idx;
    });
    var ordered = indexed.map(function (x) { return x.line; });

    // 2) 第一次点播：按优先级顺序逐条解析（JS 没有并行测速），第一条 m3u8
    //    就返回并记住它；没有 m3u8 才用第一条解析出的直链。
    //    之后各集：先试记住的胜出线路，不再逐条试。
    //    本集已试过的线路跳过——退出重进就是手动换线。
    var allKeys = ordered.map(KJ_lineKey);
    KJ_resetTriedIfAllTried(token, allKeys);
    var tried = KJ_triedKeysFor(token);
    var candidates = ordered.filter(function (l) { return !tried[KJ_lineKey(l)]; });

    var winnerKey = KJ_rememberedWinnerKey;
    if (winnerKey) {
        var winnerLine = null;
        for (var w = 0; w < candidates.length; w++) {
            if (KJ_lineKey(candidates[w]) === winnerKey) { winnerLine = candidates[w]; break; }
        }
        if (winnerLine) {
            try {
                var resolvedWinner = KJ_resolveOneLine(winnerLine);
                if (resolvedWinner) {
                    KJ_markLineTried(token, resolvedWinner.key);
                    return resolvedWinner.url;
                }
            } catch (e) {
                // 记住的线路解析失败，往下按顺序试，不致命。
            }
        }
    } else {
        // 第一次点播：逐条解析，记下解析顺序供之后换线用。
        var resolvedList = [];
        var lastErr = '';
        for (var r = 0; r < candidates.length; r++) {
            var line = candidates[r];
            var label = KJ_optStr(line, 'label') || KJ_optStr(line, 'playback_source_id');
            try {
                var rl = KJ_resolveOneLine(line);
                if (rl) resolvedList.push(rl);
            } catch (e) {
                lastErr = '线路 ' + label + '：' + ((e.message || '解析失败').slice(0, 120));
            }
        }
        if (resolvedList.length) {
            // m3u8 在前、其余按解析顺序排，供之后换线用。
            var ranked = resolvedList.slice().sort(function (a, b) {
                if ((a.urlKind === 'm3u8') !== (b.urlKind === 'm3u8')) return a.urlKind === 'm3u8' ? -1 : 1;
                return 0;
            });
            KJ_probeRankedKeys = ranked.map(function (x) { return x.key; });
            var best = ranked[0];
            KJ_rememberedWinnerKey = best.key;
            KJ_markLineTried(token, best.key);
            return best.url;
        }
        // 测速无结果时按顺序逐条再试（resolveOneLine 失败过的不再重复试，
        // 这里只处理上面循环里没覆盖到的情况，实际上已全部试过）。
        if (lastErr) {
            // 继续往下走顺序兜底分支（candidates 已全部试过，会直接落到 fallback）。
        }
    }

    // 3) 按顺序逐条试（换线时按第一次点播的解析顺序，没排名的按优先级；
    //    记住的线路本轮已试过，不再重复试）。优先 m3u8，mp4 留作备选。
    var lastError = '';
    var deferredNonM3u8 = null;
    var rankedCandidates = KJ_rankCandidates(candidates);
    for (var c = 0; c < rankedCandidates.length; c++) {
        var cline = rankedCandidates[c];
        if (KJ_lineKey(cline) === winnerKey) continue;
        var clabel = KJ_optStr(cline, 'label') || KJ_optStr(cline, 'playback_source_id');
        var resolved = null;
        try {
            resolved = KJ_resolveOneLine(cline);
        } catch (e) {
            lastError = '线路 ' + clabel + '：' + ((e.message || '解析失败').slice(0, 120));
            continue;
        }
        if (!resolved) {
            lastError = '线路 ' + clabel + ' 没有可解析的地址';
            continue;
        }
        if (resolved.urlKind !== 'm3u8') {
            if (!deferredNonM3u8) deferredNonM3u8 = resolved;
            lastError = '线路 ' + clabel + '：非 m3u8 直链，留作备选（优先 m3u8，免得被下载）';
            continue;
        }
        if (!KJ_rememberedWinnerKey) KJ_rememberedWinnerKey = resolved.key;
        KJ_markLineTried(token, resolved.key);
        return resolved.url;
    }
    if (deferredNonM3u8) {
        if (!KJ_rememberedWinnerKey) KJ_rememberedWinnerKey = deferredNonM3u8.key;
        KJ_markLineTried(token, deferredNonM3u8.key);
        return deferredNonM3u8.url;
    }
    // 兜底：resolve 两步都没拿到，去详情/章节接口里找旧的 playback_groups 直链。
    var fb = KJ_fallbackDetailUrls(variantId);
    if (fb) return fb;
    throw new Error(
        '看剧暂未返回可播地址：试了 ' + ordered.length + ' 条线路都不行，最后一条：' + lastError +
        '。如果是 402，就是 kanju 的播放词元不够；其他情况请把这段报错原文发我。'
    );
}

// ---------- 分类 ----------

function KJ_categoryMenus() {
    function tabs(kind, genres) {
        var list = [{ type_id: 'kanju:browse:' + kind, type_name: '全部' }];
        for (var i = 0; i < genres.length; i++) {
            list.push({ type_id: 'kanju:browse:' + kind + ':genre=' + genres[i], type_name: genres[i] });
        }
        return list;
    }
    return [
        { group: '推荐', tabs: [
            { type_id: 'kanju:home', type_name: '推荐' },
            { type_id: 'kanju:updates', type_name: '最近更新' }
        ] },
        { group: '电视剧', tabs: tabs('series', ['偶像', '爱情', '言情', '古装', '历史', '玄幻', '谍战', '历险', '都市', '科幻', '军旅', '喜剧']) },
        { group: '电影', tabs: tabs('movie', ['喜剧', '爱情', '动作', '犯罪', '科幻', '奇幻', '冒险', '灾难', '恐怖', '惊悚', '剧情', '战争']) },
        { group: '动漫', tabs: tabs('anime', ['热血', '格斗', '机战', '少女', '竞技', '科幻', '魔幻', '爆笑', '推理', '冒险', '恋爱', '校园']) },
        { group: '综艺', tabs: tabs('variety', ['真人秀', '选秀', '网综', '脱口秀', '搞笑', '竞技', '情感', '访谈', '演唱会', '晚会']) },
        { group: '短剧', tabs: tabs('short_drama', ['真人剧', '偶像', '爱情', '言情', '古装', '历史', '玄幻', '谍战', '都市', '历险', '科幻']) }
    ];
}

function KJ_parseKanjuUrl(url) {
    var map = {};
    var parts = url.split(':');
    if (parts.length >= 3) map.kind = parts[2];
    for (var i = 3; i < parts.length; i++) {
        var kv = parts[i].split('=');
        if (kv.length === 2) map[kv[0]] = kv[1];
    }
    return map;
}

function KJ_categoryImpl(url) {
    // 首页推荐：/v1/feed/home 的各 section 卡片拼在一起。
    if (url.indexOf('kanju:home') === 0) {
        var root = KJ_getJson('/v1/feed/home');
        var list = [];
        var sections = root.sections || [];
        for (var i = 0; i < sections.length; i++) {
            list = list.concat(KJ_cardsToVods(sections[i].cards));
        }
        if (!list.length) {
            // home 为空时退到最新电影，避免空白页。
            var fallback = KJ_getJson('/v1/browse/catalog?kind=movie&limit=20&page=1');
            list = list.concat(KJ_cardsToVods(fallback.cards));
        }
        return { list: list, page: 1, totalPage: 1, nextUrl: '' };
    }
    var params = KJ_parseKanjuUrl(url);
    var page = Math.max(1, parseInt(params.page, 10) || 1);
    // 最近更新：按更新时间倒序的电视剧。
    if (url.indexOf('kanju:updates') === 0) {
        var uroot = KJ_getJson('/v1/browse/catalog?kind=series&sort=updated_desc&limit=20&page=' + page);
        var ulist = KJ_cardsToVods(uroot.cards);
        var utotal = KJ_totalPagesOf(uroot, 20);
        var unext = page < utotal ? 'kanju:updates:page=' + (page + 1) : '';
        return { list: ulist, page: page, totalPage: utotal, nextUrl: unext };
    }
    // 普通分类浏览：kanju:browse:{kind}[:genre=..][:area=..][:language=..][:page=N]
    var kind = params.kind || 'movie';
    var query = '/v1/browse/catalog?kind=' + kind + '&limit=20&page=' + page;
    if (params.genre) query += '&genre=' + KJ_enc(params.genre);
    if (params.area) query += '&area=' + KJ_enc(params.area);
    if (params.language) query += '&language=' + KJ_enc(params.language);
    if (params.sort) query += '&sort=' + KJ_enc(params.sort);
    var broot = KJ_getJson(query);
    var blist = KJ_cardsToVods(broot.cards);
    var btotal = KJ_totalPagesOf(broot, 20);
    var bnext = '';
    if (page < btotal) {
        var base = url.split(':page=')[0];
        bnext = base + ':page=' + (page + 1);
    }
    return { list: blist, page: page, totalPage: btotal, nextUrl: bnext };
}

// ---------- 详情 / 章节 ----------

function KJ_avIdOf(bookUrl) {
    if (bookUrl.indexOf('kanju:catalog:') === 0) return bookUrl.slice('kanju:catalog:'.length);
    if (bookUrl.indexOf('av_') === 0) return bookUrl;
    if (bookUrl.indexOf('/v1/catalog/') >= 0) {
        return bookUrl.split('/v1/catalog/')[1].split('?')[0].split('/')[0];
    }
    return bookUrl;
}

function KJ_detailObject(root) {
    var catalog = root.catalog;
    var nested = catalog && catalog.detail;
    return nested || root;
}

function KJ_episodesFromArray(arr, variantId, baseIndex) {
    var list = [];
    if (!arr) return list;
    for (var i = 0; i < arr.length; i++) {
        var ep = arr[i] || {};
        var token = KJ_optStr(ep, 'token');
        if (!token) continue;
        var number = 0;
        if (ep.episode_number != null) number = ep.episode_number;
        else if (ep.number != null) number = ep.number;
        else if (ep.sequence_index != null) number = ep.sequence_index + 1;
        var n = number > 0 ? number : (baseIndex || 0) + i + 1;
        list.push({ name: '第' + n + '集', playId: 'kanju:episode:' + variantId + ':' + token });
    }
    return list;
}

function KJ_detailImpl(bookUrl) {
    var avId = KJ_avIdOf(bookUrl);
    var detail = KJ_detailObject(KJ_getJson('/v1/catalog/' + avId));
    var variantId = KJ_optStr(detail, 'variant_id') || avId;
    var intro = KJ_optStr(detail, 'description');
    var artist = KJ_jsonArrayToStringList(detail.actors);
    var author = KJ_jsonArrayToStringList(detail.directors);
    var cover = KJ_optStr(detail, 'poster_url');
    var episodeCount = detail.episode_count || 0;

    var episodes = KJ_episodesFromArray(detail.episodes, variantId, 0);
    // 章节是分页的：详情只给了第一批，继续拉完。
    var pagination = detail.episode_pagination;
    var hasMore = pagination && pagination.has_more;
    var offset = episodes.length;
    while (hasMore && offset < 500) {
        var pageRoot = KJ_getJson('/v1/catalog/' + avId + '/episodes?offset=' + offset + '&limit=48');
        var got = KJ_episodesFromArray(pageRoot.episodes, variantId, offset);
        if (!got.length) break;
        episodes = episodes.concat(got);
        offset += got.length;
        var pg = pageRoot.episode_pagination;
        hasMore = pg && pg.has_more;
    }
    return {
        vod_id: bookUrl,
        vod_name: KJ_optStr(detail, 'title') || '',
        vod_pic: cover,
        vod_content: intro,
        vod_remarks: author || artist || '',
        vod_play_from: '看剧',
        vod_play_url: episodes.map(function (e) { return e.name + '$' + e.playId; }).join('#')
    };
}

// ---------- CatVod Spider ----------

function init(cfg) {
    // 无需配置；匿名会话按需生成、存在 local 里。
}

function homeContent(filter) {
    var menus = KJ_categoryMenus();
    var classes = [];
    for (var i = 0; i < menus.length; i++) {
        for (var j = 0; j < menus[i].tabs.length; j++) {
            classes.push({ type_id: menus[i].tabs[j].type_id, type_name: menus[i].tabs[j].type_name });
        }
    }
    return JSON.stringify({ 'class': classes });
}

function homeVideoContent() {
    try {
        var r = KJ_categoryImpl('kanju:home');
        return JSON.stringify({ list: r.list });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var page = parseInt(pg, 10) || 1;
    var url = String(tid || '');
    if (!url) {
        return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
    // type_id 里可能已经带了页码（kanju:browse:movie:page=1），用 pg 覆盖它。
    if (url.indexOf(':page=') >= 0) url = url.split(':page=')[0] + ':page=' + page;
    else if (url.indexOf('kanju:browse:') === 0 || url.indexOf('kanju:updates') === 0) url += ':page=' + page;
    try {
        var r = KJ_categoryImpl(url);
        return JSON.stringify({
            page: page,
            pagecount: r.totalPage,
            limit: 20,
            total: r.list.length,
            list: r.list
        });
    } catch (e) {
        // 分类间歇加载失败是已知问题：返回空，不编结果。
        return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var r = KJ_searchImpl(kw, 1);
    return JSON.stringify({
        page: 1,
        pagecount: r.totalPage,
        limit: 20,
        total: r.list.length,
        list: r.list
    });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var vod = KJ_detailImpl(id);
    return JSON.stringify({ list: [vod] });
}

function playerContent(flag, id, vipFlags) {
    var url = KJ_resolvePlayUrl(String(id || ''));
    return JSON.stringify({
        parse: 0,
        url: url,
        header: { 'Referer': 'https://kanju.ai/', 'User-Agent': KJ_MOBILE_UA }
    });
}

var spider = {
    init: init,
    homeContent: homeContent,
    homeVideoContent: homeVideoContent,
    categoryContent: categoryContent,
    detailContent: detailContent,
    searchContent: searchContent,
    playerContent: playerContent,
    // 登录入口：没有单独的 /login 路由，登录是首页弹窗，用首页做入口。
    getLoginUrl: function () { return 'https://kanju.ai/'; }
};

// 承影用 spider.__jsEvalReturn()（或 spider.default）加载本插件。
function __jsEvalReturn() {
    return spider;
}