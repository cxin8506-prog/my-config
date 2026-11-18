var DY_SITE = 'https://www.douyin.com';
var DY_LIVE_SITE = 'https://live.douyin.com';
var DY_CREATOR = 'https://creator.douyin.com';
var DY_NS = 'douyin';
var DY_GEO = '1920|855|1920|1032|1920|1032|1920|1080|Win32';
var DY_MS_TOKEN_CHARS = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=';
var DY_UA_FALLBACK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var DY_NOT_LOGGED_IN = '还没有登录抖音：在网页里登录抖音（验证码自己过），把 douyin.com 的 Cookie 复制出来，在本源里搜“cookie:你的Cookie”保存，登完再试。';

var DY_WORDS = [
    '有声小说', '有声书', '评书', '相声', '广播剧', '睡前故事',
    '读书', '脱口秀', '电影解说', '纪录片', '音乐现场', '英语听力'
];

// ---------- 通用小工具 ----------

function DY_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function DY_encURIComponent(s) {
    return encodeURIComponent(s);
}

function DY_localGet(key) {
    try {
        if (typeof local === 'undefined') return '';
        var v = local.get(DY_NS, key);
        return v ? String(v) : '';
    } catch (e) { return ''; }
}

function DY_localSet(key, val) {
    try {
        if (typeof local === 'undefined') return false;
        local.set(DY_NS, key, val);
        return true;
    } catch (e) { return false; }
}

// UTF-8 编码（不用 TextEncoder，承影 JS 环境不一定有）。
function DY_utf8Bytes(s) {
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

function DY_hexBytes(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
        var h = (bytes[i] & 0xFF).toString(16);
        s += h.length === 1 ? '0' + h : h;
    }
    return s;
}

function DY_random() { return DY_randomFn(); }
var DY_randomFn = Math.random;
function DY_setRandom(fn) { DY_randomFn = fn; }
function DY_nowMs() { return DY_nowMsFn(); }
var DY_nowMsFn = function () { return Date.now(); };
function DY_setNowMs(fn) { DY_nowMsFn = fn; }

// ---------- MD5（纯 JS，x-secsdk-web-signature 和 myInfo 都用它） ----------

function DY_md5Hex(input) {
    var msg = DY_utf8Bytes(input);
    var bitLen = msg.length * 8;
    var padded = msg.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    var low = bitLen >>> 0;
    var high = Math.floor(bitLen / 4294967296);
    for (var i = 0; i < 4; i++) padded.push((low >>> (i * 8)) & 0xFF);
    for (var j = 0; j < 4; j++) padded.push((high >>> (j * 8)) & 0xFF);

    var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
             5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
             4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
             6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    var K = [];
    for (var k = 0; k < 64; k++) K.push(Math.floor(Math.abs(Math.sin(k + 1)) * 4294967296) >>> 0);

    function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) | 0; }

    var a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;
    for (var off = 0; off < padded.length; off += 64) {
        var M = [];
        for (var w = 0; w < 16; w++) {
            M.push((padded[off + w * 4] | (padded[off + w * 4 + 1] << 8) |
                (padded[off + w * 4 + 2] << 16) | (padded[off + w * 4 + 3] << 24)) | 0);
        }
        var A = a0, B = b0, C = c0, D = d0;
        for (var r = 0; r < 64; r++) {
            var F, g;
            if (r < 16) { F = (B & C) | (~B & D); g = r; }
            else if (r < 32) { F = (D & B) | (~D & C); g = (5 * r + 1) % 16; }
            else if (r < 48) { F = B ^ C ^ D; g = (3 * r + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * r) % 16; }
            F = (F + A + K[r] + M[g]) | 0;
            A = D; D = C; C = B;
            B = (B + rotl(F, S[r])) | 0;
        }
        a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    function leWord(x) {
        return String.fromCharCode(x & 0xFF, (x >>> 8) & 0xFF, (x >>> 16) & 0xFF, (x >>> 24) & 0xFF);
    }
    var raw = leWord(a0) + leWord(b0) + leWord(c0) + leWord(d0);
    var out = '';
    for (var q = 0; q < raw.length; q++) {
        var h = raw.charCodeAt(q).toString(16);
        out += h.length === 1 ? '0' + h : h;
    }
    return out;
}

// ---------- SM3（国密杂凑，纯 JS） ----------

function DY_rotl32(x, n) {
    n &= 31;
    x |= 0;
    return n === 0 ? x : ((x << n) | (x >>> (32 - n)));
}

function DY_sm3(bytes) {
    var msg = bytes.slice();
    var bits = bytes.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var high = Math.floor(bits / 4294967296);
    var low = bits >>> 0;
    msg.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255,
             (low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255);

    var v = [0x7380166F, 0x4914B2B9, 0x172442D7, 0xDA8A0600,
             0xA96F30BC, 0x163138AA, 0xE38DEE4D, 0xB0FB0E4E];
    var w = new Array(68);
    var w1 = new Array(64);
    var off = 0;
    while (off < msg.length) {
        for (var i = 0; i < 16; i++) {
            w[i] = (((msg[off + i * 4] & 0xFF) << 24) | ((msg[off + i * 4 + 1] & 0xFF) << 16) |
                ((msg[off + i * 4 + 2] & 0xFF) << 8) | (msg[off + i * 4 + 3] & 0xFF)) | 0;
        }
        for (var j = 16; j < 68; j++) {
            var x = (w[j - 16] ^ w[j - 9] ^ DY_rotl32(w[j - 3], 15)) | 0;
            w[j] = (x ^ DY_rotl32(x, 15) ^ DY_rotl32(x, 23) ^ DY_rotl32(w[j - 13], 7) ^ w[j - 6]) | 0;
        }
        for (var jj = 0; jj < 64; jj++) w1[jj] = (w[jj] ^ w[jj + 4]) | 0;

        var a = v[0], b = v[1], c = v[2], d = v[3];
        var e = v[4], f = v[5], g = v[6], h = v[7];
        for (var t = 0; t < 64; t++) {
            var tj = t < 16 ? 0x79CC4519 : 0x7A879D8A;
            var a12 = DY_rotl32(a, 12);
            var ss1 = DY_rotl32((a12 + e + DY_rotl32(tj, t)) | 0, 7);
            var ss2 = ss1 ^ a12;
            var ff = t < 16 ? (a ^ b ^ c) : ((a & b) | (a & c) | (b & c));
            var gg = t < 16 ? (e ^ f ^ g) : ((e & f) | ((~e) & g));
            var tt1 = (ff + d + ss2 + w1[t]) | 0;
            var tt2 = (gg + h + ss1 + w[t]) | 0;
            d = c; c = DY_rotl32(b, 9); b = a; a = tt1;
            h = g; g = DY_rotl32(f, 19); f = e;
            e = (tt2 ^ DY_rotl32(tt2, 9) ^ DY_rotl32(tt2, 17)) | 0;
        }
        v = [(a ^ v[0]) | 0, (b ^ v[1]) | 0, (c ^ v[2]) | 0, (d ^ v[3]) | 0,
             (e ^ v[4]) | 0, (f ^ v[5]) | 0, (g ^ v[6]) | 0, (h ^ v[7]) | 0];
        off += 64;
    }
    var out = [];
    for (var m = 0; m < 8; m++) {
        out.push((v[m] >>> 24) & 255, (v[m] >>> 16) & 255, (v[m] >>> 8) & 255, v[m] & 255);
    }
    return out;
}

function DY_sm3Hex(bytes) {
    return DY_hexBytes(DY_sm3(bytes));
}

// ---------- a_bogus ----------

var DY_SALT = 'dhzx';
var DY_AID = 6383;
var DY_SDK_VERSION = 1;
var DY_FORTNIGHT_EPOCH = 1721836800000;
var DY_WEBSIGN_CONST = 'A96D855A08C0A9707F8BEF0D9A527E4E';
var DY_ALPHABET_S3 = 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe';
var DY_ALPHABET_S4 = 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe';
var DY_MAIN_KEYS = { minor: 8, l40: 132, l41: 1, l42: 1, pageId: 11881 };
var DY_LIVE_KEYS = { minor: 12, l40: 0, l41: 0, l42: 0, pageId: 7571 };

var DY_A98_PERM = [
    34, 44, 56, 61, 73, 29, 70, 45, 35, 49, 38, 66, 51, 68, 28, 48, 64, 47,
    30, 71, 26, 55, 31, 69, 59, 40, 62, 63, 27, 72, 41, 74, 57, 52, 42, 39,
    33, 67, 53, 43, 65, 46, 36, 24, 60, 32, 79, 80, 84, 85
];
var DY_CHECK_SLOTS = [
    24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43,
    44, 45, 46, 47, 48, 49, 51, 52, 53, 55, 56, 57, 59, 60, 61, 62, 63, 64,
    65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 79, 80, 84, 85
];
var DY_BROWSER_OFFSET = { Chrome: 0, Firefox: 40, Safari: 81, Edge: 125, Huawei: 170 };

var DY_signCounter = 2;
function DY_resetCounter() { DY_signCounter = 2; }

function DY_b64Custom(data, alphabet) {
    var out = '';
    var i = 0;
    while (i < data.length) {
        var n = Math.min(3, data.length - i);
        var v = ((data[i] & 0xFF) << 16) | ((n > 1 ? (data[i + 1] & 0xFF) : 0) << 8) | (n > 2 ? (data[i + 2] & 0xFF) : 0);
        out += alphabet[(v >> 18) & 63];
        out += alphabet[(v >> 12) & 63];
        out += n > 1 ? alphabet[(v >> 6) & 63] : '=';
        out += n > 2 ? alphabet[v & 63] : '=';
        i += 3;
    }
    return out;
}

function DY_rc4Variant(key, data) {
    var sbox = [];
    for (var i = 0; i < 256; i++) sbox.push(255 - i);
    var j = 0;
    for (var a = 0; a < 256; a++) {
        j = (j * sbox[a] + j + key[a % key.length]) % 256;
        var t = sbox[a]; sbox[a] = sbox[j]; sbox[j] = t;
    }
    var out = [];
    var ii = 0;
    j = 0;
    for (var k = 0; k < data.length; k++) {
        ii = (ii + 1) % 256;
        j = (j + sbox[ii]) % 256;
        var tt = sbox[ii]; sbox[ii] = sbox[j]; sbox[j] = tt;
        out.push((data[k] & 0xFF) ^ sbox[(sbox[ii] + sbox[j]) % 256]);
    }
    return out;
}

// JS 的 strToBytes：非 ASCII 字符按大端拆成两个字节（geo/tail 都是 ASCII，走单字节）。
function DY_strToBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if ((c & 0xFF00) !== 0) { out.push(c >> 8); out.push(c & 255); } else out.push(c);
    }
    return out;
}

// 小端字节。时间戳超过 32 位，不能用移位。
function DY_leBytes(value, count) {
    var out = [];
    var v = value;
    for (var i = 0; i < count; i++) {
        out.push(Math.floor(v % 256));
        v = Math.floor(v / 256);
    }
    return out;
}

function DY_blend(c0, c1, r0, r1) {
    return [
        (r0 & 170) | (c0 & 85), (r0 & 85) | (c0 & 170),
        (r1 & 170) | (c1 & 85), (r1 & 85) | (c1 & 170)
    ];
}

function DY_expand(arr) {
    var out = [];
    var n = arr.length;
    var i = 0;
    while (i < n) {
        if (i + 2 < n) {
            var r = Math.floor(DY_random() * 1000) & 255;
            out.push((r & 145) | (arr[i] & 110));
            out.push((r & 66) | (arr[i + 1] & 189));
            out.push((r & 44) | (arr[i + 2] & 211));
            out.push((arr[i] & 145) | (arr[i + 1] & 66) | (arr[i + 2] & 44));
        } else {
            out.push(arr[i]);
            if (i + 1 < n && arr[i + 1] !== 0) out.push(arr[i + 1]);
        }
        i += 3;
    }
    return out;
}

function DY_escapeDigest(digest, idx, reserved, fallback, force) {
    var i = idx;
    var v = i < digest.length ? (digest[i] & 0xFF) : fallback;
    while (v === reserved) {
        i++;
        v = i < digest.length ? (digest[i] & 0xFF) : fallback;
    }
    return force ? reserved : v;
}

function DY_browserName(ua) {
    if (/\bhuawei\b/i.test(ua)) return 'Huawei';
    if (/(chrome)\/([\w.]+)(?!.*chromium)/i.test(ua)) return 'Chrome';
    if (/(edg|edge)\/([\w.]+)/i.test(ua)) return 'Edge';
    if (/\bfocus\/([\w.]+)/i.test(ua) || /fxios\/([-\w.]+)/i.test(ua) ||
        /(firefox)\/([\w.]+)/i.test(ua)) return 'Firefox';
    if (/(msie |trident.*rv:)([\w.]+)/i.test(ua)) return 'IE';
    if (/(opera|opr)\/([\w.]+)/i.test(ua)) return 'Opera';
    if (/(safari)\/([\w.]+)(?!.*chrome)/i.test(ua)) return 'Safari';
    return 'Other';
}

// query、body 都是拼好的字符串；geo 是 "宽|高|...|平台"。
function DY_aBogus(query, body, ua, geo, keys) {
    var L = [];
    for (var z = 0; z < 86; z++) L.push(0);
    DY_signCounter++;
    var t = DY_nowMs();
    var name = DY_browserName(ua);
    var h1 = DY_sm3(DY_sm3(DY_utf8Bytes(query + DY_SALT)));
    var h2 = DY_sm3(DY_sm3(DY_utf8Bytes(body + DY_SALT)));
    var trimmed = ua.trim();
    var uaChars = [];
    for (var i = 0; i < trimmed.length; i++) uaChars.push(trimmed.charCodeAt(i));
    var uaKey = [Math.floor(DY_SDK_VERSION / 256), DY_SDK_VERSION % 256, keys.minor % 256];
    var hUa = DY_sm3(DY_utf8Bytes(DY_b64Custom(DY_rc4Variant(uaKey, uaChars), DY_ALPHABET_S3)));
    var flags = 1 | (name === 'Firefox' ? 32 : 0);

    function put(start, bytes) {
        for (var k = 0; k < bytes.length; k++) L[start + k] = bytes[k];
    }

    L[24] = 41;
    L[26] = Math.trunc((t - DY_FORTNIGHT_EPOCH) / 1000 / 60 / 60 / 24 / 14);
    L[27] = DY_signCounter > 10745 ? 3 : DY_signCounter > 1283 ? 4 : DY_signCounter > 139 ? 5 : 6;
    L[28] = 3;
    put(29, DY_leBytes(t, 6));
    put(35, DY_leBytes(DY_SDK_VERSION, 2));
    put(38, DY_leBytes(flags, 2));
    L[40] = keys.l40; L[41] = keys.l41; L[42] = keys.l42; L[43] = 0;
    put(44, DY_leBytes(keys.minor, 4));
    L[48] = h1[9] & 0xFF; L[49] = h1[18] & 0xFF;
    L[51] = DY_escapeDigest(h1, 3, 11, 12, (flags & 2) !== 0);
    L[52] = h2[10] & 0xFF; L[53] = h2[19] & 0xFF;
    L[55] = DY_escapeDigest(h2, 4, 8, 9, (flags & 4) !== 0);
    L[56] = hUa[11] & 0xFF; L[57] = hUa[21] & 0xFF;
    L[59] = DY_escapeDigest(hUa, 5, 12, 13, (flags & 8) !== 0);
    put(60, DY_leBytes(t - 1, 6));
    L[66] = 3;
    put(67, DY_leBytes(keys.pageId, 4));
    put(71, DY_leBytes(DY_AID, 4));
    var geoBytes = DY_strToBytes(geo);
    put(79, DY_leBytes(geoBytes.length, 2));
    var tailBytes = DY_strToBytes(((t + 3) & 255) + ',');
    put(84, DY_leBytes(tailBytes.length, 2));

    var v6 = Math.floor(DY_random() * 65535);
    var a8 = DY_blend(1, 0, v6 & 255, (v6 >> 8) & 255);
    DY_random(); // 空调用也要保留（占随机数序列位置）
    var check;
    if ((flags & 64) !== 0) {
        var r = Math.floor(DY_random() * 109);
        check = r + 110 + (r % 2);
    } else {
        var r2 = Math.floor(DY_random() * 240);
        check = r2 > 109 ? r2 + (r2 % 2) + 1 : r2;
    }
    var perms = (Math.floor(DY_random() * 255) & 77) | 2 | 16 | 32 | 128;
    a8 = a8.concat(DY_blend(1, 0, check, perms));

    var chk = 0;
    for (var b = 0; b < a8.length; b++) chk ^= a8[b];
    for (var s = 0; s < DY_CHECK_SLOTS.length; s++) chk ^= L[DY_CHECK_SLOTS[s]];
    var a98 = [];
    for (var p = 0; p < DY_A98_PERM.length; p++) a98.push(L[DY_A98_PERM[p]]);
    a98 = a98.concat(geoBytes).concat(tailBytes);
    a98.push(chk);

    var hr0 = Math.floor(DY_random() * 65535) & 255;
    var offset = Math.floor(DY_random() * 40) + (DY_BROWSER_OFFSET[name] !== undefined ? DY_BROWSER_OFFSET[name] : 210);
    var head = DY_blend(3, 82, hr0, offset);
    var cipher = DY_rc4Variant([211], a8.concat(DY_expand(a98)));
    return DY_b64Custom(head.concat(cipher), DY_ALPHABET_S4);
}

// x-secsdk-web-signature = MD5(uifid + '_' + ts + '_' + 常量 + '_' + query)，小写。
function DY_secsdkSignature(uifid, tsSeconds, query) {
    return DY_md5Hex(uifid + '_' + tsSeconds + '_' + DY_WEBSIGN_CONST + '_' + query);
}

// ---------- HTTP ----------

// 同步请求，返回正文。POST 时传 postBody（表单格式）。
// 非 2xx 也返回正文（抖音用 status_code 报错，不靠 HTTP 码），只有没响应才抛错。
function DY_fetch(url, headers, postBody, timeoutMs) {
    var opts = { headers: headers || {}, timeout: timeoutMs || 30000 };
    if (postBody != null) {
        opts.method = 'POST';
        opts.body = postBody;
    }
    var res = req(url, opts);
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    return res.content || '';
}

// ---------- Cookie / 登录态 ----------

// 手动贴的 Cookie（在本源里搜“cookie:你的Cookie”保存），其次 init 传入的配置。
function DY_cookieStringFor(site) {
    return DY_localGet('cookie').trim();
}

function DY_cookieMap(site) {
    var map = {};
    var parts = DY_cookieStringFor(site).split(';');
    for (var i = 0; i < parts.length; i++) {
        var idx = parts[i].indexOf('=');
        if (idx > 0) map[parts[i].slice(0, idx).trim()] = parts[i].slice(idx + 1).trim();
    }
    return map;
}

function DY_loggedIn(cookie) {
    return !!(cookie.sessionid || cookie.sessionid_ss);
}

function DY_requireLogin(cookie) {
    if (!DY_loggedIn(cookie)) throw new Error(DY_NOT_LOGGED_IN);
}

// ---------- 浏览器信息（照插件的 browser()，从桌面 UA 里取） ----------

function DY_desktopUA() {
    return DY_uaOverride || DY_UA_FALLBACK;
}

// 测试钩子：覆盖桌面 UA（签名交叉验证用，生产不用）。
var DY_uaOverride = '';
function DY_setUA(ua) { DY_uaOverride = ua; }

function DY_browserInfo(ua) {
    ua = ua || DY_desktopUA();
    var mac = ua.indexOf('Macintosh') >= 0;
    var firefox = /Firefox\/([\d.]+)/.exec(ua);
    var chrome = /Chrome\/([\d.]+)/.exec(ua);
    var edge = /Edg\/([\d.]+)/.exec(ua);
    var version = firefox ? firefox[1] : (chrome ? chrome[1] : '151.0.0.0');
    return {
        ua: ua,
        name: firefox ? 'Firefox' : (edge ? 'Edge' : 'Chrome'),
        version: edge ? edge[1] : version,
        engine: firefox ? 'Gecko' : 'Blink',
        engineVersion: version,
        chromeMajor: (chrome && !edge) ? chrome[1].split('.')[0] : '',
        os: mac ? 'Mac OS' : 'Windows',
        osVersion: mac ? '10.15.7' : '10',
        platform: mac ? 'MacIntel' : 'Win32',
        divert: mac ? 'Mac' : 'Windows'
    };
}

function DY_randomString(chars, length) {
    var sb = '';
    for (var i = 0; i < length; i++) sb += chars[Math.floor(DY_random() * chars.length)];
    return sb;
}

function DY_randomMsToken() {
    return DY_randomString(DY_MS_TOKEN_CHARS, 107);
}

// 设备号：页面 HTML 里有真实的，取不到就随机一个（本次运行内保持不变）。
var DY_fakeWebid = '';
function DY_webid() {
    var saved = DY_localGet('webid');
    if (saved) return saved;
    if (DY_fakeWebid) return DY_fakeWebid;
    try {
        var html = DY_fetch(DY_SITE + '/discover', { 'User-Agent': DY_desktopUA() }, null);
        var m = /"user_unique_id"\s*:\s*"(\d+)"/.exec(html);
        if (m) {
            DY_localSet('webid', m[1]);
            return m[1];
        }
    } catch (e) {
        // 取不到就随机
    }
    DY_fakeWebid = '7' + DY_randomString('0123456789', 18);
    return DY_fakeWebid;
}

// ---------- 有顺序的参数表（抖音会核对参数的顺序） ----------

function DY_Params() { this.list = []; }
DY_Params.prototype.add = function (key, value) {
    for (var i = 0; i < this.list.length; i++) {
        if (this.list[i][0] === key) { this.list[i][1] = value; return this; }
    }
    this.list.push([key, value]);
    return this;
};
DY_Params.prototype.get = function (key) {
    for (var i = 0; i < this.list.length; i++) {
        if (this.list[i][0] === key) return this.list[i][1];
    }
    return null;
};
DY_Params.prototype.base = function () {
    return this.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web');
};
DY_Params.prototype.platform = function (b, roundTrip, versionCode, versionName) {
    versionCode = versionCode || '170400';
    versionName = versionName || '17.4.0';
    return this.add('update_version_code', '170400').add('pc_client_type', '1').add('pc_libra_divert', b.divert)
        .add('support_h265', '1').add('support_dash', '1').add('cpu_core_num', '8')
        .add('version_code', versionCode).add('version_name', versionName)
        .add('cookie_enabled', 'true').add('screen_width', '1920').add('screen_height', '1080')
        .add('browser_language', 'zh-CN').add('browser_platform', b.platform).add('browser_name', b.name)
        .add('browser_version', b.version).add('browser_online', 'true').add('engine_name', b.engine)
        .add('engine_version', b.engineVersion).add('os_name', b.os).add('os_version', b.osVersion)
        .add('device_memory', '8').add('platform', 'PC').add('downlink', '10').add('effective_type', '4g')
        .add('round_trip_time', roundTrip);
};
DY_Params.prototype.query = function (encFn) {
    var parts = [];
    for (var i = 0; i < this.list.length; i++) {
        parts.push(this.list[i][0] + '=' + encFn(this.list[i][1]));
    }
    return parts.join('&');
};

// ---------- 调一个接口 ----------

// tail 是末尾几个参数的顺序（各接口不一样）；signed 表示这个接口还要带
// timestamp 和 x-secsdk-web-signature；postBody 不为空时用 POST 发（表单格式）。
function DY_call(path, params, tail, referer, signed, site, postBody) {
    site = site || DY_SITE;
    var cookie = DY_cookieMap(site);
    var b = DY_browserInfo();
    var tailNames = tail.split(',');
    for (var i = 0; i < tailNames.length; i++) {
        var name = tailNames[i];
        if (name === 'webid') params.add('webid', DY_webid());
        else if (name === 'uifid') { if (cookie.UIFID) params.add('uifid', cookie.UIFID); }
        else if (name === 'verifyFp') {
            if (cookie.s_v_web_id) params.add('verifyFp', cookie.s_v_web_id).add('fp', cookie.s_v_web_id);
        }
        else if (name === 'msToken') params.add('msToken', cookie.msToken || DY_randomMsToken());
        else if (name === 'a_bogus') params.add(
            'a_bogus',
            DY_aBogus(params.query(DY_enc), postBody || '', b.ua, DY_GEO,
                site === DY_LIVE_SITE ? DY_LIVE_KEYS : DY_MAIN_KEYS)
        );
    }
    var url;
    if (signed) {
        var query = params.query(DY_encURIComponent);
        var uifid = cookie.UIFID || '';
        var inQuery = params.get('uifid');
        if (inQuery) uifid = inQuery;
        else if (uifid) query += '&uifid=' + DY_encURIComponent(uifid);
        var ts = Math.floor(DY_nowMs() / 1000);
        query += '&timestamp=' + ts;
        url = site + path + '?' + query +
            '&x-secsdk-web-signature=' + DY_secsdkSignature(uifid, ts, query);
    } else {
        url = site + path + '?' + params.query(DY_enc);
    }
    var headers = {};
    headers['User-Agent'] = b.ua;
    headers['Accept'] = 'application/json, text/plain, */*';
    headers['Accept-Language'] = 'zh-CN,zh;q=0.9';
    headers['Referer'] = referer;
    headers['sec-fetch-dest'] = 'empty';
    headers['sec-fetch-mode'] = 'cors';
    headers['sec-fetch-site'] = 'same-origin';
    if (cookie.UIFID) headers['uifid'] = cookie.UIFID;
    if (b.chromeMajor) {
        headers['sec-ch-ua'] = '"Not=A?Brand";v="99", "Google Chrome";v="' + b.chromeMajor + '", "Chromium";v="' + b.chromeMajor + '"';
        headers['sec-ch-ua-mobile'] = '?0';
        headers['sec-ch-ua-platform'] = '"' + (b.os === 'Windows' ? 'Windows' : 'macOS') + '"';
    }
    var cookieHeader = DY_cookieStringFor(site);
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    if (postBody != null) {
        headers['Origin'] = site;
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    var body = DY_fetch(url, headers, postBody).trim();
    if (body.charAt(0) !== '{') {
        if (!DY_loggedIn(cookie)) throw new Error(DY_NOT_LOGGED_IN);
        if (!body) throw new Error('抖音没有返回内容（被风控拦截），请稍后再试，或者重新登录');
        throw new Error('抖音要求人机验证，请在网页里打开登录入口重新登录、完成验证后再试');
    }
    var json = JSON.parse(body);
    var code = json.status_code || 0;
    if (code !== 0) {
        // 2483/20003 都是“没有登录”；登录态失效时也会回 2483
        if (code === 20003 || code === 2483 || !DY_loggedIn(cookie)) {
            throw new Error(DY_NOT_LOGGED_IN + '（抖音返回：' + (json.status_msg || code) + '）');
        }
        throw new Error('抖音接口返回错误：' + (json.status_msg || code));
    }
    return json;
}

// ---------- JSON 小工具 ----------

function DY_deepGet(o, path) {
    var cur = o;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (cur == null) return null;
        if (Array.isArray(cur)) {
            var idx = parseInt(p, 10);
            if (isNaN(idx) || idx < 0 || idx >= cur.length) return null;
            cur = cur[idx];
        } else if (typeof cur === 'object') {
            if (!(p in cur)) return null;
            cur = cur[p];
        } else {
            return null;
        }
        if (cur == null) return null;
    }
    return cur;
}

function DY_jstr(o, path) {
    var v = DY_deepGet(o, path);
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

function DY_jint(o, path, def) {
    var v = DY_deepGet(o, path);
    if (v == null) return def || 0;
    if (typeof v === 'number') return Math.floor(v);
    if (typeof v === 'string') { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }
    if (typeof v === 'boolean') return v ? 1 : 0;
    return def || 0;
}

function DY_jarr(o, path) {
    var v = DY_deepGet(o, path);
    if (!Array.isArray(v)) return [];
    var out = [];
    for (var i = 0; i < v.length; i++) {
        if (v[i] && typeof v[i] === 'object' && !Array.isArray(v[i])) out.push(v[i]);
    }
    return out;
}

function DY_more(json) {
    var hm = json.has_more;
    return hm === 1 || hm === true;
}

// ---------- 各个接口 ----------

function DY_userUrl(secUid) { return DY_SITE + '/user/' + secUid; }
function DY_videoUrl(awemeId) { return DY_SITE + '/video/' + awemeId; }

function DY_userPosts(secUid, cursor) {
    var p = new DY_Params().base()
        .add('sec_user_id', secUid).add('max_cursor', cursor).add('locate_query', 'false')
        .add('show_live_replay_strategy', '1').add('need_time_list', cursor === '0' ? '1' : '0').add('time_list_query', '0')
        .add('whale_cut_token', '').add('cut_version', '1').add('count', '18').add('publish_video_strategy_type', '2')
        .add('from_user_page', '1').platform(DY_browserInfo(), '0', '290100', '29.1.0');
    return DY_call('/aweme/v1/web/aweme/post/', p, 'webid,uifid,msToken,a_bogus,verifyFp', DY_userUrl(secUid), true);
}

function DY_userLikes(secUid, cursor) {
    var p = new DY_Params().base()
        .add('sec_user_id', secUid).add('max_cursor', cursor).add('min_cursor', '0').add('whale_cut_token', '')
        .add('cut_version', '1').add('count', '18').add('publish_video_strategy_type', '2').platform(DY_browserInfo(), '0');
    return DY_call('/aweme/v1/web/aweme/favorite/', p, 'webid,uifid,verifyFp,a_bogus', DY_userUrl(secUid) + '?showTab=like', true);
}

function DY_awemeDetail(awemeId) {
    var p = new DY_Params().base()
        .add('aweme_id', awemeId).add('request_source', '600').add('origin_type', 'video_page')
        .platform(DY_browserInfo(), '50', '190500', '19.5.0');
    var json = DY_call('/aweme/v1/web/aweme/detail/', p, 'webid,uifid,verifyFp,msToken,a_bogus', DY_videoUrl(awemeId), true);
    var detail = json.aweme_detail;
    if (!detail) throw new Error(DY_jstr(json, 'filter_detail.detail_msg') || '作品不存在，或者已被删除、设为私密');
    return detail;
}

function DY_mixAwemes(mixId, cursor, awemeId) {
    var p = new DY_Params().base()
        .add('mix_id', mixId).add('cursor', cursor).add('count', '20')
        .platform(DY_browserInfo(), '50', '190500', '19.5.0');
    return DY_call('/aweme/v1/web/mix/aweme/', p, 'webid,uifid,verifyFp,msToken,a_bogus', DY_videoUrl(awemeId), true);
}

function DY_userProfile(secUid) {
    var p = new DY_Params().base()
        .add('publish_video_strategy_type', '2').add('source', 'channel_pc_web').add('sec_user_id', secUid)
        .add('personal_center_strategy', '1').add('profile_other_record_enable', '1').add('land_to', '1')
        .platform(DY_browserInfo(), '0');
    var json = DY_call('/aweme/v1/web/user/profile/other/', p, 'webid,uifid,msToken,a_bogus,verifyFp', DY_userUrl(secUid), false);
    return json.user || {};
}

function DY_userSearchSpec(keywords, offset) {
    var p = new DY_Params().base()
        .add('search_channel', 'aweme_user_web').add('keyword', keywords).add('search_source', 'normal_search')
        .add('query_correct_type', '1').add('is_filter_search', '0').add('from_group_id', '').add('disable_rs', '0')
        .add('offset', String(offset)).add('count', '10').add('need_filter_settings', offset === 0 ? '1' : '0').add('list_type', 'single')
        .add('pc_search_top_1_params', '{"enable_ai_search_top_1":1}').platform(DY_browserInfo(), '50');
    return { path: '/aweme/v1/web/discover/search/', params: p, tail: 'webid,uifid,msToken,a_bogus,verifyFp' };
}

function DY_videoSearchSpec(keywords, offset, searchId) {
    var p = new DY_Params().base()
        .add('search_channel', 'aweme_video_web').add('enable_history', '1').add('sort_type', '0').add('publish_time', '0')
        .add('filter_duration', '').add('search_range', '0').add('keyword', keywords)
        .add('search_source', 'normal_search').add('query_correct_type', '1').add('is_filter_search', '1').add('from_group_id', '')
        .add('offset', String(offset)).add('count', '16').add('need_filter_settings', offset === 0 ? '1' : '0');
    if (searchId) p.add('search_id', searchId);
    p.add('list_type', 'single').add('pc_search_top_1_params', '').platform(DY_browserInfo(), '50');
    return { path: '/aweme/v1/web/search/item/', params: p, tail: 'webid,msToken,a_bogus,verifyFp' };
}

// 我收藏的视频，一页 10 个。这个接口是 POST，翻页游标在表单里。
function DY_collection(cursor) {
    var p = new DY_Params().base().add('publish_video_strategy_type', '2').platform(DY_browserInfo(), '0');
    return DY_call(
        '/aweme/v1/web/aweme/listcollection/', p, 'webid,uifid,msToken,a_bogus,verifyFp',
        DY_SITE + '/user/self?showTab=favorite_collection', true, DY_SITE, 'count=10&cursor=' + cursor
    );
}

function DY_following(uid, secUid, maxTime) {
    var b = DY_browserInfo();
    var p = new DY_Params().base()
        .add('user_id', uid).add('sec_user_id', secUid).add('offset', '0').add('min_time', '0').add('max_time', maxTime)
        .add('count', '20').add('source_type', maxTime === '0' ? '2' : '1').add('gps_access', '0').add('address_book_access', '0')
        .add('is_top', '1').add('pc_client_type', '1').add('pc_libra_divert', b.divert).add('support_h265', '1')
        .add('support_dash', '1').add('webcast_sdk_version', '170400').add('webcast_version_code', '170400')
        .add('version_code', '170400').add('version_name', '17.4.0').add('cookie_enabled', 'true')
        .add('screen_width', '1920').add('screen_height', '1080').add('browser_language', 'zh-CN')
        .add('browser_platform', b.platform).add('browser_name', b.name).add('browser_version', b.version)
        .add('browser_online', 'true').add('engine_name', b.engine).add('engine_version', b.engineVersion)
        .add('os_name', b.os).add('os_version', b.osVersion).add('cpu_core_num', '8').add('device_memory', '8')
        .add('platform', 'PC').add('downlink', '10').add('effective_type', '4g').add('round_trip_time', '0');
    return DY_call('/aweme/v1/web/user/following/list/', p, 'webid,verifyFp,msToken,a_bogus', DY_userUrl(secUid), true);
}

// 关注的人里正在直播的（网页版“关注”页顶上那一排）。
function DY_followLive() {
    var p = new DY_Params().base().add('scene', 'aweme_pc_follow_top').platform(DY_browserInfo(), '50');
    return DY_call('/webcast/web/feed/follow/', p, 'webid,uifid,msToken,a_bogus,verifyFp', DY_SITE + '/follow', false);
}

// 进入直播间：返回房间信息，里面有拉流地址。
function DY_liveRoom(webRid) {
    var b = DY_browserInfo();
    var p = new DY_Params()
        .add('aid', '6383').add('app_name', 'douyin_web').add('live_id', '1').add('device_platform', 'web').add('language', 'zh-CN')
        .add('enter_from', 'link_share').add('cookie_enabled', 'true').add('screen_width', '1920').add('screen_height', '1080')
        .add('browser_language', 'zh-CN').add('browser_platform', b.platform).add('browser_name', b.name)
        .add('browser_version', b.version).add('os_name', b.os).add('os_version', b.osVersion).add('web_rid', webRid);
    return DY_call('/webcast/room/web/enter/', p, 'msToken,a_bogus', DY_LIVE_SITE + '/' + webRid, false, DY_LIVE_SITE);
}

// 登录者自己的 sec_uid 和昵称（走创作者中心的接口，Cookie 是同一份）。
function DY_myInfo() {
    var cookie = DY_cookieMap();
    DY_requireLogin(cookie);
    var sess = cookie.sessionid || cookie.sessionid_ss || '';
    var key = DY_md5Hex(sess);
    var saved = DY_localGet('self').split('|');
    if (saved.length === 3 && saved[0] === key) return { secUid: saved[1], nickname: saved[2] };
    var headers = {
        'User-Agent': DY_desktopUA(),
        'Accept': 'application/json, text/plain, */*',
        'Referer': DY_CREATOR + '/creator-micro/home',
        'Cookie': DY_cookieStringFor(DY_SITE)
    };
    var json = JSON.parse(DY_fetch(DY_CREATOR + '/web/api/media/user/info/', headers, null));
    var secUid = DY_jstr(json, 'user.sec_uid');
    if (!secUid) throw new Error('没有取到自己的账号信息，请重新登录抖音');
    var nickname = DY_jstr(json, 'user.nickname').replace(/\|/g, ' ');
    DY_localSet('self', key + '|' + secUid + '|' + nickname);
    return { secUid: secUid, nickname: nickname };
}

function DY_myUid() {
    var p = new DY_Params().add('publish_video_strategy_type', '2').base().platform(DY_browserInfo(), '0');
    var uid = DY_jstr(DY_call('/aweme/v1/web/query/user/', p, 'uifid,webid,verifyFp,a_bogus', DY_SITE + '/', false), 'user_uid');
    if (!uid) throw new Error('没有取到自己的账号信息，请重新登录抖音');
    return uid;
}

// ---------- 搜索 ----------

var DY_searchState = {}; // 'mode:关键词' -> {userMore, videoMore, searchId, userOffset, videoOffset, page}

function DY_nextOffset(json, offset, got) {
    var cursor = DY_jint(json, 'cursor', 0);
    return cursor > offset ? cursor : offset + got;
}

function DY_needVerify(json) {
    return DY_jstr(json, 'search_nil_info.search_nil_type') === 'verify_check';
}

// 直接搜；被要求人机验证时报清楚。
function DY_searchCall(spec, pageUrl) {
    var json = DY_call(spec.path, spec.params, spec.tail, pageUrl, false);
    if (DY_needVerify(json)) {
        throw new Error('抖音要求人机验证：请到搜索页随便搜一个词，点“验证”完成后再试');
    }
    return json;
}

function DY_formatCount(n) {
    n = Number(n) || 0;
    return n >= 10000 ? (Math.round(n / 1000) / 10) + '万' : String(n);
}

function DY_formatDuration(ms) {
    var s = Math.round(ms / 1000);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
}

function DY_awemeTitle(a) {
    var title = DY_jstr(a, 'desc').split('\n')[0].replace(/\s+/g, ' ').trim();
    if (!title) {
        var nick = DY_jstr(a, 'author.nickname');
        title = nick ? nick + '的作品' : '无标题';
    }
    return title.length > 80 ? title.slice(0, 80) + '…' : title;
}

function DY_awemeCover(a) {
    return DY_jstr(a, 'video.cover.url_list.0') ||
        DY_jstr(a, 'video.origin_cover.url_list.0') ||
        DY_jstr(a, 'images.0.url_list.0');
}

function DY_awemeVod(a) {
    var parts = [];
    var dur = DY_jint(a, 'video.duration', 0);
    if (dur > 0) parts.push(DY_formatDuration(dur));
    parts.push('赞 ' + DY_formatCount(DY_jint(a, 'statistics.digg_count', 0)));
    return {
        vod_id: 'dy-video:' + DY_jstr(a, 'aweme_id'),
        vod_name: DY_awemeTitle(a),
        vod_pic: DY_awemeCover(a),
        vod_remarks: parts.join(' · '),
        vod_content: DY_jstr(a, 'desc')
    };
}

function DY_awemeEpisode(a) {
    return { name: DY_awemeTitle(a), playId: 'dy-ep:' + DY_jstr(a, 'aweme_id') };
}

function DY_userVod(u) {
    var parts = [];
    parts.push('粉丝 ' + DY_formatCount(DY_jint(u, 'follower_count', 0)));
    var count = DY_jint(u, 'aweme_count', 0);
    if (count > 0) parts.push('作品 ' + count);
    return {
        vod_id: 'dy-user:' + DY_jstr(u, 'sec_uid'),
        vod_name: DY_jstr(u, 'nickname'),
        vod_pic: DY_jstr(u, 'avatar_larger.url_list.0') ||
            DY_jstr(u, 'avatar_medium.url_list.0') || DY_jstr(u, 'avatar_thumb.url_list.0'),
        vod_remarks: parts.join(' · '),
        vod_content: DY_jstr(u, 'signature')
    };
}

function DY_validAwemes(list) {
    return list.filter(function (a) { return !!DY_jstr(a, 'aweme_id'); });
}

// mode：all 视频和用户（分开搜再拼起来），video 只搜视频，user 只搜用户。
function DY_searchImpl(keywords, page) {
    var mode = 'all'; // 设置页已取消：默认视频和用户
    var key = mode + ':' + keywords;
    if (page === 1 || !DY_searchState[key]) {
        DY_searchState[key] = { userMore: true, videoMore: true, searchId: '', userOffset: 0, videoOffset: 0, page: 0 };
    }
    var state = DY_searchState[key];
    var books = [];
    var tried = 0;
    var error = null;
    // 不是接着上一页往下翻的（比如直接要第 3 页）：没有上一页给的位置，只能按页码估一个
    if (page !== state.page + 1) {
        state.userOffset = (page - 1) * 10;
        state.videoOffset = (page - 1) * 16;
    }
    if (mode !== 'video' && state.userMore) {
        tried++;
        try {
            var userOffset = state.userOffset;
            var users = DY_searchCall(
                DY_userSearchSpec(keywords, userOffset),
                DY_SITE + '/search/' + DY_enc(keywords) + '?type=user'
            );
            var userList = DY_jarr(users, 'user_list');
            state.userMore = DY_more(users) && userList.length > 0;
            state.userOffset = DY_nextOffset(users, userOffset, userList.length);
            for (var i = 0; i < userList.length; i++) {
                var info = userList[i].user_info;
                if (info && DY_jstr(info, 'sec_uid')) books.push(DY_userVod(info));
            }
        } catch (e) { error = e; }
    }
    if (mode !== 'user' && state.videoMore) {
        tried++;
        try {
            var videoOffset = state.videoOffset;
            var videos = DY_searchCall(
                DY_videoSearchSpec(keywords, videoOffset, state.searchId),
                DY_SITE + '/search/' + DY_enc(keywords) + '?type=video'
            );
            var videoList = DY_jarr(videos, 'data');
            state.videoMore = DY_more(videos) && videoList.length > 0;
            state.videoOffset = DY_nextOffset(videos, videoOffset, videoList.length);
            state.searchId = DY_jstr(videos, 'log_pb.impr_id') || DY_jstr(videos, 'extra.logid') || state.searchId;
            for (var j = 0; j < videoList.length; j++) {
                var a = videoList[j].aweme_info;
                if (a && DY_jstr(a, 'aweme_id')) books.push(DY_awemeVod(a));
            }
        } catch (e) { if (!error) error = e; }
    }
    if (!books.length && error) throw error;
    state.page = page;
    var hasNext = (mode !== 'video' && state.userMore) || (mode !== 'user' && state.videoMore);
    return { books: books, totalPage: (tried > 0 && hasNext) ? page + 1 : page };
}

// 分类里的推荐关键词只搜视频（不混用户）。
function DY_searchVideoOnly(keywords, page) {
    var key = 'video:' + keywords;
    if (page === 1 || !DY_searchState[key]) {
        DY_searchState[key] = { userMore: true, videoMore: true, searchId: '', userOffset: 0, videoOffset: 0, page: 0 };
    }
    var state = DY_searchState[key];
    if (page !== state.page + 1) state.videoOffset = (page - 1) * 16;
    var videoOffset = state.videoOffset;
    var videos = DY_searchCall(
        DY_videoSearchSpec(keywords, videoOffset, state.searchId),
        DY_SITE + '/search/' + DY_enc(keywords) + '?type=video'
    );
    var videoList = DY_jarr(videos, 'data');
    state.videoMore = DY_more(videos) && videoList.length > 0;
    state.videoOffset = DY_nextOffset(videos, videoOffset, videoList.length);
    state.searchId = DY_jstr(videos, 'log_pb.impr_id') || DY_jstr(videos, 'extra.logid') || state.searchId;
    state.page = page;
    var books = [];
    for (var i = 0; i < videoList.length; i++) {
        var a = videoList[i].aweme_info;
        if (a && DY_jstr(a, 'aweme_id')) books.push(DY_awemeVod(a));
    }
    return { books: books, totalPage: state.videoMore ? page + 1 : page };
}

// ---------- 分类 ----------

// 翻页用的游标（dy-mine/dy-collect 的下一页地址按页码记在这里）。
var DY_catNext = {};

function DY_categoryImpl(url) {
    DY_requireLogin(DY_cookieMap());
    if (url === 'dy-live') {
        return { list: DY_liveBooks(), page: 1, totalPage: 1, nextUrl: '' };
    }
    if (url.indexOf('dy-mine#') === 0) {
        var mm = /^dy-mine#(\d+)#(\d+)$/.exec(url);
        if (!mm) throw new Error('抖音：不认识的分类地址 ' + url);
        var maxTime = mm[1];
        var page = parseInt(mm[2], 10);
        var me = DY_myInfo();
        var books = [];
        if (page === 1) {
            books.push({
                vod_id: 'dy-likes',
                vod_name: '我的喜欢',
                vod_pic: '',
                vod_remarks: me.nickname || '',
                vod_content: '我点过赞的作品'
            });
        }
        var next = null;
        try {
            var json = DY_following(DY_myUid(), me.secUid, maxTime);
            var followings = DY_jarr(json, 'followings');
            for (var i = 0; i < followings.length; i++) {
                if (DY_jstr(followings[i], 'sec_uid')) books.push(DY_userVod(followings[i]));
            }
            if (DY_more(json) && DY_jint(json, 'min_time', 0) > 0) {
                next = 'dy-mine#' + DY_jint(json, 'min_time', 0) + '#' + (page + 1);
            }
        } catch (e) {
            if (page > 1) throw e;
        }
        if (next) DY_catNext['dy-mine#' + (page + 1)] = next;
        return { list: books, page: page, totalPage: next ? page + 1 : page, nextUrl: next || '' };
    }
    if (url.indexOf('dy-collect#') === 0) {
        var mc = /^dy-collect#(\d+)#(\d+)$/.exec(url);
        if (!mc) throw new Error('抖音：不认识的分类地址 ' + url);
        var cursor = mc[1];
        var cpage = parseInt(mc[2], 10);
        var collected = DY_collection(cursor);
        var cbooks = DY_validAwemes(DY_jarr(collected, 'aweme_list')).map(DY_awemeVod);
        var nextCursor = DY_jstr(collected, 'cursor');
        var nextPage = null;
        if (DY_more(collected) && nextCursor && nextCursor !== cursor) {
            nextPage = 'dy-collect#' + nextCursor + '#' + (cpage + 1);
        }
        if (nextPage) DY_catNext['dy-collect#' + (cpage + 1)] = nextPage;
        return { list: cbooks, page: cpage, totalPage: nextPage ? cpage + 1 : cpage, nextUrl: nextPage || '' };
    }
    if (url.indexOf('dy-search:') === 0) {
        var ms = /^dy-search:(.+)#(\d+)$/.exec(url);
        if (!ms) throw new Error('抖音：不认识的分类地址 ' + url);
        var word = ms[1];
        var spage = parseInt(ms[2], 10);
        var r = DY_searchVideoOnly(word, spage);
        var snext = r.totalPage > spage ? 'dy-search:' + word + '#' + (spage + 1) : '';
        return { list: r.books, page: spage, totalPage: r.totalPage, nextUrl: snext };
    }
    throw new Error('抖音：不认识的分类地址 ' + url);
}

// ---------- 详情 ----------

function DY_loadAwemes(loadPage, loadFullPages) {
    var json = loadPage('0');
    var list = DY_validAwemes(DY_jarr(json, 'aweme_list'));
    if (!loadFullPages) return list;
    var page = 2;
    while (DY_more(json) && page <= 11) {
        try {
            json = loadPage(DY_jstr(json, 'max_cursor'));
        } catch (e) { break; }
        list = list.concat(DY_validAwemes(DY_jarr(json, 'aweme_list')));
        page++;
    }
    return list;
}

function DY_loadMix(mixId, awemeId, loadFullPages) {
    var json = DY_mixAwemes(mixId, '0', awemeId);
    var list = DY_validAwemes(DY_jarr(json, 'aweme_list'));
    if (!loadFullPages) return list;
    var page = 2;
    while (DY_more(json) && page <= 11) {
        var cursor = DY_jstr(json, 'cursor');
        if (!cursor || cursor === '0') break;
        try {
            json = DY_mixAwemes(mixId, cursor, awemeId);
        } catch (e) { break; }
        var fresh = DY_validAwemes(DY_jarr(json, 'aweme_list'));
        if (!fresh.length) break;
        list = list.concat(fresh);
        page++;
    }
    return list;
}

function DY_detailImpl(bookUrl) {
    if (bookUrl.indexOf('dy-live:') === 0 || bookUrl.indexOf('dy-live-user:') === 0) {
        return {
            vod_id: bookUrl,
            vod_name: '直播',
            vod_pic: '',
            vod_content: '',
            vod_play_from: '抖音',
            vod_play_url: '直播$' + bookUrl
        };
    }
    if (bookUrl === 'dy-likes') {
        var secUid = DY_myInfo().secUid;
        var eps = DY_loadAwemes(function (cursor) { return DY_userLikes(secUid, cursor); }, true)
            .map(DY_awemeEpisode);
        return {
            vod_id: bookUrl,
            vod_name: '我的喜欢',
            vod_pic: '',
            vod_content: '我点过赞的作品',
            vod_play_from: '抖音',
            vod_play_url: eps.map(function (e) { return e.name + '$' + e.playId; }).join('#')
        };
    }
    if (bookUrl.indexOf('dy-user:') === 0) {
        var uid = bookUrl.slice('dy-user:'.length);
        var intro = '', artist = '', cover = '';
        try {
            var u = DY_userProfile(uid);
            artist = DY_jstr(u, 'nickname');
            intro = DY_jstr(u, 'signature');
            cover = DY_jstr(u, 'avatar_larger.url_list.0') || DY_jstr(u, 'avatar_medium.url_list.0');
        } catch (e) {
            // 用户资料取不到不影响看作品
        }
        var ueps = DY_loadAwemes(function (cursor) { return DY_userPosts(uid, cursor); }, true)
            .map(DY_awemeEpisode);
        return {
            vod_id: bookUrl,
            vod_name: artist || '用户作品',
            vod_pic: cover,
            vod_content: intro,
            vod_play_from: '抖音',
            vod_play_url: ueps.map(function (e) { return e.name + '$' + e.playId; }).join('#')
        };
    }
    if (bookUrl.indexOf('dy-video:') === 0) {
        var awemeId = bookUrl.slice('dy-video:'.length);
        var a = DY_awemeDetail(awemeId);
        var mixId = DY_jstr(a, 'mix_info.mix_id');
        if (mixId) {
            try {
                var mix = DY_loadMix(mixId, awemeId, true);
                if (mix.length) {
                    var total = DY_jint(a, 'mix_info.statis.updated_to_episode', 0);
                    if (total <= 0) total = mix.length;
                    return {
                        vod_id: bookUrl,
                        vod_name: DY_awemeTitle(a),
                        vod_pic: DY_jstr(a, 'mix_info.cover_url.url_list.0') || DY_awemeCover(a),
                        vod_content: DY_jstr(a, 'mix_info.desc') || DY_jstr(a, 'desc'),
                        vod_play_from: '抖音',
                        vod_play_url: mix.map(DY_awemeEpisode).map(function (e) { return e.name + '$' + e.playId; }).join('#')
                    };
                }
            } catch (e) {
                // 合集没取到就还是只有它自己这一集
            }
        }
        return {
            vod_id: bookUrl,
            vod_name: DY_awemeTitle(a),
            vod_pic: DY_awemeCover(a),
            vod_content: DY_jstr(a, 'desc'),
            vod_play_from: '抖音',
            vod_play_url: DY_awemeTitle(a) + '$dy-ep:' + DY_jstr(a, 'aweme_id')
        };
    }
    throw new Error('抖音：不认识的书地址 ' + bookUrl);
}

// ---------- 播放地址 ----------

// 播放地址：取带画面的 mp4（音视频合流）。默认自动最高，取码率最高的 mp4。
function DY_pickVideo(a) {
    var url = '';
    var bestRate = -1;
    var lowestRate = -1;
    var lowestUrl = '';
    var rates = DY_jarr(a, 'video.bit_rate');
    for (var i = 0; i < rates.length; i++) {
        var item = rates[i];
        var u = DY_jstr(item, 'play_addr.url_list.0');
        var format = DY_jstr(item, 'format');
        var rate = DY_jint(item, 'bit_rate', 0);
        // dash 的条目只有画面没有声音；h265 有的手机放不了
        if (!u || (format && format !== 'mp4') ||
            DY_jint(item, 'is_h265', 0) === 1 || DY_jint(item, 'is_bytevc1', 0) === 1) continue;
        if (lowestRate < 0 || rate < lowestRate) { lowestRate = rate; lowestUrl = u; }
        if (rate > bestRate) { bestRate = rate; url = u; }
    }
    if (!url) {
        url = DY_jstr(a, 'video.play_addr_h264.url_list.0') || DY_jstr(a, 'video.play_addr.url_list.0');
    }
    // 图文作品没有视频，只有配乐
    if (!url) {
        url = DY_jstr(a, 'music.play_url.url_list.0') || DY_jstr(a, 'music.play_url.uri');
    }
    return url.indexOf('//') === 0 ? 'https:' + url : url;
}

// ---------- 直播 ----------

function DY_isLive(url) {
    return url.indexOf('dy-live:') === 0 || url.indexOf('dy-live-user:') === 0;
}

function DY_liveVod(bookUrl, user, title, cover, viewers) {
    var nickname = DY_jstr(user, 'nickname');
    return {
        vod_id: bookUrl,
        vod_name: nickname + '的直播间',
        vod_pic: cover || DY_jstr(user, 'avatar_larger.url_list.0') ||
            DY_jstr(user, 'avatar_medium.url_list.0') || DY_jstr(user, 'avatar_thumb.url_list.0'),
        vod_remarks: '直播中' + (viewers ? ' · ' + viewers + ' 人' : ''),
        vod_content: title || DY_jstr(user, 'signature')
    };
}

// 关注的人里正在直播的。两个办法都用：专门的接口，加上从关注列表里挑出正在直播的人。
function DY_liveBooks() {
    var books = [];
    var seen = {};
    var errors = 0;
    function push(key, book) {
        if (!key || seen[key]) return;
        seen[key] = true;
        books.push(book);
    }
    try {
        var items = DY_jarr(DY_followLive(), 'data.data');
        for (var i = 0; i < items.length; i++) {
            var room = items[i].room || {};
            var rid = DY_jstr(items[i], 'web_rid') || DY_jstr(room, 'owner.web_rid');
            if (!rid) continue;
            var owner = room.owner || {};
            push(
                DY_jstr(room, 'owner.sec_uid') || rid,
                DY_liveVod('dy-live:' + rid, owner, DY_jstr(room, 'title'),
                    DY_jstr(room, 'cover.url_list.0'),
                    DY_jstr(room, 'stats.user_count_str') || DY_jstr(room, 'user_count_str'))
            );
        }
    } catch (e) { errors++; }
    try {
        var me = DY_myInfo();
        var uid = DY_myUid();
        var maxTime = '0';
        for (var page = 1; page <= 5; page++) {
            var json = DY_following(uid, me.secUid, maxTime);
            var followings = DY_jarr(json, 'followings');
            for (var j = 0; j < followings.length; j++) {
                if (DY_jint(followings[j], 'live_status', 0) === 1 && DY_jstr(followings[j], 'sec_uid')) {
                    push(DY_jstr(followings[j], 'sec_uid'),
                        DY_liveVod('dy-live-user:' + DY_jstr(followings[j], 'sec_uid'), followings[j], '', '', ''));
                }
            }
            if (!DY_more(json) || DY_jint(json, 'min_time', 0) <= 0) break;
            maxTime = String(DY_jint(json, 'min_time', 0));
        }
    } catch (e) { errors++; }
    if (!books.length && errors === 2) throw new Error('抖音：关注的直播加载失败，请重新登录后再试');
    return books;
}

// 从拉流信息里挑带画面的 hls 地址（优先高清，往下兜底）。
function DY_pickLive(stream) {
    var url = '';
    var data = {};
    try {
        var raw = DY_jstr(stream, 'live_core_sdk_data.pull_data.stream_data');
        if (raw) data = (JSON.parse(raw).data) || {};
    } catch (e) { }
    var levels = ['hd', 'sd', 'md', 'ld', 'uhd', 'origin'];
    for (var i = 0; i < levels.length; i++) {
        if (!url) url = DY_jstr(data, levels[i] + '.main.hls');
    }
    var maps = ['SD2', 'SD1', 'HD1', 'FULL_HD1'];
    for (var j = 0; j < maps.length; j++) {
        if (!url) url = DY_jstr(stream, 'hls_pull_url_map.' + maps[j]);
    }
    return url || DY_jstr(stream, 'hls_pull_url');
}

function DY_liveAudio(bookUrl) {
    var rid = bookUrl.indexOf('dy-live:') === 0 ? bookUrl.slice('dy-live:'.length) : '';
    if (!rid) {
        // 只知道主播：他的资料里有当前直播间的信息
        var roomData = DY_jstr(DY_userProfile(bookUrl.slice('dy-live-user:'.length)), 'room_data');
        try {
            rid = DY_jstr(JSON.parse(roomData), 'owner.web_rid');
        } catch (e) { }
        if (!rid) throw new Error('主播现在没有在直播');
    }
    var rooms = DY_jarr(DY_liveRoom(rid), 'data.data');
    var room = rooms[0];
    if (!room) throw new Error('主播现在没有在直播');
    if (DY_jint(room, 'status', 0) !== 2) throw new Error('主播现在没有在直播');
    var url = DY_pickLive(room.stream_url || {});
    if (!url) throw new Error('没有获取到直播地址');
    return url.replace(/^http:/, 'https:');
}

// 章节地址解析成最终可播地址。
function DY_resolvePlayUrl(episodeUrl) {
    if (DY_isLive(episodeUrl)) return DY_liveAudio(episodeUrl);
    if (episodeUrl.indexOf('dy-ep:') !== 0) throw new Error('抖音：不认识的章节地址');
    var awemeId = episodeUrl.slice('dy-ep:'.length);
    if (!awemeId || awemeId.indexOf(':') >= 0) throw new Error('抖音：不认识的章节地址');
    var url = DY_pickVideo(DY_awemeDetail(awemeId));
    if (!url) throw new Error('没有获取到播放地址');
    return url;
}

// 播放器取视频/直播流时带的头（和浏览器一致）。
function DY_playHeaders(audioUrl) {
    if (audioUrl.indexOf('pull-') >= 0) return { 'Referer': DY_LIVE_SITE + '/' };
    if (/douyin|zjcdn|ixigua|bytecdn|byteimg/.test(audioUrl)) return { 'Referer': DY_SITE + '/' };
    return {};
}

// ---------- 登录提示条目 ----------

function DY_noLoginVod() {
    return {
        vod_id: 'douyin:nologin',
        vod_name: '还没有登录抖音',
        vod_pic: '',
        vod_remarks: '未登录',
        vod_content: DY_NOT_LOGGED_IN + '已登录过、Cookie 失效了也一样：重新复制一份新的 Cookie 再搜“cookie:你的Cookie”保存。'
    };
}

function DY_cookieSavedVod(saved) {
    return {
        vod_id: 'douyin:cookie:saved',
        vod_name: saved ? 'Cookie 已保存' : 'Cookie 已清除',
        vod_pic: '',
        vod_remarks: saved ? '已保存' : '已清除',
        vod_content: saved ?
            '现在可以直接搜视频了。Cookie 失效（搜出“还没有登录”）就重新在网页里登录、复制新的 Cookie 再搜一次“cookie:你的Cookie”。注意：不要把 Cookie 发给别人。' :
            '已清除。抖音现在搜不到东西，要重新搜“cookie:你的Cookie”保存一份。'
    };
}

// ---------- CatVod Spider ----------

function init(cfg) {
    try {
        cfg = cfg || {};
        var ext = cfg.ext;
        if (ext == null) ext = cfg.cookie || '';
        if (typeof ext === 'object') {
            if (ext.cookie) DY_localSet('cookie', String(ext.cookie).trim());
            return;
        }
        var t = String(ext).trim();
        if (!t) return;
        if (t.charAt(0) === '{') {
            try {
                var o = JSON.parse(t);
                if (o.cookie) DY_localSet('cookie', String(o.cookie).trim());
            } catch (e) { /* ext 不是 JSON，忽略 */ }
        } else if (t.indexOf('sessionid') >= 0) {
            DY_localSet('cookie', t);
        }
    } catch (e) { /* 配置读不到不影响使用 */ }
}

function homeContent(filter) {
    var classes = [
        { type_id: 'dy-live', type_name: '关注的直播' },
        { type_id: 'dy-mine', type_name: '关注和喜欢' },
        { type_id: 'dy-collect', type_name: '收藏' }
    ];
    for (var i = 0; i < DY_WORDS.length; i++) {
        classes.push({ type_id: 'dy-search:' + DY_WORDS[i], type_name: '推荐·' + DY_WORDS[i] });
    }
    return JSON.stringify({ 'class': classes });
}

function homeVideoContent() {
    if (!DY_loggedIn(DY_cookieMap())) return JSON.stringify({ list: [] });
    try {
        return JSON.stringify({ list: DY_liveBooks() });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var page = parseInt(pg, 10) || 1;
    tid = String(tid || '');
    var url;
    if (tid === 'dy-live') {
        url = 'dy-live';
    } else if (tid === 'dy-mine') {
        url = page === 1 ? 'dy-mine#0#1' : (DY_catNext['dy-mine#' + page] || ('dy-mine#0#' + page));
    } else if (tid === 'dy-collect') {
        url = page === 1 ? 'dy-collect#0#1' : (DY_catNext['dy-collect#' + page] || ('dy-collect#0#' + page));
    } else if (tid.indexOf('dy-search:') === 0) {
        url = tid + '#' + page;
    } else {
        return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
    try {
        var r = DY_categoryImpl(url);
        return JSON.stringify({
            page: page,
            pagecount: r.totalPage,
            limit: 20,
            total: r.list.length,
            list: r.list
        });
    } catch (e) {
        if (e.message === DY_NOT_LOGGED_IN || (e.message || '').indexOf('还没有登录抖音') === 0) {
            return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 1, list: [DY_noLoginVod()] });
        }
        return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

// 搜“cookie:你的Cookie”保存 Cookie，搜“cookie:清除”清掉。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var lower = kw.toLowerCase();
    if (lower.indexOf('cookie:') === 0 || lower.indexOf('cookie：') === 0) {
        var val = kw.slice(7).trim();
        if (/^清除$/.test(val) || /^clear$/i.test(val)) {
            DY_localSet('cookie', '');
            return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 1, list: [DY_cookieSavedVod(false)] });
        }
        if (!val) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
        var saved = DY_localSet('cookie', val);
        var vod = DY_cookieSavedVod(true);
        if (!saved) vod.vod_name = '保存失败（请重试）';
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 1, list: [vod] });
    }
    if (!DY_loggedIn(DY_cookieMap())) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 1, list: [DY_noLoginVod()] });
    }
    try {
        var r = DY_searchImpl(kw, 1);
        return JSON.stringify({
            page: 1,
            pagecount: r.totalPage,
            limit: 20,
            total: r.books.length,
            list: r.books
        });
    } catch (e) {
        if ((e.message || '').indexOf('还没有登录抖音') === 0) {
            return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 1, list: [DY_noLoginVod()] });
        }
        throw e;
    }
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    if (id === 'douyin:nologin' || id === 'douyin:cookie:saved') {
        var hasCookie = DY_loggedIn(DY_cookieMap());
        var content = hasCookie ?
            'Cookie 已存好，直接搜视频就行。Cookie 失效就重新在网页里登录、复制新的 Cookie 再搜一次“cookie:你的Cookie”。' :
            DY_NOT_LOGGED_IN;
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: hasCookie ? 'Cookie 已保存' : '还没有登录抖音',
                vod_pic: '',
                vod_content: content,
                vod_play_from: '抖音',
                vod_play_url: ''
            }]
        });
    }
    var vod = DY_detailImpl(id);
    return JSON.stringify({ list: [vod] });
}

function playerContent(flag, id, vipFlags) {
    var url = DY_resolvePlayUrl(String(id || ''));
    var headers = DY_playHeaders(url);
    headers['User-Agent'] = DY_desktopUA();
    return JSON.stringify({ parse: 0, url: url, header: headers });
}

var spider = {
    init: init,
    homeContent: homeContent,
    homeVideoContent: homeVideoContent,
    categoryContent: categoryContent,
    detailContent: detailContent,
    searchContent: searchContent,
    playerContent: playerContent,
    // 登录入口：用户自己在网页里登抖音（验证码自己过），再把 Cookie 贴回来。
    getLoginUrl: function () { return 'https://www.douyin.com/'; }
};

// 承影用 spider.__jsEvalReturn()（或 spider.default）加载本插件。
function __jsEvalReturn() {
    return spider;
}