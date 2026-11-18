var MT_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var MT_BASE = 'https://www.mtyy4.cc';

var MT_TYPES = [
    { id: 1, name: '电影' },
    { id: 2, name: '电视剧' },
    { id: 3, name: '综艺' },
    { id: 4, name: '动漫' },
    { id: 26, name: '短剧' }
];

// ---------- 小工具 ----------

function MT_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function MT_stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function MT_unesc(s) {
    return String(s || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// 同步 GET 文本：返回正文，非 2xx 抛错。
function MT_reqText(url, timeoutMs) {
    var res = req(url, {
        headers: {
            'User-Agent': MT_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': MT_BASE + '/'
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function MT_reqJson(url, timeoutMs) {
    return JSON.parse(MT_reqText(url, timeoutMs || 15000));
}

function MT_attr(attrs, name) {
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"').exec(attrs || '');
    return m ? MT_unesc(m[1]) : '';
}

// 遍历页面里所有 <a ...>...</a>：fn(attrs, inner)
function MT_eachAnchor(html, fn) {
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) fn(m[1], m[2]);
}

// ---------- 解析 ----------

// 分类列表卡：a.public-list-exp，title 是片名，img data-src 是封面。
function MT_parseCategory(html) {
    var list = [];
    var seen = {};
    MT_eachAnchor(html, function (attrs, inner) {
        if (attrs.indexOf('public-list-exp') < 0) return;
        var href = MT_attr(attrs, 'href');
        var m = /^\/voddetail\/(\d+)\.html$/.exec(href);
        if (!m) return;
        var id = m[1];
        if (seen[id]) return;
        seen[id] = 1;
        var title = MT_attr(attrs, 'title').trim() || MT_stripTags(inner);
        if (!title) return;
        var cover = '';
        var im = /<img\b[^>]*>/.exec(inner);
        if (im) {
            cover = MT_attr(im[0], 'data-src') || MT_attr(im[0], 'src');
        }
        list.push({ vod_id: 'maitian:' + id, vod_name: title, vod_pic: cover, vod_remarks: '', vod_content: '' });
    });
    return list;
}

// 详情页里所有线路的 sid（按 tab 顺序），供解析换线用。
function MT_playableSids(html) {
    var out = [];
    var re = /\/vodplay\/\d+-(\d+)-\d+\.html/g, m;
    while ((m = re.exec(html)) !== null) {
        var sid = parseInt(m[1], 10);
        if (out.indexOf(sid) < 0) out.push(sid);
    }
    return out;
}

// 详情页解析：只列第一条线路的剧集。
// 返回 {cover, intro, episodes:[{name, url}]}，url 是 maitian:{vodId}:{sid}:{nid}。
function MT_parseDetail(vodId, html) {
    var title = '';
    var ot = /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/.exec(html);
    if (ot) title = MT_unesc(ot[1]).trim();
    if (!title) {
        var tt = /<title>([\s\S]*?)<\/title>/.exec(html);
        if (tt) title = MT_stripTags(tt[1]).split(/[-_|]/)[0].trim();
    }
    // og:title 常带站方后缀（如“庆余年2电视剧免费高清完整版在线观看”），逐段清掉。
    var suffixes = ['在线观看', '免费观看', '完整版', '高清完整版', '免费高清', '高清', '免费', '电视剧', '电影', '动漫', '综艺', '短剧'];
    var changed = true;
    while (changed) {
        changed = false;
        for (var si = 0; si < suffixes.length; si++) {
            var suf = suffixes[si];
            if (title.length > suf.length && title.slice(-suf.length) === suf) {
                title = title.slice(0, -suf.length);
                changed = true;
            }
        }
    }
    var cover = '';
    var og = /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/.exec(html);
    if (og) cover = MT_unesc(og[1]);
    if (!cover) {
        var pm = /<div[^>]*class="[^"]*(detail-pic|vod-pic)[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html);
        if (pm) {
            var im = /<img\b[^>]*src\s*=\s*"([^"]*)"/.exec(pm[2]);
            if (im) cover = MT_unesc(im[1]);
        }
    }
    var intro = '';
    var dm = /<meta[^>]*name="description"[^>]*content="([^"]*)"/.exec(html);
    if (dm) intro = MT_unesc(dm[1]).trim();
    var episodes = [];
    // .anthology-list-box 按 tab 顺序排列，每块只含一个 sid；只取第一块。
    var boxes = [];
    var bre = /<div[^>]*class="[^"]*anthology-list-box[^"]*"[^>]*>([\s\S]*?)<\/div>/g, bm;
    while ((bm = bre.exec(html)) !== null) boxes.push(bm[1]);
    for (var b = 0; b < boxes.length; b++) {
        var links = [];
        MT_eachAnchor(boxes[b], function (attrs, inner) {
            var href = MT_attr(attrs, 'href');
            var m = /^\/vodplay\/\d+-(\d+)-(\d+)\.html$/.exec(href);
            if (!m) return;
            links.push({ sid: m[1], nid: m[2] });
        });
        if (!links.length) continue;
        for (var i = 0; i < links.length; i++) {
            var nid = parseInt(links[i].nid, 10) || 0;
            var name = '第' + (nid < 10 ? '0' + nid : nid) + '集';
            episodes.push({ name: name, url: 'maitian:' + vodId + ':' + links[i].sid + ':' + links[i].nid });
        }
        break; // 只列第一条线路；解析时按 tab 顺序换线。
    }
    if (!episodes.length) throw new Error('麦田影院：详情里没有可播剧集');
    return { title: title, cover: cover, intro: intro, episodes: episodes };
}

// ---------- CatVod Spider ----------

function init(cfg) {
    // 无需配置。
}

function homeContent(filter) {
    return JSON.stringify({
        'class': MT_TYPES.map(function (t) {
            return { type_id: String(t.id), type_name: t.name };
        })
    });
}

function homeVideoContent() {
    return JSON.stringify({ list: [] });
}

// 搜索走 MacCMS 联想接口：只有 1 页。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var json = MT_reqJson(MT_BASE + '/index.php/ajax/suggest?mid=1&wd=' + MT_enc(kw), 15000);
    var list = [];
    var arr = (json && json.list) || [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
        var o = arr[i] || {};
        var id = String(o.id == null ? '' : o.id);
        if (!id || seen[id]) continue;
        seen[id] = 1;
        var title = String(o.name || '').trim();
        if (!title) continue;
        var cover = String(o.pic || '').replace(/\\\//g, '/').replace(/&amp;/g, '&');
        list.push({ vod_id: 'maitian:' + id, vod_name: title, vod_pic: cover, vod_remarks: '', vod_content: '' });
    }
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

// 分类只有第 1 页（/vodtype/{id}-2.html 内容与第 1 页完全相同）。
function categoryContent(tid, pg, filter, extend) {
    var typeId = parseInt(tid, 10);
    if (!typeId) throw new Error('麦田影院：不认识的分类 ' + tid);
    var page = parseInt(pg, 10) || 1;
    if (page > 1) return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = MT_reqText(MT_BASE + '/vodtype/' + typeId + '.html', 20000);
    var list = MT_parseCategory(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

// 详情：GET /voddetail/{id}.html，只列第一条线路的剧集。
function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    if (id.indexOf('maitian:') !== 0) throw new Error('麦田影院：不认识的书地址 ' + id);
    var vodId = id.slice('maitian:'.length);
    if (!vodId || vodId.indexOf(':') >= 0) throw new Error('麦田影院：不认识的书地址 ' + id);
    var html = MT_reqText(MT_BASE + '/voddetail/' + vodId + '.html', 20000);
    var d = MT_parseDetail(vodId, html);
    var playUrl = d.episodes.map(function (ep) {
        return ep.name + '$' + ep.url;
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: d.title,
            vod_pic: d.cover,
            vod_content: d.intro,
            vod_play_from: '麦田影院',
            vod_play_url: playUrl
        }]
    });
}

// 播放：章节地址 maitian:{vodId}:{sid}:{nid}；先试本线，失败按 tab 顺序换线，
// 每条线取播放页 player_aaaa JSON 里的 "url"（直接就是最终 m3u8）。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('maitian:') !== 0) throw new Error('麦田影院：不认识的章节地址 ' + ep);
    var parts = ep.slice('maitian:'.length).split(':');
    if (parts.length < 3) throw new Error('麦田影院：章节地址缺参数 ' + ep);
    var vodId = parts[0];
    var firstSid = parseInt(parts[1], 10);
    if (!firstSid) throw new Error('麦田影院：线路 id 不是数字 ' + ep);
    var nid = parts[2];
    var candidates = [firstSid];
    var lastMsg = '';
    try {
        var detailHtml = MT_reqText(MT_BASE + '/voddetail/' + vodId + '.html', 20000);
        var sids = MT_playableSids(detailHtml);
        for (var i = 0; i < sids.length; i++) {
            if (candidates.indexOf(sids[i]) < 0) candidates.push(sids[i]);
        }
    } catch (e) {
        lastMsg = '取详情换线失败：' + String(e.message || e).slice(0, 80);
    }
    for (var k = 0; k < candidates.length; k++) {
        var sid = candidates[k];
        try {
            var playHtml = MT_reqText(MT_BASE + '/vodplay/' + vodId + '-' + sid + '-' + nid + '.html', 20000);
            // player_aaaa JSON 里的 "url" 就是最终 m3u8（页内是 https:\/\/ 转义形式）。
            var m = /"url"\s*:\s*"(https?:[^"]*?\.m3u8[^"]*)"/.exec(playHtml);
            if (!m) throw new Error('播放页里没有 m3u8 地址');
            var url = m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&');
            return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': MT_UA, 'Referer': MT_BASE + '/' } });
        } catch (e) {
            lastMsg = '线路 sid=' + sid + '：' + String(e.message || e).slice(0, 120);
        }
    }
    throw new Error('麦田影院暂未返回可播地址：' + lastMsg);
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