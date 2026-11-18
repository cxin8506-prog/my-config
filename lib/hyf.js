var HY_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
var HY_BASE = 'https://monkey-flix.com';
var HY_TMDB_DB = 'https://db.hls.lol/3';
var HY_TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

var HY_TYPES = [
    { id: 1, name: '电影片' },
    { id: 2, name: '连续剧' },
    { id: 3, name: '综艺片' },
    { id: 4, name: '动漫片' }
];

// ---------- 小工具 ----------

function HY_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function HY_stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function HY_unesc(s) {
    return String(s || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// 同步 GET 文本：返回正文，非 2xx 抛错。
function HY_reqText(url, timeoutMs) {
    var res = req(url, {
        headers: {
            'User-Agent': HY_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': HY_BASE + '/'
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function HY_reqJson(url, timeoutMs) {
    return JSON.parse(HY_reqText(url, timeoutMs || 15000));
}

function HY_attr(attrs, name) {
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"').exec(attrs || '');
    return m ? HY_unesc(m[1]) : '';
}

// 遍历页面里所有 <a ...>...</a>：fn(attrs, inner)
function HY_eachAnchor(html, fn) {
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) fn(m[1], m[2]);
}

// ---------- 封面 ----------

// TMDB 按标题查海报：db.hls.lol/3/search/multi（免 key），取首条 poster_path；查不到返回 ""。
function HY_tmdbPoster(title) {
    if (!title) return '';
    try {
        var root = HY_reqJson(HY_TMDB_DB + '/search/multi?query=' + HY_enc(title) + '&page=1&language=zh-CN', 15000);
        var arr = (root && root.results) || [];
        for (var i = 0; i < arr.length; i++) {
            var poster = String((arr[i] || {}).poster_path || '');
            if (poster) return HY_TMDB_IMG + poster;
        }
        return '';
    } catch (e) {
        return '';
    }
}

// 封面兜底：首字节含 ftypavif 说明是 AVIF（App 显示不了），改用 TMDB
// 按标题查海报；查不到留空。不是 AVIF 时原封面不动；探活失败时也原封面不动。
function HY_fixCoverIfAvif(cover, title) {
    if (!cover) return '';
    try {
        var res = req(cover, {
            headers: { 'User-Agent': HY_UA, 'Accept': '*/*', 'Referer': HY_BASE + '/' },
            timeout: 8000
        });
        if (!res || res.error || res.code < 200 || res.code >= 300) return cover;
        var head = String(res.content || '').slice(0, 12);
        if (head.indexOf('ftypavif') < 0) return cover;
        return HY_tmdbPoster(title);
    } catch (e) {
        return cover;
    }
}

// ---------- 解析 ----------

// /search 与 /browse 共用的卡片解析：a[href^=/watch/]，aria-label 是片名。
function HY_parseCards(html) {
    var list = [];
    var seen = {};
    HY_eachAnchor(html, function (attrs, inner) {
        var href = HY_attr(attrs, 'href');
        var m = /^\/watch\/(\d+)$/.exec(href);
        if (!m) return;
        var id = m[1];
        if (seen[id]) return;
        seen[id] = 1;
        var title = HY_attr(attrs, 'aria-label').trim() || HY_stripTags(inner);
        if (!title) return;
        var rawCover = '';
        var im = /<img\b[^>]*src\s*=\s*"([^"]*)"/.exec(inner);
        if (im) rawCover = HY_unesc(im[1]);
        list.push({
            vod_id: 'monkey:' + id,
            vod_name: title,
            vod_pic: HY_fixCoverIfAvif(rawCover, title),
            vod_remarks: '',
            vod_content: ''
        });
    });
    return list;
}

// 从 Astro props JSON 里取 movie 字段。
function HY_propsMovie(html) {
    var re = /props="([^"]*)"/g, m;
    while ((m = re.exec(html)) !== null) {
        var decoded = HY_unesc(m[1]);
        try {
            var root = JSON.parse(decoded);
            var movie = root && root.movie;
            if (movie && movie.length >= 2 && movie[1]) return movie[1];
        } catch (e) { /* 不是影片数据的 props，继续找下一个 */ }
    }
    return null;
}

// Astro props 里字段值是 [类型码, 值] 的数组（如 "vod_pic":[0,"https://…"]），
// 不是纯字符串；这里统一取第 1 个元素，纯字符串也兼容。
function HY_strField(obj, key) {
    var arr = obj[key];
    if (arr && arr.length >= 2) return String(arr[1] == null ? '' : arr[1]);
    var v = obj[key];
    return v == null ? '' : String(v);
}

// vod_play_url 播放串 →（集名，m3u8）列表。
function HY_parsePlayUrl(playUrl) {
    var out = [];
    var parts = String(playUrl || '').split('#');
    for (var i = 0; i < parts.length; i++) {
        var idx = parts[i].indexOf('$');
        if (idx <= 0) continue;
        var name = parts[i].slice(0, idx).trim();
        var url = parts[i].slice(idx + 1).trim();
        if (name && url.indexOf('http') === 0) out.push({ name: name, url: url });
    }
    return out;
}

function HY_parseDetail(id, html) {
    var movie = HY_propsMovie(html);
    if (!movie) throw new Error('猴影工坊：详情页里没有影片数据');
    var title = HY_strField(movie, 'vod_name');
    var cover = HY_fixCoverIfAvif(HY_strField(movie, 'vod_pic'), title);
    var intro = HY_strField(movie, 'vod_blurb');
    var actor = HY_strField(movie, 'vod_actor');
    var eps = HY_parsePlayUrl(HY_strField(movie, 'vod_play_url'));
    if (!eps.length) throw new Error('猴影工坊：详情里没有可播剧集');
    return { title: title, cover: cover, intro: intro, actor: actor, eps: eps };
}

// ---------- CatVod Spider ----------

function init(cfg) {
    // 无需配置。
}

function homeContent(filter) {
    return JSON.stringify({
        'class': HY_TYPES.map(function (t) {
            return { type_id: String(t.id), type_name: t.name };
        })
    });
}

function homeVideoContent() {
    return JSON.stringify({ list: [] });
}

// 搜索：GET /search?q=，只有 1 页。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = HY_reqText(HY_BASE + '/search?q=' + HY_enc(kw), 20000);
    var list = HY_parseCards(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

// 分类：GET /browse?type=N&page=P；有下一页链接就还能翻一页，否则就是最后一页。
function categoryContent(tid, pg, filter, extend) {
    var typeId = parseInt(tid, 10);
    if (!typeId) throw new Error('猴影工坊：不认识的分类 ' + tid);
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    var html = HY_reqText(HY_BASE + '/browse?type=' + typeId + '&page=' + page, 20000);
    var list = HY_parseCards(html);
    var hasNext = html.indexOf('/browse?type=' + typeId + '&page=' + (page + 1)) >= 0 ||
        new RegExp('href="/browse\\?type=' + typeId + '&page=' + (page + 1) + '"').test(html) ||
        new RegExp('href="/browse\\?page=' + (page + 1) + '"').test(html);
    var total = hasNext ? page + 1 : page;
    return JSON.stringify({
        page: page,
        pagecount: total,
        limit: 20,
        total: list.length,
        list: list
    });
}

// 详情：GET /watch/{id}，Astro props 里的 vod_play_url 直接就是 m3u8 串。
function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    if (id.indexOf('monkey:') !== 0) throw new Error('猴影工坊：不认识的书地址 ' + id);
    var vid = id.slice('monkey:'.length);
    if (!vid || vid.indexOf(':') >= 0) throw new Error('猴影工坊：不认识的书地址 ' + id);
    var html = HY_reqText(HY_BASE + '/watch/' + vid, 20000);
    var d = HY_parseDetail(vid, html);
    var playUrl = d.eps.map(function (ep, idx) {
        return ep.name + '$monkey:' + vid + ':' + (idx + 1);
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: d.title,
            vod_pic: d.cover,
            vod_content: d.intro,
            vod_play_from: '猴影工坊',
            vod_play_url: playUrl
        }]
    });
}

// 播放：章节地址 monkey:{id}:{集序号}，重取详情页按序号取那一集 m3u8。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('monkey:') !== 0) throw new Error('猴影工坊：不认识的章节地址 ' + ep);
    var parts = ep.slice('monkey:'.length).split(':');
    if (parts.length < 2) throw new Error('猴影工坊：章节地址缺参数 ' + ep);
    var vid = parts[0];
    var idx = parseInt(parts[1], 10);
    if (!idx) throw new Error('猴影工坊：集序号不是数字 ' + ep);
    var html = HY_reqText(HY_BASE + '/watch/' + vid, 20000);
    var movie = HY_propsMovie(html);
    if (!movie) throw new Error('猴影工坊：详情页里没有影片数据');
    var eps = HY_parsePlayUrl(HY_strField(movie, 'vod_play_url'));
    if (idx < 1 || idx > eps.length) throw new Error('猴影工坊：第 ' + idx + ' 集不存在（共 ' + eps.length + ' 集）');
    return JSON.stringify({ parse: 0, url: eps[idx - 1].url, header: { 'User-Agent': HY_UA, 'Referer': HY_BASE + '/' } });
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