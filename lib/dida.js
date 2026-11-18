var DD_BASE = 'https://www.didahd.xyz';
var DD_TICKTOCK = 'https://hd.ticktockwow.com/smartplay-cache/api/webvideo_ty.php';
var DD_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var DD_NETDISK_FROM = { ucpan: 1, quark: 1, baidu: 1 };

// ---------- 小工具 ----------

function DD_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function DD_reqText(url, timeoutMs, headers, method, body) {
    var h = {
        'User-Agent': DD_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': DD_BASE + '/'
    };
    if (headers) for (var k in headers) h[k] = headers[k];
    var opts = { headers: h, timeout: timeoutMs || 20000 };
    if (method) opts.method = method;
    if (body != null) opts.body = body;
    var res = req(url, opts);
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function DD_stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function DD_fixCover(url) {
    return String(url || '').replace(/&amp;/g, '&').replace(/fmt=&/g, 'fmt=jpeg&').replace(/fmt=$/, 'fmt=jpeg');
}

// ---------- MD5（纯 JS，返回小写 hex） ----------

function DD_md5Hex(input) {
    var bytes = [];
    for (var i = 0; i < input.length; i++) {
        var c = input.charCodeAt(i);
        if (c < 0x80) bytes.push(c);
        else if (c < 0x800) { bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < input.length) {
            var c2 = input.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                i++;
            } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        } else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    var origLen = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 64 位小端长度：低 32 位 + 高 32 位。注意 >>> 的移位量按 mod 32 算，
    // 不能用 (bitLen >>> (k*8)) 的循环写法（k=4 时 >>>32 等于 >>>0，会把低字重复写进高字）。
    var bitLenLo = (origLen << 3) >>> 0;
    var bitLenHi = Math.floor(origLen / 0x20000000);
    bytes.push(bitLenLo & 0xFF, (bitLenLo >>> 8) & 0xFF, (bitLenLo >>> 16) & 0xFF, (bitLenLo >>> 24) & 0xFF,
               bitLenHi & 0xFF, (bitLenHi >>> 8) & 0xFF, (bitLenHi >>> 16) & 0xFF, (bitLenHi >>> 24) & 0xFF);
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
             5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
             4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
             6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    var K = [];
    for (var n = 0; n < 64; n++) K.push(Math.floor(Math.abs(Math.sin(n + 1)) * 4294967296) >>> 0);
    function rol(x, s) { return ((x << s) | (x >>> (32 - s))) >>> 0; }
    function add(x, y) { return (x + y) >>> 0; }
    for (var off = 0; off < bytes.length; off += 64) {
        var M = [];
        for (var j = 0; j < 16; j++) {
            M.push((bytes[off + j * 4] | (bytes[off + j * 4 + 1] << 8) | (bytes[off + j * 4 + 2] << 16) | (bytes[off + j * 4 + 3] << 24)) >>> 0);
        }
        var A = a0, B = b0, C = c0, D = d0;
        for (var r = 0; r < 64; r++) {
            var F, g;
            if (r < 16) { F = (B & C) | (~B & D); g = r; }
            else if (r < 32) { F = (D & B) | (~D & C); g = (5 * r + 1) % 16; }
            else if (r < 48) { F = B ^ C ^ D; g = (3 * r + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * r) % 16; }
            F = add(add(add(F, A), K[r]), M[g]);
            A = D; D = C; C = B;
            B = add(B, rol(F, S[r]));
        }
        a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
    function hex(n) {
        var s = '';
        for (var i = 0; i < 4; i++) s += ('0' + ((n >>> (i * 8)) & 0xFF).toString(16)).slice(-2);
        return s;
    }
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

// ---------- Base64 解码到字节 ----------

function DD_b64ToBytes(s) {
    var table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var clean = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
    var out = [];
    var acc = 0, nbits = 0;
    for (var i = 0; i < clean.length; i++) {
        var c = clean.charAt(i);
        if (c === '=') break;
        acc = (acc << 6) | table.indexOf(c);
        nbits += 6;
        if (nbits >= 8) {
            nbits -= 8;
            out.push((acc >> nbits) & 0xFF);
        }
    }
    return out;
}

// ---------- AES-128-CBC 解密（纯 JS） ----------

var DD_sbox = null, DD_invSbox = null;

function DD_gfMul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi = a & 0x80;
        a = (a << 1) & 0xFF;
        if (hi) a ^= 0x1B;
        b >>= 1;
    }
    return p;
}

function DD_buildSbox() {
    if (DD_sbox) return;
    DD_sbox = [];
    DD_invSbox = [];
    for (var x = 0; x < 256; x++) {
        var inv = 0;
        if (x !== 0) {
            // x^254（GF 逆元）
            var r = 1;
            for (var e = 0; e < 254; e++) r = DD_gfMul(r, x);
            inv = r;
        }
        var s = inv;
        for (var k = 1; k <= 4; k++) {
            var rot = ((inv << k) | (inv >>> (8 - k))) & 0xFF;
            s ^= rot;
        }
        s = (s ^ 0x63) & 0xFF;
        DD_sbox[x] = s;
        DD_invSbox[s] = x;
    }
}

function DD_aesExpandKey(keyBytes) {
    DD_buildSbox();
    var Nk = 4, Nr = 10;
    var w = [];
    for (var i = 0; i < Nk; i++) w.push([keyBytes[4 * i], keyBytes[4 * i + 1], keyBytes[4 * i + 2], keyBytes[4 * i + 3]]);
    var Rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    for (var n = Nk; n < 4 * (Nr + 1); n++) {
        var temp = w[n - 1].slice();
        if (n % Nk === 0) {
            temp = [DD_sbox[temp[1]] ^ Rcon[n / Nk - 1], DD_sbox[temp[2]], DD_sbox[temp[3]], DD_sbox[temp[0]]];
        }
        w.push([w[n - Nk][0] ^ temp[0], w[n - Nk][1] ^ temp[1], w[n - Nk][2] ^ temp[2], w[n - Nk][3] ^ temp[3]]);
    }
    return w;
}

function DD_aesDecryptBlock(block, w) {
    // state 列优先：s[r+4c]
    var s = block.slice();
    function addRoundKey(round) {
        for (var c = 0; c < 4; c++) {
            var word = w[round * 4 + c];
            for (var r = 0; r < 4; r++) s[r + 4 * c] ^= word[r];
        }
    }
    function invShiftRows() {
        var t = s.slice();
        for (var r = 0; r < 4; r++) {
            for (var c = 0; c < 4; c++) s[r + 4 * c] = t[r + 4 * ((c - r + 4) % 4)];
        }
    }
    function invSubBytes() {
        for (var i = 0; i < 16; i++) s[i] = DD_invSbox[s[i]];
    }
    function invMixColumns() {
        for (var c = 0; c < 4; c++) {
            var a0 = s[4 * c], a1 = s[1 + 4 * c], a2 = s[2 + 4 * c], a3 = s[3 + 4 * c];
            s[4 * c] = DD_gfMul(14, a0) ^ DD_gfMul(11, a1) ^ DD_gfMul(13, a2) ^ DD_gfMul(9, a3);
            s[1 + 4 * c] = DD_gfMul(9, a0) ^ DD_gfMul(14, a1) ^ DD_gfMul(11, a2) ^ DD_gfMul(13, a3);
            s[2 + 4 * c] = DD_gfMul(13, a0) ^ DD_gfMul(9, a1) ^ DD_gfMul(14, a2) ^ DD_gfMul(11, a3);
            s[3 + 4 * c] = DD_gfMul(11, a0) ^ DD_gfMul(13, a1) ^ DD_gfMul(9, a2) ^ DD_gfMul(14, a3);
        }
    }
    addRoundKey(10);
    for (var round = 9; round >= 1; round--) {
        invShiftRows();
        invSubBytes();
        addRoundKey(round);
        invMixColumns();
    }
    invShiftRows();
    invSubBytes();
    addRoundKey(0);
    return s;
}

// AES-128-CBC 解密 + PKCS7 去填充，返回 UTF-8 字符串。
function DD_aesCbcDecryptToString(cipherBytes, keyBytes, ivBytes) {
    if (cipherBytes.length % 16 !== 0 || cipherBytes.length === 0) throw new Error('密文长度不对');
    var w = DD_aesExpandKey(keyBytes);
    var out = [];
    var prev = ivBytes.slice();
    for (var off = 0; off < cipherBytes.length; off += 16) {
        var block = cipherBytes.slice(off, off + 16);
        var dec = DD_aesDecryptBlock(block, w);
        for (var i = 0; i < 16; i++) out.push(dec[i] ^ prev[i]);
        prev = block;
    }
    var pad = out[out.length - 1];
    if (pad < 1 || pad > 16) throw new Error('PKCS7 填充不对');
    for (var p = 1; p <= pad; p++) if (out[out.length - p] !== pad) throw new Error('PKCS7 填充不对');
    out = out.slice(0, out.length - pad);
    var str = '';
    for (var j = 0; j < out.length;) {
        var b = out[j];
        if (b < 0x80) { str += String.fromCharCode(b); j += 1; }
        else if ((b & 0xE0) === 0xC0 && j + 1 < out.length) {
            str += String.fromCharCode(((b & 0x1F) << 6) | (out[j + 1] & 0x3F)); j += 2;
        } else if ((b & 0xF0) === 0xE0 && j + 2 < out.length) {
            str += String.fromCharCode(((b & 0x0F) << 12) | ((out[j + 1] & 0x3F) << 6) | (out[j + 2] & 0x3F)); j += 3;
        } else { str += '\uFFFD'; j += 1; }
    }
    return str;
}

// execB：h=MD5(timestamp + "RY7e48naFXPsLJC")，key=h[16:32]、iv=h[0:16]（UTF-8），
// AES-CBC/PKCS7 解 Base64 密文。
function DD_execB(cipherB64, timestamp) {
    var h = DD_md5Hex(String(timestamp) + 'RY7e48naFXPsLJC');
    function utf8Bytes(s) {
        var out = [];
        for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
        return out;
    }
    return DD_aesCbcDecryptToString(DD_b64ToBytes(cipherB64), utf8Bytes(h.slice(16, 32)), utf8Bytes(h.slice(0, 16)));
}

// ---------- 列表解析 ----------

// ul.myui-vodlist 里的条目：thumb 链接带 title 与 data-original 封面，pic-text 是更新状态。
function DD_parseList(html) {
    var list = [], seen = {};
    var re = /<a[^>]*class="[^"]*myui-vodlist__thumb[^"]*"[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
        var tag = m[0];
        var href = /href="(\/detail\/(\d+)\.html)"/.exec(tag);
        if (!href) continue;
        var id = href[2];
        if (seen[id]) continue;
        var tm = /title="([^"]*)"/.exec(tag);
        var title = tm ? tm[1].trim() : DD_stripTags(m[1]);
        if (!title) continue;
        seen[id] = 1;
        var cover = /data-original="([^"]*)"/.exec(tag);
        var status = /<span[^>]*class="pic-text"[^>]*>([^<]*)<\/span>/.exec(m[1]);
        list.push({
            vod_id: 'didahd:' + id,
            vod_name: title,
            vod_pic: DD_fixCover(cover ? cover[1] : ''),
            vod_remarks: status ? status[1].trim() : ''
        });
    }
    return list;
}

// 详情页解析：tab 名 → playlist 分组（按在 HTML 里的位置切分 panel），跳过含“网盘”的 tab，
// 只列第一条超清线的剧集。返回 {title, cover, intro, actor, episodes, playableSids}。
function DD_parseDetail(vodId, html) {
    var cover = '';
    var ci = html.indexOf('myui-content__thumb');
    if (ci >= 0) {
        var cm = /data-original="([^"]+)"/.exec(html.slice(ci, ci + 800));
        if (cm) cover = DD_fixCover(cm[1]);
    }
    var intro = /<meta[^>]*name=["']description["'][^>]*content="([^"]*)"/.exec(html);
    var actor = '';
    var pRe = /<p[^>]*>([\s\S]*?)<\/p>/g, pm;
    while ((pm = pRe.exec(html)) !== null) {
        if (pm[1].indexOf('主演') >= 0) {
            var names = [];
            var aRe = /<a[^>]*>([^<]+)<\/a>/g, am;
            while ((am = aRe.exec(pm[1])) !== null) names.push(am[1].trim());
            actor = names.join('、');
            break;
        }
    }
    // tab：<a href="#playlistN" ...>超清G</a>
    var tabs = [];
    var tRe = /<a[^>]*href="#(playlist\d+)"[^>]*>([^<]*)</g, tm;
    while ((tm = tRe.exec(html)) !== null) tabs.push({ plId: tm[1], name: tm[2].trim() });
    // panel 位置：id="playlistN" 出现的位置
    var panelPos = [];
    var pPosRe = /id="(playlist\d+)"/g, pp;
    while ((pp = pPosRe.exec(html)) !== null) panelPos.push({ plId: pp[1], pos: pp.index });
    // 全部播放链接（带位置）
    var links = [];
    var lRe = /<a[^>]*href="(\/play\/\d+-(\d+)-(\d+)\.html)"[^>]*>([^<]*)<\/a>/g, lm;
    while ((lm = lRe.exec(html)) !== null) {
        links.push({ pos: lm.index, sid: parseInt(lm[2], 10), nid: lm[3], text: lm[4].trim() });
    }
    var episodes = [];
    var playableSids = [];
    for (var t = 0; t < tabs.length; t++) {
        var tab = tabs[t];
        if (tab.name.indexOf('网盘') >= 0) continue;
        var start = -1, end = html.length;
        for (var pi = 0; pi < panelPos.length; pi++) {
            if (panelPos[pi].plId === tab.plId) start = panelPos[pi].pos;
            else if (start >= 0 && panelPos[pi].pos > start) { end = panelPos[pi].pos; break; }
        }
        if (start < 0) continue;
        var tabLinks = links.filter(function (l) { return l.pos >= start && l.pos < end; });
        for (var li = 0; li < tabLinks.length; li++) {
            var sid = tabLinks[li].sid;
            if (playableSids.indexOf(sid) < 0) playableSids.push(sid);
        }
        if (episodes.length === 0 && tabLinks.length) {
            for (var k = 0; k < tabLinks.length; k++) {
                // 站内链接文本本身已是“第01集”这种完整集名，直接用，不再包一层“第…集”
                //（否则会变成“第第01集集”）；只有纯数字文本才包成“第N集”。
                var raw = tabLinks[k].text || '';
                var name;
                if (tabLinks.length === 1) name = tab.name;
                else if (/^第.*集$/.test(raw)) name = raw;
                else if (/^\d+$/.test(raw)) name = '第' + raw + '集';
                else if (raw) name = raw;
                else name = '第' + tabLinks[k].nid + '集';
                episodes.push({ name: name, url: 'didahd:' + vodId + ':' + tabLinks[k].sid + ':' + tabLinks[k].nid });
            }
        }
    }
    if (!episodes.length) throw new Error('嘀嗒影视：详情里没有可播剧集（可能只剩网盘线路）');
    return { cover: cover, intro: intro ? intro[1].trim() : '', actor: actor, episodes: episodes, playableSids: playableSids };
}

// 从播放页 HTML 里抠出 player_aaaa 的 JSON（大括号配对扫描）。
function DD_braceJson(s, marker) {
    var i = s.indexOf(marker);
    if (i < 0) return null;
    var j = s.indexOf('{', i);
    if (j < 0) return null;
    var d = 0, inStr = false, esc = false;
    for (var k = j; k < s.length; k++) {
        var c = s.charAt(k);
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else {
            if (c === '"') inStr = true;
            else if (c === '{') d++;
            else if (c === '}') {
                d--;
                if (d === 0) return JSON.parse(s.substring(j, k + 1));
            }
        }
    }
    return null;
}

function DD_isMediaUrl(s) {
    var t = String(s || '').trim();
    if (t.indexOf('http://') !== 0 && t.indexOf('https://') !== 0) return false;
    if (t.indexOf(' ') >= 0 || t.indexOf('<') >= 0 || t.indexOf('{') >= 0 || t.indexOf('"') >= 0) return false;
    return t.length < 2048;
}

// ---------- CatVod Spider ----------

function init(cfg) { /* 无配置 */ }

function homeContent(filter) {
    return JSON.stringify({
        'class': [
            { type_id: '1', type_name: '电影' },
            { type_id: '2', type_name: '电视剧' },
            { type_id: '3', type_name: '纪录片' },
            { type_id: '4', type_name: '动漫' },
            { type_id: '5', type_name: '综艺' }
        ]
    });
}

function homeVideoContent() {
    try {
        return categoryContent('1', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = DD_reqText(DD_BASE + '/search/-------------.html?wd=' + DD_enc(kw));
    var keys = kw.split(/\s+/).filter(function (x) { return x; });
    var list = DD_parseList(html).filter(function (book) {
        return keys.every(function (k) { return book.vod_name.toLowerCase().indexOf(k.toLowerCase()) >= 0; });
    });
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

function categoryContent(tid, pg, filter, extend) {
    var typeId = String(tid || '1');
    var page = parseInt(pg, 10) || 1;
    if (page > 1) return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = DD_reqText(DD_BASE + '/type/' + typeId + '.html');
    var list = DD_parseList(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '').replace(/^didahd:/, '');
    if (!id || id.indexOf(':') >= 0) throw new Error('嘀嗒影视：不认识的书地址');
    var html = DD_reqText(DD_BASE + '/detail/' + id + '.html');
    var d = DD_parseDetail(id, html);
    var title = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
    var playUrl = d.episodes.map(function (ep) { return ep.name + '$' + ep.url; }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: 'didahd:' + id,
            vod_name: title ? title[1].trim() : '',
            vod_pic: d.cover,
            vod_content: d.intro,
            vod_remarks: d.actor,
            vod_play_from: '嘀嗒影视',
            vod_play_url: playUrl
        }]
    });
}

function playerContent(flag, id, vipFlags) {
    var url = DD_resolvePlayUrl(String(id || ''));
    return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': DD_UA, 'Referer': DD_BASE + '/' } });
}

// 章节地址 didahd:{vodId}:{sid}:{nid} 解析成最终可播地址。
function DD_resolvePlayUrl(episodeUrl) {
    if (episodeUrl.indexOf('didahd:') !== 0) throw new Error('嘀嗒影视：不认识的章节地址');
    var parts = episodeUrl.slice('didahd:'.length).split(':');
    if (parts.length < 3) throw new Error('嘀嗒影视：章节地址缺参数');
    var vodId = parts[0];
    var firstSid = parseInt(parts[1], 10) || 0;
    var nid = parts[2];
    var candidates = [firstSid];
    var lastMsg = '';
    try {
        var detailHtml = DD_reqText(DD_BASE + '/detail/' + vodId + '.html');
        var sids = DD_parseDetail(vodId, detailHtml).playableSids;
        for (var i = 0; i < sids.length; i++) if (candidates.indexOf(sids[i]) < 0) candidates.push(sids[i]);
    } catch (e) {
        lastMsg = '取详情换线失败：' + String(e.message || e).slice(0, 80);
    }
    for (var k = 0; k < candidates.length; k++) {
        try {
            return DD_resolveOneLine(vodId, DD_BASE + '/play/' + vodId + '-' + candidates[k] + '-' + nid + '.html');
        } catch (e) {
            lastMsg = '线路 sid=' + candidates[k] + '：' + String(e.message || e).slice(0, 120);
        }
    }
    throw new Error('嘀嗒影视暂未返回可播地址：' + lastMsg);
}

function DD_resolveOneLine(vodId, playUrl) {
    var playHtml = DD_reqText(playUrl, 20000, { 'Referer': DD_BASE + '/detail/' + vodId + '.html' });
    var pa = DD_braceJson(playHtml, 'player_aaaa=');
    if (!pa) throw new Error('播放页里没有 player_aaaa');
    var from = pa.from || '';
    var encrypt = pa.encrypt == null ? 0 : pa.encrypt;
    var urlField = pa.url || '';
    if (DD_NETDISK_FROM[from] || (urlField && urlField.indexOf('http') === 0)) {
        throw new Error('该线路是网盘资源（from=' + from + '），无法直接播放');
    }
    if (encrypt !== 3 || !urlField) {
        throw new Error('播放地址格式暂不支持（from=' + from + '，encrypt=' + encrypt + '）');
    }
    var artUrl = DD_BASE + '/static/player/artplayer/?url=' + urlField + '&next=' + DD_enc(playUrl);
    var artHtml = DD_reqText(artUrl, 20000, { 'Referer': playUrl });
    var vkey = /playPageUrl\s*=\s*"([^"]*)"/.exec(artHtml);
    if (!vkey) throw new Error('artplayer 页里没有 playPageUrl');
    var code = /secretKeySeed\s*=\s*"([^"]*)"/.exec(artHtml);
    if (!code) throw new Error('artplayer 页里没有 secretKeySeed');
    var ts = /timestamp\s*=\s*"([^"]*)"/.exec(artHtml);
    if (!ts) throw new Error('artplayer 页里没有 timestamp');
    var smart = /isSmartPlay\s*=\s*(true|false)/.exec(artHtml);
    if (!smart || smart[1] !== 'true') {
        var qm = /qualities\s*=\s*(\[[^\]]*\])/.exec(artHtml);
        var cipher = qm ? /"url"\s*:\s*"([^"]+)"/.exec(qm[1]) : null;
        if (!cipher) throw new Error('artplayer 非智能播放且无 qualities');
        return DD_execB(cipher[1], ts[1]);
    }
    var lastErr = null;
    for (var attempt = 1; attempt <= 3; attempt++) {
        var t = Math.floor(Date.now() / 1000);
        var body = JSON.stringify({ vkey: vkey[1], code: code[1], t: t, signature: DD_md5Hex(String(t)) });
        var respText;
        try {
            respText = DD_reqText(DD_TICKTOCK, 20000, {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Origin': DD_BASE,
                'Referer': artUrl
            }, 'POST', body);
        } catch (e) { lastErr = e; continue; }
        var resp;
        try { resp = JSON.parse(respText); } catch (e) { lastErr = e; continue; }
        if (resp.code !== 200) {
            lastErr = new Error('ticktockwow 返回 code=' + resp.code + '：' + respText.slice(0, 120));
            continue;
        }
        var cipher2 = resp.url || '';
        if (!cipher2) { lastErr = new Error('ticktockwow 没有返回 url'); continue; }
        var plain;
        try { plain = DD_execB(cipher2, ts[1]); } catch (e) { lastErr = e; continue; }
        if (!DD_isMediaUrl(plain)) throw new Error('ticktockwow 解出地址不是可播流：' + plain.slice(0, 80));
        return plain;
    }
    throw lastErr || new Error('ticktockwow 解析失败');
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