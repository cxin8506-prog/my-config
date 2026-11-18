var PK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
var PK_BASE = 'https://4k01.pianku.online';

// ---------- MacCMS 线（下标不许动，书地址 vipjx:{下标}:… 指着它） ----------
var PK_LINES = [
    { name: '爱奇艺', api: 'https://iqiyizy.com/api.php/provide/vod/' },
    { name: 'ikun', api: 'https://ikunzyapi.com/api.php/provide/vod/' },
    { name: '无损云', api: 'https://api.wsyzy.net/api.php/provide/vod/', suggest: 'https://wsyzy.cc/index.php/ajax/suggest?mid=1&wd=' },
    { name: '百度', api: 'https://api.apibdzy.com/api.php/provide/vod/' },
    { name: 'HDLY', api: 'https://360zy.com/api.php/provide/vod/at/json' },
    { name: '魔都', api: 'https://caiji.moduapi.cc/api.php/provide/vod/' }
];
// 试线顺序：ikun→魔都→百度→爱奇艺线→HDLY→无损云
var PK_SEARCH_ORDER = [1, 2, 6, 4, 0, 5, 3];

var PK_CATS = [
    { id: 20, name: '电影' },
    { id: 37, name: '剧集' },
    { id: 43, name: '动漫' },
    { id: 45, name: '综艺' }
];

// ---------- 小工具 ----------

function PK_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function PK_dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return s; }
}

function PK_stripTags(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function PK_unesc(s) {
    return String(s || '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// 同步 GET 文本：返回正文，非 2xx 抛错。
function PK_reqText(url, timeoutMs, referer) {
    var res = req(url, {
        headers: {
            'User-Agent': PK_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': referer || (PK_BASE + '/')
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function PK_reqJson(url, timeoutMs) {
    return JSON.parse(PK_reqText(url, timeoutMs || 15000, PK_BASE + '/'));
}

// 遍历页面里所有 <a ...>...</a>：fn(attrs, inner)
function PK_eachAnchor(html, fn) {
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) fn(m[1], m[2]);
}

function PK_attr(attrs, name) {
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"').exec(attrs || '');
    return m ? PK_unesc(m[1]) : '';
}

function PK_imgSrc(inner) {
    var m = /<img\b[^>]*src\s*=\s*"([^"]*)"/.exec(inner || '');
    return m ? PK_unesc(m[1]) : '';
}

// ---------- m3u8 选档 ----------

function PK_resolveRelative(base, rel) {
    try { return new URL(rel, base).href; } catch (e) {
        var dir = base.slice(0, base.lastIndexOf('/'));
        return dir + '/' + rel;
    }
}

// master 多档清单取 BANDWIDTH 最高的那档子清单地址；不是 master、取不到
// master，都原样返回原地址。子清单验不通也返回分清单地址（母清单本身
// 在播放器里解析不了，返回它必定卡住）。
function PK_pickBestVariant(url) {
    if (url.indexOf('.m3u8') < 0) return url;
    var master;
    try { master = PK_reqText(url, 8000, PK_BASE + '/'); } catch (e) { return url; }
    if (master.indexOf('#EXT-X-STREAM-INF') < 0) return url;
    var lines = master.split('\n');
    var bestBw = -1, bestRes = -1, bestUri = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF') !== 0) continue;
        var bwM = /BANDWIDTH=(\d+)/.exec(line);
        var bw = bwM ? parseInt(bwM[1], 10) : -1;
        var resM = /RESOLUTION=\d+x(\d+)/.exec(line);
        var res = resM ? parseInt(resM[1], 10) : -1;
        var uri = (lines[i + 1] || '').trim();
        if (!uri || uri.charAt(0) === '#') continue;
        if (bw > bestBw || (bw === bestBw && res > bestRes)) { bestBw = bw; bestRes = res; bestUri = uri; }
    }
    if (!bestUri) return url;
    var resolved = bestUri.indexOf('http') === 0 ? bestUri : PK_resolveRelative(url, bestUri);
    try { PK_reqText(resolved, 8000, PK_BASE + '/'); } catch (e) { /* 验不通也返回分清单 */ }
    return resolved;
}

// ---------- MacCMS ----------

// 在指定线路上搜片名。返回 [{title, url, pic, intro}]，
// 书地址 pianku:vipjx:{线路}:{vod_id}:{enc(片名)}。
function PK_macSearch(lineIdx, keywords, page) {
    var line = PK_LINES[lineIdx];
    if (line.suggest) {
        // 无损云线：联想接口，一次返回，不分页。
        if (page > 1) return [];
        var sj = PK_reqJson(line.suggest + PK_enc(keywords), 15000);
        var arr = (sj && sj.list) || [];
        var scored = [];
        for (var i = 0; i < arr.length; i++) {
            var o = arr[i] || {};
            var id = String(o.id == null ? '' : o.id), name = String(o.name || '');
            if (!id || !name) continue;
            var score = 0;
            if (name === keywords) score = 4;
            else if (name.indexOf(keywords) === 0) score = 3;
            else if (name.indexOf(keywords) >= 0) score = 2;
            else if (keywords.length >= 2 && keywords.indexOf(name) >= 0) score = 1;
            var pic = String(o.pic || '');
            scored.push({
                score: score,
                book: {
                    title: name,
                    url: 'pianku:vipjx:' + lineIdx + ':' + id + ':' + PK_enc(name),
                    pic: pic.indexOf('http') === 0 ? pic : '',
                    intro: ''
                }
            });
        }
        scored.sort(function (a, b) { return b.score - a.score; });
        return scored.map(function (x) { return x.book; });
    }
    var j = PK_reqJson(line.api + '?ac=list&wd=' + PK_enc(keywords) + '&pg=' + page, 15000);
    var list = (j && j.list) || [];
    var books = [];
    for (var i = 0; i < list.length; i++) {
        var o = list[i] || {};
        var id = String(o.vod_id == null ? '' : o.vod_id), name = String(o.vod_name || '');
        if (!id || !name) continue;
        var pic = String(o.vod_pic || '');
        var meta = [o.vod_remarks, o.vod_year, o.vod_area].filter(function (x) { return x; }).join(' · ');
        books.push({
            title: name,
            url: 'pianku:vipjx:' + lineIdx + ':' + id + ':' + PK_enc(name),
            pic: pic.indexOf('http') === 0 ? pic : '',
            intro: meta
        });
    }
    return books;
}

// vod_play_url 格式：`第01集$<m3u8>#第02集$<m3u8>...`，多播放源以 $$$ 分组，只取第一组。
function PK_parsePlayUrl(playUrl) {
    var out = [];
    if (!playUrl) return out;
    var first = playUrl.split('$$$')[0];
    var items = first.split('#');
    for (var i = 0; i < items.length; i++) {
        var idx = items[i].indexOf('$');
        if (idx <= 0) continue;
        var name = items[i].slice(0, idx).trim();
        var u = items[i].slice(idx + 1).trim();
        if (u.indexOf('http') === 0) out.push({ name: name, url: u });
    }
    return out;
}

// MacCMS 取详情；失败返回 null。{title, cover, intro, episodes:[{name,url}]}
function PK_macFetchDetail(lineIdx, vodId) {
    try {
        var j = PK_reqJson(PK_LINES[lineIdx].api + '?ac=detail&ids=' + PK_enc(vodId), 15000);
        var arr = (j && j.list) || [];
        if (!arr.length) return null;
        var o = arr[0] || {};
        var title = String(o.vod_name || '');
        if (!title) return null;
        var blurb = String(o.vod_blurb || o.vod_content || '');
        var intro = PK_stripTags(blurb);
        if (!intro) intro = [o.vod_remarks, o.vod_year, o.vod_area].filter(function (x) { return x; }).join(' · ');
        var pic = String(o.vod_pic || '');
        return {
            title: title,
            cover: pic.indexOf('http') === 0 ? pic : '',
            intro: intro,
            episodes: PK_parsePlayUrl(String(o.vod_play_url || ''))
        };
    } catch (e) {
        return null;
    }
}

// 按片名到 MacCMS 线找片取同集 m3u8：按 SEARCH_ORDER 逐条线搜片名
// （标题完全一致优先，否则取第一条）→ 详情取同集 m3u8；一条挂了落下一条。
function PK_resolveViaMac(title, epNo) {
    for (var k = 0; k < PK_SEARCH_ORDER.length; k++) {
        var lineIdx = PK_SEARCH_ORDER[k];
        try {
            var hits = PK_macSearch(lineIdx, title, 1);
            if (!hits.length) continue;
            var hit = null;
            for (var i = 0; i < hits.length; i++) {
                if (hits[i].title === title) { hit = hits[i]; break; }
            }
            if (!hit) hit = hits[0];
            var vodId = hit.url.split(':')[3];
            var d = PK_macFetchDetail(lineIdx, vodId);
            if (d && d.episodes[epNo - 1]) return PK_pickBestVariant(d.episodes[epNo - 1].url);
        } catch (e) { /* 这条线挂了就落下一条 */ }
    }
    throw new Error('片库：' + title + ' 第 ' + epNo + ' 集，MacCMS 各线路都拿不到播放地址');
}

// ---------- 自家站 ----------

// 列表页：.vod-item 卡片；总页数取页码链接里最大的 /vodtype/{id}-{n}.html。
function PK_parseListPage(html, typeId) {
    var list = [];
    var seen = {};
    PK_eachAnchor(html, function (attrs, inner) {
        var href = PK_attr(attrs, 'href');
        var m = /^\/voddetail\/(\d+)\.html$/.exec(href);
        if (!m) return;
        var id = m[1];
        if (seen[id]) return;
        seen[id] = 1;
        var title = PK_attr(attrs, 'title');
        if (!title) {
            var tm = /class="[^"]*title[^"]*"[^>]*>([^<]*)/.exec(inner);
            title = tm ? PK_stripTags(tm[1]) : '';
        }
        if (!title) return;
        var pic = PK_imgSrc(inner);
        var remarks = '';
        var rm = /class="[^"]*remarks[^"]*"[^>]*>([^<]*)/.exec(inner);
        if (rm) remarks = PK_stripTags(rm[1]);
        var sub = '';
        var sm = /class="[^"]*subtitle[^"]*"[^>]*>([^<]*)/.exec(inner);
        if (sm) sub = PK_stripTags(sm[1]);
        list.push({
            vod_id: 'pianku:' + id,
            vod_name: title,
            vod_pic: pic,
            vod_remarks: remarks,
            vod_content: sub
        });
    });
    var totalPage = 1;
    if (typeId > 0) {
        var re = new RegExp('/vodtype/' + typeId + '-(\\d+)\\.html', 'g'), pm;
        while ((pm = re.exec(html)) !== null) {
            var n = parseInt(pm[1], 10);
            if (n > totalPage) totalPage = n;
        }
    }
    return { list: list, totalPage: totalPage };
}

// 播放页 player_aaaa JSON：{from, url, ...}。
function PK_parsePlayerAaaa(html) {
    var m = /var player_aaaa\s*=\s*(\{.*?\})<\/script>/s.exec(html);
    if (!m) throw new Error('片库：播放页里没有 player_aaaa');
    var json = JSON.parse(m[1]);
    return { from: json.from || '', url: String(json.url || '').replace(/\\\//g, '/') };
}

// 直链 m3u8 才能直接播；解析页、吉猫盾链都不要。
function PK_isDirectM3u8(from, url) {
    if (!url || url.indexOf('http') !== 0) return false;
    var host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
    if (host === 'jimaoys94.com') return false;
    if (host.indexOf('lxyy.club') >= 0 || host.indexOf('maccms.xyz') >= 0 || host.indexOf('juhuang.xyz') >= 0) return false;
    return url.indexOf('.m3u8') >= 0;
}

// 详情页标题：h1.detail-title 的纯文本（不含里面的 remarks span）；取不到退到 <title>。
function PK_parseDetailTitle(html) {
    var m = /<h1[^>]*class="[^"]*detail-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    if (m) {
        var t = PK_stripTags(m[1].replace(/<span[\s\S]*?<\/span>/g, ''));
        if (t) return t;
    }
    var tm = /<title>([\s\S]*?)<\/title>/.exec(html);
    if (tm) return PK_stripTags(tm[1]).split('详情介绍')[0].trim();
    return '';
}

// 自家站详情页解析：{poster, intro, actor, director, bySid:{sid:[{nid,name}]}, title}
function PK_parseOwnDetail(id, html) {
    var poster = '';
    var pm = /<div[^>]*class="[^"]*detail-poster[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    if (pm) poster = PK_imgSrc(pm[1]);
    if (!poster) {
        var og = /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/.exec(html);
        if (og) poster = PK_unesc(og[1]);
    }
    // 简介：有的详情是 <p><p>简介</p></p> 嵌套写法，取第一个非空的 p。
    var intro = '';
    var dm = /<div[^>]*class="[^"]*detail-desc[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    if (dm) {
        var pre = /<p[^>]*>([\s\S]*?)<\/p>/g, pmm;
        while ((pmm = pre.exec(dm[1])) !== null) {
            var t = PK_stripTags(pmm[1]);
            if (t) { intro = t; break; }
        }
    }
    var director = '', actor = '';
    var mm = /<div[^>]*class="[^"]*detail-meta[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    if (mm) {
        var sre = /<span[^>]*>([\s\S]*?)<\/span>/g, smm;
        while ((smm = sre.exec(mm[1])) !== null) {
            var st = PK_stripTags(smm[1]);
            if (st.indexOf('导演') === 0) director = st.replace(/^导演[：:]/, '').trim();
            else if (st.indexOf('主演') === 0) actor = st.replace(/^主演[：:]/, '').trim();
        }
    }
    var bySid = {};
    var sidOrder = [];
    var re = new RegExp('/vodplay/' + id + '-(\\d+)-(\\d+)\\.html', 'g');
    PK_eachAnchor(html, function (attrs, inner) {
        var href = PK_attr(attrs, 'href');
        var m = re.exec(href);
        re.lastIndex = 0;
        if (!m) return;
        var sid = m[1], nid = parseInt(m[2], 10);
        var key = sid + ':' + nid;
        if (bySid[key]) return;
        bySid[key] = 1;
        var name = PK_attr(attrs, 'title') || PK_stripTags(inner) || ('第' + nid + '集');
        if (!bySid['sid:' + sid]) { bySid['sid:' + sid] = []; sidOrder.push(sid); }
        bySid['sid:' + sid].push({ nid: nid, name: name });
    });
    var sids = {};
    sidOrder.forEach(function (sid) {
        sids[sid] = bySid['sid:' + sid].sort(function (a, b) { return a.nid - b.nid; });
    });
    return {
        title: PK_parseDetailTitle(html),
        poster: poster, intro: intro, actor: actor, director: director,
        sids: sids, sidOrder: sidOrder
    };
}

// 自家站详情：探各 sid 第 1 集播放页，第一个直链 m3u8 的 sid 出集；
// 没有直链线也不报错，用第一个 sid 出集数，播放时走 MacCMS 线。
function PK_ownDetail(id) {
    var html = PK_reqText(PK_BASE + '/voddetail/' + id + '.html', 20000);
    var d = PK_parseOwnDetail(id, html);
    if (!d.sidOrder.length) throw new Error('片库：详情里没有剧集');
    var chosenSid = null;
    for (var i = 0; i < d.sidOrder.length; i++) {
        var sid = d.sidOrder[i];
        try {
            var playHtml = PK_reqText(PK_BASE + '/vodplay/' + id + '-' + sid + '-1.html', 20000);
            var pa = PK_parsePlayerAaaa(playHtml);
            if (PK_isDirectM3u8(pa.from, pa.url)) { chosenSid = sid; break; }
        } catch (e) { /* 这条 sid 的第 1 集探不到，继续试下一条 */ }
    }
    d.chosenSid = chosenSid || d.sidOrder[0];
    d.html = html;
    return d;
}

// 自家站播放：逐 sid 试本集播放页的直链 m3u8；没有就按片名走 MacCMS 线。
function PK_resolveOwn(id, nid) {
    var html = PK_reqText(PK_BASE + '/voddetail/' + id + '.html', 20000);
    var d = PK_parseOwnDetail(id, html);
    if (!d.sidOrder.length) throw new Error('片库：详情里没有剧集');
    var epNo = parseInt(nid, 10) || 1;
    var seenFroms = [];
    for (var i = 0; i < d.sidOrder.length; i++) {
        var sid = d.sidOrder[i];
        var playHtml;
        try {
            playHtml = PK_reqText(PK_BASE + '/vodplay/' + id + '-' + sid + '-' + nid + '.html', 20000);
        } catch (e) { continue; }
        var pa;
        try { pa = PK_parsePlayerAaaa(playHtml); } catch (e) { continue; }
        if (pa.from) seenFroms.push(pa.from);
        if (PK_isDirectM3u8(pa.from, pa.url)) return PK_pickBestVariant(pa.url);
    }
    // 没有直链线：按详情页标题走 MacCMS 线（lxyy 已死，不走它）。
    var title = d.title;
    if (!title) {
        throw new Error('片库：这集没有直链线路（试过：' +
            (seenFroms.filter(function (v, idx, arr) { return arr.indexOf(v) === idx; }).join('、') || '无') +
            '），也拿不到片名去走解析线');
    }
    return PK_resolveViaMac(title, epNo);
}

// ---------- CatVod Spider ----------

function init(cfg) {
    // 无需配置。
}

function homeContent(filter) {
    return JSON.stringify({
        'class': PK_CATS.map(function (c) {
            return { type_id: String(c.id), type_name: c.name };
        })
    });
}

function homeVideoContent() {
    return JSON.stringify({ list: [] });
}

// 分类走自家站 /vodtype/{id}/ 与 /vodtype/{id}-{页}/。
function categoryContent(tid, pg, filter, extend) {
    var typeId = parseInt(tid, 10);
    if (!typeId) throw new Error('片库：不认识的分类 ' + tid);
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    var url = page === 1 ?
        PK_BASE + '/vodtype/' + typeId + '.html' :
        PK_BASE + '/vodtype/' + typeId + '-' + page + '.html';
    var html = PK_reqText(url, 20000);
    var r = PK_parseListPage(html, typeId);
    var nextUrl = page < r.totalPage ? 'pianku:type:' + typeId + ':' + (page + 1) : '';
    return JSON.stringify({
        page: page,
        pagecount: r.totalPage,
        limit: 20,
        total: r.list.length,
        list: r.list
    });
}

// 搜索走 MacCMS 线（本站搜索有滑块验证码）：按 SEARCH_ORDER 试线，
// 第一条有结果的线中标。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    for (var k = 0; k < PK_SEARCH_ORDER.length; k++) {
        var lineIdx = PK_SEARCH_ORDER[k];
        try {
            var books = PK_macSearch(lineIdx, kw, 1);
            if (!books.length) continue;
            return JSON.stringify({
                page: 1,
                pagecount: 1,
                limit: 20,
                total: books.length,
                list: books.map(function (b) {
                    return {
                        vod_id: b.url,
                        vod_name: b.title,
                        vod_pic: b.pic,
                        vod_remarks: b.intro,
                        vod_content: ''
                    };
                })
            });
        } catch (e) { /* 这条线挂了就落下一条 */ }
    }
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
}

// 详情：pianku:{id} 走自家站；pianku:vipjx:{线}:{vod_id}:{enc(片名)} 走 MacCMS 详情。
function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    if (id.indexOf('pianku:vipjx:') === 0) {
        var parts = id.split(':');
        if (parts.length < 5) throw new Error('片库：不认识的书地址 ' + id);
        var lineIdx = parseInt(parts[2], 10) || 0;
        var vodId = parts[3];
        var title = PK_dec(parts[4]);
        var d = PK_macFetchDetail(lineIdx, vodId);
        if (!d || !d.episodes.length) throw new Error('取不到详情：' + title);
        var playUrl = d.episodes.map(function (ep, idx) {
            return (ep.name || ('第' + (idx + 1) + '集')) + '$pianku:vipjx:' + lineIdx + ':' + vodId + ':' + (idx + 1) + ':' + PK_enc(d.title);
        }).join('#');
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: d.title,
                vod_pic: d.cover,
                vod_content: d.intro,
                vod_play_from: '片库',
                vod_play_url: playUrl
            }]
        });
    }
    if (id.indexOf('pianku:') !== 0) throw new Error('片库：不认识的书地址 ' + id);
    var pid = id.slice('pianku:'.length);
    if (!pid || !/^\d+$/.test(pid)) throw new Error('片库：不认识的书地址 ' + id);
    var od = PK_ownDetail(pid);
    var eps = od.sids[od.chosenSid] || [];
    if (!eps.length) throw new Error('片库：详情里没有剧集');
    var playUrl2 = eps.map(function (ep) {
        return ep.name + '$pianku:' + pid + ':' + ep.nid;
    }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: od.title,
            vod_pic: od.poster,
            vod_content: od.intro,
            vod_play_from: '片库',
            vod_play_url: playUrl2
        }]
    });
}

// 播放：章节地址 pianku:{id}:{nid} 或 pianku:vipjx:{线}:{vod_id}:{集号}:{enc(片名)}，
// 直接给 m3u8，不解析。
function playerContent(flag, id, vipFlags) {
    var ep = String(id || '');
    if (ep.indexOf('pianku:vipjx:') === 0) {
        var parts = ep.split(':');
        if (parts.length < 6) throw new Error('片库：不认识的章节地址 ' + ep);
        var lineIdx = parseInt(parts[2], 10) || 0;
        var vodId = parts[3];
        var epNo = parseInt(parts[4], 10) || 1;
        var title = PK_dec(parts[5]);
        var d = PK_macFetchDetail(lineIdx, vodId);
        var url = null;
        if (d && d.episodes[epNo - 1]) url = PK_pickBestVariant(d.episodes[epNo - 1].url);
        if (!url) url = PK_resolveViaMac(title, epNo);
        return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': PK_UA } });
    }
    if (ep.indexOf('pianku:') !== 0) throw new Error('片库：不认识的章节地址 ' + ep);
    var rest = ep.slice('pianku:'.length).split(':');
    if (rest.length < 2) throw new Error('片库：不认识的章节地址 ' + ep);
    var url2 = PK_resolveOwn(rest[0], rest[1]);
    return JSON.stringify({ parse: 0, url: url2, header: { 'User-Agent': PK_UA } });
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