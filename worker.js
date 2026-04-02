// ==========================================
// EMOS 专属精装版反代 (完美聚合 + 奈飞海报 + 智能网络测速面板)
// ==========================================

// ======== 基础配置区 ========
const PROXY_ID = "exxx";    // 你的 ID
const PROXY_NAME = "xxx"; // 你的 称号 (已做安全编码处理)
const TARGET_HOST = "emos.best";  // 官方主服地址
const TMDB_API_KEY = "eyJhbGcxxxxxxxxxxx"; // 你的长令牌
// ==========================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Emby-Authorization, *",
  "Access-Control-Expose-Headers": "*"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === '/' || url.pathname === '') {
      const ua = (request.headers.get("User-Agent") || "").toLowerCase();
      const accept = (request.headers.get("Accept") || "").toLowerCase();
      const isPlayer = /infuse|fileball|vidhub|emby|jellyfin|kodi/i.test(ua);
      const isJsonRequest = accept.includes("application/json");
      const isBrowser = accept.includes("text/html");

      if (!isPlayer && !isJsonRequest && isBrowser) {
        return handleLandingPage(request, ctx);
      }
    }

    return handleProxy(request, env, ctx, url);
  }
};

// ==========================================
// 核心反代逻辑
// ==========================================
async function handleProxy(request, env, ctx, url) {
  let finalUrl = url;

  const hasProviderId = Array.from(url.searchParams.keys()).some(k => k.toLowerCase() === 'anyprovideridequals');
  if (hasProviderId) {
    const convertedUrl = await convertTmdbRequestFromUrl(url, TMDB_API_KEY);
    if (convertedUrl) {
      finalUrl = convertedUrl; 
    }
  }

  const targetUrl = `https://${TARGET_HOST}${finalUrl.pathname}${finalUrl.search}`;
  const newHeaders = new Headers(request.headers);
  
  newHeaders.set("Host", TARGET_HOST);
  newHeaders.set("EMOS-PROXY-ID", PROXY_ID);
  newHeaders.set("EMOS-PROXY-NAME", encodeURIComponent(PROXY_NAME));
  newHeaders.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") || "127.0.0.1");

  const newRequest = new Request(targetUrl, {
    method: request.method,
    headers: newHeaders,
    body: request.body,
    redirect: "manual"
  });

  const isProgress = finalUrl.pathname.toLowerCase() === '/emby/sessions/playing/progress';
  if (request.method === "POST" && isProgress) {
    if (Math.random() < 0.8) {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }
  }

  const cache = caches.default;
  const isImage = finalUrl.pathname.match(/^\/emby\/Items\/.*\/Images\//i);
  const isPing = finalUrl.pathname.toLowerCase() === '/emby/system/ping';

  let response;
  if (request.method === "GET" && (isImage || isPing)) {
    response = await cache.match(request);
    if (!response) {
      response = await fetch(newRequest);
      if (response.status !== 101) {
        response = new Response(response.body, response);
        if (isImage) response.headers.set("Cache-Control", "public, max-age=2592000");
        else if (isPing) response.headers.set("Cache-Control", "public, max-age=60");
        ctx.waitUntil(cache.put(request, response.clone()));
      }
    }
  } else {
    response = await fetch(newRequest);
  }

  if (response.status === 101 || request.headers.get("Upgrade") === "websocket") {
    return response;
  }

  const proxyResponse = new Response(response.body, response);
  proxyResponse.headers.delete("Access-Control-Allow-Origin"); 
  for (const [key, value] of Object.entries(corsHeaders)) {
    proxyResponse.headers.set(key, value);
  }

  return proxyResponse;
}

// ==========================================
// 附加功能：TMDB ID 转 SearchTerm
// ==========================================
async function convertTmdbRequestFromUrl(upstreamUrl, tmdbApiKey) {
  const providerKey = Array.from(upstreamUrl.searchParams.keys()).find(k => k.toLowerCase() === 'anyprovideridequals');
  if (!providerKey) return null;

  const anyProviderId = upstreamUrl.searchParams.get(providerKey);
  const tmdbMatch = anyProviderId?.match(/tmdb\.(\d+)/i);
  if (!tmdbMatch) return null;
  const tmdbId = tmdbMatch[1];

  if (!tmdbApiKey) return null;

  const includeTypesKey = Array.from(upstreamUrl.searchParams.keys()).find(k => k.toLowerCase() === 'includeitemtypes');
  const includeTypes = includeTypesKey ? (upstreamUrl.searchParams.get(includeTypesKey) || '') : '';
  const isMovie = includeTypes.toLowerCase().includes('movie');

  try {
    const tmdbUrl = isMovie 
      ? `https://api.themoviedb.org/3/movie/${tmdbId}?language=zh-CN`
      : `https://api.themoviedb.org/3/tv/${tmdbId}?language=zh-CN`;

    const headers = { "accept": "application/json" };
    let finalTmdbUrl = tmdbUrl;
    
    if (tmdbApiKey.length > 50) {
      headers["Authorization"] = `Bearer ${tmdbApiKey}`; 
    } else {
      finalTmdbUrl += `&api_key=${tmdbApiKey}`; 
    }

    const resp = await fetch(finalTmdbUrl, { headers });
    if (!resp.ok) return null; 
    
    const data = await resp.json();
    let title = isMovie ? data.title : data.name;
    let year = isMovie 
      ? (data.release_date ? data.release_date.substring(0, 4) : '') 
      : (data.first_air_date ? data.first_air_date.substring(0, 4) : '');

    if (!title) return null;

    const newUrl = new URL(upstreamUrl.toString());
    newUrl.searchParams.delete(providerKey); 
    newUrl.searchParams.set('SearchTerm', title); 
    
    if (year) {
      newUrl.searchParams.set('Years', year); 
    } else {
      Array.from(newUrl.searchParams.keys()).filter(k => k.toLowerCase() === 'years').forEach(k => newUrl.searchParams.delete(k));
    }

    return newUrl; 
  } catch (error) {
    return null;
  }
}

// ==========================================
// 奈飞风格前端面板生成
// ==========================================
async function handleLandingPage(request, ctx) {
  const clientIP = request.headers.get("CF-Connecting-IP") || "Unknown";
  const country = request.cf?.country || "N/A"; 
  const colo = request.cf?.colo || "N/A";
  const city = request.cf?.city || "Unknown Location"; 
  
  const ua = request.headers.get("User-Agent") || "";
  let device = "Other";
  if (ua.includes("Chrome")) device = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) device = "Safari";
  else if (ua.includes("Firefox")) device = "Firefox";
  else if (ua.includes("Edge")) device = "Edge";

  let pingMs = 0;
  let posters = [];
  const fallbackPosters = [
    "https://image.tmdb.org/t/p/w500/A4BtcBvP1B2b4k5K68W2h0bEY1v.jpg", "https://image.tmdb.org/t/p/w500/8cdWjvZQUrmdDO7Sl3Xh0E8v9eB.jpg",
    "https://image.tmdb.org/t/p/w500/vSNxAJTlD0r02V9sPYpOjqDZXUK.jpg", "https://image.tmdb.org/t/p/w500/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg",
    "https://image.tmdb.org/t/p/w500/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg", "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
    "https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPbOYKQzzzS.jpg", "https://image.tmdb.org/t/p/w500/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg",
    "https://image.tmdb.org/t/p/w500/xXhKkGk8E1w7pM1n8u4019aX09.jpg", "https://image.tmdb.org/t/p/w500/z0G7AARbWc3W172h3B3oYIweBq7.jpg",
  ];

  const pingTask = (async () => {
    const startPing = Date.now();
    try {
      await Promise.race([
        fetch(`https://${TARGET_HOST}/emby/System/Ping`),
        new Promise(resolve => setTimeout(resolve, 800))
      ]);
    } catch(e) {}
    pingMs = Date.now() - startPing;
  })();

  const tmdbTask = (async () => {
    try {
      const tmdbHeaders = { "accept": "application/json" };
      if (TMDB_API_KEY.length > 50) tmdbHeaders["Authorization"] = `Bearer ${TMDB_API_KEY}`;
      const tmdbResp = await Promise.race([
        fetch('https://api.themoviedb.org/3/trending/all/day?language=zh-CN', { headers: tmdbHeaders }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
      ]);
      if (tmdbResp.ok) {
        const data = await tmdbResp.json();
        posters = data.results.filter(i => i.poster_path).map(i => `https://image.tmdb.org/t/p/w500${i.poster_path}`);
      }
    } catch(e) {}
  })();

  await Promise.allSettled([pingTask, tmdbTask]);

  if (posters.length < 8) posters = fallbackPosters;

  const shuffle = (arr) => arr.sort(() => 0.5 - Math.random());
  const row1 = shuffle([...posters, ...posters]).slice(0, 15);
  const row2 = shuffle([...posters, ...posters]).slice(0, 15);
  const row3 = shuffle([...posters, ...posters]).slice(0, 15);
  const row4 = shuffle([...posters, ...posters]).slice(0, 15);
  const row5 = shuffle([...posters, ...posters]).slice(0, 15);
  const row6 = shuffle([...posters, ...posters]).slice(0, 15);
  
  const currentYear = new Date().getFullYear();

  let pingColor = "text-green-500";
  if (pingMs > 80) pingColor = "text-yellow-500";
  if (pingMs > 200) pingColor = "text-red-500";

  const networkStatusText = country === 'CN' ? '本地直连网络' : '全球代理网络';
  const networkBadgeColor = country === 'CN' ? 'bg-green-600/80 text-green-100' : 'bg-purple-600/80 text-purple-100';

  const html = `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>emos 聚合反代 | ${PROXY_NAME}</title>
      <!-- 添加专属网页标签图标 (Favicon) -->
      <link rel="icon" type="image/png" href="https://upicon.iknn.eu.org/admin/emospg(1)-emby_1772994874075.png">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;500;700;900&display=swap');
          
          body { 
              background-color: #141414; 
              color: #ffffff; 
              font-family: 'Noto Sans SC', sans-serif; 
              overflow: hidden; 
              margin: 0;
          }

          .poster-bg-container {
              position: fixed; top: -60%; left: -30%; width: 160%; height: 220%;
              transform: rotate(-12deg); z-index: -2; display: flex; flex-direction: column;
              gap: 1rem; opacity: 0.35; 
          }

          .poster-row { display: flex; gap: 1rem; width: max-content; }
          .poster-row img {
              width: 200px; height: 300px; object-fit: cover; border-radius: 6px;
              box-shadow: 0 4px 15px rgba(0,0,0,0.8);
          }

          .row-left-1 { animation: scrollLeft 80s linear infinite; }
          .row-right-1 { animation: scrollRight 95s linear infinite; }
          .row-left-2 { animation: scrollLeft 85s linear infinite; }
          .row-right-2 { animation: scrollRight 90s linear infinite; }
          .row-left-3 { animation: scrollLeft 100s linear infinite; }
          .row-right-3 { animation: scrollRight 85s linear infinite; }

          @keyframes scrollLeft { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
          @keyframes scrollRight { 0% { transform: translateX(-50%); } 100% { transform: translateX(0); } }

          .overlay-vignette {
              position: fixed; top: 0; left: 0; right: 0; bottom: 0;
              background: radial-gradient(circle at center, rgba(20,20,20,0.4) 0%, rgba(20,20,20,1) 85%);
              z-index: -1;
          }

          .netflix-red { color: #E50914; }
          .bg-netflix-red { background-color: #E50914; }
          
          .nf-card {
              background: rgba(24, 24, 24, 0.7);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 1.5rem; 
              padding: 1.5rem; 
              backdrop-filter: blur(10px);
          }
      </style>
  </head>
  <body class="antialiased min-h-screen flex flex-col items-center justify-center relative px-4">
      
      <!-- 满屏 6 排海报墙 -->
      <div class="poster-bg-container">
          <div class="poster-row row-left-1">${row1.map(src => `<img src="${src}" alt="poster">`).join('')}</div>
          <div class="poster-row row-right-1">${row2.map(src => `<img src="${src}" alt="poster">`).join('')}</div>
          <div class="poster-row row-left-2">${row3.map(src => `<img src="${src}" alt="poster">`).join('')}</div>
          <div class="poster-row row-right-2">${row4.map(src => `<img src="${src}" alt="poster">`).join('')}</div>
          <div class="poster-row row-left-3">${row5.map(src => `<img src="${src}" alt="poster">`).join('')}</div>
          <div class="poster-row row-right-3">${row6.map(src => `<img src="${src}" alt="poster">`).join('')}</div>
      </div>
      
      <div class="overlay-vignette"></div>

      <div class="w-full max-w-5xl z-10">
          <header class="mb-12 flex flex-col items-center text-center">
              <!-- 这里去掉了大写字体类，并使用了 tracking-tighter 让小写字母排列更紧凑好看 -->
              <h1 class="text-7xl md:text-8xl font-black netflix-red mb-2 drop-shadow-2xl tracking-tighter">emos</h1>
              <h2 class="text-3xl md:text-5xl font-black mb-4 tracking-wider">海量影视，无界畅享。</h2>
              <p class="text-xl text-gray-300 font-light">私有云媒体智能代理节点已就绪。</p>
          </header>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <!-- 智能测速卡片 -->
              <div class="nf-card flex flex-col justify-center items-center py-8">
                  <span class="text-gray-400 text-sm mb-2 uppercase tracking-widest border-b border-gray-700 pb-1">当前网络延迟</span>
                  <div class="flex items-baseline mt-2 mb-2">
                      <span class="text-6xl font-bold ${pingColor}">${pingMs}</span>
                      <span class="text-xl text-gray-500 ml-1">ms</span>
                  </div>
                  <span class="text-xs font-bold px-3 py-1 rounded-full ${networkBadgeColor} tracking-widest mt-2 shadow-lg">
                      ${networkStatusText}
                  </span>
              </div>

              <!-- 连接详情卡片 -->
              <div class="nf-card flex flex-col justify-center">
                  <h3 class="text-lg font-bold mb-4 border-b border-gray-700 pb-2 text-gray-200">连接详情</h3>
                  <div class="space-y-4 text-sm">
                      <div class="flex justify-between items-center text-gray-400">
                          <span>边缘节点</span>
                          <span class="text-white font-medium bg-white/10 px-2 py-0.5 rounded">${colo}</span>
                      </div>
                      <div class="flex justify-between items-center text-gray-400">
                          <span>网络归属</span>
                          <span class="text-white font-medium">${city}, ${country}</span>
                      </div>
                      <div class="flex flex-col mt-2">
                          <span class="text-gray-400 mb-1">访问 IP</span>
                          <span class="font-mono text-cyan-400 bg-black/50 p-2 rounded-lg border border-gray-800 text-center tracking-widest">${clientIP}</span>
                      </div>
                  </div>
              </div>

              <!-- 系统状态卡片 -->
              <div class="nf-card flex flex-col justify-center">
                  <h3 class="text-lg font-bold mb-4 border-b border-gray-700 pb-2 text-gray-200">运行参数</h3>
                  <div class="space-y-4 text-sm mt-1">
                      <div class="flex justify-between items-center text-gray-300">
                          <span>服务引擎</span>
                          <span class="text-green-500 font-bold flex items-center"><span class="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>正常运作</span>
                      </div>
                      <div class="flex justify-between items-center text-gray-300">
                          <span>授权身份</span>
                          <span class="text-white bg-netflix-red px-2 py-0.5 rounded font-bold tracking-wider">${PROXY_NAME}</span>
                      </div>
                      <div class="flex justify-between items-center text-gray-300">
                          <span>智能聚合</span>
                          <span class="text-cyan-400 border border-cyan-800 bg-cyan-900/30 px-2 py-0.5 rounded font-bold text-xs tracking-widest">ACTIVE</span>
                      </div>
                  </div>
              </div>
          </div>

          <!-- 浅绿色透明提示横幅 -->
          <div class="mt-8 border border-green-500/30 bg-green-900/30 text-green-100 p-5 rounded-2xl flex items-start backdrop-blur-md shadow-lg">
              <svg class="w-6 h-6 mr-3 flex-shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              <div class="text-sm">
                  <p class="font-bold mb-1 tracking-wider text-green-300">网络环境自动识别</p>
                  <p class="opacity-90 leading-relaxed">系统已自动识别您当前的网络状态。如需最佳推流解码体验，建议您切换至本地直连网络（关闭代理）进行观影。</p>
              </div>
          </div>

          <!-- 页脚 -->
          <footer class="mt-16 text-center border-t border-gray-800 pt-8 pb-4 flex flex-col items-center">
              
              <!-- 官方 Wiki 链接按钮 -->
              <a href="https://wiki.emos.best/" target="_blank" class="mb-6 group flex items-center justify-center space-x-2 bg-gray-800/50 hover:bg-gray-700/80 border border-gray-700 hover:border-gray-500 transition-all duration-300 rounded-full px-5 py-2 backdrop-blur-sm cursor-pointer shadow-lg hover:shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                  <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477-4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                  </svg>
                  <span class="text-sm font-bold text-gray-300 group-hover:text-white transition-colors tracking-widest">emos 官方 Wiki</span>
              </a>

              <p class="text-xs text-gray-600 mb-2 tracking-widest uppercase">基于 Cloudflare 边缘计算强力驱动</p>
              <p class="text-xs text-gray-500 tracking-wider">Node Maintainer: <span class="text-gray-400 font-bold">${PROXY_NAME}</span> &copy; ${currentYear}</p>
          </footer>
      </div>
  </body>
  </html>
  `;

  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}
