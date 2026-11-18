var PP_BASE = 'https://www.ppnix.com';
var PP_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// ---------- 小工具 ----------

function PP_encPath(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function PP_reqText(url, timeoutMs) {
    var res = req(url, {
        headers: {
            'User-Agent': PP_UA,
            'Referer': PP_BASE + '/cn/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9'
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function PP_stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

// ---------- 列表解析 ----------

// 搜索/分类列表页的条目：li 里 a.thumbnail + h2 a。
function PP_parseListItems(html) {
    var list = [], seen = {};
    var chunks = html.split('<li>');
    for (var i = 1; i < chunks.length; i++) {
        var c = chunks[i];
        var end = c.indexOf('</li>');
        if (end >= 0) c = c.slice(0, end);
        if (c.indexOf('class="thumbnail"') < 0) continue;
        var hm = /href="(\/cn\/(?:movie|tv)\/\d+\.html)"/.exec(c);
        if (!hm) continue;
        var href = hm[1];
        if (seen[href]) continue;
        seen[href] = 1;
        var img = /<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/.exec(c) ||
                  /<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"/.exec(c);
        var cover = '', alt = '';
        if (img) {
            if (/src="/.test(img[0].slice(0, img[0].indexOf(img[1])))) { cover = img[1]; alt = img[2] || ''; }
            else { alt = img[1] || ''; cover = img[2] || ''; }
        }
        var title = '';
        var h2 = /<h2[^>]*>\s*<a[^>]*>([^<]+)<\/a>/.exec(c);
        if (h2) title = h2[1].trim();
        if (!title) title = alt.trim();
        if (!title) continue;
        var year = /\.countrie[^>]*>\s*<span[^>]*class="orange"[^>]*>([^<]*)</.exec(c) ||
                   /<span[^>]*class="orange"[^>]*>([^<]*)</.exec(c);
        var rate = /<span[^>]*class="rate"[^>]*>([^<]*)</.exec(c);
        list.push({
            vod_id: PP_BASE + href,
            vod_name: title,
            vod_pic: (cover || '').replace(/&amp;/g, '&').trim(),
            vod_remarks: [year ? year[1].trim() : '', rate ? rate[1].trim() : ''].filter(function (x) { return x; }).join(' · ')
        });
    }
    return list;
}

// ---------- CatVod Spider ----------

function init(cfg) { /* 无配置 */ }

function homeContent(filter) {
    return JSON.stringify({
        'class': [
            { type_id: 'movie', type_name: '电影' },
            { type_id: 'tv', type_name: '电视剧' }
        ]
    });
}

function homeVideoContent() {
    try {
        return categoryContent('movie', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var w = PP_encPath(kw);
    var url = PP_BASE + '/cn/search/' + w + '--.html';
    var html = PP_reqText(url);
    // 站内搜索会返回无关推荐：只保留标题含关键词的。
    var keys = kw.split(/\s+/).filter(function (x) { return x; });
    var list = PP_parseListItems(html).filter(function (book) {
        return keys.every(function (k) { return book.vod_name.toLowerCase().indexOf(k.toLowerCase()) >= 0; });
    });
    var totalPage = 1;
    var re = /\/cn\/search\/.*-(\d+)-\.html/g, m;
    while ((m = re.exec(html)) !== null) {
        var n = parseInt(m[1], 10);
        if (n > totalPage) totalPage = n;
    }
    return JSON.stringify({ page: 1, pagecount: totalPage, limit: 20, total: list.length, list: list });
}

function categoryContent(tid, pg, filter, extend) {
    var kind = String(tid || 'movie');
    if (kind !== 'movie' && kind !== 'tv') throw new Error('PPnix：不认识的分类 ' + kind);
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    var url = page <= 1 ? PP_BASE + '/cn/' + kind + '/' : PP_BASE + '/cn/' + kind + '/---' + page + '-.html';
    var html = PP_reqText(url);
    var list = PP_parseListItems(html);
    var totalPage = 1;
    var re = new RegExp('/cn/' + kind + '/---(\\d+)-\\.html', 'g'), m;
    while ((m = re.exec(html)) !== null) {
        var n = parseInt(m[1], 10);
        if (n > totalPage) totalPage = n;
    }
    return JSON.stringify({ page: page, pagecount: totalPage, limit: 20, total: list.length, list: list });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var m = /\/cn\/(movie|tv)\/(\d+)\.html/.exec(id);
    if (!m) throw new Error('PPnix：不认识的书地址');
    var vid = m[2];
    var html = PP_reqText(id);
    var tm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    var title = tm ? PP_stripTags(tm[1]) : '';
    if (!title) {
        var tt = /<title>([^<]*)<\/title>/.exec(html);
        title = tt ? tt[1].split(' - PPnix')[0].trim() : '';
    }
    var cover = '';
    var imgs = html.match(/<img[^>]*class="thumb"[^>]*>/g) || [];
    for (var i = 0; i < imgs.length; i++) {
        var alt = /alt="([^"]*)"/.exec(imgs[i]);
        var src = /src="([^"]+)"/.exec(imgs[i]);
        if (src) {
            if (alt && alt[1]) { cover = src[1]; break; }
            if (!cover) cover = src[1];
        }
    }
    var intro = '', area = '';
    var exRe = /<[^>]*class="[^"]*product-excerpt[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/g, em;
    while ((em = exRe.exec(html)) !== null) {
        var t = PP_stripTags(em[1]);
        if (t.indexOf('简介：') === 0) {
            var sp = /<span[^>]*>([\s\S]*?)<\/span>/.exec(em[1]);
            intro = sp ? PP_stripTags(sp[1]) : t.slice(3).trim();
        } else if (t.indexOf('国家：') === 0) {
            var sp2 = /<span[^>]*>([\s\S]*?)<\/span>/.exec(em[1]);
            area = sp2 ? PP_stripTags(sp2[1]) : t.slice(3).trim();
        }
    }
    var arr = /m3u8=\[([^\]]*)\]/.exec(html);
    if (!arr) throw new Error('PPnix：详情页里没有找到集数');
    var eps = arr[1].split(',').map(function (x) { return x.trim().replace(/^['"]|['"]$/g, ''); })
        .filter(function (x) { return x; });
    if (!eps.length) throw new Error('PPnix：详情页里没有找到集数');
    var playUrl = eps.map(function (ep) {
        var name = /^\d+$/.test(ep) ? ('第' + ep + '集') : ep;
        return name + '$ppnix:' + vid + ':' + ep;
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: title,
            vod_pic: (cover || '').replace(/&amp;/g, '&').trim(),
            vod_content: intro,
            vod_remarks: area,
            vod_play_from: 'PPnix',
            vod_play_url: playUrl
        }]
    });
}

// 播放：章节地址 ppnix:{id}:{集或清晰度}，地址固定可推导，直接返回 m3u8。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('ppnix:') !== 0) throw new Error('PPnix：不认识的章节地址');
    var parts = ep.slice('ppnix:'.length).split(':');
    if (parts.length < 2 || !parts[0] || !parts[1]) throw new Error('PPnix：章节地址缺参数');
    var url = PP_BASE + '/info/m3u8/' + parts[0] + '/' + parts[1] + '.m3u8';
    return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': PP_UA, 'Referer': PP_BASE + '/cn/' } });
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