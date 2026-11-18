var PL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var PL_NS = 'platform';
var PL_NAME = '腾优爱芒B';
var PL_CJ = 'http://cj.tianwe.cn/api.php/provide/vod/';


function PL_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}
function PL_dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
}
function PL_localGet(ns, key) {
    try {
        if (typeof local === 'undefined') return '';
        var v = local.get(ns, key);
        return v ? String(v) : '';
    } catch (e) { return ''; }
}
function PL_normTitle(s) {
    return String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, '').toLowerCase();
}
function PL_reqText(url, timeoutMs) {
    var res = req(url, {
        headers: { 'User-Agent': PL_UA, 'Accept': 'application/json, text/plain, */*' },
        timeout: timeoutMs || 15000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}
function PL_reqJson(url, timeoutMs) {
    return JSON.parse(PL_reqText(url, timeoutMs));
}

// ---------- 我们自己的 4 条 VIP 解析线（放进平台源里当备用线） ----------
// 详情页不搜（快），只按平台线的集数拼出 vip: 地址；点播时才按标题搜取 m3u8。
var PL_VIP_LINES = [
    { key: 'iqiyi', name: '爱奇艺线', api: 'https://iqiyizy.com/api.php/provide/vod/' },
    { key: 'ikun', name: 'ikun线', api: 'https://ikunzyapi.com/api.php/provide/vod/' },
    { key: 'wsy', name: '无损云线', api: 'https://api.wsyzy.net/api.php/provide/vod/', searchBase: 'https://wsyzy.cc/index.php/ajax/suggest?mid=1&wd=' }
];
function PL_vipFindLine(key) {
    for (var i = 0; i < PL_VIP_LINES.length; i++) if (PL_VIP_LINES[i].key === key) return PL_VIP_LINES[i];
    return null;
}
// 在某条 VIP 线上按标题搜，取详情里第 epIdx（1起）集的 m3u8
function PL_vipResolve(line, title, epIdx) {
    var q = PL_enc(title);
    var vid = '';
    if (line.searchBase) {
        var sj = PL_reqJson(line.searchBase + q);
        var arr = sj.list || [];
        for (var i = 0; i < arr.length; i++) {
            if (String(arr[i].name || '') === title) { vid = String(arr[i].id || ''); break; }
        }
        if (!vid && arr.length) vid = String(arr[0].id || '');
        if (!vid) throw new Error('无损云线搜不到《' + title + '》');
    } else {
        var j = PL_reqJson(line.api + '?ac=list&wd=' + q + '&pg=1');
        var list = j.list || [];
        for (var i2 = 0; i2 < list.length; i2++) {
            if (String(list[i2].vod_name || '') === title) { vid = String(list[i2].vod_id || ''); break; }
        }
        if (!vid && list.length) vid = String(list[0].vod_id || '');
        if (!vid) throw new Error(line.name + '搜不到《' + title + '》');
    }
    var d = PL_reqJson(line.api + '?ac=detail&ids=' + PL_enc(vid));
    var dl = d.list || [];
    if (!dl.length) throw new Error(line.name + '取不到详情');
    var playUrl = String(dl[0].vod_play_url || '');
    var first = playUrl.split('$$$')[0] || '';
    var eps = [];
    first.split('#').forEach(function (it) {
        var k = String(it || '').indexOf('$');
        if (k <= 0) return;
        var u = String(it || '').substring(k + 1).trim();
        if (u.indexOf('http') === 0) eps.push(u);
    });
    if (!eps.length) throw new Error(line.name + '没有可播地址');
    var idx = Math.max(0, Math.min(eps.length - 1, (epIdx | 0) - 1));
    return eps[idx];
}

// ---------- 平台地址（cj.tianwe.cn） ----------
function PL_cjList(params, page) {
    var url = PL_CJ + '?ac=list&pg=' + (page || 1);
    if (params) url += params;
    var j = PL_reqJson(url, 15000);
    var list = (j && j.list) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
        var o = list[i] || {};
        var id = String(o.vod_id == null ? '' : o.vod_id), name = String(o.vod_name || '');
        if (!id || !name) continue;
        var pic = String(o.vod_pic || '');
        out.push({
            vod_id: 'plat:all:' + id,
            vod_name: name,
            vod_pic: pic.indexOf('http') === 0 ? pic : '',
            vod_remarks: String(o.vod_remarks || o.vod_year || ''),
            vod_content: ''
        });
    }
    var totalPages = (j.pagecount && j.pagecount >= 1) ? j.pagecount : 1;
    return { list: out, totalPages: totalPages };
}
function PL_cjDetail(vodId) {
    // 详情不加 from：要拿全部线路（多线可手动切），只加 from 会只剩本平台一条线。
    var j = PL_reqJson(PL_CJ + '?ac=detail&ids=' + PL_enc(vodId), 15000);
    var arr = (j && j.list) || [];
    if (!arr.length) return null;
    var o = arr[0] || {};
    var title = String(o.vod_name || '');
    if (!title) return null;
    var pic = String(o.vod_pic || '');
    var blurb = String(o.vod_blurb || o.vod_content || '');
    var intro = blurb.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!intro) intro = [o.vod_remarks, o.vod_year, o.vod_area].filter(function (x) { return x; }).join(' · ');
    return {
        title: title,
        cover: pic.indexOf('http') === 0 ? pic : '',
        intro: intro,
        playFrom: String(o.vod_play_from || ''),
        playUrl: String(o.vod_play_url || '')
    };
}
// 平台原地址的 vod_play_url 按 $$$ 分组：每组是一条线，组内 # 分集。
function PL_parsePlatformLines(playFrom, playUrl) {
    var froms = String(playFrom || '').split('$$$');
    var urls = String(playUrl || '').split('$$$');
    var lines = [];
    for (var i = 0; i < froms.length; i++) {
        var fname = (froms[i] || '').trim();
        var group = urls[i] || '';
        if (!fname || !group) continue;
        var eps = [];
        var items = group.split('#');
        for (var j = 0; j < items.length; j++) {
            var idx = items[j].indexOf('$');
            if (idx <= 0) continue;
            var name = items[j].slice(0, idx).trim();
            var u = items[j].slice(idx + 1).trim();
            if (u.indexOf('http') === 0) eps.push({ name: name, url: u });
        }
        if (eps.length) lines.push({ name: fname, episodes: eps });
    }
    return lines;
}

// ---------- CatVod Spider ----------

function init(cfg) {
}


function homeContent(filter) {
    return JSON.stringify({
        'class': [
            { type_id: '1', type_name: '电影' },
            { type_id: '2', type_name: '连续剧' },
            { type_id: '3', type_name: '综艺' },
            { type_id: '4', type_name: '动漫' }
        ]
    });
}

function homeVideoContent() {
    try {
        var r = PL_cjList('&t=2', 1);
        return JSON.stringify({ list: r.list.slice(0, 20) });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function categoryContent(tid, pg, filter, extend) {
    var page = parseInt(pg, 10) || 1;
    var typeId = String(tid || '2');
    try {
        var r = PL_cjList('&t=' + PL_enc(typeId), page);
        return JSON.stringify({
            page: page,
            pagecount: r.totalPages,
            limit: 20,
            total: r.list.length,
            list: r.list
        });
    } catch (e) {
        return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    try {
        var r = PL_cjList('&wd=' + PL_enc(kw), 1);
        return JSON.stringify({
            page: 1,
            pagecount: r.totalPages,
            limit: 20,
            total: r.list.length,
            list: r.list
        });
    } catch (e) {
        return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    }
}

// 详情：书地址 plat:all:{vod_id}。简介/封面用采集站自己的；播放线直接用平台原地址
// （v.qq.com / iqiyi.com / youku.com / bilibili.com），点名字手动切，App 用配置里的解析播。
function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var parts = id.split(':');
    if (parts.length < 3 || parts[0] !== 'plat') throw new Error('书地址不对：' + id);
    var vodId = parts[2];
    var d = PL_cjDetail(vodId);
    if (!d) throw new Error('取不到详情');
    var title = d.title;

    var platLines = PL_parsePlatformLines(d.playFrom, d.playUrl);
    var platNameMap = { qq: '腾讯', qiyi: '爱奇艺', youku: '优酷', mgtv: '芒果', bilibili: 'B站' };
    var playFroms = [];
    var playUrls = [];
    for (var i = 0; i < platLines.length; i++) {
        var pl = platLines[i];
        var showName = platNameMap[pl.name] || pl.name;
        playFroms.push(showName);
        playUrls.push(pl.episodes.map(function (ep) {
            return ep.name + '$platurl:' + PL_enc(ep.url);
        }).join('#'));
    }
    // 我们的 VIP 线：按平台第一条线的集数拼出 vip: 地址（详情不搜，快；点播时才搜）
    var refEps = (platLines.length && platLines[0].episodes) ? platLines[0].episodes : [];
    for (var vi = 0; vi < PL_VIP_LINES.length; vi++) {
        var vl = PL_VIP_LINES[vi];
        playFroms.push(vl.name);
        playUrls.push(refEps.map(function (ep, ei) {
            return ep.name + '$vip:' + vl.key + ':' + PL_enc(title) + ':' + (ei + 1);
        }).join('#'));
    }
    if (!playFroms.length) throw new Error('平台线没拿到《' + title + '》，换个片名试试');
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: title,
            vod_pic: d.cover || '',
            vod_content: d.intro || '',
            vod_play_from: playFroms.join('$$$'),
            vod_play_url: playUrls.join('$$$')
        }]
    });
}

// 播放：platurl:{url编码的平台地址}，让 App 用配置里的解析去播。
function playerContent(flag, id, vipFlags) {
    id = String(id || '');
    if (id.indexOf('platurl:') === 0) {
        var purl = PL_dec(id.slice('platurl:'.length));
        return JSON.stringify({ parse: 1, url: purl });
    }
    if (id.indexOf('vip:') === 0) {
        var parts = id.slice(4).split(':');
        var line = PL_vipFindLine(parts[0] || '');
        if (!line) throw new Error('不认识的 VIP 线');
        var m3u8 = PL_vipResolve(line, PL_dec(parts[1] || ''), parseInt(parts[2] || '1', 10));
        return JSON.stringify({ parse: 0, url: m3u8 });
    }
    throw new Error('不认识的章节地址');
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