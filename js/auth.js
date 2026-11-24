(function () {
    const client = window.curatorSupabase;
    const isLoginPage = /(^|\/)login\.html$/.test(location.pathname);
    if (!client) return;

    const showStatus = message => {
        const status = document.getElementById('authStatus');
        if (status) status.textContent = message;
    };

    if (!isLoginPage) {
        document.documentElement.classList.add('auth-loading');
        window.CURATOR_AUTH_READY = (async () => {
            const { data: { session }, error } = await client.auth.getSession();
            if (error || !session) {
                location.replace('login.html');
                return null;
            }
            const { data: membership, error: membershipError } = await client
                .from('team_members')
                .select('team_id, role, teams(id, name)')
                .eq('user_id', session.user.id)
                .limit(1)
                .maybeSingle();
            if (membershipError || !membership) {
                location.replace('login.html?team=missing');
                return null;
            }
            window.CURATOR_USER = session.user;
            window.CURATOR_TEAM = membership.teams;
            window.CURATOR_ROLE = membership.role;
            document.documentElement.classList.remove('auth-loading');
            return { user: session.user, team: membership.teams, role: membership.role };
        })();
    }

    if (isLoginPage) document.addEventListener('DOMContentLoaded', async () => {
        const params = new URLSearchParams(location.search);
        const authParams = new URLSearchParams(location.hash.slice(1));
        const authError = authParams.get('error_code') || params.get('error_code');
        if (authError === 'otp_expired') {
            showStatus('認証リンクの有効期限が切れているか、すでに使用されています。新しいパスワード再設定メールを送ってください。');
        } else if (authParams.has('error')) {
            showStatus('認証リンクを確認できませんでした。新しい認証メールを送ってください。');
        }
        if (params.get('team') === 'missing') {
            showStatus('アカウントにチームが登録されていません。管理者に招待状態を確認してもらってください。');
        }

        const { data: { session } } = await client.auth.getSession();
        const isInvite = ['invite', 'recovery'].includes(authParams.get('type')) ||
            ['invite', 'recovery'].includes(params.get('type'));
        if (session && isInvite) {
            document.getElementById('loginForm').hidden = true;
            document.getElementById('invitePasswordForm').hidden = false;
            showStatus('招待を確認しました。パスワードを設定してください。');
        }

        const loginForm = document.getElementById('loginForm');
        const passwordLogin = loginForm.querySelector('button[type="submit"]');
        const demoLogin = document.getElementById('btnDemoLogin');
        const setLoginBusy = busy => {
            passwordLogin.disabled = busy;
            demoLogin.disabled = busy;
        };
        if (!loginForm.hidden) demoLogin.disabled = false;
        demoLogin.addEventListener('click', async () => {
            setLoginBusy(true);
            showStatus('デモにログインしています…');
            try {
                const { data, error } = await client.functions.invoke('demo-login', { method: 'POST' });
                if (error || !data?.access_token || !data?.refresh_token) {
                    const unavailable = [404, 503].includes(error?.context?.status);
                    showStatus(unavailable ? 'デモログインは準備中です。' : 'デモにログインできませんでした。時間をおいて再試行してください。');
                    return;
                }
                const { error: sessionError } = await client.auth.setSession(data);
                if (sessionError) throw sessionError;
                location.replace('editor.html');
            } catch {
                showStatus('デモにログインできませんでした。時間をおいて再試行してください。');
            } finally {
                setLoginBusy(false);
            }
        });

        loginForm.addEventListener('submit', async event => {
            event.preventDefault();
            if (passwordLogin.disabled) return;
            setLoginBusy(true);
            showStatus('ログインしています…');
            const { error } = await client.auth.signInWithPassword({
                email: document.getElementById('loginEmail').value.trim(),
                password: document.getElementById('loginPassword').value
            });
            if (error) {
                showStatus('ログインできませんでした。メールアドレスとパスワードを確認してください。');
                setLoginBusy(false);
                return;
            }
            location.replace('editor.html');
        });

        document.getElementById('invitePasswordForm')?.addEventListener('submit', async event => {
            event.preventDefault();
            const password = document.getElementById('invitePassword').value;
            if (password !== document.getElementById('invitePasswordConfirm').value) {
                showStatus('2つのパスワードが一致しません。');
                return;
            }
            const { error } = await client.auth.updateUser({ password });
            if (error) {
                showStatus('パスワードを設定できませんでした。8文字以上で入力してください。');
                return;
            }
            location.replace('editor.html');
        });
    });

    if (!isLoginPage) {
        window.applyCuratorRoleRestrictions = () => {
            if (window.CURATOR_ROLE === 'guest') {
                document.querySelectorAll('[data-tool="setup"], #btnToggleAdminMode, [data-tool-panel="setup"], #teamInviteFields').forEach(control => {
                    control.hidden = true;
                    if ('disabled' in control) control.disabled = true;
                });
            }
            if (window.CURATOR_ROLE !== 'viewer') return;
            document.body.classList.add('viewer-mode');
            document.querySelectorAll('.sidebar input, .sidebar textarea, .sidebar button, .sidebar select').forEach(control => {
                if (['floorWallListSelect', 'wallListSelect', 'savedExhibitions', 'layoutVariants', 'lightingVisibility', 'workspaceScaleVisibility', 'workspaceGridVisible', 'workspaceGridSpacing', 'lightObjectSelect', 'movableWallFaceVisibility', 'perspectiveEyeHeight', 'btnPickPerspective', 'btnCloseOperationPanel'].includes(control.id) || control.id === 'btnLoadExhibition') return;
                control.disabled = true;
            });
            document.querySelectorAll('.tool-icon').forEach(control => {
                control.disabled = !['walls', 'info', 'data', 'team', 'crowd', 'lighting', 'movable-walls', 'perspective'].includes(control.dataset.tool);
                if (control.dataset.action) control.disabled = !['floor', 'wall', 'light-visibility', 'crowd-visibility'].includes(control.dataset.action);
            });
            if (typeof canvas !== 'undefined') {
                canvas.selection = false;
                canvas.discardActiveObject();
                canvas.getObjects().forEach(object => {
                    object.selectable = false;
                    object.lockMovementX = true;
                    object.lockMovementY = true;
                    object.lockRotation = true;
                    object.evented = true;
                });
                canvas.requestRenderAll();
            }
        };

        document.addEventListener('DOMContentLoaded', () => {
            window.CURATOR_AUTH_READY?.then(context => {
                if (!context) return;
                const account = document.getElementById('accountLabel');
                const teamName = document.getElementById('teamNameLabel');
                const roleLabel = document.getElementById('teamRoleLabel');
                const inviteFields = document.getElementById('teamInviteFields');
                const roleNames = { owner: '管理者', editor: '編集者', viewer: '閲覧者', guest: 'ゲスト' };
                if (account) account.textContent = `${context.user.email} · ${roleNames[context.role] || context.role}`;
                if (teamName) teamName.textContent = `展覧会チーム：${context.team?.name || 'チーム'}`;
                if (roleLabel) roleLabel.textContent = `あなたの権限：${roleNames[context.role] || context.role}`;
                if (inviteFields) inviteFields.hidden = context.role !== 'owner';
                window.applyCuratorRoleRestrictions();
                if (typeof refreshExhibitionList === 'function') refreshExhibitionList();
            });
            window.CURATOR_AUTH_READY?.then(() => window.applyCuratorRoleRestrictions?.());
            document.getElementById('btnLogout')?.addEventListener('click', async () => {
                await client.auth.signOut({ scope: window.CURATOR_ROLE === 'guest' ? 'local' : 'global' });
                location.replace('login.html');
            });
            document.getElementById('btnInviteMember')?.addEventListener('click', async event => {
                if (window.CURATOR_ROLE !== 'owner') return;
                const button = event.currentTarget;
                const emailInput = document.getElementById('inviteMemberEmail');
                const roleInput = document.getElementById('inviteMemberRole');
                const status = document.getElementById('teamInviteStatus');
                const email = emailInput.value.trim();
                if (!email) {
                    status.textContent = '招待するメールアドレスを入力してください。';
                    return;
                }
                button.disabled = true;
                status.textContent = '招待を送信しています…';
                try {
                    const { data, error } = await client.functions.invoke('invite-member', {
                        body: { email, role: roleInput.value, teamId: window.CURATOR_TEAM.id }
                    });
                    if (error) {
                        let message = '';
                        try { message = (await error.context?.json())?.error; } catch {}
                        console.error('チーム招待に失敗しました:', error);
                        status.textContent = message || '招待を送信できませんでした。Edge Functionの設定を確認してください。';
                        return;
                    }
                    emailInput.value = '';
                    status.textContent = data?.existingAccount
                        ? '既存アカウントをゲストとして追加しました。通常のログイン画面から利用できます。'
                        : '招待メールを送信しました。';
                } finally {
                    button.disabled = false;
                }
            });
        });
    }
})();
