var YX_BASE = 'https://www.yxxq51.cc';
var YX_UA_STR = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// ---------- 小工具 ----------

function YX_enc(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

function YX_reqText(url, timeoutMs, referer) {
    var res = req(url, {
        headers: {
            'User-Agent': YX_UA_STR,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Referer': referer || (YX_BASE + '/')
        },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) throw new Error('HTTP ' + res.code + ': ' + url);
    return res.content || '';
}

function YX_stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function YX_absUrl(u) {
    var t = String(u || '').replace(/&amp;/g, '&').trim();
    if (!t) return '';
    if (t.indexOf('http') === 0) return t;
    return YX_BASE + (t.charAt(0) === '/' ? t : '/' + t);
}

function YX_isQqTab(tabName) {
    var t = String(tabName || '').toUpperCase();
    return t.indexOf('TX') >= 0 || t.indexOf('腾讯') >= 0 || t.indexOf('QQ') >= 0;
}

// ---------- 列表解析 ----------

// 列表页/搜索页的条目：a[href^=/html/]，封面在 img[data-original|src]，状态在 .module-item-note。
function YX_parseList(html) {
    var list = [], seen = {};
    var re = /<a[^>]*href="(\/html\/([A-Za-z0-9]+)\.html)"[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
        var id = m[2];
        if (seen[id]) continue;
        var inner = m[3];
        var img = /<img[^>]*>/.exec(inner);
        var title = '';
        if (img) {
            var alt = /alt="([^"]*)"/.exec(img[0]);
            if (alt) title = alt[1].trim();
        }
        if (!title) title = YX_stripTags(inner);
        if (!title) continue;
        seen[id] = 1;
        var cover = '';
        if (img) {
            var ds = /data-original="([^"]*)"/.exec(img[0]);
            var src = /src="([^"]*)"/.exec(img[0]);
            cover = YX_absUrl(ds ? ds[1] : (src ? src[1] : ''));
        }
        var status = /module-item-note[^>]*>([^<]*)</.exec(inner);
        list.push({
            vod_id: 'yxxq:' + id,
            vod_name: title,
            vod_pic: cover,
            vod_remarks: status ? status[1].trim() : ''
        });
    }
    return list;
}

// 从播放页 HTML 里抠出 player_aaaa 的 JSON（大括号配对扫描）。
function YX_braceJson(s, marker) {
    var i = s.indexOf(marker);
    if (i < 0) return null;
    var j = s.indexOf('{', i);
    if (j < 0) return null;
    var d = 0, inStr = false, esc = false;
    for (var k = j; k < s.length; k++) {
        var c = s.charAt(k);
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
        } else {
            if (c === '"') inStr = true;
            else if (c === '{') d++;
            else if (c === '}') {
                d--;
                if (d === 0) return JSON.parse(s.substring(j, k + 1));
            }
        }
    }
    return null;
}

// 详情页解析：tab 名与 panel 按顺序对应，跳过 QQ 线，只列第一条非 QQ 线的剧集。
// 返回 {cover, intro, actor, episodes, playableSids}。
function YX_parseDetail(vodId, html) {
    var cover = /<meta[^>]*property=["']og:image["'][^>]*content="([^"]*)"/.exec(html);
    var desc = /<meta[^>]*name=["']description["'][^>]*content="([^"]*)"/.exec(html);
    var descText = desc ? desc[1].trim() : '';
    var actor = /主演：([^。]+)/.exec(descText);
    // tab 名（按顺序）
    var tabs = [];
    var tRe = /<div[^>]*class="[^"]*module-tab-item[^"]*"[^>]*data-dropdown-value="([^"]*)"/g, tm;
    while ((tm = tRe.exec(html)) !== null) tabs.push(tm[1].trim());
    // panel 起始位置（按顺序）
    var panelPos = [];
    var pRe = /<div[^>]*class="[^"]*module-list sort-list tab-list[^"]*"[^>]*>/g, pm;
    while ((pm = pRe.exec(html)) !== null) panelPos.push(pm.index);
    // 全部播放链接（带位置）：链接文本包在 <span> 里（如 <span>第02集</span>），
    // 不能用 ([^<]*) 取，要取整段再去标签；title 属性里也有“播放…第02集”可兜底。
    var linkRe = new RegExp('<a[^>]*href="/play/' + vodId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)-(\\d+)\\.html"[^>]*>([\\s\\S]*?)</a>', 'g');
    var links = [], lm;
    while ((lm = linkRe.exec(html)) !== null) {
        var text = YX_stripTags(lm[3]);
        if (!text) {
            var tattr = /title="[^"]*?(第[^"]*?集)/.exec(lm[0]);
            if (tattr) text = tattr[1];
        }
        links.push({ pos: lm.index, sid: parseInt(lm[1], 10), nid: lm[2], text: text });
    }
    var episodes = [];
    var playableSids = [];
    var panelCount = Math.max(tabs.length, panelPos.length);
    for (var i = 0; i < panelCount; i++) {
        var tabName = tabs[i] || '';
        if (YX_isQqTab(tabName)) continue;
        var start = panelPos[i] != null ? panelPos[i] : 0;
        var end = (i + 1 < panelPos.length) ? panelPos[i + 1] : html.length;
        var panelLinks = links.filter(function (l) { return l.pos >= start && l.pos < end; });
        if (!panelLinks.length) continue;
        // 同一 panel 里同一集可能出现多个锚点（如立即播放重复项），按 sid+nid 去重。
        var deduped = [], seenEp = {};
        for (var j0 = 0; j0 < panelLinks.length; j0++) {
            var key = panelLinks[j0].sid + '-' + panelLinks[j0].nid;
            if (!seenEp[key]) { seenEp[key] = 1; deduped.push(panelLinks[j0]); }
        }
        panelLinks = deduped;
        for (var j = 0; j < panelLinks.length; j++) {
            if (playableSids.indexOf(panelLinks[j].sid) < 0) playableSids.push(panelLinks[j].sid);
        }
        if (!episodes.length) {
            var sid = panelLinks[0].sid;
            for (var k = 0; k < panelLinks.length; k++) {
                var name = panelLinks.length === 1 ? tabName : (panelLinks[k].text || ('第' + panelLinks[k].nid + '集'));
                episodes.push({ name: name, url: 'yxxq:' + vodId + ':' + sid + ':' + panelLinks[k].nid });
            }
        }
    }
    if (!episodes.length) throw new Error('映像星球：详情里没有可播剧集（可能只剩 QQ 线路）');
    return {
        cover: cover ? cover[1].replace(/&amp;/g, '&') : '',
        intro: descText,
        actor: actor ? actor[1].trim() : '',
        episodes: episodes,
        playableSids: playableSids
    };
}

// ---------- CatVod Spider ----------

function init(cfg) { /* 无配置 */ }

function homeContent(filter) {
    return JSON.stringify({
        'class': [
            { type_id: '1', type_name: '电影' },
            { type_id: '2', type_name: '电视剧' },
            { type_id: '3', type_name: '综艺' },
            { type_id: '4', type_name: '动漫' },
            { type_id: '39', type_name: '短剧' }
        ]
    });
}

function homeVideoContent() {
    try {
        return categoryContent('1', 1, false, {});
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = YX_reqText(YX_BASE + '/search/-------------.html?wd=' + YX_enc(kw));
    var list = YX_parseList(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

function categoryContent(tid, pg, filter, extend) {
    var typeId = String(tid || '1');
    var page = parseInt(pg, 10) || 1;
    if (page > 1) return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: [] });
    var html = YX_reqText(YX_BASE + '/list/' + typeId + '.html');
    var list = YX_parseList(html);
    return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: list.length, list: list });
}

function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '').replace(/^yxxq:/, '');
    if (!id || id.indexOf(':') >= 0) throw new Error('映像星球：不认识的书地址');
    var html = YX_reqText(YX_BASE + '/html/' + id + '.html');
    var d = YX_parseDetail(id, html);
    var title = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
    var playUrl = d.episodes.map(function (ep) { return ep.name + '$' + ep.url; }).join('#');
    return JSON.stringify({
        list: [{
            vod_id: 'yxxq:' + id,
            vod_name: title ? title[1].trim() : '',
            vod_pic: d.cover,
            vod_content: d.intro,
            vod_remarks: d.actor,
            vod_play_from: '映像星球',
            vod_play_url: playUrl
        }]
    });
}

function playerContent(flag, id, vipFlags) {
    var url = YX_resolvePlayUrl(String(id || ''));
    return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': YX_UA_STR, 'Referer': YX_BASE + '/' } });
}

// 章节地址 yxxq:{vodId}:{sid}:{nid} 解析成最终可播地址。
function YX_resolvePlayUrl(episodeUrl) {
    if (episodeUrl.indexOf('yxxq:') !== 0) throw new Error('映像星球：不认识的章节地址');
    var parts = episodeUrl.slice('yxxq:'.length).split(':');
    if (parts.length < 3) throw new Error('映像星球：章节地址缺参数');
    var vodId = parts[0];
    var firstSid = parseInt(parts[1], 10) || 0;
    var nid = parts[2];
    var candidates = [firstSid];
    var lastMsg = '';
    try {
        var detailHtml = YX_reqText(YX_BASE + '/html/' + vodId + '.html');
        var sids = YX_parseDetail(vodId, detailHtml).playableSids;
        for (var i = 0; i < sids.length; i++) if (candidates.indexOf(sids[i]) < 0) candidates.push(sids[i]);
    } catch (e) {
        lastMsg = '取详情换线失败：' + String(e.message || e).slice(0, 80);
    }
    for (var k = 0; k < candidates.length; k++) {
        try {
            return YX_resolveOneLine(vodId, YX_BASE + '/play/' + vodId + '-' + candidates[k] + '-' + nid + '.html');
        } catch (e) {
            lastMsg = '线路 sid=' + candidates[k] + '：' + String(e.message || e).slice(0, 120);
        }
    }
    throw new Error('映像星球暂未返回可播地址：' + lastMsg);
}

function YX_resolveOneLine(vodId, playUrl) {
    var playHtml = YX_reqText(playUrl, 20000, YX_BASE + '/html/' + vodId + '.html');
    var pa = YX_braceJson(playHtml, 'player_aaaa=');
    if (!pa) throw new Error('播放页里没有 player_aaaa');
    var from = pa.from || '';
    var encrypt = pa.encrypt == null ? 0 : pa.encrypt;
    var urlField = pa.url || '';
    if (from === 'qq' || (urlField && urlField.indexOf('https://v.qq.com') === 0)) {
        throw new Error('该线路是 QQ 资源（from=' + from + '），无法直接播放');
    }
    if (encrypt !== 0 || !urlField || urlField.indexOf('.m3u8') < 0) {
        throw new Error('播放地址格式暂不支持（from=' + from + '，encrypt=' + encrypt + '）');
    }
    return urlField;
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