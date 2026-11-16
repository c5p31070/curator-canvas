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
    const publishableKeys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!);
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!);
    const publishableKey = publishableKeys.default;
    const secretKey = secretKeys.default;
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
    const { role } = payload;
    const teamId = payload.teamId;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'メールアドレスを確認してください。' }, 400);
    if (!teamId || (role !== 'editor' && role !== 'viewer' && role !== 'guest')) {
        return reply({ error: '招待内容が正しくありません。' }, 400);
    }

    const { data: callerMembership, error: membershipError } = await userClient
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', userData.user.id)
        .maybeSingle();
    if (membershipError || callerMembership?.role !== 'owner') {
        return reply({ error: 'メンバーを招待する権限がありません。' }, 403);
    }

    let userId: string | null = null;
    if (role === 'guest') {
        const { data, error } = await adminClient.rpc('find_confirmed_invite_user', { target_email: email });
        if (error) return reply({ error: 'ゲストアカウントを確認できません。ゲスト権限のSQL設定を確認してください。' }, 500);
        userId = data;
    }
    const existingAccount = Boolean(userId);
    if (!userId) {
        const origin = request.headers.get('origin') || '';
        const redirectTo = origin ? `${origin}/login.html` : undefined;
        const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });
        if (inviteError || !inviteData.user) return reply({ error: inviteError?.message || '招待を送信できませんでした。' }, 400);
        userId = inviteData.user.id;
    }

    const { error: insertError } = await adminClient.from('team_members').insert({
        team_id: teamId,
        user_id: userId,
        role
    });
    if (insertError?.code === '23505') return reply({ error: 'このアカウントはすでにチームに所属しています。現在の権限は保持されています。' }, 409);
    if (insertError) return reply({ error: 'チーム権限を登録できませんでした。管理者に連絡してください。' }, 500);

    return reply({ ok: true, existingAccount });

    function reply(body: unknown, status = 200) {
        return new Response(JSON.stringify(body), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
