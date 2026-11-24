// サーバー側に設定したゲストアカウントでログインし、確認した認証セッションをブラウザーへ返します。
import { createClient } from 'npm:@supabase/supabase-js@2';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store'
};
const auth = { persistSession: false, autoRefreshToken: false };

Deno.serve(async request => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

    // Credentials come exclusively from the function's secrets.
    const email = Deno.env.get('DEMO_GUEST_EMAIL')?.trim();
    const password = Deno.env.get('DEMO_GUEST_PASSWORD');
    const url = Deno.env.get('SUPABASE_URL');
    if (!email || !password || !url) return unavailable();

    try {
        const publishableKey = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}').default;
        const secretKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
        if (!publishableKey || !secretKey) return unavailable();

        const client = createClient(url, publishableKey, { auth });
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error?.status === 429) return reply({ error: 'Try again later' }, 429);
        if (error || !data.session || !data.user?.email_confirmed_at) return unavailable();

        const admin = createClient(url, secretKey, { auth });
        const { data: membership, error: membershipError } = await admin.from('team_members')
            .select('role')
            .eq('user_id', data.user.id)
            .maybeSingle();
        // Fail closed for users with no team, multiple teams, or an elevated role.
        if (membershipError || membership?.role !== 'guest') return unavailable();

        return reply({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
        });
    } catch {
        return unavailable();
    }
});

function unavailable() {
    return reply({ error: 'Demo login unavailable' }, 503);
}

function reply(body: Record<string, string>, status = 200) {
    return Response.json(body, { status, headers });
}
