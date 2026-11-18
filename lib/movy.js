var MV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
var MV_SITE = 'https://www.movy.sx';
var MV_DB = 'https://db.wecollege.net/3';
var MV_STREAM = 'https://api.wecollege.net';
var MV_IMG = 'https://image.tmdb.org/t/p/w500';

// 站内播放线路顺序（miami 多画质优先，其余单档兜底）。
var MV_PROVIDERS = ['miami', 'seattle', 'portland', 'boise', 'atlanta', 'phoenix', 'austin', 'munich'];

// 解析时优先的画质（手机省流量，1080p 优先于 2160p）。
var MV_QUALITY_ORDER = ['1080p', '720p', '2160p', '480p'];

var MV_MOVIE_GENRES = [
    [28, '动作'], [12, '冒险'], [16, '动画'], [35, '喜剧'],
    [80, '犯罪'], [99, '纪录片'], [18, '剧情'], [10751, '家庭'],
    [14, '奇幻'], [36, '历史'], [27, '恐怖'], [10402, '音乐'],
    [9648, '悬疑'], [10749, '爱情'], [878, '科幻'], [53, '惊悚'],
    [10752, '战争'], [37, '西部']
];
var MV_TV_GENRES = [
    [10759, '动作冒险'], [16, '动画'], [35, '喜剧'], [80, '犯罪'],
    [99, '纪录片'], [18, '剧情'], [10751, '家庭'], [10762, '儿童'],
    [9648, '悬疑'], [10763, '新闻'], [10764, '真人秀'], [10765, '科幻奇幻'],
    [10766, '肥皂'], [10767, '脱口秀'], [10768, '战争政治'], [37, '西部']
];

// seed（带 30 秒左右的内存缓存）。
var MV_cachedSeed = null;
var MV_cachedSeedFor = null;
var MV_cachedSeedUntil = 0;

// ---------- 小工具 ----------

// URL 查询串编码（空格 → %20 等，对应 Kotlin 的 URLEncoder，这里用
// encodeURIComponent，空格是 %20 而不是 +，与站内实际请求一致）。
function MV_qenc(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, function (c) {
        return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
}

// JS encodeURIComponent（空格 → %20 等），站内 title 要先过一次这个再进查询串。
function MV_jsEnc(value) {
    var keep = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    var out = '';
    var bytes = MV_utf8Bytes(String(value));
    for (var i = 0; i < bytes.length; i++) {
        var c = bytes[i];
        if (c < 128 && keep.indexOf(String.fromCharCode(c)) >= 0) out += String.fromCharCode(c);
        else out += '%' + ('0' + c.toString(16).toUpperCase()).slice(-2);
    }
    return out;
}

function MV_utf8Bytes(s) {
    var out = [];
    s = String(s || '');
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
        else if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
            var c2 = s.charCodeAt(i + 1);
            if (c2 >= 0xDC00 && c2 < 0xE000) {
                var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
                out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                i++;
            } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
        } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return out;
}

// UTF-8 字节数组 → 字符串。
function MV_utf8Decode(bytes) {
    var out = '';
    var i = 0;
    while (i < bytes.length) {
        var c = bytes[i];
        if (c < 0x80) { out += String.fromCharCode(c); i++; }
        else if ((c & 0xE0) === 0xC0) {
            out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
            i += 2;
        } else if ((c & 0xF0) === 0xE0) {
            out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
            i += 3;
        } else if ((c & 0xF8) === 0xF0) {
            var cp = ((c & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
            cp -= 0x10000;
            out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
            i += 4;
        } else { out += '\uFFFD'; i++; }
    }
    return out;
}

// 同步 GET：返回 {code, content}；非 2xx 抛带 code 的错（供 401 重试判断）。
function MV_reqRaw(url, timeoutMs) {
    var res = req(url, {
        headers: { 'User-Agent': MV_UA, 'Accept': 'application/json', 'Referer': MV_SITE + '/' },
        timeout: timeoutMs || 20000
    });
    if (!res) throw new Error('无响应: ' + url);
    if (res.error) throw new Error('请求失败: ' + res.error);
    if (res.code < 200 || res.code >= 300) {
        var err = new Error('HTTP ' + res.code + ': ' + url);
        err.code = res.code;
        throw err;
    }
    return res.content || '';
}

function MV_reqJson(url, timeoutMs) {
    return JSON.parse(MV_reqRaw(url, timeoutMs || 20000));
}

// TMDB 代理取数（path 形如 /search/multi?query=…）。
function MV_dbGet(path) {
    return MV_reqRaw(MV_DB + path, 20000);
}

function MV_dbJson(path) {
    return JSON.parse(MV_dbGet(path));
}

// ---------- 解密（站内 JS 原样移植，Kotlin 版逐行对应） ----------

// 流密码的 16 个常量。
var MV_D = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174
];
var MV_MAGIC = [109, 118, 109, 49]; // "vmx1"

// murmur3 fmix32。
function MV_fmix(e0) {
    var e = e0 | 0;
    e = e ^ (e >>> 16);
    e = Math.imul(e, 0x85ebca6b);
    e = e ^ (e >>> 13);
    e = Math.imul(e, 0xc2b2ae35);
    e = e ^ (e >>> 16);
    return e | 0;
}

// 32 位左旋。
function MV_rotl(e, a) {
    var s = a & 31;
    if (s === 0) return e | 0;
    return ((e << s) | (e >>> (32 - s))) | 0;
}

// (e*(e+1)&1)==0；e*(e+1) 恒为偶数，所以恒为真。
function MV_rEven(e) { return ((e * (e + 1)) & 1) === 0; }

// 由 seed + mediaId 建流密码状态。
function MV_buildState(seed, mediaId) {
    if (((seed.length * (seed.length + 1)) & 1) === 1) {
        // RC4 分支：seed 长度使该条件恒不成立，实为死代码，照抄以备万一。
        var s = [];
        for (var i = 0; i < 256; i++) s.push(i);
        var t = 0;
        for (var j = 0; j < 256; j++) {
            t = (t + s[j] + seed.charCodeAt(j % seed.length)) & 255;
            var tmp = s[j]; s[j] = s[t]; s[t] = tmp;
        }
        var a = 0x67452301;
        for (var k = 0; k < seed.length; k++) {
            a = MV_rotl((a ^ Math.imul(seed.charCodeAt(k), MV_D[15 & k])) | 0, 5);
        }
        var present = [];
        for (var p = 0; p < 256; p++) present.push(true);
        return { s: s, present: present, acc: MV_fmix(a) };
    }
    // FNV-1a 分支（实际总走这里）。
    var a2 = 0x811c9dc5;
    for (var c = 0; c < seed.length; c++) {
        a2 = Math.imul(a2 ^ seed.charCodeAt(c), 0x01000193);
    }
    var fnv = MV_fmix(a2);
    var mediaNum = parseInt(mediaId, 10) || 0;
    var n = MV_fmix((fnv ^ MV_fmix((mediaNum ^ 0x9e3779b9) | 0)) | 0);
    var s2 = new Array(256).fill(0);
    var present2 = new Array(256).fill(false);
    for (var e = 0; e < 8; e++) {
        if (MV_rEven(e)) {
            var slot = ((n >>> 0) % 61);
            n = MV_rotl((n + 0x9e3779b9) | 0, 7 + (7 & e));
            s2[slot] = (n ^ MV_fmix(n)) | 0;
            present2[slot] = true;
            n = MV_fmix((n + slot) | 0);
        } else {
            s2[e] = MV_D[15 & e];
            present2[e] = true;
        }
    }
    return { s: s2, present: present2, acc: MV_fmix((0xa5a5a5a5 ^ n) | 0) };
}

// 流密码下一个 32 位字。
function MV_nextWord(st, counter) {
    var acc = st.acc | 0;
    var d = (acc >>> 0) % 61;
    var i = st.present[d] ? -1 : 0;
    var r = st.present[d] ? st.s[d] : 0;
    var c = Math.imul(0x9e3779b9, counter + 1);
    var sv = (r ^ c) | 0;
    var b = ((acc ^ sv) | (acc & sv & i)) | 0;
    b = (MV_rotl((b + acc) | 0, 31 & d) ^ MV_rotl(acc, 31 & (d * 7))) | 0;
    var l = MV_fmix((b + 0x9e3779b9) | 0);
    st.s[d] = l;
    st.present[d] = true;
    st.acc = l;
    return l;
}

// base64url 解码。
function MV_base64UrlDecode(s) {
    var table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var norm = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    var padded = norm + '===='.slice(0, (4 - norm.length % 4) % 4);
    var out = [];
    var acc = 0, nbits = 0;
    for (var i = 0; i < padded.length; i++) {
        var ch = padded[i];
        if (ch === '=') break;
        var v = table.indexOf(ch);
        if (v < 0) continue;
        acc = (acc << 6) | v;
        nbits += 6;
        if (nbits >= 8) {
            nbits -= 8;
            out.push((acc >> nbits) & 0xFF);
        }
    }
    return out;
}

// 解密一路 sources 接口返回的密文 → 明文 JSON。
// seed 来自 /seed，mediaId 是 TMDB id（字符串，如 "1396"）。
function MV_decryptSources(seed, mediaId, payload) {
    var data = MV_base64UrlDecode(payload);
    var st = MV_buildState(seed, mediaId);
    var ks = new Array(data.length);
    var counter = 0, pos = 0;
    while (pos < data.length) {
        var w = MV_nextWord(st, counter++);
        ks[pos++] = w & 0xFF;
        if (pos < data.length) ks[pos++] = (w >>> 8) & 0xFF;
        if (pos < data.length) ks[pos++] = (w >>> 16) & 0xFF;
        if (pos < data.length) ks[pos++] = (w >>> 24) & 0xFF;
    }
    for (var i = 0; i < data.length; i++) data[i] = data[i] ^ ks[i];
    for (var j = 0; j < MV_MAGIC.length; j++) {
        if (data[j] !== MV_MAGIC[j]) throw new Error('Movy 解密失败：魔头不对（seed 或内容可能已变）');
    }
    return MV_utf8Decode(data.slice(4));
}

// ---------- seed ----------

function MV_fetchSeed(mediaId) {
    var now = Date.now();
    if (MV_cachedSeed && MV_cachedSeedFor === mediaId && now < MV_cachedSeedUntil) {
        return MV_cachedSeed;
    }
    var json = MV_reqJson(MV_STREAM + '/seed?mediaId=' + MV_qenc(mediaId), 15000);
    var seed = json.seed || '';
    if (!seed) throw new Error('Movy 取 seed 为空');
    var ttl = json.ttlMs || 30000;
    MV_cachedSeed = seed;
    MV_cachedSeedFor = mediaId;
    MV_cachedSeedUntil = now + Math.max(ttl - 5000, 5000);
    return seed;
}

function MV_invalidateSeed() {
    MV_cachedSeed = null;
    MV_cachedSeedFor = null;
    MV_cachedSeedUntil = 0;
}

// 一路 sources 接口的原始密文（query 已拼好，不含前导 ?）。
function MV_sourcesRaw(provider, query) {
    return MV_reqRaw(MV_STREAM + '/' + provider + '/sources?' + query, 20000);
}

// ---------- 列表解析 ----------

function MV_parseTmdbList(json) {
    var obj = typeof json === 'string' ? JSON.parse(json) : json;
    var total = obj.total_pages || 1;
    if (total < 1) total = 1;
    if (total > 500) total = 500;
    var list = [];
    var arr = obj.results || [];
    for (var i = 0; i < arr.length; i++) {
        var it = arr[i] || {};
        var type = it.media_type || '';
        if (type === 'person') continue;
        var id = it.id || 0;
        if (!id) continue;
        var kind = null;
        if (type === 'movie') kind = 'movie';
        else if (type === 'tv') kind = 'tv';
        else continue;
        var title = it[kind === 'movie' ? 'title' : 'name'] || it.name || it.title || '';
        if (!title) continue;
        var poster = it.poster_path || '';
        var cover = poster ? MV_IMG + poster : '';
        var date = it[kind === 'movie' ? 'release_date' : 'first_air_date'] || '';
        list.push({
            vod_id: 'movy:' + kind + ':' + id,
            vod_name: title,
            vod_pic: cover,
            vod_remarks: date,
            vod_content: ''
        });
    }
    return { list: list, total: total };
}

// trending/discover 没有 media_type，按 kind 补一个再复用解析。
function MV_parseTmdbListKind(json, kind) {
    var obj = typeof json === 'string' ? JSON.parse(json) : json;
    var arr = obj.results || [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i]) arr[i].media_type = kind;
    }
    return MV_parseTmdbList(obj);
}

// ---------- CatVod Spider ----------

function init(cfg) {
    // 无需配置。
}

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
        var r = MV_parseTmdbListKind(MV_dbGet('/trending/movie/day?region=US&page=1'), 'movie');
        return JSON.stringify({ list: r.list });
    } catch (e) {
        return JSON.stringify({ list: [] });
    }
}

// 搜索走 TMDB 代理 /search/multi。
function searchContent(key, quick) {
    var kw = String(key || '').trim();
    if (!kw) return JSON.stringify({ page: 1, pagecount: 1, limit: 20, total: 0, list: [] });
    var r = MV_parseTmdbList(MV_dbGet('/search/multi?query=' + MV_qenc(kw) + '&page=1'));
    return JSON.stringify({ page: 1, pagecount: r.total, limit: 20, total: r.list.length, list: r.list });
}

// 分类：movy:cat:{movie|tv}:{trend|genre}:{id}:{页}；
// homeContent 的 tid 直接是 movie/tv 时走热门榜。
function categoryContent(tid, pg, filter, extend) {
    var t = String(tid || '');
    var kind = 'movie', mode = 'trend', genreId = '0';
    var page = parseInt(pg, 10) || 1;
    if (page < 1) page = 1;
    if (t === 'movie' || t === 'tv') {
        kind = t;
    } else if (t.indexOf('movy:cat:') === 0) {
        var parts = t.split(':');
        if (parts.length < 6) throw new Error('Movy：不认识的分类地址 ' + t);
        kind = parts[2];
        mode = parts[3];
        genreId = parts[4];
        page = parseInt(parts[5], 10) || 1;
    } else {
        throw new Error('Movy：不认识的分类地址 ' + t);
    }
    if (kind !== 'movie' && kind !== 'tv') throw new Error('Movy：不认识的分类 ' + kind);
    var path;
    if (mode === 'trend') path = '/trending/' + kind + '/day?region=US&page=' + page;
    else if (mode === 'genre') path = '/discover/' + kind + '?with_genres=' + genreId + '&sort_by=popularity.desc&page=' + page;
    else throw new Error('Movy：不认识的分类模式 ' + mode);
    var r = MV_parseTmdbListKind(MV_dbGet(path), kind);
    return JSON.stringify({ page: page, pagecount: r.total, limit: 20, total: r.list.length, list: r.list });
}

// 详情：电影直接一集“正片”；电视剧按季取集列表。
function detailContent(ids) {
    var id = Array.isArray(ids) ? ids[0] : ids;
    id = String(id || '');
    var parts = id.split(':');
    if (parts.length < 3 || parts[0] !== 'movy') throw new Error('Movy：不认识的书地址 ' + id);
    var kind = parts[1];
    var tmdbId = parts[2];
    if (kind === 'movie') {
        var obj = MV_dbJson('/movie/' + tmdbId);
        var cover = obj.poster_path ? MV_IMG + obj.poster_path : '';
        var intro = obj.overview || '';
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: obj.title || '',
                vod_pic: cover,
                vod_content: intro,
                vod_play_from: 'Movy',
                vod_play_url: '正片$movy:movie:' + tmdbId
            }]
        });
    }
    if (kind === 'tv') {
        var tv = MV_dbJson('/tv/' + tmdbId);
        var cover2 = tv.poster_path ? MV_IMG + tv.poster_path : '';
        var intro2 = tv.overview || '';
        var seasons = tv.number_of_seasons || 0;
        var eps = [];
        for (var s = 1; s <= seasons; s++) {
            try {
                var season = MV_dbJson('/tv/' + tmdbId + '/season/' + s);
                var arr = season.episodes || [];
                for (var i = 0; i < arr.length; i++) {
                    var ep = arr[i] || {};
                    var num = ep.episode_number || (i + 1);
                    var name = ep.name || '';
                    var title = name ? ('第' + s + '季第' + num + '集 ' + name) : ('第' + s + '季第' + num + '集');
                    eps.push({ name: title, url: 'movy:tv:' + tmdbId + ':' + s + ':' + num });
                }
            } catch (e) { /* 某一季取不到就跳过，不让整个详情失败。 */ }
        }
        if (!eps.length) throw new Error('Movy：详情里没有可播剧集');
        var playUrl = eps.map(function (ep) {
            return ep.name + '$' + ep.url;
        }).join('#');
        return JSON.stringify({
            list: [{
                vod_id: id,
                vod_name: tv.name || '',
                vod_pic: cover2,
                vod_content: intro2,
                vod_play_from: 'Movy',
                vod_play_url: playUrl
            }]
        });
    }
    throw new Error('Movy：不认识的书地址 ' + id);
}

// 播放：章节地址 movy:movie:{tmdbId} / movy:tv:{tmdbId}:{季}:{集}，
// 按线路顺序试，401 清 seed 重取一次再试同线路，解密后按画质优先取 m3u8。
function playerContent(flag, id, vipFlags) {
    var url = MV_resolvePlayUrl(String(id || ''));
    return JSON.stringify({ parse: 0, url: url, header: { 'User-Agent': MV_UA, 'Referer': MV_SITE + '/' } });
}

function MV_resolvePlayUrl(episodeUrl) {
    var parts = episodeUrl.split(':');
    if (parts.length < 3 || parts[0] !== 'movy') throw new Error('Movy：不认识的章节地址 ' + episodeUrl);
    var kind = parts[1];
    var tmdbId = parts[2];
    var isMovie = kind === 'movie';
    if (!isMovie && parts.length < 5) throw new Error('Movy：章节地址缺参数 ' + episodeUrl);
    var season = isMovie ? '' : parts[3];
    var episode = isMovie ? '' : parts[4];

    // 播放参数：标题、年份、总季数、imdbId（与站内一致）。
    var title, year, totalSeasons, imdbId;
    if (isMovie) {
        var obj = MV_dbJson('/movie/' + tmdbId);
        title = obj.title || '';
        year = String(obj.release_date || '').slice(0, 4);
        totalSeasons = '';
        imdbId = obj.imdb_id || '';
    } else {
        var tv = MV_dbJson('/tv/' + tmdbId);
        title = tv.name || '';
        year = String(tv.first_air_date || '').slice(0, 4);
        totalSeasons = String(tv.number_of_seasons || 0);
        imdbId = '';
        try {
            imdbId = MV_dbJson('/tv/' + tmdbId + '/external_ids').imdb_id || '';
        } catch (e) { /* 没有 imdbId 也能播 */ }
    }
    if (!title) throw new Error('Movy：取不到片名，无法解析');

    var mediaType = isMovie ? 'movie' : 'tv';
    var baseParams = 'title=' + MV_qenc(MV_jsEnc(title)) + '&mediaType=' + mediaType;
    if (year) baseParams += '&year=' + year;
    if (totalSeasons && totalSeasons !== '0') baseParams += '&totalSeasons=' + totalSeasons;
    if (!isMovie) baseParams += '&episodeId=' + episode + '&seasonId=' + season;
    baseParams += '&tmdbId=' + tmdbId;
    if (imdbId) baseParams += '&imdbId=' + imdbId;

    var lastMsg = '';
    for (var p = 0; p < MV_PROVIDERS.length; p++) {
        var provider = MV_PROVIDERS[p];
        try {
            return MV_resolveOneProvider(provider, baseParams, tmdbId);
        } catch (e) {
            if (e.code !== 401) {
                lastMsg = '线路 ' + provider + '：' + (e.code ? 'HTTP ' + e.code : String(e.message || e).slice(0, 120));
                continue;
            }
            // 401 说明 seed 可能失效：清掉重取一次再试这一路；
            // 重试仍 401 说明不是 seed 的问题，直接换下一线路，不再死磕这一路。
            MV_invalidateSeed();
            try {
                return MV_resolveOneProvider(provider, baseParams, tmdbId);
            } catch (e2) {
                if (e2.code === 401) lastMsg = '线路 ' + provider + '：重试仍 401，换线';
                else lastMsg = '线路 ' + provider + '：' + (e2.code ? 'HTTP ' + e2.code : String(e2.message || e2).slice(0, 120));
            }
        }
    }
    throw new Error('Movy 暂未返回可播地址：' + lastMsg);
}

function MV_resolveOneProvider(provider, baseParams, tmdbId) {
    var seed = MV_fetchSeed(tmdbId);
    var query = baseParams + '&enc=2&seed=' + MV_qenc(seed);
    var raw = MV_sourcesRaw(provider, query);
    if (!raw || !raw.trim()) throw new Error('线路 ' + provider + ' 返回为空');
    var plain = MV_decryptSources(seed, tmdbId, raw.trim());
    var obj = JSON.parse(plain);
    var arr = (obj && obj.sources) || [];
    if (!arr.length) throw new Error('线路 ' + provider + ' 没有可用画质');
    // 按画质优先级挑（1080p > 720p > 2160p > 480p），都不在表里就取第一个。
    var fallback = null, best = null, bestRank = 999;
    for (var i = 0; i < arr.length; i++) {
        var item = arr[i] || {};
        var url = String(item.url || '');
        if (!url) continue;
        if (!fallback) fallback = url;
        var rank = MV_QUALITY_ORDER.indexOf(item.quality || '');
        if (rank >= 0 && rank < bestRank) {
            bestRank = rank;
            best = url;
        }
    }
    if (best) return best;
    if (fallback) return fallback;
    throw new Error('线路 ' + provider + ' 没有可用地址');
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