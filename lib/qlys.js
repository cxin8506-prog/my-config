var QL_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var QL_BASE = 'https://www.qlys.cc';

var QL_TYPES = [
    { id: 1, name: '电影' },
    { id: 2, name: '电视剧' },
    { id: 3, name: '短剧' },
    { id: 4, name: '动漫' },
    { id: 5, name: '综艺' },
    { id: 23, name: '漫剧' }
];

// ---------- 小工具 ----------

function QL_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function QL_stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function QL_unesc(s) {
    return String(s || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// 同步 GET 文本：返回正文，非 2xx 抛错。
function QL_reqText(url, timeoutMs) {
    var res = req(url, {
        headers: {
            'User-Agent': QL_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': QL_BASE + '/'
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function QL_attr(attrs, name) {
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"').exec(attrs || '');
    return m ? QL_unesc(m[1]) : '';
}

// 遍历页面里所有 <a ...>...</a>：fn(attrs, inner)
function QL_eachAnchor(html, fn) {
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) fn(m[1], m[2]);
}

// 找到 marker 后第一个配对的大括号 JSON。
function QL_braceJson(s, marker) {
    var i = s.indexOf(marker);
    if (i < 0) return null;
    var j = s.indexOf('{', i);
    if (j < 0) return null;
    var d = 0, inStr = false, esc = false;
    for (var k = j; k < s.length; k++) {
        var c = s[k];
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

// 候选 m3u8 是否可达（GET，200 且含 #EXTM3U）。
function QL_checkM3u8Live(url, referer) {
    try {
        var res = req(url, {
            headers: { 'User-Agent': QL_UA, 'Accept': '*/*', 'Referer': referer || (QL_BASE + '/') },
            timeout: 8000
        });
        if (!res || res.error || res.code < 200 || res.code >= 300) return false;
        return String(res.content || '').slice(0, 2048).indexOf('#EXTM3U') >= 0;
    } catch (e) {
        return false;
    }
}

// ---------- 解析 ----------

// div.movie-grid 里的卡片：a.movie-link[title] + img 封面。
// （movie-link 锚点只出现在列表区，整页取与 grid 内取等价；
//  不用 div 提取，免得嵌套 div 把列表截断。）
function QL_parseGrid(html) {
    var gridHtml = html;
    var list = [];
    var seen = {};
    QL_eachAnchor(gridHtml, function (attrs, inner) {
        if (attrs.indexOf('movie-link') < 0) return;
        var href = QL_attr(attrs, 'href');
        var mm = /^\/index\.php\/vod\/detail\/id\/(\d+)\.html$/.exec(href);
        if (!mm) return;
        var id = mm[1];
        if (seen[id]) return;
        seen[id] = 1;
        var title = QL_attr(attrs, 'title').trim();
        if (!title) {
            var im = /<img\b[^>]*>/.exec(inner);
            if (im) title = QL_attr(im[0], 'alt').trim();
        }
        if (!title) return;
        var cover = '';
        var im2 = /<img\b[^>]*src\s*=\s*"([^"]*)"/.exec(inner);
        if (im2) cover = QL_unesc(im2[1]);
        list.push({ vod_id: 'qlys:' + id, vod_name: title, vod_pic: cover, vod_remarks: '', vod_content: '' });
    });
    return list;
}

// 详情页里所有线路的 sid（按 tab 顺序）；兜底直接从播放链接里取 sid。
function QL_playableSids(html) {
    var out = [];
    QL_eachAnchor(html, function (attrs) {
        if (attrs.indexOf('line-tab') < 0) return;
        var sid = parseInt(QL_attr(attrs, 'data-line'), 10);
        if (sid && out.indexOf(sid) < 0) out.push(sid);
    });
    if (!out.length) {
        QL_eachAnchor(html, function (attrs) {
            var href = QL_attr(attrs, 'href');
            var m = /^\/index\.php\/vod\/play\/id\/\d+\/sid\/(\d+)\/nid\/\d+\.html$/.exec(href);
            if (!m) return;
            var sid = parseInt(m[1], 10);
            if (sid && out.indexOf(sid) < 0) out.push(sid);
        });
    }
    return out;
}

// 详情页解析：只列第一条线路的剧集。
function QL_parseDetail(vodId, html) {
    var title = '';
    var hm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    if (hm) title = QL_stripTags(hm[1]);
    var cover = '';
    var pm = /<div[^>]*class="[^"]*detail-poster[^"]*"[^>]*>([\s\S]{0,800}?)<img\b[^>]*src\s*=\s*"([^"]*)"/.exec(html);
    if (pm) cover = QL_unesc(pm[2]);
    if (!cover) {
        var pim = /<img\b[^>]*class="[^"]*poster-img[^"]*"[^>]*src\s*=\s*"([^"]*)"/.exec(html);
        if (pim) cover = QL_unesc(pim[1]);
    }
    var intro = '';
    var dm = /<meta[^>]*name="description"[^>]*content="([^"]*)"/.exec(html);
    if (dm) intro = QL_unesc(dm[1]).trim();
    var actor = '';
    var sm = /<span[^>]*>([\s\S]*?)<\/span>/g, smm;
    while ((smm = sm.exec(html)) !== null) {
        var t = QL_stripTags(smm[1]).trim();
        if (t.indexOf('主演') === 0) {
            actor = t.replace(/^主演[：:]/, '').trim();
            break;
        }
    }
    if (!actor) {
        var am = /主演[：:]([^<\n]+)/.exec(html);
        if (am) actor = am[1].trim();
    }
    var episodes = [];
    var sids = QL_playableSids(html);
    if (!sids.length) throw new Error('麒麟影视：详情里没有可播线路');
    var firstSid = sids[0];
    QL_eachAnchor(html, function (attrs, inner) {
        var href = QL_attr(attrs, 'href');
        var m = /^\/index\.php\/vod\/play\/id\/\d+\/sid\/(\d+)\/nid\/(\d+)\.html$/.exec(href);
        if (!m) return;
        if (parseInt(m[1], 10) !== firstSid) return;
        if (attrs.indexOf('ep-chip') < 0) return;
        var nid = m[2];
        var name = QL_stripTags(inner) || ('第' + nid + '集');
        episodes.push({ name: name, url: 'qlys:' + vodId + ':' + firstSid + ':' + nid });
    });
    if (!episodes.length) throw new Error('麒麟影视：详情里没有可播剧集');
    return { title: title, cover: cover, intro: intro, actor: actor, episodes: episodes };
}

// ---------- CatVod Spider ----------

function init(cfg) {
    // 无需配置。
}

function homeContent(filter) {
    return JSON.stringify({
        'class': QL_TYPES.map(function (t) {
            return { type_id: String(t.id), type_name: t.name };
        })
    });
}

function homeVideoContent() {
    return JSON.stringify({ list: [] });
}

// 搜索：/index.php/vod/search/wd/<片名>.html，翻页 /page/{n}.html。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = QL_reqText(QL_BASE + '/index.php/vod/search/wd/' + QL_enc(kw) + '.html', 20000);
    var total = 1;
    var tm = /第\s*\d+\s*\/\s*(\d+)\s*页/.exec(html);
    if (tm) total = Math.max(parseInt(tm[1], 10) || 1, 1);
    var list = QL_parseGrid(html);
    return JSON.stringify({ page: 1, pagecount: total, limit: 24, total: list.length, list: list });
}

// 分类：/index.php/vod/type/id/{id}.html，翻页 /page/{n}.html；
// 分页只给当前±2 的滑动窗口、无总数：有“下一页”就再给一页。
function categoryContent(tid, pg, filter, extend) {
    var typeId = parseInt(tid, 10);
    if (!typeId) throw new Error('麒麟影视：不认识的分类 ' + tid);
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    var ok = false;
    for (var i = 0; i < QL_TYPES.length; i++) if (QL_TYPES[i].id === typeId) ok = true;
    if (!ok) throw new Error('麒麟影视：不认识的分类 ' + typeId);
    var path = page === 1 ?
        '/index.php/vod/type/id/' + typeId + '.html' :
        '/index.php/vod/type/id/' + typeId + '/page/' + page + '.html';
    var html = QL_reqText(QL_BASE + path, 20000);
    var list = QL_parseGrid(html);
    if (!list.length) return JSON.stringify({ page: page, pagecount: page, limit: 24, total: 0, list: [] });
    var hasNext = false;
    QL_eachAnchor(html, function (attrs) {
        if (attrs.indexOf('page-btn') >= 0 && QL_attr(attrs, 'title') === '下一页') hasNext = true;
    });
    var maxBtn = page;
    QL_eachAnchor(html, function (attrs) {
        if (attrs.indexOf('page-btn') < 0) return;
        var title = QL_attr(attrs, 'title');
        var mm = /(\d+)/.exec(title);
        if (mm) {
            var n = parseInt(mm[1], 10);
            if (n > maxBtn) maxBtn = n;
        }
    });
    var total = hasNext ? page + 1 : Math.max(maxBtn, page);
    return JSON.stringify({ page: page, pagecount: total, limit: 24, total: list.length, list: list });
}

// 详情：GET /index.php/vod/detail/id/{id}.html，只列第一条线路的剧集。
function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    if (id.indexOf('qlys:') !== 0) throw new Error('麒麟影视：不认识的书地址 ' + id);
    var vodId = id.slice('qlys:'.length);
    if (!vodId || vodId.indexOf(':') >= 0) throw new Error('麒麟影视：不认识的书地址 ' + id);
    var html = QL_reqText(QL_BASE + '/index.php/vod/detail/id/' + vodId + '.html', 20000);
    var d = QL_parseDetail(vodId, html);
    var playUrl = d.episodes.map(function (ep) {
        return ep.name + '$' + ep.url;
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: d.title,
            vod_pic: d.cover,
            vod_content: d.intro,
            vod_play_from: '麒麟影视',
            vod_play_url: playUrl
        }]
    });
}

// 播放：章节地址 qlys:{vodId}:{sid}:{nid}；按线路顺序换线，候选 m3u8
// 做一次可达校验（200 且含 #EXTM3U 才取用），都不通回退第一条线的地址。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('qlys:') !== 0) throw new Error('麒麟影视：不认识的章节地址 ' + ep);
    var parts = ep.slice('qlys:'.length).split(':');
    if (parts.length < 3) throw new Error('麒麟影视：章节地址缺参数 ' + ep);
    var vodId = parts[0];
    var firstSid = parseInt(parts[1], 10);
    if (!firstSid) throw new Error('麒麟影视：线路 id 不是数字 ' + ep);
    var nid = parts[2];
    var detailUrl = QL_BASE + '/index.php/vod/detail/id/' + vodId + '.html';
    var candidates = [firstSid];
    try {
        var detailHtml = QL_reqText(detailUrl, 20000);
        var sids = QL_playableSids(detailHtml);
        for (var i = 0; i < sids.length; i++) {
            if (candidates.indexOf(sids[i]) < 0) candidates.push(sids[i]);
        }
    } catch (e) { /* 取详情换线失败也继续，只用第一条线。 */ }
    var firstUrl = '';
    var lastMsg = '';
    for (var k = 0; k < candidates.length; k++) {
        var sid = candidates[k];
        try {
            var playUrl = QL_BASE + '/index.php/vod/play/id/' + vodId + '/sid/' + sid + '/nid/' + nid + '.html';
            var playHtml = QL_reqText(playUrl, 20000);
            var pa = QL_braceJson(playHtml, 'player_aaaa=');
            if (!pa) throw new Error('播放页里没有 player_aaaa');
            var url = String(pa.url || '').replace(/\\\//g, '/');
            if (!url || url.indexOf('http') !== 0) {
                lastMsg = '线路 sid=' + sid + ' 没有直链地址';
                continue;
            }
            if (!firstUrl) firstUrl = url;
            if (QL_checkM3u8Live(url, playUrl)) {
                return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': QL_UA, 'Referer': playUrl } });
            }
            lastMsg = '线路 sid=' + sid + ' 的 m3u8 不可达（' + url + '）';
        } catch (e) {
            lastMsg = '线路 sid=' + sid + '：' + String(e.message || e).slice(0, 120);
        }
    }
    if (firstUrl) {
        return JSON.stringify({ parse: 0, url: firstUrl, header: { 'User-Agent': QL_UA, 'Referer': detailUrl } });
    }
    throw new Error('麒麟影视暂未返回可播地址：' + lastMsg);
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