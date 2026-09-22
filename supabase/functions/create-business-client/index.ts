import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

function safeText(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeUsername(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/[._-]{2,}/g, (match) => match.replace(/\./g, '.').replace(/-/g, '-').replace(/_/g, '_'))
    .replace(/^\.+|\.+$/g, '')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[create-business-client] missing bearer token', {
      hasAuthHeader: !!authHeader,
      method: req.method,
      origin: req.headers.get('origin')
    });
    return { user: null, error: 'Missing bearer token.' };
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { user: null, error: 'Supabase auth configuration is missing.' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    console.warn('[create-business-client] auth validation failed', {
      message: error?.message || 'Invalid session.',
      userId: user?.id || null
    });
    return { user: null, error: error?.message || 'Invalid session.' };
  }

  return { user, error: null };
}

async function getCurrentOwnerProfile(serviceRoleClient: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await serviceRoleClient
    .from('users')
    .select('id, business_id, role, name, email')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[create-business-client] owner lookup error', error.message);
    return { record: null, error: error.message };
  }

  return { record: data, error: null };
}

async function ensureUniqueEmail(serviceRoleClient: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await serviceRoleClient
    .from('users')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message || 'Unable to validate duplicate email.');
  }

  return !!data;
}

async function ensureUniqueUsername(serviceRoleClient: ReturnType<typeof createClient>, username: string) {
  const { data, error } = await serviceRoleClient
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw new Error(error.message || 'Unable to validate duplicate username.');
  }

  return !!data;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, message: 'Method not allowed.' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, {
      ok: false,
      message: 'Server-side Supabase configuration is missing.'
    });
  }

  let stage = 'start';
  try {
    stage = 'parse-body';
    const body = await req.json().catch(() => ({}));
    const firstName = safeText(body?.firstName);
    const lastName = safeText(body?.lastName);
    const email = safeText(body?.email).toLowerCase();
    const phone = safeText(body?.phone);
    const username = normalizeUsername(safeText(body?.username));
    const temporaryPassword = safeText(body?.temporaryPassword);
    const confirmTemporaryPassword = safeText(body?.confirmTemporaryPassword);

    stage = 'validate-input';
    if (!firstName || !email) {
      return jsonResponse(400, {
        ok: false,
        message: 'Client first name and email are required.'
      });
    }

    if (!isValidEmail(email)) {
      return jsonResponse(400, {
        ok: false,
        message: 'Client email must be a valid email address.'
      });
    }

    if (!username) {
      return jsonResponse(400, {
        ok: false,
        message: 'Client username is required.'
      });
    }

    if (username.length < 3) {
      return jsonResponse(400, {
        ok: false,
        message: 'Client username must be at least 3 characters long.'
      });
    }

    if (!temporaryPassword || temporaryPassword.length < 8) {
      return jsonResponse(400, {
        ok: false,
        message: 'Temporary password must be at least 8 characters long.'
      });
    }

    if (temporaryPassword.length > 72) {
      return jsonResponse(400, {
        ok: false,
        message: 'Temporary password must be between 8 and 72 characters long.'
      });
    }

    if (temporaryPassword !== confirmTemporaryPassword) {
      return jsonResponse(400, {
        ok: false,
        message: 'Temporary password and confirmation must match.'
      });
    }

    stage = 'auth-user';
    const authResult = await getAuthenticatedUser(req);
    if (!authResult.user) {
      console.warn('[create-business-client] unauthenticated request rejected', {
        reason: authResult.error || 'Your session is not valid for this action.'
      });
      return jsonResponse(401, {
        ok: false,
        message: authResult.error || 'Your session is not valid for this action.'
      });
    }

    stage = 'service-role-client';
    const serviceRoleClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    stage = 'owner-profile';
    const ownerProfile = await getCurrentOwnerProfile(serviceRoleClient, authResult.user.id);
    if (ownerProfile.error || !ownerProfile.record) {
      return jsonResponse(403, {
        ok: false,
        message: 'Your account is not linked to a valid business owner profile in public.users.'
      });
    }

    if (!Object.prototype.hasOwnProperty.call(ownerProfile.record, 'role') || !ownerProfile.record.role) {
      return jsonResponse(500, {
        ok: false,
        message: 'The live public.users record for this owner is missing the required role metadata.'
      });
    }

    const currentRole = safeText(ownerProfile.record.role).toLowerCase();
    if (currentRole !== 'owner') {
      return jsonResponse(403, {
        ok: false,
        message: 'Only a business owner can create client accounts for this business. Current role: ' + currentRole || 'unknown'
      });
    }

    if (!ownerProfile.record.business_id) {
      return jsonResponse(403, {
        ok: false,
        message: 'The current owner account is not assigned to a valid business.'
      });
    }

    const name = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim();

    stage = 'duplicate-check';
    const duplicateEmail = await ensureUniqueEmail(serviceRoleClient, email);
    if (duplicateEmail) {
      return jsonResponse(409, {
        ok: false,
        message: 'A user with that email already exists for this platform.'
      });
    }

    const duplicateUsername = await ensureUniqueUsername(serviceRoleClient, username);
    if (duplicateUsername) {
      return jsonResponse(409, {
        ok: false,
        message: 'That username is already in use. Please choose another.'
      });
    }

    stage = 'create-auth-user';
    console.warn('[create-business-client] creating auth user', {
      email,
      business_id: ownerProfile.record.business_id,
      name,
      stage
    });

    const authUser = await serviceRoleClient.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        username,
        business_id: ownerProfile.record.business_id,
        role: 'client',
        requires_password_change: true,
        needs_password_change: true
      },
      app_metadata: {
        business_id: ownerProfile.record.business_id,
        role: 'client',
        requires_password_change: true,
        needs_password_change: true
      }
    });

    if (authUser.error || !authUser.data?.user) {
      const errorInfo = authUser.error && typeof authUser.error === 'object' ? authUser.error : {};
      const status = typeof errorInfo.status === 'number' ? errorInfo.status : 400;
      const errorCode = typeof errorInfo.code === 'string' || typeof errorInfo.code === 'number' ? errorInfo.code : null;
      const errorMessage = typeof errorInfo.message === 'string' ? errorInfo.message : 'Supabase Auth account creation failed.';
      const errorName = typeof errorInfo.name === 'string' ? errorInfo.name : null;

      console.warn('[create-business-client] auth user creation failed', {
        stage,
        email,
        businessId: ownerProfile.record.business_id,
        status,
        error_code: errorCode,
        error_message: errorMessage,
        error_name: errorName
      });

      return jsonResponse(status, {
        ok: false,
        message: errorMessage,
        stage,
        error: {
          status,
          code: errorCode,
          message: errorMessage,
          name: errorName
        }
      });
    }

    stage = 'create-profile';
    console.warn('[create-business-client] creating public.users profile', {
      authUserId: authUser.data.user.id,
      business_id: ownerProfile.record.business_id,
      stage
    });

    const profileInsert = await serviceRoleClient
      .from('users')
      .insert({
        id: authUser.data.user.id,
        business_id: ownerProfile.record.business_id,
        role: 'client',
        name,
        email,
        username
      })
      .select('id, business_id, role, name, email, username')
      .single();

    if (profileInsert.error || !profileInsert.data) {
      console.error('[create-business-client] public.users insert failed', profileInsert.error?.message || 'Unknown insert error');
      try {
        await serviceRoleClient.auth.admin.deleteUser(authUser.data.user.id);
      } catch (cleanupError) {
        console.error('[create-business-client] auth cleanup failed after user insert error', cleanupError);
      }
      return jsonResponse(500, {
        ok: false,
        message: 'Client profile creation failed and the auth account was rolled back.'
      });
    }

    return jsonResponse(200, {
      ok: true,
      message: 'Client account created successfully.',
      businessId: ownerProfile.record.business_id,
      businessName: 'Current business',
      clientName: name,
      clientEmail: email,
      username,
      role: 'client',
      requiresPasswordChange: true
    });
  } catch (error) {
    console.error('[create-business-client] unexpected error', { stage, error });
    return jsonResponse(500, {
      ok: false,
      message: error instanceof Error ? error.message : 'Unexpected client creation failure.',
      stage,
      errorName: error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : null
    });
  }
});
