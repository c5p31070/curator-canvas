import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

Deno.serve(async request => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

    const authorization = request.headers.get('Authorization') || '';
    const accessToken = authorization.replace(/^Bearer\s+/i, '');
    if (!accessToken) return reply({ error: 'ログインしてください。' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
    const secretKey = Deno.env.get('SUPABASE_SECRET_KEY')!;
    const userClient = createClient(url, publishableKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const adminClient = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !userData.user) return reply({ error: 'ログイン状態を確認できません。' }, 401);

    let payload: { email?: string; role?: string; teamId?: string };
    try { payload = await request.json(); }
    catch { return reply({ error: '入力内容を読み取れません。' }, 400); }

    const email = payload.email?.trim().toLowerCase();
    const role = payload.role === 'editor' ? 'editor' : payload.role === 'viewer' ? 'viewer' : null;
    const teamId = payload.teamId;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'メールアドレスを確認してください。' }, 400);
    if (!teamId || !role) return reply({ error: '招待内容が正しくありません。' }, 400);

    const { data: callerMembership, error: membershipError } = await userClient
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', userData.user.id)
        .maybeSingle();
    if (membershipError || callerMembership?.role !== 'owner') {
        return reply({ error: 'メンバーを招待する権限がありません。' }, 403);
    }

    const origin = request.headers.get('origin') || '';
    const redirectTo = origin ? `${origin}/login.html` : undefined;
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inviteError || !inviteData.user) return reply({ error: inviteError?.message || '招待を送信できませんでした。' }, 400);

    const { error: insertError } = await adminClient.from('team_members').upsert({
        team_id: teamId,
        user_id: inviteData.user.id,
        role
    });
    if (insertError) return reply({ error: '招待は送信されましたが、チーム権限を登録できませんでした。管理者に連絡してください。' }, 500);

    return reply({ ok: true });

    function reply(body: unknown, status = 200) {
        return new Response(JSON.stringify(body), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
