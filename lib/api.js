// lib/api.js — GitHub, Vercel, and Cloudflare API helpers.
// All tokens are read from the config object passed in — never hardcoded.

// ─────────────────────────────────────────────────────────────────────────────
// Shared fetch helper
// ─────────────────────────────────────────────────────────────────────────────

async function apiFetch(url, { method = 'GET', token, body, extraHeaders = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }

  if (!res.ok) {
    const detail = typeof data === 'object'
      ? (data.message || data.error?.message || data.errors?.[0]?.message || JSON.stringify(data))
      : text
    throw new Error(`${method} ${url} → ${res.status}: ${detail}`)
  }

  return data
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub
// ─────────────────────────────────────────────────────────────────────────────

export const github = {
  async createRepo(cfg, name) {
    return apiFetch('https://api.github.com/user/repos', {
      method: 'POST',
      token: cfg.github.token,
      extraHeaders: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'household-app-infrastructure' },
      body: {
        name,
        private: true,
        auto_init: false,
        description: `Household App Infrastructure: ${name}`,
      },
    })
  },

  async repoExists(cfg, name) {
    try {
      await apiFetch(`https://api.github.com/repos/${cfg.github.username}/${name}`, {
        token: cfg.github.token,
        extraHeaders: { 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'household-app-infrastructure' },
      })
      return true
    } catch {
      return false
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel
// ─────────────────────────────────────────────────────────────────────────────

export const vercel = {
  async createProject(cfg, { name, repoFullName, framework = 'vite' }) {
    const body = {
      name,
      framework,
      gitRepository: {
        type: 'github',
        repo: repoFullName,
      },
      publicSource: false,
      serverlessFunctionRegion: cfg.vercel_region,
    }
    const teamParam = cfg.vercel.team_id ? `?teamId=${cfg.vercel.team_id}` : ''
    return apiFetch(`https://api.vercel.com/v10/projects${teamParam}`, {
      method: 'POST',
      token: cfg.vercel.api_token,
      body,
    })
  },

  async addEnvVar(cfg, projectId, { key, value, target = ['production', 'preview', 'development'], type = 'encrypted' }) {
    const teamParam = cfg.vercel.team_id ? `?teamId=${cfg.vercel.team_id}` : ''
    return apiFetch(`https://api.vercel.com/v10/projects/${projectId}/env${teamParam}`, {
      method: 'POST',
      token: cfg.vercel.api_token,
      body: { key, value, target, type },
    })
  },

  async addDomain(cfg, projectId, domain) {
    const teamParam = cfg.vercel.team_id ? `?teamId=${cfg.vercel.team_id}` : ''
    return apiFetch(`https://api.vercel.com/v10/projects/${projectId}/domains${teamParam}`, {
      method: 'POST',
      token: cfg.vercel.api_token,
      body: { name: domain },
    })
  },

  async getLatestDeployment(cfg, projectId) {
    const teamParam = cfg.vercel.team_id ? `?teamId=${cfg.vercel.team_id}&limit=1` : '?limit=1'
    const data = await apiFetch(
      `https://api.vercel.com/v6/deployments${teamParam}&projectId=${projectId}`,
      { token: cfg.vercel.api_token }
    )
    return data.deployments?.[0] || null
  },

  async getDeployment(cfg, deploymentId) {
    return apiFetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      token: cfg.vercel.api_token,
    })
  },

  async getProjectByName(cfg, name) {
    try {
      const teamParam = cfg.vercel.team_id ? `?teamId=${cfg.vercel.team_id}` : ''
      return await apiFetch(`https://api.vercel.com/v10/projects/${name}${teamParam}`, {
        token: cfg.vercel.api_token,
      })
    } catch {
      return null
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare
// ─────────────────────────────────────────────────────────────────────────────

const CF_BASE = 'https://api.cloudflare.com/client/v4'

async function cfFetch(path, cfg, { method = 'GET', body } = {}) {
  const res = await apiFetch(`${CF_BASE}${path}`, {
    method,
    token: cfg.cloudflare.api_token,
    body,
  })
  // Cloudflare wraps responses in { success, result, errors }
  if (res.success === false) {
    const errs = res.errors?.map(e => `[${e.code}] ${e.message}`).join(', ')
    throw new Error(`Cloudflare error: ${errs}`)
  }
  return res.result
}

export const cloudflare = {
  async findDnsRecord(cfg, name) {
    const records = await cfFetch(
      `/zones/${cfg.cloudflare.zone_id}/dns_records?type=CNAME&name=${name}`,
      cfg
    )
    return Array.isArray(records) ? records[0] || null : null
  },

  async createDnsRecord(cfg, { name, content }) {
    return cfFetch(`/zones/${cfg.cloudflare.zone_id}/dns_records`, cfg, {
      method: 'POST',
      body: {
        type: 'CNAME',
        name,
        content,
        proxied: true,
        ttl: 1,
        comment: `Household App Infrastructure — ${name}`,
      },
    })
  },

  async updateDnsRecord(cfg, recordId, content) {
    return cfFetch(`/zones/${cfg.cloudflare.zone_id}/dns_records/${recordId}`, cfg, {
      method: 'PATCH',
      body: { content, proxied: true },
    })
  },

  async findAccessApp(cfg, domain) {
    const apps = await cfFetch(
      `/accounts/${cfg.cloudflare.account_id}/access/apps`,
      cfg
    )
    return Array.isArray(apps) ? (apps.find(a => a.domain === domain) || null) : null
  },

  async createAccessApp(cfg, { name, domain }) {
    return cfFetch(`/accounts/${cfg.cloudflare.account_id}/access/apps`, cfg, {
      method: 'POST',
      body: {
        name,
        domain,
        type: 'self_hosted',
        session_duration: '24h',
        auto_redirect_to_identity: true,
        http_only_cookie_attribute: true,
        same_site_cookie_attribute: 'lax',
        skip_interstitial: false,
        app_launcher_visible: true,
      },
    })
  },

  async attachPolicy(cfg, appId) {
    const app = await cfFetch(
      `/accounts/${cfg.cloudflare.account_id}/access/apps/${appId}`,
      cfg
    )
    return cfFetch(
      `/accounts/${cfg.cloudflare.account_id}/access/apps/${appId}`,
      cfg,
      {
        method: 'PUT',
        body: {
          ...app,
          policies: [{ id: cfg.cloudflare.access_policy_id, precedence: 1 }],
        },
      }
    )
  },

  async listAccessAppPolicies(cfg, appId) {
    const app = await cfFetch(
      `/accounts/${cfg.cloudflare.account_id}/access/apps/${appId}`,
      cfg
    )
    return app?.policies || []
  },
}
