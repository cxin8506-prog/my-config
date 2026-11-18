var AU_BASE = 'https://www.au1080.top';
var AU_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

var AU_SECTIONS = [
    { section: 'Movie', name: '电影' },
    { section: 'Tv', name: '电视剧' },
    { section: 'Dm', name: '动漫' },
    { section: 'Zy', name: '综艺' },
    { section: 'qita', name: '其他' }
];

var AU_AREAS = {
    Tv: [
        { area: 'neidi', name: '内地剧' }, { area: 'hanju', name: '韩剧' },
        { area: 'oumei', name: '欧美剧' }, { area: 'riju', name: '日剧' },
        { area: 'taiju', name: '泰剧' }, { area: 'waiju', name: '海外剧' },
        { area: 'wangju', name: '网剧' }
    ],
    Movie: [
        { area: 'aqp', name: '爱情片' }, { area: 'dzp', name: '动作片' },
        { area: 'jqp', name: '剧情片' }, { area: 'jsp', name: '惊悚片' },
        { area: 'kbp', name: '恐怖片' }, { area: 'khp', name: '科幻片' },
        { area: 'xjp', name: '喜剧片' }
    ],
    Dm: [
        { area: 'donghua', name: '动画电影' }, { area: 'guoman', name: '国漫' },
        { area: 'riman', name: '日漫' }, { area: 'meiman', name: '美漫' }
    ]
};

// ---------- 小工具 ----------

function AU_reqText(url, timeoutMs, referer) {
    var res = req(url, {
        headers: {
            'User-Agent': AU_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': referer || (AU_BASE + '/')
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function AU_stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

// 最小 Base64 解码（不用 atob）：返回 UTF-8 字符串。
function AU_b64DecodeUtf8(s) {
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
    var out = '';
    for (var j = 0; j < bytes.length;) {
        var b = bytes[j];
        if (b < 0x80) { out += String.fromCharCode(b); j += 1; }
        else if ((b & 0xE0) === 0xC0 && j + 1 < bytes.length) {
            out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[j + 1] & 0x3F)); j += 2;
        } else if ((b & 0xF0) === 0xE0 && j + 2 < bytes.length) {
            out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[j + 1] & 0x3F) << 6) | (bytes[j + 2] & 0x3F)); j += 3;
        } else { out += '\uFFFD'; j += 1; }
    }
    return out;
}

// ---------- 列表解析 ----------

// 分类列表页的条目：a.pic[href]，封面 img[src]，片名 img[alt]，状态 span.hdtag。
function AU_parseList(html) {
    var list = [], seen = {};
    var re = /<a[^>]*class="pic"[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
        var tag = m[0];
        var href = /href="([^"]+)"/.exec(tag);
        if (!href || href[1].charAt(0) !== '/') continue;
        var path = href[1];
        if (seen[path]) continue;
        var img = /<img[^>]*>/.exec(m[1]);
        var title = '';
        if (img) {
            var alt = /alt="([^"]*)"/.exec(img[0]);
            if (alt) title = alt[1].trim();
        }
        if (!title) title = AU_stripTags(m[1]);
        if (!title) continue;
        seen[path] = 1;
        var cover = '';
        if (img) {
            var src = /src="([^"]*)"/.exec(img[0]);
            if (src) cover = src[1].replace(/&amp;/g, '&').trim();
        }
        var status = /<span[^>]*class="hdtag"[^>]*>([^<]*)<\/span>/.exec(m[1]);
        list.push({
            vod_id: 'auete:' + path,
            vod_name: title,
            vod_pic: cover,
            vod_remarks: status ? status[1].trim() : ''
        });
    }
    return list;
}

// 分类页总页数：尾页链接 {indexPrefix}{N}.html 里的 N；没有则为 1。
function AU_parseTotalPage(html, indexPrefix) {
    var max = 1;
    var esc = indexPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp(esc + '(\\d+)\\.html', 'g'), m;
    while ((m = re.exec(html)) !== null) {
        var n = parseInt(m[1], 10);
        if (n > max) max = n;
    }
    return max;
}

// ---------- CatVod Spider ----------

function init(cfg) { /* 无配置 */ }

function homeContent(filter) {
    var classes = [];
    for (var i = 0; i < AU_SECTIONS.length; i++) {
        classes.push({ type_id: 'cat:' + AU_SECTIONS[i].section, type_name: AU_SECTIONS[i].name });
    }
    for (var s in AU_AREAS) {
        for (var j = 0; j < AU_AREAS[s].length; j++) {
            classes.push({ type_id: 'area:' + s + ':' + AU_AREAS[s][j].area, type_name: AU_AREAS[s][j].name });
        }
    }
    return JSON.stringify({ 'class': classes });
}

function homeVideoContent() {
    try {
        return categoryContent('cat:Tv', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

// 搜索做不成：站内算术图片验证码，插件里看不到图、填不了答案，也没有收答案的入口。
// 如实返回一条提示，不编结果；请用分类或地区浏览找片。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    return JSON.stringify({
        page: 1, pagecount: 1, limit: 20, total: 1,
        list: [{
            vod_id: 'auete:search:captcha',
            vod_name: '搜索要用图片验证码，搜不了“' + kw + '”',
            vod_pic: '',
            vod_remarks: '算术题验证码',
            vod_content: 'AUETE 搜索要先过站内算术题图片验证码（GET include/vdimgck.php 取图，POST ?scheckAC=check 提交答案，同 PHPSESSID 会话）。插件里看不到图、没有填答案的入口，req 也不保证两次请求带同一个会话，所以搜不了，不编假结果。请用首页分类（电影/电视剧/动漫/综艺）或地区（内地剧/韩剧/恐怖片/国漫……）浏览找片；真人要搜，在浏览器里打开 www.au1080.top，看图算出答案填进去提交。'
        }]
    });
}

function categoryContent(tid, pg, filter, extend) {
    var parts = String(tid || '').split(':');
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    if (parts[0] === 'cat' && parts.length >= 2) {
        var section = parts[1];
        var known = false;
        for (var i = 0; i < AU_SECTIONS.length; i++) if (AU_SECTIONS[i].section === section) known = true;
        if (!known) throw new Error('AUETE影视：不认识的分类 ' + section);
        var path = page <= 1 ? '/' + section + '/index.html' : '/' + section + '/index' + page + '.html';
        var html = AU_reqText(AU_BASE + path);
        var totalPage = AU_parseTotalPage(html, '/' + section + '/index');
        return JSON.stringify({ page: page, pagecount: totalPage, limit: 20, total: 0, list: AU_parseList(html) });
    }
    if (parts[0] === 'area' && parts.length >= 3) {
        var sec = parts[1], area = parts[2];
        var areas = AU_AREAS[sec] || [];
        var ok = false;
        for (var j = 0; j < areas.length; j++) if (areas[j].area === area) ok = true;
        if (!ok) throw new Error('AUETE影视：不认识的地区 ' + area);
        var path2 = page <= 1 ? '/' + sec + '/' + area + '/' : '/' + sec + '/' + area + '/index' + page + '.html';
        var html2 = AU_reqText(AU_BASE + path2);
        var total2 = AU_parseTotalPage(html2, '/' + sec + '/' + area + '/index');
        return JSON.stringify({ page: page, pagecount: total2, limit: 20, total: 0, list: AU_parseList(html2) });
    }
    throw new Error('AUETE影视：不认识的分类地址 ' + tid);
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '').replace(/^auete:/, '');
    if (!id || id.charAt(0) !== '/') throw new Error('AUETE影视：不认识的书地址');
    var html = AU_reqText(AU_BASE + id);
    var cover = /<meta[^>]*property=["']og:image["'][^>]*content="([^"]*)"/.exec(html);
    var intro = /<meta[^>]*property=["']og:description["'][^>]*content="([^"]*)"/.exec(html);
    var actor = /主演：([^<。]{1,120})/.exec(html);
    var title = /<title>([^<]*)<\/title>/.exec(html);
    // 按线路分组剧集链接，列集数最多的那条线。
    var groups = {};
    var order = [];
    var re = /<a[^>]*href="([^"]*play-(\d+)-(\d+)\.html)"[^>]*>([^<]*)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
        var line = parseInt(m[2], 10);
        var epIdx = parseInt(m[3], 10);
        var name = m[4].trim() || ('第' + (epIdx + 1) + '集');
        if (!groups[line]) { groups[line] = []; order.push(line); }
        var dup = false;
        for (var i = 0; i < groups[line].length; i++) if (groups[line][i].epIdx === epIdx) { dup = true; break; }
        if (!dup) groups[line].push({ epIdx: epIdx, name: name });
    }
    if (!order.length) throw new Error('AUETE影视：详情里没有可播剧集');
    var bestLine = order[0], bestSize = -1;
    for (var k = 0; k < order.length; k++) {
        if (groups[order[k]].length > bestSize) { bestSize = groups[order[k]].length; bestLine = order[k]; }
    }
    var eps = groups[bestLine].sort(function (a, b) { return a.epIdx - b.epIdx; });
    var playUrl = eps.map(function (ep) {
        return ep.name + '$auete:' + id + ':' + bestLine + ':' + ep.epIdx;
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: 'auete:' + id,
            vod_name: title ? title[1].split(/[-_|]/)[0].trim() : '',
            vod_pic: cover ? cover[1].replace(/&amp;/g, '&') : '',
            vod_content: intro ? intro[1].trim() : '',
            vod_remarks: actor ? actor[1].trim() : '',
            vod_play_from: 'AUETE影视',
            vod_play_url: playUrl
        }]
    });
}

function playerContent(flag, id, vipFlags) {
    var url = AU_resolvePlayUrl(String(id || ''));
    return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': AU_UA, 'Referer': AU_BASE + '/' } });
}

// 章节地址 auete:{detailPath}:{line}:{epIdx} 解析成最终可播地址。
function AU_resolvePlayUrl(episodeUrl) {
    if (episodeUrl.indexOf('auete:') !== 0) throw new Error('AUETE影视：不认识的章节地址');
    var rest = episodeUrl.slice('auete:'.length);
    var lastColon = rest.lastIndexOf(':');
    var prevColon = rest.lastIndexOf(':', lastColon - 1);
    if (lastColon < 0 || prevColon < 0) throw new Error('AUETE影视：章节地址缺参数');
    var detailPath = rest.slice(0, prevColon);
    var firstLine = parseInt(rest.slice(prevColon + 1, lastColon), 10);
    if (isNaN(firstLine)) throw new Error('AUETE影视：线路号不是数字');
    var epIdx = rest.slice(lastColon + 1);
    var candidates = [firstLine];
    var lastMsg = '';
    try {
        var detailHtml = AU_reqText(AU_BASE + detailPath);
        var lines = [];
        var re = /play-(\d+)-\d+\.html/g, m;
        while ((m = re.exec(detailHtml)) !== null) {
            var ln = parseInt(m[1], 10);
            if (lines.indexOf(ln) < 0) lines.push(ln);
        }
        for (var i = 0; i < lines.length; i++) if (candidates.indexOf(lines[i]) < 0) candidates.push(lines[i]);
    } catch (e) {
        lastMsg = '取详情换线失败：' + String(e.message || e).slice(0, 80);
    }
    for (var k = 0; k < candidates.length; k++) {
        try {
            return AU_resolveOneLine(detailPath, candidates[k], epIdx);
        } catch (e) {
            lastMsg = '线路 ' + candidates[k] + '：' + String(e.message || e).slice(0, 120);
        }
    }
    throw new Error('AUETE影视暂未返回可播地址：' + lastMsg);
}

function AU_resolveOneLine(detailPath, line, epIdx) {
    var playHtml = AU_reqText(AU_BASE + detailPath + 'play-' + line + '-' + epIdx + '.html', 20000, AU_BASE + detailPath);
    var b64 = /var now\s*=\s*base64decode\("([^"]+)"\)/.exec(playHtml);
    if (!b64) throw new Error('播放页里没有 now=base64decode');
    var url = AU_b64DecodeUtf8(b64[1]).trim();
    if (!url || url.indexOf('.m3u8') < 0) {
        throw new Error('播放地址格式暂不支持：' + url.slice(0, 80));
    }
    return url;
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