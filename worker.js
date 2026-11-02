const CORS = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
"Access-Control-Allow-Headers": "Content-Type,X-Admin-Secret"
};

const json = (data, status = 200) =>
new Response(JSON.stringify(data), {
status,
headers: {
"Content-Type": "application/json; charset=utf-8",
...CORS
}
});

const fail = (message, status = 400) => json({ error: message }, status);
const clean = v => String(v ?? "").trim();

const validClass = n =>
Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 5;

const classLabel = n =>
["", "یەکەم", "دووەم", "سێیەم", "چوارەم", "پێنجەم"][Number(n)] || "";

const escapeHtml = s =>
String(s ?? "").replace(/[&<>"']/g, c => ({
"&": "&",
"<": "<",
">": ">",
'"': """,
"'": "'"
})[c]);

function supaHeaders(env, extra = {}) {
return {
"apikey": env.SUPABASE_SERVICE_ROLE_KEY,
"Authorization": Bearer ${env.SUPABASE_SERVICE_ROLE_KEY},
...extra
};
}

async function db(env, table, query = "", options = {}) {
const base = String(env.SUPABASE_URL).replace(//+$/, "");
const url = ${base}/rest/v1/${table}${query ? "?" + query : ""};

const response = await fetch(url, {
method: options.method || "GET",
headers: supaHeaders(env, {
"Content-Type": "application/json",
...(options.headers || {})
}),
body: options.body === undefined
? undefined
: JSON.stringify(options.body)
});

const text = await response.text();
let data = null;

try {
data = text ? JSON.parse(text) : null;
} catch {}

if (!response.ok) {
throw new Error(
data?.message ||
data?.error ||
text ||
Supabase error ${response.status}
);
}

return data;
}

async function telegram(env, method, payload) {
if (!env.BOT_TOKEN) return null;

return fetch(
https://api.telegram.org/bot${env.BOT_TOKEN}/${method},
{
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload)
}
);
}

async function sendText(env, chat_id, text, extra = {}) {
return telegram(env, "sendMessage", {
chat_id,
text,
parse_mode: "HTML",
...extra
});
}

function keyboard(rows) {
return { inline_keyboard: rows };
}

async function admin(req, env) {
return !!env.ADMIN_SECRET &&
req.headers.get("X-Admin-Secret") === env.ADMIN_SECRET;
}

async function readJson(req) {
try {
return await req.json();
} catch {
return null;
}
}

async function uploadStorage(env, path, file) {
const base = String(env.SUPABASE_URL).replace(//+$/, "");

const response = await fetch(
${base}/storage/v1/object/academy-pdfs/${path},
{
method: "POST",
headers: supaHeaders(env, {
"Content-Type": "application/pdf",
"x-upsert": "false"
}),
body: await file.arrayBuffer()
}
);

if (!response.ok) {
throw new Error("PDF upload failed: " + await response.text());
}
}

async function deleteStorage(env, path) {
const base = String(env.SUPABASE_URL).replace(//+$/, "");

await fetch(
${base}/storage/v1/object/academy-pdfs/${path},
{
method: "DELETE",
headers: supaHeaders(env)
}
);
}

// Telegram webhook
async function webhook(req, env) {
const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

if (!env.WEBHOOK_SECRET || secret !== env.WEBHOOK_SECRET) {
return new Response("Unauthorized", { status: 401 });
}

const update = await readJson(req);
if (!update) return new Response("OK");

const msg = update.message;

if (msg?.text) {
const chat = msg.chat.id;
const user = msg.from?.id;
const text = clean(msg.text);

await db(env, "students", "on_conflict=telegram_id", {  
  method: "POST",  
  headers: { "Prefer": "resolution=merge-duplicates" },  
  body: {  
    telegram_id: String(user),  
    chat_id: String(chat)  
  }  
});  

if (text === "/start" || text.startsWith("/start ")) {  
  await sendText(  
    env,  
    chat,  
    "بەخێربێیت بۆ <b>پەیمانگای وەرزشی شەقڵاوە</b> 🌟\nتکایە پۆلەکەت هەڵبژێرە:",  
    {  
      reply_markup: keyboard([  
        [1, 2, 3, 4, 5].map(n => ({  
          text: `پۆلی ${classLabel(n)}`,  
          callback_data: `class:${n}`  
        }))  
      ])  
    }  
  );  

} else if (text.startsWith("/help")) {  
  await sendText(  
    env,  
    chat,  
    "فەرمانەکان:\n/start - دەستپێکردن\n/class - گۆڕینی پۆل\n/lessons - بینینی وانەکان\n/pdfs - مەلزەمەکان\n/quiz - تاقیکردنەوە"  
  );  

} else if (text === "/class") {  
  await sendText(  
    env,  
    chat,  
    "پۆلەکەت هەڵبژێرە:",  
    {  
      reply_markup: keyboard([  
        [1, 2, 3, 4, 5].map(n => ({  
          text: `پۆلی ${classLabel(n)}`,  
          callback_data: `class:${n}`  
        }))  
      ])  
    }  
  );  

} else if (["/lessons", "/pdfs", "/quiz"].includes(text)) {  
  const students = await db(  
    env,  
    "students",  
    `select=class_no&telegram_id=eq.${encodeURIComponent(String(user))}&limit=1`  
  );  

  const st = students?.[0];  

  if (!st?.class_no) {  
    await sendText(env, chat, "سەرەتا /start بنووسە و پۆلەکەت هەڵبژێرە.");  

  } else if (text === "/lessons") {  
    const rows = await db(  
      env,  
      "lessons",  
      `select=id,title,body&class_no=eq.${st.class_no}&order=id.desc&limit=20`  
    );  

    await sendText(  
      env,  
      chat,  
      rows.length  
        ? rows.map((x, i) =>  
            `<b>${i + 1}. ${escapeHtml(x.title)}</b>\n${escapeHtml(x.body).slice(0, 1800)}`  
          ).join("\n\n")  
        : "هێشتا وانەیەک بۆ پۆلەکەت نییە."  
    );  

  } else if (text === "/pdfs") {  
    const rows = await db(  
      env,  
      "pdfs",  
      `select=id,title&class_no=eq.${st.class_no}&order=id.desc&limit=15`  
    );  

    await sendText(  
      env,  
      chat,  
      rows.length  
        ? "مەلزەمەکان:\n" + rows.map(x =>  
            `• ${escapeHtml(x.title)}\n${env.PUBLIC_API_URL}/api/files/${x.id}`  
          ).join("\n\n")  
        : "مەلزەمەیەک نییە."  
    );  

  } else {  
    const rows = await db(  
      env,  
      "quizzes",  
      `select=id,title&class_no=eq.${st.class_no}&order=id.desc&limit=1`  
    );  

    await sendText(  
      env,  
      chat,  
      rows.length  
        ? `تاقیکردنەوەی <b>${escapeHtml(rows[0].title)}</b> لە وێبسایت بەردەستە.`  
        : "تاقیکردنەوە بۆ پۆلەکەت ئامادە نییە."  
    );  
  }  

} else {  
  await sendText(  
    env,  
    chat,  
    "بۆ بینینی بەشەکان /start بنووسە. بۆ یارمەتی /help"  
  );  
}

}

const cb = update.callback_query;

if (cb) {
const chat = cb.message.chat.id;
const user = cb.from.id;
const data = clean(cb.data);

if (data.startsWith("class:")) {  
  const n = Number(data.split(":")[1]);  

  if (validClass(n)) {  
    await db(env, "students", "on_conflict=telegram_id", {  
      method: "POST",  
      headers: { "Prefer": "resolution=merge-duplicates" },  
      body: {  
        telegram_id: String(user),  
        chat_id: String(chat),  
        class_no: n  
      }  
    });  

    await sendText(  
      env,  
      chat,  
      `پۆلی ${classLabel(n)} هەڵبژێردرا. ئێستا دەتوانیت ئەم بەشانە بەکاربهێنیت:`,  
      {  
        reply_markup: keyboard([  
          [  
            { text: "📚 وانەکان", callback_data: "menu:lessons" },  
            { text: "📄 مەلزەمەکان", callback_data: "menu:pdfs" }  
          ],  
          [  
            { text: "📝 تاقیکردنەوە", callback_data: "menu:quiz" }  
          ]  
        ])  
      }  
    );  
  }  

} else if (data.startsWith("menu:")) {  
  const kind = data.split(":")[1];  

  const students = await db(  
    env,  
    "students",  
    `select=class_no&telegram_id=eq.${encodeURIComponent(String(user))}&limit=1`  
  );  

  const st = students?.[0];  

  if (st?.class_no && kind === "lessons") {  
    const rows = await db(  
      env,  
      "lessons",  
      `select=title,body&class_no=eq.${st.class_no}&order=id.desc&limit=15`  
    );  

    await sendText(  
      env,  
      chat,  
      rows.length  
        ? rows.map(x =>  
            `<b>${escapeHtml(x.title)}</b>\n${escapeHtml(x.body).slice(0, 1500)}`  
          ).join("\n\n")  
        : "وانە نییە."  
    );  

  } else if (st?.class_no && kind === "pdfs") {  
    const rows = await db(  
      env,  
      "pdfs",  
      `select=id,title&class_no=eq.${st.class_no}&order=id.desc&limit=15`  
    );  

    await sendText(  
      env,  
      chat,  
      rows.length  
        ? rows.map(x =>  
            `📄 ${escapeHtml(x.title)}\n${env.PUBLIC_API_URL}/api/files/${x.id}`  
          ).join("\n\n")  
        : "مەلزەمە نییە."  
    );  

  } else if (st?.class_no && kind === "quiz") {  
    const rows = await db(  
      env,  
      "quizzes",  
      `select=title&class_no=eq.${st.class_no}&order=id.desc&limit=1`  
    );  

    await sendText(  
      env,  
      chat,  
      rows.length  
        ? `تاقیکردنەوەی <b>${escapeHtml(rows[0].title)}</b> لە وێبسایت بەردەستە.`  
        : "تاقیکردنەوە بۆ ئەم پۆلە نییە."  
    );  

  } else {  
    await sendText(env, chat, "تکایە /start بنووسە.");  
  }  
}  

await telegram(env, "answerCallbackQuery", {  
  callback_query_id: cb.id  
});

}

return new Response("OK");
}

// API
async function handleApi(req, env, url) {
const path = url.pathname
.replace(/^/api(?=/|$)/, "")
.replace(//+$/, "") || "/";

const method = req.method;

if (method === "OPTIONS") {
return new Response(null, { headers: CORS });
}

if (path === "/health" && method === "GET") {
return json({
ok: true,
service: "shaqlawa-academy",
time: Date.now()
});
}

if (path === "/webhook" && method === "POST") {
return webhook(req, env);
}

// Lessons
if (path === "/lessons" && method === "GET") {
const c = url.searchParams.get("class");

if (c && !validClass(c)) return fail("پۆل هەڵەیە");  

const rows = await db(  
  env,  
  "lessons",  
  `select=id,class_no,title,body,created_at${c ? `&class_no=eq.${Number(c)}` : ""}&order=id.desc&limit=100`  
);  

return json({ items: rows });

}

// PDFs
if (path === "/pdfs" && method === "GET") {
const c = url.searchParams.get("class");

if (c && !validClass(c)) return fail("پۆل هەڵەیە");  

const rows = await db(  
  env,  
  "pdfs",  
  `select=id,class_no,title,created_at${c ? `&class_no=eq.${Number(c)}` : ""}&order=id.desc&limit=100`  
);  

return json({ items: rows });

}

// Questions
if (path === "/questions" && method === "GET") {
const rows = await db(
env,
"questions",
"select=id,name,question,answer,created_at&status=eq.published&order=id.desc&limit=100"
);

return json({ items: rows });

}

if (path === "/questions" && method === "POST") {
const d = await readJson(req);

if (!d || clean(d.question).length < 3 || clean(d.question).length > 3000) {  
  return fail("پرسیار بنووسە (٣ تا ٣٠٠٠ پیت).");  
}  

await db(env, "questions", "", {  
  method: "POST",  
  headers: { "Prefer": "return=minimal" },  
  body: {  
    name: clean(d.name).slice(0, 80),  
    question: clean(d.question),  
    status: "published"  
  }  
});  

return json({ ok: true }, 201);

}

// Quizzes
if (path === "/quizzes" && method === "GET") {
const c = url.searchParams.get("class");

if (!validClass(c)) return fail("پۆل دیاری بکە.");  

const rows = await db(  
  env,  
  "quizzes",  
  `select=id,class_no,title,questions_json&class_no=eq.${Number(c)}&order=id.desc`  
);  

return json({  
  items: rows.map(x => ({  
    id: x.id,  
    class_no: x.class_no,  
    title: x.title,  
    questions: x.questions_json  
  }))  
});

}

// PDF download
if (path.startsWith("/files/") && method === "GET") {
const id = path.split("/")[2];

if (!/^\d+$/.test(id)) {  
  return fail("فایل نەدۆزرایەوە.", 404);  
}  

const rows = await db(  
  env,  
  "pdfs",  
  `select=storage_path,title&id=eq.${id}&limit=1`  
);  

const row = rows?.[0];  

if (!row) return fail("فایل نەدۆزرایەوە.", 404);  

const storagePath = String(row.storage_path)  
  .split("/")  
  .map(encodeURIComponent)  
  .join("/");  

const base = String(env.SUPABASE_URL).replace(/\/+$/, "");  

const response = await fetch(  
  `${base}/storage/v1/object/academy-pdfs/${storagePath}`,  
  {  
    headers: supaHeaders(env)  
  }  
);  

if (!response.ok) {  
  return fail("فایل نەدۆزرایەوە.", 404);  
}  

const headers = new Headers(CORS);  

headers.set("Content-Type", "application/pdf");  
headers.set(  
  "Content-Disposition",  
  `inline; filename*=UTF-8''${encodeURIComponent(row.title + ".pdf")}`  
);  
headers.set("Cache-Control", "private, max-age=3600");  

return new Response(response.body, { headers });

}

// Admin check
if (path === "/admin/check" && method === "GET") {
return await admin(req, env)
? json({ ok: true })
: fail("دەسەڵات نییە.", 401);
}

// Admin routes
if (path.startsWith("/admin/")) {
if (!await admin(req, env)) {
return fail("دەسەڵات نییە.", 401);
}

// Add lesson  
if (path === "/admin/lessons" && method === "POST") {  
  const d = await readJson(req);  

  if (!d || !validClass(d.class_no) || !clean(d.title) || !clean(d.body)) {  
    return fail("پۆل و ناونیشان و ناوەڕۆک پێویستن.");  
  }  

  await db(env, "lessons", "", {  
    method: "POST",  
    headers: { "Prefer": "return=minimal" },  
    body: {  
      class_no: Number(d.class_no),  
      title: clean(d.title).slice(0, 180),  
      body: clean(d.body)  
    }  
  });  

  return json({ ok: true }, 201);  
}  

// Upload PDF  
if (path === "/admin/pdfs" && method === "POST") {  
  const form = await req.formData();  

  const file = form.get("file");  
  const title = clean(form.get("title"));  
  const c = form.get("class_no");  

  if (!validClass(c) || !title || !file || typeof file.arrayBuffer !== "function") {  
    return fail("پۆل، ناونیشان و PDF پێویستن.");  
  }  

  if (file.type !== "application/pdf" || file.size > 25 * 1024 * 1024) {  
    return fail("تەنها PDF تا ٢٥ مێگابایت ڕێگەپێدراوە.");  
  }  

  const storagePath = `pdf/${crypto.randomUUID()}.pdf`;  

  await uploadStorage(env, storagePath, file);  

  try {  
    await db(env, "pdfs", "", {  
      method: "POST",  
      headers: { "Prefer": "return=minimal" },  
      body: {  
        class_no: Number(c),  
        title: title.slice(0, 180),  
        storage_path: storagePath  
      }  
    });  
  } catch (e) {  
    await deleteStorage(env, storagePath);  
    throw e;  
  }  

  return json({ ok: true }, 201);  
}  

// Add quiz  
if (path === "/admin/quizzes" && method === "POST") {  
  const d = await readJson(req);  

  if (  
    !d ||  
    !validClass(d.class_no) ||  
    !clean(d.title) ||  
    !Array.isArray(d.questions) ||  
    d.questions.length < 1 ||  
    d.questions.length > 100  
  ) {  
    return fail("داتای تاقیکردنەوە تەواو نییە.");  
  }  

  for (const q of d.questions) {  
    if (  
      !clean(q.question) ||  
      !Array.isArray(q.options) ||  
      q.options.length < 2 ||  
      q.options.length > 6 ||  
      !Number.isInteger(q.answer) ||  
      q.answer < 0 ||  
      q.answer >= q.options.length  
    ) {  
      return fail("فۆرماتی پرسیارەکان هەڵەیە.");  
    }  
  }  

  await db(env, "quizzes", "", {  
    method: "POST",  
    headers: { "Prefer": "return=minimal" },  
    body: {  
      class_no: Number(d.class_no),  
      title: clean(d.title).slice(0, 180),  
      questions_json: d.questions  
    }  
  });  

  return json({ ok: true }, 201);  
}  

// Student questions  
if (path === "/admin/questions" && method === "GET") {  
  const rows = await db(  
    env,  
    "questions",  
    "select=id,name,question,answer,created_at&order=id.desc&limit=100"  
  );  

  return json({ items: rows });  
}  

const qm = path.match(/^\/admin\/questions\/(\d+)$/);  

if (qm && method === "PATCH") {  
  const d = await readJson(req);  

  if (!d || typeof d.answer !== "string" || d.answer.length > 3000) {  
    return fail("وەڵام هەڵەیە.");  
  }  

  await db(env, "questions", `id=eq.${qm[1]}`, {  
    method: "PATCH",  
    headers: { "Prefer": "return=minimal" },  
    body: { answer: clean(d.answer) }  
  });  

  return json({ ok: true });  
}  

if (qm && method === "DELETE") {  
  await db(env, "questions", `id=eq.${qm[1]}`, {  
    method: "DELETE",  
    headers: { "Prefer": "return=minimal" }  
  });  

  return json({ ok: true });  
}  

return fail("ڕێڕەو نەدۆزرایەوە.", 404);

}

return fail("API نەدۆزرایەوە.", 404);
}

// Main Worker
export default {
async fetch(req, env) {
try {
const url = new URL(req.url);

if (req.method === "OPTIONS") {  
    return new Response(null, { headers: CORS });  
  }  

  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {  
    return json({  
      error: "API path not found.",  
      path: url.pathname  
    }, 404);  
  }  

  // Health check: ئەمە پێش پشکنینی Supabase ـە  
  if (url.pathname === "/api/health" && req.method === "GET") {  
    return json({  
      service: "shaqlawa-academy",  
      supabase_url: !!env.SUPABASE_URL,  
      supabase_key: !!env.SUPABASE_SERVICE_ROLE_KEY,  
      bot_token: !!env.BOT_TOKEN,  
      webhook_secret: !!env.WEBHOOK_SECRET  
    });  
  }  

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {  
    return json({  
      error: "Supabase settings are missing.",  
      supabase_url: !!env.SUPABASE_URL,  
      supabase_key: !!env.SUPABASE_SERVICE_ROLE_KEY  
    }, 500);  
  }  

  return await handleApi(req, env, url);  

} catch (e) {  
  return json({  
    error: "هەڵەی ناوخۆیی سێرڤەر.",  
    detail: env.ENVIRONMENT === "development"  
      ? String(e)  
      : undefined  
  }, 500);  
}

}
};
