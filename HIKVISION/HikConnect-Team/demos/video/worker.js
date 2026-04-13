/**
 * Cloudflare Worker — HikConnect OpenAPI Demo
 *
 * Sirve los archivos estáticos del demo y actúa como proxy
 * hacia los servidores de HikConnect para resolver restricciones CORS.
 *
 * Despliegue:
 *   npx wrangler deploy
 */

const ALLOWED_DOMAINS = [
    'hikcentralconnect.com',
    'hikcentralconnectru.com',
    'ezvizlife.com',
];

function isAllowedUrl(url) {
    try {
        const { hostname } = new URL(url);
        return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

async function handleProxy(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ message: 'Body JSON inválido' }, { status: 400 });
    }

    const { url, method = 'POST', headers = {}, body: reqBody } = body;

    if (!url) {
        return Response.json({ message: 'Falta el parámetro url' }, { status: 400 });
    }

    if (!isAllowedUrl(url)) {
        try {
            return Response.json(
                { message: `Dominio no permitido: ${new URL(url).hostname}` },
                { status: 403 }
            );
        } catch {
            return Response.json({ message: 'URL inválida' }, { status: 400 });
        }
    }

    const upstreamMethod = method.toUpperCase();
    const upstreamBody = reqBody && upstreamMethod !== 'GET'
        ? JSON.stringify(reqBody)
        : undefined;

    const upstreamHeaders = new Headers({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
    });

    // Eliminar headers que Cloudflare no permite reenviar
    upstreamHeaders.delete('host');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const upstream = await fetch(url, {
            method: upstreamMethod,
            headers: upstreamHeaders,
            body: upstreamBody,
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const text = await upstream.text();
        try {
            return Response.json(JSON.parse(text), { status: upstream.status });
        } catch {
            return new Response(text, {
                status: upstream.status,
                headers: { 'Content-Type': 'text/plain' },
            });
        }
    } catch (e) {
        clearTimeout(timeout);
        if (e.name === 'AbortError') {
            return Response.json({ message: 'Tiempo de espera agotado (20 s)' }, { status: 504 });
        }
        return Response.json({ message: `Error de proxy: ${e.message}` }, { status: 502 });
    }
}

export default {
    async fetch(request, env) {
        const { pathname, method } = new URL(request.url);

        if (pathname === '/proxy' && method === 'POST') {
            return handleProxy(request);
        }

        // Archivos estáticos servidos por Workers Assets
        return env.ASSETS.fetch(request);
    },
};
