var SO_API = 'https://api.sorani.cc/sorani-cms';
var SO_WEB = 'https://www.sorani.net';
var SO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var SO_NS = 'sorani';
var SO_PAGE_SIZE = 20;

var SO_CATS = [
    { id: 0, name: '全部' },
    { id: 1, name: 'TV番剧' },
    { id: 2, name: '剧场动画' },
    { id: 5, name: '特摄剧场' },
    { id: 7, name: '国漫' }
];

var SO_TOKEN_HELP = '青空次元播放要登录：在网页里打开 https://www.sorani.net/ 登进去（验证码自己过），登完把浏览器 localStorage 里的 sorani_auth_token 那串 JSON 复制出来，在本源里搜“token:{那串JSON}”保存，播放时源自己用它取流。登录过期了就再登一次、重新保存。不要把账号密码发给任何人。';

// ---------- 小工具 ----------

function SO_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function SO_localGet(key) {
    try {
        if (typeof local === 'undefined') return '';
        var v = local.get(SO_NS, key);
        return v ? String(v) : '';
    } catch (e) { return ''; }
}

function SO_localSet(key, val) {
    try {
        if (typeof local === 'undefined') return false;
        local.set(SO_NS, key, val);
        return true;
    } catch (e) { return false; }
}

// 同步 GET 文本；非 2xx 不抛错（播放接口用 HTTP 码 + 报文一起判断登录过期）。
function SO_reqText(url, headers, method, postBody) {
    var h = { 'User-Agent': SO_UA, 'Accept': 'application/json, */*' };
    if (headers) {
        for (var k in headers) h[k] = headers[k];
    }
    var opts = { headers: h, timeout: 20000 };
    if (method === 'POST') {
        opts.method = 'POST';
        if (postBody != null) opts.body = postBody;
    }
    var res = req(url, opts);
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    return { code: res.code || 0, body: res.content || '' };
}

function SO_reqJson(url, headers, method, postBody) {
    var r = SO_reqText(url, headers, method, postBody);
    var json = {};
    try { json = JSON.parse(r.body || '{}'); } catch (e) { json = {}; }
    return { code: r.code, json: json, body: r.body };
}

function SO_parseRecords(json) {
    if (!json || json.code !== 200) {
        throw new Error('青空次元请求失败：' + ((json && json.message) || ''));
    }
    var data = json.data || {};
    var total = data.total || 0;
    var pages = data.pages || 0;
    if (pages <= 0) pages = total > 0 ? Math.ceil(total / SO_PAGE_SIZE) : 1;
    var arr = data.records || [];
    var list = [];
    for (var i = 0; i < arr.length; i++) {
        var o = arr[i] || {};
        var id = o.id || 0;
        var title = String(o.title || '').trim();
        if (!id || !title) continue;
        var remarks = [o.categoryName || '', o.latestEpisodeLabel || ''].filter(function (x) { return x; }).join(' ');
        list.push({
            vod_id: 'sorani:' + id,
            vod_name: title,
            vod_pic: o.cover || '',
            vod_remarks: remarks,
            vod_content: ''
        });
    }
    return { list: list, pages: pages };
}

// ---------- Token ----------

// local 里存整个 sorani_auth_token 的 JSON。
function SO_readToken() {
    var raw = SO_localGet('auth_token');
    if (!raw) return null;
    try {
        var o = JSON.parse(raw);
        if (o && o.accessToken) return o;
        return null;
    } catch (e) { return null; }
}

function SO_writeToken(obj) {
    var cur = SO_readToken() || {};
    for (var k in obj) cur[k] = obj[k];
    SO_localSet('auth_token', JSON.stringify(cur));
    return cur;
}

// ---------- 搜索 / 分类 / 详情 ----------

function SO_searchImpl(keywords, page) {
    var p = Math.max(1, page || 1);
    var r = SO_reqJson(SO_API + '/api/video?page=' + p + '&size=' + SO_PAGE_SIZE +
        '&keyword=' + SO_enc(keywords) + '&sortMode=relevance_popular');
    return SO_parseRecords(r.json);
}

function SO_categoryImpl(url) {
    var parts = url.split(':');
    if (parts.length < 4 || parts[0] !== 'sorani' || parts[1] !== 'list') {
        throw new Error('青空次元：不认识的分类地址 ' + url);
    }
    var catId = parseInt(parts[2], 10);
    if (isNaN(catId)) throw new Error('青空次元：分类 id 不是数字');
    var page = Math.max(1, parseInt(parts[3], 10) || 1);
    var catParam = catId === 0 ? '' : '&categoryId=' + catId;
    var r = SO_reqJson(SO_API + '/api/video?page=' + page + '&size=' + SO_PAGE_SIZE + catParam);
    var parsed = SO_parseRecords(r.json);
    var nextUrl = page < parsed.pages ? 'sorani:list:' + catId + ':' + (page + 1) : '';
    return { list: parsed.list, page: page, totalPage: parsed.pages, nextUrl: nextUrl };
}

function SO_detailImpl(bookUrl) {
    var videoId = bookUrl.slice('sorani:'.length);
    if (!videoId || videoId.indexOf(':') >= 0) throw new Error('青空次元：不认识的书地址');
    var r = SO_reqJson(SO_API + '/api/video/' + SO_enc(videoId));
    var root = r.json || {};
    if (root.code !== 200) {
        throw new Error('青空次元详情失败：' + (root.message || ''));
    }
    var data = root.data || {};
    var intro = data.summary || '';
    var cover = data.cover || '';
    var tmp = [];
    var arr = data.episodes || [];
    for (var i = 0; i < arr.length; i++) {
        var o = arr[i] || {};
        var epId = o.episodeId || 0;
        if (!epId) continue;
        var order = o.episodeOrder || 0;
        var title = String(o.title || '').trim() || ('第' + Math.floor(order) + '集');
        tmp.push({ order: order, title: title, epId: epId });
    }
    tmp.sort(function (a, b) { return a.order - b.order; });
    if (!tmp.length) throw new Error('青空次元：详情里没有剧集');
    var playUrl = tmp.map(function (e) {
        return e.title + '$sorani:' + videoId + ':' + e.epId + ':' + Math.floor(e.order);
    }).join('#');
    return {
        vod_id: bookUrl,
        vod_name: data.title || '',
        vod_pic: cover,
        vod_content: intro,
        vod_play_from: '青空次元',
        vod_play_url: playUrl
    };
}

// ---------- 播放解析 ----------

// 章节地址 → (videoId, episodeId, order)。
// 新格式 sorani:{videoId}:{episodeId}:{order}；
// 剧集页 URL（https://www.sorani.net/anime/mal/{videoId}/episode/{order}）
// 也兼容，页 URL 没有 episodeId，要调一次集信息接口查。
function SO_parseEpisodeAddress(episodeUrl) {
    if (episodeUrl.indexOf('sorani:') === 0) {
        var parts = episodeUrl.slice('sorani:'.length).split(':');
        if (parts.length < 3) throw new Error('青空次元：章节地址缺参数');
        var videoId = parts[0];
        var episodeId = parseInt(parts[1], 10);
        var order = parseInt(parts[2], 10) || 1;
        if (!episodeId) throw new Error('青空次元：集 id 不是数字');
        return { videoId: videoId, episodeId: episodeId, order: order };
    }
    var m = /https:\/\/www\.sorani\.net\/anime\/mal\/(\d+)\/episode\/(\d+)/.exec(episodeUrl);
    if (!m) throw new Error('青空次元：不认识的章节地址');
    var vid = m[1];
    var ord = parseInt(m[2], 10) || 1;
    var ordStr = ord < 10 ? '0' + ord : String(ord);
    var r = SO_reqJson(SO_API + '/api/video/episode/video/' + vid + '/episode/' + ordStr);
    var root = r.json || {};
    if (root.code !== 200) {
        throw new Error('青空次元查集失败：' + (root.message || ''));
    }
    var epId = (root.data && root.data.episodeId) || 0;
    if (!epId) throw new Error('青空次元：集信息里没有 episodeId');
    return { videoId: vid, episodeId: epId, order: ord };
}

function SO_playOnce(episodeId, videoId, order, accessToken) {
    var ordStr = order < 10 ? '0' + order : String(order);
    var referer = SO_WEB + '/anime/mal/' + videoId + '/episode/' + ordStr;
    var r = SO_reqJson(
        SO_API + '/api/video/episode/' + episodeId + '/play?lineCode=anime_jp_m3u8',
        { 'Referer': referer, 'Origin': SO_WEB, 'Authorization': 'Bearer ' + accessToken }
    );
    var root = r.json || {};
    var code = root.code || 0;
    var data = root.data;
    if (data) {
        var canPlay = !!data.canPlay;
        var playUrl = String(data.playUrl || '').trim();
        var msg = String(data.message || root.message || '').trim();
        if (canPlay && playUrl) return { url: playUrl, needLogin: false, message: '' };
        var loginMsg = msg.indexOf('登录') >= 0 || msg.indexOf('令牌') >= 0 || msg.indexOf('过期') >= 0 ||
            msg.indexOf('无效') >= 0 || code === 401 || code === 403;
        return { url: null, needLogin: loginMsg, message: msg || '青空次元：播放接口未返回地址（canPlay=false）' };
    }
    return { url: null, needLogin: code === 401 || code === 403, message: root.message || '青空次元：播放接口返回异常' };
}

// 用 refreshToken 换新 accessToken，成功返回新 token 并写回 local，失败返回 null。
function SO_tryRefresh(refreshToken) {
    try {
        var r = SO_reqJson(
            SO_API + '/api/auth/refresh',
            { 'Authorization': 'Bearer ' + refreshToken },
            'POST'
        );
        var root = r.json || {};
        if (root.code !== 200 || !root.success) return null;
        var data = root.data || {};
        var newAccess = String(data.accessToken || root.accessToken || data.token || '').trim();
        if (!newAccess) return null;
        var patch = { accessToken: newAccess };
        if (data.refreshToken) patch.refreshToken = String(data.refreshToken).trim();
        SO_writeToken(patch);
        return newAccess;
    } catch (e) {
        return null;
    }
}

function SO_resolvePlayUrl(episodeUrl) {
    var addr = SO_parseEpisodeAddress(episodeUrl);
    var token = SO_readToken();
    if (!token) throw new Error(SO_TOKEN_HELP);
    var r = SO_playOnce(addr.episodeId, addr.videoId, addr.order, token.accessToken);
    if (r.url) return r.url;
    if (r.needLogin) {
        if (!token.refreshToken) {
            throw new Error('青空次元：登录已过期，且没存 refreshToken，续不上。' + SO_TOKEN_HELP);
        }
        var fresh = SO_tryRefresh(token.refreshToken);
        if (fresh) {
            var r2 = SO_playOnce(addr.episodeId, addr.videoId, addr.order, fresh);
            if (r2.url) return r2.url;
        }
        throw new Error(
            '青空次元：登录已过期，refreshToken 也失效了（令牌无效或已过期），' +
            '请在网页里重新登录一次，再把新的 sorani_auth_token 复制回来保存。不要把账号密码发给任何人。'
        );
    }
    throw new Error('青空次元播不了：' + r.message);
}

// ---------- 登录提示条目 ----------

function SO_noTokenVod() {
    return {
        vod_id: 'sorani:notoken',
        vod_name: '青空次元播放要登录',
        vod_pic: '',
        vod_remarks: '未登录',
        vod_content: SO_TOKEN_HELP
    };
}

function SO_tokenSavedVod(saved) {
    return {
        vod_id: 'sorani:token:saved',
        vod_name: saved ? 'Token 已保存' : 'Token 已清除',
        vod_pic: '',
        vod_remarks: saved ? '已保存' : '已清除',
        vod_content: saved ?
            '现在可以直接点剧集播放了。Token 失效（播不了、报登录过期）就重新在网页里登录、复制新的 sorani_auth_token 再搜一次“token:{那串JSON}”。注意：不要把 Token 发给别人。' :
            '已清除。青空次元现在播不了，要重新搜“token:{那串JSON}”保存一份。'
    };
}

// ---------- CatVod Spider ----------

function init(cfg) {
    try {
        cfg = cfg || {};
        var ext = cfg.ext;
        if (ext == null) ext = cfg.token || cfg.auth_token || '';
        if (typeof ext === 'object') {
            if (ext.accessToken) SO_writeToken(ext);
            else if (ext.token) {
                try { SO_writeToken(JSON.parse(String(ext.token))); } catch (e) { /* 忽略 */ }
            }
            return;
        }
        var t = String(ext).trim();
        if (!t) return;
        if (t.charAt(0) === '{') {
            try {
                var o = JSON.parse(t);
                if (o.accessToken) SO_writeToken(o);
            } catch (e) { /* ext 不是 JSON，忽略 */ }
        }
    } catch (e) { /* 配置读不到不影响使用 */ }
}

function homeContent(filter) {
    var classes = [];
    for (var i = 0; i < SO_CATS.length; i++) {
        classes.push({ type_id: 'sorani:list:' + SO_CATS[i].id + ':1', type_name: SO_CATS[i].name });
    }
    return JSON.stringify({ 'class': classes });
}

function homeVideoContent() {
    try {
        var r = SO_reqJson(SO_API + '/api/video?page=1&size=' + SO_PAGE_SIZE);
        var parsed = SO_parseRecords(r.json);
        return JSON.stringify({ list: parsed.list });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var page = parseInt(pg, 10) || 1;
    var url = String(tid || '');
    // type_id 里已经带了页码（sorani:list:{cat}:1），用 pg 覆盖它。
    var m = /^sorani:list:(\d+):\d+$/.exec(url);
    if (!m) {
        return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
    url = 'sorani:list:' + m[1] + ':' + page;
    try {
        var r = SO_categoryImpl(url);
        return JSON.stringify({
            page: page,
            pagecount: r.totalPage,
            limit: 20,
            total: r.list.length,
            list: r.list
        });
    } catch (e) {
        return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

// 搜“token:{sorani_auth_token 的 JSON}”保存 Token，搜“token:清除”清掉。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var lower = kw.toLowerCase();
    if (lower.indexOf('token:') === 0 || lower.indexOf('token：') === 0) {
        var val = kw.slice(6).trim();
        if (/^清除$/.test(val) || /^clear$/i.test(val)) {
            SO_localSet('auth_token', '');
            return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 1, list: [SO_tokenSavedVod(false)] });
        }
        if (!val) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
        try {
            var o = JSON.parse(val);
            if (!o.accessToken) throw new Error('这串 JSON 里没有 accessToken');
            var saved = SO_localSet('auth_token', JSON.stringify(o));
            var vod = SO_tokenSavedVod(true);
            if (!saved) vod.vod_name = '保存失败（请重试）';
            return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 1, list: [vod] });
        } catch (e) {
            var errVod = {
                vod_id: 'sorani:token:bad',
                vod_name: 'Token 没存上',
                vod_pic: '',
                vod_remarks: '格式不对',
                vod_content: '复制的不是 sorani_auth_token 的完整 JSON（要以 { 开头、里面有 accessToken）。去浏览器 localStorage 里把 sorani_auth_token 的值整串复制过来，不要只复制 accessToken。' + (e.message || '')
            };
            return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 1, list: [errVod] });
        }
    }
    var r = SO_searchImpl(kw, 1);
    return JSON.stringify({
        page: 1,
        pagecount: r.pages,
        limit: 20,
        total: r.list.length,
        list: r.list
    });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    if (id === 'sorani:notoken' || id === 'sorani:token:saved' || id === 'sorani:token:bad') {
        var hasToken = !!SO_readToken();
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: hasToken ? 'Token 已保存' : '青空次元播放要登录',
                vod_pic: '',
                vod_content: hasToken ?
                    'Token 已存好，直接点剧集播放就行。Token 失效就重新在网页里登录、复制新的 sorani_auth_token 再搜一次“token:{那串JSON}”。' :
                    SO_TOKEN_HELP,
                vod_play_from: '青空次元',
                vod_play_url: ''
            }]
        });
    }
    var vod = SO_detailImpl(id);
    return JSON.stringify({ list: [vod] });
}

function playerContent(flag, id, vipFlags) {
    var url = SO_resolvePlayUrl(String(id || ''));
    return JSON.stringify({
        parse: 0,
        url: url,
        header: { 'Referer': SO_WEB + '/', 'User-Agent': SO_UA }
    });
}

var spider = {
    init: init,
    homeContent: homeContent,
    homeVideoContent: homeVideoContent,
    categoryContent: categoryContent,
    detailContent: detailContent,
    searchContent: searchContent,
    playerContent: playerContent,
    // 登录入口：登录是站内弹窗，没有单独的 /login 路由，用首页做入口。
    getLoginUrl: function () { return 'https://www.sorani.net/'; }
};

// 承影用 spider.__jsEvalReturn()（或 spider.default）加载本插件。
function __jsEvalReturn() {
    return spider;
}