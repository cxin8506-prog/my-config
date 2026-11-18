var AM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var AM_BASE = 'https://animoe.org';
var AM_TYPES = [
    { id: 20, name: '连载中' }, { id: 21, name: '已完结' }, { id: 23, name: '剧场版' }
];
var AM_KEY = [144, 223, 214, 167, 22, 76, 53];

function AM_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function AM_stripHtml(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

function AM_absUrl(u) {
    u = String(u || '').replace(/&amp;/g, '&').trim();
    if (!u) return '';
    if (u.indexOf('http') === 0) return u;
    if (u.indexOf('//') === 0) return 'https:' + u;
    return AM_BASE + (u.charAt(0) === '/' ? u : '/' + u);
}

function AM_reqText(url, timeoutMs) {
    var res = req(url, {
        headers: { 'User-Agent': AM_UA, 'Accept': 'text/html,application/json,*/*', 'Referer': AM_BASE + '/' },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function AM_reqBytes(url, timeoutMs) {
    // 二进制也走 req 的 content 字符串，按 charCode 取字节。
    return AM_reqText(url, timeoutMs || 30000);
}

// 字符串 → 字节数组（charCode & 0xFF）。
function AM_strToBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
    return out;
}

// 字节数组 → latin1 字符串（每字节一个字符）。
function AM_bytesToStr(bytes) {
    var chars = [];
    for (var i = 0; i < bytes.length; i++) chars.push(String.fromCharCode(bytes[i] & 0xFF));
    return chars.join('');
}

// UTF-8 字符串 → 字节数组（供 base64 用）。
function AM_utf8Bytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xC0 | (c >> 6)); out.push(0x80 | (c & 0x3F)); }
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
                var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                out.push(0xF0 | (cp >> 18)); out.push(0x80 | ((cp >> 12) & 0x3F));
                out.push(0x80 | ((cp >> 6) & 0x3F)); out.push(0x80 | (cp & 0x3F));
                i++;
            } else { out.push(0xE0 | (c >> 12)); out.push(0x80 | ((c >> 6) & 0x3F)); out.push(0x80 | (c & 0x3F)); }
        } else { out.push(0xE0 | (c >> 12)); out.push(0x80 | ((c >> 6) & 0x3F)); out.push(0x80 | (c & 0x3F)); }
    }
    return out;
}

function AM_base64Encode(bytes) {
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

// m3u8 解密（assplayer decodePlaylist）：data 是字节数组；
// 不是 enc 开头就原样返回；解密后 #EXTM3U 在 300 字节之后时去前 312 字节。
function AM_decryptM3u8(data) {
    if (data.length <= 3) return data;
    if (!(data[0] === 101 && data[1] === 110 && data[2] === 99)) return data;
    var out = data.slice(0);
    for (var n = 3; n < out.length; n++) {
        var idx = (n % 10 < AM_KEY.length) ? (n % 10) : (AM_KEY.length - 1);
        out[n] = (out[n] ^ AM_KEY[idx] ^ 165) & 0xFF;
    }
    var plain = out.slice(3);
    var text = AM_bytesToStr(plain);
    var at = text.indexOf('#EXTM3U');
    if (at > 300 && plain.length > 312) plain = plain.slice(312);
    return plain;
}

// 从 marker 后的第一个 { 起，按括号配对抽出完整 JSON 文本（字符串内转义已处理）。
function AM_braceJson(s, marker) {
    var mi = s.indexOf(marker);
    if (mi < 0) return null;
    var j = s.indexOf('{', mi);
    if (j < 0) return null;
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var k = j; k < s.length; k++) {
        var c = s.charAt(k);
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else {
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return s.substring(j, k + 1);
            }
        }
    }
    return null;
}

// 从解密后播放列表的 #EXT-X-MAP init 段判断是否 HEVC（init 段含 hvcC）。
// init 段取不到时按非 HEVC 处理（不断流）。
function AM_isHevcPlaylist(playlistText) {
    var m = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlistText);
    if (!m) return false;
    try {
        var init = AM_reqBytes(m[1], 15000);
        return init.indexOf('hvcC') >= 0;
    } catch (e) {
        return false;
    }
}

function AM_resolveOne(vodId, sid, nid) {
    var html = AM_reqText(AM_BASE + '/play/' + vodId + '-' + sid + '-' + nid + '.html', 20000);
    var jsonText = AM_braceJson(html, 'player_aaaa');
    if (!jsonText) throw new Error('animoe：播放页里没有 player_aaaa');
    var play = JSON.parse(jsonText);
    var rawUrl = play.url || '';
    if (!rawUrl) throw new Error('animoe：播放页里没有播放地址');
    var m3u8Url = rawUrl.split('*')[0];
    if (m3u8Url.indexOf('http') !== 0) throw new Error('animoe：播放地址不是 http：' + m3u8Url.slice(0, 80));
    var encrypted = AM_strToBytes(AM_reqBytes(m3u8Url, 30000));
    var plain = AM_decryptM3u8(encrypted);
    var text = AM_bytesToStr(plain);
    if (text.indexOf('#EXTM3U') !== 0) throw new Error('animoe：m3u8 解密后不是合法播放列表（前 20 字节：' + text.slice(0, 20) + '）');
    // 直接对解密后的原始字节做 base64（播放列表是 ASCII，不经过 UTF-8 重编）。
    var dataUri = 'data:application/vnd.apple.mpegurl;base64,' + AM_base64Encode(plain);
    return { dataUri: dataUri, hevc: AM_isHevcPlaylist(text) };
}

function init(cfg) { /* 无配置，无登录 */ }

function homeContent(filter) {
    var cls = [];
    for (var i = 0; i < AM_TYPES.length; i++) {
        cls.push({ type_id: String(AM_TYPES[i].id), type_name: AM_TYPES[i].name });
    }
    return JSON.stringify({ 'class': cls });
}

function homeVideoContent() {
    try {
        return categoryContent('20', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var typeId = parseInt(tid, 10);
    if (isNaN(typeId)) typeId = 20;
    var page = parseInt(pg, 10) || 1;
    // 翻页是假的，只取第 1 页。
    try {
        var html = AM_reqText(AM_BASE + '/type/' + typeId + '.html', 20000);
        var seen = {};
        var list = [];
        var aRe = /<a[^>]*class="[^"]*module-poster-item[^"]*"[^>]*href="\/info\/([^"]+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
        var m;
        while ((m = aRe.exec(html)) !== null) {
            var id = m[1];
            if (!id || seen[id]) continue;
            var inner = m[2];
            var titleM = /title="([^"]*)"/.exec(m[0]);
            var title = titleM ? AM_stripHtml(titleM[1]) : AM_stripHtml(inner);
            if (!title) continue;
            seen[id] = 1;
            var noteM = /module-item-note[^>]*>([^<]*)</.exec(inner);
            var picM = /<img[^>]*data-original="([^"]*)"/.exec(inner);
            list.push({
                vod_id: 'animoe:' + id,
                vod_name: title,
                vod_pic: AM_absUrl(picM ? picM[1] : ''),
                vod_remarks: noteM ? noteM[1].trim() : ''
            });
        }
        if (!list.length) throw new Error('animoe：分类 ' + typeId + ' 没有内容');
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    try {
        var res = req(AM_BASE + '/index.php/ajax/suggest?mid=1&wd=' + AM_enc(kw), {
            headers: { 'User-Agent': AM_UA, 'Accept': 'application/json,*/*', 'Referer': AM_BASE + '/' },
            timeout: 20000
        });
        if (!res || res.error || res.code < 200 || res.code >= 300) {
            return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
        }
        var root = JSON.parse(res.content || '{}');
        if (root.code !== 1) throw new Error('animoe 搜索失败：' + (root.msg || ''));
        var arr = root.list || [];
        var list = [];
        for (var i = 0; i < arr.length; i++) {
            var o = arr[i] || {};
            var id = parseInt(o.id, 10);
            var title = o.name || '';
            if (!id || !title) continue;
            list.push({ vod_id: 'animoe:' + id, vod_name: title, vod_pic: AM_absUrl(o.pic || ''), vod_remarks: '' });
        }
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var vodId = id.indexOf('animoe:') === 0 ? id.slice(7) : id;
    if (!vodId || vodId.indexOf(':') >= 0) throw new Error('animoe：不认识的书地址');
    var html = AM_reqText(AM_BASE + '/info/' + vodId + '.html', 20000);
    var introM = /module-info-introduction-content[^>]*>([\s\S]*?)<\/[^>]+>/.exec(html);
    var intro = introM ? AM_stripHtml(introM[1]) : '';
    var picM = /module-item-pic[\s\S]*?<img[^>]*data-original="([^"]*)"/.exec(html);
    var pic = picM ? AM_absUrl(picM[1]) : '';
    var tags = [];
    var tagRe = /module-info-tag-link[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/g;
    var tm;
    while ((tm = tagRe.exec(html)) !== null) tags.push(tm[1].trim());
    // 按 sid 分组，取集数最多的那条线；同一 (sid,nid) 去重。
    var bySid = {};
    var sidOrder = [];
    var seenEp = {};
    var aRe = /<a[^>]*class="[^"]*module-play-list-link[^"]*"[^>]*href="\/play\/([^"]+)-(\d+)-(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = aRe.exec(html)) !== null) {
        if (m[0].indexOf('main-btn') >= 0) continue;
        var sid = parseInt(m[2], 10);
        var nid = parseInt(m[3], 10);
        var key = sid + ':' + nid;
        if (seenEp[key]) continue;
        var inner = m[4];
        var spanM = /<span[^>]*>([^<]*)<\/span>/.exec(inner);
        var name = spanM ? spanM[1].trim() : '';
        if (!name) {
            var titleM = /title="([^"]*)"/.exec(m[0]);
            name = titleM ? titleM[1].replace(/^播放/, '') : ('第' + nid + '集');
        }
        if (!name || name.indexOf('立即播放') >= 0) continue;
        seenEp[key] = 1;
        if (!bySid[sid]) { bySid[sid] = []; sidOrder.push(sid); }
        bySid[sid].push({ nid: nid, name: name });
    }
    if (!sidOrder.length) throw new Error('animoe：详情里没有剧集');
    var bestSid = sidOrder[0];
    for (var s = 0; s < sidOrder.length; s++) {
        if (bySid[sidOrder[s]].length > bySid[bestSid].length) bestSid = sidOrder[s];
    }
    var eps = bySid[bestSid].sort(function (a, b) { return a.nid - b.nid; });
    var playUrl = [];
    for (var i = 0; i < eps.length; i++) {
        playUrl.push(eps[i].name + '$animoe:' + vodId + ':' + bestSid + ':' + eps[i].nid);
    }
    // <title> 是 SEO 长串（如《鬼灭之刃 柱训练篇》详情介绍_…_Animoe动漫 - animoe.org），
    // 只取《》里的片名，没有《》就取第一个 _ / - 之前。
    var titleRawM = /<title>([^<]*)<\/title>/.exec(html);
    var titleRaw = titleRawM ? AM_stripHtml(titleRawM[1]) : '';
    var title = '';
    var quotM = /《([^》]+)》/.exec(titleRaw);
    if (quotM) title = quotM[1];
    else if (titleRaw) title = titleRaw.split('_')[0].split(' - ')[0].trim();
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: title,
            vod_pic: pic,
            vod_content: intro,
            vod_actor: tags[1] || '',
            vod_play_from: 'animoe',
            vod_play_url: playUrl.join('#')
        }]
    });
}

// 播放：解密 m3u8 后以 data: URI 交播放器；HEVC 就换同集其他线路。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('animoe:') !== 0) throw new Error('animoe：不认识的章节地址');
    var parts = ep.slice(7).split(':');
    if (parts.length < 3) throw new Error('animoe：章节地址缺参数');
    var vodId = parts[0];
    var sid = parseInt(parts[1], 10);
    var nid = parseInt(parts[2], 10);
    if (isNaN(sid) || isNaN(nid)) throw new Error('animoe：线路/集序号不是数字');
    var first = AM_resolveOne(vodId, sid, nid);
    if (!first.hevc) {
        return JSON.stringify({ parse: 0, url: first.dataUri, header: { 'User-Agent': AM_UA, 'Referer': AM_BASE + '/' } });
    }
    // HEVC：App 播放器播不了，换同集其他线路找 H.264。
    for (var altSid = 1; altSid <= 4; altSid++) {
        if (altSid === sid) continue;
        try {
            var alt = AM_resolveOne(vodId, altSid, nid);
            if (!alt.hevc) {
                return JSON.stringify({ parse: 0, url: alt.dataUri, header: { 'User-Agent': AM_UA, 'Referer': AM_BASE + '/' } });
            }
        } catch (e) { /* 这条线取不到就试下一条 */ }
    }
    // 各线路都是 HEVC，返回原流（总比没有强）。
    return JSON.stringify({ parse: 0, url: first.dataUri, header: { 'User-Agent': AM_UA, 'Referer': AM_BASE + '/' } });
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