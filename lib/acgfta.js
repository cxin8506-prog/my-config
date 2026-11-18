var AF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var AF_BASE = 'https://acgfta.com';

function AF_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function AF_stripHtml(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

function AF_absUrl(u) {
    var t = String(u || '').replace(/&amp;/g, '&').trim();
    if (!t) return '';
    if (t.indexOf('http') === 0) return t;
    if (t.indexOf('//') === 0) return 'https:' + t;
    return AF_BASE + (t.charAt(0) === '/' ? t : '/' + t);
}

function AF_getText(path, referer) {
    var url = path.indexOf('http') === 0 ? path : AF_BASE + path;
    var res = req(url, {
        headers: {
            'User-Agent': AF_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': referer || (AF_BASE + '/')
        },
        timeout: 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

// 列表页/搜索页/榜单页的条目：a.stretched-link[href^=/anime/]。
// 标题/封面/状态从卡片里取：卡片有两种，.anime-card（搜索/最近更新/
// 剧场版，链接自带标题）和榜单行（链接无文字，标题在 p.semibold 里）。
function AF_parseList(html) {
    var seen = {};
    var list = [];
    var aRe = /<a[^>]*class="[^"]*stretched-link[^"]*"[^>]*href="\/anime\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = aRe.exec(html)) !== null) {
        var id = m[1];
        if (seen[id]) continue;
        var inner = m[2];
        var title = AF_stripHtml(inner);
        var imgM = /<img[^>]*>/.exec(inner);
        var imgTag = imgM ? imgM[0] : '';
        if (!title) {
            // 榜单行：标题在链接后面不远的 p.semibold 里。
            var after = html.slice(m.index + m[0].length, m.index + m[0].length + 1200);
            var semM = /<p[^>]*class="[^"]*semibold[^"]*"[^>]*>([^<]+)<\/p>/.exec(after);
            if (semM) title = semM[1].trim();
        }
        if (!title) {
            var altM = /alt="([^"]*)"/.exec(imgTag);
            if (altM) title = altM[1].trim();
        }
        if (!title) continue;
        seen[id] = 1;
        // 封面：先取链接里的 img（data-src 优先于 src），没有就往前后找一张。
        var cover = '';
        var srcM = /data-src="([^"]*)"/.exec(imgTag) || /src="([^"]*)"/.exec(imgTag);
        if (srcM) cover = AF_absUrl(srcM[1]);
        if (!cover) {
            var around = html.slice(Math.max(0, m.index - 800), m.index + m[0].length + 800);
            var img2 = /<img[^>]*data-src="([^"]*)"/.exec(around) || /<img[^>]*src="([^"]*)"/.exec(around);
            if (img2) cover = AF_absUrl(img2[1]);
        }
        // 状态：卡片里的 .anime-update-info，或“更新至…”/“完结”。
        var card = html.slice(Math.max(0, m.index - 500), m.index + m[0].length + 1200);
        var status = '';
        var stM = /anime-update-info[^>]*>([^<]*)</.exec(card);
        if (stM) status = stM[1].trim();
        if (!status) {
            var st2 = /(更新至[^\s<]{1,12}|完结)/.exec(card);
            if (st2) status = st2[1];
        }
        list.push({
            vod_id: 'acgfta:' + id, vod_name: title,
            vod_pic: cover, vod_remarks: status
        });
    }
    return list;
}

// 从 marker 后第一个配对的大括号取 JSON 文本（字符串内转义已处理）。
function AF_braceJson(s, marker) {
    var i = s.indexOf(marker);
    if (i < 0) return null;
    var j = s.indexOf('{', i);
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

// 详情页里所有线路的 sid（按链接出现顺序，即 panel 顺序），供解析换线用。
function AF_playableSids(html) {
    var out = [];
    var allRe = /href="\/play\/\d+-(\d+)-\d+\.html"/g;
    var m;
    while ((m = allRe.exec(html)) !== null) {
        var sid = parseInt(m[1], 10);
        if (!isNaN(sid) && out.indexOf(sid) < 0) out.push(sid);
    }
    return out;
}

function AF_parseDetail(vodId, html) {
    var cover = '';
    var imgM = /<img[^>]*class="[^"]*anime-cover[^"]*"[^>]*>/.exec(html);
    if (imgM) {
        var srcM = /data-src="([^"]*)"/.exec(imgM[0]) || /src="([^"]*)"/.exec(imgM[0]);
        if (srcM) cover = AF_absUrl(srcM[1]);
    }
    var intro = '';
    var introM = /class="[^"]*detail-anime-intro[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/.exec(html);
    if (introM) intro = AF_stripHtml(introM[1]);
    var episodes = [];
    var total = 0;
    // 只列第一条线：链接按 panel 顺序出现，取第一个 sid 的连续一批链接
    //（panel 里 div 嵌套，正则切 panel 不可靠，不用 div 边界）。
    var aRe = /href="\/play\/(\d+)-(\d+)-(\d+)\.html"/g;
    var am;
    var firstSid = null;
    while ((am = aRe.exec(html)) !== null) {
        if (am[1] !== vodId) continue;
        var sid = am[2];
        if (firstSid === null) firstSid = sid;
        if (sid !== firstSid) break;
        var nid = parseInt(am[3], 10);
        var num = isNaN(nid) ? 0 : nid;
        var name = '第' + (num < 10 ? '0' + num : String(num)) + '集';
        episodes.push({ name: name, url: 'acgfta:' + vodId + ':' + sid + ':' + am[3] });
        total++;
        if (episodes.length >= 500) break;
    }
    if (!episodes.length) throw new Error('ACG饭团：详情里没有可播剧集');
    var playUrl = [];
    for (var i = 0; i < episodes.length; i++) playUrl.push(episodes[i].name + '$' + episodes[i].url);
    return {
        vod_id: 'acgfta:' + vodId,
        vod_name: '',
        vod_pic: cover,
        vod_content: intro,
        vod_play_from: 'ACG饭团',
        vod_play_url: playUrl.join('#'),
        _total: total
    };
}

function init(cfg) { /* 无配置，无登录 */ }

function homeContent(filter) {
    return JSON.stringify({
        'class': [
            { type_id: 'recent', type_name: '最近更新' },
            { type_id: 'board', type_name: '排行榜' },
            { type_id: 'movie', type_name: '剧场版' }
        ]
    });
}

function homeVideoContent() {
    try {
        return categoryContent('recent', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var kind = String(tid || 'recent');
    var page = parseInt(pg, 10) || 1;
    try {
        if (kind === 'recent') {
            var path = page <= 1 ? '/ft/recent.html' : '/ft/recent/file/recent/page/' + page + '.html';
            var html = AF_getText(path);
            var total = 1;
            var tRe = /\/ft\/recent\/file\/recent\/page\/(\d+)\.html/g;
            var tm;
            while ((tm = tRe.exec(html)) !== null) {
                var n = parseInt(tm[1], 10);
                if (!isNaN(n) && n > total) total = n;
            }
            var list = AF_parseList(html);
            return JSON.stringify({
                page: page, pagecount: total, limit: 24, total: total * 24, list: list
            });
        }
        if (kind === 'board') {
            if (page > 1) return JSON.stringify({ page: page, pagecount: 1, limit: 50, total: 0, list: [] });
            var board = AF_parseList(AF_getText('/ft/leaderboard.html'));
            return JSON.stringify({ page: 1, pagecount: 1, limit: 50, total: board.length, list: board });
        }
        if (kind === 'movie') {
            if (page > 1) return JSON.stringify({ page: page, pagecount: 1, limit: 40, total: 0, list: [] });
            var movie = AF_parseList(AF_getText('/ft/top-movie.html'));
            return JSON.stringify({ page: 1, pagecount: 1, limit: 40, total: movie.length, list: movie });
        }
        throw new Error('ACG饭团：不认识的分类 ' + kind);
    } catch (e) {
        return JSON.stringify({ page: page, pagecount: 1, limit: 24, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 18, total: 0, list: [] });
    var p = 1;
    try {
        var html = AF_getText('/search.html?wd=' + AF_enc(kw) + '&page=' + p);
        var list = AF_parseList(html);
        // 每页约 18 条；满页就可能还有下一页，未满就是末页。
        var totalPage = 1;
        if (!list.length) totalPage = 1;
        else if (list.length >= 18) totalPage = p + 1;
        else totalPage = p;
        return JSON.stringify({
            page: 1, pagecount: totalPage, limit: 18, total: list.length, list: list
        });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 18, total: 0, list: [] });
    }
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var vodId = id.indexOf('acgfta:') === 0 ? id.slice(7) : id;
    if (!vodId || vodId.indexOf(':') >= 0) throw new Error('ACG饭团：不认识的书地址');
    var html = AF_getText('/anime/' + vodId + '.html');
    var vod = AF_parseDetail(vodId, html);
    // 标题：详情页标题取 <title> 里站名之前，或 h1。
    var titleM = /<title>([^<]+)<\/title>/.exec(html);
    var title = '';
    if (titleM) title = titleM[1].split(/[-_|]/)[0].trim();
    if (!title) {
        var hM = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
        if (hM) title = hM[1].trim();
    }
    vod.vod_name = title;
    vod.vod_id = id;
    delete vod._total;
    return JSON.stringify({ list: [vod] });
}

function AF_resolveOneLine(vodId, sid, nid) {
    var playHtml = AF_getText('/play/' + vodId + '-' + sid + '-' + nid + '.html');
    var jsonText = AF_braceJson(playHtml, 'player_aaaa=');
    if (!jsonText) throw new Error('播放页里没有 player_aaaa');
    var pa = JSON.parse(jsonText);
    var encrypt = pa.encrypt != null ? parseInt(pa.encrypt, 10) : 0;
    var urlField = pa.url || '';
    if (encrypt !== 0 || !urlField || urlField.indexOf('.m3u8') < 0) {
        throw new Error('播放地址格式暂不支持（encrypt=' + encrypt + '）');
    }
    return urlField;
}

// 播放：先试详情第一条线，再按 panel 顺序换线。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('acgfta:') !== 0) throw new Error('ACG饭团：不认识的章节地址');
    var parts = ep.slice(7).split(':');
    if (parts.length < 3) throw new Error('ACG饭团：章节地址缺参数');
    var vodId = parts[0];
    var firstSid = parseInt(parts[1], 10);
    var nid = parts[2];
    if (isNaN(firstSid)) throw new Error('ACG饭团：线路 id 不是数字');
    var candidates = [firstSid];
    var lastMsg = '';
    try {
        var detailHtml = AF_getText('/anime/' + vodId + '.html');
        var sids = AF_playableSids(detailHtml);
        for (var i = 0; i < sids.length; i++) {
            if (candidates.indexOf(sids[i]) < 0) candidates.push(sids[i]);
        }
    } catch (e) {
        lastMsg = '取详情换线失败：' + String(e.message || '').slice(0, 80);
    }
    for (var j = 0; j < candidates.length; j++) {
        try {
            var url = AF_resolveOneLine(vodId, candidates[j], nid);
            return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': AF_UA, 'Referer': AF_BASE + '/' } });
        } catch (e) {
            lastMsg = '线路 sid=' + candidates[j] + '：' + String(e.message || '解析失败').slice(0, 120);
        }
    }
    throw new Error('ACG饭团暂未返回可播地址：' + lastMsg);
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