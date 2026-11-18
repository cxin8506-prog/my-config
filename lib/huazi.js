var HZ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var HZ_BASE = 'https://www.huazidm.com';
var HZ_PAGE_SIZE = 24;
var HZ_FALLBACK_TYPES = [
    { id: 20, name: '连载动画' }, { id: 1, name: 'TV动画' }, { id: 2, name: '剧场' },
    { id: 4, name: '美漫' }, { id: 3, name: '特摄' }
];

function HZ_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function HZ_stripHtml(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
}

function HZ_reqText(url, opts) {
    opts = opts || {};
    var res = req(url, {
        method: opts.method || 'GET',
        headers: opts.headers || { 'User-Agent': HZ_UA, 'Accept': 'application/json', 'Referer': HZ_BASE + '/' },
        body: opts.body,
        timeout: opts.timeout || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function HZ_reqJson(url, opts) {
    return JSON.parse(HZ_reqText(url, opts));
}

// 列表接口返回可能是 {list,total}，也可能是 {data:{list,total}}，两种都认。
function HZ_listAndTotal(root) {
    var data = (root && root.data) || {};
    var arr = (root && root.list) || data.list || [];
    var total = 0;
    if (root && root.total != null) total = root.total;
    else if (data.total != null) total = data.total;
    return { arr: arr, total: total };
}

function HZ_itemToVod(item) {
    var id = item.vodId != null ? String(item.vodId) : '';
    var title = item.vodName || '';
    if (!id || id === '0' || !title) return null;
    var author = [item.vodYear || '', item.vodArea || ''].filter(function (x) { return x; }).join(' · ');
    return {
        vod_id: 'huazi:' + id,
        vod_name: title,
        vod_pic: item.vodPic || '',
        vod_remarks: item.vodRemarks || '',
        vod_content: item.vodBlurb || ''
    };
}

function HZ_listToVods(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var v = HZ_itemToVod(arr[i] || {});
        if (v) out.push(v);
    }
    return out;
}

function HZ_pages(total) {
    return total > 0 ? Math.ceil(total / HZ_PAGE_SIZE) : 1;
}

function HZ_fetchTypes() {
    try {
        var root = HZ_reqJson(HZ_BASE + '/api/categories', { timeout: 15000 });
        var lt = HZ_listAndTotal(root);
        var out = [];
        for (var i = 0; i < lt.arr.length; i++) {
            var o = lt.arr[i] || {};
            var id = parseInt(o.typeId, 10);
            var name = o.typeName || '';
            if (id > 0 && name) out.push({ id: id, name: name });
        }
        if (out.length) return out;
    } catch (e) { /* 取不到就用内置表 */ }
    return HZ_FALLBACK_TYPES;
}

function HZ_fetchDetail(vodId) {
    var root = HZ_reqJson(HZ_BASE + '/api/videos/' + HZ_enc(vodId), { timeout: 20000 });
    return (root && root.data) || root || {};
}

// Range 取首字节探活：200/206 算活。
function HZ_probe(url) {
    try {
        var res = req(url, {
            headers: { 'User-Agent': HZ_UA, 'Range': 'bytes=0-0', 'Referer': HZ_BASE + '/' },
            timeout: 10000
        });
        return !!res && (res.code === 200 || res.code === 206);
    } catch (e) {
        return false;
    }
}

function init(cfg) { /* 无配置，无登录 */ }

function homeContent(filter) {
    var types = HZ_fetchTypes();
    var cls = [];
    for (var i = 0; i < types.length; i++) {
        cls.push({ type_id: String(types[i].id), type_name: types[i].name });
    }
    return JSON.stringify({ 'class': cls });
}

function homeVideoContent() {
    try {
        var root = HZ_reqJson(HZ_BASE + '/api/videos?page=1&pageSize=' + HZ_PAGE_SIZE + '&sort=time', { timeout: 20000 });
        var lt = HZ_listAndTotal(root);
        return JSON.stringify({ list: HZ_listToVods(lt.arr) });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var typeId = parseInt(tid, 10);
    var page = parseInt(pg, 10) || 1;
    if (isNaN(typeId)) typeId = 20;
    try {
        var root = HZ_reqJson(HZ_BASE + '/api/videos?page=' + page + '&pageSize=' + HZ_PAGE_SIZE + '&typeId=' + typeId + '&sort=time', { timeout: 20000 });
        var lt = HZ_listAndTotal(root);
        return JSON.stringify({
            page: page, pagecount: HZ_pages(lt.total), limit: HZ_PAGE_SIZE,
            total: lt.total, list: HZ_listToVods(lt.arr)
        });
    } catch (e) {
        return JSON.stringify({ page: page, pagecount: 1, limit: HZ_PAGE_SIZE, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: HZ_PAGE_SIZE, total: 0, list: [] });
    try {
        var root = HZ_reqJson(HZ_BASE + '/api/videos?page=1&pageSize=' + HZ_PAGE_SIZE + '&q=' + HZ_enc(kw), { timeout: 20000 });
        var code = (root && root.code != null) ? root.code : 0;
        if (code === 4001) throw new Error('花子动漫搜索需要验证码（code 4001）：请用分类浏览');
        if (code !== 0 && code !== 200) throw new Error('花子动漫搜索失败：' + (root.message || ('code=' + code)));
        var lt = HZ_listAndTotal(root);
        return JSON.stringify({
            page: 1, pagecount: HZ_pages(lt.total), limit: HZ_PAGE_SIZE,
            total: lt.total, list: HZ_listToVods(lt.arr)
        });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: HZ_PAGE_SIZE, total: 0, list: [] });
    }
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var vodId = id.indexOf('huazi:') === 0 ? id.slice(6) : id;
    if (!vodId || vodId.indexOf(':') >= 0) throw new Error('花子动漫：不认识的书地址');
    var data = HZ_fetchDetail(vodId);
    var intro = HZ_stripHtml(data.vodContent || data.vodBlurb || '');
    var sources = data.playSources || [];
    if (!sources.length) throw new Error('花子动漫：详情里没有播放源');
    var first = sources[0] || {};
    var eps = first.episodes || [];
    if (!eps.length) throw new Error('花子动漫：详情里没有剧集');
    var playUrl = [];
    for (var i = 0; i < eps.length; i++) {
        var name = (eps[i] && eps[i].name) || ('第' + (i + 1) + '集');
        playUrl.push(name + '$huazi:' + data.vodId + ':' + i);
    }
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: data.vodName || '',
            vod_pic: data.vodPic || '',
            vod_content: intro,
            vod_actor: data.vodActor || '',
            vod_director: data.vodDirector || '',
            vod_play_from: '花子动漫',
            vod_play_url: playUrl.join('#')
        }]
    });
}

// 播放：按详情里线路顺序逐条 POST resolve，探活通过的直链（mp4）直接返回。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('huazi:') !== 0) throw new Error('花子动漫：不认识的章节地址');
    var parts = ep.slice(6).split(':');
    if (parts.length < 2) throw new Error('花子动漫：章节地址缺参数');
    var vodId = parts[0];
    var index = parseInt(parts[1], 10);
    if (isNaN(index)) throw new Error('花子动漫：集序号不是数字');
    var data = HZ_fetchDetail(vodId);
    var sources = data.playSources || [];
    if (!sources.length) throw new Error('花子动漫：详情里没有播放源');
    var sawCaptcha = false;
    var lastMsg = '';
    for (var s = 0; s < sources.length; s++) {
        var src = sources[s] || {};
        var code = src.sourceCode || '';
        var eps = src.episodes || [];
        var item = eps[index];
        if (!code || !item || !item.url) continue;
        var resp;
        try {
            resp = HZ_reqJson(HZ_BASE + '/api/play/resolve', {
                method: 'POST',
                headers: { 'User-Agent': HZ_UA, 'Accept': 'application/json', 'Content-Type': 'application/json', 'Referer': HZ_BASE + '/' },
                body: JSON.stringify({ url: item.url, sourceCode: code }),
                timeout: 60000
            });
        } catch (e) {
            lastMsg = '线路 ' + (src.sourceName || code) + '：' + String(e.message || '请求失败').slice(0, 100);
            continue;
        }
        if (resp.code === 'NEED_CAPTCHA' || resp.needCaptcha) {
            sawCaptcha = true;
            lastMsg = '线路 ' + (src.sourceName || code) + '：需要验证码';
            continue;
        }
        if (resp.ok) {
            var playUrl = resp.playUrl || '';
            if (playUrl.indexOf('http') === 0) {
                if (HZ_probe(playUrl)) {
                    return JSON.stringify({ parse: 0, url: playUrl, header: { 'User-Agent': HZ_UA, 'Referer': HZ_BASE + '/' } });
                }
                lastMsg = '线路 ' + (src.sourceName || code) + '：地址探活失败';
                continue;
            }
        }
        lastMsg = '线路 ' + (src.sourceName || code) + '：' + (resp.message || '解析失败');
    }
    if (sawCaptcha) throw new Error('花子动漫播放要验证码（NEED_CAPTCHA）：请在浏览器里播一次过验证');
    throw new Error('花子动漫暂未返回可播地址：' + lastMsg);
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