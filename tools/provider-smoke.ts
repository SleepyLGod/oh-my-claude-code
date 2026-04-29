type Protocol = 'openai' | 'anthropic'

type SmokeProfile = {
  name: string
  protocol: Protocol
  baseURL: string
  keyEnvs: string[]
  authHeader?: 'x-api-key' | 'authorization-bearer'
  defaultModels: string[]
  allModels: string[]
}

type SmokeResult = {
  profile: string
  protocol: Protocol
  model: string
  check: string
  ok: boolean
  detail: string
}

const PROFILES: SmokeProfile[] = [
  {
    name: 'deepseek',
    protocol: 'openai',
    baseURL: 'https://api.deepseek.com',
    keyEnvs: ['DEEPSEEK_API_KEY'],
    defaultModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    allModels: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
  },
  {
    name: 'deepseek-anthropic',
    protocol: 'anthropic',
    baseURL: 'https://api.deepseek.com/anthropic',
    keyEnvs: ['DEEPSEEK_API_KEY'],
    authHeader: 'x-api-key',
    defaultModels: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    allModels: [
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ],
  },
  {
    name: 'qwen',
    protocol: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyEnvs: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    defaultModels: ['qwen-plus', 'qwen3.5-plus', 'qwen3-coder-plus'],
    allModels: [
      'qwen-plus',
      'qwen-plus-latest',
      'qwen-flash',
      'qwen-turbo',
      'qwen-max',
      'qwen-max-latest',
      'qwen3-max',
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
  },
  {
    name: 'qwen-anthropic',
    protocol: 'anthropic',
    baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
    keyEnvs: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    authHeader: 'x-api-key',
    defaultModels: ['qwen3.5-plus', 'qwen3-coder-plus'],
    allModels: [
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-max',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
  },
  {
    name: 'qwen-coding-openai',
    protocol: 'openai',
    baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
    keyEnvs: [
      'BAILIAN_CODING_PLAN_API_KEY',
      'DASHSCOPE_CODING_API_KEY',
      'QWEN_CODING_API_KEY',
    ],
    defaultModels: ['qwen3.6-plus', 'qwen3-coder-next', 'qwen3-coder-plus'],
    allModels: [
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
  },
  {
    name: 'qwen-coding-anthropic',
    protocol: 'anthropic',
    baseURL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    keyEnvs: [
      'BAILIAN_CODING_PLAN_API_KEY',
      'DASHSCOPE_CODING_API_KEY',
      'QWEN_CODING_API_KEY',
    ],
    authHeader: 'authorization-bearer',
    defaultModels: ['qwen3.6-plus', 'qwen3-coder-next', 'qwen3-coder-plus'],
    allModels: [
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3-coder-next',
      'qwen3-coder-plus',
      'qwen3-coder-flash',
    ],
  },
]

const args = new Set(process.argv.slice(2))
const runAllModels = args.has('--all-models')
const requestedProfile = process.argv
  .find(arg => arg.startsWith('--profile='))
  ?.slice('--profile='.length)

function getApiKey(profile: SmokeProfile): string | undefined {
  for (const envName of profile.keyEnvs) {
    const value = process.env[envName]
    if (value) return value
  }
  return undefined
}

function buildHeaders(profile: SmokeProfile, apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (profile.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (profile.authHeader === 'authorization-bearer') {
      headers.authorization = `Bearer ${apiKey}`
    } else {
      headers['x-api-key'] = apiKey
    }
  } else {
    headers.authorization = `Bearer ${apiKey}`
  }
  return headers
}

async function postJson(
  url: string,
  headers: HeadersInit,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`)
  }
  return JSON.parse(text)
}

async function postStream(
  url: string,
  headers: HeadersInit,
  body: unknown,
): Promise<{ events: number; sawUsage: boolean }> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`)
  }
  if (!response.body) throw new Error('missing response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let events = 0
  let sawUsage = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const data = chunk
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n')
      if (!data || data === '[DONE]') continue
      events += 1
      sawUsage ||= data.includes('"usage"')
    }
  }
  return { events, sawUsage }
}

function openAITextBody(model: string, stream = false): unknown {
  return {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    max_tokens: 32,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  }
}

function openAIToolBody(model: string): unknown {
  return {
    model,
    messages: [{ role: 'user', content: 'Call the get_time tool.' }],
    max_tokens: 64,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Return the current time.',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'get_time' } },
  }
}

function anthropicTextBody(model: string, stream = false): unknown {
  return {
    model,
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    stream,
  }
}

function anthropicToolBody(model: string): unknown {
  return {
    model,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Call the get_time tool.' }],
    tools: [
      {
        name: 'get_time',
        description: 'Return the current time.',
        input_schema: { type: 'object', properties: {} },
      },
    ],
    tool_choice: { type: 'tool', name: 'get_time' },
  }
}

function containsToolCall(protocol: Protocol, response: unknown): boolean {
  const serialized = JSON.stringify(response)
  return protocol === 'openai'
    ? serialized.includes('"tool_calls"') || serialized.includes('"function"')
    : serialized.includes('"tool_use"')
}

async function runCheck(
  result: SmokeResult[],
  profile: SmokeProfile,
  model: string,
  check: string,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    result.push({
      profile: profile.name,
      protocol: profile.protocol,
      model,
      check,
      ok: true,
      detail: await fn(),
    })
  } catch (error) {
    result.push({
      profile: profile.name,
      protocol: profile.protocol,
      model,
      check,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

async function runProfile(profile: SmokeProfile): Promise<SmokeResult[]> {
  const apiKey = getApiKey(profile)
  if (!apiKey) {
    return [
      {
        profile: profile.name,
        protocol: profile.protocol,
        model: '-',
        check: 'credentials',
        ok: false,
        detail: `missing ${profile.keyEnvs.join(' or ')}`,
      },
    ]
  }

  const headers = buildHeaders(profile, apiKey)
  const models = runAllModels ? profile.allModels : profile.defaultModels
  const results: SmokeResult[] = []

  for (const model of models) {
    if (profile.protocol === 'openai') {
      const url = `${profile.baseURL}/chat/completions`
      await runCheck(results, profile, model, 'text', async () => {
        const response = await postJson(url, headers, openAITextBody(model))
        return JSON.stringify(response).includes('"usage"')
          ? 'ok · usage present'
          : 'ok · usage missing'
      })
      await runCheck(results, profile, model, 'stream', async () => {
        const response = await postStream(url, headers, openAITextBody(model, true))
        return `ok · events=${response.events} usage=${response.sawUsage}`
      })
      await runCheck(results, profile, model, 'tool', async () => {
        const response = await postJson(url, headers, openAIToolBody(model))
        return containsToolCall(profile.protocol, response)
          ? 'ok · tool call present'
          : 'no tool call in response'
      })
    } else {
      const url = `${profile.baseURL}/v1/messages`
      await runCheck(results, profile, model, 'text', async () => {
        const response = await postJson(url, headers, anthropicTextBody(model))
        return JSON.stringify(response).includes('"usage"')
          ? 'ok · usage present'
          : 'ok · usage missing'
      })
      await runCheck(results, profile, model, 'stream', async () => {
        const response = await postStream(
          url,
          headers,
          anthropicTextBody(model, true),
        )
        return `ok · events=${response.events} usage=${response.sawUsage}`
      })
      await runCheck(results, profile, model, 'tool', async () => {
        const response = await postJson(url, headers, anthropicToolBody(model))
        return containsToolCall(profile.protocol, response)
          ? 'ok · tool call present'
          : 'no tool call in response'
      })
    }
  }

  return results
}

function printResults(results: SmokeResult[]): void {
  for (const result of results) {
    const status = result.ok ? 'PASS' : 'FAIL'
    console.log(
      `${status}\t${result.profile}\t${result.protocol}\t${result.model}\t${result.check}\t${result.detail}`,
    )
  }
}

const profiles = requestedProfile
  ? PROFILES.filter(profile => profile.name === requestedProfile)
  : PROFILES

if (requestedProfile && profiles.length === 0) {
  console.error(`Unknown profile '${requestedProfile}'`)
  process.exit(2)
}

const results = (await Promise.all(profiles.map(runProfile))).flat()
printResults(results)
process.exit(results.every(result => result.ok) ? 0 : 1)
