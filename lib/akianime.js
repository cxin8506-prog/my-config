var AK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var AK_BASE = 'https://www.akianime.com';
var AK_NS = 'akianime';
var AK_TMDB_DB = 'https://db.hls.lol/3';
var AK_TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
var AK_DEFAULT_PARSE = 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=';
var AK_PARSE_MAP = {
    'YDY': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'ltwpz': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'xinpan': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'ty': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'lzm3u8': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'bfzym3u8': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'bilibili': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'yd2': 'https://aniplayer.xn--gmqr9gevarqk8t.cn/?url=',
    'aki': 'https://webplayer.aki01a1.top/player/index.php?code=qw&if=1&url=',
    'ltwp': 'https://webplayer.aki01a1.top/player/index.php?code=qw&if=1&url=',
    'sxzj': 'https://player.xn--gmqr9gevarqk8t.cn/player/index.php?code=qw&if=1&url=',
    'heimuer': 'https://player.xn--gmqr9gevarqk8t.cn/player/ec.php?code=qw&if=1&url=',
    'modum3u8': 'https://player.xn--gmqr9gevarqk8t.cn/player/ec.php?code=qw&if=1&url=',
    'xg_app_player': 'https://www.x-n.cc/api.php?url='
};
var AK_TYPES = [
    { id: 20, name: '新旧番剧' }, { id: 21, name: '动漫剧场' }
];
var AK_cookies = null; // {name: value}
var AK_posterCache = {}; // 标题 -> 海报地址（内存，同一会话内不再重复查 TMDB）

function AK_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function AK_stripHtml(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

function AK_localGet(key) {
    try {
        if (typeof local === 'undefined') return '';
        var v = local.get(AK_NS, key);
        return v ? String(v) : '';
    } catch (e) { return ''; }
}

function AK_localSet(key, val) {
    try {
        if (typeof local === 'undefined') return;
        local.set(AK_NS, key, val);
    } catch (e) { /* 忽略 */ }
}

function AK_loadCookies() {
    if (AK_cookies) return AK_cookies;
    AK_cookies = {};
    try {
        var saved = JSON.parse(AK_localGet('cookies') || '{}');
        for (var k in saved) AK_cookies[k] = saved[k];
    } catch (e) { AK_cookies = {}; }
    return AK_cookies;
}

function AK_saveCookies() {
    AK_localSet('cookies', JSON.stringify(AK_cookies || {}));
}

function AK_cookieHeader() {
    var jar = AK_loadCookies();
    var parts = [];
    for (var k in jar) parts.push(k + '=' + jar[k]);
    return parts.join('; ');
}

function AK_header(res, name) {
    if (!res || !res.headers) return '';
    var want = name.toLowerCase();
    for (var k in res.headers) {
        if (k.toLowerCase() === want) {
            var v = res.headers[k];
            if (v instanceof Array) return v.length ? String(v[0]) : '';
            return String(v);
        }
    }
    return '';
}

function AK_storeCookies(res) {
    if (!res || !res.headers) return;
    var jar = AK_loadCookies();
    var changed = false;
    for (var k in res.headers) {
        if (k.toLowerCase() !== 'set-cookie') continue;
        var v = res.headers[k];
        var list = (v instanceof Array) ? v : [String(v)];
        for (var i = 0; i < list.length; i++) {
            var pair = String(list[i]).split(';')[0].trim();
            var eq = pair.indexOf('=');
            if (eq > 0) { jar[pair.slice(0, eq)] = pair.slice(eq + 1); changed = true; }
        }
    }
    if (changed) AK_saveCookies();
}

function AK_resolveUrl(base, rel) {
    if (rel.indexOf('http') === 0) return rel;
    if (rel.indexOf('//') === 0) return 'https:' + rel;
    var origin = base.split('/').slice(0, 3).join('/');
    if (rel.charAt(0) === '/') return origin + rel;
    if (rel.charAt(0) === '?') return base.split('?')[0] + rel;
    var dir = base.slice(0, base.lastIndexOf('/'));
    return dir + '/' + rel;
}

// 带 cookie jar、手动跟随跳转的 GET（cckey 墙 302 到 ?cckey=…，跟随即过）。
// 超时且 jar 非空时清 jar 重试一次（过期 Cookie 会让服务器挂起不响应）。
function AK_getText(url, referer) {
    var cleared = false;
    var current = url;
    for (var attempt = 0; attempt < 2; attempt++) {
        try {
            var hops = 0;
            while (hops < 8) {
                var headers = {
                    'User-Agent': AK_UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                    'Referer': referer || (AK_BASE + '/')
                };
                var ck = AK_cookieHeader();
                if (ck) headers['Cookie'] = ck;
                var res = req(current, { headers: headers, timeout: 20000 });
                if (!res) throw new Error('无响应: ' + current);
                if (res.error) throw new Error('请求失败: ' + res.error);
                AK_storeCookies(res);
                if (res.code >= 300 && res.code < 400) {
                    var loc = AK_header(res, 'location');
                    if (!loc) throw new Error('AkiAnime 跳转无 Location：' + current);
                    current = AK_resolveUrl(current, loc);
                    hops++;
                    continue;
                }
                if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + current);
                return res.content || '';
            }
            throw new Error('AkiAnime 跳转太多：' + url);
        } catch (e) {
            var msg = String(e && e.message || '');
            var isTimeout = msg.indexOf('超时') >= 0 || msg.indexOf('timeout') >= 0 || msg.indexOf('timed out') >= 0;
            if (!cleared && AK_loadCookies() && Object.keys(AK_loadCookies()).length > 0 && (isTimeout || attempt === 0)) {
                // 超时（或第一次失败且 jar 非空）：清 jar 重试一次。
                if (isTimeout || msg.indexOf('HTTP') < 0) {
                    AK_cookies = {};
                    AK_saveCookies();
                    cleared = true;
                    current = url;
                    continue;
                }
            }
            throw e;
        }
    }
    throw new Error('AkiAnime 请求失败：' + url);
}

// api_config.php 的 POST（form 表单，jQuery ajax 同款头）。
function AK_postForm(url, params, referer, origin) {
    var parts = [];
    for (var k in params) parts.push(AK_enc(k) + '=' + AK_enc(params[k]));
    var body = parts.join('&');
    var headers = {
        'User-Agent': AK_UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Origin': origin
    };
    var ck = AK_cookieHeader();
    if (ck) headers['Cookie'] = ck;
    var res = req(url, { method: 'POST', headers: headers, body: body, timeout: 25000 });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    AK_storeCookies(res);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

// TMDB 按标题查海报：db.hls.lol/3/search/multi（免 key），取首条 poster_path。
function AK_tmdbPoster(title) {
    if (!title) return '';
    if (AK_posterCache[title] != null) return AK_posterCache[title];
    var poster = '';
    try {
        var res = req(AK_TMDB_DB + '/search/multi?query=' + AK_enc(title) + '&page=1&language=zh-CN', {
            headers: { 'User-Agent': AK_UA, 'Accept': 'application/json' },
            timeout: 15000
        });
        if (res && !res.error && res.code >= 200 && res.code < 300) {
            var root = JSON.parse(res.content || '{}');
            var arr = root.results || [];
            for (var i = 0; i < arr.length; i++) {
                var p = (arr[i] && arr[i].poster_path) || '';
                if (p) { poster = AK_TMDB_IMG + p; break; }
            }
        }
    } catch (e) { poster = ''; }
    AK_posterCache[title] = poster;
    return poster;
}

function AK_searchUrl(keywords, page) {
    var e = AK_enc(keywords);
    if (page <= 1) return AK_BASE + '/bgmsearch/' + e + '-------------.html';
    return AK_BASE + '/bgmsearch/' + e + '----------' + page + '---.html';
}

function AK_parseSearchHtml(html) {
    var remarks = [];
    var rRe = /slide-info-remarks cor5">([^<]+)</g;
    var rm;
    while ((rm = rRe.exec(html)) !== null) remarks.push(rm[1].trim());
    var cards = [];
    var cRe = /href="\/bgmdetail\/([A-Za-z0-9]+)\.html"[^>]*>\s*<h3[^>]*>([^<]+)<\/h3>/g;
    var cm;
    while ((cm = cRe.exec(html)) !== null) cards.push({ id: cm[1], title: AK_stripHtml(cm[2]) });
    var out = [];
    for (var i = 0; i < cards.length; i++) {
        if (!cards[i].title) continue;
        out.push({
            vod_id: 'aki:' + cards[i].id,
            vod_name: cards[i].title,
            vod_pic: AK_tmdbPoster(cards[i].title),
            vod_remarks: remarks[i] || ''
        });
    }
    return out;
}

function AK_parseTypeHtml(html) {
    var out = [];
    var seen = {};
    var re = /class="public-list-exp" href="\/bgmdetail\/([A-Za-z0-9]+)\.html" title="([^"]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        if (seen[m[1]]) continue;
        seen[m[1]] = 1;
        var title = AK_stripHtml(m[2]);
        if (!title) continue;
        out.push({
            vod_id: 'aki:' + m[1], vod_name: title,
            vod_pic: AK_tmdbPoster(title), vod_remarks: ''
        });
    }
    return out;
}

// 剧集：带 badge 的 swiper-slide 是线路名（与 anthology-list-box 按顺序对应），
// 按集号合并各线路，优先取名字含“超高/原画/高清”的线路，缺集再补其它线路。
function AK_parseEpisodes(vodId, html) {
    var lineNames = [];
    var lnRe = /class="swiper-slide"[^>]*>([\s\S]*?)<span class="badge">(\d+)<\/span>/g;
    var lm;
    while ((lm = lnRe.exec(html)) !== null) {
        var name = AK_stripHtml(lm[1]).replace(/[0-9]+$/, '').trim();
        lineNames.push(name);
    }
    var boxes = [];
    var bxRe = /anthology-list-box[^>]*><div><ul class="anthology-list-play size">([\s\S]*?)<\/ul>/g;
    var bm;
    while ((bm = bxRe.exec(html)) !== null) boxes.push(bm[1]);
    if (!boxes.length) return [];
    var lines = [];
    for (var bi = 0; bi < boxes.length; bi++) {
        var name = lineNames[bi] || ('线路' + (bi + 1));
        var eps = [];
        var epRe = /href="\/bgmplay\/([A-Za-z0-9]+)-(\d+)-(\d+)\.html"[^>]*>([^<]*)<\/a>/g;
        var em;
        while ((em = epRe.exec(boxes[bi])) !== null) {
            var sid = parseInt(em[2], 10);
            var nid = parseInt(em[3], 10);
            var label = AK_stripHtml(em[4]);
            var numM = /(\d+)/.exec(label);
            if (isNaN(sid) || isNaN(nid) || !numM) continue;
            eps.push({ num: parseInt(numM[1], 10), sid: sid, nid: nid });
        }
        if (eps.length) lines.push({ name: name, count: eps.length, eps: eps });
    }
    if (!lines.length) return [];
    lines.sort(function (a, b) {
        var pa = (a.name.indexOf('超高') >= 0 || a.name.indexOf('原画') >= 0 || a.name.indexOf('高清') >= 0) ? 1 : 0;
        var pb = (b.name.indexOf('超高') >= 0 || b.name.indexOf('原画') >= 0 || b.name.indexOf('高清') >= 0) ? 1 : 0;
        if (pb !== pa) return pb - pa;
        return b.count - a.count;
    });
    var best = {};
    for (var li = 0; li < lines.length; li++) {
        var eps2 = lines[li].eps;
        for (var ei = 0; ei < eps2.length; ei++) {
            if (!best[eps2[ei].num]) best[eps2[ei].num] = eps2[ei];
        }
    }
    var nums = [];
    for (var n in best) nums.push(parseInt(n, 10));
    nums.sort(function (a, b) { return a - b; });
    var out = [];
    for (var ni = 0; ni < nums.length; ni++) {
        var ep = best[nums[ni]];
        out.push({ name: '第' + nums[ni] + '集', url: 'aki:' + vodId + ':' + ep.sid + ':' + ep.nid });
    }
    return out;
}

function AK_parseDetail(vodId, html) {
    var titleM = /<title>([^<]+?)_[^<]*<\/title>/.exec(html);
    var title = titleM ? titleM[1].trim() : '';
    if (!title) {
        var hM = /<h[1-4][^>]*>([^<]{1,40})<\/h[1-4]>/.exec(html);
        title = hM ? hM[1].trim() : vodId;
    }
    var introM = /<meta name="description" content="([^"]*)"/.exec(html);
    var intro = introM ? AK_stripHtml(introM[1]) : '';
    var actor = '';
    var actorM = /主演：<\/em>([\s\S]*?)<\/li>/.exec(html);
    if (actorM) {
        var aNames = [];
        var aRe = /<a[^>]*>([^<]+)<\/a>/g;
        var am;
        while ((am = aRe.exec(actorM[1])) !== null) aNames.push(am[1].trim());
        actor = aNames.join(',');
    }
    var director = '';
    var dirM = /导演\s*:<\/strong>([\s\S]*?)<\/div>/.exec(html);
    if (dirM) {
        var dNames = [];
        var dRe = /<a[^>]*>([^<]+)<\/a>/g;
        var dm;
        while ((dm = dRe.exec(dirM[1])) !== null) dNames.push(dm[1].trim());
        director = dNames.join(',');
    }
    var episodes = AK_parseEpisodes(vodId, html);
    if (!episodes.length) throw new Error('AkiAnime：详情里没有剧集');
    var playUrl = [];
    for (var i = 0; i < episodes.length; i++) playUrl.push(episodes[i].name + '$' + episodes[i].url);
    return {
        vod_id: 'aki:' + vodId,
        vod_name: title,
        vod_pic: AK_tmdbPoster(title),
        vod_content: intro,
        vod_actor: actor,
        vod_director: director,
        vod_play_from: 'AkiAnime',
        vod_play_url: playUrl.join('#')
    };
}

function init(cfg) { /* 无配置，无登录 */ }

function homeContent(filter) {
    var cls = [];
    for (var i = 0; i < AK_TYPES.length; i++) {
        cls.push({ type_id: String(AK_TYPES[i].id), type_name: AK_TYPES[i].name });
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
    try {
        var html = AK_getText(AK_BASE + '/bgmtype/' + typeId + '.html');
        var list = AK_parseTypeHtml(html);
        return JSON.stringify({ page: 1, pagecount: 1, limit: 32, total: list.length, list: list });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 32, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    try {
        var html = AK_getText(AK_searchUrl(kw, 1));
        var list = AK_parseSearchHtml(html);
        var totalPage = 1;
        var tpM = /当前\d+\/(\d+)页/.exec(html);
        if (tpM) totalPage = parseInt(tpM[1], 10) || 1;
        return JSON.stringify({
            page: 1, pagecount: totalPage, limit: 20, total: list.length, list: list
        });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var vodId = id.indexOf('aki:') === 0 ? id.slice(4) : id;
    if (!vodId || vodId.indexOf(':') >= 0) throw new Error('AkiAnime：不认识的书地址');
    var html = AK_getText(AK_BASE + '/bgmdetail/' + vodId + '.html');
    var vod = AK_parseDetail(vodId, html);
    vod.vod_id = id;
    return JSON.stringify({ list: [vod] });
}

// 播放：直链直接返回；加密线走第三方解析（每次重试都重新取新鲜 key/time）。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('aki:') !== 0) throw new Error('AkiAnime：不认识的章节地址');
    var parts = ep.slice(4).split(':');
    if (parts.length < 3) throw new Error('AkiAnime：章节地址缺参数');
    var vodId = parts[0];
    var sid = parts[1];
    var nid = parts[2];
    var playHtml = AK_getText(AK_BASE + '/bgmplay/' + vodId + '-' + sid + '-' + nid + '.html');
    var aaaaStart = playHtml.indexOf('player_aaaa');
    if (aaaaStart < 0) throw new Error('AkiAnime：播放页里没有 player_aaaa');
    var aaaa = playHtml.substring(aaaaStart, Math.min(aaaaStart + 3000, playHtml.length));
    var fromM = /"from"\s*:\s*"([^"]+)"/.exec(aaaa);
    var from = fromM ? fromM[1] : '';
    var urlM = /"url"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(aaaa);
    var rawUrl = urlM ? urlM[1].split('\\/').join('/') : '';
    if (!rawUrl) throw new Error('AkiAnime：播放页里没有视频地址');
    if (rawUrl.indexOf('http') === 0 &&
        (rawUrl.indexOf('.m3u8') >= 0 || rawUrl.indexOf('.mp4') >= 0 || rawUrl.indexOf('.flv') >= 0)) {
        return JSON.stringify({ parse: 0, url: rawUrl, header: { 'User-Agent': AK_UA, 'Referer': AK_BASE + '/' } });
    }
    var parseBase = AK_PARSE_MAP[from] || AK_DEFAULT_PARSE;
    var hostM = /^(https?:\/\/[^\/]+)/.exec(parseBase);
    var parseHost = hostM ? hostM[1] : 'https://aniplayer.xn--gmqr9gevarqk8t.cn';
    var apiUrl = parseHost + '/api_config.php';
    var lastErr = '';
    for (var attempt = 0; attempt < 3; attempt++) {
        try {
            var parsePageUrl = parseBase + AK_enc(rawUrl);
            var parseHtml = AK_getText(parsePageUrl, AK_BASE + '/');
            var keyM = /"key"\s*:\s*"([0-9a-f]+)"/.exec(parseHtml);
            if (!keyM) throw new Error('解析页里没有 key');
            var timeM = /"time"\s*:\s*"(\d+)"/.exec(parseHtml);
            if (!timeM) throw new Error('解析页里没有 time');
            var resp = AK_postForm(apiUrl,
                { url: rawUrl, time: timeM[1], key: keyM[1], title: '' },
                parsePageUrl, parseHost);
            var videoM = /"url"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(resp);
            var videoUrl = videoM ? videoM[1].split('\\/').join('/') : '';
            if (videoUrl.indexOf('http') === 0) {
                return JSON.stringify({ parse: 0, url: videoUrl, header: { 'User-Agent': AK_UA, 'Referer': parsePageUrl } });
            }
            lastErr = '解析服务未返回地址：' + resp.slice(0, 150);
        } catch (e) {
            lastErr = String(e && e.message || '解析失败');
        }
    }
    throw new Error('AkiAnime 播放解析失败（已试 3 次）：' + lastErr);
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