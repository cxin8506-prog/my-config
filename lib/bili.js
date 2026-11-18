var BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var BILI_API = 'https://api.bilibili.com';
var BILI_NS = 'bili';
var BILI_PAGE_SIZE = 20;
var BILI_RANK_CACHE_MS = 10 * 60 * 1000;

// ---------- 小工具 ----------

function BILI_enc(s) {
return encodeURIComponent(s).replace(/[!'()*]/g, function (c) {
return '%' + c.charCodeAt(0).toString(16).toUpperCase();
});
}

function BILI_dec(s) {
try { return decodeURIComponent(s);} catch (e) { return s;}
}

function BILI_localGet(key) {
try {
if (typeof local === 'undefined') return '';
var v = local.get(BILI_NS, key);
return v? String(v): '';
} catch (e) { return '';}
}

function BILI_localSet(key, val) {
try {
if (typeof local === 'undefined') return false;
local.set(BILI_NS, key, val);
return true;
} catch (e) { return false;}
}

function BILI_absPic(p) {
p = String(p || '');
if (p.indexOf('//') === 0) return 'https:' + p;
return p;
}

function BILI_stripEm(s) {
return String(s || '').replace(/<[^>]*>/g, '');
}

function BILI_formatCount(n) {
n = Number(n) || 0;
if (n < 10000) return String(n);
var w = n / 10000;
var s = w.toFixed(1).replace(/\.0$/, '');
return s + '万';
}

function BILI_formatDurationSec(sec) {
sec = Number(sec) || 0;
if (sec <= 0) return '';
var h = Math.floor(sec / 3600);
var m = Math.floor((sec % 3600) / 60);
var s = sec % 60;
var mm = (m < 10? '0': '') + m;
var ss = (s < 10? '0': '') + s;
return h > 0? h + ':' + mm + ':' + ss: m + ':' + ss;
}

function BILI_statusText(play, durationStr) {
var parts = [];
if (play > 0) parts.push('播放 ' + BILI_formatCount(play));
if (durationStr) parts.push(durationStr);
return parts.join(' · ');
}

// ---------- buvid3 ----------

function BILI_uuidUpper() {
var hex = '0123456789ABCDEF';
var s = '';
for (var i = 0; i < 36; i++) {
if (i === 8 || i === 13 || i === 18 || i === 23) { s += '-'; continue;}
var r = Math.floor(Math.random() * 16);
if (i === 14) r = 4;
if (i === 19) r = (r & 3) | 8;
s += hex[r];
}
return s;
}

function BILI_ensureBuvid3() {
var v = BILI_localGet('buvid3');
if (v) return v;
v = BILI_uuidUpper() + 'infoc';
BILI_localSet('buvid3', v);
return v;
}

function BILI_freshBuvid3() {
var v = BILI_uuidUpper() + 'infoc';
BILI_localSet('buvid3', v);
return v;
}

// ---------- HTTP ----------

// 同步 GET，返回解析后的 JSON；非 2xx 抛错（带 HTTP 码，调用方按码重试）。
function BILI_reqJson(url, headers, timeoutMs) {
var h = { 'User-Agent': BILI_UA, 'Accept': 'application/json, text/plain, */*'};
if (headers) {
for (var k in headers) h[k] = headers[k];
}
var res = req(url, { headers: h, timeout: timeoutMs || 30000});
if (!res) throw new Error('无响应: ' + url);
if (res.error) throw new Error('请求失败: ' + res.error);
if (res.code < 200 || res.code >= 300) {
var e = new Error('B站请求失败 HTTP ' + res.code + '：' + String(res.content || '').slice(0, 200));
e.httpCode = res.code;
throw e;
}
return JSON.parse(res.content || '{}');
}

function BILI_checkCode(root) {
var code = (root && typeof root.code === 'number')? root.code: -1;
if (code!== 0) {
throw new Error('B站接口失败 code=' + code + '：' + ((root && root.message) || ''));
}
if (!root.data) throw new Error('B站接口没有返回 data');
return root.data;
}

function BILI_biliHeaders(buvid) {
return buvid? { 'Cookie': 'buvid3=' + buvid}: {};
}

// 搜索专用：412 时轮换重试最多 3 次（带 Cookie → 不带 → 换新 buvid3 再带）。
// JS 里没有 sleep，重试之间不等待；还不行就抛错，不编造结果。
function BILI_searchGet(url) {
var attempts = [
function () { return BILI_biliHeaders(BILI_ensureBuvid3());},
function () { return {};},
function () { return BILI_biliHeaders(BILI_freshBuvid3());}
];
var lastErr = null;
for (var i = 0; i < attempts.length; i++) {
try {
return BILI_reqJson(url, attempts[i](), 60000);
} catch (e) {
lastErr = e;
if (e.httpCode!== 412 || i === attempts.length - 1) throw e;
}
}
throw lastErr || new Error('B站搜索失败');
}

// ---------- 搜索 ----------

function BILI_searchVideo(keyword, page) {
var url = BILI_API + '/x/web-interface/search/type?keyword=' + BILI_enc(keyword) +
'&search_type=video&page=' + page + '&page_size=20';
var data = BILI_checkCode(BILI_searchGet(url));
var arr = data.result || [];
var list = [];
for (var i = 0; i < arr.length; i++) {
var item = arr[i] || {};
var bvid = item.bvid || '';
var title = BILI_stripEm(item.title || '');
if (!bvid ||!title) continue;
list.push({
vod_id: 'bili-video:' + bvid,
vod_name: title,
vod_pic: BILI_absPic(item.pic || ''),
vod_remarks: BILI_statusText(item.play || 0, item.duration || ''),
vod_content: item.description || ''
});
}
var numPages = data.numPages || 1;
return { list: list, totalPage: Math.max(1, numPages)};
}

function BILI_searchUser(keyword, page) {
var url = BILI_API + '/x/web-interface/search/type?keyword=' + BILI_enc(keyword) +
'&search_type=bili_user&page=' + page + '&page_size=10';
var data = BILI_checkCode(BILI_searchGet(url));
var arr = data.result || [];
var list = [];
for (var i = 0; i < arr.length; i++) {
var item = arr[i] || {};
var mid = item.mid;
var name = BILI_stripEm(item.uname || '');
if (!mid ||!name) continue;
var parts = [];
if (item.fans) parts.push('粉丝 ' + BILI_formatCount(item.fans));
if (item.videos) parts.push('视频 ' + item.videos);
list.push({
vod_id: 'bili-user:' + mid,
vod_name: name,
vod_pic: BILI_absPic(item.upic || ''),
vod_remarks: parts.join(' · '),
vod_content: item.usign || ''
});
}
return list;
}

function BILI_searchLive(keyword, page) {
var url = BILI_API + '/x/web-interface/search/type?keyword=' + BILI_enc(keyword) +
'&search_type=live_room&page=' + page + '&page_size=10';
var data = BILI_checkCode(BILI_searchGet(url));
var arr = data.result || [];
var list = [];
for (var i = 0; i < arr.length; i++) {
var item = arr[i] || {};
var roomid = item.roomid;
var title = BILI_stripEm(item.title || '');
if (!roomid ||!title) continue;
var uname = BILI_stripEm(item.uname || '');
list.push({
vod_id: 'bili-live:' + roomid,
vod_name: (uname? uname + '的直播间': '直播间') + ' · ' + title,
vod_pic: BILI_absPic(item.cover || item.uface || ''),
vod_remarks: item.live_status === 1? '直播中': '未开播',
vod_content: title
});
}
return list;
}

// ---------- 详情 ----------

function BILI_view(bvid) {
var data = BILI_checkCode(BILI_reqJson(
BILI_API + '/x/web-interface/view?bvid=' + BILI_enc(bvid),
BILI_biliHeaders(BILI_ensureBuvid3()), 60000));
var pages = [];
var arr = data.pages || [];
for (var i = 0; i < arr.length; i++) {
var p = arr[i] || {};
var cid = String(p.cid == null? '': p.cid);
if (!cid) continue;
pages.push({ cid: cid, part: p.part || ('P' + (i + 1)), duration: p.duration || 0});
}
return {
bvid: bvid,
title: data.title || '',
author: (data.owner && data.owner.name) || '',
cover: BILI_absPic(data.pic || ''),
pages: pages,
desc: data.desc || ''
};
}

function BILI_userInfo(mid) {
var data = BILI_checkCode(BILI_reqJson(
BILI_API + '/x/space/acc/info?mid=' + BILI_enc(mid),
BILI_biliHeaders(BILI_ensureBuvid3()), 30000));
return {
name: data.name || '',
face: BILI_absPic(data.face || ''),
sign: data.sign || ''
};
}

function BILI_userVideos(mid, page) {
var url = BILI_API + '/x/space/arc/search?mid=' + BILI_enc(mid) +
'&pn=' + page + '&ps=30&order=pubdate&jsonp=jsonp';
var data = BILI_checkCode(BILI_reqJson(url, BILI_biliHeaders(BILI_ensureBuvid3()), 30000));
var arr = ((data.list || {}).vlist) || [];
var list = [];
for (var i = 0; i < arr.length; i++) {
var v = arr[i] || {};
if (!v.bvid ||!v.title) continue;
list.push({
bvid: v.bvid,
title: BILI_stripEm(v.title),
cover: BILI_absPic(v.pic || ''),
play: v.play || 0,
            durationStr: v.length || '',
length: v.length || '',
desc: v.description || ''
});
}
var totalPage = 1;
if (data.page) {
var count = data.page.count || 0;
totalPage = Math.max(1, Math.ceil(count / 30));
}
return { list: list, totalPage: totalPage};
}

function BILI_liveInfo(roomid) {
var data = BILI_checkCode(BILI_reqJson(
'https://api.live.bilibili.com/room/v1/Room/get_info?room_id=' + BILI_enc(roomid),
{}, 30000));
return {
title: data.title || '',
uname: (data.anchor_info && data.anchor_info.base_info && data.anchor_info.base_info.uname) || '',
cover: BILI_absPic(data.user_cover || ''),
desc: data.description || '',
liveStatus: data.live_status
};
}

// ---------- 番剧 / 国创（PGC） ----------

function BILI_pgcRank(seasonType) {
var root = BILI_reqJson(
BILI_API + '/pgc/web/rank/list?day=3&season_type=' + seasonType,
BILI_biliHeaders(BILI_ensureBuvid3()), 30000);
if (root.code!== 0) throw new Error('B站番剧/国创榜单失败：' + (root.message || ('code=' + root.code)));
var arr = (root.result && root.result.list) || [];
var list = [];
for (var i = 0; i < arr.length; i++) {
var item = arr[i] || {};
var sid = item.season_id || 0;
var title = item.title || '';
if (!sid ||!title) continue;
list.push({
vod_id: 'bili-pgc:' + sid,
vod_name: title,
vod_pic: BILI_absPic(item.cover || ''),
vod_remarks: (item.new_ep && item.new_ep.index_show) || '',
vod_content: ''
});
}
if (!list.length) throw new Error('B站番剧/国创榜单是空的');
return list;
}

function BILI_pgcSeason(seasonId) {
var info = BILI_reqJson(
BILI_API + '/pgc/view/web/season?season_id=' + BILI_enc(seasonId),
BILI_biliHeaders(BILI_ensureBuvid3()), 30000);
if (info.code!== 0) throw new Error('B站番剧详情失败：' + (info.message || ''));
var res = info.result || {};
var section = BILI_reqJson(
BILI_API + '/pgc/web/season/section?season_id=' + BILI_enc(seasonId),
BILI_biliHeaders(BILI_ensureBuvid3()), 30000);
if (section.code!== 0) throw new Error('B站番剧集数失败：' + (section.message || ''));
var sres = section.result || {};
var episodes = [];
function addEps(arr, prefix) {
if (!arr) return;
for (var i = 0; i < arr.length; i++) {
var ep = arr[i] || {};
var id = ep.id || 0;
if (!id) continue;
var t = ep.long_title || ep.title || ('第' + (i + 1) + '话');
var badge = ep.badge || '';
var shown = badge? prefix + '' + t: prefix + t;
episodes.push({ epId: String(id), title: shown});
}
}
addEps(sres.main_section && sres.main_section.episodes, '');
var sections = sres.section || [];
for (var i = 0; i < sections.length; i++) {
var s = sections[i] || {};
addEps(s.episodes, '');
}
if (!episodes.length) throw new Error('B站番剧没有集数');
return {
seasonId: seasonId,
title: res.title || '',
cover: BILI_absPic(res.cover || ''),
desc: res.evaluate || '',
episodes: episodes
};
}

// ---------- 分区 ----------

var BILI_FALLBACK_REGIONS = [
{ tid: 1, name: '动画'}, { tid: 13, name: '番剧'}, { tid: 167, name: '国创'},
{ tid: 3, name: '音乐'}, { tid: 129, name: '舞蹈'}, { tid: 4, name: '游戏'},
{ tid: 36, name: '科技'}, { tid: 188, name: '数码'}, { tid: 160, name: '生活'},
{ tid: 211, name: '美食'}, { tid: 119, name: '鬼畜'}, { tid: 155, name: '时尚'},
{ tid: 5, name: '娱乐'}, { tid: 181, name: '影视'}, { tid: 177, name: '纪录片'},
{ tid: 23, name: '电影'}, { tid: 11, name: '电视剧'}, { tid: 234, name: '运动'},
{ tid: 223, name: '汽车'}, { tid: 217, name: '动物圈'}
];

var BILI_regionsCache = null; // {ts, list}
var BILI_rankCache = {}; // rid -> {ts, list}

function BILI_regions() {
var now = Date.now();
if (BILI_regionsCache && now - BILI_regionsCache.ts < BILI_RANK_CACHE_MS) return BILI_regionsCache.list;
var list = null;
try {
var data = BILI_checkCode(BILI_reqJson(
'https://app.bilibili.com/x/v2/region?build=8410300&mobi_app=android&platform=android',
{}, 30000));
var arr = data.data || [];
list = [];
for (var i = 0; i < arr.length; i++) {
var item = arr[i] || {};
var tid = item.tid || 0;
var name = item.name || '';
if (!tid ||!name) continue;
if (tid === 65537 || tid === 65539 || tid === 165) continue; // 直播/游戏中心/广告
list.push({ tid: tid, name: name});
}
} catch (e) { list = null;}
if (!list ||!list.length) list = BILI_FALLBACK_REGIONS;
// app 分区列表里没有运动/汽车/动物圈（子分区），但榜单接口都能返回，补上。
var extra = [{ tid: 234, name: '运动'}, { tid: 223, name: '汽车'}, { tid: 217, name: '动物圈'}];
for (var j = 0; j < extra.length; j++) {
var found = false;
for (var k = 0; k < list.length; k++) if (list[k].tid === extra[j].tid) { found = true; break;}
if (!found) list.push(extra[j]);
}
BILI_regionsCache = { ts: now, list: list};
return list;
}

function BILI_rankingByRegion(rid, page) {
var all;
if (rid === 13 || rid === 167) {
all = BILI_pgcRank(rid === 13? 1: 4);
var totalPagePgc = Math.max(1, Math.ceil(all.length / BILI_PAGE_SIZE));
if (page < 1 || page > totalPagePgc) return { list: [], totalPage: totalPagePgc};
var fromPgc = (page - 1) * BILI_PAGE_SIZE;
return { list: all.slice(fromPgc, Math.min(fromPgc + BILI_PAGE_SIZE, all.length)), totalPage: totalPagePgc};
}
var now = Date.now();
var cached = BILI_rankCache[rid];
if (cached && now - cached.ts < BILI_RANK_CACHE_MS) {
all = cached.list;
} else {
var data = BILI_checkCode(BILI_reqJson(
BILI_API + '/x/web-interface/ranking/v2?rid=' + rid + '&type=all',
BILI_biliHeaders(BILI_ensureBuvid3()), 30000));
var arr = data.list || [];
var list = [];
for (var i = 0; i < arr.length; i++) {
var item = arr[i] || {};
var bvid = item.bvid || '';
var title = item.title || '';
if (!bvid ||!title) continue;
var durSec = item.duration || 0;
list.push({
vod_id: 'bili-video:' + bvid,
vod_name: title,
vod_pic: BILI_absPic(item.pic || ''),
vod_remarks: BILI_statusText((item.stat && item.stat.view) || 0, BILI_formatDurationSec(durSec)),
vod_content: item.desc || ''
});
}
if (!list.length) throw new Error('B站分区 ' + rid + ' 榜单是空的');
BILI_rankCache[rid] = { ts: now, list: list};
all = list;
}
var totalPage = Math.max(1, Math.ceil(all.length / BILI_PAGE_SIZE));
if (page < 1 || page > totalPage) return { list: [], totalPage: totalPage};
var from = (page - 1) * BILI_PAGE_SIZE;
return { list: all.slice(from, Math.min(from + BILI_PAGE_SIZE, all.length)), totalPage: totalPage};
}

// ---------- 播放取流 ----------

function BILI_pickDurl(durlArr) {
if (!durlArr ||!durlArr.length) return '';
var d = durlArr[0] || {};
var backup = (d.backup_url && d.backup_url[0]) || '';
var main = d.url || '';
return backup || main;
}

function BILI_playVideoUrl(bvid, cid, qn) {
qn = qn || 64;
var data = BILI_checkCode(BILI_reqJson(
BILI_API + '/x/player/playurl?bvid=' + BILI_enc(bvid) + '&cid=' + BILI_enc(cid) + '&qn=' + qn + '&fnval=0',
BILI_biliHeaders(BILI_ensureBuvid3()), 30000));
var durl = data.durl;
if ((!durl ||!durl.length) && qn > 16) return BILI_playVideoUrl(bvid, cid, 16);
var url = BILI_pickDurl(durl);
if (!url) throw new Error('B站没有返回视频流');
return url;
}

function BILI_playAudioUrl(bvid, cid) {
var data = BILI_checkCode(BILI_reqJson(
BILI_API + '/x/player/playurl?bvid=' + BILI_enc(bvid) + '&cid=' + BILI_enc(cid) + '&qn=64&fnval=16',
BILI_biliHeaders(BILI_ensureBuvid3()), 30000));
var audios = (data.dash && data.dash.audio) || [];
if (!audios.length) throw new Error('B站没有返回音频流');
var fallback = null;
for (var i = 0; i < audios.length; i++) {
var a = audios[i] || {};
if (a.id === 30280) return BILI_audioUrlOf(a);
if (!fallback && (a.id === 30232 || a.id === 30216)) fallback = a;
}
if (fallback) return BILI_audioUrlOf(fallback);
var best = null, bestBw = -1;
for (var j = 0; j < audios.length; j++) {
var b = audios[j] || {};
if ((b.bandwidth || 0) > bestBw) { bestBw = b.bandwidth || 0; best = b;}
}
if (best) return BILI_audioUrlOf(best);
throw new Error('B站音频流地址为空');
}

function BILI_audioUrlOf(a) {
var backup = (a.backup_url && a.backup_url[0]) || '';
var main = a.baseUrl || a.base_url || '';
var url = backup || main;
if (!url) throw new Error('B站音频流地址为空');
return url;
}

function BILI_pgcPlayUrl(epId, qn) {
qn = qn || 64;
var root = BILI_reqJson(
BILI_API + '/pgc/player/web/playurl?ep_id=' + BILI_enc(epId) + '&qn=' + qn + '&fnval=0',
BILI_biliHeaders(BILI_ensureBuvid3()), 30000);
if (root.code!== 0) throw new Error('B站番剧播放失败：' + (root.message || ('code=' + root.code)));
var res = root.result || {};
var durl = res.durl;
if ((!durl ||!durl.length) && qn > 16) return BILI_pgcPlayUrl(epId, 16);
var url = BILI_pickDurl(durl);
if (!url) throw new Error('B站番剧没有返回视频流');
return url;
}

// 直播取 hls：room/v1/Room/playUrl，platform=h5 回 m3u8。
function BILI_livePlayUrl(roomid) {
var root = BILI_reqJson(
'https://api.live.bilibili.com/room/v1/Room/playUrl?cid=' + BILI_enc(roomid) + '&quality=4&platform=h5',
{}, 30000);
if (root.code!== 0) throw new Error('B站直播取流失败：' + (root.message || ('code=' + root.code)));
var durl = (root.data && root.data.durl) || [];
var url = BILI_pickDurl(durl);
if (!url) throw new Error('B站直播没有返回拉流地址（主播可能已下播）');
return url;
}

// ---------- CatVod Spider ----------

function init(cfg) {
// 无需配置；buvid3 在 local 里按需生成。
}

function homeContent(filter) {
var regions = BILI_regions();
var classes = [];
for (var i = 0; i < regions.length; i++) {
classes.push({ type_id: 'region:' + regions[i].tid, type_name: regions[i].name});
}
return JSON.stringify({ 'class': classes});
}

function homeVideoContent() {
try {
var data = BILI_checkCode(BILI_reqJson(
BILI_API + '/x/web-interface/popular?ps=20&pn=1',
BILI_biliHeaders(BILI_ensureBuvid3()), 30000));
var arr = data.list || [];
var list = [];
for (var i = 0; i < arr.length; i++) {
var item = arr[i] || {};
if (!item.bvid ||!item.title) continue;
list.push({
vod_id: 'bili-video:' + item.bvid,
vod_name: item.title,
vod_pic: BILI_absPic(item.pic || ''),
vod_remarks: BILI_statusText((item.stat && item.stat.view) || 0, BILI_formatDurationSec(item.duration || 0)),
vod_content: item.desc || ''
});
}
return JSON.stringify({ list: list});
} catch (e) {
return JSON.stringify({ list: []});
}
}

function categoryContent(tid, pg, filter, extend) {
var page = parseInt(pg, 10) || 1;
var m = /^region:(\d+)$/.exec(String(tid || ''));
if (!m) {
return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: []});
}
var rid = parseInt(m[1], 10);
try {
var r = BILI_rankingByRegion(rid, page);
return JSON.stringify({
page: page,
pagecount: r.totalPage,
limit: 20,
total: r.list.length,
list: r.list
});
} catch (e) {
return JSON.stringify({ page: page, pagecount: 1, limit: 20, total: 0, list: []});
}
}

function searchContent(key, quick) {
var kw = String(key || '').trim();
if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: []});
var list = [];
var totalPage = 1;
var lastErr = null;
try {
var v = BILI_searchVideo(kw, 1);
list = list.concat(v.list);
totalPage = v.totalPage;
} catch (e) { lastErr = e;}
try {
list = list.concat(BILI_searchUser(kw, 1));
} catch (e) { if (!lastErr) lastErr = e;}
try {
list = list.concat(BILI_searchLive(kw, 1));
} catch (e) { if (!lastErr) lastErr = e;}
if (!list.length && lastErr) throw lastErr;
return JSON.stringify({
page: 1,
pagecount: totalPage,
limit: 20,
total: list.length,
list: list
});
}

function detailContent(ids) {
var id = Array.isArray(ids)? ids[0]: ids;
id = String(id || '');
var vod = null;
if (id.indexOf('bili-video:') === 0) {
var bvid = id.slice('bili-video:'.length);
var view = BILI_view(bvid);
var playUrl = view.pages.map(function (p) {
return (p.part || 'P') + '$bili-ep:' + bvid + ':' + p.cid;
}).join('#');
vod = {
vod_id: id,
vod_name: view.title,
vod_pic: view.cover,
vod_content: view.desc || '',
vod_remarks: view.author || '',
vod_play_from: 'B站视频',
vod_play_url: playUrl
};
} else if (id.indexOf('bili-pgc:') === 0) {
var sid = id.slice('bili-pgc:'.length);
var season = BILI_pgcSeason(sid);
var pgcPlayUrl = season.episodes.map(function (ep) {
return ep.title + '$bili-pgc-ep:' + sid + ':' + ep.epId;
}).join('#');
vod = {
vod_id: id,
vod_name: season.title,
vod_pic: season.cover,
vod_content: season.desc || '',
vod_play_from: 'B站视频',
vod_play_url: pgcPlayUrl
};
} else if (id.indexOf('bili-user:') === 0) {
var mid = id.slice('bili-user:'.length);
var info = BILI_userInfo(mid);
var uv = BILI_userVideos(mid, 1);
var userPlayUrl = uv.list.map(function (v) {
return v.title + '$bili-ep:' + v.bvid + ':';
}).join('#');
vod = {
vod_id: id,
vod_name: info.name,
vod_pic: info.face,
vod_content: info.sign || '',
vod_play_from: 'B站视频',
vod_play_url: userPlayUrl
};
} else if (id.indexOf('bili-live:') === 0) {
var roomid = id.slice('bili-live:'.length);
var live = BILI_liveInfo(roomid);
vod = {
vod_id: id,
vod_name: (live.uname? live.uname + '的直播间': '直播间'),
vod_pic: live.cover,
vod_content: live.desc || live.title || '',
vod_remarks: live.liveStatus === 1? '直播中': '未开播',
vod_play_from: 'B站视频',
vod_play_url: '直播$bili-live:' + roomid
};
} else {
throw new Error('B站视频：不认识的书地址 ' + id);
}
return JSON.stringify({ list: [vod]});
}

function playerContent(flag, id, vipFlags) {
id = String(id || '');
var url = '';
var m = /^bili-ep:([^:]+):(.*)$/.exec(id);
if (m) {
var bvid = m[1];
var cid = m[2];
if (!cid) {
var view = BILI_view(bvid);
if (!view.pages.length) throw new Error('B站视频没有分 P，播不了');
cid = view.pages[0].cid;
}
try {
url = BILI_playVideoUrl(bvid, cid, 64);
} catch (e) {
// 视频流拿不到时退到音频，至少能听。
url = BILI_playAudioUrl(bvid, cid);
}
} else if (id.indexOf('bili-pgc-ep:') === 0) {
var parts = id.slice('bili-pgc-ep:'.length).split(':');
if (parts.length < 2) throw new Error('B站视频：章节地址缺参数');
url = BILI_pgcPlayUrl(parts[1], 64);
} else if (id.indexOf('bili-live:') === 0) {
url = BILI_livePlayUrl(id.slice('bili-live:'.length));
} else {
throw new Error('B站视频：不认识的章节地址 ' + id);
}
return JSON.stringify({
parse: 0,
url: url,
header: { 'Referer': 'https://www.bilibili.com/', 'User-Agent': BILI_UA}
});
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