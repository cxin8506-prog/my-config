var YZ_BASE = 'https://www.yozakura.cc';
var YZ_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var YZ_GOOD_SID = 11; // xlm3u8，Kotlin 源里唯一在桌面验通过的代理线

// ---------- 小工具 ----------

function YZ_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function YZ_dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
}

function YZ_reqText(url, timeoutMs, extraHeaders) {
    var headers = {
        'User-Agent': YZ_UA,
        'Referer': YZ_BASE + '/',
 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    };
    if (extraHeaders) for (var k in extraHeaders) headers[k] = extraHeaders[k];
    var res = req(url, { headers: headers, timeout: timeoutMs || 20000 });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

// 最小 Base64 解码（不用 atob，承影 JS 环境不一定有）：返回 UTF-8 字符串。
function YZ_b64DecodeUtf8(s) {
    var table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var clean = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
    var bytes = [];
    var acc = 0, nbits = 0;
    for (var i = 0; i < clean.length; i++) {
        var c = clean.charAt(i);
        if (c === '=') break;
        acc = (acc << 6) | table.indexOf(c);
        nbits += 6;
        if (nbits >= 8) {
            nbits -= 8;
            bytes.push((acc >> nbits) & 0xFF);
        }
    }
    // 字节 → UTF-8 字符串
    var out = '';
    for (var j = 0; j < bytes.length;) {
        var b = bytes[j];
        if (b < 0x80) { out += String.fromCharCode(b); j += 1; }
        else if ((b & 0xE0) === 0xC0 && j + 1 < bytes.length) {
            out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[j + 1] & 0x3F)); j += 2;
        } else if ((b & 0xF0) === 0xE0 && j + 2 < bytes.length) {
            out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[j + 1] & 0x3F) << 6) | (bytes[j + 2] & 0x3F)); j += 3;
        } else if ((b & 0xF8) === 0xF0 && j + 3 < bytes.length) {
            var cp = ((b & 0x07) << 18) | ((bytes[j + 1] & 0x3F) << 12) | ((bytes[j + 2] & 0x3F) << 6) | (bytes[j + 3] & 0x3F);
            cp -= 0x10000;
            out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); j += 4;
        } else { out += '\uFFFD'; j += 1; }
    }
    return out;
}

function YZ_stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function YZ_absCover(raw) {
    var u = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!u || u.indexOf('loading.gif') >= 0) return '';
    return u.indexOf('http') === 0 ? u : YZ_BASE + (u.charAt(0) === '/' ? u : '/' + u);
}

// 从播放页 HTML 里抠出 player_aaaa 的 JSON（大括号配对扫描）。
function YZ_extractPlayerJson(html) {
    var start = html.indexOf('player_aaaa=');
    if (start < 0) throw new Error('樱之空：播放页里没有 player_aaaa');
    var i = html.indexOf('{', start);
    if (i < 0) throw new Error('樱之空：播放页里没有 player_aaaa');
    var depth = 0, inStr = false, esc = false;
    for (var j = i; j < html.length; j++) {
        var c = html.charAt(j);
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else {
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return JSON.parse(html.substring(i, j + 1));
            }
        }
    }
    throw new Error('樱之空：player_aaaa 的 JSON 不完整');
}

// player_aaaa 解成 {from, url}：encrypt=2 时 Base64 解码 → URL 解码。
function YZ_decodePlayUrl(html) {
    var player = YZ_extractPlayerJson(html);
    var encrypt = player.encrypt == null ? 0 : player.encrypt;
    var raw = player.url || '';
    if (!raw) throw new Error('樱之空：player_aaaa 里没有 url');
    if (encrypt === 0) { /* 直链 */ }
    else if (encrypt === 2) {
        var b64 = YZ_b64DecodeUtf8(raw);
        raw = YZ_dec(b64.replace(/\+/g, ' '));
    } else throw new Error('樱之空：不支持的 encrypt=' + encrypt);
    if (raw.indexOf('http') !== 0) throw new Error('樱之空：解出的地址不是直链');
    return { from: player.from || '', url: raw };
}

// 探一下直链的 HTTP 状态码（Range 只要前 1KB）；异常返回 -1。
function YZ_probeCode(url) {
    try {
        var res = req(url, {
            headers: { 'User-Agent': YZ_UA, 'Referer': YZ_BASE + '/', 'Range': 'bytes=0-1023' },
            timeout: 3000
        });
        if (!res || res.error) return -1;
        return res.code || -1;
    } catch (e) { return -1; }
}

// ---------- 列表解析 ----------

// 搜索/分类列表页的条目：按 .module-search-item / .module-item 分块解析。
function YZ_parseSearchItems(html) {
    var list = [], seen = {};
    // 注意：不能按 'module-search-item' 裸切——内层还有 module-search-item-detail，
    // 会把一条结果切成两半（封面在前半、标题链接在后半）。按完整 class 开头切。
    var chunks = html.split(/<div[^>]*class="module-search-item"/);
    for (var i = 1; i < chunks.length; i++) {
        var c = chunks[i];
        var hm = /\/voddetail\/(\d+)\//.exec(c);
        if (!hm) continue;
        var id = hm[1];
        if (seen[id]) continue;
        var tm = /<h3[^>]*>\s*<a[^>]*>([^<]+)<\/a>/.exec(c);
        var title = tm ? tm[1].trim() : '';
        if (!title) continue;
        seen[id] = 1;
        var im = /data-src="([^"]+)"/.exec(c) || /<img[^>]*src="([^"]+)"/.exec(c);
        var status = /video-serial[^>]*>([^<]*)</.exec(c);
        var type = /tag-link[^>]*>([^<]*)</.exec(c);
        list.push({
            vod_id: 'yozakura:detail:' + id,
            vod_name: title,
            vod_pic: YZ_absCover(im ? im[1] : ''),
            vod_remarks: (status ? status[1].trim() : '') || (type ? type[1].trim() : '')
        });
    }
    return list;
}

function YZ_parseTypeItems(html) {
    var list = [], seen = {};
    var re = /<a[^>]*href="(\/voddetail\/(\d+)\/)"[^>]*>/g, m;
    while ((m = re.exec(html)) !== null) {
        var id = m[2];
        if (seen[id]) continue;
        seen[id] = 1;
        var tail = html.slice(m.index, m.index + 1500);
        var tm = /title="([^"]+)"/.exec(m[0]);
        var title = tm ? tm[1].trim() : '';
        if (!title) {
            var am = /alt="([^"]+)"/.exec(tail);
            title = am ? am[1].trim() : '';
        }
        if (!title) continue;
        var im = /data-src="([^"]+)"/.exec(tail) || /<img[^>]*src="([^"]+)"/.exec(tail);
        var cap = /module-item-caption[^>]*>([^<]*)</.exec(tail) || /module-item-text[^>]*>([^<]*)</.exec(tail);
        list.push({
            vod_id: 'yozakura:detail:' + id,
            vod_name: title,
            vod_pic: YZ_absCover(im ? im[1] : ''),
            vod_remarks: cap ? cap[1].trim() : ''
        });
    }
    return list;
}

// 详情页按 sid 分组后的剧集：{sid: [{nid, title}]}（nid 升序）。
function YZ_sidGroups(html, id) {
    var groups = {};
    var order = [];
    var re = new RegExp('<a[^>]*href="/vodplay/' + id + '-(\\d+)-(\\d+)/"[^>]*>([\\s\\S]*?)</a>', 'g');
    var m;
    while ((m = re.exec(html)) !== null) {
        var tag = m[0];
        if (/main-btn/.test(tag) || m[3].indexOf('立即播放') >= 0) continue;
        var sid = parseInt(m[1], 10), nid = parseInt(m[2], 10);
        var title = YZ_stripTags((/<span[^>]*>([^<]*)<\/span>/.exec(m[3]) || [null, ''])[1]);
        if (!groups[sid]) { groups[sid] = []; order.push(sid); }
        var dup = false;
        for (var i = 0; i < groups[sid].length; i++) if (groups[sid][i].nid === nid) { dup = true; break; }
        if (!dup) groups[sid].push({ nid: nid, title: title });
    }
    for (var s in groups) groups[s].sort(function (a, b) { return a.nid - b.nid; });
    return { groups: groups, order: order };
}

// ---------- CatVod Spider ----------

function init(cfg) { /* 无配置 */ }

function homeContent(filter) {
    return JSON.stringify({
        'class': [
            { type_id: '1', type_name: '电影' },
            { type_id: '2', type_name: '电视剧' },
            { type_id: '26', type_name: '短剧' },
            { type_id: '3', type_name: '综艺' },
            { type_id: '4', type_name: '动漫' }
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
    var html = YZ_reqText(YZ_BASE + '/vodsearch/-------------.html?wd=' + YZ_enc(kw));
    var list = YZ_parseSearchItems(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

function categoryContent(tid, pg, filter, extend) {
    var typeId = String(tid || '1');
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    var url = page <= 1 ? YZ_BASE + '/vodtype/' + typeId + '/' : YZ_BASE + '/vodtype/' + typeId + '-' + page + '/';
    var html = YZ_reqText(url);
    var list = YZ_parseTypeItems(html);
    var totalPage = 1;
    var re = new RegExp('/vodtype/' + typeId + '-(\\d+)/', 'g'), m;
    while ((m = re.exec(html)) !== null) {
        var n = parseInt(m[1], 10);
        if (n > totalPage) totalPage = n;
    }
    return JSON.stringify({ page: page, pagecount: totalPage, limit: 20, total: list.length, list: list });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '').replace(/^yozakura:detail:/, '');
    if (!id || id.indexOf(':') >= 0) throw new Error('樱之空：不认识的书地址');
    var html = YZ_reqText(YZ_BASE + '/voddetail/' + id + '/');
    var tm = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
    var title = tm ? tm[1].trim() : '';
    if (!title) {
        var tt = /<title>([^<]*)<\/title>/.exec(html);
        title = tt ? tt[1].split('《').pop().split('》')[0].trim() : '';
    }
    var cm = /<img[^>]*data-src="([^"]*\/upload\/vod\/[^"]*)"/.exec(html);
    var intro = /<meta[^>]*name=["']description["'][^>]*content="([^"]*)"/.exec(html);
    var g = YZ_sidGroups(html, id);
    var sids = Object.keys(g.groups);
    if (!sids.length) throw new Error('樱之空：详情页里没有找到剧集');
    var primarySid = (YZ_GOOD_SID in g.groups) ? YZ_GOOD_SID : null;
    if (primarySid === null) {
        var best = -1;
        for (var i = 0; i < sids.length; i++) {
            var s = parseInt(sids[i], 10);
            if (g.groups[s].length > best) { best = g.groups[s].length; primarySid = s; }
        }
    }
    var playUrl = g.groups[primarySid].map(function (ep) {
        var name = ep.title || ('第' + ep.nid + '集');
        return name + '$yozakura:' + id + ':' + primarySid + ':' + ep.nid;
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: 'yozakura:detail:' + id,
            vod_name: title,
            vod_pic: YZ_absCover(cm ? cm[1] : ''),
            vod_content: intro ? intro[1].trim() : '',
            vod_play_from: '樱之空',
            vod_play_url: playUrl
        }]
    });
}

function playerContent(flag, id, vipFlags) {
    var url = YZ_resolvePlayUrl(String(id || ''));
    return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': YZ_UA, 'Referer': YZ_BASE + '/' } });
}

// 章节地址 yozakura:{id}:{sid}:{nid} 解析成最终可播地址。
function YZ_resolvePlayUrl(episodeUrl) {
    if (episodeUrl.indexOf('yozakura:') !== 0) throw new Error('樱之空：不认识的章节地址');
    var parts = episodeUrl.slice('yozakura:'.length).split(':');
    if (parts.length < 3) throw new Error('樱之空：章节地址缺参数');
    var id = parts[0];
    var sid = parseInt(parts[1], 10) || 0;
    var nid = parseInt(parts[2], 10) || 0;
    var decoded = YZ_decodePlayUrl(YZ_reqText(YZ_BASE + '/vodplay/' + id + '-' + sid + '-' + nid + '/'));
    if (decoded.from === 'xlm3u8') return decoded.url;
    var code = YZ_probeCode(decoded.url);
    if (code === 200 || code === 206) return decoded.url;
    var primaryDead = (code === 404);
    // 主线路探不通：按同集标题去别的 sid 组里找，先找 xlm3u8（sid 11）。
    try {
        var html = YZ_reqText(YZ_BASE + '/voddetail/' + id + '/');
        var g = YZ_sidGroups(html, id);
        var primaryTitle = '';
        var mine = g.groups[sid] || [];
        for (var i = 0; i < mine.length; i++) if (mine[i].nid === nid) { primaryTitle = mine[i].title; break; }
        var trySids = [];
        if (YZ_GOOD_SID in g.groups && YZ_GOOD_SID !== sid) trySids.push(YZ_GOOD_SID);
        var sorted = Object.keys(g.groups).map(function (x) { return parseInt(x, 10); }).sort(function (a, b) { return a - b; });
        for (var k = 0; k < sorted.length; k++) if (sorted[k] !== sid && sorted[k] !== YZ_GOOD_SID) trySids.push(sorted[k]);
        for (var t = 0; t < trySids.length; t++) {
            var s = trySids[t];
            var target = null;
            if (primaryTitle) {
                for (var j = 0; j < g.groups[s].length; j++) if (g.groups[s][j].title === primaryTitle) { target = g.groups[s][j].nid; break; }
            } else {
                for (var j2 = 0; j2 < g.groups[s].length; j2++) if (g.groups[s][j2].nid === nid) { target = g.groups[s][j2].nid; break; }
            }
            if (target === null) continue;
            try {
                var d2 = YZ_decodePlayUrl(YZ_reqText(YZ_BASE + '/vodplay/' + id + '-' + s + '-' + target + '/'));
                if (d2.from === 'xlm3u8') return d2.url;
                if (YZ_probeCode(d2.url) === 404) continue;
                var c2 = YZ_probeCode(d2.url);
                if (c2 === 200 || c2 === 206) return d2.url;
            } catch (e) { /* 这组不行，试下一组 */ }
        }
    } catch (e) { /* 详情页拉不到就不换线 */ }
    if (primaryDead) throw new Error('樱之空：该线路资源已失效（HTTP 404），换线也未找到可播地址');
    return decoded.url; // 全部探不通：返回主线路解出的地址（手机上可能能播）
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