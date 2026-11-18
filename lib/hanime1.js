var H1_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var H1_BASES = ['https://hanimeone.me', 'https://hanime1.me', 'https://hanime1.com'];
var H1_BASE = H1_BASES[0];
var H1_NS = 'hanime1';
var H1_CATS = [
    { id: 'sort:最新上市', name: '最新上市' },
    { id: 'sort:最新上傳', name: '最新上傳' },
    { id: 'sort:本日排行', name: '本日排行' },
    { id: 'sort:本週排行', name: '本週排行' },
    { id: 'sort:本月排行', name: '本月排行' },
    { id: 'sort:觀看次數', name: '觀看次數' },
    { id: 'genre:裏番', name: '裏番' },
    { id: 'genre:泡麵番', name: '泡麵番' },
    { id: 'genre:3DCG', name: '3DCG' },
    { id: 'genre:Motion Anime', name: 'Motion Anime' }
];

function H1_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function H1_stripTags(s) {
    return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

function H1_absUrl(u) {
    var t = String(u || '').replace(/&amp;/g, '&').trim();
    if (!t) return '';
    if (t.indexOf('http') === 0) return t;
    if (t.indexOf('//') === 0) return 'https:' + t;
    if (t.charAt(0) === '/') return H1_BASE + t;
    return H1_BASE + '/' + t;
}

function H1_isCfChallenge(text) {
    var t = String(text || '').toLowerCase();
    return t.indexOf('just a moment') >= 0 ||
        t.indexOf('challenges.cloudflare.com') >= 0 ||
        t.indexOf('cf-error') >= 0 ||
        (t.indexOf('attention required') >= 0 && t.indexOf('cloudflare') >= 0) ||
        (t.indexOf('ray id') >= 0 && t.indexOf('cloudflare') >= 0);
}

// 桌面 Chrome UA + 全套浏览器头（跟 Kotlin 版一致）。
function H1_docHeaders(referer) {
    return {
        'User-Agent': H1_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'Upgrade-Insecure-Requests': '1',
        'Referer': referer || (H1_BASE + '/')
    };
}

// GET 文本：单站直连，失败直接抛错（不换站、不重试），Cloudflare 验证页单独报错。
function H1_getText(url, timeoutMs) {
    var res = req(url, { headers: H1_docHeaders(H1_BASE + '/'), timeout: timeoutMs || 25000 });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    var text = res.content || '';
    // 403 也可能是 Cloudflare 验证页（跟 Kotlin 版一致），先认验证页再报 HTTP 码。
    if (H1_isCfChallenge(text)) throw new Error('被 Cloudflare 验证拦了（hanimeone.me）');
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return text;
}

// 列表页解析：两种卡片布局。按 video-item-container 切块（genre 布局没有
// 这个 class，单独再扫一遍 a[href*=watch?v=] 包 home-rows-videos-div）。
// 标题取容器 div 的 title 属性（在切块点之后的开标签里），取不到取 div.title。
function H1_parseList(html) {
    var list = [];
    var seen = {};
    var parts = String(html || '').split('video-item-container');
    for (var i = 1; i < parts.length; i++) {
        var chunk = parts[i];
        var m = /watch\?v=(\d+)/.exec(chunk);
        if (!m) continue;
        var code = m[1];
        if (seen[code]) continue;
        // erolabs 赞助广告是外链，没有本站 watch?v=（上面已按 watch?v= 过滤，
        // 这里再防一手：块里出现 erolabs 且 watch 链接指向外站就跳过）。
        if (/l\.erolabs\.com/.test(chunk)) continue;
        seen[code] = 1;
        // 标题：容器 div 的 title 属性在切块点之后、开标签里（chunk 开头就是
        // 开标签的后半段，如 `" title="…" …>`），先取它，取不到取 div.title。
        var title = '';
        var openTag = chunk.slice(0, chunk.indexOf('>') + 1);
        var titleM = /title="([^"]*)"/.exec(openTag);
        if (titleM) title = H1_stripTags(titleM[1]);
        if (!title) {
            var divTitleM = /class="title"[^>]*>([^<]*)</.exec(chunk);
            if (divTitleM) title = H1_stripTags(divTitleM[1]);
        }
        if (!title) continue;
        // 封面：块里 class 含 main-thumb 的 img 的 src（属性顺序不定，分开找）。
        var cover = '';
        var imgRe = /<img[^>]*>/g;
        var im;
        while ((im = imgRe.exec(chunk)) !== null) {
            if (im[0].indexOf('main-thumb') >= 0) {
                var srcM = /src="([^"]+)"/.exec(im[0]);
                if (srcM) { cover = H1_absUrl(srcM[1]); break; }
            }
        }
        var durM = /class="duration"[^>]*>([^<]*)</.exec(chunk);
        var duration = durM ? H1_stripTags(durM[1]) : '';
        var author = '';
        var subM = /class="subtitle"[^>]*>[\s\S]*?<a[^>]*>([^<]*)<\/a>/.exec(chunk);
        if (subM) author = H1_stripTags(subM[1]);
        var who = [author, duration].filter(function (x) { return !!x; }).join(' · ');
        list.push({ vod_id: 'hanime1:' + code, vod_name: title, vod_pic: cover, vod_remarks: who, vod_actor: author });
    }
    // 布局二：genre 分类，a[href*=watch?v=] 包 div.home-rows-videos-div。
    var aRe = /<a[^>]*href="[^"]*watch\?v=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    var am;
    while ((am = aRe.exec(html)) !== null) {
        var code2 = am[1];
        if (seen[code2]) continue;
        var block = am[2];
        if (block.indexOf('home-rows-videos-div') < 0) continue;
        seen[code2] = 1;
        var title2M = /class="home-rows-videos-title"[^>]*>([^<]*)</.exec(block);
        var title2 = title2M ? H1_stripTags(title2M[1]) : '';
        if (!title2) continue;
        var cover2 = '';
        var src2M = /<img[^>]*src="([^"]+)"/.exec(block);
        if (src2M) cover2 = H1_absUrl(src2M[1]);
        list.push({ vod_id: 'hanime1:' + code2, vod_name: title2, vod_pic: cover2, vod_remarks: '', vod_actor: '' });
    }
    return list;
}

function H1_parseTotalPage(html, page, listEmpty) {
    var m = /validateNumberInput\(this, 1, (\d+)\)/.exec(String(html || ''));
    if (m) {
        var total = parseInt(m[1], 10);
        if (total >= 1) return total;
    }
    return listEmpty ? page : page + 1;
}

function H1_searchPath(keywords, page, sortVal, genreVal) {
    var p = Math.max(1, parseInt(page, 10) || 1);
    return '/search?query=' + H1_enc(keywords || '') + '&type=&genre=' + H1_enc(genreVal || '') +
        '&sort=' + H1_enc(sortVal || '') + '&date=&duration=&page=' + p;
}

function init(ext) { }

function homeContent(filter) {
    var cls = [];
    for (var i = 0; i < H1_CATS.length; i++) {
        cls.push({ type_id: H1_CATS[i].id, type_name: H1_CATS[i].name });
    }
    return JSON.stringify({ 'class': cls });
}

function homeVideoContent() {
    try {
        return categoryContent('sort:最新上市', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var page = parseInt(pg, 10) || 1;
    var parts = String(tid || '').split(':');
    var kind = parts[0];
    var value = parts.slice(1).join(':');
    var path;
    if (kind === 'sort') path = H1_searchPath('', page, value, '');
    else if (kind === 'genre') path = H1_searchPath('', page, '', value);
    else throw new Error('Hanime1：不认识的分类 ' + tid);
    var html = H1_getText(H1_BASE + path, 25000);
    var list = H1_parseList(html);
    var totalPage = H1_parseTotalPage(html, page, list.length === 0);
    return JSON.stringify({ page: page, pagecount: totalPage, limit: 20, total: list.length, list: list });
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = H1_getText(H1_BASE + H1_searchPath(kw, 1, '', ''), 25000);
    var list = H1_parseList(html);
    var totalPage = H1_parseTotalPage(html, 1, list.length === 0);
    return JSON.stringify({ page: 1, pagecount: totalPage, limit: 20, total: list.length, list: list });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var code = id.indexOf('hanime1:') === 0 ? id.slice(8) : id;
    if (!code || code.indexOf(':') >= 0 || !/^\d+$/.test(code)) throw new Error('Hanime1：不认识的书地址');
    var html = H1_getText(H1_BASE + '/watch?v=' + code, 25000);
    var titleM = /<title>([^<]*)<\/title>/.exec(html);
    var title = titleM ? H1_stripTags(titleM[1]).replace(' - H動漫/裏番/線上看 - Hanime1.me', '').trim() : '';
    if (!title) throw new Error('Hanime1：详情页没有标题（可能被 Cloudflare 拦了）');
    var descM = /<meta name="description" content="([^"]*)"/.exec(html);
    var desc = descM ? H1_stripTags(descM[1]) : '';
    var author = '';
    var artistM = /Artist:\s*(\S+)/.exec(desc);
    if (artistM) author = artistM[1];
    var cover = '';
    var posterM = /<video[^>]*id="player"[^>]*poster="([^"]*)"/.exec(html);
    if (!posterM) posterM = /poster="([^"]*)"[^>]*id="player"/.exec(html);
    if (posterM) cover = H1_absUrl(posterM[1]);
    return JSON.stringify({
        list: [{
            vod_id: id, vod_name: title, vod_pic: cover, vod_content: desc, vod_actor: author,
            vod_play_from: 'Hanime1', vod_play_url: '正片$hanime1:' + code
        }]
    });
}

// 播放：现取详情页，video#player 下的 <source size=… src=…>，默认 720P。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    var code = ep.indexOf('hanime1:') === 0 ? ep.slice(8) : ep;
    if (!code || !/^\d+$/.test(code)) throw new Error('Hanime1：不认识的章节地址');
    var html = H1_getText(H1_BASE + '/watch?v=' + code, 25000);
    var bySize = {};
    var srcRe = /<source[^>]*>/g;
    var sm;
    while ((sm = srcRe.exec(html)) !== null) {
        var tag = sm[0];
        var sizeM = /size="(\d+)"/.exec(tag);
        var srcM = /src="([^"]+)"/.exec(tag);
        if (!sizeM || !srcM) continue;
        var u = H1_absUrl(srcM[1]);
        if (u) bySize[parseInt(sizeM[1], 10)] = u;
    }
    var order = [720, 1080, 480];
    var playUrl = '';
    for (var i = 0; i < order.length; i++) {
        if (bySize[order[i]]) { playUrl = bySize[order[i]]; break; }
    }
    if (!playUrl) throw new Error('Hanime1：详情页里没有可播地址（可能被 Cloudflare 拦了）');
    var header = {};
    if (playUrl.indexOf('hembed.com') >= 0) {
        header = { 'Referer': H1_BASE + '/', 'User-Agent': H1_UA };
    }
    return JSON.stringify({ parse: 0, url: playUrl, header: header });
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