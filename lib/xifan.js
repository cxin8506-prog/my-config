var XF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var XF_BASE = 'https://next.xifanacg.com';
var XF_API = 'https://api.xifanacg.com';
var XF_NS = 'xifan';
var XF_PAGE_SIZE = 24;
var XF_TYPES = [
    { id: 0, name: '全部' }, { id: 1, name: '连载新番' }, { id: 2, name: '完结旧番' },
    { id: 3, name: '剧场版' }, { id: 4, name: '美漫' }
];
var XF_pubkeyCache = '';

function XF_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function XF_localGet(key) {
    try {
        if (typeof local === 'undefined') return '';
        var v = local.get(XF_NS, key);
        return v ? String(v) : '';
    } catch (e) { return ''; }
}

function XF_localSet(key, val) {
    try {
        if (typeof local === 'undefined') return;
        local.set(XF_NS, key, val);
    } catch (e) { /* 忽略 */ }
}

function XF_req(url, opts) {
    opts = opts || {};
    var res = req(url, {
        method: opts.method || 'GET',
        headers: opts.headers || { 'User-Agent': XF_UA, 'Accept': 'application/json', 'Referer': XF_BASE + '/' },
        body: opts.body,
        timeout: opts.timeout || 30000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

// 从站自己的页面/JS 里现取公开 publishable key（sb_publishable_…）。
// 先在首页 HTML 里找，找不到再顺着 <script src="/_next/static/chunks/…">
// 逐个取（最多 30 个；实测 key 在较靠后的 chunk 里，只扫前几个找不到），
// 取到就缓存到 local。只在第一次用时扫一次，之后直接读缓存。
function XF_pubkey() {
    if (XF_pubkeyCache) return XF_pubkeyCache;
    var cached = XF_localGet('pubkey');
    if (cached) { XF_pubkeyCache = cached; return cached; }
    var found = null;
    try {
        var html = XF_req(XF_BASE + '/', {
            headers: { 'User-Agent': XF_UA, 'Accept': 'text/html,application/xhtml+xml', 'Referer': XF_BASE + '/' },
            timeout: 30000
        });
        var m = /sb_publishable_[A-Za-z0-9_\-]+/.exec(html);
        if (m) found = m[0];
        if (!found) {
            var srcRe = /<script[^>]+src="(\/_next\/static\/chunks\/[^"]+\.js)"/g;
            var chunk;
            var tried = 0;
            while (!found && tried < 30 && (chunk = srcRe.exec(html)) !== null) {
                tried++;
                try {
                    var js = XF_req(XF_BASE + chunk[1], {
                        headers: { 'User-Agent': XF_UA, 'Accept': '*/*', 'Referer': XF_BASE + '/' },
                        timeout: 15000
                    });
                    var m2 = /sb_publishable_[A-Za-z0-9_\-]+/.exec(js);
                    if (m2) found = m2[0];
                } catch (e) { /* 这个 chunk 取不到就换下一个 */ }
            }
        }
    } catch (e) { /* 取 key 失败，下面的 RPC 会如实报错 */ }
    if (found) {
        XF_pubkeyCache = found;
        XF_localSet('pubkey', found);
        return found;
    }
    throw new Error('稀饭动漫：取不到站内公开 key（请确认能打开 next.xifanacg.com 后重试）');
}

function XF_rpcSearch(body) {
    var key = XF_pubkey();
    var res = req(XF_API + '/rest/v1/rpc/search_animes', {
        method: 'POST',
        headers: {
            'User-Agent': XF_UA, 'Accept': 'application/json',
            'Content-Type': 'application/json',
            'apikey': key, 'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify(body),
        timeout: 90000 // 接口冷启动时 60 秒内可能回不来，Kotlin 源里也是 60 秒读超时
    });
    if (!res) throw new Error('无响应: search_animes');
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': search_animes');
    return JSON.parse(res.content || '[]');
}

function XF_searchBody(term, page, typeId) {
    var body = {
        search_term: term, page_number: page, items_per_page: XF_PAGE_SIZE,
        sort_by: 'bangumi_score', sort_order: 'desc', filter_only_published: true
    };
    if (typeId != null) body.filter_type_id = typeId;
    return body;
}

function XF_rowToVod(row) {
    var id = row.id != null ? String(row.id) : '';
    var title = row.title || '';
    if (!id || id === '0' || !title) return null;
    var typeName = (row.anime_type && row.anime_type.name) || '';
    var year = row.release_year != null ? String(row.release_year) : '';
    var author = [year, typeName].filter(function (x) { return x; }).join(' · ');
    var cur = row.current_episodes || 0;
    var tot = row.total_episodes || 0;
    var remarks = '';
    if (tot > 0 && cur >= tot) remarks = '已完结·共' + tot + '集';
    else if (cur > 0) remarks = '更新至' + cur + '集';
    return {
        vod_id: 'xifan:' + id,
        vod_name: title,
        vod_pic: row.cover_url || '',
        vod_remarks: remarks,
        vod_content: row.description || ''
    };
}

function XF_rowsToList(arr) {
    var list = [];
    var total = 0;
    for (var i = 0; i < arr.length; i++) {
        var row = arr[i] || {};
        if (i === 0) total = row.total_count || 0;
        var v = XF_rowToVod(row);
        if (v) list.push(v);
    }
    var pages = total > 0 ? Math.ceil(total / XF_PAGE_SIZE) : 1;
    return { list: list, pages: pages, total: total };
}

// 从 marker 后的第一个开括号起，按括号配对抽出完整 JSON 文本（字符串内转义已处理）。
function XF_extractBalanced(text, marker, open, close) {
    var mi = text.indexOf(marker);
    if (mi < 0) return null;
    var i = text.indexOf(open, mi + marker.length);
    if (i < 0) return null;
    var start = i;
    var depth = 0;
    var inStr = false;
    var esc = false;
    while (i < text.length) {
        var c = text.charAt(i);
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else {
            if (c === '"') inStr = true;
            else if (c === open) depth++;
            else if (c === close) {
                depth--;
                if (depth === 0) return text.substring(start, i + 1);
            }
        }
        i++;
    }
    return null;
}

function XF_parseDetailHtml(animeId, html) {
    // RSC 数据是 JS 字符串字面量：\" → "、\\ → \。
    var t = html.split('\\"').join('"').split('\\\\').join('\\');
    var animeJson = XF_extractBalanced(t, '"anime":', '{', '}');
    if (!animeJson) throw new Error('稀饭动漫：详情页里没找到 anime 数据');
    var anime = JSON.parse(animeJson);
    var sourcesJson = XF_extractBalanced(t, '"sources":', '[', ']');
    if (!sourcesJson) throw new Error('稀饭动漫：详情页里没找到 sources 数据');
    var sources = JSON.parse(sourcesJson);
    var best = null;
    for (var s = 0; s < sources.length; s++) {
        var eps = (sources[s] && sources[s].episodes) || [];
        if (!best || eps.length > best.length) best = eps;
    }
    if (!best || !best.length) throw new Error('稀饭动漫：详情里没有剧集');
    var playUrl = [];
    for (var i = 0; i < best.length; i++) {
        var ep = best[i] || {};
        var epId = ep.id != null ? String(ep.id) : '';
        if (!epId || epId === '0') continue;
        var num = ep.episode_number || (i + 1);
        var epTitle = ep.title || '';
        var name = epTitle ? ('第' + num + '集 ' + epTitle) : ('第' + num + '集');
        playUrl.push(name + '$xifan:' + animeId + ':' + epId);
    }
    if (!playUrl.length) throw new Error('稀饭动漫：详情里没有剧集');
    var actors = [];
    var actorsArr = anime.actors || [];
    for (var a = 0; a < actorsArr.length; a++) {
        if (actorsArr[a]) actors.push(actorsArr[a]);
    }
    return {
        vod_id: 'xifan:' + animeId,
        vod_name: anime.title || '',
        vod_pic: anime.cover_url || '',
        vod_content: anime.description || '',
        vod_actor: actors.join('、'),
        vod_director: anime.director || '',
        vod_play_from: '稀饭动漫',
        vod_play_url: playUrl.join('#')
    };
}

// Range 取首字节探活：200/206 算活。
function XF_probe(url) {
    try {
        var res = req(url, {
            headers: { 'User-Agent': XF_UA, 'Range': 'bytes=0-0', 'Referer': XF_BASE + '/' },
            timeout: 10000
        });
        return !!res && (res.code === 200 || res.code === 206);
    } catch (e) {
        return false;
    }
}

function init(cfg) { /* 无配置，无登录 */ }

function homeContent(filter) {
    var cls = [];
    for (var i = 0; i < XF_TYPES.length; i++) {
        cls.push({ type_id: String(XF_TYPES[i].id), type_name: XF_TYPES[i].name });
    }
    return JSON.stringify({ 'class': cls });
}

function homeVideoContent() {
    try {
        var r = XF_rowsToList(XF_rpcSearch(XF_searchBody('', 1, null)));
        return JSON.stringify({ list: r.list });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var typeId = parseInt(tid, 10);
    if (isNaN(typeId)) typeId = 0;
    var page = parseInt(pg, 10) || 1;
    try {
        var r = XF_rowsToList(XF_rpcSearch(XF_searchBody('', page, typeId === 0 ? null : typeId)));
        return JSON.stringify({
            page: page, pagecount: r.pages, limit: XF_PAGE_SIZE, total: r.total, list: r.list
        });
    } catch (e) {
        return JSON.stringify({ page: page, pagecount: 1, limit: XF_PAGE_SIZE, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: XF_PAGE_SIZE, total: 0, list: [] });
    try {
        var r = XF_rowsToList(XF_rpcSearch(XF_searchBody(kw, 1, null)));
        return JSON.stringify({
            page: 1, pagecount: r.pages, limit: XF_PAGE_SIZE, total: r.total, list: r.list
        });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: XF_PAGE_SIZE, total: 0, list: [] });
    }
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var animeId = id.indexOf('xifan:') === 0 ? id.slice(6) : id;
    if (!animeId || animeId.indexOf(':') >= 0) throw new Error('稀饭动漫：不认识的书地址');
    var html = XF_req(XF_BASE + '/anime/' + XF_enc(animeId), {
        headers: { 'User-Agent': XF_UA, 'Accept': 'text/html,application/xhtml+xml', 'Referer': XF_BASE + '/' },
        timeout: 30000
    });
    var vod = XF_parseDetailHtml(animeId, html);
    vod.vod_id = id;
    return JSON.stringify({ list: [vod] });
}

// 播放：POST issue-web-playback，不带鉴权；优先探活通过的 candidates .mp4。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('xifan:') !== 0) throw new Error('稀饭动漫：不认识的章节地址');
    var parts = ep.slice(6).split(':');
    if (parts.length < 2) throw new Error('稀饭动漫：章节地址缺参数');
    var episodeId = parseInt(parts[1], 10);
    if (isNaN(episodeId)) throw new Error('稀饭动漫：集 id 不是数字');
    var res = req(XF_API + '/functions/v1/issue-web-playback', {
        method: 'POST',
        headers: { 'User-Agent': XF_UA, 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fallback', episode_id: episodeId }),
        timeout: 60000
    });
    if (!res) throw new Error('无响应: issue-web-playback');
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': issue-web-playback');
    var resp = JSON.parse(res.content || '{}');
    if (!resp.ok) throw new Error('稀饭动漫播放失败：' + (resp.message || JSON.stringify(resp).slice(0, 200)));
    var candidates = resp.candidates || [];
    for (var i = 0; i < candidates.length; i++) {
        var u = (candidates[i] && candidates[i].url) || '';
        if (u.indexOf('http') === 0 && u.split('?')[0].slice(-4) === '.mp4' && XF_probe(u)) {
            return JSON.stringify({ parse: 0, url: u, header: { 'User-Agent': XF_UA, 'Referer': XF_BASE + '/' } });
        }
    }
    var topUrl = resp.url || '';
    if (topUrl.indexOf('http') === 0 && XF_probe(topUrl)) {
        return JSON.stringify({ parse: 0, url: topUrl, header: { 'User-Agent': XF_UA, 'Referer': XF_BASE + '/' } });
    }
    throw new Error('稀饭动漫播放接口没返回可播地址');
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